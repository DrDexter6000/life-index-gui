"""Strict, GUI-owned Codex CLI named adapter.

The reference bridge remains runtime-neutral by default.  This module is the
only place that knows about the Codex CLI invocation contract.  It deliberately
does not ship a Life Index procedure, discover Skills, call an LLM API, or
interpret journal data.  Callers provide procedure text and request data; the
adapter contributes only the wire-format instruction and canonical request
JSON.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import math
import os
import queue
import re
import signal
import shutil
import stat
import subprocess
import tempfile
import threading
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

from host_agent_bridge.contracts import (
    METADATA_SCHEMA,
    METADATA_FIELD_KEYS,
    QUERY_SCHEMA,
    HostAgentMetadataProposalV1,
    HostAgentQueryResponseV1,
    parse_exact_json_object,
    validate_metadata_proposal,
    validate_query_response,
)


ADAPTER_KIND_ENV = "LIFE_INDEX_HOST_AGENT_ADAPTER_KIND"
REFERENCE_COMMAND_KIND = "reference-command"
CODEX_CLI_KIND = "codex-cli"
VALID_ADAPTER_KINDS = frozenset({REFERENCE_COMMAND_KIND, CODEX_CLI_KIND})

CODEX_EXECUTABLE_ENV = "LIFE_INDEX_CODEX_EXECUTABLE"
CODEX_CLI_ENV = "LIFE_INDEX_CODEX_CLI"
CODEX_TIMEOUT_ENV = "LIFE_INDEX_CODEX_TIMEOUT_SECONDS"
HOST_AGENT_TIMEOUT_ENV = "LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS"

# Query-only, explicit projection configuration.  These values are deliberately
# distinct from ambient Core variables: the bridge must never infer a data
# location from a host process and accidentally give Codex access to real data.
QUERY_PROJECTION_ROOT_ENV = "LIFE_INDEX_CODEX_QUERY_PROJECTION_ROOT"
QUERY_PROJECTION_PYTHON_ENV = "LIFE_INDEX_CODEX_QUERY_PROJECTION_PYTHON"
QUERY_PROJECTION_DATA_DIR_ENV = "LIFE_INDEX_CODEX_QUERY_PROJECTION_DATA_DIR"
QUERY_PROJECTION_CONFIG_DIR_ENV = "LIFE_INDEX_CODEX_QUERY_PROJECTION_CONFIG_DIR"
QUERY_PROJECTION_CACHE_DIR_ENV = "LIFE_INDEX_CODEX_QUERY_PROJECTION_CACHE_DIR"
QUERY_PROJECTION_TMPDIR_ENV = "LIFE_INDEX_CODEX_QUERY_PROJECTION_TMPDIR"
QUERY_PROJECTION_TRACE_FILE_ENV = "LIFE_INDEX_CODEX_QUERY_PROJECTION_TRACE_FILE"
QUERY_MCP_TOOL_NAMES = ("health", "journal.get", "search")
_QUERY_TRACE_ENV_NAMES = frozenset(
    {"LIFE_INDEX_VALIDATION_MODE", "LIFE_INDEX_TOOL_CALL_LOG"}
)
_CODEX_MCP_SERVER = "life_index"
_CODEX_MCP_ITEM_TYPE = "mcp_tool_call"
_CODEX_COMPLETED_ITEM_EVENT = "item.completed"
_CODEX_COMPLETED_MCP_STATUS = "completed"
_EXECUTION_METADATA_DIAGNOSTIC_STAGE = "codex-execution-metadata"
_EXECUTION_METADATA_INTERNAL_REASON = "metadata-classification-internal"
_EXECUTION_METADATA_DIAGNOSTIC_REASONS = frozenset(
    {
        "jsonl-event-invalid",
        "forbidden-mcp-target",
        "mcp-call-not-successful",
        "observed-search-journal-order-missing",
        "trace-write-failed",
        _EXECUTION_METADATA_INTERNAL_REASON,
    }
)

QUERY_PROMPT_FILE_ENV = "LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_FILE"
METADATA_PROMPT_FILE_ENV = "LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_FILE"
CODEX_QUERY_PROMPT_FILE_ENV = "LIFE_INDEX_HOST_AGENT_CODEX_QUERY_PROMPT_FILE"
CODEX_METADATA_PROMPT_FILE_ENV = "LIFE_INDEX_HOST_AGENT_CODEX_METADATA_PROMPT_FILE"
QUERY_PROMPT_SOURCE_ID_ENV = "LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_SOURCE_ID"
METADATA_PROMPT_SOURCE_ID_ENV = "LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_SOURCE_ID"
QUERY_PROMPT_SHA256_ENV = "LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_SHA256"
METADATA_PROMPT_SHA256_ENV = "LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_SHA256"

DEFAULT_CODEX_EXECUTABLE = "codex"
DEFAULT_TIMEOUT_SECONDS = 600.0
MIN_TIMEOUT_SECONDS = 0.1
MAX_TIMEOUT_SECONDS = 600.0
MAX_PROMPT_FILE_BYTES = 256_000
SUPPORTED_CODEX_VERSIONS = ("0.144.1",)
HEALTH_COMMAND_TIMEOUT_SECONDS = 3.0
MAX_HEALTH_VERSION_OUTPUT_BYTES = 512
AI_PROJECTION_MIN_LIFE_INDEX_VERSION = "1.5.1"
AI_PROJECTION_MCP_VERSION = "1.27.2"
PROJECTION_PREFLIGHT_SCHEMA_VERSION = "life-index.codex-projection-preflight.v1"
MAX_PROJECTION_PREFLIGHT_OUTPUT_BYTES = 512

# This child performs only import and installed-distribution checks. It never
# starts an MCP server, calls a model/network, or invokes a Life Index command.
PROJECTION_PREFLIGHT_CODE = """
import json
from importlib import metadata

SCHEMA_VERSION = "life-index.codex-projection-preflight.v1"


def emit(payload):
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True))


try:
    import tools.mcp_projection
except Exception:
    emit({"schema_version": SCHEMA_VERSION, "ok": False, "reason": "projection-import-failed"})
else:
    try:
        import mcp
    except Exception:
        emit({"schema_version": SCHEMA_VERSION, "ok": False, "reason": "mcp-import-failed"})
    else:
        try:
            life_index_version = metadata.version("life-index")
        except metadata.PackageNotFoundError:
            emit({"schema_version": SCHEMA_VERSION, "ok": False, "reason": "life-index-distribution-missing"})
        else:
            try:
                mcp_version = metadata.version("mcp")
            except metadata.PackageNotFoundError:
                emit({"schema_version": SCHEMA_VERSION, "ok": False, "reason": "mcp-distribution-missing"})
            else:
                emit({"schema_version": SCHEMA_VERSION, "ok": True, "life_index_version": life_index_version, "mcp_version": mcp_version})
