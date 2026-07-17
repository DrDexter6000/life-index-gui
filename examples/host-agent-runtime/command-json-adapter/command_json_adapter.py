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

# The example is invoked by path from the repository root rather than as an
# installed package.  Make the GUI-owned canonical contracts importable while
# keeping this adapter provider-neutral.
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(_REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPOSITORY_ROOT))

from host_agent_bridge.contracts import (
    METADATA_SCHEMA,
    QUERY_SCHEMA,
    parse_exact_json_object,
    validate_metadata_proposal,
    validate_query_response,
)

DEFAULT_TIMEOUT_SECONDS = 600.0


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
        try:
            parsed = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise AdapterError(
                "host-agent-adapter-command-config-invalid",
                {"error_type": type(exc).__name__},
            ) from exc
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise AdapterError("host-agent-adapter-command-config-invalid")
        return parsed

    raw_command = os.environ.get("LIFE_INDEX_HOST_AGENT_ADAPTER_COMMAND", "").strip()
    if raw_command:
        try:
            return shlex.split(raw_command, posix=os.name != "nt")
        except ValueError as exc:
            raise AdapterError(
                "host-agent-adapter-command-config-invalid",
                {"error_type": type(exc).__name__},
            ) from exc

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
                **_output_metadata(exc.stdout, exc.stderr),
                "timed_out": True,
            },
        ) from exc
    except OSError as exc:
        raise AdapterError(
            "host-agent-adapter-command-failed",
            {"error_type": type(exc).__name__},
        ) from exc

    if completed.returncode != 0:
        raise AdapterError(
            "host-agent-adapter-command-failed",
            {
                **_output_metadata(completed.stdout, completed.stderr),
                "returncode": completed.returncode,
            },
        )

    try:
        return parse_exact_json_object(completed.stdout)
    except ValueError as exc:
        raise AdapterError(
            "host-agent-envelope-invalid",
            _output_metadata(completed.stdout, ""),
        ) from exc


def _is_metadata_request(request_payload: dict[str, Any], prompt: str) -> bool:
    return "metadata_proposal.v1" in prompt or isinstance(request_payload.get("draft"), dict)


def _validate_query_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    del request_payload
    try:
        validate_query_response(payload)
    except ValueError as exc:
        raise AdapterError("host-agent-envelope-invalid") from exc
    return payload


def _validate_metadata_payload(payload: dict[str, Any], request_payload: dict[str, Any]) -> dict[str, Any]:
    del request_payload
    try:
        validate_metadata_proposal(payload)
    except ValueError as exc:
        raise AdapterError("host-agent-envelope-invalid") from exc
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


def _output_metadata(stdout: Any, stderr: Any) -> dict[str, Any]:
    return {
        "stdout_present": bool(stdout),
        "stdout_length": len(stdout or ""),
        "stderr_present": bool(stderr),
        "stderr_length": len(stderr or ""),
    }


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
    except Exception as exc:  # pragma: no cover - defensive adapter boundary
        diagnostics = {"error_type": type(exc).__name__}
        reason = "host-agent-adapter-failed"
        if is_metadata:
            payload = _unavailable_metadata_response(request_payload, reason, diagnostics)
        else:
            payload = _unavailable_query_response(request_payload, reason, diagnostics)

    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
