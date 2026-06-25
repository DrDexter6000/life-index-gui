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
import shutil
import subprocess
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from string import Template
from typing import Any

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

HOST_AGENT_SCHEMA_VERSION = "gui.host_agent"
RUNTIME_UNCONFIGURED_REASON = "host-agent-runtime-unconfigured"
DEFAULT_TIMEOUT_SECONDS = 600.0
DIAGNOSTIC_TAIL_CHARS = 1200
PROMPT_DIR = Path(__file__).with_name("prompts")
DEFAULT_QUERY_PROMPT_TEMPLATE = """You are the user-provided Host Agent for Life Index GUI Handoff.
Return only a JSON object matching schema_version gui.host_agent.query_response.v1.
$tool_hint
Request JSON:
$request_json
"""
DEFAULT_METADATA_PROMPT_TEMPLATE = """You are the user-provided Host Agent for Life Index metadata proposal.
Return only a JSON object matching schema_version gui.host_agent.metadata_proposal.v1.
$tool_hint
Request JSON:
$request_json
"""
METADATA_FIELD_KEYS = {
    "title",
    "abstract",
    "topic",
    "topics",
    "mood",
    "moods",
    "tags",
    "people",
    "project",
    "links",
}
METADATA_FIELD_ALIASES = {
    "summary": "abstract",
}

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
    )


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
        "schema_version": f"{HOST_AGENT_SCHEMA_VERSION}.health.v1",
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
        payload["checks"][0]["error"] = str(exc)
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
        "schema_version": f"{HOST_AGENT_SCHEMA_VERSION}.health.v1",
        "running": command_ok,
        "ready": ready,
        "degraded": not ready,
        "mode": "READY" if ready else "NOT_READY",
        "reason": "configured" if ready else "runtime-check-failed",
        "runtime": {"kind": "host-agent-reference-bridge", "interface_version": "v1"},
        "checks": checks,
    }


def _query_prompt(request: BridgeQueryRequest) -> str:
    payload = request.model_dump()
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

    while True:
        if wait_task.done() and queue.empty():
            break

        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            timed_out = True
            process.kill()
            await process.wait()
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
                yield "status", {"phase": "host_runtime", "message": text.strip()}

    await asyncio.gather(*readers, return_exceptions=True)
    returncode = process.returncode if process.returncode is not None else 124
    if timed_out:
        returncode = 124

    yield "_result", RuntimeResult(
        stdout="".join(stdout_parts),
        stderr="".join(stderr_parts),
        returncode=returncode,
        timed_out=timed_out,
    )


def _json_candidates(text: str) -> Iterator[str]:
    stripped = text.strip()
    if stripped:
        yield stripped

    for match in re.finditer(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE):
        yield match.group(1).strip()

    start = text.find("{")
    while start >= 0:
        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    yield text[start : index + 1]
                    break
        start = text.find("{", start + 1)


def _escape_unescaped_quotes(value: str) -> str:
    repaired: list[str] = []
    escaped = False
    for char in value:
        if char == '"' and not escaped:
            repaired.append('\\"')
        else:
            repaired.append(char)
        escaped = char == "\\" and not escaped
        if char != "\\":
            escaped = False
    return "".join(repaired)


def _repair_common_json_string_value_quotes(candidate: str) -> str:
    repaired_lines: list[str] = []
    string_value_line = re.compile(r'^(\s*"[^"\n]+"\s*:\s*")(.*)(",?\s*)$')
    for line in candidate.splitlines():
        match = string_value_line.match(line)
        if not match:
            repaired_lines.append(line)
            continue
        prefix, value, suffix = match.groups()
        repaired_lines.append(f"{prefix}{_escape_unescaped_quotes(value)}{suffix}")
    return "\n".join(repaired_lines)


def _extract_json_object(text: str) -> dict[str, Any]:
    for candidate in _json_candidates(text):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            try:
                parsed = json.loads(_repair_common_json_string_value_quotes(candidate))
            except json.JSONDecodeError:
                continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("host-agent-output-not-json")


def _route_id_from_ref(value: str) -> str:
    route_id = value.strip()
    if route_id.startswith("Journals/"):
        route_id = route_id.removeprefix("Journals/")
    return route_id