""".strip()
_PROJECTION_PREFLIGHT_CHILD_FAILURE_REASONS = frozenset(
    {
        "projection-import-failed",
        "mcp-import-failed",
        "life-index-distribution-missing",
        "mcp-distribution-missing",
    }
)

# These are adapter budgets, not public envelope limits.  Procedure text may
# be shortened, while the canonical request JSON is never shortened.
MAX_PROCEDURE_PROMPT_CHARS = 12_000
MAX_REQUEST_JSON_CHARS = 16_000
MAX_OUTPUT_BYTES = 4 * 1024 * 1024
PROMPT_ASSEMBLY_VERSION = "codex-wire-prompt.v1"
PROCEDURE_TRUNCATION_MARKER = "[procedure truncated]"
WIRE_FORMAT_INSTRUCTION = (
    "Return exactly one JSON object matching the declared schema. "
    "Do not emit markdown, prose, or a second object. "
    "For query responses, each evidence.id must be the exact successful journal.get rel_path "
    "with the leading Journals/ removed and the .md suffix retained; never invent citation labels."
)


def _remove_run_directory_with_retries(
    run_path: str | Path,
    *,
    attempts: int = 50,
    delay_seconds: float = 0.1,
) -> None:
    """Remove one adapter-owned run directory after transient Windows handle release."""

    bounded_attempts = max(1, int(attempts))
    for attempt in range(bounded_attempts):
        try:
            shutil.rmtree(run_path)
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt + 1 >= bounded_attempts:
                raise
            time.sleep(max(0.0, delay_seconds))


@contextmanager
def _temporary_run_directory(root: str | Path | None):
    run_path = Path(
        tempfile.mkdtemp(prefix="codex-cli-", dir=str(root) if root is not None else None)
    ).resolve()
    try:
        yield run_path
    finally:
        _remove_run_directory_with_retries(run_path)

# The canonical v1 field tuple is owned by the runtime-neutral contract.  The
# adapter reuses it for its Codex Structured Outputs projection and wire
# validation rather than maintaining a provider-specific key list.
SUPPORTED_METADATA_FIELDS = METADATA_FIELD_KEYS
TRACE_ENTRY_FIELDS = ("tool", "status")

_SUPPORTED_SCHEMA_KEYS = frozenset(
    {
        "$defs",
        "$ref",
        "additionalProperties",
        "anyOf",
        "enum",
        "items",
        "properties",
        "required",
        "type",
    }
)
_STRIPPED_SCHEMA_METADATA_KEYS = frozenset(
    {
        "title",
        "description",
        "default",
        "examples",
        "example",
        "deprecated",
        "readOnly",
        "writeOnly",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minItems",
        "maxItems",
        "uniqueItems",
        "format",
    }
)


class CodexAdapterError(RuntimeError):
    """A fail-closed adapter/configuration error.

    ``reason`` is stable and safe for a bridge response.  ``diagnostics`` is
    metadata-only and must never contain request, prompt, or terminal bodies.
    """

    def __init__(
        self,
        reason: str,
        message: str | None = None,
        *,
        diagnostics: Mapping[str, Any] | None = None,
    ) -> None:
        self.reason = reason
        self.diagnostics = dict(diagnostics or {})
        super().__init__(message or reason)


@dataclass(frozen=True)
class CodexProcessResult:
    returncode: int | None
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False
    cancelled: bool = False


@dataclass(frozen=True)
class CodexAdapterResult:
    payload: dict[str, Any]
    reason: str | None
    diagnostics: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class QueryProjectionConfig:
    """One isolated, configuration-owned stdio projection boundary."""

    root: Path
    python: Path
    data_dir: Path
    config_dir: Path
    cache_dir: Path
    tmp_dir: Path
    trace_file: Path | None = None


# Compatibility names make the process boundary discoverable without adding a
# second provider protocol.
AdapterError = CodexAdapterError
AdapterResult = CodexAdapterResult


class AsyncRunner(Protocol):
    def __call__(
        self, argv: list[str], stdin: str, timeout: float, cwd: str | Path
    ) -> Awaitable[CodexProcessResult]: ...


def adapter_kind(value: str | None = None) -> str:
    """Resolve the explicitly named bridge adapter.

    The default preserves the existing provider-neutral reference-command
    behavior.  No executable/argv inspection is used for selection.
    """

    selected = os.environ.get(ADAPTER_KIND_ENV, REFERENCE_COMMAND_KIND) if value is None else value
    if selected not in VALID_ADAPTER_KINDS:
        raise CodexAdapterError("host-agent-adapter-kind-invalid")
    return selected


def configured_codex_executable() -> str:
    value = os.environ.get(CODEX_EXECUTABLE_ENV, "").strip()
    if not value:
        value = os.environ.get(CODEX_CLI_ENV, "").strip()
    return value or DEFAULT_CODEX_EXECUTABLE


def configured_timeout_seconds() -> float:
    """Return a finite timeout inside the adapter's bounded process budget."""

    for env_name in (CODEX_TIMEOUT_ENV, HOST_AGENT_TIMEOUT_ENV):
        value = os.environ.get(env_name, "").strip()
        if not value:
            continue
        try:
            parsed = float(value)
        except ValueError:
            continue
        if not math.isfinite(parsed):
            continue
        return _normalize_timeout(parsed)
    return DEFAULT_TIMEOUT_SECONDS


def _configured_projection_path(
    env_name: str,
    *,
    label: str,
    require_file: bool = False,
) -> Path:
    raw_value = os.environ.get(env_name, "").strip()
    if not raw_value:
        raise CodexAdapterError(f"codex-query-projection-{label}-unconfigured")
    candidate = Path(raw_value)
    if not candidate.is_absolute():
        raise CodexAdapterError(f"codex-query-projection-{label}-not-absolute")
    if _has_symlink_component(candidate):
        raise CodexAdapterError(f"codex-query-projection-{label}-symlink")
    try:
        resolved = candidate.resolve(strict=True)
        valid = resolved.is_file() if require_file else resolved.is_dir()
    except (OSError, RuntimeError):
        valid = False
        resolved = candidate
    if not valid:
        raise CodexAdapterError(f"codex-query-projection-{label}-unavailable")
    return resolved


def _paths_overlap(left: Path, right: Path) -> bool:
    return left == right or left in right.parents or right in left.parents


def _is_strict_descendant(candidate: Path, root: Path) -> bool:
    return candidate != root and root in candidate.parents


def _has_symlink_component(candidate: Path) -> bool:
    """Reject every symlink from the filesystem anchor through ``candidate``."""

    try:
        current = Path(candidate.anchor)
        for component in candidate.parts[1:]:
            current /= component
            is_junction = getattr(current, "is_junction", None)
            if current.is_symlink() or (callable(is_junction) and is_junction()):
                return True
    except (OSError, RuntimeError):
        return True
    return False


def _configured_projection_trace_file(projection: QueryProjectionConfig) -> Path | None:
    raw_value = os.environ.get(QUERY_PROJECTION_TRACE_FILE_ENV, "").strip()
    if not raw_value:
        return None
    candidate = Path(raw_value)
    if not candidate.is_absolute():
        raise CodexAdapterError("codex-query-projection-trace-file-not-absolute")
    if _has_symlink_component(candidate):
        raise CodexAdapterError("codex-query-projection-trace-file-symlink")
    try:
        parent = candidate.parent.resolve(strict=True)
        if not parent.is_dir():
            raise OSError("trace parent is not a directory")
        if candidate.exists():
            raise CodexAdapterError("codex-query-projection-trace-file-already-exists")
    except CodexAdapterError:
        raise
    except (OSError, RuntimeError):
        raise CodexAdapterError("codex-query-projection-trace-file-parent-unavailable") from None

    resolved = parent / candidate.name
    evidence_root = projection.root / "evidence"
    in_tmp = _is_strict_descendant(resolved, projection.tmp_dir)
    in_evidence = evidence_root.is_dir() and _is_strict_descendant(resolved, evidence_root)
    if not (in_tmp or in_evidence):
        raise CodexAdapterError("codex-query-projection-trace-file-outside-allowed-subtree")
    return resolved


def configured_query_projection() -> QueryProjectionConfig:
    """Load the query-only projection without falling back to ambient paths."""

    root = _configured_projection_path(
        QUERY_PROJECTION_ROOT_ENV,
        label="root",
    )
    projection = QueryProjectionConfig(
        root=root,
        python=_configured_projection_path(
            QUERY_PROJECTION_PYTHON_ENV,
            label="python",
            require_file=True,
        ),
        data_dir=_configured_projection_path(
            QUERY_PROJECTION_DATA_DIR_ENV,
            label="data-dir",
        ),
        config_dir=_configured_projection_path(
            QUERY_PROJECTION_CONFIG_DIR_ENV,
            label="config-dir",
        ),
        cache_dir=_configured_projection_path(
            QUERY_PROJECTION_CACHE_DIR_ENV,
            label="cache-dir",
        ),
        tmp_dir=_configured_projection_path(
            QUERY_PROJECTION_TMPDIR_ENV,
            label="tmpdir",
        ),
    )
    values = (
        projection.python,
        projection.data_dir,
        projection.config_dir,
        projection.cache_dir,
        projection.tmp_dir,
    )
    for index, left in enumerate(values):
        if any(_paths_overlap(left, right) for right in values[index + 1 :]):
            raise CodexAdapterError("codex-query-projection-isolation-overlap")
    if any(not _is_strict_descendant(value, root) for value in values):
        raise CodexAdapterError("codex-query-projection-path-outside-root")
    trace_file = _configured_projection_trace_file(projection)
    return QueryProjectionConfig(
        root=projection.root,
        python=projection.python,
        data_dir=projection.data_dir,
        config_dir=projection.config_dir,
        cache_dir=projection.cache_dir,
        tmp_dir=projection.tmp_dir,
        trace_file=trace_file,
    )


def _toml_string(value: str | Path) -> str:
    """Return one TOML basic string without shell interpolation or quoting."""

    return json.dumps(str(value), ensure_ascii=False, allow_nan=False)


def _strict_codex_config_args() -> list[str]:
    return [
        "--strict-config",
        "-s",
        "read-only",
        "-c",
        "approval_policy='never'",
        "-c",
        "features.shell_tool=false",
        "-c",
        "web_search='disabled'",
    ]


def _query_mcp_config_args(projection: QueryProjectionConfig) -> list[str]:
    """Build query-only MCP configuration as one argv token per TOML assignment."""

    enabled_tools = ",".join(f"'{tool}'" for tool in QUERY_MCP_TOOL_NAMES)
    config_args = [
        "-c",
        f"mcp_servers.life_index.command={_toml_string(projection.python)}",
        "-c",
        "mcp_servers.life_index.args=['-m','tools.mcp_projection']",
        "-c",
        f"mcp_servers.life_index.env.LIFE_INDEX_DATA_DIR={_toml_string(projection.data_dir)}",
        "-c",
        f"mcp_servers.life_index.env.XDG_CONFIG_HOME={_toml_string(projection.config_dir)}",
        "-c",
        f"mcp_servers.life_index.env.XDG_CACHE_HOME={_toml_string(projection.cache_dir)}",
        "-c",
        f"mcp_servers.life_index.env.TMPDIR={_toml_string(projection.tmp_dir)}",
        "-c",
        f"mcp_servers.life_index.enabled_tools=[{enabled_tools}]",
        "-c",
        "mcp_servers.life_index.default_tools_approval_mode='approve'",
        "-c",
        "mcp_servers.life_index.required=true",
    ]
    return config_args


def _codex_child_environment() -> dict[str, str]:
    """Remove ambient validation sinks before starting the real Codex child.

    The adapter creates a configured trace only after it has parsed Codex
    execution metadata.  Letting these parent variables through would give an
    MCP child an alternate evidence sink.
    """

    environment = dict(os.environ)
    for env_name in _QUERY_TRACE_ENV_NAMES:
        environment.pop(env_name, None)
    return environment


