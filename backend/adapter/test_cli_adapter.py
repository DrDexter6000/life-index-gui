"""Tests for CLIAdapter — subprocess wrapper and error handling."""

import asyncio
import shlex
import subprocess
import sys
from unittest.mock import ANY, AsyncMock, MagicMock, patch

import pytest

from backend.adapter.cli_adapter import CLIAdapter, CLIError


@pytest.fixture
def adapter():
    return CLIAdapter(command="life-index", timeout=5.0)


def _completed(returncode: int = 0, stdout: bytes = b"", stderr: bytes = b""):
    """Build a subprocess.CompletedProcess-like mock."""
    return MagicMock(returncode=returncode, stdout=stdout, stderr=stderr)


@pytest.mark.asyncio
async def test_run_success(adapter):
    """CLIAdapter.run returns stdout on success."""
    with patch(
        "backend.adapter.cli_adapter.subprocess.run",
        return_value=_completed(0, b"hello stdout", b""),
    ) as mock_run:
        result = await adapter.run(["search", "--query", "test"])

    assert result == "hello stdout"
    mock_run.assert_called_once_with(
        ["life-index", "search", "--query", "test"],
        capture_output=True,
        env=ANY,
        timeout=5.0,
    )


@pytest.mark.asyncio
async def test_run_failure(adapter):
    """CLIAdapter.run raises CLIError on non-zero exit."""
    with patch(
        "backend.adapter.cli_adapter.subprocess.run",
        return_value=_completed(1, b"", b"something went wrong"),
    ):
        with pytest.raises(CLIError) as exc_info:
            await adapter.run(["write"])

    assert exc_info.value.returncode == 1
    assert "something went wrong" in exc_info.value.stderr


@pytest.mark.asyncio
async def test_run_timeout(adapter):
    """CLIAdapter.run raises CLIError when the subprocess times out."""
    with patch(
        "backend.adapter.cli_adapter.subprocess.run",
        side_effect=subprocess.TimeoutExpired(cmd="life-index", timeout=0.001),
    ):
        with pytest.raises(CLIError) as exc_info:
            await adapter.run(["search"], timeout=0.001)

    assert exc_info.value.returncode == -1
    assert "timed out" in exc_info.value.stderr


@pytest.mark.asyncio
async def test_run_json_success(adapter):
    """CLIAdapter.run_json parses JSON output."""
    with patch(
        "backend.adapter.cli_adapter.subprocess.run",
        return_value=_completed(0, b'{"key": "value"}', b""),
    ):
        result = await adapter.run_json(["stats"])

    assert result == {"key": "value"}


@pytest.mark.asyncio
async def test_run_json_empty(adapter):
    """CLIAdapter.run_json returns {} for empty stdout."""
    with patch(
        "backend.adapter.cli_adapter.subprocess.run",
        return_value=_completed(0, b"   ", b""),
    ):
        result = await adapter.run_json(["stats"])

    assert result == {}


def test_real_subprocess_runs_on_selector_event_loop():
    """Root-cause-A regression guard.

    The adapter must run a real subprocess even on a ``SelectorEventLoop`` —
    the loop uvicorn configures on Windows, where the previous
    ``asyncio.create_subprocess_exec`` implementation raised
    ``NotImplementedError`` and broke every CLI-backed endpoint. Uses the
    Python executable as an always-present command and drives an explicit
    ``SelectorEventLoop`` so the regression is caught on any platform/CI,
    not only on Windows.
    """
    real_adapter = CLIAdapter(command=shlex.join([sys.executable]), timeout=30.0)
    loop = asyncio.SelectorEventLoop()
    try:
        result = loop.run_until_complete(
            real_adapter.run(["-c", "import sys; sys.stdout.write('smoke-ok')"])
        )
    finally:
        loop.close()

    assert result.strip() == "smoke-ok"


@pytest.mark.asyncio
async def test_handshake_runs_version_and_health(adapter):
    """CLIAdapter.handshake returns normalized version and health state."""
    calls = []

    async def fake_run_json(args, timeout=None):
        calls.append(args)
        if args == ["version"]:
            return {
                "package_version": "1.3.7",
                "bootstrap_manifest": {"repo_version": "1.3.7"},
            }
        if args == ["health"]:
            return {"status": "healthy", "journal_count": 3}
        raise AssertionError(f"unexpected command: {args}")

    with patch.object(adapter, "run_json", side_effect=fake_run_json):
        result = await adapter.handshake()

    assert calls == [["version"], ["health"]]
    assert result["cli_available"] is True
    assert result["compatible"] is True
    assert result["status"] == "ok"
    assert result["package_version"] == "1.3.7"
    assert result["repo_version"] == "1.3.7"
    assert result["health"]["journal_count"] == 3