def _rel_path_from_ref(value: str) -> str:
    rel_path = value.strip()
    if rel_path and not rel_path.startswith("Journals/"):
        rel_path = f"Journals/{rel_path}"
    return rel_path


def _evidence_from_ref(ref: dict[str, Any]) -> dict[str, str] | None:
    raw_id = str(ref.get("id") or ref.get("rel_path") or "").strip()
    raw_rel_path = str(ref.get("rel_path") or ref.get("id") or "").strip()
    title = str(ref.get("title") or "").strip()
    date = str(ref.get("date") or "").strip()
    if not raw_id or not raw_rel_path or not title or not date:
        return None
    return {
        "id": _route_id_from_ref(raw_id),
        "rel_path": _rel_path_from_ref(raw_rel_path),
        "title": title,
        "date": date,
    }


def _normalized_evidence_from_ref(ref: dict[str, Any]) -> dict[str, Any] | None:
    evidence = _evidence_from_ref(ref)
    if evidence is None:
        return None
    normalized: dict[str, Any] = dict(ref)
    normalized.update(evidence)
    return normalized


def _evidence_from_path_ref(value: str) -> dict[str, str] | None:
    raw = value.strip()
    if not raw:
        return None
    rel_path = _rel_path_from_ref(raw)
    route_id = _route_id_from_ref(raw)
    filename = Path(route_id).name or route_id
    match = re.search(r"(\d{4}-\d{2}-\d{2})", route_id)
    if not match:
        return None
    return {
        "id": route_id,
        "rel_path": rel_path,
        "title": filename,
        "date": match.group(1),
    }


def _coerce_insights_and_evidence(payload: dict[str, Any]) -> None:
    answer = payload.get("answer")
    if not isinstance(answer, dict):
        return
    insights = answer.get("insights")
    top_level_insights = payload.get("insights")
    if (not insights) and isinstance(top_level_insights, list):
        insights = top_level_insights
        answer["insights"] = insights
    if not isinstance(insights, list):
        answer["insights"] = []
        return

    raw_evidence = []
    if isinstance(payload.get("evidence"), list):
        raw_evidence.extend(payload["evidence"])
    if isinstance(answer.get("evidence"), list):
        raw_evidence.extend(answer["evidence"])

    top_level_evidence = []
    for item in raw_evidence:
        if not isinstance(item, dict):
            continue
        evidence = _normalized_evidence_from_ref(item)
        if evidence is not None:
            top_level_evidence.append(evidence)
    evidence_by_id: dict[str, dict[str, Any]] = {
        str(item.get("id")): item for item in top_level_evidence
    }
    evidence_refs = list(evidence_by_id)
    coerced: list[dict[str, Any]] = []
    for item in insights:
        if isinstance(item, dict):
            refs = item.get("evidence_refs")
            normalized_refs: list[str] = []
            if isinstance(refs, list):
                for ref in refs:
                    if isinstance(ref, dict):
                        evidence = _normalized_evidence_from_ref(ref)
                        if evidence is None:
                            continue
                        evidence_by_id.setdefault(evidence["id"], evidence)
                        normalized_refs.append(evidence["id"])
                    elif ref:
                        route_id = _route_id_from_ref(str(ref))
                        normalized_refs.append(route_id)
                        evidence = _evidence_from_path_ref(str(ref))
                        if evidence is not None:
                            evidence_by_id.setdefault(evidence["id"], evidence)
                            payload["_path_evidence_fallback"] = True
            item["evidence_refs"] = normalized_refs
            coerced.append(item)
        else:
            coerced.append(
                {
                    "theme": "host-agent-insight",
                    "interpretation": str(item),
                    "evidence_refs": evidence_refs,
                }
            )
    answer["insights"] = coerced
    payload["evidence"] = list(evidence_by_id.values())