def _projection_preflight_environment(projection: QueryProjectionConfig) -> dict[str, str]:
    """Build the complete child environment from the configured isolated roots."""

    environment = {
        "LIFE_INDEX_DATA_DIR": str(projection.data_dir),
        "XDG_CONFIG_HOME": str(projection.config_dir),
        "XDG_CACHE_HOME": str(projection.cache_dir),
        "TMPDIR": str(projection.tmp_dir),
        "TMP": str(projection.tmp_dir),
        "TEMP": str(projection.tmp_dir),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
    }
    if os.name == "nt":
        system_root = os.environ.get("SYSTEMROOT")
        if system_root:
            environment["SYSTEMROOT"] = system_root
    return environment


def _execution_metadata_error(diagnostic_reason: object = None) -> CodexAdapterError:
    """Return a generic failure with one bounded, parameter-free classifier."""

    safe_reason = (
        diagnostic_reason
        if isinstance(diagnostic_reason, str)
        and diagnostic_reason in _EXECUTION_METADATA_DIAGNOSTIC_REASONS
        else _EXECUTION_METADATA_INTERNAL_REASON
    )
    return CodexAdapterError(
        "codex-execution-metadata-invalid",
        diagnostics={
            "stage": _EXECUTION_METADATA_DIAGNOSTIC_STAGE,
            "reason": safe_reason,
        },
    )


def _reject_non_json_constant(_: str) -> None:
    raise ValueError("non-json-constant")


def _parse_completed_mcp_tool_calls(stdout: str) -> list[dict[str, object]]:
    """Project completed Codex MCP calls into parameter-free evidence rows.

    Codex's JSONL item may carry arguments and results.  This function reads
    those fields only as part of parsing one event and never copies them into a
    result, diagnostic, or persistent artifact.
    """

    if not isinstance(stdout, str) or any(0xD800 <= ord(char) <= 0xDFFF for char in stdout):
        raise _execution_metadata_error("jsonl-event-invalid")
    records: list[dict[str, object]] = []
    for line in stdout.splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line, parse_constant=_reject_non_json_constant)
        except (TypeError, ValueError, json.JSONDecodeError):
            raise _execution_metadata_error("jsonl-event-invalid") from None
        if not isinstance(event, Mapping):
            raise _execution_metadata_error("jsonl-event-invalid")
        if event.get("type") != _CODEX_COMPLETED_ITEM_EVENT:
            continue
        item = event.get("item")
        if not isinstance(item, Mapping):
            raise _execution_metadata_error("jsonl-event-invalid")
        if item.get("type") != _CODEX_MCP_ITEM_TYPE:
            continue
        server = item.get("server")
        tool = item.get("tool")
        if server != _CODEX_MCP_SERVER or tool not in QUERY_MCP_TOOL_NAMES:
            raise _execution_metadata_error("forbidden-mcp-target")
        if (
            item.get("status") != _CODEX_COMPLETED_MCP_STATUS
            or item.get("error") is not None
        ):
            raise _execution_metadata_error("mcp-call-not-successful")
        records.append(
            {
                "server": _CODEX_MCP_SERVER,
                "tool": tool,
                "status": _CODEX_COMPLETED_MCP_STATUS,
                "success": True,
            }
        )
    return records


def _has_ordered_query_evidence(tools: list[str]) -> bool:
    try:
        search_index = tools.index("search")
        tools.index("journal.get", search_index + 1)
    except ValueError:
        return False
    return True


def _validate_query_execution_trace(observed: list[dict[str, object]]) -> None:
    """Require ordered successful query-tool execution evidence."""

    observed_tools: list[str] = []
    for record in observed:
        tool = record.get("tool")
        if not isinstance(tool, str) or tool not in QUERY_MCP_TOOL_NAMES:
            raise _execution_metadata_error("jsonl-event-invalid")
        observed_tools.append(tool)
    if not _has_ordered_query_evidence(observed_tools):
        raise _execution_metadata_error("observed-search-journal-order-missing")


def _project_query_execution_trace(records: list[dict[str, object]]) -> list[dict[str, str]]:
    """Return UI trace rows derived solely from validated objective MCP records."""

    return [{"tool": record["tool"], "status": "ok"} for record in records]


def _write_query_projection_trace(trace_file: Path, records: list[dict[str, object]]) -> None:
    """Create the configured private trace once from adapter-owned rows only."""

    created = False
    try:
        serialized = "".join(
            json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
            for record in records
        )
        with trace_file.open("x", encoding="utf-8", newline="\n") as sink:
            created = True
            sink.write(serialized)
    except (OSError, TypeError, ValueError):
        if created:
            try:
                trace_file.unlink(missing_ok=True)
            except OSError:
                pass
        raise _execution_metadata_error("trace-write-failed") from None


def _normalize_timeout(value: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return DEFAULT_TIMEOUT_SECONDS
    if not math.isfinite(parsed):
        return DEFAULT_TIMEOUT_SECONDS
    return min(MAX_TIMEOUT_SECONDS, max(MIN_TIMEOUT_SECONDS, parsed))


def prompt_file_env(kind: str) -> tuple[str, ...]:
    if kind == "query":
        return (QUERY_PROMPT_FILE_ENV, CODEX_QUERY_PROMPT_FILE_ENV)
    if kind == "metadata":
        return (METADATA_PROMPT_FILE_ENV, CODEX_METADATA_PROMPT_FILE_ENV)
    raise CodexAdapterError("codex-prompt-kind-invalid")


def prompt_source_id_env(kind: str) -> str:
    if kind == "query":
        return QUERY_PROMPT_SOURCE_ID_ENV
    if kind == "metadata":
        return METADATA_PROMPT_SOURCE_ID_ENV
    raise CodexAdapterError("codex-prompt-kind-invalid")


def prompt_sha256_env(kind: str) -> str:
    if kind == "query":
        return QUERY_PROMPT_SHA256_ENV
    if kind == "metadata":
        return METADATA_PROMPT_SHA256_ENV
    raise CodexAdapterError("codex-prompt-kind-invalid")


def configured_prompt_path(kind: str) -> Path | None:
    for env_name in prompt_file_env(kind):
        value = os.environ.get(env_name, "").strip()
        if value:
            return Path(value)
    return None


def _safe_source_id(source_id: str | None, fallback: str) -> str:
    value = str(source_id or "").strip()
    if not value:
        return fallback
    # A source ID is logical metadata, not a filesystem path or a secret.  The
    # narrow opaque alphabet also prevents control text from entering output.
    if len(value) > 64 or re.fullmatch(r"[A-Za-z0-9._-]+", value) is None:
        return fallback
    return value


_ADAPTER_DIAGNOSTIC_KEYS = frozenset(
    {
        "source_id",
        "input_length",
        "retained_length",
        "truncated",
        "assembly_version",
        "assembly_steps",
        "schema_family",
        "stage",
        "reason",
        "error_type",
        "returncode",
        "timed_out",
        "cancelled",
        "output_present",
        "output_size",
        "stdout_length",
        "stderr_length",
        "request_length",
        "request_cap",
        "depth",
    }
)
_ADAPTER_DIAGNOSTIC_STRING_KEYS = frozenset(
    {"source_id", "assembly_version", "schema_family", "stage", "reason", "error_type"}
)
_ADAPTER_DIAGNOSTIC_INT_KEYS = frozenset(
    {
        "input_length",
        "retained_length",
        "returncode",
        "output_size",
        "stdout_length",
        "stderr_length",
        "request_length",
        "request_cap",
        "depth",
    }
)
_ADAPTER_DIAGNOSTIC_BOOL_KEYS = frozenset(
    {"truncated", "timed_out", "cancelled", "output_present"}
)


def _sanitize_adapter_diagnostics(diagnostics: Mapping[str, Any] | None) -> dict[str, Any]:
    """Keep adapter diagnostics bounded and body/path-free before returning them."""

    if not isinstance(diagnostics, Mapping):
        return {}
    safe: dict[str, Any] = {}
    for key, value in diagnostics.items():
        if key not in _ADAPTER_DIAGNOSTIC_KEYS:
            continue
        if key in _ADAPTER_DIAGNOSTIC_STRING_KEYS:
            if not isinstance(value, str) or len(value) > 128:
                continue
            if key == "source_id":
                if len(value) > 64 or re.fullmatch(r"[A-Za-z0-9._-]+", value) is None:
                    continue
            elif re.fullmatch(r"[A-Za-z0-9._:-]+", value) is None:
                continue
            safe[key] = value
        elif key in _ADAPTER_DIAGNOSTIC_INT_KEYS:
            if isinstance(value, bool) or not isinstance(value, int) or abs(value) > 10_000_000:
                continue
            safe[key] = value
        elif key in _ADAPTER_DIAGNOSTIC_BOOL_KEYS and isinstance(value, bool):
            safe[key] = value
        elif key == "assembly_steps" and isinstance(value, list):
            safe[key] = [
                item
                for item in value[:8]
                if isinstance(item, str)
                and item in {"procedure-prefix", "wire-format-instruction", "canonical-request-json"}
            ]
    return safe


def _json_request(request: Mapping[str, Any]) -> str:
    try:
        rendered = json.dumps(
            dict(request),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise CodexAdapterError("codex-request-json-invalid") from exc
    if len(rendered) > MAX_REQUEST_JSON_CHARS:
        raise CodexAdapterError(
            "codex-request-too-large",
            diagnostics={"request_length": len(rendered), "request_cap": MAX_REQUEST_JSON_CHARS},
        )
    return rendered


def assemble_prompt(
    procedure_prompt: str,
    request: Mapping[str, Any],
    *,
    source_id: str | None,
    schema_family: str,
) -> tuple[str, dict[str, Any]]:
    """Build deterministic wire prompt and metadata-only assembly diagnostics."""

    if not isinstance(procedure_prompt, str) or not procedure_prompt:
        raise CodexAdapterError("codex-prompt-asset-required")
    request_json = _json_request(request)
    input_length = len(procedure_prompt)
    retained_prefix = procedure_prompt[:MAX_PROCEDURE_PROMPT_CHARS]
    truncated = input_length > MAX_PROCEDURE_PROMPT_CHARS
    prompt_parts = [retained_prefix]
    if truncated:
        prompt_parts.append(PROCEDURE_TRUNCATION_MARKER)
    prompt_parts.extend(
        (
            WIRE_FORMAT_INSTRUCTION,
            f"Request JSON:\n{request_json}",
        )
    )
    prompt = "\n".join(prompt_parts)
    diagnostics = {
        "source_id": _safe_source_id(source_id, "configured-procedure"),
        "input_length": input_length,
        "retained_length": len(retained_prefix),
        "truncated": truncated,
        "assembly_version": PROMPT_ASSEMBLY_VERSION,
        "assembly_steps": ["procedure-prefix", "wire-format-instruction", "canonical-request-json"],
        "schema_family": schema_family,
    }
    return prompt, diagnostics


def _strip_schema_metadata(node: Any) -> Any:
    if isinstance(node, list):
        return [_strip_schema_metadata(item) for item in node]
    if not isinstance(node, dict):
        return node
    result: dict[str, Any] = {}
    for key, value in node.items():
        if key in {"properties", "$defs"} and isinstance(value, dict):
            # Keys in these maps are user/domain property or definition names,
            # not JSON Schema metadata keywords (``title`` is a real v1 field).
            result[key] = {
                map_key: _strip_schema_metadata(map_value)
                for map_key, map_value in value.items()
            }
            continue
        if key in _STRIPPED_SCHEMA_METADATA_KEYS:
            continue
        if key == "const":
            result["enum"] = [value]
            continue
        result[key] = _strip_schema_metadata(value)
    return result


def validate_projected_payload(schema: Mapping[str, Any], payload: Mapping[str, Any]) -> None:
    """Validate a projected payload through the canonical v1 authority.

    The schema argument is intentionally accepted for test/inspection callers;
    it does not become a second semantic contract.
    """

    del schema
    family = payload.get("schema_version") if isinstance(payload, Mapping) else None
    if family == QUERY_SCHEMA:
        validate_query_response(payload)
        return
    if family == METADATA_SCHEMA:
        validate_metadata_proposal(payload)
        return
    raise CodexAdapterError("codex-schema-family-unsupported")


def _close_objects(node: Any) -> Any:
    if isinstance(node, list):
        return [_close_objects(item) for item in node]
    if not isinstance(node, dict):
        return node
    result = {key: _close_objects(value) for key, value in node.items()}
    if result.get("type") == "object":
        properties = result.get("properties")
        if isinstance(properties, dict):
            result["additionalProperties"] = False
            result["required"] = list(properties)
    return result


def _trace_entry_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "tool": {"type": "string"},
            "status": {"type": "string"},
        },
        "required": list(TRACE_ENTRY_FIELDS),
    }


