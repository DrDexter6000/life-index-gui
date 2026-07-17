"""CLI Adapter — async subprocess wrapper for life-index commands."""

import asyncio
import json
import logging
import os
import re
import shlex
import subprocess

from backend import config

logger = logging.getLogger(__name__)

MIN_SUPPORTED_CLI_VERSION = "1.4.5"


class CLIError(Exception):
    """Raised when a CLI command fails."""

    def __init__(self, returncode: int, stderr: str, stdout: str = ""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout
        super().__init__(f"CLI exited with code {returncode}: {stderr[:200]}")


class CLIAdapter:
    """Wraps `life-index` CLI calls as async subprocess invocations."""

    def __init__(
        self,
        command: str = config.CLI_COMMAND,
        timeout: float = config.CLI_TIMEOUT,
        health_timeout: float = config.CLI_HEALTH_TIMEOUT,
    ):
        self._command = command
        self._timeout = timeout
        self._health_timeout = health_timeout
        self._write_lock = asyncio.Lock()

    async def run(
        self,
        args: list[str],
        timeout: float | None = None,
    ) -> str:
        """Run a CLI command and return stdout. Raises CLIError on failure.

        Runs a blocking ``subprocess.run`` inside a worker thread instead of
        ``asyncio.create_subprocess_exec``. The async variant raises
        ``NotImplementedError`` on Windows when the running loop is a
        ``SelectorEventLoop`` (the loop uvicorn configures), which broke every
        CLI-backed endpoint. The thread approach is independent of the event
        loop policy and behaves identically on every platform, so dev and
        production share one code path.
        """
        cmd = [*shlex.split(self._command), *args]
        effective_timeout = timeout or self._timeout

        logger.info("CLI: %s", shlex.join(cmd))

        env = os.environ.copy()
        data_dir = os.environ.get("LIFE_INDEX_DATA_DIR")
        if data_dir:
            env["LIFE_INDEX_DATA_DIR"] = data_dir

        try:
            completed = await asyncio.to_thread(
                subprocess.run,
                cmd,
                capture_output=True,
                env=env,
                timeout=effective_timeout,
            )
        except subprocess.TimeoutExpired:
            raise CLIError(-1, f"Command timed out after {effective_timeout}s")

        stdout = completed.stdout.decode("utf-8", errors="replace")
        stderr = completed.stderr.decode("utf-8", errors="replace")

        if completed.returncode != 0:
            raise CLIError(completed.returncode, stderr, stdout)

        return stdout

    async def run_bytes(
        self,
        args: list[str],
        timeout: float | None = None,
    ) -> bytes:
        """Run a CLI command and return raw stdout bytes."""
        if not _is_handshake_call(args):
            await self._ensure_cli_compatible()

        cmd = [*shlex.split(self._command), *args]
        effective_timeout = timeout or self._timeout

        logger.info("CLI: %s", shlex.join(cmd))

        env = os.environ.copy()
        data_dir = os.environ.get("LIFE_INDEX_DATA_DIR")
        if data_dir:
            env["LIFE_INDEX_DATA_DIR"] = data_dir

        try:
            completed = await asyncio.to_thread(
                subprocess.run,
                cmd,
                capture_output=True,
                env=env,
                timeout=effective_timeout,
            )
        except subprocess.TimeoutExpired:
            raise CLIError(-1, f"Command timed out after {effective_timeout}s")

        stderr = completed.stderr.decode("utf-8", errors="replace")
        stdout_text = completed.stdout.decode("utf-8", errors="replace")

        if completed.returncode != 0:
            raise CLIError(completed.returncode, stderr, stdout_text)

        return completed.stdout

    async def _ensure_cli_compatible(self) -> None:
        """Fail closed before any feature CLI command below the GUI floor."""
        version_probe = await self._probe_cli_version()
        if version_probe.get("compatible") is True:
            return

        error = version_probe.get("error")
        error_data = error if isinstance(error, dict) else {}
        code = str(error_data.get("code") or "CLI_VERSION_UNSUPPORTED")
        package_version = version_probe.get("package_version") or "unknown"
        minimum = version_probe.get("minimum_supported_version") or MIN_SUPPORTED_CLI_VERSION
        message = str(
            error_data.get("message")
            or f"Life Index CLI {package_version} is incompatible; GUI requires CLI {minimum} or newer."
        )
        payload = {
            "ok": False,
            "error": {"code": code, "message": message},
        }
        raise CLIError(-2, json.dumps(payload, ensure_ascii=False))

    async def run_json(
        self,
        args: list[str],
        timeout: float | None = None,
    ) -> dict | list:
        """Run a CLI command and parse JSON output."""
        if not _is_handshake_call(args):
            await self._ensure_cli_compatible()
        stdout = await self.run(args, timeout=timeout)
        text = stdout.strip()
        if not text:
            return {}
        return json.loads(text)

    async def handshake(self) -> dict:
        """Run the GUI/CLI compatibility handshake.

        Uses ``CLI_HEALTH_TIMEOUT`` so cold-start CLI launches
        (e.g. ``life-index health`` on first load) are not rejected
        by the shorter general-purpose ``CLI_TIMEOUT``.
        """
        try:
            version_probe = await self._probe_cli_version()
        except CLIError as exc:
            return {
                "status": "degraded",
                "cli_available": False,
                "compatible": False,
                "package_version": None,
                "repo_version": None,
                "minimum_supported_version": MIN_SUPPORTED_CLI_VERSION,
                "health": None,
                "error": {
                    "returncode": exc.returncode,
                    "message": exc.stderr or exc.stdout,
                },
            }

        if version_probe.get("compatible") is not True:
            return version_probe

        try:
            health_payload = await self.run_json(
                ["health"], timeout=self._health_timeout
            )
        except CLIError as exc:
            return {
                "status": "degraded",
                "cli_available": True,
                "compatible": True,
                "package_version": version_probe["package_version"],
                "repo_version": version_probe["repo_version"],
                "minimum_supported_version": version_probe["minimum_supported_version"],
                "health": None,
                "error": {
                    "returncode": exc.returncode,
                    "message": exc.stderr or exc.stdout,
                },
            }
        except (TypeError, ValueError) as exc:
            return _invalid_health_result(version_probe, f"Life Index CLI returned invalid health JSON: {exc}")

        if not isinstance(health_payload, dict):
            return _invalid_health_result(
                version_probe,
                "Life Index CLI returned a non-object health JSON payload.",
            )

        health_data = health_payload
        health_body = health_data.get("data")
        health_body_data = health_body if isinstance(health_body, dict) else {}
        health_status = str(
            health_data.get("status") or health_body_data.get("status") or ""
        ).lower()
        health_success = health_data.get("success", True) is not False
        healthy = health_success and health_status in {"", "ok", "healthy", "pass"}

        return {
            **version_probe,
            "status": "ok" if healthy else "degraded",
            "health": health_data,
        }

    async def _probe_cli_version(self) -> dict:
        """Probe and normalize only the CLI version for feature gating."""
        try:
            version_payload = await self.run_json(
                ["version"], timeout=self._health_timeout
            )
        except (TypeError, ValueError) as exc:
            return _invalid_version_result(
                f"Life Index CLI returned invalid version JSON: {exc}"
            )
        return _normalize_version_payload(version_payload)

    async def data_audit(self) -> dict:
        """Run ``health --data-audit`` and return the CLI payload.

        Read-only diagnostic surface; safe for GUI consumption per the
        M2 S1 maintenance surface inventory.  Uses ``CLI_HEALTH_TIMEOUT``
        so cold-start CLI launches are not prematurely timed out.
        """
        try:
            return await self.run_json(
                ["health", "--data-audit"], timeout=self._health_timeout
            )
        except CLIError:
            return {
                "success": False,
                "error": "data-audit-unavailable",
            }

    async def verify(self) -> dict:
        """Run ``verify --json`` and return integrity diagnostics.

        Read-only diagnostic surface; safe for GUI consumption per the
        M2 S1 maintenance surface inventory (section 2.1).
        CLI may exit non-zero on issues — treat as diagnostic payload,
        not fatal error.
        """
        try:
            return await self.run_json(["verify", "--json"])
        except CLIError as exc:
            # CLI exits non-zero when issues found — capture stdout as diagnostic
            try:
                payload = json.loads(exc.stdout) if exc.stdout else {}
                return (
                    payload
                    if isinstance(payload, dict)
                    else {"success": False, "issues_count": 0, "raw_output": exc.stdout}
                )
            except Exception:
                return {"success": False, "error": "verify-unavailable", "issues_count": 0}

    async def index_check(self) -> dict:
        """Run ``index --check --json`` and return index health diagnostics.

        Read-only diagnostic surface; safe for GUI consumption per the
        M2 S1 maintenance surface inventory (section 3.1).
        CLI exits non-zero when unhealthy — treat as diagnostic payload.
        """
        try:
            return await self.run_json(["index", "--check", "--json"])
        except CLIError as exc:
            try:
                payload = json.loads(exc.stdout) if exc.stdout else {}
                return (
                    payload
                    if isinstance(payload, dict)
                    else {"healthy": False, "error": "index-check-unavailable"}
                )
            except Exception:
                return {"healthy": False, "error": "index-check-unavailable"}

    async def index_cache_dry_run(self) -> dict:
        """Run ``index --cache-dry-run`` and return cache metadata diagnostics.

        Read-only cache-only metadata check; safe for GUI consumption per the
        M2 S1 maintenance surface inventory (section 3.2).
        """
        try:
            return await self.run_json(["index", "--cache-dry-run"])
        except CLIError:
            return {"success": False, "error": "cache-dry-run-unavailable"}

    async def maintenance_audit(self, domain: str | None = None) -> dict:
        """Run ``maintenance audit --json`` and return the CLI payload.

        Read-only diagnostic surface for the Data Doctor maintenance contract.
        Optional *domain* filters audit to specific domains (CSV string).
        CLI may exit non-zero on issues — treat as diagnostic payload.
        """
        args = ["maintenance", "audit"]
        if domain:
            args.extend(["--domain", domain])
        args.append("--json")
        try:
            return await self.run_json(args)
        except CLIError as exc:
            return _safe_json_stdout(exc, {"success": False, "error": "maintenance-audit-unavailable"})

    async def maintenance_plan(self, issue_id: str) -> dict:
        """Run ``maintenance plan --issue-id <id> --json`` and return plan payload.

        Read-only repair plan for a specific maintenance issue.
        CLI may exit non-zero — treat as diagnostic payload.
        """
        args = ["maintenance", "plan", "--issue-id", issue_id, "--json"]
        try:
            return await self.run_json(args)
        except CLIError as exc:
            return _safe_json_stdout(exc, {"success": False, "error": "maintenance-plan-unavailable"})

    async def maintenance_repair_dry_run(self, issue_id: str) -> dict:
        """Run ``maintenance repair --issue-id <id> --dry-run --json``.

        Read-only dry-run preview of repair actions.
        CLI may exit non-zero — treat as diagnostic payload.
        """
        args = ["maintenance", "repair", "--issue-id", issue_id, "--dry-run", "--json"]
        try:
            return await self.run_json(args)
        except CLIError as exc:
            return _safe_json_stdout(exc, {"success": False, "error": "maintenance-repair-dry-run-unavailable"})

    async def maintenance_repair_apply(self, issue_id: str) -> dict:
        """Run ``maintenance repair --issue-id <id> --apply --json``.

        Destructive write operation — uses serialized execution.
        If the CLI exits non-zero but returns a JSON error envelope on stdout,
        return that parsed envelope instead of discarding it.
        """
        args = ["maintenance", "repair", "--issue-id", issue_id, "--apply", "--json"]
        try:
            stdout = await self.run_serialized(args)
            text = stdout.strip()
            if not text:
                return {}
            return json.loads(text)
        except CLIError as exc:
            return _safe_json_stdout(exc, {"success": False, "error": "maintenance-repair-apply-unavailable"})

    async def run_serialized(
        self, args: list[str], timeout: float | None = None
    ) -> str:
        """Run a write command under the serialization lock (MD5).

        Prevents concurrent CLI writes from conflicting on CLI-maintained metadata.
        """
        if not _is_handshake_call(args):
            await self._ensure_cli_compatible()
        async with self._write_lock:
            return await self.run(args, timeout=timeout)


def _safe_json_stdout(exc: CLIError, fallback: dict) -> dict:
    """Parse JSON from CLIError stdout; return *fallback* on failure."""
    try:
        payload = json.loads(exc.stdout) if exc.stdout else {}
        return payload if isinstance(payload, dict) else fallback
    except Exception:
        return fallback


def _normalize_version_payload(payload: object) -> dict:
    """Normalize a version response using one strict compatibility policy."""
    version_data = payload if isinstance(payload, dict) else {}
    manifest = version_data.get("bootstrap_manifest")
    manifest_data = manifest if isinstance(manifest, dict) else {}
    package_version = (
        version_data.get("package_version")
        or version_data.get("version")
        or version_data.get("repo_version")
    )
    repo_version = manifest_data.get("repo_version") or version_data.get(
        "repo_version"
    )
    result = {
        "status": "degraded",
        "cli_available": True,
        "compatible": False,
        "package_version": package_version,
        "repo_version": repo_version,
        "minimum_supported_version": MIN_SUPPORTED_CLI_VERSION,
        "health": None,
    }
    if _version_parts(package_version) is None:
        result["error"] = {
            "code": "CLI_VERSION_INVALID",
            "message": (
                "Life Index CLI reported an unparseable version "
                f"{package_version or 'unknown'!r}; GUI requires CLI "
                f"{MIN_SUPPORTED_CLI_VERSION} or newer."
            ),
        }
        return result
    if not _version_gte(package_version, MIN_SUPPORTED_CLI_VERSION):
        result["error"] = {
            "code": "CLI_VERSION_UNSUPPORTED",
            "message": (
                f"Life Index CLI {package_version} is below the GUI minimum "
                f"CLI {MIN_SUPPORTED_CLI_VERSION}; upgrade the CLI before using GUI data features."
            ),
        }
        return result
    result["status"] = "ok"
    result["compatible"] = True
    return result


def _invalid_version_result(message: str) -> dict:
    """Return the structured result for malformed version JSON."""
    result = _normalize_version_payload(None)
    result["error"]["message"] = message
    return result


def _invalid_health_result(version_probe: dict, message: str) -> dict:
    """Return a degraded handshake result for malformed health JSON."""
    return {
        **version_probe,
        "status": "degraded",
        "health": None,
        "error": {
            "code": "CLI_HEALTH_INVALID",
            "message": message,
        },
    }


def _version_gte(actual: str | None, minimum: str) -> bool:
    """Compare strictly parseable dotted numeric versions."""
    actual_parts = _version_parts(actual)
    minimum_parts = _version_parts(minimum)
    if actual_parts is None or minimum_parts is None:
        return False
    return actual_parts >= minimum_parts


def _version_parts(value: str | None) -> tuple[int, ...] | None:
    """Parse only an exact MAJOR.MINOR.PATCH CLI version."""
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", normalized):
        return None
    return tuple(int(part) for part in normalized.split("."))


def _is_handshake_call(args: list[str]) -> bool:
    """Allow only the exact version/health probes used by ``handshake``."""
    return args in (["version"], ["health"])
