"""Wrap a user-provided headless-agent command in the stdio-json runtime contract.

The adapter is intentionally provider-neutral. It does not import any model SDK,
load credentials, choose tools, or synthesize answers. It only:

1. extracts the Host Agent request JSON from the reference bridge prompt,
2. spawns the command configured by the user,
3. forwards the request JSON to that command,
4. validates the returned public handoff envelope shape.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
from typing import Any


QUERY_SCHEMA = "gui.host_agent.query_response.v1"
METADATA_SCHEMA = "gui.host_agent.metadata_proposal.v1"
DEFAULT_TIMEOUT_SECONDS = 600.0
DIAGNOSTIC_TAIL_CHARS = 1200


class AdapterError(Exception):
    def __init__(self, reason: str, diagnostics: dict[str, Any] | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.diagnostics = diagnostics or {}


def _read_prompt() -> str:
    if len(sys.argv) > 1:
        return sys.argv[-1]
    return sys.stdin.read()


def _extract_request(prompt: str) -> dict[str, Any]:
    marker = "Request JSON:"
    text = prompt.split(marker, 1)[1] if marker in prompt else prompt
    decoder = json.JSONDecoder()
    start = text.find("{")
    while start >= 0:
        chunk = text[start:].lstrip()
        try:
            value, _end = decoder.raw_decode(chunk)
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
            continue
        if isinstance(value, dict):
            return value
        start = text.find("{", start + 1)
    return {}


def _adapter_argv() -> list[str]:
    raw_json = os.environ.get("LIFE_INDEX_HOST_AGENT_ADAPTER_ARGV_JSON", "").strip()
    if raw_json:
        parsed = json.loads(raw_json)
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise AdapterError("host-agent-adapter-command-config-invalid")
        return parsed

    raw_command = os.environ.get("LIFE_INDEX_HOST_AGENT_ADAPTER_COMMAND", "").strip()
    if raw_command:
        return shlex.split(raw_command, posix=os.name != "nt")

    raise AdapterError("host-agent-adapter-command-unconfigured")


def _adapter_cwd() -> str | None:
    value = os.environ.get("LIFE_INDEX_HOST_AGENT_ADAPTER_CWD", "").strip()
    return value or None


def _adapter_timeout() -> float:
    value = os.environ.get("LIFE_INDEX_HOST_AGENT_ADAPTER_TIMEOUT_SECONDS", "").strip()
    if not value:
        return DEFAULT_TIMEOUT_SECONDS
    try:
        parsed = float(value)
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS
    return max(1.0, parsed)


def _command_with_request(argv: list[str], request_json: str) -> tuple[list[str], str | None]:
    replaced = [arg.replace("{request_json}", request_json) for arg in argv]
    if replaced != argv or "{request_json}" in " ".join(argv):
        return replaced, None
    return argv, request_json


def _run_external_agent(request_payload: dict[str, Any]) -> dict[str, Any]:
    request_json = json.dumps(request_payload, ensure_ascii=False, separators=(",", ":"))
    argv = _adapter_argv()
    command, stdin_text = _command_with_request(argv, request_json)

    try:
        completed = subprocess.run(
            command,
            input=stdin_text,
            cwd=_adapter_cwd(),
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=_adapter_timeout(),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AdapterError(
            "host-agent-adapter-command-timeout",
            {
                "stdout_tail": _tail(exc.stdout or ""),
                "stderr_tail": _tail(exc.stderr or ""),
                "timed_out": True,
            },
        ) from exc
    except OSError as exc:
        raise AdapterError("host-agent-adapter-command-failed", {"error": str(exc)}) from exc

    if completed.returncode != 0:
        raise AdapterError(
            "host-agent-adapter-command-failed",
            {
                "returncode": completed.returncode,
                "stdout_tail": _tail(completed.stdout),
                "stderr_tail": _tail(completed.stderr),
            },
        )

    return _extract_json_object(completed.stdout)


def _extract_json_object(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    start = text.find("{")
    while start >= 0:
        chunk = text[start:].lstrip()
        try:
            value, _end = decoder.raw_decode(chunk)
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
            continue
        if isinstance(value, dict):
            return value
        start = text.find("{", start + 1)
    raise AdapterError("host-agent-adapter-output-not-json", {"stdout_tail": _tail(text)})


def _is_metadata_request(request_payload: dict[str, Any], prompt: str) -> bool:
    return "metadata_proposal.v1" in prompt or isinstance(request_payload.get("draft"), dict)


def _validate_query_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != QUERY_SCHEMA:
        raise AdapterError("host-agent-adapter-query-schema-mismatch")
    mode = payload.get("mode")
    if mode not in {"GROUNDED", "UNGROUNDED", "PARTIAL", "UNAVAILABLE"}:
        raise AdapterError("host-agent-adapter-query-mode-invalid")
    answer = payload.get("answer")
    if not isinstance(answer, dict) or answer.get("mode") != mode:
        raise AdapterError("host-agent-adapter-answer-mode-mismatch")
    evidence = payload.get("evidence")
    if not isinstance(evidence, list):
        raise AdapterError("host-agent-adapter-evidence-invalid")
    if mode == "GROUNDED" and not evidence:
        raise AdapterError("host-agent-adapter-grounded-missing-evidence")
    if mode == "UNGROUNDED" and evidence:
        raise AdapterError("host-agent-adapter-ungrounded-has-evidence")
    for item in evidence:
        if not isinstance(item, dict):
            raise AdapterError("host-agent-adapter-evidence-invalid")
        for key in ("id", "rel_path", "title", "date"):
            if not isinstance(item.get(key), str) or not item[key]:
                raise AdapterError("host-agent-adapter-evidence-invalid")
    payload.setdefault("request_id", request_payload.get("request_id"))
    payload.setdefault("conversation_id", request_payload.get("conversation_id"))
    payload.setdefault("source", "host-agent")
    payload.setdefault("query", request_payload.get("query") or "")
    return payload


def _validate_metadata_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != METADATA_SCHEMA:
        raise AdapterError("host-agent-adapter-metadata-schema-mismatch")
    mode = payload.get("mode")
    if mode not in {"PROPOSED", "UNAVAILABLE"}:
        raise AdapterError("host-agent-adapter-metadata-mode-invalid")
    fields = payload.get("fields")
    if not isinstance(fields, dict):
        raise AdapterError("host-agent-adapter-metadata-fields-invalid")
    if mode == "PROPOSED" and not fields:
        raise AdapterError("host-agent-adapter-metadata-fields-empty")
    if mode == "UNAVAILABLE" and fields:
        raise AdapterError("host-agent-adapter-unavailable-metadata-has-fields")
    payload.setdefault("request_id", request_payload.get("request_id"))
    payload.setdefault("warnings", [])
    payload.setdefault("policy", {"preserve_user_fields": True})
    return payload


def _unavailable_query_response(request_payload: dict[str, Any], reason: str, diagnostics: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schema_version": QUERY_SCHEMA,
        "request_id": request_payload.get("request_id"),
        "conversation_id": request_payload.get("conversation_id"),
        "source": "host-agent",
        "mode": "UNAVAILABLE",
        "reason": reason,
        "query": request_payload.get("query") or "",
        "answer": {
            "mode": "UNAVAILABLE",
            "reason": reason,
            "summary": "The configured external host-agent command did not return a usable handoff envelope.",
            "insights": [],
            "gap": "external-host-agent-command-unavailable",
            "suggestions": [],
        },
        "evidence": [],
        "tool_trace": [],
    }
    if diagnostics:
        payload["diagnostics"] = diagnostics
    return payload


def _unavailable_metadata_response(
    request_payload: dict[str, Any],
    reason: str,
    diagnostics: dict[str, Any],
) -> dict[str, Any]:
    policy = request_payload.get("policy") if isinstance(request_payload.get("policy"), dict) else {}
    payload: dict[str, Any] = {
        "schema_version": METADATA_SCHEMA,
        "request_id": request_payload.get("request_id"),
        "mode": "UNAVAILABLE",
        "reason": reason,
        "fields": {},
        "warnings": ["External host-agent command did not return a usable metadata proposal."],
        "policy": {"preserve_user_fields": bool(policy.get("preserve_user_fields", True))},
    }
    if diagnostics:
        payload["diagnostics"] = diagnostics
    return payload


def _tail(text: str) -> str:
    return text[-DIAGNOSTIC_TAIL_CHARS:]


def main() -> int:
    prompt = _read_prompt()
    request_payload = _extract_request(prompt)
    is_metadata = _is_metadata_request(request_payload, prompt)

    try:
        payload = _run_external_agent(request_payload)
        if is_metadata:
            payload = _validate_metadata_payload(payload, request_payload)
        else:
            payload = _validate_query_payload(payload, request_payload)
    except AdapterError as exc:
        if is_metadata:
            payload = _unavailable_metadata_response(request_payload, exc.reason, exc.diagnostics)
        else:
            payload = _unavailable_query_response(request_payload, exc.reason, exc.diagnostics)

    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