def _metadata_field_ref(schema: dict[str, Any]) -> dict[str, Any]:
    defs = schema.get("$defs")
    if isinstance(defs, dict) and "MetadataField" in defs:
        return {"$ref": "#/$defs/MetadataField"}
    raise CodexAdapterError("codex-schema-definition-missing")


def _apply_open_map_projections(schema: dict[str, Any], model_cls: type[BaseModel]) -> None:
    props = schema.get("properties")
    if not isinstance(props, dict):
        raise CodexAdapterError("codex-schema-root-properties-missing")
    if model_cls is HostAgentQueryResponseV1 or schema.get("$id") == QUERY_SCHEMA:
        trace = props.get("tool_trace")
        if isinstance(trace, dict):
            trace["items"] = _trace_entry_schema()
            trace.pop("additionalProperties", None)
    elif model_cls is HostAgentMetadataProposalV1 or schema.get("$id") == METADATA_SCHEMA:
        fields = props.get("fields")
        if not isinstance(fields, dict):
            raise CodexAdapterError("codex-schema-fields-missing")
        field_ref = _metadata_field_ref(schema)
        fields.clear()
        fields.update(
            {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    name: {"anyOf": [field_ref, {"type": "null"}]}
                    for name in SUPPORTED_METADATA_FIELDS
                },
                "required": list(SUPPORTED_METADATA_FIELDS),
            }
        )
        policy = props.get("policy")
        if isinstance(policy, dict):
            policy.clear()
            policy.update(
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"preserve_user_fields": {"type": "boolean"}},
                    "required": ["preserve_user_fields"],
                }
            )


def build_codex_schema(model_cls: type[BaseModel]) -> dict[str, Any]:
    """Project canonical validation schema into the adapter wire subset."""

    if model_cls not in (HostAgentQueryResponseV1, HostAgentMetadataProposalV1):
        raise CodexAdapterError("codex-schema-family-unsupported")
    raw_schema = model_cls.model_json_schema(mode="validation")
    projected = _strip_schema_metadata(raw_schema)
    projected = _close_objects(projected)
    if not isinstance(projected, dict):
        raise CodexAdapterError("codex-schema-invalid")
    _apply_open_map_projections(projected, model_cls)
    # Pydantic's schema title is retained only as a non-validation label in
    # some versions.  The linter intentionally permits it after projection.
    lint_codex_schema(projected)
    return projected


def _schema_error(reason: str, **diagnostics: Any) -> CodexAdapterError:
    return CodexAdapterError(reason, diagnostics=diagnostics)


def lint_codex_schema(schema: Mapping[str, Any]) -> None:
    """Fail closed on the documented static Structured Outputs subset.

    Schema keywords and user property/definition names are traversed in
    separate contexts.  Every definition is checked, even when no reachable
    property currently references it, so a future model/schema change cannot
    bypass the static gate through an unused ``$defs`` entry.
    """

    if not isinstance(schema, Mapping):
        raise _schema_error("codex-schema-not-object")
    if schema.get("type") != "object":
        raise _schema_error("codex-schema-root-not-object")
    if "anyOf" in schema:
        raise _schema_error("codex-schema-root-anyof")
    defs = schema.get("$defs", {})
    if not isinstance(defs, Mapping):
        raise _schema_error("codex-schema-definitions-invalid")

    object_property_count = 0
    visited_defs: set[str] = set()
    active_defs: set[str] = set()
    scalar_types = {"array", "boolean", "null", "number", "object", "string"}

    def visit(node: Any, *, depth: int, root: bool = False) -> None:
        nonlocal object_property_count
        if depth > 10:
            raise _schema_error("codex-schema-depth-exceeded", depth=depth)
        if isinstance(node, list):
            for item in node:
                visit(item, depth=depth + 1)
            return
        if not isinstance(node, Mapping):
            raise _schema_error("codex-schema-node-invalid")

        unknown = set(node) - _SUPPORTED_SCHEMA_KEYS
        if unknown:
            raise _schema_error("codex-schema-key-unsupported")
        if "$defs" in node and not root:
            raise _schema_error("codex-schema-definitions-nested")

        ref = node.get("$ref")
        if ref is not None:
            if not isinstance(ref, str) or not ref.startswith("#/$defs/"):
                raise _schema_error("codex-schema-ref-invalid")
            ref_name = ref.removeprefix("#/$defs/")
            if ref_name not in defs:
                raise _schema_error("codex-schema-ref-missing")
            if ref_name not in visited_defs and ref_name not in active_defs:
                active_defs.add(ref_name)
                visit(defs[ref_name], depth=depth + 1)
                active_defs.remove(ref_name)
                visited_defs.add(ref_name)

        node_type = node.get("type")
        if node_type is not None:
            if not isinstance(node_type, str) or node_type not in scalar_types:
                raise _schema_error("codex-schema-type-invalid")
        if node_type == "object":
            if node.get("additionalProperties") is not False:
                raise _schema_error("codex-schema-open-object")
            properties = node.get("properties")
            required = node.get("required")
            if not isinstance(properties, Mapping) or not isinstance(required, list):
                raise _schema_error("codex-schema-object-shape-invalid")
            property_names = list(properties)
            if not all(isinstance(name, str) for name in property_names):
                raise _schema_error("codex-schema-property-name-invalid")
            if not all(isinstance(name, str) for name in required):
                raise _schema_error("codex-schema-required-properties-invalid")
            if len(required) != len(set(required)):
                raise _schema_error("codex-schema-required-properties-invalid")
            if set(required) != set(property_names):
                raise _schema_error("codex-schema-required-properties-incomplete")
            object_property_count += len(property_names)
            if object_property_count > 5000:
                raise _schema_error("codex-schema-property-limit-exceeded")
            for child in properties.values():
                visit(child, depth=depth + 1)
        elif node_type == "array":
            if "items" not in node:
                raise _schema_error("codex-schema-array-items-missing")
            visit(node["items"], depth=depth + 1)

        if "additionalProperties" in node and node_type != "object":
            raise _schema_error("codex-schema-additional-properties-nonobject")
        if "properties" in node and node_type != "object":
            raise _schema_error("codex-schema-properties-nonobject")
        if "required" in node and node_type != "object":
            raise _schema_error("codex-schema-required-nonobject")
        if "items" in node and node_type != "array":
            raise _schema_error("codex-schema-items-nonarray")
        if "anyOf" in node:
            branches = node["anyOf"]
            if not isinstance(branches, list) or not branches:
                raise _schema_error("codex-schema-anyof-invalid")
            for branch in branches:
                visit(branch, depth=depth + 1)
        if "enum" in node:
            values = node["enum"]
            if not isinstance(values, list) or not values:
                raise _schema_error("codex-schema-enum-invalid")

    # Check every definition independently.  Definition names are map keys,
    # not schema keywords, so names such as ``title`` remain valid.
    for name, definition in defs.items():
        if not isinstance(name, str):
            raise _schema_error("codex-schema-definition-name-invalid")
        if name in visited_defs or name in active_defs:
            continue
        active_defs.add(name)
        visit(definition, depth=1)
        active_defs.remove(name)
        visited_defs.add(name)
    visit(schema, depth=0, root=True)


