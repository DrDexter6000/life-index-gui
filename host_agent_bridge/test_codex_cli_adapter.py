"""Focused regression suite for the named Codex CLI adapter.

The synthetic runners never invoke Codex, touch Life Index data, or use a
network/model runtime.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import pytest
from fastapi.testclient import TestClient

from host_agent_bridge import codex_cli_adapter as adapter
from host_agent_bridge.contracts import (
    HostAgentMetadataProposalV1,
    HostAgentQueryResponseV1,
)


def _query_payload() -> dict:
    return {
        "schema_version": "gui.host_agent.query_response.v1",
        "request_id": "req-1",
        "conversation_id": "conv-1",
        "source": "host-agent",
        "mode": "GROUNDED",
        "reason": "synthetic evidence",
        "query": "What did I write?",
        "answer": {
            "mode": "GROUNDED",
            "reason": "synthetic evidence",
            "summary": "One synthetic journal entry.",
            "insights": [],
            "gap": None,
            "suggestions": [],
        },
        "evidence": [
            {
                "id": "synthetic/entry-1",
                "rel_path": "Journals/synthetic/entry-1.md",
                "title": "Synthetic entry",
                "date": "2026-07-14",
            }
        ],
        "tool_trace": [],
    }


def _query_payload_with_tool_trace(tool_trace: list[dict[str, str]]) -> dict:
    payload = _query_payload()
    payload["tool_trace"] = tool_trace
    return payload


def _completed_mcp_tool_call(
    server: str,
    tool: str,
    *,
    status: str = "completed",
    **extra: object,
) -> dict:
    item = {
        "type": "mcp_tool_call",
        "server": server,
        "tool": tool,
        "status": status,
    }
    item.update(extra)
    return {"type": "item.completed", "item": item}


def _codex_jsonl(*events: object) -> str:
    return "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events)


def _metadata_payload() -> dict:
    return {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "req-1",
        "mode": "PROPOSED",
        "reason": "synthetic proposal",
        "fields": {
            "project": {
                "value": "Synthetic project",
                "field_source": "host-agent",
                "confidence": 0.9,
                "rationale": "Synthetic draft.",
                "evidence_spans": [],
            }
        },
        "warnings": [],
        "policy": {"preserve_user_fields": True},
    }


def _complete_metadata_payload() -> dict:
    payload = _metadata_payload()
    payload["fields"] = {field: {} for field in adapter.SUPPORTED_METADATA_FIELDS}
    payload["fields"]["project"] = _metadata_payload()["fields"]["project"]
    return payload


class RecordingRunner:
    def __init__(self, output: dict | str | None, *, returncode: int = 0, stdout: str = ""):
        self.output = output
        self.returncode = returncode
        self.stdout = stdout
        self.argv: list[str] | None = None
        self.stdin: str | None = None
        self.cwd: Path | None = None

    async def __call__(self, argv: list[str], stdin: str, timeout: float, cwd: str | Path | None = None):
        self.argv = list(argv)
        self.stdin = stdin
        self.cwd = Path(cwd) if cwd is not None else None
        output_path = Path(argv[argv.index("--output-last-message") + 1])
        if self.output is not None:
            output_path.write_text(
                self.output
                if isinstance(self.output, str)
                else json.dumps(self.output, ensure_ascii=False),
                encoding="utf-8",
            )
        return adapter.CodexProcessResult(
            returncode=self.returncode,
            stdout=self.stdout,
            stderr="diagnostic secret should never become domain data",
        )


def _adapter(tmp_path: Path, runner: RecordingRunner) -> adapter.CodexCLIAdapter:
    return adapter.CodexCLIAdapter(
        executable="codex",
        runner=runner,
        temp_root=tmp_path,
        timeout_seconds=2,
    )


QUERY_PROJECTION_ENV = {
    "root": "LIFE_INDEX_CODEX_QUERY_PROJECTION_ROOT",
    "python": "LIFE_INDEX_CODEX_QUERY_PROJECTION_PYTHON",
    "data": "LIFE_INDEX_CODEX_QUERY_PROJECTION_DATA_DIR",
    "config": "LIFE_INDEX_CODEX_QUERY_PROJECTION_CONFIG_DIR",
    "cache": "LIFE_INDEX_CODEX_QUERY_PROJECTION_CACHE_DIR",
    "tmp": "LIFE_INDEX_CODEX_QUERY_PROJECTION_TMPDIR",
    "trace": "LIFE_INDEX_CODEX_QUERY_PROJECTION_TRACE_FILE",
}


def _configure_query_projection(monkeypatch, tmp_path: Path) -> dict[str, Path]:
    """Configure a real, isolated projection boundary for synthetic runners."""

    root = tmp_path / "isolated tool channel 空间"
    python = root / "venv space" / "python.exe"
    paths = {
        "root": root,
        "python": python,
        "data": root / "data space",
        "config": root / "config 空间",
        "cache": root / "cache space",
        "tmp": root / "tmp 空间",
    }
    for path in paths.values():
        if path == python:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic projection python", encoding="utf-8")
        else:
            path.mkdir(parents=True, exist_ok=True)
    for key, path in paths.items():
        monkeypatch.setenv(QUERY_PROJECTION_ENV[key], str(path.resolve()))
    return paths


@pytest.fixture(autouse=True)
def _isolated_query_projection_environment(monkeypatch, tmp_path_factory):
    _configure_query_projection(monkeypatch, tmp_path_factory.mktemp("codex-projection"))


def _config_values(argv: list[str]) -> list[str]:
    return [argv[index + 1] for index, token in enumerate(argv[:-1]) if token == "-c"]


def test_codex_adapter_builds_exact_strict_query_argv_and_sends_prompt_on_stdin(tmp_path):
    runner = RecordingRunner(_query_payload())
    instance = _adapter(tmp_path, runner)

    result = asyncio.run(
        instance.query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.payload["mode"] == "GROUNDED"
    assert runner.argv is not None
    assert runner.cwd is not None
    assert runner.argv[0] == "codex"
    assert runner.argv[1:6] == [
        "exec",
        "-C",
        str(runner.cwd),
        "--skip-git-repo-check",
        "--ignore-user-config",
    ]
    assert runner.argv[runner.argv.index("--ignore-user-config") + 1] == "--json"
    assert "--strict-config" in runner.argv
    assert "-s" in runner.argv
    assert runner.argv[runner.argv.index("-s") + 1] == "read-only"
    assert runner.argv[-4:] == [
        "--output-last-message",
        runner.argv[-3],
        "--ephemeral",
        "-",
    ]
    schema_path = Path(runner.argv[runner.argv.index("--output-schema") + 1])
    output_path = Path(runner.argv[runner.argv.index("--output-last-message") + 1])
    assert schema_path.parent == runner.cwd
    assert output_path.parent == runner.cwd
    config_values = _config_values(runner.argv)
    assert config_values[:3] == [
        "approval_policy='never'",
        "features.shell_tool=false",
        "web_search='disabled'",
    ]
    data_dir = Path(os.environ[QUERY_PROJECTION_ENV["data"]]).resolve()
    config_dir = Path(os.environ[QUERY_PROJECTION_ENV["config"]]).resolve()
    cache_dir = Path(os.environ[QUERY_PROJECTION_ENV["cache"]]).resolve()
    tmp_dir = Path(os.environ[QUERY_PROJECTION_ENV["tmp"]]).resolve()
    projection_python = Path(os.environ[QUERY_PROJECTION_ENV["python"]]).resolve()
    assert config_values[3:] == [
        f"mcp_servers.life_index.command={json.dumps(str(projection_python), ensure_ascii=False)}",
        "mcp_servers.life_index.args=['-m','tools.mcp_projection']",
        f"mcp_servers.life_index.env.LIFE_INDEX_DATA_DIR={json.dumps(str(data_dir), ensure_ascii=False)}",
        f"mcp_servers.life_index.env.XDG_CONFIG_HOME={json.dumps(str(config_dir), ensure_ascii=False)}",
        f"mcp_servers.life_index.env.XDG_CACHE_HOME={json.dumps(str(cache_dir), ensure_ascii=False)}",
        f"mcp_servers.life_index.env.TMPDIR={json.dumps(str(tmp_dir), ensure_ascii=False)}",
        "mcp_servers.life_index.enabled_tools=['health','journal.get','search']",
        "mcp_servers.life_index.default_tools_approval_mode='approve'",
        "mcp_servers.life_index.required=true",
    ]
    assert [value for value in config_values if value.startswith("approval_policy=")] == [
        "approval_policy='never'"
    ]
    life_index_mcp_values = [
        value for value in config_values if value.startswith("mcp_servers.")
    ]
    assert all(value.startswith("mcp_servers.life_index.") for value in life_index_mcp_values)
    assert life_index_mcp_values.index(
        "mcp_servers.life_index.default_tools_approval_mode='approve'"
    ) == life_index_mcp_values.index(
        "mcp_servers.life_index.enabled_tools=['health','journal.get','search']"
    ) + 1
    forbidden = {
        "--add-dir",
        "--ignore-rules",
        "--full-auto",
        "--dangerously-bypass-approvals-and-sandbox",
        "dangerously-bypass",
        "execpolicy",
    }
    assert forbidden.isdisjoint(runner.argv)
    assert runner.stdin is not None
    assert "Caller procedure asset." in runner.stdin
    assert '"query":"What did I write?"' in runner.stdin
    assert "What did I write?" not in json.dumps(result.diagnostics)


def test_codex_metadata_has_strict_controls_but_no_mcp_server_configuration(tmp_path):
    runner = RecordingRunner(_complete_metadata_payload())

    result = asyncio.run(
        _adapter(tmp_path, runner).metadata(
            {"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
            procedure_prompt="Caller metadata procedure.",
            source_id="metadata-procedure-v1",
        )
    )

    assert result.reason is None
    assert runner.argv is not None
    assert "--strict-config" in runner.argv
    assert runner.argv[runner.argv.index("-s") + 1] == "read-only"
    assert _config_values(runner.argv) == [
        "approval_policy='never'",
        "features.shell_tool=false",
        "web_search='disabled'",
    ]
    assert not any("mcp_servers.life_index" in value for value in runner.argv)


@pytest.mark.parametrize(
    ("mutate", "reason"),
    [
        (
            lambda monkeypatch: monkeypatch.delenv(QUERY_PROJECTION_ENV["data"]),
            "codex-query-projection-data-dir-unconfigured",
        ),
        (
            lambda monkeypatch: monkeypatch.setenv(QUERY_PROJECTION_ENV["cache"], "relative-cache"),
            "codex-query-projection-cache-dir-not-absolute",
        ),
        (
            lambda monkeypatch: monkeypatch.setenv(
                QUERY_PROJECTION_ENV["tmp"], os.environ[QUERY_PROJECTION_ENV["data"]]
            ),
            "codex-query-projection-isolation-overlap",
        ),
    ],
)
def test_query_projection_config_fails_closed_before_codex_but_metadata_remains_independent(
    monkeypatch, tmp_path, mutate, reason
):
    mutate(monkeypatch)
    query_runner = RecordingRunner(_query_payload())
    query_result = asyncio.run(
        _adapter(tmp_path, query_runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert query_result.payload["mode"] == "UNAVAILABLE"
    assert query_result.reason == reason
    assert query_runner.argv is None

    metadata_runner = RecordingRunner(_complete_metadata_payload())
    metadata_result = asyncio.run(
        _adapter(tmp_path, metadata_runner).metadata(
            {"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
            procedure_prompt="Caller metadata procedure.",
            source_id="metadata-procedure-v1",
        )
    )
    assert metadata_result.payload["mode"] == "PROPOSED"
    assert metadata_runner.argv is not None
    assert not any("mcp_servers.life_index" in value for value in metadata_runner.argv)


def test_query_projection_paths_with_spaces_and_unicode_are_one_toml_config_argument_each(
    monkeypatch, tmp_path
):
    paths = _configure_query_projection(monkeypatch, tmp_path / "重新配置 空间")
    runner = RecordingRunner(_query_payload())

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.reason is None
    assert runner.argv is not None
    config_values = _config_values(runner.argv)
    for env_key in ("data", "config", "cache", "tmp"):
        path = paths[env_key]
        if env_key == "tmp":
            mcp_env_key = "TMPDIR"
        elif env_key == "config":
            mcp_env_key = "XDG_CONFIG_HOME"
        elif env_key == "cache":
            mcp_env_key = "XDG_CACHE_HOME"
        else:
            mcp_env_key = "LIFE_INDEX_DATA_DIR"
        expected = f"mcp_servers.life_index.env.{mcp_env_key}={json.dumps(str(path.resolve()), ensure_ascii=False)}"
        assert expected in config_values
        argv_index = runner.argv.index(expected)
        assert runner.argv[argv_index - 1] == "-c"


def test_query_projection_root_is_required_and_rejects_paths_that_escape_it(monkeypatch, tmp_path):
    _configure_query_projection(monkeypatch, tmp_path)
    monkeypatch.delenv(QUERY_PROJECTION_ENV["root"])
    missing_root_runner = RecordingRunner(_query_payload())
    missing_root = asyncio.run(
        _adapter(tmp_path, missing_root_runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )
    assert missing_root.payload["mode"] == "UNAVAILABLE"
    assert missing_root.reason == "codex-query-projection-root-unconfigured"
    assert missing_root_runner.argv is None

    paths = _configure_query_projection(monkeypatch, tmp_path)
    outside_data = tmp_path / "outside data"
    outside_data.mkdir()
    monkeypatch.setenv(QUERY_PROJECTION_ENV["data"], str(outside_data.resolve()))
    escaped_runner = RecordingRunner(_query_payload())
    escaped = asyncio.run(
        _adapter(tmp_path, escaped_runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )
    assert escaped.payload["mode"] == "UNAVAILABLE"
    assert escaped.reason == "codex-query-projection-path-outside-root"
    assert escaped_runner.argv is None
    assert paths["root"].exists()


def test_query_projection_root_rejects_symlink_indirection(monkeypatch, tmp_path):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    linked_root = tmp_path / "linked projection root"
    try:
        linked_root.symlink_to(paths["root"], target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"symlink fixture unavailable: {exc}")
    monkeypatch.setenv(QUERY_PROJECTION_ENV["root"], str(linked_root))
    runner = RecordingRunner(_query_payload())

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "codex-query-projection-root-symlink"
    assert runner.argv is None


def test_query_projection_trace_file_is_explicit_confined_and_never_ambient(monkeypatch, tmp_path):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    trace_parent = paths["tmp"] / "trace evidence"
    trace_parent.mkdir()
    trace_file = trace_parent / "tool-calls.jsonl"
    assert not trace_file.exists()
    monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(trace_file))
    monkeypatch.setenv("LIFE_INDEX_VALIDATION_MODE", "ambient")
    monkeypatch.setenv("LIFE_INDEX_TOOL_CALL_LOG", str(tmp_path / "ambient-log.jsonl"))
    runner = RecordingRunner(
        _query_payload_with_tool_trace(
            [
                {"tool": "search", "status": "ok"},
                {"tool": "journal.get", "status": "ok"},
            ]
        ),
        stdout=_codex_jsonl(
            {"type": "thread.started", "thread_id": "not-retained"},
            _completed_mcp_tool_call(
                "life_index",
                "search",
                arguments={"query": "raw-search-secret"},
                result={"entries": ["raw-search-result"]},
                error=None,
            ),
            _completed_mcp_tool_call(
                "life_index",
                "journal.get",
                arguments={"rel_path": "Journals/private-entry.md"},
                result={"content": "raw-journal-secret"},
                error=None,
            ),
            {"type": "item.completed", "item": {"type": "agent_message", "text": "ignore"}},
        ),
    )

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.reason is None
    assert result.payload["tool_trace"] == [
        {"tool": "search", "status": "ok"},
        {"tool": "journal.get", "status": "ok"},
    ]
    assert runner.argv is not None
    config_values = _config_values(runner.argv)
    assert not any(
        "LIFE_INDEX_VALIDATION_MODE" in value or "LIFE_INDEX_TOOL_CALL_LOG" in value
        for value in config_values
    )
    assert trace_file.exists()
    assert [json.loads(line) for line in trace_file.read_text(encoding="utf-8").splitlines()] == [
        {"server": "life_index", "tool": "search", "status": "completed", "success": True},
        {
            "server": "life_index",
            "tool": "journal.get",
            "status": "completed",
            "success": True,
        },
    ]
    persisted = trace_file.read_text(encoding="utf-8")
    for secret in ("raw-search-secret", "raw-search-result", "private-entry.md", "raw-journal-secret"):
        assert secret not in persisted
        assert secret not in json.dumps(result.payload)
        assert secret not in json.dumps(result.diagnostics)


@pytest.mark.parametrize(
    ("label", "events", "expected_tools"),
    [
        (
            "extra-health",
            [
                _completed_mcp_tool_call(
                    "life_index",
                    "health",
                    arguments={"detail": "raw-health-argument"},
                    result={"status": "raw-health-result"},
                    error=None,
                ),
                _completed_mcp_tool_call("life_index", "search", error=None),
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
            ],
            ["health", "search", "journal.get"],
        ),
        (
            "duplicate-search",
            [
                _completed_mcp_tool_call("life_index", "health", error=None),
                _completed_mcp_tool_call("life_index", "search", error=None),
                _completed_mcp_tool_call("life_index", "search", error=None),
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
            ],
            ["health", "search", "search", "journal.get"],
        ),
    ],
)
def test_query_projection_projects_all_allowed_objective_calls(
    monkeypatch, tmp_path, label, events, expected_tools
):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    trace_file = paths["tmp"] / f"{label}.jsonl"
    monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(trace_file))
    runner = RecordingRunner(
        _query_payload_with_tool_trace(
            [
                {"tool": "search", "status": "ok"},
                {"tool": "journal.get", "status": "ok"},
            ]
        ),
        stdout=_codex_jsonl(*events),
    )

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.reason is None
    assert result.payload["tool_trace"] == [
        {"tool": tool, "status": "ok"} for tool in expected_tools
    ]
    persisted = [json.loads(line) for line in trace_file.read_text(encoding="utf-8").splitlines()]
    assert [record["tool"] for record in persisted] == expected_tools
    assert all(set(record) == {"server", "tool", "status", "success"} for record in persisted)
    serialized = trace_file.read_text(encoding="utf-8")
    assert "raw-health-argument" not in serialized
    assert "raw-health-result" not in serialized


@pytest.mark.parametrize(
    ("label", "output_trace"),
    [
        ("health-only", [{"tool": "health", "status": "ok"}]),
        ("status-variant", [{"tool": "search", "status": "reported"}]),
        ("missing", []),
        (
            "incorrect-sequence",
            [
                {"tool": "journal.get", "status": "ok"},
                {"tool": "search", "status": "ok"},
            ],
        ),
    ],
)
def test_query_projection_replaces_non_authoritative_output_trace_with_objective_trace(
    monkeypatch, tmp_path, label, output_trace
):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    trace_file = paths["tmp"] / f"{label}.jsonl"
    monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(trace_file))
    objective_tools = ["health", "search", "journal.get"]
    runner = RecordingRunner(
        _query_payload_with_tool_trace(output_trace),
        stdout=_codex_jsonl(
            *(
                _completed_mcp_tool_call("life_index", tool, error=None)
                for tool in objective_tools
            )
        ),
    )

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    expected_trace = [{"tool": tool, "status": "ok"} for tool in objective_tools]
    assert result.reason is None
    assert result.payload["tool_trace"] == expected_trace
    assert [json.loads(line) for line in trace_file.read_text(encoding="utf-8").splitlines()] == [
        {"server": "life_index", "tool": tool, "status": "completed", "success": True}
        for tool in objective_tools
    ]


def test_query_projection_execution_metadata_fails_closed_for_untrusted_objective_records(
    monkeypatch, tmp_path
):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    output_trace = [
        {"tool": "search", "status": "ok"},
        {"tool": "journal.get", "status": "ok"},
    ]
    cases = [
        ("malformed", '{"type":'),
        (
            "foreign-server",
            _codex_jsonl(
                _completed_mcp_tool_call("foreign", "search", error=None),
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
            ),
        ),
        (
            "forbidden-method",
            _codex_jsonl(
                _completed_mcp_tool_call("life_index", "write", error=None),
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
            ),
        ),
        (
            "failed-call",
            _codex_jsonl(
                _completed_mcp_tool_call(
                    "life_index",
                    "search",
                    status="failed",
                    error={"message": "failure-secret"},
                ),
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
            ),
        ),
        (
            "cancelled-call",
            _codex_jsonl(
                _completed_mcp_tool_call("life_index", "search", status="cancelled", error=None),
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
            ),
        ),
        (
            "wrong-order",
            _codex_jsonl(
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
                _completed_mcp_tool_call("life_index", "search", error=None),
            ),
        ),
    ]

    for label, stdout in cases:
        trace_file = paths["tmp"] / f"{label}.jsonl"
        monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(trace_file))
        runner = RecordingRunner(_query_payload_with_tool_trace(output_trace), stdout=stdout)
        result = asyncio.run(
            _adapter(tmp_path, runner).query(
                {"query": "What did I write?"},
                procedure_prompt="Caller procedure asset.",
                source_id="query-procedure-v1",
            )
        )

        assert result.payload["mode"] == "UNAVAILABLE", label
        assert result.reason == "codex-execution-metadata-invalid", label
        assert not trace_file.exists(), label
        assert "failure-secret" not in json.dumps(result.diagnostics)


@pytest.mark.parametrize(
    ("label", "stdout", "output_trace", "expected_metadata_reason", "fail_trace_write"),
    [
        (
            "jsonl-event-invalid",
            '{"raw-jsonl-secret":',
            [
                {"tool": "search", "status": "ok"},
                {"tool": "journal.get", "status": "ok"},
            ],
            "jsonl-event-invalid",
            False,
        ),
        (
            "forbidden-mcp-target",
            _codex_jsonl(
                _completed_mcp_tool_call(
                    "raw-forbidden-server",
                    "search",
                    arguments={
                        "query": "raw-argument-secret",
                        "rel_path": "Journals/raw-private-path.md",
                    },
                    result={"entries": ["raw-result-secret"]},
                    error=None,
                )
            ),
            [
                {"tool": "search", "status": "ok"},
                {"tool": "journal.get", "status": "ok"},
            ],
            "forbidden-mcp-target",
            False,
        ),
        (
            "mcp-call-not-successful",
            _codex_jsonl(
                _completed_mcp_tool_call(
                    "life_index",
                    "search",
                    status="failed",
                    error={"message": "raw-error-secret"},
                )
            ),
            [
                {"tool": "search", "status": "ok"},
                {"tool": "journal.get", "status": "ok"},
            ],
            "mcp-call-not-successful",
            False,
        ),
        (
            "observed-search-journal-order-missing",
            _codex_jsonl(
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
                _completed_mcp_tool_call("life_index", "search", error=None),
            ),
            [
                {"tool": "search", "status": "ok"},
                {"tool": "journal.get", "status": "ok"},
            ],
            "observed-search-journal-order-missing",
            False,
        ),
        (
            "trace-write-failed",
            _codex_jsonl(
                _completed_mcp_tool_call("life_index", "search", error=None),
                _completed_mcp_tool_call("life_index", "journal.get", error=None),
            ),
            [
                {"tool": "search", "status": "ok"},
                {"tool": "journal.get", "status": "ok"},
            ],
            "trace-write-failed",
            True,
        ),
    ],
)
def test_query_projection_execution_metadata_failures_surface_only_safe_classification(
    monkeypatch, tmp_path, label, stdout, output_trace, expected_metadata_reason, fail_trace_write
):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    trace_file = paths["tmp"] / f"{label}.jsonl"
    monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(trace_file))
    if fail_trace_write:
        original_open = adapter.Path.open

        def fail_trace_open(path, mode="r", *args, **kwargs):
            if path == trace_file and mode == "x":
                raise OSError("raw-trace-write-secret")
            return original_open(path, mode, *args, **kwargs)

        monkeypatch.setattr(adapter.Path, "open", fail_trace_open)
    runner = RecordingRunner(_query_payload_with_tool_trace(output_trace), stdout=stdout)

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.payload["mode"] == "UNAVAILABLE", label
    assert result.reason == "codex-execution-metadata-invalid", label
    assert result.diagnostics["stage"] == "codex-execution-metadata", label
    assert result.diagnostics["reason"] == expected_metadata_reason, label
    assert not trace_file.exists(), label
    serialized = json.dumps({"payload": result.payload, "diagnostics": result.diagnostics})
    for secret in (
        "raw-jsonl-secret",
        "raw-forbidden-server",
        "raw-argument-secret",
        "raw-private-path.md",
        "raw-result-secret",
        "raw-error-secret",
        "raw-trace-write-secret",
    ):
        assert secret not in serialized, label


def test_execution_metadata_error_drops_unknown_diagnostic_reason():
    error = adapter._execution_metadata_error("raw-unknown-reason")

    assert error.reason == "codex-execution-metadata-invalid"
    assert adapter._sanitize_adapter_diagnostics(error.diagnostics) == {
        "stage": "codex-execution-metadata",
        "reason": "metadata-classification-internal",
    }
    assert "raw-unknown-reason" not in json.dumps(error.diagnostics)


def test_query_default_runner_strips_ambient_trace_environment(monkeypatch, tmp_path):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    trace_file = paths["tmp"] / "adapter-owned-trace.jsonl"
    monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(trace_file))
    monkeypatch.setenv("LIFE_INDEX_VALIDATION_MODE", "ambient")
    monkeypatch.setenv("LIFE_INDEX_TOOL_CALL_LOG", str(tmp_path / "ambient-log.jsonl"))
    captured: dict[str, object] = {}
    output_trace = [
        {"tool": "search", "status": "ok"},
        {"tool": "journal.get", "status": "ok"},
    ]
    execution_metadata = _codex_jsonl(
        _completed_mcp_tool_call("life_index", "search", error=None),
        _completed_mcp_tool_call("life_index", "journal.get", error=None),
    )

    async def synthetic_default_runner(
        argv, _stdin, _timeout, _cwd=None, *, env=None, capture_stdout=False
    ):
        captured["argv"] = list(argv)
        captured["env"] = dict(env or {})
        captured["capture_stdout"] = capture_stdout
        output_path = Path(argv[argv.index("--output-last-message") + 1])
        output_path.write_text(json.dumps(_query_payload_with_tool_trace(output_trace)), encoding="utf-8")
        return adapter.CodexProcessResult(returncode=0, stdout=execution_metadata)

    monkeypatch.setattr(adapter, "default_async_runner", synthetic_default_runner)
    result = asyncio.run(
        adapter.CodexCLIAdapter(executable="codex", temp_root=tmp_path, timeout_seconds=2).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.reason is None
    assert trace_file.exists()
    assert "LIFE_INDEX_VALIDATION_MODE" not in captured["env"]
    assert "LIFE_INDEX_TOOL_CALL_LOG" not in captured["env"]
    assert captured["capture_stdout"] is True
    assert not any(
        "LIFE_INDEX_VALIDATION_MODE" in value or "LIFE_INDEX_TOOL_CALL_LOG" in value
        for value in _config_values(captured["argv"])
    )


def test_query_projection_rejects_trace_file_outside_the_isolated_tmp_or_evidence_subtree(
    monkeypatch, tmp_path
):
    _configure_query_projection(monkeypatch, tmp_path)
    outside_parent = tmp_path / "outside trace"
    outside_parent.mkdir()
    monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(outside_parent / "tool-calls.jsonl"))
    runner = RecordingRunner(_query_payload())

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "codex-query-projection-trace-file-outside-allowed-subtree"
    assert runner.argv is None


def test_query_projection_rejects_an_existing_trace_target(monkeypatch, tmp_path):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    trace_file = paths["tmp"] / "prior-tool-calls.jsonl"
    trace_file.write_text('{"prior":"evidence"}\n', encoding="utf-8")
    monkeypatch.setenv(QUERY_PROJECTION_ENV["trace"], str(trace_file))
    runner = RecordingRunner(_query_payload())

    result = asyncio.run(
        _adapter(tmp_path, runner).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )

    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "codex-query-projection-trace-file-already-exists"
    assert runner.argv is None


def test_codex_run_directory_cleanup_retries_transient_windows_permission_error(
    monkeypatch, tmp_path
):
    run_dir = tmp_path / "codex-run"
    run_dir.mkdir()
    (run_dir / "output.json").write_text("{}", encoding="utf-8")
    original_rmtree = adapter.shutil.rmtree
    attempts = 0

    def transient_rmtree(path):
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise PermissionError("transient Windows handle")
        return original_rmtree(path)

    monkeypatch.setattr(adapter.shutil, "rmtree", transient_rmtree)
    adapter._remove_run_directory_with_retries(run_dir, attempts=3, delay_seconds=0)

    assert attempts == 3
    assert not run_dir.exists()


def test_default_runner_uses_supplied_cwd_for_the_child_process(tmp_path):
    child_script = tmp_path / "report-cwd.py"
    child_output = tmp_path / "child-cwd.txt"
    run_dir = tmp_path / "isolated-run"
    run_dir.mkdir()
    child_script.write_text(
        "import pathlib, sys\n"
        "pathlib.Path(sys.argv[1]).write_text(pathlib.Path.cwd().as_posix(), encoding='utf-8')\n"
        "print('{\"type\":\"thread.started\"}')\n",
        encoding="utf-8",
    )
    bridge_cwd = Path.cwd().resolve()

    result = asyncio.run(
        adapter.default_async_runner(
            [sys.executable, str(child_script), str(child_output)],
            "",
            2.0,
            cwd=run_dir,
            capture_stdout=True,
        )
    )

    assert result.returncode == 0
    child_cwd = Path(child_output.read_text(encoding="utf-8")).resolve()
    assert child_cwd == run_dir.resolve()
    assert child_cwd != bridge_cwd
    assert result.stdout.strip() == '{"type":"thread.started"}'


def test_bounded_health_reader_caps_output_and_cleans_overflow_process_tree(
    monkeypatch, tmp_path
):
    cap = 64
    monkeypatch.setattr(adapter, "MAX_HEALTH_VERSION_OUTPUT_BYTES", cap)
    child_script = tmp_path / "overflow-health-child.py"
    child_pid = tmp_path / "health-child.pid"
    grandchild_pid = tmp_path / "health-grandchild.pid"
    child_script.write_text(
        "import os, pathlib, subprocess, sys, time\n"
        "child_pid = pathlib.Path(sys.argv[1])\n"
        "grandchild_pid = pathlib.Path(sys.argv[2])\n"
        "child_pid.write_text(str(os.getpid()))\n"
        "grandchild = subprocess.Popen([sys.executable, '-c', "
        "'import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(str(__import__(\"os\").getpid())); "
        "[(sys.stdout.buffer.write(b\"x\" * 4096), sys.stdout.flush()) for _ in iter(int, 1)]', "
        "str(grandchild_pid)])\n"
        "while not grandchild_pid.exists(): time.sleep(0.01)\n"
        "while True:\n"
        "    sys.stdout.buffer.write(b'x' * 4096)\n"
        "    sys.stdout.flush()\n",
        encoding="utf-8",
    )
    try:
        result = adapter._bounded_health_command(
            [sys.executable, str(child_script), str(child_pid), str(grandchild_pid)],
            output_limit=cap,
            timeout=1.5,
        )
    finally:
        _kill_tree_for_test(child_pid)
        _kill_tree_for_test(grandchild_pid)

    assert result.overflowed is True
    assert result.timed_out is False
    assert result.reason == "version-output-too-large"
    assert len(result.stdout) == cap + 1
    assert not _pid_alive(child_pid)
    assert not _pid_alive(grandchild_pid)


def test_bounded_health_version_timeout_terminates_process_tree_without_pipe_deadlock(
    tmp_path,
):
    script, child_pid, grandchild_pid = _write_tree_child(tmp_path)
    started = time.perf_counter()
    try:
        result = adapter._bounded_health_command(
            [sys.executable, str(script), str(child_pid), str(grandchild_pid)],
            output_limit=adapter.MAX_HEALTH_VERSION_OUTPUT_BYTES,
            timeout=1.0,
            reason_prefix="version",
        )
    finally:
        _kill_tree_for_test(child_pid)
        _kill_tree_for_test(grandchild_pid)

    assert time.perf_counter() - started < 3.0
    assert result.timed_out is True
    assert result.overflowed is False
    assert result.reason == "version-command-timeout"
    assert not _pid_alive(child_pid)
    assert not _pid_alive(grandchild_pid)


def test_bounded_health_login_timeout_uses_devnull_and_terminates_process_tree(
    tmp_path,
):
    script, child_pid, grandchild_pid = _write_tree_child(tmp_path)
    started = time.perf_counter()
    try:
        result = adapter._bounded_health_command(
            [sys.executable, str(script), str(child_pid), str(grandchild_pid)],
            output_limit=0,
            timeout=1.0,
            capture_stdout=False,
            reason_prefix="login-status",
            timeout_reason="login-status-timeout",
            error_reason="login-status-error",
        )
    finally:
        _kill_tree_for_test(child_pid)
        _kill_tree_for_test(grandchild_pid)

    assert time.perf_counter() - started < 3.0
    assert result.timed_out is True
    assert result.overflowed is False
    assert result.reason == "login-status-timeout"
    assert result.stdout == b""
    assert not _pid_alive(child_pid)
    assert not _pid_alive(grandchild_pid)


def test_bounded_health_version_reads_split_output_before_accepting_prefix(
    monkeypatch, tmp_path
):
    cap = 64
    monkeypatch.setattr(adapter, "MAX_HEALTH_VERSION_OUTPUT_BYTES", cap)
    monkeypatch.setattr(adapter, "HEALTH_COMMAND_TIMEOUT_SECONDS", 2.0)
    script = tmp_path / "split-version.py"
    script.write_text(
        "import sys, time\n"
        "sys.stdout.write('codex-cli 0.144.1\\n')\n"
        "sys.stdout.flush()\n"
        "time.sleep(0.2)\n"
        "sys.stdout.write('x' * 128)\n"
        "sys.stdout.flush()\n",
        encoding="utf-8",
    )
    real_bounded_health_command = adapter._bounded_health_command
    observed: dict[str, object] = {}

    def run_split_command(argv, **kwargs):
        result = real_bounded_health_command(
            [sys.executable, str(script), *argv[1:]], **kwargs
        )
        observed["result"] = result
        return result

    monkeypatch.setattr(adapter, "_bounded_health_command", run_split_command)
    status = adapter._health_version_check("synthetic-codex")

    result = observed["result"]
    assert result.reason == "version-output-too-large"
    assert result.overflowed is True
    assert status == ("not-ready", "version-output-too-large")


def test_schema_projection_is_generated_and_lints_closed_structured_output_shape():
    query_schema = adapter.build_codex_schema(HostAgentQueryResponseV1)
    metadata_schema = adapter.build_codex_schema(HostAgentMetadataProposalV1)

    adapter.lint_codex_schema(query_schema)
    adapter.lint_codex_schema(metadata_schema)
    assert query_schema["type"] == "object"
    assert query_schema["additionalProperties"] is False
    assert metadata_schema["additionalProperties"] is False
    assert query_schema["properties"]["tool_trace"]["items"]["additionalProperties"] is False
    assert metadata_schema["properties"]["fields"]["additionalProperties"] is not True


def test_metadata_schema_projection_exposes_exact_plural_v1_field_contract():
    schema = adapter.build_codex_schema(HostAgentMetadataProposalV1)
    fields_schema = schema["properties"]["fields"]
    canonical_fields = ["title", "abstract", "project", "topics", "moods", "people", "tags", "links"]

    assert fields_schema["type"] == "object"
    assert fields_schema["additionalProperties"] is False
    assert list(fields_schema["properties"]) == canonical_fields
    assert fields_schema["required"] == canonical_fields
    assert "weather" not in fields_schema["properties"]


def test_codex_metadata_output_with_unknown_weather_field_maps_to_unavailable(tmp_path):
    payload = _metadata_payload()
    payload["fields"] = {
        **payload["fields"],
        "weather": {"value": "sunny"},
    }
    runner = RecordingRunner(payload)

    result = asyncio.run(
        _adapter(tmp_path, runner).metadata(
            {"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
            procedure_prompt="Caller metadata procedure.",
            source_id="metadata-procedure-v1",
        )
    )

    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "host-agent-envelope-invalid"
    assert result.payload["fields"] == {}


def test_codex_metadata_output_v2_maps_to_unavailable_without_repair(tmp_path):
    payload = _metadata_payload()
    payload["schema_version"] = "gui.host_agent.metadata_proposal.v2"
    runner = RecordingRunner(payload)

    result = asyncio.run(
        _adapter(tmp_path, runner).metadata(
            {"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
            procedure_prompt="Caller metadata procedure.",
            source_id="metadata-procedure-v1",
        )
    )

    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "host-agent-envelope-invalid"
    assert result.payload["fields"] == {}


def test_schema_projection_preserves_property_named_title_and_validates_grounded_payload():
    schema = adapter.build_codex_schema(HostAgentQueryResponseV1)

    evidence_schema = schema["$defs"]["EvidenceItem"]
    assert "title" in evidence_schema["properties"]
    assert "title" in evidence_schema["required"]
    adapter.validate_projected_payload(schema, _query_payload())


@pytest.mark.parametrize(
    "mutation",
    [
        lambda schema: schema.update({"anyOf": []}),
        lambda schema: schema["properties"].update({"bad": {"type": "object"}}),
        lambda schema: schema.update({"additionalProperties": True}),
        lambda schema: schema.update({"allOf": []}),
        lambda schema: schema.update({"oneOf": []}),
        lambda schema: schema.update({"not": {"type": "string"}}),
        lambda schema: schema.update({"if": {}, "then": {}, "else": {}}),
        lambda schema: schema.update({"dependentRequired": {}}),
        lambda schema: schema.update({"patternProperties": {}}),
    ],
)
def test_schema_lint_rejects_unsupported_or_open_shapes(mutation):
    schema = adapter.build_codex_schema(HostAgentQueryResponseV1)
    mutation(schema)
    with pytest.raises(adapter.CodexAdapterError):
        adapter.lint_codex_schema(schema)


def test_schema_lint_rejects_unknown_keywords_and_invalid_unreferenced_definitions():
    schema = adapter.build_codex_schema(HostAgentQueryResponseV1)
    schema["$defs"]["Unused"] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"title": {"type": "string"}},
        "required": ["title"],
        "x-unknown-keyword": True,
    }
    with pytest.raises(adapter.CodexAdapterError):
        adapter.lint_codex_schema(schema)


def test_schema_lint_enforces_depth_and_total_property_limits():
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
        "required": [],
    }
    cursor = schema
    for _ in range(11):
        child = {
            "type": "object",
            "additionalProperties": False,
            "properties": {},
            "required": [],
        }
        cursor["properties"] = {"nested": child}
        cursor["required"] = ["nested"]
        cursor = child
    with pytest.raises(adapter.CodexAdapterError):
        adapter.lint_codex_schema(schema)

    wide = {
        "type": "object",
        "additionalProperties": False,
        "properties": {f"field_{index}": {"type": "string"} for index in range(5001)},
        "required": [f"field_{index}" for index in range(5001)],
    }
    with pytest.raises(adapter.CodexAdapterError):
        adapter.lint_codex_schema(wide)

    schema = adapter.build_codex_schema(HostAgentQueryResponseV1)
    schema["$defs"]["Unused"] = {"$ref": "#/$defs/DoesNotExist"}
    with pytest.raises(adapter.CodexAdapterError):
        adapter.lint_codex_schema(schema)


def test_explicit_adapter_selection_is_fail_closed_and_never_infers_from_argv(monkeypatch):
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", raising=False)
    assert adapter.adapter_kind() == "reference-command"
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex")
    with pytest.raises(adapter.CodexAdapterError):
        adapter.adapter_kind()
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    assert adapter.adapter_kind() == "codex-cli"


def test_prompt_and_request_assembly_is_key_order_deterministic():
    prompt_a, _ = adapter.assemble_prompt(
        "Caller procedure.",
        {"query": "q", "context": {"b": 2, "a": 1}},
        source_id="caller",
        schema_family="gui.host_agent.query_response.v1",
    )
    prompt_b, _ = adapter.assemble_prompt(
        "Caller procedure.",
        {"context": {"a": 1, "b": 2}, "query": "q"},
        source_id="caller",
        schema_family="gui.host_agent.query_response.v1",
    )
    assert prompt_a == prompt_b
    assert "evidence.id must be the exact successful journal.get rel_path" in prompt_a
    assert "never invent citation labels" in prompt_a
    assert "tool_trace.tool must be an exact registry method id" not in prompt_a


def test_prompt_asset_is_required_and_truncation_is_deterministic_without_redaction_leaks(tmp_path):
    runner = RecordingRunner(_query_payload())
    instance = _adapter(tmp_path, runner)
    long_prompt = "procedure-secret " * (adapter.MAX_PROCEDURE_PROMPT_CHARS + 20)

    result = asyncio.run(
        instance.query(
            {"query": "query-secret"},
            procedure_prompt=long_prompt,
            source_id="caller-query-procedure",
        )
    )

    assert result.diagnostics["truncated"] is True
    assert "[procedure truncated]" in runner.stdin
    assert "query-secret" not in json.dumps(result.diagnostics)
    assert "procedure-secret" not in json.dumps(result.diagnostics)
    assert result.diagnostics["input_length"] == len(long_prompt)
    assert result.diagnostics["retained_length"] == adapter.MAX_PROCEDURE_PROMPT_CHARS


def test_output_file_is_only_domain_channel_and_malformed_variants_fail_closed(tmp_path):
    stdout_secret = '{"mode":"UNAVAILABLE","summary":"stdout-domain-secret"}'
    valid = asyncio.run(
        _adapter(tmp_path, RecordingRunner(_query_payload(), stdout=stdout_secret)).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )
    assert valid.payload["mode"] == "GROUNDED"
    assert valid.payload["answer"]["summary"] == "One synthetic journal entry."
    assert "stdout-domain-secret" not in json.dumps(valid.payload)
    assert "stdout-domain-secret" not in json.dumps(valid.diagnostics)

    malformed = [
        None,
        "",
        "not json",
        "```json\n" + json.dumps(_query_payload()) + "\n```",
        "prefix " + json.dumps(_query_payload()),
    ]
    for output in malformed:
        runner = RecordingRunner(output)
        result = asyncio.run(
            _adapter(tmp_path, runner).query(
                {"query": "What did I write?"},
                procedure_prompt="Caller procedure asset.",
                source_id="query-procedure-v1",
            )
        )
        assert result.payload["mode"] == "UNAVAILABLE"
        assert result.reason == "host-agent-envelope-invalid"


def test_timeout_cancellation_cleanup_and_partial_output_are_never_accepted(tmp_path):
    async def cancelled_runner(argv: list[str], stdin: str, timeout: float, cwd: str | Path):
        output_path = Path(argv[argv.index("--output-last-message") + 1])
        output_path.write_text(json.dumps(_query_payload()), encoding="utf-8")
        raise asyncio.TimeoutError

    instance = adapter.CodexCLIAdapter(
        executable="codex",
        runner=cancelled_runner,
        temp_root=tmp_path,
        timeout_seconds=0.01,
    )
    result = asyncio.run(
        instance.query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure asset.",
            source_id="query-procedure-v1",
        )
    )
    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "codex-timeout"
    assert list(tmp_path.iterdir()) == []


def test_metadata_projection_omits_only_explicit_null_field_slots(tmp_path):
    wire_payload = _metadata_payload()
    wire_payload["fields"] = {key: (wire_payload["fields"].get(key) if key == "project" else None) for key in adapter.SUPPORTED_METADATA_FIELDS}
    runner = RecordingRunner(wire_payload)
    result = asyncio.run(
        _adapter(tmp_path, runner).metadata(
            {"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
            procedure_prompt="Caller metadata procedure.",
            source_id="metadata-procedure-v1",
        )
    )
    assert result.payload["mode"] == "PROPOSED"
    assert set(result.payload["fields"]) == {"project"}
    assert result.payload["policy"] == {"preserve_user_fields": True}


@pytest.mark.parametrize(
    "fields,policy",
    [
        ({}, {"preserve_user_fields": True}),
        ({"title": None}, {"preserve_user_fields": True}),
        ({"title": None, "abstract": None, "topic": None, "mood": None, "tags": None, "people": None, "project": None, "links": None}, {}),
    ],
)
def test_metadata_projection_validates_all_modes_before_null_omission(tmp_path, fields, policy):
    payload = _metadata_payload()
    payload["mode"] = "UNAVAILABLE"
    payload["fields"] = fields
    payload["policy"] = policy
    runner = RecordingRunner(payload)
    result = asyncio.run(
        _adapter(tmp_path, runner).metadata(
            {"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
            procedure_prompt="Caller metadata procedure.",
            source_id="metadata-procedure-v1",
        )
    )
    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "host-agent-envelope-invalid"


def test_prompt_asset_has_bounded_binary_read_and_rejects_invalid_or_oversized_assets(tmp_path):
    oversized = tmp_path / "oversized-procedure.txt"
    oversized.write_bytes(b"x" * (adapter.MAX_PROMPT_FILE_BYTES + 1))
    with pytest.raises(adapter.CodexAdapterError) as error:
        adapter.load_configured_prompt_path(oversized)
    assert error.value.reason == "codex-prompt-asset-too-large"

    invalid = tmp_path / "invalid-procedure.txt"
    invalid.write_bytes(b"\xff\xfe")
    with pytest.raises(adapter.CodexAdapterError) as error:
        adapter.load_configured_prompt_path(invalid)
    assert error.value.reason == "codex-prompt-asset-unavailable"


def test_prompt_loader_and_health_probe_reject_non_regular_files_before_open(
    monkeypatch, tmp_path
):
    prompt_dir = tmp_path / "prompt-directory"
    prompt_dir.mkdir()
    original_open = Path.open
    opened = False

    def tracking_open(self, *args, **kwargs):
        nonlocal opened
        opened = True
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", tracking_open)
    with pytest.raises(adapter.CodexAdapterError) as error:
        adapter.load_configured_prompt_path(prompt_dir)
    assert error.value.reason == "codex-prompt-asset-unavailable"
    assert adapter.probe_configured_prompt_path(prompt_dir) == "codex-prompt-asset-unavailable"
    assert opened is False


@pytest.mark.parametrize("raw", ["inf", "-inf", "nan", "999999999"])
def test_timeout_configuration_is_finite_and_bounded(monkeypatch, raw):
    monkeypatch.setenv("LIFE_INDEX_CODEX_TIMEOUT_SECONDS", raw)
    value = adapter.configured_timeout_seconds()
    assert adapter.MIN_TIMEOUT_SECONDS <= value <= adapter.MAX_TIMEOUT_SECONDS
    assert value != float("inf")
    assert value == value

    instance = adapter.CodexCLIAdapter(timeout_seconds=float("inf"), runner=RecordingRunner(None))
    assert adapter.MIN_TIMEOUT_SECONDS <= instance.timeout_seconds <= adapter.MAX_TIMEOUT_SECONDS


def test_source_and_selection_diagnostics_are_opaque_and_sanitized(monkeypatch):
    with pytest.raises(adapter.CodexAdapterError) as error:
        adapter.adapter_kind("secret-token=C:\\Users\\owner\\journal")
    assert error.value.diagnostics == {}

    _prompt, diagnostics = adapter.assemble_prompt(
        "Caller procedure.",
        {"query": "secret query"},
        source_id="../../secret-token",
        schema_family="gui.host_agent.query_response.v1",
    )
    assert diagnostics["source_id"] == "configured-procedure"


def test_temp_root_setup_failure_is_structured_and_fail_closed(tmp_path):
    temp_root = tmp_path / "not-a-directory"
    temp_root.write_text("occupied", encoding="utf-8")
    result = asyncio.run(
        adapter.CodexCLIAdapter(
            executable="codex", temp_root=temp_root, runner=RecordingRunner(_query_payload())
        ).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure.",
            source_id="query-procedure-v1",
        )
    )
    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "codex-temp-unavailable"


def test_runner_error_is_structured_and_temporary_run_is_cleaned(tmp_path):
    async def raising_runner(_argv: list[str], _stdin: str, _timeout: float, _cwd: str | Path):
        raise RuntimeError("secret runner failure")

    result = asyncio.run(
        adapter.CodexCLIAdapter(
            executable="codex", temp_root=tmp_path, runner=raising_runner
        ).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure.",
            source_id="query-procedure-v1",
        )
    )
    assert result.payload["mode"] == "UNAVAILABLE"
    assert result.reason == "codex-process-unavailable"
    assert list(tmp_path.iterdir()) == []


def test_typed_runner_error_diagnostics_are_narrowed_at_adapter_boundary(tmp_path):
    secret_path = str(tmp_path / "private-prompt.txt")
    secret_body = "stderr contains PRIVATE JOURNAL CONTENT"

    async def raising_runner(_argv: list[str], _stdin: str, _timeout: float, _cwd: str | Path):
        raise adapter.CodexAdapterError(
            "codex-process-failed",
            diagnostics={
                "stage": "codex-process",
                "reason": "codex-process-failed",
                "returncode": 1,
                "prompt_path": secret_path,
                "stderr": secret_body,
            },
        )

    result = asyncio.run(
        adapter.CodexCLIAdapter(
            executable="codex", temp_root=tmp_path, runner=raising_runner
        ).query(
            {"query": "What did I write?"},
            procedure_prompt="Caller procedure.",
            source_id="query-procedure-v1",
        )
    )
    assert result.reason == "codex-process-failed"
    assert result.diagnostics["stage"] == "codex-process"
    assert result.diagnostics["returncode"] == 1
    assert secret_path not in json.dumps(result.diagnostics)
    assert secret_body not in json.dumps(result.diagnostics)


def _write_tree_child(tmp_path: Path) -> tuple[Path, Path, Path]:
    script = tmp_path / "synthetic_tree_child.py"
    child_pid = tmp_path / "child.pid"
    grandchild_pid = tmp_path / "grandchild.pid"
    script.write_text(
        "import os, pathlib, subprocess, sys, time\n"
        "child_pid = pathlib.Path(sys.argv[1])\n"
        "grandchild_pid = pathlib.Path(sys.argv[2])\n"
        "child_pid.write_text(str(os.getpid()))\n"
        "grandchild = subprocess.Popen([sys.executable, '-c', "
        "'import os,pathlib,sys,time; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(30)', str(grandchild_pid)])\n"
        "while not grandchild_pid.exists(): time.sleep(0.01)\n"
        "while True: time.sleep(0.1)\n",
        encoding="utf-8",
    )
    return script, child_pid, grandchild_pid


def _pid_alive(pid_text: Path) -> bool:
    if not pid_text.exists():
        return False
    try:
        pid = int(pid_text.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    if os.name == "nt":
        completed = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True,
            text=True,
            check=False,
        )
        return str(pid) in completed.stdout
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _kill_tree_for_test(pid_text: Path) -> None:
    if not pid_text.exists():
        return
    try:
        pid = int(pid_text.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except OSError:
            pass


def test_synthetic_timeout_terminates_process_tree_without_pipe_deadlock(tmp_path):
    script, child_pid, grandchild_pid = _write_tree_child(tmp_path)
    started = time.perf_counter()
    try:
        result = asyncio.run(
            asyncio.wait_for(
                adapter.default_async_runner(
                    [sys.executable, str(script), str(child_pid), str(grandchild_pid)],
                    "",
                    0.2,
                ),
                timeout=3.0,
            )
        )
    finally:
        _kill_tree_for_test(child_pid)
        _kill_tree_for_test(grandchild_pid)
    assert time.perf_counter() - started < 3.0
    assert result.timed_out is True
    assert not _pid_alive(child_pid)
    assert not _pid_alive(grandchild_pid)


def test_synthetic_cancellation_terminates_process_tree_and_rethrows_bounded(tmp_path):
    script, child_pid, grandchild_pid = _write_tree_child(tmp_path)

    async def run_and_cancel():
        task = asyncio.create_task(
            adapter.default_async_runner(
                [sys.executable, str(script), str(child_pid), str(grandchild_pid)],
                "",
                30.0,
            )
        )
        for _ in range(40):
            if child_pid.exists() and grandchild_pid.exists():
                break
            await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, timeout=3.0)

    try:
        asyncio.run(run_and_cancel())
    finally:
        _kill_tree_for_test(child_pid)
        _kill_tree_for_test(grandchild_pid)
    assert not _pid_alive(child_pid)
    assert not _pid_alive(grandchild_pid)


def test_bridge_query_and_metadata_use_explicit_codex_kind(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    assert adapter.adapter_kind() == "codex-cli"
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "reference-command")
    assert adapter.adapter_kind() == "reference-command"


def test_server_codex_selection_maps_query_and_metadata_without_touching_reference_runtime(
    monkeypatch, tmp_path
):
    from host_agent_bridge import server

    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", "synthetic-codex")

    class FakeAdapter:
        def __init__(self, **_kwargs):
            pass

        async def query(self, request, **_kwargs):
            return adapter.CodexAdapterResult(_query_payload(), None, {"stage": "synthetic"})

        async def metadata(self, request, **_kwargs):
            return adapter.CodexAdapterResult(_metadata_payload(), None, {"stage": "synthetic"})

    monkeypatch.setattr(server, "CodexCLIAdapter", FakeAdapter)
    client = TestClient(server.app)

    query_response = client.post("/query/stream", json={"query": "What did I write?"})
    assert query_response.status_code == 200
    assert [line for line in query_response.text.splitlines() if line.startswith("event:")] == [
        "event: status",
        "event: final",
    ]
    assert '"mode":"GROUNDED"' in query_response.text

    metadata_response = client.post(
        "/metadata/propose",
        json={"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
    )
    assert metadata_response.status_code == 200
    assert metadata_response.json()["mode"] == "PROPOSED"


def test_server_invalid_adapter_kind_fails_closed_before_runtime_or_prompt(monkeypatch):
    from host_agent_bridge import server

    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ARGV_JSON", json.dumps(["python", "fake-runtime"]))
    client = TestClient(server.app)
    health = client.get("/health").json()
    assert health["mode"] == "UNAVAILABLE"
    assert health["reason"] == "host-agent-adapter-kind-invalid"
    response = client.post("/query/stream", json={"query": "What did I write?"})
    assert '"reason":"host-agent-adapter-kind-invalid"' in response.text


def test_server_named_adapter_canonical_validates_and_redacts_result_diagnostics(
    monkeypatch, tmp_path
):
    from host_agent_bridge import server

    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", sys.executable)

    class FakeAdapter:
        def __init__(self, **_kwargs):
            pass

        async def query(self, request, **_kwargs):
            return adapter.CodexAdapterResult(
                {
                    "mode": "GROUNDED",
                    "query": "malformed",
                    "diagnostics": {"secret": "QUERY PAYLOAD SECRET"},
                },
                None,
                {"prompt": "QUERY SECRET", "stderr": "STDERR SECRET", "stage": "synthetic"},
            )

    monkeypatch.setattr(server, "CodexCLIAdapter", FakeAdapter)
    response = TestClient(server.app).post("/query/stream", json={"query": "What did I write?"})
    assert response.status_code == 200
    assert '"mode":"UNAVAILABLE"' in response.text
    assert '"reason":"host-agent-envelope-invalid"' in response.text
    assert "QUERY SECRET" not in response.text
    assert "STDERR SECRET" not in response.text
    assert "QUERY PAYLOAD SECRET" not in response.text


def test_server_named_metadata_adapter_redacts_typed_error_diagnostics(monkeypatch, tmp_path):
    from host_agent_bridge import server

    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", sys.executable)

    class FakeAdapter:
        def __init__(self, **_kwargs):
            pass

        async def metadata(self, _request, **_kwargs):
            raise adapter.CodexAdapterError(
                "codex-process-failed",
                diagnostics={
                    "stage": "codex-process",
                    "reason": "codex-process-failed",
                    "prompt_path": str(tmp_path / "private-prompt.txt"),
                    "stderr": "PRIVATE METADATA STDERR",
                },
            )

    monkeypatch.setattr(server, "CodexCLIAdapter", FakeAdapter)
    response = TestClient(server.app).post(
        "/metadata/propose",
        json={"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "UNAVAILABLE"
    assert response.json()["reason"] == "codex-process-failed"
    assert "private-prompt.txt" not in response.text
    assert "PRIVATE METADATA STDERR" not in response.text


def test_server_codex_query_rejects_non_json_serializable_additive_payload(
    monkeypatch, tmp_path
):
    from host_agent_bridge import server

    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", sys.executable)

    class FakeAdapter:
        def __init__(self, **_kwargs):
            pass

        async def query(self, _request, **_kwargs):
            payload = _query_payload()
            payload["future_extra"] = object()
            return adapter.CodexAdapterResult(payload, None, {"stage": "synthetic"})

    monkeypatch.setattr(server, "CodexCLIAdapter", FakeAdapter)
    response = TestClient(server.app, raise_server_exceptions=False).post(
        "/query/stream", json={"query": "What did I write?"}
    )
    assert response.status_code == 200
    assert [line for line in response.text.splitlines() if line.startswith("event:")] == [
        "event: status",
        "event: final",
    ]
    assert '"mode":"UNAVAILABLE"' in response.text
    assert '"reason":"host-agent-envelope-invalid"' in response.text


def test_server_codex_metadata_rejects_non_json_serializable_additive_payload(
    monkeypatch, tmp_path
):
    from host_agent_bridge import server

    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", sys.executable)

    class FakeAdapter:
        def __init__(self, **_kwargs):
            pass

        async def metadata(self, _request, **_kwargs):
            payload = _metadata_payload()
            payload["future_extra"] = object()
            return adapter.CodexAdapterResult(payload, None, {"stage": "synthetic"})

    monkeypatch.setattr(server, "CodexCLIAdapter", FakeAdapter)
    response = TestClient(server.app, raise_server_exceptions=False).post(
        "/metadata/propose",
        json={"draft": {"content": "Draft"}, "policy": {"preserve_user_fields": True}},
    )
    assert response.status_code == 200
    assert response.json()["mode"] == "UNAVAILABLE"
    assert response.json()["reason"] == "host-agent-envelope-invalid"


def test_codex_health_requires_discoverable_executable_and_marks_d4_acceptance_unverified(
    monkeypatch, tmp_path
):
    from host_agent_bridge import server

    fake_executable = tmp_path / "existing-but-not-runnable"
    fake_executable.write_text("not an executable", encoding="utf-8")
    query_prompt, metadata_prompt = _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", str(fake_executable))
    monkeypatch.setattr(adapter.shutil, "which", lambda _value: None)
    payload = server.codex_health_payload()
    assert payload["ready"] is False

    monkeypatch.setattr(adapter.shutil, "which", lambda _value: sys.executable)

    def fake_run(argv, **_kwargs):
        if argv[1:] == ["--version"]:
            return adapter._BoundedHealthCommandResult(0, b"codex-cli 0.144.1", False, False, None)
        if argv[1:] == ["login", "status"]:
            return adapter._BoundedHealthCommandResult(0, b"", False, False, None)
        if argv[0] == os.environ[QUERY_PROJECTION_ENV["python"]]:
            return adapter._BoundedHealthCommandResult(
                0, _projection_preflight_payload(ok=True), False, False, None
            )
        raise AssertionError(argv)

    monkeypatch.setattr(
        adapter,
        "_bounded_health_command",
        fake_run,
    )
    payload = server.codex_health_payload()
    assert payload["ready"] is True
    acceptance = next(check for check in payload["checks"] if check["name"] == "codex_schema_acceptance")
    assert acceptance["status"] == "unverified"
    assert acceptance["reason"] == "live-model-invocation-advisory-unverified"
    assert payload["reason"] == "configured-runtime-preflight-passed"


def test_codex_health_reports_query_tool_channel_readiness_without_paths(monkeypatch, tmp_path):
    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", "synthetic-codex")
    monkeypatch.setattr(adapter.shutil, "which", lambda _value: "synthetic-codex")

    def fake_run(argv, **_kwargs):
        if argv[1:] == ["--version"]:
            return adapter._BoundedHealthCommandResult(0, b"codex-cli 0.144.1", False, False, None)
        if argv[1:] == ["login", "status"]:
            return adapter._BoundedHealthCommandResult(0, b"", False, False, None)
        if argv[0] == os.environ[QUERY_PROJECTION_ENV["python"]]:
            return adapter._BoundedHealthCommandResult(
                0, _projection_preflight_payload(ok=True), False, False, None
            )
        raise AssertionError(argv)

    monkeypatch.setattr(
        adapter,
        "_bounded_health_command",
        fake_run,
    )

    ready = adapter.codex_health_payload()
    ready_checks = {check["name"]: check for check in ready["checks"]}
    assert ready_checks["query_tool_channel"]["status"] == "ok"
    assert ready["ready"] is True
    assert str(tmp_path) not in json.dumps(ready, ensure_ascii=False)

    monkeypatch.setenv(QUERY_PROJECTION_ENV["data"], "relative-data")
    unavailable = adapter.codex_health_payload()
    unavailable_checks = {check["name"]: check for check in unavailable["checks"]}
    assert unavailable_checks["query_tool_channel"] == {
        "name": "query_tool_channel",
        "status": "not-ready",
        "reason": "codex-query-projection-data-dir-not-absolute",
    }
    assert unavailable["ready"] is False
    assert str(tmp_path) not in json.dumps(unavailable, ensure_ascii=False)


_PROJECTION_PREFLIGHT_SCHEMA = "life-index.codex-projection-preflight.v1"


def _projection_preflight_payload(
    *,
    ok: bool,
    reason: str | None = None,
    life_index_version: str = "1.5.1",
    mcp_version: str = "1.27.2",
) -> bytes:
    if ok:
        payload = {
            "schema_version": _PROJECTION_PREFLIGHT_SCHEMA,
            "ok": True,
            "life_index_version": life_index_version,
            "mcp_version": mcp_version,
        }
    else:
        payload = {
            "schema_version": _PROJECTION_PREFLIGHT_SCHEMA,
            "ok": False,
            "reason": reason,
        }
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def _projection_tree_snapshot(paths: dict[str, Path]) -> dict[str, list[tuple[str, bytes]]]:
    snapshot: dict[str, list[tuple[str, bytes]]] = {}
    for name in ("data", "config", "cache", "tmp"):
        root = paths[name]
        snapshot[name] = sorted(
            (item.relative_to(root).as_posix(), item.read_bytes())
            for item in root.rglob("*")
            if item.is_file()
        )
    return snapshot


def _health_payload_with_projection_result(monkeypatch, tmp_path: Path, preflight_result):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", "synthetic-codex")
    monkeypatch.setattr(adapter.shutil, "which", lambda _value: "synthetic-codex")
    projection_environments: list[dict[str, str]] = []

    def fake_run(argv, **kwargs):
        if argv[1:] == ["--version"]:
            return adapter._BoundedHealthCommandResult(
                0, b"codex-cli 0.144.1", False, False, None
            )
        if argv[1:] == ["login", "status"]:
            return adapter._BoundedHealthCommandResult(0, b"", False, False, None)
        if argv[0] == str(paths["python"]):
            projection_environments.append(dict(kwargs["env"]))
            return preflight_result
        raise AssertionError(argv)

    monkeypatch.setattr(adapter, "_bounded_health_command", fake_run)
    return adapter.codex_health_payload(), paths, projection_environments


def test_projection_preflight_environment_retains_only_windows_systemroot(monkeypatch, tmp_path):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    projection = adapter.configured_query_projection()
    monkeypatch.setenv("SYSTEMROOT", r"C:\Windows")
    monkeypatch.setenv("HOME", "ambient-home")
    monkeypatch.setenv("USERPROFILE", "ambient-profile")
    monkeypatch.setenv("PATH", "ambient-path")
    monkeypatch.setenv("PYTHONPATH", "ambient-python-path")
    monkeypatch.setenv("APPDATA", "ambient-appdata")
    monkeypatch.setenv("LOCALAPPDATA", "ambient-localappdata")
    monkeypatch.setenv("XDG_DATA_HOME", "ambient-xdg-data")
    monkeypatch.setenv("XDG_CONFIG_HOME", "ambient-xdg-config")
    monkeypatch.setenv("XDG_CACHE_HOME", "ambient-xdg-cache")
    monkeypatch.setattr(adapter.os, "name", "nt")

    environment = adapter._projection_preflight_environment(projection)

    assert environment == {
        "LIFE_INDEX_DATA_DIR": str(paths["data"]),
        "XDG_CONFIG_HOME": str(paths["config"]),
        "XDG_CACHE_HOME": str(paths["cache"]),
        "TMPDIR": str(paths["tmp"]),
        "TMP": str(paths["tmp"]),
        "TEMP": str(paths["tmp"]),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "SYSTEMROOT": r"C:\Windows",
    }
    assert {
        "HOME",
        "USERPROFILE",
        "PATH",
        "PYTHONPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_DATA_HOME",
    }.isdisjoint(environment)


def test_codex_health_executes_a_strict_installed_projection_preflight_without_writes(
    monkeypatch, tmp_path
):
    expected = adapter._BoundedHealthCommandResult(
        0, _projection_preflight_payload(ok=True), False, False, None
    )
    monkeypatch.setenv("SYSTEMROOT", r"C:\Windows")
    monkeypatch.setenv("HOME", "ambient-home")
    monkeypatch.setenv("USERPROFILE", "ambient-profile")
    monkeypatch.setenv("PATH", "ambient-path")
    monkeypatch.setenv("PYTHONPATH", "ambient-python-path")
    monkeypatch.setenv("APPDATA", "ambient-appdata")
    monkeypatch.setenv("LOCALAPPDATA", "ambient-localappdata")
    monkeypatch.setenv("XDG_DATA_HOME", "ambient-xdg-data")
    monkeypatch.setenv("XDG_CONFIG_HOME", "ambient-xdg-config")
    monkeypatch.setenv("XDG_CACHE_HOME", "ambient-xdg-cache")
    before = _projection_tree_snapshot(_configure_query_projection(monkeypatch, tmp_path))
    payload, paths, projection_environments = _health_payload_with_projection_result(
        monkeypatch, tmp_path, expected
    )

    checks = {check["name"]: check for check in payload["checks"]}
    assert checks["query_tool_channel"] == {
        "name": "query_tool_channel",
        "status": "ok",
        "reason": "installed-projection-ready",
    }
    assert payload["ready"] is True
    assert payload["reason"] == "configured-runtime-preflight-passed"
    assert _projection_tree_snapshot(paths) == before
    expected_environment = {
        "LIFE_INDEX_DATA_DIR": str(paths["data"]),
        "XDG_CONFIG_HOME": str(paths["config"]),
        "XDG_CACHE_HOME": str(paths["cache"]),
        "TMPDIR": str(paths["tmp"]),
        "TMP": str(paths["tmp"]),
        "TEMP": str(paths["tmp"]),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
    }
    if os.name == "nt":
        expected_environment["SYSTEMROOT"] = r"C:\Windows"
    assert projection_environments == [expected_environment]
    assert {
        "HOME",
        "USERPROFILE",
        "PATH",
        "PYTHONPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_DATA_HOME",
    }.isdisjoint(projection_environments[0])
    assert str(tmp_path) not in json.dumps(payload, ensure_ascii=False)


def test_installed_projection_preflight_uses_isolated_python_mode(monkeypatch, tmp_path):
    paths = _configure_query_projection(monkeypatch, tmp_path)
    observed: list[list[str]] = []

    def fake_run(argv, **_kwargs):
        observed.append(list(argv))
        return adapter._BoundedHealthCommandResult(
            0, _projection_preflight_payload(ok=True), False, False, None
        )

    monkeypatch.setattr(adapter, "_bounded_health_command", fake_run)
    projection = adapter.configured_query_projection()

    assert adapter._projection_preflight_status(projection) == (
        "ok",
        "installed-projection-ready",
    )
    assert observed == [
        [str(paths["python"]), "-I", "-c", adapter.PROJECTION_PREFLIGHT_CODE]
    ]


@pytest.mark.parametrize(
    ("preflight_result", "expected_reason"),
    [
        (
            adapter._BoundedHealthCommandResult(
                0,
                _projection_preflight_payload(ok=False, reason="projection-import-failed"),
                False,
                False,
                None,
            ),
            "projection-import-failed",
        ),
        (
            adapter._BoundedHealthCommandResult(
                0,
                _projection_preflight_payload(ok=True, life_index_version="1.5.0"),
                False,
                False,
                None,
            ),
            "life-index-version-too-old",
        ),
        (
            adapter._BoundedHealthCommandResult(
                0,
                _projection_preflight_payload(ok=False, reason="mcp-import-failed"),
                False,
                False,
                None,
            ),
            "mcp-import-failed",
        ),
        (
            adapter._BoundedHealthCommandResult(
                0,
                _projection_preflight_payload(ok=True, mcp_version="1.27.1"),
                False,
                False,
                None,
            ),
            "mcp-version-mismatch",
        ),
        (
            adapter._BoundedHealthCommandResult(
                None, b"", True, False, "projection-preflight-timeout"
            ),
            "projection-preflight-timeout",
        ),
        (
            adapter._BoundedHealthCommandResult(
                9, b"CHILD BODY MUST NOT LEAK", False, False, None
            ),
            "projection-preflight-command-failed",
        ),
        (
            adapter._BoundedHealthCommandResult(
                None, b"", False, True, "projection-preflight-output-too-large"
            ),
            "projection-preflight-output-too-large",
        ),
        (
            adapter._BoundedHealthCommandResult(0, b"not-json", False, False, None),
            "projection-preflight-invalid-result",
        ),
        (
            adapter._BoundedHealthCommandResult(
                0,
                b'{"schema_version":"wrong","ok":true,"life_index_version":"1.5.1","mcp_version":"1.27.2"}',
                False,
                False,
                None,
            ),
            "projection-preflight-invalid-result",
        ),
    ],
)
def test_codex_health_fails_closed_for_unusable_installed_projection(
    monkeypatch, tmp_path, preflight_result, expected_reason
):
    payload, _paths, _projection_environments = _health_payload_with_projection_result(
        monkeypatch, tmp_path, preflight_result
    )

    checks = {check["name"]: check for check in payload["checks"]}
    assert checks["query_tool_channel"] == {
        "name": "query_tool_channel",
        "status": "not-ready",
        "reason": expected_reason,
    }
    assert payload["ready"] is False
    rendered = json.dumps(payload, ensure_ascii=False)
    assert str(tmp_path) not in rendered
    assert "CHILD BODY MUST NOT LEAK" not in rendered


def _configure_prompt_assets(monkeypatch, tmp_path: Path) -> tuple[Path, Path]:
    query_prompt = tmp_path / "query-procedure.txt"
    metadata_prompt = tmp_path / "metadata-procedure.txt"
    query_prompt.write_text("caller query procedure", encoding="utf-8")
    metadata_prompt.write_text("caller metadata procedure", encoding="utf-8")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_FILE", str(query_prompt))
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_FILE", str(metadata_prompt))
    monkeypatch.setenv(
        "LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_SHA256",
        hashlib.sha256(query_prompt.read_bytes()).hexdigest(),
    )
    monkeypatch.setenv(
        "LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_SHA256",
        hashlib.sha256(metadata_prompt.read_bytes()).hexdigest(),
    )
    return query_prompt, metadata_prompt


def test_codex_health_runs_bounded_version_login_and_freshness_preflight(
    monkeypatch, tmp_path
):
    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", "synthetic-codex")
    calls: list[tuple[list[str], dict]] = []

    def fake_run(argv, **kwargs):
        calls.append((list(argv), dict(kwargs)))
        if argv[1:] == ["--version"]:
            return adapter._BoundedHealthCommandResult(
                0, b"codex-cli 0.144.1\n", False, False, None
            )
        if argv[1:] == ["login", "status"]:
            return adapter._BoundedHealthCommandResult(0, b"", False, False, None)
        if argv[0] == os.environ[QUERY_PROJECTION_ENV["python"]]:
            return adapter._BoundedHealthCommandResult(
                0, _projection_preflight_payload(ok=True), False, False, None
            )
        raise AssertionError(argv)

    monkeypatch.setattr(adapter.shutil, "which", lambda _value: "synthetic-codex")
    monkeypatch.setattr(adapter, "_bounded_health_command", fake_run)

    payload = adapter.codex_health_payload()

    assert payload["mode"] == "READY"
    assert payload["ready"] is True
    assert {check["name"] for check in payload["checks"]} >= {
        "codex_executable",
        "codex_version",
        "codex_login_status",
        "query_prompt_asset",
        "metadata_prompt_asset",
    }
    assert [call[0][1:] for call in calls[:2]] == [["--version"], ["login", "status"]]
    assert calls[2][0][0] == os.environ[QUERY_PROJECTION_ENV["python"]]
    assert all(call[1]["timeout"] <= 5 for call in calls)
    assert calls[0][1]["capture_stdout"] is True
    assert calls[1][1]["capture_stdout"] is False
    assert "AUTH BODY MUST NOT LEAK" not in json.dumps(payload)
    assert adapter.SUPPORTED_CODEX_VERSIONS == ("0.144.1",)


def test_codex_health_fails_closed_for_login_failure_and_digest_drift(monkeypatch, tmp_path):
    query_prompt, metadata_prompt = _configure_prompt_assets(monkeypatch, tmp_path)
    metadata_prompt.write_text("changed after configured digest", encoding="utf-8")
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", "synthetic-codex")

    def fake_run(argv, **kwargs):
        if argv[1:] == ["--version"]:
            return adapter._BoundedHealthCommandResult(0, b"codex-cli 0.144.1", False, False, None)
        return adapter._BoundedHealthCommandResult(1, b"", False, False, None)

    monkeypatch.setattr(adapter.shutil, "which", lambda _value: "synthetic-codex")
    monkeypatch.setattr(adapter, "_bounded_health_command", fake_run)
    payload = adapter.codex_health_payload()

    assert payload["mode"] == "NOT_READY"
    assert payload["ready"] is False
    checks = {check["name"]: check for check in payload["checks"]}
    assert checks["codex_login_status"]["status"] != "ok"
    assert checks["query_prompt_asset"]["status"] == "ok"
    assert checks["metadata_prompt_asset"]["status"] != "ok"
    assert "PRIVATE AUTH" not in json.dumps(payload)
    assert str(query_prompt) not in json.dumps(payload)


@pytest.mark.parametrize("version_output", ["codex-cli 0.144.10", "codex-cli 0.144.1-beta", "codex-cli 0.144.1+build"])
def test_codex_health_requires_exact_supported_version(monkeypatch, tmp_path, version_output):
    _configure_prompt_assets(monkeypatch, tmp_path)
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_ADAPTER_KIND", "codex-cli")
    monkeypatch.setenv("LIFE_INDEX_CODEX_EXECUTABLE", "synthetic-codex")

    def fake_run(argv, **kwargs):
        if argv[1:] == ["--version"]:
            return adapter._BoundedHealthCommandResult(
                0, version_output.encode(), False, False, None
            )
        return adapter._BoundedHealthCommandResult(0, b"", False, False, None)

    monkeypatch.setattr(adapter.shutil, "which", lambda _value: "synthetic-codex")
    monkeypatch.setattr(adapter, "_bounded_health_command", fake_run)
    payload = adapter.codex_health_payload()
    checks = {check["name"]: check for check in payload["checks"]}
    assert checks["codex_version"]["status"] == "not-ready"
    assert checks["codex_version"]["reason"] == "unsupported-version"


def test_load_configured_prompt_enforces_expected_digest_at_invocation(monkeypatch, tmp_path):
    query_prompt, _metadata_prompt = _configure_prompt_assets(monkeypatch, tmp_path)
    loaded, _source_id = adapter.load_configured_prompt("query")
    assert loaded == "caller query procedure"

    query_prompt.write_text("stale content", encoding="utf-8")
    with pytest.raises(adapter.CodexAdapterError) as error:
        adapter.load_configured_prompt("query")
    assert error.value.reason == "codex-prompt-asset-digest-mismatch"


def test_d6_a_production_readiness_docs_keep_floors_and_owner_boundaries_truthful():
    handoff = Path("docs/HOST_AGENT_HANDOFF.md").read_text(encoding="utf-8")
    contract = Path("docs/GUI_CLI_CONTRACT.md").read_text(encoding="utf-8")
    d6_a = Path("dev/plans/life-index-p0-p2-2026-07/reports/D6-A-RELEASE-READINESS.md").read_text(
        encoding="utf-8"
    )
    d6_b = Path("dev/plans/life-index-p0-p2-2026-07/reports/D6-B-LANDING-MANIFEST.md").read_text(
        encoding="utf-8"
    )
    program = Path("dev/plans/life-index-p0-p2-2026-07/PROGRAM-SPEC.md").read_text(
        encoding="utf-8"
    )
    ledger = Path("dev/plans/life-index-p0-p2-2026-07/EXECUTION-LEDGER.md").read_text(
        encoding="utf-8"
    )

    assert "configured-runtime-preflight-passed" in handoff
    assert "live-model-invocation-advisory-unverified" in handoff
    assert "sole inherited OS compatibility variable is `SYSTEMROOT`" in handoff
    assert "d4-real-schema-model-acceptance-unverified" not in handoff
    assert "/srv/life-index-codex-projection" in handoff
    assert "LIFE_INDEX_AI_ROOT" in handoff
    assert "Scripts\\python.exe" in handoff
    assert "life-index[mcp]==1.5.1" in handoff
    assert "LIFE_INDEX_CODEX_QUERY_PROJECTION_ROOT" in handoff
    assert "LIFE_INDEX_CODEX_QUERY_PROJECTION_PYTHON" in handoff
    assert "LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_FILE" in handoff
    assert "curl -fsS http://127.0.0.1:8791/health" in handoff
    assert "curl -fsS http://127.0.0.1:8000/api/health" in handoff

    assert "global CLI compatibility floor remains `1.4.5`" in contract
    assert "AI+ Codex projection floor is `1.5.1`" in contract
    assert "`mcp==1.27.2`" in contract

    for document in (d6_a, program, ledger):
        assert "REWORK_REQUIRED / RELEASE_VERSION_AND_CODEX_PRODUCTION_READINESS_ONLY" in document
    assert "D6-A readiness verdict: ACCEPTED." in d6_a
    assert "Reversible candidate code, tests, documentation, and synthetic evidence only." in d6_a
    assert "pre-release D6-A smoke substitutes the local exact wheel" in d6_a
    assert "CLI 1.5.1, GUI 0.5.0" in d6_b
    assert "install the exact built wheel with `[mcp]`" in d6_b
    assert "tools.mcp_projection" in d6_b
    assert "bridge `READY`, synthetic `search`" in d6_b
    assert "1.5.1 known-used entry only after actual upload" in d6_b
    assert "fresh pre-upload PyPI check" in d6_b
    assert "only after the actual upload is confirmed live" in d6_b
    assert "Codex/execution-agent public" not in d6_b
    assert "Human Owner retains approval authority" in d6_b
    assert "Owner-named Human maintainer or CTO execution operator" in d6_b


def test_c3_docs_keep_go_control_truth_and_exact_invocation_matrix():
    handoff = Path("docs/HOST_AGENT_HANDOFF.md").read_text(encoding="utf-8")
    architecture = Path("docs/ARCHITECTURE.md").read_text(encoding="utf-8")
    skill = Path("skill/SKILL.md").read_text(encoding="utf-8")
    program = Path("dev/plans/life-index-p0-p2-2026-07/PROGRAM-SPEC.md").read_text(
        encoding="utf-8"
    )
    ledger = Path("dev/plans/life-index-p0-p2-2026-07/EXECUTION-LEDGER.md").read_text(
        encoding="utf-8"
    )
    report = Path("dev/plans/life-index-p0-p2-2026-07/reports/D2-GUI-CONTRACT-TRUTH.md").read_text(
        encoding="utf-8"
    )
    for document in (handoff, architecture, skill, program, report):
        assert "LOCAL_ACCEPTED_PENDING_CI" not in document
    assert "> Control status: `D3_GO`; `D4_GO`; `D5_DEFERRED_NOT_NECESSARY_NOW`" in program
    assert "- **Judgment**: **D3 is `GO`.**" in program
    assert "81523a05ae9e84fa070a417882c0c99df0215f96" in program
    assert "29429836416" in program
    assert "D4 current state is restored to `GO`" in program
    assert "9813e166e8f31153c56401b9460fb45bfea44d3c" in program
    assert "83e5072b-1a28-4480-8b75-e23933d3d1a0" in program
    assert "D5 phase remains NOT_STARTED / NOT_ADJUDICATED." in program

    d2_gate = next(line for line in ledger.splitlines() if line.startswith("| D2 GUI contract/adapter"))
    assert "`GO`" in d2_gate
    assert "3acbb448379b5506e2bb29f3a6dd2a0a37acf7d9" in d2_gate
    d3_rows = [line for line in ledger.splitlines() if line.startswith("| D3-")]
    assert len(d3_rows) == 4
    assert all(
        "accepted / `GO`" in line
        and "D4 later closed `GO` without reopening D3" in line
        for line in d3_rows
    )

    assert "- Overall executor status: `DONE`" in report
    assert "D2 CTO verdict is `GO`" in report
    assert "3acbb448379b5506e2bb29f3a6dd2a0a37acf7d9" in report
    assert "29361155071" in report
    assert "f5482f1178991ebd20de818316318a345717e5b2" in report
    assert "This control-only successor does not" in report
    assert "record its own SHA." in report
    assert "codex exec -C <run-dir> --skip-git-repo-check" in handoff
    assert "LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_SHA256" in handoff
    assert "LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_SHA256" in handoff
    assert "configured-runtime-preflight-passed" in handoff
    assert "live-model-invocation-advisory-unverified" in handoff
