"""Optional host-side reference bridge for user-provided agent runtimes.

This process is deliberately outside the GUI backend contract. It adapts a
configured runtime command to the runtime-neutral Host Agent Handoff Interface
without choosing Life Index tools, classifying user intent, or synthesizing
answers itself.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import signal
import shutil
import subprocess
import time
import uuid
from collections.abc import AsyncIterator, Iterator, Mapping
from pathlib import Path
from string import Template
from typing import Any

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from host_agent_bridge.contracts import (
    HEALTH_SCHEMA,
    METADATA_SCHEMA,
    QUERY_SCHEMA,
    parse_exact_json_object,
    validate_health,
    validate_metadata_proposal,
    validate_query_response,
)
from host_agent_bridge.codex_cli_adapter import (
    CODEX_CLI_KIND,
    CodexAdapterError,
    CodexCLIAdapter,
    adapter_kind,
    codex_health_payload,
    configured_codex_executable,
    configured_timeout_seconds,
    load_configured_prompt,
)

RUNTIME_UNCONFIGURED_REASON = "host-agent-runtime-unconfigured"
ADAPTER_KIND_INVALID_REASON = "host-agent-adapter-kind-invalid"
INVALID_ENVELOPE_REASON = "host-agent-envelope-invalid"
DEFAULT_TIMEOUT_SECONDS = 600.0
PROCESS_CLEANUP_WAIT_SECONDS = 0.75
QUERY_OUTPUT_MODE_ENV = "LIFE_INDEX_HOST_AGENT_QUERY_OUTPUT_MODE"
NATIVE_MARKDOWN_OUTPUT_MODE = "native-markdown"
EXACT_JSON_OUTPUT_MODE = "exact-json"
INVALID_QUERY_OUTPUT_MODE_REASON = "host-agent-query-output-mode-invalid"
RESERVED_QUERY_FIELDS = frozenset({"answer_origin"})
PROMPT_DIR = Path(__file__).with_name("prompts")
DEFAULT_QUERY_PROMPT_TEMPLATE = """You are the user-provided Host Agent for Life Index GUI Handoff.
Return only a JSON object matching schema_version gui.host_agent.query_response.v1.
$tool_hint
Request JSON:
$request_json
"""
DEFAULT_NATIVE_QUERY_PROMPT_TEMPLATE = """You are the user-provided Host Agent for Life Index GUI Handoff.
Use the Life Index tools available to you to answer the user's query.
Return the answer as natural language or Markdown. If you cite a journal, use a canonical
GUI link in the form [label](/journal/safe/id). Do not write or edit journal data.
$tool_hint
Query:
$query
"""
DEFAULT_METADATA_PROMPT_TEMPLATE = """You are the user-provided Host Agent for Life Index metadata proposal.
Return only the exact v1 JSON object matching schema_version gui.host_agent.metadata_proposal.v1.
The fields map accepts exactly: title, abstract, project, topics, moods, people, tags, links.
Use plural topics and moods in the envelope. Unknown field keys (including weather) are protocol errors.
Propose every canonical field that the draft content or existing metadata reliably supports; do not omit a supported field merely because it is optional.
The title value must be 1-20 characters, concise, and grounded in the draft.
You must count the characters in the final title value before returning the JSON.
If it exceeds 20 characters, semantically compress it (for example, remove redundant modifiers), shorten it and count again until it is 20 characters or fewer. Never return an overlong title.
When the draft supports tags, propose 1-5 reusable keywords or themes.
For people, include every person explicitly named in the draft.
When a field has no grounded support, leave it empty; never invent metadata.
$tool_hint
Request JSON:
$request_json
"""
app = FastAPI(title="Life Index Host Agent Reference Bridge")


class BridgeQueryRequest(BaseModel):
    query: str
    request_id: str | None = None
    conversation_id: str | None = None
    intent: str = "grounded_query"
    context: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)


class BridgeMetadataRequest(BaseModel):
    request_id: str | None = None
    draft: dict[str, Any]
    policy: dict[str, Any] = Field(default_factory=lambda: {"preserve_user_fields": True})


class RuntimeResult(BaseModel):
    stdout: str
    stderr: str
    returncode: int
    timed_out: bool = False


def _runtime_argv() -> list[str] | None:
    raw_json = os.environ.get("LIFE_INDEX_HOST_AGENT_ARGV_JSON", "").strip()
    if raw_json:
        parsed = json.loads(raw_json)
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise ValueError("LIFE_INDEX_HOST_AGENT_ARGV_JSON must be a JSON array of strings")
        return parsed

    raw_command = os.environ.get("LIFE_INDEX_HOST_AGENT_COMMAND", "").strip()
    if raw_command:
        return shlex.split(raw_command, posix=os.name != "nt")

    return None


def _runtime_cwd() -> str | None:
    value = os.environ.get("LIFE_INDEX_HOST_AGENT_CWD", "").strip()
    return value or None


def _runtime_timeout() -> float:
    value = os.environ.get("LIFE_INDEX_HOST_AGENT_TIMEOUT_SECONDS", "").strip()
    if not value:
        return DEFAULT_TIMEOUT_SECONDS
    try:
        timeout = float(value)
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS
    return max(1.0, timeout)


def _tool_hint_section() -> str:
    hint = os.environ.get("LIFE_INDEX_HOST_AGENT_TOOL_HINT", "").strip()
    return f"Runtime tool hint:\n{hint}\n" if hint else ""


def _prompt_template(filename: str, env_name: str, fallback: str) -> str:
    configured = os.environ.get(env_name, "").strip()
    path = Path(configured) if configured else PROMPT_DIR / filename
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return fallback


def _render_prompt_template(
    filename: str,
    env_name: str,
    fallback: str,
    payload: dict[str, Any],
) -> str:
    template = Template(_prompt_template(filename, env_name, fallback))
    return template.safe_substitute(
        tool_hint=_tool_hint_section().rstrip(),
        request_json=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        query=str(payload.get("query") or ""),
    )


def _query_output_mode() -> str:
    """Select the opt-in query framing without affecting metadata or named adapters."""

    value = os.environ.get(QUERY_OUTPUT_MODE_ENV, "").strip().lower()
    if not value or value == EXACT_JSON_OUTPUT_MODE:
        return EXACT_JSON_OUTPUT_MODE
    if value == NATIVE_MARKDOWN_OUTPUT_MODE:
        return NATIVE_MARKDOWN_OUTPUT_MODE
    raise ValueError(INVALID_QUERY_OUTPUT_MODE_REASON)


def _build_runtime_env() -> dict[str, str]:
    env = dict(os.environ)
    data_dir = os.environ.get("LIFE_INDEX_HOST_AGENT_DATA_DIR") or os.environ.get("LIFE_INDEX_DATA_DIR")
    if data_dir:
        env["LIFE_INDEX_DATA_DIR"] = data_dir
    validation_mode = os.environ.get("LIFE_INDEX_VALIDATION_MODE")
    if validation_mode:
        env["LIFE_INDEX_VALIDATION_MODE"] = validation_mode
    return env


def _argv_with_prompt(argv: list[str], prompt: str) -> list[str]:
    replaced = [arg.replace("{prompt}", prompt) for arg in argv]
    if replaced == argv and "{prompt}" not in " ".join(argv):
        return [*argv, prompt]
    return replaced


def _command_exists(argv: list[str]) -> bool:
    if not argv:
        return False
    executable = argv[0]
    if Path(executable).exists():
        return True
    return shutil.which(executable) is not None


def unavailable_health(reason: str = RUNTIME_UNCONFIGURED_REASON) -> dict[str, Any]:
    return {
        "schema_version": HEALTH_SCHEMA,
        "running": False,
        "ready": False,
        "degraded": True,
        "mode": "UNAVAILABLE",
        "reason": reason,
        "runtime": {"kind": "host-agent-reference-bridge", "interface_version": "v1"},
        "checks": [{"name": "runtime_command", "status": "unavailable", "reason": reason}],
    }


def _check_runtime() -> dict[str, Any]:
    try:
        argv = _runtime_argv()
    except Exception as exc:
        payload = unavailable_health("host-agent-runtime-config-invalid")
        payload["checks"][0]["error_type"] = type(exc).__name__
        return payload

    if not argv:
        return unavailable_health()

    checks: list[dict[str, Any]] = []
    command_ok = _command_exists(argv)
    checks.append(
        {
            "name": "runtime_command",
            "status": "ok" if command_ok else "unavailable",
            "reason": "configured" if command_ok else "command-not-found",
        }
    )

    cwd = _runtime_cwd()
    if cwd:
        cwd_ok = Path(cwd).exists()
        checks.append(
            {
                "name": "runtime_cwd",
                "status": "ok" if cwd_ok else "not-ready",
                "path": cwd,
                "reason": "exists" if cwd_ok else "missing",
            }
        )

    data_dir = os.environ.get("LIFE_INDEX_HOST_AGENT_DATA_DIR") or os.environ.get("LIFE_INDEX_DATA_DIR")
    if data_dir:
        data_ok = Path(data_dir).exists()
        checks.append(
            {
                "name": "data_dir",
                "status": "ok" if data_ok else "not-ready",
                "path": data_dir,
                "reason": "exists" if data_ok else "missing",
            }
        )

    ready = all(check["status"] == "ok" for check in checks)
    return {
        "schema_version": HEALTH_SCHEMA,
        "running": command_ok,
        "ready": ready,
        "degraded": not ready,
        "mode": "READY" if ready else "NOT_READY",
        "reason": "configured" if ready else "runtime-check-failed",
        "runtime": {"kind": "host-agent-reference-bridge", "interface_version": "v1"},
        "checks": checks,
    }


def _selected_adapter_kind() -> str:
    """Resolve the explicitly configured bridge adapter kind."""

    try:
        return adapter_kind()
    except CodexAdapterError as exc:
        raise CodexAdapterError(ADAPTER_KIND_INVALID_REASON) from exc


def _unavailable_query_for_codex(
    request: BridgeQueryRequest,
    reason: str,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    diagnostics = _sanitize_codex_diagnostics(diagnostics)
    payload = {
        "schema_version": QUERY_SCHEMA,
        "request_id": request.request_id,
        "conversation_id": request.conversation_id,
        "source": "host-agent",
        "mode": "UNAVAILABLE",
        "reason": reason,
        "query": request.query,
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
    if diagnostics:
        payload["diagnostics"] = diagnostics
    try:
        validate_query_response(payload)
    except ValueError:
        # This helper is internal and only constructs the canonical unavailable
        # shape; fail closed rather than emitting a malformed terminal frame.
        payload.pop("diagnostics", None)
    return payload


_CODEX_DIAGNOSTIC_KEYS = frozenset(
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
    }
)
_CODEX_DIAGNOSTIC_STRING_KEYS = frozenset(
    {"source_id", "assembly_version", "schema_family", "stage", "reason", "error_type"}
)
_CODEX_DIAGNOSTIC_INT_KEYS = frozenset(
    {
        "input_length",
        "retained_length",
        "returncode",
        "output_size",
        "stdout_length",
        "stderr_length",
        "request_length",
        "request_cap",
    }
)
_CODEX_DIAGNOSTIC_BOOL_KEYS = frozenset(
    {"truncated", "timed_out", "cancelled", "output_present"}
)


def _sanitize_codex_diagnostics(diagnostics: Mapping[str, Any] | None) -> dict[str, Any]:
    """Project adapter diagnostics through one narrow, body-free allowlist."""

    if not isinstance(diagnostics, Mapping):
        return {}
    safe: dict[str, Any] = {}
    for key, value in diagnostics.items():
        if key not in _CODEX_DIAGNOSTIC_KEYS:
            continue
        if key in _CODEX_DIAGNOSTIC_STRING_KEYS:
            if not isinstance(value, str) or len(value) > 128:
                continue
            if key == "source_id" and re.fullmatch(r"[A-Za-z0-9._-]+", value) is None:
                continue
            if key != "source_id" and re.fullmatch(r"[A-Za-z0-9._:-]+", value) is None:
                continue
            safe[key] = value
        elif key in _CODEX_DIAGNOSTIC_INT_KEYS:
            if isinstance(value, bool) or not isinstance(value, int) or abs(value) > 10_000_000:
                continue
            safe[key] = value
        elif key in _CODEX_DIAGNOSTIC_BOOL_KEYS and isinstance(value, bool):
            safe[key] = value
        elif key == "assembly_steps" and isinstance(value, list):
            steps = [
                item
                for item in value
                if isinstance(item, str)
                and item in {"procedure-prefix", "wire-format-instruction", "canonical-request-json"}
            ]
            safe[key] = steps[:8]
    return safe


def _attach_codex_diagnostics(payload: dict[str, Any], diagnostics: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    # A named adapter is untrusted at this relay boundary too: sanitize an
    # envelope-supplied diagnostics object before merging adapter diagnostics.
    existing = payload.get("diagnostics")
    safe_diagnostics = _sanitize_codex_diagnostics(existing if isinstance(existing, Mapping) else None)
    safe_diagnostics.update(_sanitize_codex_diagnostics(diagnostics))
    next_payload = dict(payload)
    if not safe_diagnostics:
        next_payload.pop("diagnostics", None)
        return next_payload
    next_payload["diagnostics"] = safe_diagnostics
    return next_payload


def _without_reserved_query_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove bridge-owned query fields from untrusted runtime output."""

    return {key: value for key, value in payload.items() if key not in RESERVED_QUERY_FIELDS}