def _safe_runtime_diagnostics(
    *,
    process: CodexProcessResult | None = None,
    output_present: bool = False,
    output_size: int = 0,
    **extra: Any,
) -> dict[str, Any]:
    diagnostics = dict(extra)
    if process is not None:
        diagnostics.update(
            {
                "returncode": process.returncode,
                "timed_out": bool(process.timed_out),
                "cancelled": bool(process.cancelled),
                "stdout_length": len(process.stdout or ""),
                "stderr_length": len(process.stderr or ""),
            }
        )
    diagnostics.update({"output_present": output_present, "output_size": output_size})
    return diagnostics


def _unavailable_query(request: Mapping[str, Any], reason: str, diagnostics: Mapping[str, Any]) -> dict[str, Any]:
    payload = {
        "schema_version": QUERY_SCHEMA,
        "request_id": request.get("request_id"),
        "conversation_id": request.get("conversation_id"),
        "source": "host-agent",
        "mode": "UNAVAILABLE",
        "reason": reason,
        "query": str(request.get("query") or ""),
        "answer": {
            "mode": "UNAVAILABLE",
            "reason": reason,
            "summary": "",
            "insights": [],
            "gap": "Codex CLI did not provide a valid handoff envelope.",
            "suggestions": [],
        },
        "evidence": [],
        "tool_trace": [],
    }
    validate_query_response(payload)
    return payload


def _unavailable_metadata(
    request: Mapping[str, Any], reason: str, diagnostics: Mapping[str, Any]
) -> dict[str, Any]:
    policy = request.get("policy")
    preserve = policy.get("preserve_user_fields", True) if isinstance(policy, Mapping) else True
    payload = {
        "schema_version": METADATA_SCHEMA,
        "request_id": request.get("request_id"),
        "mode": "UNAVAILABLE",
        "reason": reason,
        "fields": {},
        "warnings": ["Codex CLI did not provide a valid metadata proposal."],
        "policy": {"preserve_user_fields": bool(preserve)},
    }
    validate_metadata_proposal(payload)
    return payload


def _wire_query_projection(payload: dict[str, Any]) -> dict[str, Any]:
    trace = payload.get("tool_trace", [])
    if not isinstance(trace, list):
        raise ValueError("tool_trace")
    for item in trace:
        if not isinstance(item, dict) or set(item) != set(TRACE_ENTRY_FIELDS):
            raise ValueError("tool_trace")
        if not all(isinstance(item[name], str) and item[name] for name in TRACE_ENTRY_FIELDS):
            raise ValueError("tool_trace")
    return payload


def _wire_metadata_projection(payload: dict[str, Any]) -> dict[str, Any]:
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        raise ValueError("fields")
    if set(fields) != set(SUPPORTED_METADATA_FIELDS):
        raise ValueError("fields")
    policy = payload.get("policy")
    if not isinstance(policy, dict) or set(policy) != {"preserve_user_fields"}:
        raise ValueError("policy")
    if not isinstance(policy["preserve_user_fields"], bool):
        raise ValueError("policy")
    mode = payload.get("mode")
    non_null_fields = {key: value for key, value in fields.items() if value is not None}
    if mode == "UNAVAILABLE" and non_null_fields:
        raise ValueError("fields")
    if mode == "PROPOSED" and not non_null_fields:
        raise ValueError("fields")
    if mode not in {"UNAVAILABLE", "PROPOSED"}:
        raise ValueError("mode")
    next_payload = dict(payload)
    next_payload["fields"] = non_null_fields
    next_payload["policy"] = {"preserve_user_fields": policy["preserve_user_fields"]}
    return next_payload


PROCESS_CLEANUP_WAIT_SECONDS = 0.75


async def _bounded_process_wait(process: asyncio.subprocess.Process) -> bool:
    try:
        await asyncio.wait_for(asyncio.shield(process.wait()), PROCESS_CLEANUP_WAIT_SECONDS)
    except (asyncio.TimeoutError, OSError, ProcessLookupError, RuntimeError):
        return False
    return True