def _unwrap_nested_query_payload(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = payload.get("metadata")
    if payload.get("mode") or not isinstance(metadata, dict):
        return payload
    if metadata.get("mode") and isinstance(metadata.get("answer"), dict):
        unwrapped = dict(metadata)
        unwrapped.setdefault("schema_version", payload.get("schema_version"))
        return unwrapped
    return payload


def _validate_query_payload(payload: dict[str, Any], request: BridgeQueryRequest) -> dict[str, Any]:
    payload = _unwrap_nested_query_payload(payload)
    answer = payload.get("answer")
    answer_mode = answer.get("mode") if isinstance(answer, dict) else None
    mode = str(payload.get("mode") or answer_mode or "").strip().upper()
    if not mode:
        raise ValueError("host-agent-output-schema-invalid")
    payload["mode"] = mode

    if not isinstance(answer, dict):
        answer = {
            "mode": mode,
            "reason": payload.get("reason"),
            "summary": "",
            "insights": [],
            "gap": None,
            "suggestions": [],
        }
        payload["answer"] = answer

    answer["mode"] = str(answer.get("mode") or mode).strip().upper()
    if answer["mode"] != mode:
        raise ValueError("host-agent-output-mode-mismatch")
    answer.setdefault("summary", "")
    answer.setdefault("gap", None)
    answer.setdefault("suggestions", [])

    _coerce_insights_and_evidence(payload)

    evidence = payload.get("evidence", [])
    if not isinstance(evidence, list):
        raise ValueError("host-agent-output-schema-invalid")
    if mode == "GROUNDED" and not evidence:
        raise ValueError("host-agent-output-grounded-without-evidence")
    if mode == "UNGROUNDED" and evidence:
        raise ValueError("host-agent-output-ungrounded-with-evidence")

    for item in evidence:
        if not isinstance(item, dict):
            raise ValueError("host-agent-output-schema-invalid")
        for key in ("id", "rel_path", "title", "date"):
            if not item.get(key):
                raise ValueError("host-agent-output-schema-invalid")

    payload.setdefault("schema_version", f"{HOST_AGENT_SCHEMA_VERSION}.query_response.v1")
    payload.setdefault("request_id", request.request_id)
    payload.setdefault("conversation_id", request.conversation_id)
    payload.setdefault("source", "host-agent")
    payload.setdefault("query", request.query)
    used_path_evidence_fallback = bool(payload.pop("_path_evidence_fallback", False))
    if mode == "GROUNDED" and used_path_evidence_fallback:
        fallback_reason = "host-agent-returned-grounded-with-path-evidence"
    else:
        fallback_reason = (
            "host-agent-returned-grounded-with-evidence"
            if mode == "GROUNDED"
            else f"host-agent-returned-{mode.lower()}"
        )
    reason = str(payload.get("reason") or answer.get("reason") or fallback_reason)
    payload["reason"] = reason
    answer["reason"] = str(answer.get("reason") or reason)
    payload.setdefault("tool_trace", [])
    return payload


def _coerce_metadata_field(field_name: str, value: Any, warnings: list[str]) -> dict[str, Any] | None:
    if field_name not in METADATA_FIELD_KEYS:
        warnings.append(f"unsupported field: {field_name}")
        return None

    if isinstance(value, dict):
        field = dict(value)
        field.setdefault("field_source", "host-agent")
        return field

    if isinstance(value, (str, list)) or value is None:
        return {
            "value": value,
            "field_source": "host-agent",
            "confidence": None,
            "rationale": "Host agent returned a scalar/list field value.",
        }

    warnings.append(f"invalid field value: {field_name}")
    return None


def _people_field_from_entities(value: Any, warnings: list[str]) -> dict[str, Any] | None:
    wrapper_field_source = "host-agent-entities"
    wrapper_confidence: float | None = None
    wrapper_rationale = ""
    if isinstance(value, dict):
        wrapper_field_source = str(value.get("field_source") or wrapper_field_source)
        raw_wrapper_confidence = value.get("confidence")
        if isinstance(raw_wrapper_confidence, (int, float)):
            wrapper_confidence = float(raw_wrapper_confidence)
        wrapper_rationale = str(value.get("rationale") or "").strip()
        nested_value = value.get("value")
        if isinstance(nested_value, dict) and isinstance(nested_value.get("people"), list):
            value = nested_value["people"]
        elif isinstance(value.get("people"), list):
            value = value["people"]

    if not isinstance(value, list):
        warnings.append("invalid field value: entities")
        return None

    names: list[str] = []
    confidences: list[float] = []
    rationales: list[str] = []
    for item in value:
        if isinstance(item, str):
            name = item.strip()
            confidence = None
            rationale = ""
        elif isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            raw_confidence = item.get("confidence")
            confidence = raw_confidence if isinstance(raw_confidence, (int, float)) else None
            rationale = str(item.get("rationale") or "").strip()
        else:
            continue

        if not name:
            continue
        names.append(name)
        if confidence is not None:
            confidences.append(float(confidence))
        if rationale:
            rationales.append(rationale)

    if not names:
        warnings.append("invalid field value: entities")
        return None

    return {
        "value": names,
        "field_source": wrapper_field_source,
        "confidence": wrapper_confidence if wrapper_confidence is not None else (
            sum(confidences) / len(confidences) if confidences else None
        ),
        "rationale": wrapper_rationale or (" / ".join(rationales) if rationales else "Host agent returned entity names."),
    }


def _normalize_metadata_fields(raw_fields: Any, warnings: list[str]) -> dict[str, Any]:
    if not isinstance(raw_fields, dict):
        raise ValueError("host-agent-output-schema-invalid")

    normalized: dict[str, Any] = {}
    entity_alias: Any = None
    for field_name, value in raw_fields.items():
        original_name = str(field_name)
        name = METADATA_FIELD_ALIASES.get(original_name, original_name)
        if name == "entities":
            entity_alias = value
            continue
        field = _coerce_metadata_field(name, value, warnings)
        if field is not None and name not in normalized:
            normalized[name] = field

    if "people" not in normalized and entity_alias is not None:
        people = _people_field_from_entities(entity_alias, warnings)
        if people is not None:
            normalized["people"] = people

    return normalized


def _looks_like_metadata_field_map(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    for field_name in value:
        name = METADATA_FIELD_ALIASES.get(str(field_name), str(field_name))
        if name in METADATA_FIELD_KEYS or name == "entities":
            return True
    return False


def _validate_metadata_payload(payload: dict[str, Any], request: BridgeMetadataRequest) -> dict[str, Any]:
    fields = payload.get("fields")
    if fields is None and isinstance(payload.get("proposed_metadata"), dict):
        fields = payload["proposed_metadata"]
        payload["fields"] = fields
    if fields is None and isinstance(payload.get("metadata_proposal"), dict):
        fields = payload["metadata_proposal"]
        payload["fields"] = fields
    if fields is None and isinstance(payload.get("proposed_fields"), dict):
        fields = payload["proposed_fields"]
        payload["fields"] = fields
    proposal = payload.get("proposal")
    if fields is None and isinstance(proposal, dict) and isinstance(proposal.get("fields"), dict):
        fields = proposal["fields"]
        payload["fields"] = fields
    if fields is None and _looks_like_metadata_field_map(proposal):
        fields = proposal
        payload["fields"] = fields
    if fields is None:
        fields = {}
        payload["fields"] = fields
    warnings = payload.get("warnings")
    if not isinstance(warnings, list):
        warnings = []
    fields = _normalize_metadata_fields(fields, warnings)
    payload["fields"] = fields

    mode = str(payload.get("mode") or "").strip().upper()
    if not mode:
        mode = "PROPOSED" if fields else "UNAVAILABLE"
    payload["mode"] = mode

    payload.setdefault("schema_version", f"{HOST_AGENT_SCHEMA_VERSION}.metadata_proposal.v1")
    payload.setdefault("request_id", request.request_id)
    if not payload.get("reason") and mode == "PROPOSED":
        payload["reason"] = "semantic-fields-proposed-by-host-agent"
    else:
        payload.setdefault("reason", None)
    payload["warnings"] = warnings
    if not isinstance(payload.get("policy"), dict):
        payload["policy"] = {
            "preserve_user_fields": bool(
                payload.get("preserve_user_fields", request.policy.get("preserve_user_fields", True))
            )
        }
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
        "schema_version": f"{HOST_AGENT_SCHEMA_VERSION}.query_response.v1",
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


def _metadata_sensitive_values(request: BridgeMetadataRequest) -> list[str]:
    values: list[str] = []
    for key in ("content", "title", "abstract"):
        value = request.draft.get(key)
        if isinstance(value, str) and len(value.strip()) >= 8:
            values.append(value.strip())
    existing = request.draft.get("existing_metadata")
    if isinstance(existing, dict):
        for value in existing.values():
            if isinstance(value, str) and len(value.strip()) >= 8:
                values.append(value.strip())
    return values


def _diagnostic_tail(text: str, request: BridgeMetadataRequest) -> str:
    tail = (text or "")[-DIAGNOSTIC_TAIL_CHARS:]
    for value in _metadata_sensitive_values(request):
        tail = tail.replace(value, "[redacted-draft]")
    return tail


def _metadata_failure_diagnostics(
    request: BridgeMetadataRequest,
    *,
    stage: str,
    runtime_result: RuntimeResult | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {"stage": stage}
    if error:
        diagnostics["error"] = error
    if runtime_result is not None:
        diagnostics["returncode"] = runtime_result.returncode
        diagnostics["timed_out"] = runtime_result.timed_out
        diagnostics["stdout_tail"] = _diagnostic_tail(runtime_result.stdout, request)
        diagnostics["stderr_tail"] = _diagnostic_tail(runtime_result.stderr, request)
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
    next_payload = dict(payload)
    diagnostics = next_payload.get("diagnostics")
    if not isinstance(diagnostics, dict):
        diagnostics = {}
    else:
        diagnostics = dict(diagnostics)
    timings = diagnostics.get("timings")
    if not isinstance(timings, dict):
        timings = {}
    else:
        timings = dict(timings)
    if runtime_ms is not None:
        timings["runtime_ms"] = runtime_ms
    if parse_ms is not None:
        timings["parse_ms"] = parse_ms
    if bridge_total_ms is not None:
        timings["bridge_total_ms"] = bridge_total_ms
    diagnostics["timings"] = timings
    next_payload["diagnostics"] = diagnostics
    return next_payload


def _unavailable_metadata_response(
    request: BridgeMetadataRequest,
    reason: str,
    *,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "schema_version": f"{HOST_AGENT_SCHEMA_VERSION}.metadata_proposal.v1",
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


def _sse_frame(event_type: str, data: dict[str, Any]) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {text}\n\n"


@app.get("/health")
async def health() -> dict[str, Any]:
    return _check_runtime()


@app.post("/query/stream")
async def query_stream(request: BridgeQueryRequest) -> StreamingResponse:
    async def event_generator() -> Iterator[str]:
        yield _sse_frame(
            "status",
            {"phase": "calling_host_agent", "message": "Calling configured host agent runtime."},
        )
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

        try:
            payload = _validate_query_payload(_extract_json_object(runtime_result.stdout), request)
        except ValueError as exc:
            yield _sse_frame("final", _unavailable_query_response(request, str(exc), runtime_result))
            return
        yield _sse_frame("final", payload)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/metadata/propose")
async def metadata_propose(request: BridgeMetadataRequest) -> dict[str, Any]:
    bridge_start = time.perf_counter()
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
                request,
                stage="bridge-metadata-runtime",
                error=str(exc),
            ),
        )
        return _with_metadata_timings(payload, bridge_total_ms=_elapsed_ms(bridge_start))

    if runtime_result.timed_out:
        payload = _unavailable_metadata_response(
            request,
            "host-agent-runtime-timeout",
            diagnostics=_metadata_failure_diagnostics(
                request,
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
                request,
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
        payload = _validate_metadata_payload(_extract_json_object(runtime_result.stdout), request)
        parse_ms = _elapsed_ms(parse_start)
        return _with_metadata_timings(
            payload,
            runtime_ms=runtime_ms,
            parse_ms=parse_ms,
            bridge_total_ms=_elapsed_ms(bridge_start),
        )
    except ValueError as exc:
        parse_ms = _elapsed_ms(parse_start) if "parse_start" in locals() else None
        payload = _unavailable_metadata_response(
            request,
            str(exc),
            diagnostics=_metadata_failure_diagnostics(
                request,
                stage="bridge-metadata-parse",
                runtime_result=runtime_result,
                error=str(exc),
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
