"""Agent Bridge router — GUI consumption through CLI/L3 envelopes only."""

import json
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from backend.adapter.agent_gateway_client import get_gateway_client
from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.models.response import APIResponse

router = APIRouter(prefix="/agent-bridge", tags=["agent-bridge"])


def get_cli() -> CLIAdapter:
    return CLIAdapter()


class AgentBridgeQueryRequest(BaseModel):
    query: str
    scaffold: dict[str, Any] | None = None
    conversation_id: str | None = None


@router.get("/probe")
async def probe_agent_bridge(cli: CLIAdapter = Depends(get_cli)):
    """Run the safe no-journal-evidence Agent Bridge preflight."""
    try:
        payload = await cli.run_json(
            ["agent-bridge", "probe", "--json", "--no-network"],
            timeout=15.0,
        )
    except CLIError as exc:
        return APIResponse.error_response(
            "CLI_ERROR",
            exc.stderr or exc.stdout or "Agent Bridge probe command failed.",
        )

    return APIResponse.success(payload)


@router.get("/health")
async def health_agent_bridge():
    """Return backend-mediated gateway liveness for frontend AI+ readiness."""
    gateway = get_gateway_client()
    try:
        payload = await gateway.health()
    except Exception as exc:  # pragma: no cover - defensive safety net
        payload = {"running": False, "error": str(exc)}
    return APIResponse.success(payload)


@router.post("/query")
async def query_agent_bridge(
    body: AgentBridgeQueryRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """Run an explicit Agent Bridge handoff query through the CLI.

    This path may send journal evidence to the configured host-agent endpoint,
    so it is POST-only and requires a nonblank user query.
    """
    query = body.query.strip()
    if not query:
        return APIResponse.error_response("VALIDATION_ERROR", "查询内容不能为空")

    try:
        payload = await cli.run_json(
            ["agent-bridge", "--query", query],
            timeout=90.0,
        )
    except CLIError as exc:
        return APIResponse.error_response(
            "CLI_ERROR",
            exc.stderr or exc.stdout or "Agent Bridge query command failed.",
        )

    return APIResponse.success(payload)


@router.post("/query/stream")
async def stream_agent_bridge_query(body: AgentBridgeQueryRequest):
    """Stream an Agent Bridge query through the gateway seam over SSE.

    This endpoint is intentionally separate from the cold ``/query`` route.
    It does not invoke the CLI directly; it forwards contract events from
    the configured gateway client so the GUI can render live thinking,
    evidence, and answer deltas without buffering the full response.
    """
    query = body.query.strip()
    if not query:
        envelope = APIResponse.error_response("VALIDATION_ERROR", "查询内容不能为空")
        return JSONResponse(status_code=200, content=envelope.model_dump())

    gateway = get_gateway_client()

    async def event_generator() -> AsyncIterator[str]:
        try:
            async for event in gateway.stream(
                query,
                scaffold=body.scaffold,
                conversation_id=body.conversation_id,
            ):
                event_type = event.get("type")
                data = event.get("data")
                if event_type == "error":
                    payload = APIResponse.error_response(
                        data.get("code", "AGENT_GATEWAY_ERROR"),
                        data.get("message", "Agent gateway error"),
                        data.get("details"),
                    )
                    text = json.dumps(payload.model_dump(), separators=(",", ":"))
                else:
                    text = json.dumps(data, separators=(",", ":"))
                yield f"event: {event_type}\ndata: {text}\n\n"
        except Exception as exc:  # pragma: no cover - safety net
            payload = APIResponse.error_response("AGENT_GATEWAY_ERROR", str(exc))
            yield f"event: error\ndata: {json.dumps(payload.model_dump(), separators=(',', ':'))}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
    )