def _validate_codex_query_payload(
    request: BridgeQueryRequest,
    payload: object,
    diagnostics: Mapping[str, Any] | None,
) -> dict[str, Any]:
    safe_diagnostics = _sanitize_codex_diagnostics(diagnostics)
    if not isinstance(payload, dict):
        return _unavailable_query_for_codex(
            request, INVALID_ENVELOPE_REASON, {"stage": "codex-result-validate", **safe_diagnostics}
        )
    candidate = _without_reserved_query_fields(_attach_codex_diagnostics(payload, safe_diagnostics))
    try:
        validate_query_response(candidate)
        json.dumps(candidate, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)
    except (TypeError, ValueError, OverflowError):
        return _unavailable_query_for_codex(
            request, INVALID_ENVELOPE_REASON, {"stage": "codex-result-validate", **safe_diagnostics}
        )
    return candidate


def _validate_codex_metadata_payload(
    request: BridgeMetadataRequest,
    payload: object,
    diagnostics: Mapping[str, Any] | None,
) -> dict[str, Any]:
    safe_diagnostics = _sanitize_codex_diagnostics(diagnostics)
    if not isinstance(payload, dict):
        return _unavailable_metadata_for_codex(
            request,
            INVALID_ENVELOPE_REASON,
            diagnostics={"stage": "codex-result-validate", **safe_diagnostics},
        )
    candidate = _attach_codex_diagnostics(payload, safe_diagnostics)
    try:
        validate_metadata_proposal(candidate)
        json.dumps(candidate, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False)
    except (TypeError, ValueError, OverflowError):
        return _unavailable_metadata_for_codex(
            request,
            INVALID_ENVELOPE_REASON,
            diagnostics={"stage": "codex-result-validate", **safe_diagnostics},
        )
    return candidate


