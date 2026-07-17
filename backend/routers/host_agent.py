"""Runtime-neutral Host Agent handoff router.

This router owns only GUI/backend transport concerns: validation, relay,
SSE framing, and honest unavailable envelopes. It must not choose CLI tools,
inspect query semantics, synthesize answers, or extract metadata.
"""

import json
import os
import re
import time
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.models.response import APIResponse
from host_agent_bridge.contracts import (
    HEALTH_SCHEMA,
    METADATA_SCHEMA,
    QUERY_SCHEMA,
    parse_exact_json_object,
    parse_exact_json_value,
    validate_health,
    validate_metadata_proposal,
    validate_query_response,
)

router = APIRouter(prefix="/host-agent", tags=["host-agent"])

UNCONFIGURED_REASON = "host-agent-unconfigured"
INVALID_ENVELOPE_REASON = "host-agent-envelope-invalid"
DEFAULT_HOST_AGENT_HTTP_TIMEOUT_SECONDS = 600.0
NOT_READY_CHECK_STATUSES = {
    "building",
    "degraded",
    "error",
    "fail",
    "failed",
    "not-ready",
    "not_ready",
    "pending",
    "rebuilding",
    "stale",
    "unavailable",
    "warming",
}


class HostAgentQueryRequest(BaseModel):
    query: str
    request_id: str | None = None
    conversation_id: str | None = None
    intent: str = "grounded_query"
    context: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)


class HostAgentMetadataRequest(BaseModel):
    request_id: str | None = None
    draft: dict[str, Any]
    policy: dict[str, Any] = Field(default_factory=lambda: {"preserve_user_fields": True})


def get_host_agent_url() -> str | None:
    """Return the user-provided host-agent handoff endpoint, if configured."""
    value = os.environ.get("LIFE_INDEX_HOST_AGENT_URL", "").strip()
    return value.rstrip("/") if value else None


def host_agent_http_timeout_seconds() -> float:
    value = os.environ.get("LIFE_INDEX_HOST_AGENT_HTTP_TIMEOUT_SECONDS", "").strip()
    if not value:
        return DEFAULT_HOST_AGENT_HTTP_TIMEOUT_SECONDS
    try:
        timeout = float(value)
    except ValueError:
        return DEFAULT_HOST_AGENT_HTTP_TIMEOUT_SECONDS
    return max(1.0, timeout)


def unavailable_health(reason: str = UNCONFIGURED_REASON) -> dict[str, Any]:
    return {
        "schema_version": HEALTH_SCHEMA,
        "running": False,
        "ready": False,
        "degraded": True,
        "mode": "UNAVAILABLE",
        "reason": reason,
        "runtime": {
            "kind": "external-host-agent",
            "interface_version": "v1",
        },
        "checks": [
            {
                "name": "interface_reachable",
                "status": "unavailable",
                "reason": reason,
            }
        ],
    }


def unavailable_query_response(
    query: str,
    conversation_id: str | None = None,
    request_id: str | None = None,
    *,
    reason: str = UNCONFIGURED_REASON,
) -> dict[str, Any]:
    return {
        "schema_version": QUERY_SCHEMA,
        "request_id": request_id,
        "conversation_id": conversation_id,
        "source": "host-agent",
        "mode": "UNAVAILABLE",
        "reason": reason,
        "query": query,
        "answer": {
            "mode": "UNAVAILABLE",
            "reason": reason,
            "summary": "",
            "insights": [],
            "gap": (
                "Host agent handoff endpoint is not configured."
                if reason == UNCONFIGURED_REASON
                else "Host Agent did not complete this request."
            ),
            "suggestions": [],
        },
        "evidence": [],
        "tool_trace": [],
    }


def unavailable_metadata_response(
    request: HostAgentMetadataRequest,
    *,
    reason: str = UNCONFIGURED_REASON,
    diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "schema_version": METADATA_SCHEMA,
        "request_id": request.request_id,
        "mode": "UNAVAILABLE",
        "reason": reason,
        "fields": {},
        "warnings": ["Host agent handoff endpoint is not configured." if reason == UNCONFIGURED_REASON else reason],
        "policy": {
            "preserve_user_fields": bool(request.policy.get("preserve_user_fields", True)),
        },
    }
    if diagnostics:
        payload["diagnostics"] = diagnostics
    return payload


def elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


def attach_backend_relay_timing(payload: dict[str, Any], relay_ms: float) -> dict[str, Any]:
    """Attach transport timing without changing the host-agent proposal semantics."""
    diagnostics = payload.get("diagnostics")
    if not isinstance(diagnostics, dict):
        return payload
    if "timings" in diagnostics and not isinstance(diagnostics["timings"], dict):
        return payload
    next_payload = dict(payload)
    next_diagnostics = dict(diagnostics)
    timings = dict(diagnostics.get("timings", {}))
    timings["backend_relay_ms"] = relay_ms
    next_diagnostics["timings"] = timings
    next_payload["diagnostics"] = next_diagnostics
    return next_payload