@pytest.mark.asyncio
async def test_handshake_marks_pre_1_3_7_cli_incompatible(adapter):
    """CLIAdapter.handshake rejects CLI releases below the GUI minimum."""

    async def fake_run_json(args, timeout=None):
        if args == ["version"]:
            return {
                "package_version": "1.2.1",
                "bootstrap_manifest": {"repo_version": "1.2.1"},
            }
        if args == ["health"]:
            return {"status": "healthy", "journal_count": 3}
        raise AssertionError(f"unexpected command: {args}")

    with patch.object(adapter, "run_json", side_effect=fake_run_json):
        result = await adapter.handshake()

    assert result["cli_available"] is True
    assert result["compatible"] is False
    assert result["minimum_supported_version"] == "1.3.7"


@pytest.mark.asyncio
async def test_handshake_uses_nested_health_status(adapter):
    """CLI health envelope data.status controls degraded handshake state."""

    async def fake_run_json(args, timeout=None):
        if args == ["version"]:
            return {"package_version": "1.3.7"}
        if args == ["health"]:
            return {"success": True, "data": {"status": "degraded"}}
        raise AssertionError(f"unexpected command: {args}")

    with patch.object(adapter, "run_json", side_effect=fake_run_json):
        result = await adapter.handshake()

    assert result["cli_available"] is True
    assert result["compatible"] is True
    assert result["status"] == "degraded"


@pytest.mark.asyncio
async def test_run_serialized_uses_lock(adapter):
    """CLIAdapter.run_serialized acquires the write lock."""
    with patch(
        "backend.adapter.cli_adapter.subprocess.run",
        return_value=_completed(0, b"ok", b""),
    ) as mock_run:
        result = await adapter.run_serialized(["write"])

    assert result == "ok"
    mock_run.assert_called_once()


# --- S1 Exit Gate: Focused adapter boundary tests ---
import ast
from pathlib import Path as _Path

_S1_PROJECT_ROOT = _Path(__file__).resolve().parents[2]
_S1_BACKEND_ROOT = _S1_PROJECT_ROOT / "backend"


def _s1_production_files() -> list[_Path]:
    """Production backend Python files for S1 boundary scanning."""
    files: list[_Path] = []
    for p in _S1_BACKEND_ROOT.rglob("*.py"):
        if p.name.startswith("test_") or "__pycache__" in p.parts:
            continue
        files.append(p)
    return files


def test_adapter_does_not_construct_unsupported_stats_command():
    """S1 gate: production backend never calls a 'stats' CLI subcommand.

    There is no locked 'life-index stats' command. Dashboard statistics
    must be composed from supported read-only CLI surfaces (health, search).
    Excludes keyword-arg lists like APIRouter(tags=["stats"]).
    """
    violations: list[str] = []
    for path in _s1_production_files():
        rel = path.relative_to(_S1_PROJECT_ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))

        # Collect line numbers of list literals used as keyword argument values
        # (e.g. tags=["stats"]) so we can exclude them from CLI-command detection.
        keyword_list_lines: set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.keyword) and isinstance(node.value, ast.List):
                keyword_list_lines.add(node.value.lineno)

        for node in ast.walk(tree):
            if not (isinstance(node, ast.List) and node.elts):
                continue
            if node.lineno in keyword_list_lines:
                continue
            first = node.elts[0]
            if (
                isinstance(first, ast.Constant)
                and isinstance(first.value, str)
                and first.value == "stats"
            ):
                violations.append(
                    f"{rel}:{node.lineno}: unsupported CLI subcommand 'stats'"
                )
    assert not violations, (
        "Unsupported 'stats' CLI subcommand found:\n" + "\n".join(violations)
    )


def test_adapter_does_not_construct_unsupported_get_command():
    """S1 gate: production backend never calls a 'get' CLI subcommand.

    There is no locked 'life-index get' command. Journal detail resolution
    uses validated search --read-top instead.
    """
    violations: list[str] = []
    for path in _s1_production_files():
        rel = path.relative_to(_S1_PROJECT_ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.List) and node.elts):
                continue
            first = node.elts[0]
            if (
                isinstance(first, ast.Constant)
                and isinstance(first.value, str)
                and first.value == "get"
            ):
                violations.append(
                    f"{rel}:{node.lineno}: unsupported CLI subcommand 'get'"
                )
    assert not violations, (
        "Unsupported 'get' CLI subcommand found:\n" + "\n".join(violations)
    )