def _query_prompt(request: BridgeQueryRequest) -> str:
    payload = request.model_dump()
    if _query_output_mode() == NATIVE_MARKDOWN_OUTPUT_MODE:
        return _render_prompt_template(
            "query-native.md",
            "LIFE_INDEX_HOST_AGENT_QUERY_NATIVE_PROMPT_TEMPLATE",
            DEFAULT_NATIVE_QUERY_PROMPT_TEMPLATE,
            payload,
        )
    return _render_prompt_template(
        "query.md",
        "LIFE_INDEX_HOST_AGENT_QUERY_PROMPT_TEMPLATE",
        DEFAULT_QUERY_PROMPT_TEMPLATE,
        payload,
    )


def _metadata_prompt(request: BridgeMetadataRequest) -> str:
    payload = request.model_dump()
    return _render_prompt_template(
        "metadata.md",
        "LIFE_INDEX_HOST_AGENT_METADATA_PROMPT_TEMPLATE",
        DEFAULT_METADATA_PROMPT_TEMPLATE,
        payload,
    )


def _run_runtime_blocking(prompt: str) -> RuntimeResult:
    argv = _runtime_argv()
    if not argv:
        raise RuntimeError(RUNTIME_UNCONFIGURED_REASON)

    command = _argv_with_prompt(argv, prompt)
    try:
        completed = subprocess.run(
            command,
            cwd=_runtime_cwd(),
            env=_build_runtime_env(),
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=_runtime_timeout(),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        return RuntimeResult(stdout=exc.stdout or "", stderr=exc.stderr or "", returncode=124, timed_out=True)

    return RuntimeResult(stdout=completed.stdout, stderr=completed.stderr, returncode=completed.returncode)


async def _run_runtime(prompt: str) -> RuntimeResult:
    return await asyncio.to_thread(_run_runtime_blocking, prompt)


def _stdout_line_is_json_start(text: str) -> bool:
    stripped = text.lstrip()
    return stripped.startswith("{") or stripped.startswith("```")


TERMINAL_BOX_CHARS = set("─━┌┐└┘╭╮╰╯│┬┴┼├┤")
TERMINAL_CHROME_PREFIXES = (
    "Query:",
    "Initializing agent",
    "Resume this session with:",
    "hermes --resume",
    "Session:",
    "Duration:",
    "Messages:",
)


def _clean_runtime_delta_line(text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return ""
    if stripped.startswith(TERMINAL_CHROME_PREFIXES):
        return ""
    if all(char in TERMINAL_BOX_CHARS or char.isspace() for char in stripped):
        return ""
    if stripped[0] in TERMINAL_BOX_CHARS and ("Reasoning" in stripped or "Hermes" in stripped):
        return ""
    if stripped.startswith("│") and stripped.endswith("│"):
        stripped = stripped.strip("│").strip()
    return f"{stripped}\n" if stripped else ""


def _is_runtime_prompt_echo_start(text: str) -> bool:
    return text.strip().startswith("Query:")


def _is_runtime_reasoning_header(text: str) -> bool:
    stripped = text.strip()
    return "Reasoning" in stripped and (
        stripped.startswith("Reasoning")
        or (stripped and stripped[0] in TERMINAL_BOX_CHARS)
    )


def _compact_runtime_text(text: str) -> str:
    return re.sub(r"\s+", "", text)


async def _read_process_pipe(
    reader: asyncio.StreamReader | None,
    name: str,
    queue: asyncio.Queue[tuple[str, str]],
) -> None:
    if reader is None:
        return
    while True:
        raw = await reader.readline()
        if not raw:
            return
        text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n")
        await queue.put((name, text))


def _runtime_process_create_kwargs() -> dict[str, Any]:
    """Isolate generic runtime children so tree cleanup has one root."""
    if os.name == "nt":
        creation_flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return {"creationflags": creation_flags} if creation_flags else {}
    return {"start_new_session": True}


async def _bounded_runtime_wait(wait_task: asyncio.Task[int]) -> bool:
    if wait_task.done():
        return True
    try:
        await asyncio.wait_for(asyncio.shield(wait_task), PROCESS_CLEANUP_WAIT_SECONDS)
    except (asyncio.TimeoutError, asyncio.CancelledError, OSError, RuntimeError):
        return False
    return True


async def _taskkill_runtime_tree(pid: int) -> bool:
    """Kill a Windows runtime process and all descendants without blocking."""
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
    except (asyncio.TimeoutError, asyncio.CancelledError, OSError, RuntimeError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


async def _terminate_runtime_process(
    process: asyncio.subprocess.Process,
    wait_task: asyncio.Task[int],
) -> None:
    """Terminate a generic runtime process tree, then use a direct fallback."""
    if process.returncode is not None or wait_task.done():
        return

    pid = getattr(process, "pid", None)
    # start_new_session=True makes the root pid the stable POSIX process-group
    # id.
    process_group_id = pid if pid is not None and os.name != "nt" else None
    tree_signal_sent = False
    if pid is not None and os.name == "nt":
        tree_signal_sent = await _taskkill_runtime_tree(pid)
    elif process_group_id is not None:
        try:
            os.killpg(process_group_id, signal.SIGTERM)
            tree_signal_sent = True
        except (OSError, ProcessLookupError, RuntimeError):
            pass

    if not tree_signal_sent:
        terminate = getattr(process, "terminate", None)
        try:
            if callable(terminate):
                terminate()
            else:
                process.kill()
        except (OSError, ProcessLookupError, RuntimeError, AttributeError):
            pass
    if await _bounded_runtime_wait(wait_task) and os.name == "nt":
        return

    if process_group_id is not None:
        try:
            os.killpg(process_group_id, signal.SIGKILL)
        except (OSError, ProcessLookupError, RuntimeError):
            pass
    try:
        process.kill()
    except (OSError, ProcessLookupError, RuntimeError, AttributeError):
        pass
    await _bounded_runtime_wait(wait_task)


async def _close_runtime_process(
    process: asyncio.subprocess.Process,
    wait_task: asyncio.Task[int],
    readers: list[asyncio.Task[None]],
) -> None:
    """Bounded cleanup for normal completion, timeout, and client disconnect."""
    for reader in readers:
        if not reader.done():
            reader.cancel()

    await _terminate_runtime_process(process, wait_task)

    if not wait_task.done():
        try:
            await asyncio.wait_for(asyncio.shield(wait_task), timeout=2.0)
        except (asyncio.TimeoutError, asyncio.CancelledError, OSError):
            wait_task.cancel()

    await asyncio.gather(*readers, return_exceptions=True)
    if not wait_task.done():
        wait_task.cancel()
    await asyncio.gather(wait_task, return_exceptions=True)


async def _run_runtime_stream(prompt: str) -> AsyncIterator[tuple[str, dict[str, Any] | RuntimeResult]]:
    argv = _runtime_argv()
    if not argv:
        raise RuntimeError(RUNTIME_UNCONFIGURED_REASON)

    command = _argv_with_prompt(argv, prompt)
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=_runtime_cwd(),
        env=_build_runtime_env(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **_runtime_process_create_kwargs(),
    )

    queue: asyncio.Queue[tuple[str, str]] = asyncio.Queue()
    stdout_parts: list[str] = []
    stderr_parts: list[str] = []
    stdout_json_started = False
    suppress_stdout_until_reasoning = False
    prompt_probe_active = True
    prompt_probe_buffer = ""
    reasoning_probe_buffer = ""
    readers = [
        asyncio.create_task(_read_process_pipe(process.stdout, "stdout", queue)),
        asyncio.create_task(_read_process_pipe(process.stderr, "stderr", queue)),
    ]
    wait_task = asyncio.create_task(process.wait())
    deadline = asyncio.get_running_loop().time() + _runtime_timeout()
    timed_out = False

    try:
        while True:
            if wait_task.done() and queue.empty():
                break

            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                timed_out = True
                break

            try:
                stream_name, text = await asyncio.wait_for(queue.get(), timeout=min(0.1, remaining))
            except asyncio.TimeoutError:
                continue

            if stream_name == "stdout":
                stdout_parts.append(text)
                if stdout_json_started:
                    continue
                if _stdout_line_is_json_start(text):
                    stdout_json_started = True
                    continue
                if prompt_probe_active:
                    prompt_probe_buffer += text
                    compact_probe = _compact_runtime_text(prompt_probe_buffer)
                    if "Query:".startswith(compact_probe):
                        continue
                    if compact_probe.startswith("Query:"):
                        suppress_stdout_until_reasoning = True
                        prompt_probe_active = False
                        prompt_probe_buffer = ""
                        reasoning_probe_buffer = ""
                        continue

                    prompt_probe_active = False
                    pending_text = prompt_probe_buffer
                    prompt_probe_buffer = ""
                    delta_text = _clean_runtime_delta_line(pending_text)
                    if delta_text:
                        yield "delta", {"text": delta_text}
                    continue
                if _is_runtime_prompt_echo_start(text):
                    suppress_stdout_until_reasoning = True
                    continue
                if suppress_stdout_until_reasoning:
                    reasoning_probe_buffer = (reasoning_probe_buffer + text)[-4000:]
                    if _is_runtime_reasoning_header(text) or "Reasoning" in _compact_runtime_text(reasoning_probe_buffer):
                        suppress_stdout_until_reasoning = False
                        reasoning_probe_buffer = ""
                    continue
                delta_text = _clean_runtime_delta_line(text)
                if delta_text:
                    yield "delta", {"text": delta_text}
            else:
                stderr_parts.append(text)
                if text.strip():
                    yield "status", {
                        "phase": "host_runtime",
                        "message": "Host agent runtime emitted diagnostics.",
                    }
    finally:
        cleanup_task = asyncio.create_task(_close_runtime_process(process, wait_task, readers))
        try:
            await asyncio.shield(cleanup_task)
        except asyncio.CancelledError:
            await asyncio.shield(cleanup_task)
            raise

    returncode = process.returncode
    if returncode is None and wait_task.done() and not wait_task.cancelled():
        try:
            returncode = wait_task.result()
        except (Exception, asyncio.CancelledError):
            returncode = None
    if returncode is None:
        returncode = 124
    if timed_out:
        returncode = 124

    yield "_result", RuntimeResult(
        stdout="".join(stdout_parts),
        stderr="".join(stderr_parts),
        returncode=returncode,
        timed_out=timed_out,
    )


def _validate_query_payload(payload: dict[str, Any], request: BridgeQueryRequest) -> dict[str, Any]:
    """Validate an exact-json envelope after removing bridge-owned fields."""

    del request  # request identity is preserved only by unavailable helpers.
    candidate = _without_reserved_query_fields(payload)
    validate_query_response(candidate)
    return candidate


def _validate_metadata_payload(payload: dict[str, Any], request: BridgeMetadataRequest) -> dict[str, Any]:
    """Validate a complete metadata envelope without aliases or coercion."""

    del request
    validate_metadata_proposal(payload)
    return payload


def _unavailable_query_response(
    request: BridgeQueryRequest,
    reason: str,
    runtime_result: RuntimeResult | None = None,
) -> dict[str, Any]:
    trace: list[dict[str, Any]] = [{"tool": "host-agent-runtime", "status": "unavailable", "reason": reason}]
    if runtime_result is not None:
        trace[0]["returncode"] = runtime_result.returncode
        trace[0]["timed_out"] = runtime_result.timed_out
    return {
        "schema_version": QUERY_SCHEMA,
        "request_id": request.request_id,
        "conversation_id": request.conversation_id,
        "source": "host-agent",
        "mode": "UNAVAILABLE",
        "reason": reason,
        "query": request.query,
        "answer": {
            "mode": "UNAVAILABLE",
            "reason": reason,
            "summary": "",
            "insights": [],
            "gap": "Host agent runtime did not provide a valid handoff envelope.",
            "suggestions": [],
        },
        "evidence": [],
        "tool_trace": trace,
    }


def _native_markdown_query_response(
    request: BridgeQueryRequest,
    summary: str,
) -> dict[str, Any]:
    """Wrap provider-neutral native text in the existing v1 terminal envelope."""

    reason = "native-markdown-evidence-not-yet-verified"
    payload = {
        "schema_version": QUERY_SCHEMA,
        "request_id": request.request_id or str(uuid.uuid4()),
        "conversation_id": request.conversation_id,
        "source": "host-agent",
        "mode": "UNGROUNDED",
        "reason": reason,
        "query": request.query,
        "answer": {
            "mode": "UNGROUNDED",
            "reason": reason,
            "summary": summary,
            "insights": [],
            "gap": "Journal evidence has not yet been independently verified.",
            "suggestions": [],
        },
        "evidence": [],
        "tool_trace": [],
        "answer_origin": NATIVE_MARKDOWN_OUTPUT_MODE,
    }
    validate_query_response(payload)
    return payload


def _metadata_failure_diagnostics(
    *,
    stage: str,
    runtime_result: RuntimeResult | None = None,
    reason: str | None = None,
    error_type: str | None = None,
) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {"stage": stage}
    if reason:
        diagnostics["reason"] = reason
    if error_type:
        diagnostics["error_type"] = error_type
    if runtime_result is not None:
        diagnostics["returncode"] = runtime_result.returncode
        diagnostics["timed_out"] = runtime_result.timed_out
        diagnostics["stdout_present"] = bool(runtime_result.stdout)
        diagnostics["stdout_length"] = len(runtime_result.stdout)
        diagnostics["stderr_present"] = bool(runtime_result.stderr)
        diagnostics["stderr_length"] = len(runtime_result.stderr)
    return diagnostics


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


def _with_metadata_timings(
    payload: dict[str, Any],
    *,
    runtime_ms: float | None = None,
    parse_ms: float | None = None,
    bridge_total_ms: float | None = None,
) -> dict[str, Any]:
    diagnostics = payload.get("diagnostics")
    if not isinstance(diagnostics, dict):
        return payload
    if "timings" in diagnostics and not isinstance(diagnostics["timings"], dict):
        return payload
    next_payload = dict(payload)
    next_diagnostics = dict(diagnostics)
    timings = dict(diagnostics.get("timings", {}))
    if runtime_ms is not None:
        timings["runtime_ms"] = runtime_ms
    if parse_ms is not None:
        timings["parse_ms"] = parse_ms
    if bridge_total_ms is not None:
        timings["bridge_total_ms"] = bridge_total_ms
    next_diagnostics["timings"] = timings
    next_payload["diagnostics"] = next_diagnostics
    return next_payload


def _unavailable_metadata_response(
    request: BridgeMetadataRequest,
    reason: str,
    *,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "schema_version": METADATA_SCHEMA,
        "request_id": request.request_id,
        "mode": "UNAVAILABLE",
        "reason": reason,
        "fields": {},
        "warnings": ["Host agent runtime did not provide a valid metadata proposal."],
        "policy": {"preserve_user_fields": bool(request.policy.get("preserve_user_fields", True))},
    }
    if diagnostics:
        payload["diagnostics"] = diagnostics
    return payload


def _unavailable_metadata_for_codex(
    request: BridgeMetadataRequest,
    reason: str,
    *,
    diagnostics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a metadata terminal envelope with named-adapter diagnostics only."""

    return _unavailable_metadata_response(
        request,
        reason,
        diagnostics=_sanitize_codex_diagnostics(diagnostics),
    )


def _sse_frame(event_type: str, data: dict[str, Any]) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {text}\n\n"


@app.get("/health")
async def health() -> dict[str, Any]:
    try:
        selected_kind = _selected_adapter_kind()
    except CodexAdapterError:
        payload = unavailable_health(ADAPTER_KIND_INVALID_REASON)
        payload["runtime"] = {"kind": "host-agent-reference", "interface_version": "v1"}
        payload["checks"][0]["name"] = "adapter_kind"
        payload["checks"][0]["reason"] = ADAPTER_KIND_INVALID_REASON
    else:
        payload = codex_health_payload() if selected_kind == CODEX_CLI_KIND else _check_runtime()
    try:
        validate_health(payload)
    except ValueError:
        return unavailable_health("host-agent-envelope-invalid")
    return payload


@app.post("/query/stream")
async def query_stream(request: BridgeQueryRequest) -> StreamingResponse:
    async def event_generator() -> Iterator[str]:
        yield _sse_frame(
            "status",
            {"phase": "calling_host_agent", "message": "Calling configured host agent runtime."},
        )

        try:
            selected_kind = _selected_adapter_kind()
        except CodexAdapterError as exc:
            yield _sse_frame(
                "final",
                _unavailable_query_for_codex(
                    request,
                    ADAPTER_KIND_INVALID_REASON,
                    {"stage": "adapter-selection", **exc.diagnostics},
                ),
            )
            return

        if selected_kind == CODEX_CLI_KIND:
            try:
                procedure_prompt, source_id = load_configured_prompt("query")
            except CodexAdapterError as exc:
                yield _sse_frame(
                    "final",
                    _unavailable_query_for_codex(
                        request,
                        exc.reason,
                        {"stage": "codex-prompt-asset", **exc.diagnostics},
                    ),
                )
                return
            try:
                adapter = CodexCLIAdapter(
                    executable=configured_codex_executable(),
                    timeout_seconds=configured_timeout_seconds(),
                )
                result = await adapter.query(
                    request.model_dump(),
                    procedure_prompt=procedure_prompt,
                    source_id=source_id,
                )
                payload = _validate_codex_query_payload(request, result.payload, result.diagnostics)
            except CodexAdapterError as exc:
                payload = _unavailable_query_for_codex(
                    request,
                    exc.reason,
                    {"stage": "codex-adapter", **exc.diagnostics},
                )
            except Exception as exc:  # defensive named-adapter boundary
                payload = _unavailable_query_for_codex(
                    request,
                    "codex-process-unavailable",
                    {"stage": "codex-adapter", "error_type": type(exc).__name__},
                )
            yield _sse_frame("final", payload)
            return

        try:
            output_mode = _query_output_mode()
        except ValueError:
            yield _sse_frame(
                "final",
                _unavailable_query_response(request, INVALID_QUERY_OUTPUT_MODE_REASON),
            )
            return

        runtime_result: RuntimeResult | None = None
        try:
            async for event_type, data in _run_runtime_stream(_query_prompt(request)):
                if event_type == "_result":
                    runtime_result = data if isinstance(data, RuntimeResult) else None
                    break
                if isinstance(data, dict):
                    yield _sse_frame(event_type, data)
        except Exception:
            yield _sse_frame("final", _unavailable_query_response(request, RUNTIME_UNCONFIGURED_REASON))
            return

        if runtime_result is None:
            yield _sse_frame("final", _unavailable_query_response(request, "host-agent-runtime-failed"))
            return

        if runtime_result.timed_out:
            yield _sse_frame("final", _unavailable_query_response(request, "host-agent-runtime-timeout", runtime_result))
            return
        if runtime_result.returncode != 0:
            yield _sse_frame("final", _unavailable_query_response(request, "host-agent-runtime-failed", runtime_result))
            return

        if output_mode == NATIVE_MARKDOWN_OUTPUT_MODE:
            if not runtime_result.stdout.strip():
                yield _sse_frame(
                    "final",
                    _unavailable_query_response(request, "host-agent-runtime-empty", runtime_result),
                )
                return
            yield _sse_frame("final", _native_markdown_query_response(request, runtime_result.stdout))
            return

        try:
            payload = _validate_query_payload(parse_exact_json_object(runtime_result.stdout), request)
        except ValueError:
            yield _sse_frame(
                "final",
                _unavailable_query_response(request, "host-agent-envelope-invalid", runtime_result),
            )
            return
        yield _sse_frame("final", payload)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/metadata/propose")
async def metadata_propose(request: BridgeMetadataRequest) -> dict[str, Any]:
    bridge_start = time.perf_counter()

    try:
        selected_kind = _selected_adapter_kind()
    except CodexAdapterError as exc:
        payload = _unavailable_metadata_for_codex(
            request,
            ADAPTER_KIND_INVALID_REASON,
            diagnostics={"stage": "adapter-selection", **exc.diagnostics},
        )
        return _with_metadata_timings(payload, bridge_total_ms=_elapsed_ms(bridge_start))

    if selected_kind == CODEX_CLI_KIND:
        try:
            procedure_prompt, source_id = load_configured_prompt("metadata")
        except CodexAdapterError as exc:
            payload = _unavailable_metadata_for_codex(
                request,
                exc.reason,
                diagnostics={"stage": "codex-prompt-asset", **exc.diagnostics},
            )
            return _with_metadata_timings(payload, bridge_total_ms=_elapsed_ms(bridge_start))
        try:
            adapter = CodexCLIAdapter(
                executable=configured_codex_executable(),
                timeout_seconds=configured_timeout_seconds(),
            )
            result = await adapter.metadata(
                request.model_dump(),
                procedure_prompt=procedure_prompt,
                source_id=source_id,
            )
            payload = _validate_codex_metadata_payload(request, result.payload, result.diagnostics)
            return _with_metadata_timings(payload, bridge_total_ms=_elapsed_ms(bridge_start))
        except CodexAdapterError as exc:
            payload = _unavailable_metadata_for_codex(
                request,
                exc.reason,
                diagnostics={"stage": "codex-adapter", **exc.diagnostics},
            )
            return _with_metadata_timings(payload, bridge_total_ms=_elapsed_ms(bridge_start))
        except Exception as exc:  # defensive named-adapter boundary
            payload = _unavailable_metadata_for_codex(
                request,
                "codex-process-unavailable",
                diagnostics={"stage": "codex-adapter", "error_type": type(exc).__name__},
            )
            return _with_metadata_timings(payload, bridge_total_ms=_elapsed_ms(bridge_start))

    runtime_ms: float | None = None
    try:
        runtime_start = time.perf_counter()
        runtime_result = await _run_runtime(_metadata_prompt(request))
        runtime_ms = _elapsed_ms(runtime_start)
    except Exception as exc:
        payload = _unavailable_metadata_response(
            request,
            RUNTIME_UNCONFIGURED_REASON,
            diagnostics=_metadata_failure_diagnostics(
                stage="bridge-metadata-runtime",
                error_type=type(exc).__name__,
            ),
        )
        return _with_metadata_timings(payload, bridge_total_ms=_elapsed_ms(bridge_start))

    if runtime_result.timed_out:
        payload = _unavailable_metadata_response(
            request,
            "host-agent-runtime-timeout",
            diagnostics=_metadata_failure_diagnostics(
                stage="bridge-metadata-runtime",
                runtime_result=runtime_result,
            ),
        )
        return _with_metadata_timings(
            payload,
            runtime_ms=runtime_ms,
            bridge_total_ms=_elapsed_ms(bridge_start),
        )
    if runtime_result.returncode != 0:
        payload = _unavailable_metadata_response(
            request,
            "host-agent-runtime-failed",
            diagnostics=_metadata_failure_diagnostics(
                stage="bridge-metadata-runtime",
                runtime_result=runtime_result,
            ),
        )
        return _with_metadata_timings(
            payload,
            runtime_ms=runtime_ms,
            bridge_total_ms=_elapsed_ms(bridge_start),
        )

    try:
        parse_start = time.perf_counter()
        payload = _validate_metadata_payload(parse_exact_json_object(runtime_result.stdout), request)
        parse_ms = _elapsed_ms(parse_start)
        return _with_metadata_timings(
            payload,
            runtime_ms=runtime_ms,
            parse_ms=parse_ms,
            bridge_total_ms=_elapsed_ms(bridge_start),
        )
    except ValueError:
        parse_ms = _elapsed_ms(parse_start) if "parse_start" in locals() else None
        payload = _unavailable_metadata_response(
            request,
            "host-agent-envelope-invalid",
            diagnostics=_metadata_failure_diagnostics(
                stage="bridge-metadata-parse",
                runtime_result=runtime_result,
                reason="host-agent-envelope-invalid",
            ),
        )
        return _with_metadata_timings(
            payload,
            runtime_ms=runtime_ms,
            parse_ms=parse_ms,
            bridge_total_ms=_elapsed_ms(bridge_start),
        )


@app.get("/runtime/sample-request-id")
async def sample_request_id() -> dict[str, str]:
    return {"request_id": str(uuid.uuid4())}