def check_indicates_not_ready(check: dict[str, Any]) -> bool:
    status = str(check.get("status") or "").strip().lower()
    return (
        status in NOT_READY_CHECK_STATUSES
        or check.get("ready") is False
        or check.get("stale") is True
        or check.get("would_rebuild") is True
        or check.get("background_rebuild") is True
    )


def _safe_identity(value: Any, fallback: str | None) -> str | None:
    """Preserve only a non-empty string identity from an invalid envelope."""
    return value if isinstance(value, str) and value else fallback


def _safe_terminal_error_reason(data: Any) -> str:
    """Select a bounded structured error code without relaying error text."""
    candidates: list[Any] = []
    if isinstance(data, dict):
        candidates.extend((data.get("code"), data.get("reason")))
        nested = data.get("error")
        if isinstance(nested, dict):
            candidates.extend((nested.get("code"), nested.get("reason")))
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        value = candidate.strip()
        if value and len(value) <= 80 and re.match(r"^[A-Za-z0-9_.:-]+$", value):
            return value
    return "host-agent-stream-error"


def normalize_host_agent_health(payload: dict[str, Any]) -> dict[str, Any]:
    """Downgrade false-green health when host checks report not-ready state."""
    normalized = dict(payload)
    checks = normalized.get("checks")
    if not isinstance(checks, list):
        return normalized

    failing_check = next(
        (check for check in checks if isinstance(check, dict) and check_indicates_not_ready(check)),
        None,
    )
    if failing_check is None:
        return normalized

    reason = str(
        failing_check.get("reason")
        or failing_check.get("code")
        or failing_check.get("status")
        or "host-agent-not-ready"
    )
    normalized["ready"] = False
    normalized["degraded"] = True
    normalized["mode"] = "NOT_READY"
    normalized["reason"] = reason
    return normalized


async def get_host_agent_health() -> dict[str, Any]:
    url = get_host_agent_url()
    if not url:
        return unavailable_health()

    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.get(f"{url}/health")
        response.raise_for_status()
        try:
            payload = parse_exact_json_object(response.text)
        except ValueError:
            return unavailable_health(reason=INVALID_ENVELOPE_REASON)
        try:
            validate_health(payload)
        except ValueError:
            return unavailable_health(reason=INVALID_ENVELOPE_REASON)
        normalized = normalize_host_agent_health(payload)
        try:
            validate_health(normalized)
        except ValueError:
            return unavailable_health(reason=INVALID_ENVELOPE_REASON)
        return normalized


async def post_host_agent_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    url = get_host_agent_url()
    if not url:
        raise RuntimeError(UNCONFIGURED_REASON)

    async with httpx.AsyncClient(timeout=host_agent_http_timeout_seconds()) as client:
        response = await client.post(f"{url}/metadata/propose", json=payload)
        response.raise_for_status()
        return parse_exact_json_object(response.text)


def _normalize_sse_newlines(raw: str) -> str:
    return raw.replace("\r\n", "\n").replace("\r", "\n")