async def _taskkill_tree(pid: int) -> bool:
    """Kill a Windows process tree without blocking the event loop."""

    try:
        completed = await asyncio.wait_for(
            asyncio.to_thread(
                subprocess.run,
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            ),
            PROCESS_CLEANUP_WAIT_SECONDS,
        )
    except (asyncio.TimeoutError, OSError, RuntimeError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


async def _terminate_then_kill(process: asyncio.subprocess.Process) -> None:
    """Terminate the child tree, then use a direct kill fallback, bounded."""

    if process.returncode is not None:
        return
    pid = process.pid
    tree_signal_sent = False
    if pid is not None and os.name == "nt":
        tree_signal_sent = await _taskkill_tree(pid)
    elif pid is not None:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            tree_signal_sent = True
        except (OSError, ProcessLookupError, RuntimeError):
            tree_signal_sent = False
    if not tree_signal_sent:
        try:
            process.terminate()
        except (OSError, ProcessLookupError, RuntimeError):
            pass
    if await _bounded_process_wait(process):
        return
    if pid is not None and os.name != "nt":
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except (OSError, ProcessLookupError, RuntimeError):
            pass
    try:
        process.kill()
    except (OSError, ProcessLookupError, RuntimeError):
        pass
    await _bounded_process_wait(process)


async def default_async_runner(
    argv: list[str],
    stdin: str,
    timeout: float,
    cwd: str | Path | None = None,
    *,
    env: Mapping[str, str] | None = None,
    capture_stdout: bool = False,
) -> CodexProcessResult:
    """Run one child with deterministic stdin and bounded lifecycle cleanup."""

    timeout = _normalize_timeout(timeout)
    create_kwargs: dict[str, Any] = {
        "stdin": asyncio.subprocess.PIPE,
        # Only a query capture gets transient JSONL execution metadata;
        # domain content remains exclusively in --output-last-message.
        "stdout": asyncio.subprocess.PIPE if capture_stdout else subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        create_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        create_kwargs["start_new_session"] = True
    if cwd is not None:
        create_kwargs["cwd"] = os.fspath(cwd)
    if env is not None:
        create_kwargs["env"] = dict(env)
    process = await asyncio.create_subprocess_exec(*argv, **create_kwargs)
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(stdin.encode("utf-8")), timeout=timeout)
    except asyncio.TimeoutError:
        await _terminate_then_kill(process)
        return CodexProcessResult(
            returncode=process.returncode,
            stdout="",
            stderr="",
            timed_out=True,
        )
    except asyncio.CancelledError:
        await _terminate_then_kill(process)
        raise
    except BaseException:
        # Any communicate/wait failure still owns a live process.  Clean it
        # before propagating so the adapter can map the error safely.
        await _terminate_then_kill(process)
        raise
    return CodexProcessResult(
        returncode=process.returncode,
        stdout="" if stdout is None else stdout.decode("utf-8", errors="surrogateescape"),
        stderr="",
    )


ResultModel = TypeVar("ResultModel", bound=BaseModel)


class CodexCLIAdapter:
    """One strict Codex CLI invocation boundary for query or metadata."""

    def __init__(
        self,
        *,
        executable: str | None = None,
        runner: AsyncRunner | Callable[..., Awaitable[CodexProcessResult]] | None = None,
        temp_root: str | Path | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.executable = executable or configured_codex_executable()
        if not self.executable:
            raise CodexAdapterError("codex-executable-unconfigured")
        self.runner = runner or default_async_runner
        self.temp_root = Path(temp_root) if temp_root is not None else None
        self.timeout_seconds = _normalize_timeout(
            configured_timeout_seconds() if timeout_seconds is None else timeout_seconds
        )

    async def query(
        self,
        request: Mapping[str, Any],
        *,
        procedure_prompt: str,
        source_id: str | None = None,
    ) -> CodexAdapterResult:
        return await self._run(
            request,
            procedure_prompt=procedure_prompt,
            source_id=source_id,
            schema_family=QUERY_SCHEMA,
            model_cls=HostAgentQueryResponseV1,
            use_query_projection=True,
        )

    async def metadata(
        self,
        request: Mapping[str, Any],
        *,
        procedure_prompt: str,
        source_id: str | None = None,
    ) -> CodexAdapterResult:
        return await self._run(
            request,
            procedure_prompt=procedure_prompt,
            source_id=source_id,
            schema_family=METADATA_SCHEMA,
            model_cls=HostAgentMetadataProposalV1,
            use_query_projection=False,
        )

    async def _invoke_runner(
        self,
        argv: list[str],
        prompt: str,
        cwd: str | Path,
        *,
        child_env: Mapping[str, str] | None = None,
        capture_stdout: bool = False,
    ) -> CodexProcessResult:
        candidate = self.runner
        run_method = getattr(candidate, "run", None)
        call = run_method if callable(run_method) else candidate
        if call is default_async_runner:
            result = call(
                argv,
                prompt,
                self.timeout_seconds,
                cwd,
                env=child_env,
                capture_stdout=capture_stdout,
            )
        else:
            result = call(argv, prompt, self.timeout_seconds, cwd)
        if inspect.isawaitable(result):
            result = await result
        if not isinstance(result, CodexProcessResult):
            raise CodexAdapterError("codex-runner-result-invalid")
        return result

    async def _run(
        self,
        request: Mapping[str, Any],
        *,
        procedure_prompt: str,
        source_id: str | None,
        schema_family: str,
        model_cls: type[BaseModel],
        use_query_projection: bool,
    ) -> CodexAdapterResult:
        projection: QueryProjectionConfig | None = None
        try:
            if use_query_projection:
                projection = configured_query_projection()
            prompt, prompt_diagnostics = assemble_prompt(
                procedure_prompt,
                request,
                source_id=source_id,
                schema_family=schema_family,
            )
            schema = build_codex_schema(model_cls)
        except CodexAdapterError as exc:
            diagnostics = _sanitize_adapter_diagnostics(exc.diagnostics)
            diagnostics.setdefault("stage", "codex-preflight")
            unavailable = (
                _unavailable_query(request, exc.reason, diagnostics)
                if schema_family == QUERY_SCHEMA
                else _unavailable_metadata(request, exc.reason, diagnostics)
            )
            return CodexAdapterResult(unavailable, exc.reason, diagnostics)

        root = self.temp_root
        diagnostics = _sanitize_adapter_diagnostics(prompt_diagnostics)
        try:
            if root is not None:
                root.mkdir(parents=True, exist_ok=True)
            with _temporary_run_directory(root) as run_path:
                schema_path = run_path / f"schema-{uuid.uuid4().hex}.json"
                output_path = run_path / f"output-{uuid.uuid4().hex}.json"
                schema_path.write_text(
                    json.dumps(schema, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
                )
                if output_path.exists():
                    raise CodexAdapterError("codex-output-target-stale")
                argv = [
                    self.executable,
                    "exec",
                    "-C",
                    str(run_path),
                    "--skip-git-repo-check",
                    "--ignore-user-config",
                    *(["--json"] if projection is not None else []),
                    *_strict_codex_config_args(),
                    *(_query_mcp_config_args(projection) if projection is not None else []),
                    "--output-schema",
                    str(schema_path),
                    "--output-last-message",
                    str(output_path),
                    "--ephemeral",
                    "-",
                ]
                try:
                    child_env = _codex_child_environment()
                    process = await self._invoke_runner(
                        argv,
                        prompt,
                        run_path,
                        child_env=child_env,
                        capture_stdout=projection is not None,
                    )
                except asyncio.CancelledError:
                    diagnostics.update({"stage": "codex-process", "cancelled": True})
                    unavailable = (
                        _unavailable_query(request, "codex-cancelled", diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, "codex-cancelled", diagnostics)
                    )
                    return CodexAdapterResult(unavailable, "codex-cancelled", diagnostics)
                except CodexAdapterError as exc:
                    diagnostics.update(_sanitize_adapter_diagnostics(exc.diagnostics))
                    diagnostics.setdefault("stage", "codex-process")
                    unavailable = (
                        _unavailable_query(request, exc.reason, diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, exc.reason, diagnostics)
                    )
                    return CodexAdapterResult(unavailable, exc.reason, diagnostics)
                except asyncio.TimeoutError:
                    process = CodexProcessResult(returncode=None, timed_out=True)
                except Exception as exc:  # process launch/config failure
                    diagnostics.update({"stage": "codex-process", "error_type": type(exc).__name__})
                    reason = "codex-process-unavailable"
                    unavailable = (
                        _unavailable_query(request, reason, diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, reason, diagnostics)
                    )
                    return CodexAdapterResult(unavailable, reason, diagnostics)

                if process.timed_out:
                    diagnostics.update(_safe_runtime_diagnostics(process=process, output_present=False))
                    reason = "codex-timeout"
                    unavailable = (
                        _unavailable_query(request, reason, diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, reason, diagnostics)
                    )
                    return CodexAdapterResult(unavailable, reason, diagnostics)
                if process.cancelled:
                    diagnostics.update(_safe_runtime_diagnostics(process=process, output_present=False))
                    reason = "codex-cancelled"
                    unavailable = (
                        _unavailable_query(request, reason, diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, reason, diagnostics)
                    )
                    return CodexAdapterResult(unavailable, reason, diagnostics)
                if process.returncode != 0:
                    diagnostics.update(_safe_runtime_diagnostics(process=process, output_present=False))
                    reason = "codex-process-failed"
                    unavailable = (
                        _unavailable_query(request, reason, diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, reason, diagnostics)
                    )
                    return CodexAdapterResult(unavailable, reason, diagnostics)

                output_present = output_path.exists()
                output_size = output_path.stat().st_size if output_present else 0
                diagnostics.update(
                    _safe_runtime_diagnostics(
                        process=process, output_present=output_present, output_size=output_size
                    )
                )
                if not output_present or output_size <= 0 or output_size > MAX_OUTPUT_BYTES:
                    reason = "host-agent-envelope-invalid"
                    unavailable = (
                        _unavailable_query(request, reason, diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, reason, diagnostics)
                    )
                    return CodexAdapterResult(unavailable, reason, diagnostics)
                try:
                    raw_output = output_path.read_text(encoding="utf-8")
                    payload = parse_exact_json_object(raw_output)
                    if schema_family == QUERY_SCHEMA:
                        payload = _wire_query_projection(payload)
                        validate_query_response(payload)
                    else:
                        payload = _wire_metadata_projection(payload)
                        validate_metadata_proposal(payload)
                except (OSError, UnicodeDecodeError, ValueError, TypeError):
                    reason = "host-agent-envelope-invalid"
                    unavailable = (
                        _unavailable_query(request, reason, diagnostics)
                        if schema_family == QUERY_SCHEMA
                        else _unavailable_metadata(request, reason, diagnostics)
                    )
                    return CodexAdapterResult(unavailable, reason, diagnostics)
                if projection is not None and projection.trace_file is not None:
                    try:
                        observed_trace = _parse_completed_mcp_tool_calls(process.stdout)
                        _validate_query_execution_trace(observed_trace)
                        payload["tool_trace"] = _project_query_execution_trace(observed_trace)
                        _write_query_projection_trace(projection.trace_file, observed_trace)
                    except CodexAdapterError as exc:
                        diagnostics.update(_sanitize_adapter_diagnostics(exc.diagnostics))
                        reason = exc.reason
                        unavailable = _unavailable_query(request, reason, diagnostics)
                        return CodexAdapterResult(unavailable, reason, diagnostics)
                return CodexAdapterResult(payload, None, diagnostics)
        except CodexAdapterError as exc:
            diagnostics.update(_sanitize_adapter_diagnostics(exc.diagnostics))
            diagnostics.setdefault("stage", "codex-temp-lifecycle")
            reason = exc.reason
            unavailable = (
                _unavailable_query(request, reason, diagnostics)
                if schema_family == QUERY_SCHEMA
                else _unavailable_metadata(request, reason, diagnostics)
            )
            return CodexAdapterResult(unavailable, reason, diagnostics)
        except (OSError, RuntimeError, ValueError) as exc:
            diagnostics.update(
                {
                    "stage": "codex-temp-lifecycle",
                    "error_type": type(exc).__name__,
                }
            )
            reason = "codex-temp-unavailable"
            unavailable = (
                _unavailable_query(request, reason, diagnostics)
                if schema_family == QUERY_SCHEMA
                else _unavailable_metadata(request, reason, diagnostics)
            )
            return CodexAdapterResult(unavailable, reason, diagnostics)


def load_configured_prompt(kind: str) -> tuple[str, str]:
    """Load caller/configuration-owned UTF-8 procedure text, never a default."""

    path = configured_prompt_path(kind)
    if path is None:
        raise CodexAdapterError("codex-prompt-asset-unconfigured")
    expected_sha256 = os.environ.get(prompt_sha256_env(kind), "")
    if not expected_sha256:
        raise CodexAdapterError("codex-prompt-asset-digest-unconfigured")
    text = load_configured_prompt_path(path, expected_sha256=expected_sha256)
    source_env = prompt_source_id_env(kind)
    source_id = os.environ.get(source_env, "").strip() or f"configured-{kind}-procedure"
    return text, _safe_source_id(source_id, f"configured-{kind}-procedure")


def _read_prompt_asset(path: str | Path) -> tuple[str, str]:
    """Read one caller-owned UTF-8 asset and return text plus SHA-256."""

    candidate = Path(path)
    try:
        metadata = candidate.stat()
        if not stat.S_ISREG(metadata.st_mode):
            raise CodexAdapterError("codex-prompt-asset-unavailable")
        size = metadata.st_size
        if size > MAX_PROMPT_FILE_BYTES:
            raise CodexAdapterError("codex-prompt-asset-too-large")
        with candidate.open("rb") as handle:
            raw = handle.read(MAX_PROMPT_FILE_BYTES + 1)
        if len(raw) > MAX_PROMPT_FILE_BYTES:
            raise CodexAdapterError("codex-prompt-asset-too-large")
        return raw.decode("utf-8"), hashlib.sha256(raw).hexdigest()
    except CodexAdapterError:
        raise
    except (OSError, UnicodeError) as exc:
        raise CodexAdapterError("codex-prompt-asset-unavailable") from exc


def _normalize_expected_sha256(value: str) -> str:
    if re.fullmatch(r"[0-9a-fA-F]{64}", value or "") is None:
        raise CodexAdapterError("codex-prompt-asset-digest-invalid")
    return value.lower()


def load_configured_prompt_path(
    path: str | Path, *, expected_sha256: str | None = None
) -> str:
    """Read a caller-owned UTF-8 asset, optionally enforcing its SHA-256."""

    text, digest = _read_prompt_asset(path)
    if expected_sha256 is not None:
        if digest != _normalize_expected_sha256(expected_sha256):
            raise CodexAdapterError("codex-prompt-asset-digest-mismatch")
    return text


def probe_configured_prompt_path(
    path: str | Path, *, expected_sha256: str | None = None
) -> str | None:
    """Bounded health probe; returns a stable failure reason or ``None``."""

    try:
        _text, digest = _read_prompt_asset(path)
        if expected_sha256 is not None and digest != _normalize_expected_sha256(expected_sha256):
            return "codex-prompt-asset-digest-mismatch"
    except CodexAdapterError as exc:
        return exc.reason
    return None


@dataclass(frozen=True)
class _BoundedHealthCommandResult:
    returncode: int | None
    stdout: bytes
    timed_out: bool
    overflowed: bool
    reason: str | None


def _health_process_wait(process: subprocess.Popen, timeout: float) -> bool:
    try:
        process.wait(timeout=timeout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False
    return True


def _terminate_health_process_tree(process: subprocess.Popen) -> None:
    """Terminate a synchronous health probe and descendants within a budget."""

    pid = getattr(process, "pid", None)
    tree_signal_sent = False
    if pid is not None and os.name == "nt":
        try:
            completed = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=PROCESS_CLEANUP_WAIT_SECONDS,
            )
            tree_signal_sent = completed.returncode == 0
        except (OSError, ValueError, subprocess.SubprocessError):
            tree_signal_sent = False
    elif pid is not None:
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
            tree_signal_sent = True
        except (OSError, ProcessLookupError, RuntimeError):
            tree_signal_sent = False

    if not tree_signal_sent:
        try:
            process.terminate()
        except (OSError, ProcessLookupError, RuntimeError, ValueError):
            pass
    if _health_process_wait(process, PROCESS_CLEANUP_WAIT_SECONDS):
        return

    if pid is not None and os.name != "nt":
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except (OSError, ProcessLookupError, RuntimeError):
            pass
    try:
        process.kill()
    except (OSError, ProcessLookupError, RuntimeError, ValueError):
        pass
    _health_process_wait(process, PROCESS_CLEANUP_WAIT_SECONDS)


def _bounded_health_command(
    argv: list[str],
    *,
    output_limit: int,
    timeout: float,
    capture_stdout: bool = True,
    reason_prefix: str = "version",
    timeout_reason: str | None = None,
    overflow_reason: str | None = None,
    error_reason: str | None = None,
    env: Mapping[str, str] | None = None,
) -> _BoundedHealthCommandResult:
    """Run a synchronous preflight with bounded output and tree cleanup."""

    timeout_failure_reason = timeout_reason or f"{reason_prefix}-command-timeout"
    overflow_failure_reason = overflow_reason or f"{reason_prefix}-output-too-large"
    error_failure_reason = error_reason or f"{reason_prefix}-command-error"

    try:
        bounded_limit = int(output_limit)
        bounded_timeout = float(timeout)
    except (TypeError, ValueError, OverflowError):
        return _BoundedHealthCommandResult(
            returncode=None,
            stdout=b"",
            timed_out=False,
            overflowed=False,
            reason=error_failure_reason,
        )
    if bounded_limit < 0 or not math.isfinite(bounded_timeout) or bounded_timeout <= 0:
        return _BoundedHealthCommandResult(
            returncode=None,
            stdout=b"",
            timed_out=False,
            overflowed=False,
            reason=error_failure_reason,
        )

    popen_kwargs: dict[str, Any] = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.PIPE if capture_stdout else subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if env is not None:
        popen_kwargs["env"] = dict(env)
    if os.name == "nt":
        creation_flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        if creation_flags:
            popen_kwargs["creationflags"] = creation_flags
    else:
        popen_kwargs["start_new_session"] = True

    try:
        process = subprocess.Popen(argv, **popen_kwargs)
    except (OSError, ValueError, subprocess.SubprocessError):
        return _BoundedHealthCommandResult(
            returncode=None,
            stdout=b"",
            timed_out=False,
            overflowed=False,
            reason=error_failure_reason,
        )

    stdout_handle = process.stdout if capture_stdout else None
    reader_thread: threading.Thread | None = None
    reader_queue: queue.Queue[tuple[bytes, Exception | None]] | None = None
    stdout = b""
    returncode: int | None = None
    timed_out = False
    overflowed = False
    reason: str | None = None

    if capture_stdout and stdout_handle is not None:
        reader_queue = queue.Queue(maxsize=1)

        def _read_limited() -> None:
            try:
                read_method = getattr(stdout_handle, "read1", stdout_handle.read)
                captured = bytearray()
                while len(captured) < bounded_limit + 1:
                    chunk = read_method(bounded_limit + 1 - len(captured))
                    if not chunk:
                        break
                    if not isinstance(chunk, bytes):
                        chunk = bytes(chunk)
                    captured.extend(chunk[: bounded_limit + 1 - len(captured)])
                reader_queue.put((bytes(captured), None))
            except Exception as exc:  # pragma: no cover - platform pipe edge
                try:
                    reader_queue.put((b"", exc))
                except Exception:
                    pass

        reader_thread = threading.Thread(
            target=_read_limited,
            name="life-index-health-reader",
            daemon=True,
        )
        reader_thread.start()

    try:
        if reader_queue is not None:
            deadline = time.monotonic() + bounded_timeout
            try:
                stdout, read_error = reader_queue.get(timeout=bounded_timeout)
            except queue.Empty:
                read_error = None
                timed_out = True
                reason = timeout_failure_reason
            if not timed_out:
                if len(stdout) > bounded_limit:
                    overflowed = True
                    reason = overflow_failure_reason
                elif read_error is not None:
                    reason = error_failure_reason
                else:
                    remaining = deadline - time.monotonic()
                    try:
                        returncode = process.wait(timeout=max(0.0, remaining))
                    except subprocess.TimeoutExpired:
                        timed_out = True
                        reason = timeout_failure_reason
                    except (OSError, ValueError):
                        reason = error_failure_reason
        else:
            try:
                returncode = process.wait(timeout=bounded_timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
                reason = timeout_failure_reason
            except (OSError, ValueError):
                reason = error_failure_reason

        if reason is not None:
            _terminate_health_process_tree(process)
        if returncode is None:
            returncode = process.poll()
    finally:
        if stdout_handle is not None:
            try:
                stdout_handle.close()
            except (OSError, ValueError):
                pass
        if reader_thread is not None:
            reader_thread.join(PROCESS_CLEANUP_WAIT_SECONDS)
            if reader_thread.is_alive() and stdout_handle is not None:
                try:
                    stdout_handle.close()
                except (OSError, ValueError):
                    pass
                reader_thread.join(PROCESS_CLEANUP_WAIT_SECONDS)

    return _BoundedHealthCommandResult(
        returncode=returncode,
        stdout=stdout[: bounded_limit + 1],
        timed_out=timed_out,
        overflowed=overflowed,
        reason=reason,
    )


def _numeric_release_version(value: object) -> tuple[int, int, int] | None:
    if not isinstance(value, str) or re.fullmatch(r"\d+\.\d+\.\d+", value) is None:
        return None
    parts = value.split(".")
    return int(parts[0]), int(parts[1]), int(parts[2])


def _projection_preflight_status(projection: QueryProjectionConfig) -> tuple[str, str]:
    """Check the configured isolated Python without exposing child output."""

    completed = _bounded_health_command(
        [str(projection.python), "-I", "-c", PROJECTION_PREFLIGHT_CODE],
        output_limit=MAX_PROJECTION_PREFLIGHT_OUTPUT_BYTES,
        timeout=HEALTH_COMMAND_TIMEOUT_SECONDS,
        capture_stdout=True,
        reason_prefix="projection-preflight",
        timeout_reason="projection-preflight-timeout",
        overflow_reason="projection-preflight-output-too-large",
        error_reason="projection-preflight-command-error",
        env=_projection_preflight_environment(projection),
    )
    if completed.reason is not None:
        return "not-ready", completed.reason
    if completed.returncode != 0:
        return "not-ready", "projection-preflight-command-failed"
    try:
        payload = json.loads(completed.stdout.decode("utf-8"), parse_constant=_reject_non_json_constant)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError):
        return "not-ready", "projection-preflight-invalid-result"
    if not isinstance(payload, dict):
        return "not-ready", "projection-preflight-invalid-result"
    if payload.get("schema_version") != PROJECTION_PREFLIGHT_SCHEMA_VERSION:
        return "not-ready", "projection-preflight-invalid-result"
    if type(payload.get("ok")) is not bool:
        return "not-ready", "projection-preflight-invalid-result"
    if payload["ok"] is False:
        if set(payload) != {"schema_version", "ok", "reason"}:
            return "not-ready", "projection-preflight-invalid-result"
        reason = payload.get("reason")
        if reason not in _PROJECTION_PREFLIGHT_CHILD_FAILURE_REASONS:
            return "not-ready", "projection-preflight-invalid-result"
        return "not-ready", reason
    if set(payload) != {"schema_version", "ok", "life_index_version", "mcp_version"}:
        return "not-ready", "projection-preflight-invalid-result"
    life_index_version = _numeric_release_version(payload.get("life_index_version"))
    minimum_version = _numeric_release_version(AI_PROJECTION_MIN_LIFE_INDEX_VERSION)
    if life_index_version is None or minimum_version is None:
        return "not-ready", "projection-preflight-invalid-result"
    if life_index_version < minimum_version:
        return "not-ready", "life-index-version-too-old"
    if payload.get("mcp_version") != AI_PROJECTION_MCP_VERSION:
        return "not-ready", "mcp-version-mismatch"
    return "ok", "installed-projection-ready"


def _health_version_check(executable: str) -> tuple[str, str]:
    completed = _bounded_health_command(
        [executable, "--version"],
        output_limit=MAX_HEALTH_VERSION_OUTPUT_BYTES,
        timeout=HEALTH_COMMAND_TIMEOUT_SECONDS,
        capture_stdout=True,
        reason_prefix="version",
    )
    if completed.reason is not None:
        return "not-ready", completed.reason
    if completed.returncode != 0:
        return "not-ready", "version-command-failed"
    output = completed.stdout.decode("utf-8", errors="replace")
    versions = re.findall(r"(?<![0-9A-Za-z.+-])\d+\.\d+\.\d+(?![0-9A-Za-z.+-])", output)
    if len(versions) != 1 or versions[0] not in SUPPORTED_CODEX_VERSIONS:
        return "not-ready", "unsupported-version"
    return "ok", "supported-version"


def _health_login_check(executable: str) -> tuple[str, str]:
    completed = _bounded_health_command(
        [executable, "login", "status"],
        output_limit=0,
        timeout=HEALTH_COMMAND_TIMEOUT_SECONDS,
        capture_stdout=False,
        reason_prefix="login-status",
        timeout_reason="login-status-timeout",
        error_reason="login-status-error",
    )
    if completed.reason is not None:
        return "not-ready", completed.reason
    if completed.returncode != 0:
        return "not-ready", "login-status-failed"
    return "ok", "login-status-ok"


def codex_health_payload() -> dict[str, Any]:
    """Return configuration/readiness metadata without running Codex/model."""

    try:
        executable = configured_codex_executable()
        executable_ok = bool(shutil.which(executable))
        checks: list[dict[str, Any]] = [
            {
                "name": "adapter_kind",
                "status": "ok",
                "kind": CODEX_CLI_KIND,
                "reason": "configured",
            },
            {
                "name": "codex_executable",
                "status": "ok" if executable_ok else "not-ready",
                "configured": bool(os.environ.get(CODEX_EXECUTABLE_ENV) or os.environ.get(CODEX_CLI_ENV)),
                "reason": "configured" if executable_ok else "command-not-found",
            },
        ]
        if executable_ok:
            version_status, version_reason = _health_version_check(executable)
            login_status, login_reason = _health_login_check(executable)
        else:
            version_status, version_reason = "not-ready", "executable-not-found"
            login_status, login_reason = "not-ready", "executable-not-found"
        checks.extend(
            [
                {
                    "name": "codex_version",
                    "status": version_status,
                    "reason": version_reason,
                },
                {
                    "name": "codex_login_status",
                    "status": login_status,
                    "reason": login_reason,
                },
            ]
        )
        try:
            projection = configured_query_projection()
        except CodexAdapterError as exc:
            query_channel_status, query_channel_reason = "not-ready", exc.reason
        else:
            query_channel_status, query_channel_reason = _projection_preflight_status(projection)
        checks.append(
            {
                "name": "query_tool_channel",
                "status": query_channel_status,
                "reason": query_channel_reason,
            }
        )
        for kind in ("query", "metadata"):
            path = configured_prompt_path(kind)
            if path is None:
                checks.append(
                    {
                        "name": f"{kind}_prompt_asset",
                        "status": "not-ready",
                        "configured": False,
                        "reason": "prompt-asset-unconfigured",
                    }
                )
                continue
            expected_sha256 = os.environ.get(prompt_sha256_env(kind), "")
            if not expected_sha256:
                checks.append(
                    {
                        "name": f"{kind}_prompt_asset",
                        "status": "not-ready",
                        "configured": True,
                        "reason": "prompt-asset-digest-unconfigured",
                    }
                )
                continue
            probe_reason = probe_configured_prompt_path(path, expected_sha256=expected_sha256)
            if probe_reason is None:
                status = "ok"
                reason = "configured"
            else:
                status = "not-ready"
                reason = probe_reason
            checks.append(
                {
                    "name": f"{kind}_prompt_asset",
                    "status": status,
                    "configured": True,
                    "reason": reason,
                    "source_id": _safe_source_id(
                        os.environ.get(prompt_source_id_env(kind)),
                        f"configured-{kind}-procedure",
                    ),
                }
            )
        checks.append(
            {
                "name": "codex_schema_acceptance",
                "status": "unverified",
                "reason": "live-model-invocation-advisory-unverified",
                "advisory": True,
            }
        )
        ready = all(
            item["status"] == "ok"
            for item in checks
            if item["name"] != "codex_schema_acceptance"
        )
        return {
            "schema_version": "gui.host_agent.health.v1",
            "running": executable_ok,
            "ready": ready,
            "degraded": not ready,
            "mode": "READY" if ready else "NOT_READY",
            "reason": (
                "configured-runtime-preflight-passed" if ready else "codex-cli-check-failed"
            ),
            "runtime": {"kind": CODEX_CLI_KIND, "interface_version": "v1"},
            "checks": checks,
        }
    except Exception:
        return {
            "schema_version": "gui.host_agent.health.v1",
            "running": False,
            "ready": False,
            "degraded": True,
            "mode": "UNAVAILABLE",
            "reason": "host-agent-adapter-kind-invalid",
            "runtime": {"kind": CODEX_CLI_KIND, "interface_version": "v1"},
            "checks": [],
        }


__all__ = [
    "ADAPTER_KIND_ENV",
    "REFERENCE_COMMAND_KIND",
    "CODEX_CLI_KIND",
    "CODEX_EXECUTABLE_ENV",
    "QUERY_PROJECTION_ROOT_ENV",
    "QUERY_PROJECTION_PYTHON_ENV",
    "QUERY_PROJECTION_DATA_DIR_ENV",
    "QUERY_PROJECTION_CONFIG_DIR_ENV",
    "QUERY_PROJECTION_CACHE_DIR_ENV",
    "QUERY_PROJECTION_TMPDIR_ENV",
    "QUERY_PROJECTION_TRACE_FILE_ENV",
    "QUERY_MCP_TOOL_NAMES",
    "QUERY_PROMPT_SHA256_ENV",
    "METADATA_PROMPT_SHA256_ENV",
    "SUPPORTED_CODEX_VERSIONS",
    "HEALTH_COMMAND_TIMEOUT_SECONDS",
    "MAX_HEALTH_VERSION_OUTPUT_BYTES",
    "AI_PROJECTION_MIN_LIFE_INDEX_VERSION",
    "AI_PROJECTION_MCP_VERSION",
    "PROJECTION_PREFLIGHT_SCHEMA_VERSION",
    "MAX_PROJECTION_PREFLIGHT_OUTPUT_BYTES",
    "QUERY_PROMPT_FILE_ENV",
    "METADATA_PROMPT_FILE_ENV",
    "MAX_PROCEDURE_PROMPT_CHARS",
    "MAX_REQUEST_JSON_CHARS",
    "MIN_TIMEOUT_SECONDS",
    "MAX_TIMEOUT_SECONDS",
    "MAX_PROMPT_FILE_BYTES",
    "SUPPORTED_METADATA_FIELDS",
    "CodexAdapterError",
    "CodexProcessResult",
    "CodexAdapterResult",
    "QueryProjectionConfig",
    "CodexCLIAdapter",
    "adapter_kind",
    "configured_codex_executable",
    "configured_timeout_seconds",
    "configured_query_projection",
    "assemble_prompt",
    "build_codex_schema",
    "lint_codex_schema",
    "validate_projected_payload",
    "default_async_runner",
    "configured_prompt_path",
    "prompt_sha256_env",
    "load_configured_prompt",
    "load_configured_prompt_path",
    "probe_configured_prompt_path",
    "codex_health_payload",
]
