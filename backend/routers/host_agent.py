"""Runtime-neutral Host Agent handoff router.

This router owns only GUI/backend transport concerns: validation, relay,
SSE framing, and honest unavailable envelopes. It must not choose CLI tools,
inspect query semantics, synthesize answers, or extract metadata.
"""

import json
import os
import time
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from backend.models.response import APIResponse

router = APIRouter(prefix="/host-agent", tags=["host-agent"])

HOST_AGENT_SCHEMA_VERSION = "gui.host_agent"
UNCONFIGURED_REASON = "host-agent-unconfigured"
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


def unavailable_health() -> dict[str, Any]:
    return {
        "schema_version": f"{HOST_AGENT_SCHEMA_VERSION}.health.v1",
        "running": False,
        "ready": False,
        "degraded": True,
        "mode": "UNAVAILABLE",
        "reason": UNCONFIGURED_REASON,
        "runtime": {
            "kind": "external-host-agent",
            "interface_version": "v1",
        },
        "checks": [
            {
                "name": "interface_reachable",
                "status": "unavailable",
                "reason": UNCONFIGURED_REASON,
            }
        ],
    }


def unavailable_query_response(query: str, conversation_id: str | None = None) -> dict[str, Any]:
    return {
        "schema_version": f"{HOST_AGENT_SCHEMA_VERSION}.query_response.v1",
        "request_id": None,
        "conversation_id": conversation_id,
        "source": "host-agent",
        "mode": "UNAVAILABLE",
        "reason": UNCONFIGURED_REASON,
        "query": query,
        "answer": {
            "mode": "UNAVAILABLE",
            "reason": UNCONFIGURED_REASON,
            "summary": "",
            "insights": [],
            "gap": "Host agent handoff endpoint is not configured.",
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
        "schema_version": f"{HOST_AGENT_SCHEMA_VERSION}.metadata_proposal.v1",
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
    if "diagnostics" not in payload:
        return payload
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
    timings["backend_relay_ms"] = relay_ms
    diagnostics["timings"] = timings
    next_payload["diagnostics"] = diagnostics
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


def normalize_host_agent_health(payload: dict[str, Any]) -> dict[str, Any]:
    """Downgrade false-green health when host checks report not-ready state."""
    normalized = dict(payload)
    checks = normalized.get("checks")
    if not isinstance(checks, list):
        normalized["checks"] = []
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
        payload = response.json()
        return normalize_host_agent_health(payload) if isinstance(payload, dict) else unavailable_health()


async def post_host_agent_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    url = get_host_agent_url()
    if not url:
        raise RuntimeError(UNCONFIGURED_REASON)

    async with httpx.AsyncClient(timeout=host_agent_http_timeout_seconds()) as client:
        response = await client.post(f"{url}/metadata/propose", json=payload)
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) else {}


def _parse_sse_chunk(chunk: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for part in chunk.split("\n\n"):
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
        data = json.loads(data_text)
        events.append({"type": event_type, "data": data})
    return events


async def stream_host_agent_query(payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    url = get_host_agent_url()
    if not url:
        yield {"type": "final", "data": unavailable_query_response(str(payload.get("query") or ""))}
        return

    async with httpx.AsyncClient(timeout=None) as client:
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
                parts = buffer.split("\n\n")
                buffer = parts.pop() or ""
                for event in _parse_sse_chunk("\n\n".join(parts)):
                    yield event
            if buffer.strip():
                for event in _parse_sse_chunk(buffer):
                    yield event


def _sse_frame(event_type: str, data: dict[str, Any]) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {text}\n\n"


@router.get("/health")
async def health_host_agent():
    try:
        payload = await get_host_agent_health()
    except Exception as exc:  # pragma: no cover - defensive network boundary
        payload = unavailable_health()
        payload["reason"] = "host-agent-health-unavailable"
        payload["error"] = str(exc)
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
            yield _sse_frame("final", unavailable_query_response(query, body.conversation_id))
            return

        try:
            async for event in stream_host_agent_query(payload):
                event_type = str(event.get("type") or "message")
                data = event.get("data")
                if not isinstance(data, dict):
                    data = {"value": data}
                yield _sse_frame(event_type, data)
        except Exception as exc:  # pragma: no cover - defensive network boundary
            yield _sse_frame(
                "final",
                {
                    **unavailable_query_response(query, body.conversation_id),
                    "reason": "host-agent-stream-unavailable",
                    "error": str(exc),
                },
            )

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/metadata/propose")
async def propose_host_agent_metadata(body: HostAgentMetadataRequest):
    if not get_host_agent_url():
        return APIResponse.success(unavailable_metadata_response(body))

    relay_start = time.perf_counter()
    try:
        payload = await post_host_agent_metadata(body.model_dump())
    except Exception as exc:  # pragma: no cover - defensive network boundary
        unavailable = unavailable_metadata_response(
            body,
            reason="host-agent-metadata-unavailable",
            diagnostics={
                "stage": "backend-host-agent-metadata-relay",
                "error": str(exc),
                "error_type": type(exc).__name__,
                "timings": {"backend_relay_ms": elapsed_ms(relay_start)},
            },
        )
        return APIResponse.success(unavailable)
    return APIResponse.success(attach_backend_relay_timing(payload, elapsed_ms(relay_start)))