def _parse_sse_chunk(chunk: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for part in _normalize_sse_newlines(chunk).split("\n\n"):
        if not part.strip():
            continue
        event_type = "message"
        data_text = ""
        for line in part.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            elif line.startswith("data: "):
                data_text = line.removeprefix("data: ")
        if not data_text:
            continue
        data = parse_exact_json_value(data_text)
        events.append({"type": event_type, "data": data})
    return events


def _split_sse_frames(buffer: str) -> tuple[list[str], str]:
    """Split complete SSE frames while carrying a terminal CR across chunks."""
    frames: list[str] = []
    frame_start = 0
    delimiter_start: int | None = None
    line_endings = 0
    index = 0

    while index < len(buffer):
        atom_start = index
        char = buffer[index]
        if char == "\r":
            if index + 1 >= len(buffer):
                break
            index += 2 if buffer[index + 1] == "\n" else 1
        elif char == "\n":
            index += 1
        else:
            index += 1
            line_endings = 0
            delimiter_start = None
            continue

        if line_endings == 0:
            delimiter_start = atom_start
        line_endings += 1
        if line_endings == 2:
            assert delimiter_start is not None
            frames.append(buffer[frame_start:delimiter_start])
            frame_start = index
            line_endings = 0
            delimiter_start = None

    return frames, buffer[frame_start:]


async def stream_host_agent_query(payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    url = get_host_agent_url()
    if not url:
        yield {"type": "final", "data": unavailable_query_response(str(payload.get("query") or ""))}
        return

    async with httpx.AsyncClient(timeout=host_agent_http_timeout_seconds()) as client:
        async with client.stream(
            "POST",
            f"{url}/query/stream",
            json=payload,
            headers={"accept": "text/event-stream"},
        ) as response:
            response.raise_for_status()
            buffer = ""
            async for text in response.aiter_text():
                buffer += text
                frames, buffer = _split_sse_frames(buffer)
                for frame in frames:
                    for event in _parse_sse_chunk(frame):
                        yield event
            if buffer.strip():
                for event in _parse_sse_chunk(buffer):
                    yield event


def _sse_frame(event_type: str, data: Any) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {text}\n\n"


@router.get("/health")
async def health_host_agent():
    try:
        payload = await get_host_agent_health()
    except Exception as exc:  # pragma: no cover - defensive network boundary
        payload = unavailable_health(reason="host-agent-health-unavailable")
        payload["error_type"] = type(exc).__name__
    return APIResponse.success(payload)


@router.post("/query/stream")
async def stream_host_agent_query_route(body: HostAgentQueryRequest):
    query = body.query.strip()
    if not query:
        envelope = APIResponse.error_response("VALIDATION_ERROR", "查询内容不能为空")
        return JSONResponse(status_code=200, content=envelope.model_dump())

    payload = body.model_dump()
    payload["query"] = query

    async def event_generator() -> AsyncIterator[str]:
        if not get_host_agent_url():
            yield _sse_frame(
                "final",
                unavailable_query_response(query, body.conversation_id, body.request_id),
            )
            return

        terminal_emitted = False
        try:
            async for event in stream_host_agent_query(payload):
                event_type = str(event.get("type") or "message")
                data = event.get("data")
                if event_type == "error":
                    terminal_emitted = True
                    yield _sse_frame(
                        "final",
                        unavailable_query_response(
                            query,
                            body.conversation_id,
                            body.request_id,
                            reason=_safe_terminal_error_reason(data),
                        ),
                    )
                    break
                if event_type == "final":
                    if isinstance(data, dict):
                        try:
                            validate_query_response(data)
                        except ValueError:
                            invalid_request_id = _safe_identity(data.get("request_id"), body.request_id)
                            invalid_conversation_id = _safe_identity(
                                data.get("conversation_id"), body.conversation_id
                            )
                            data = unavailable_query_response(
                                query,
                                invalid_conversation_id,
                                invalid_request_id,
                                reason=INVALID_ENVELOPE_REASON,
                            )
                    else:
                        data = unavailable_query_response(
                            query,
                            body.conversation_id,
                            body.request_id,
                            reason=INVALID_ENVELOPE_REASON,
                        )
                    terminal_emitted = True
                    yield _sse_frame("final", data)
                    break
                yield _sse_frame(event_type, data)
        except ValueError:
            if terminal_emitted:
                return
            yield _sse_frame(
                "final",
                unavailable_query_response(
                    query,
                    body.conversation_id,
                    body.request_id,
                    reason=INVALID_ENVELOPE_REASON,
                ),
            )
            return
        except Exception as exc:  # pragma: no cover - defensive network boundary
            if terminal_emitted:
                return
            yield _sse_frame(
                "final",
                {
                    **unavailable_query_response(
                        query,
                        body.conversation_id,
                        body.request_id,
                        reason="host-agent-stream-unavailable",
                    ),
                    "error_type": type(exc).__name__,
                },
            )
            return

        if not terminal_emitted:
            yield _sse_frame(
                "final",
                unavailable_query_response(
                    query,
                    body.conversation_id,
                    body.request_id,
                    reason=INVALID_ENVELOPE_REASON,
                ),
            )

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/metadata/propose")
async def propose_host_agent_metadata(body: HostAgentMetadataRequest):
    if not get_host_agent_url():
        return APIResponse.success(unavailable_metadata_response(body))

    relay_start = time.perf_counter()
    try:
        payload = await post_host_agent_metadata(body.model_dump())
    except ValueError:
        unavailable = unavailable_metadata_response(
            body,
            reason=INVALID_ENVELOPE_REASON,
            diagnostics={
                "stage": "backend-host-agent-metadata-validate",
                "error": INVALID_ENVELOPE_REASON,
                "timings": {"backend_relay_ms": elapsed_ms(relay_start)},
            },
        )
        return APIResponse.success(unavailable)
    except Exception as exc:  # pragma: no cover - defensive network boundary
        unavailable = unavailable_metadata_response(
            body,
            reason="host-agent-metadata-unavailable",
            diagnostics={
                "stage": "backend-host-agent-metadata-relay",
                "error_type": type(exc).__name__,
                "timings": {"backend_relay_ms": elapsed_ms(relay_start)},
            },
        )
        return APIResponse.success(unavailable)
    try:
        validate_metadata_proposal(payload)
    except ValueError:
        unavailable = unavailable_metadata_response(
            body,
            reason=INVALID_ENVELOPE_REASON,
            diagnostics={
                "stage": "backend-host-agent-metadata-validate",
                "error": INVALID_ENVELOPE_REASON,
                "timings": {"backend_relay_ms": elapsed_ms(relay_start)},
            },
        )
        return APIResponse.success(unavailable)
    return APIResponse.success(attach_backend_relay_timing(payload, elapsed_ms(relay_start)))