def test_adapter_does_not_perform_directory_scans():
    """S1 gate: production backend never scans user-data directories.

    os.scandir, os.listdir, os.walk, and Path.iterdir bypass CLI-mediated
    reads and are R3 forbidden direct structural reads.
    """
    FORBIDDEN = {
        "scandir": "os.scandir is a direct directory scan.",
        "listdir": "os.listdir is a direct directory scan.",
        "walk": "os.walk is a direct directory scan.",
        "iterdir": "Path.iterdir is a direct directory scan.",
    }
    violations: list[str] = []
    for path in _s1_production_files():
        rel = path.relative_to(_S1_PROJECT_ROOT).as_posix()
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                msg = FORBIDDEN.get(node.func.attr)
                if msg:
                    violations.append(
                        f"{rel}:{node.lineno}: .{node.func.attr}(...) - {msg}"
                    )
    assert not violations, (
        "Directory scan calls in production code:\n" + "\n".join(violations)
    )


@pytest.mark.asyncio
async def test_verify_uses_cli_json_and_preserves_nonzero_payload(adapter):
    """S3 gate: verify diagnostics use CLI stdout even on diagnostic exit."""

    async def fake_run_json(args):
        raise CLIError(
            1,
            "verification failed",
            '{"success": false, "issues_count": 2}',
        )

    with patch.object(adapter, "run_json", side_effect=fake_run_json) as run_json:
        result = await adapter.verify()

    run_json.assert_called_once_with(["verify", "--json"])
    assert result["success"] is False
    assert result["issues_count"] == 2


@pytest.mark.asyncio
async def test_index_check_uses_cli_json_and_preserves_nonzero_payload(adapter):
    """S3 gate: index check uses CLI stdout even when unhealthy."""

    async def fake_run_json(args):
        raise CLIError(
            1,
            "index unhealthy",
            '{"healthy": false, "issues": ["manifest missing"]}',
        )

    with patch.object(adapter, "run_json", side_effect=fake_run_json) as run_json:
        result = await adapter.index_check()

    run_json.assert_called_once_with(["index", "--check", "--json"])
    assert result["healthy"] is False
    assert result["issues"] == ["manifest missing"]


@pytest.mark.asyncio
async def test_index_cache_dry_run_uses_read_only_cli_surface(adapter):
    """S3 gate: cache dry-run calls the read-only cache metadata surface."""
    with patch.object(
        adapter,
        "run_json",
        AsyncMock(
            return_value={
                "success": True,
                "dry_run": True,
                "cache_version": {"would_rebuild": True},
            }
        ),
    ) as run_json:
        result = await adapter.index_cache_dry_run()

    run_json.assert_called_once_with(["index", "--cache-dry-run"])
    assert result["dry_run"] is True
    assert result["cache_version"]["would_rebuild"] is True


# --- M33 Maintenance Data Doctor adapter tests ---


@pytest.mark.asyncio
async def test_maintenance_audit_calls_cli(adapter):
    """maintenance_audit() calls ["maintenance", "audit", "--json"]."""
    with patch.object(
        adapter,
        "run_json",
        AsyncMock(return_value={"schema_version": "m33.maintenance_audit.v0", "issues": []}),
    ) as run_json:
        result = await adapter.maintenance_audit()

    run_json.assert_called_once_with(["maintenance", "audit", "--json"])
    assert result["schema_version"] == "m33.maintenance_audit.v0"
    assert result["issues"] == []


@pytest.mark.asyncio
async def test_maintenance_audit_with_domain(adapter):
    """maintenance_audit("layout,search_index") passes --domain flag."""
    with patch.object(
        adapter,
        "run_json",
        AsyncMock(
            return_value={
                "schema_version": "m33.maintenance_audit.v0",
                "domain": ["layout", "search_index"],
                "issues": [],
            }
        ),
    ) as run_json:
        result = await adapter.maintenance_audit("layout,search_index")

    run_json.assert_called_once_with(
        ["maintenance", "audit", "--domain", "layout,search_index", "--json"]
    )
    assert result["domain"] == ["layout", "search_index"]


@pytest.mark.asyncio
async def test_maintenance_plan_calls_cli(adapter):
    """maintenance_plan(issue_id) calls ["maintenance", "plan", "--issue-id", issue_id, "--json"]."""
    issue_id = "layout.missing_generated_index:INDEX.md"
    with patch.object(
        adapter,
        "run_json",
        AsyncMock(
            return_value={
                "schema_version": "m33.maintenance_plan.v0",
                "issue_id": issue_id,
                "actions": [],
            }
        ),
    ) as run_json:
        result = await adapter.maintenance_plan(issue_id)

    run_json.assert_called_once_with(
        ["maintenance", "plan", "--issue-id", issue_id, "--json"]
    )
    assert result["schema_version"] == "m33.maintenance_plan.v0"
    assert result["issue_id"] == issue_id


@pytest.mark.asyncio
async def test_maintenance_repair_dry_run_calls_cli(adapter):
    """maintenance_repair_dry_run(issue_id) calls repair --dry-run --json."""
    issue_id = "layout.missing_generated_index:INDEX.md"
    with patch.object(
        adapter,
        "run_json",
        AsyncMock(
            return_value={
                "schema_version": "m33.maintenance_repair.v0",
                "issue_id": issue_id,
                "dry_run": True,
                "changes": [],
            }
        ),
    ) as run_json:
        result = await adapter.maintenance_repair_dry_run(issue_id)

    run_json.assert_called_once_with(
        ["maintenance", "repair", "--issue-id", issue_id, "--dry-run", "--json"]
    )
    assert result["dry_run"] is True
    assert result["issue_id"] == issue_id


@pytest.mark.asyncio
async def test_maintenance_repair_apply_uses_serialized(adapter):
    """maintenance_repair_apply(issue_id) uses run_serialized then parses JSON."""
    issue_id = "layout.missing_generated_index:INDEX.md"
    with patch.object(
        adapter,
        "run_serialized",
        AsyncMock(
            return_value='{"schema_version": "m33.maintenance_repair.v0", "issue_id": "'
            + issue_id
            + '", "applied": true}'
        ),
    ) as run_serialized:
        result = await adapter.maintenance_repair_apply(issue_id)

    run_serialized.assert_called_once_with(
        ["maintenance", "repair", "--issue-id", issue_id, "--apply", "--json"]
    )
    assert result["applied"] is True
    assert result["issue_id"] == issue_id


@pytest.mark.asyncio
async def test_maintenance_repair_apply_returns_error_envelope_on_nonzero(adapter):
    """If apply CLI exits non-zero but stdout has JSON error envelope, return it."""
    issue_id = "layout.broken"
    with patch.object(
        adapter,
        "run_serialized",
        AsyncMock(
            side_effect=CLIError(
                1,
                "repair failed",
                '{"success": false, "error": {"code": "REPAIR_FAILED", "message": "cannot fix"}}',
            )
        ),
    ) as run_serialized:
        result = await adapter.maintenance_repair_apply(issue_id)

    assert result["success"] is False
    assert result["error"]["code"] == "REPAIR_FAILED"


# ── Health timeout (CLI_HEALTH_TIMEOUT) ──────────────────────────────────


@pytest.mark.asyncio
async def test_handshake_passes_health_timeout_to_run_json():
    """handshake() passes health_timeout to both version and health calls."""
    adapter = CLIAdapter(command="life-index", timeout=5.0, health_timeout=30.0)
    calls = []

    async def fake_run_json(args, timeout=None):
        calls.append((args, timeout))
        if args == ["version"]:
            return {"package_version": "1.2.1"}
        if args == ["health"]:
            return {"status": "healthy"}
        raise AssertionError(f"unexpected command: {args}")

    with patch.object(adapter, "run_json", side_effect=fake_run_json):
        await adapter.handshake()

    assert len(calls) == 2
    assert calls[0] == (["version"], 30.0)
    assert calls[1] == (["health"], 30.0)


@pytest.mark.asyncio
async def test_data_audit_passes_health_timeout_to_run_json():
    """data_audit() passes health_timeout to its run_json call."""
    adapter = CLIAdapter(command="life-index", timeout=5.0, health_timeout=30.0)

    with patch.object(
        adapter, "run_json", AsyncMock(return_value={"success": True})
    ) as run_json:
        await adapter.data_audit()

    run_json.assert_called_once_with(
        ["health", "--data-audit"], timeout=30.0
    )


@pytest.mark.asyncio
async def test_run_uses_default_timeout_not_health_timeout():
    """Ordinary run() uses CLI_TIMEOUT, not CLI_HEALTH_TIMEOUT."""
    adapter = CLIAdapter(command="life-index", timeout=5.0, health_timeout=30.0)

    with patch(
        "backend.adapter.cli_adapter.subprocess.run",
        return_value=_completed(0, b"ok", b""),
    ) as mock_run:
        await adapter.run(["search", "--query", "test"])

    mock_run.assert_called_once_with(
        ["life-index", "search", "--query", "test"],
        capture_output=True,
        env=ANY,
        timeout=5.0,
    )
