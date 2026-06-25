"""Tests for Agent Bridge GUI consumption endpoints."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.adapter.agent_gateway_client import MockAgentGatewayClient
from backend.main import app

client = TestClient(app)


PROBE_PAYLOAD = {
    "success": True,
    "schema_version": "m35.agent_bridge_probe.v0",
    "command": "agent-bridge probe",
    "source": "P1",
    "mode": "host_agent",
    "transport": "openai",
    "endpoint": {"configured": True, "url": "http://127.0.0.1:8642/v1"},
    "model": {"configured": True, "name": "hermes-agent"},
    "ack": {"data_exposure_ack": True, "required_for": ["P1", "P2"]},
    "token": {
        "configured": True,
        "source": "env:LIFE_INDEX_LLM_API_KEY",
        "persisted_in_config": False,
    },
    "checks": [{"name": "models", "status": "pass", "model_ids": ["hermes-agent"]}],
    "sends_journal_evidence": False,
    "ready_to_send_evidence": True,
}


QUERY_PAYLOAD = {
    "source": "P1",
    "query": "What changed this week?",
    "scaffold": {
        "query": "What changed this week?",
        "filtered_results": [],
        "answer_scaffold": {"summary": "Use evidence before synthesis."},
    },
    "synthesis": "You focused on shipping the operator surface.",
}


def test_probe_returns_no_network_cli_payload_without_sending_journal_evidence():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = PROBE_PAYLOAD
        response = client.get("/api/agent-bridge/probe")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["schema_version"] == "m35.agent_bridge_probe.v0"
    assert body["data"]["command"] == "agent-bridge probe"
    assert body["data"]["sends_journal_evidence"] is False
    assert body["data"]["ready_to_send_evidence"] is True
    assert "synthesis" not in body["data"]
    assert "scaffold" not in body["data"]
    run_json.assert_awaited_once_with(
        ["agent-bridge", "probe", "--json", "--no-network"],
        timeout=15.0,
    )


def test_query_handoff_calls_agent_bridge_cli_only_after_user_query():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = QUERY_PAYLOAD
        response = client.post(
            "/api/agent-bridge/query",
            json={"query": "  What changed this week?  "},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["source"] == "P1"
    assert body["data"]["query"] == "What changed this week?"
    assert body["data"]["synthesis"]
    run_json.assert_awaited_once_with(
        ["agent-bridge", "--query", "What changed this week?"],
        timeout=90.0,
    )


def test_query_handoff_rejects_blank_query_without_cli_call():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        response = client.post("/api/agent-bridge/query", json={"query": "   "})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    run_json.assert_not_awaited()


def test_query_cli_failure_returns_structured_error():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.side_effect = CLIError(1, "agent bridge query failed")
        response = client.post(
            "/api/agent-bridge/query",
            json={"query": "What changed this week?"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_ERROR"


def test_probe_cli_failure_returns_structured_error():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.side_effect = CLIError(1, "agent bridge probe failed")
        response = client.get("/api/agent-bridge/probe")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_ERROR"


def test_health_returns_backend_mediated_gateway_snapshot():
    gateway = MockAgentGatewayClient(warm_on_start=True)
    with patch("backend.routers.agent_bridge.get_gateway_client", return_value=gateway):
        response = client.get("/api/agent-bridge/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["running"] is True
    assert body["data"]["reconnects"] == 0
    assert body["data"]["lifecycle"]["discover_or_start"] is True


def test_health_maps_gateway_exception_to_down_snapshot():
    gateway = MockAgentGatewayClient(warm_on_start=True)
    with patch.object(gateway, "health", new_callable=AsyncMock) as health:
        health.side_effect = RuntimeError("gateway unavailable")
        with patch("backend.routers.agent_bridge.get_gateway_client", return_value=gateway):
            response = client.get("/api/agent-bridge/health")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"] == {"running": False, "error": "gateway unavailable"}


def _parse_sse(raw: str):
    frames = []
    for chunk in raw.strip().split("\n\n"):
        event_type = None
        data = None
        for line in chunk.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = line.removeprefix("data: ")
        frames.append((event_type, data))
    return frames


class CapturingConversationGateway:
    def __init__(self):
        self.stream_calls = []

    async def stream(self, query, scaffold=None, conversation_id=None):
        self.stream_calls.append(
            {
                "query": query,
                "scaffold": scaffold,
                "conversation_id": conversation_id,
            }
        )
        yield {"type": "status", "data": {"phase": "warming"}}
        yield {
            "type": "final",
            "data": {
                "schema_version": "m35.agent_bridge_query.v0",
                "command": "agent-bridge query",
                "source": "host-agent",
                "query": query,
                "mode": "GROUNDED",
                "scaffold": scaffold or {},
                "evidence": [],
                "answer": {
                    "mode": "GROUNDED",
                    "summary": "captured",
                    "insights": [],
                    "related_findings": [],
                    "gap": None,
                    "explanation": None,
                    "what_was_found": [],
                    "suggestions": [],
                },
                "synthesis": "captured",
            },
        }


def test_stream_query_forwards_contract_sse_events_from_mock_gateway():
    gateway = MockAgentGatewayClient(warm_on_start=True)
    with patch("backend.routers.agent_bridge.get_gateway_client", return_value=gateway):
        response = client.post(
            "/api/agent-bridge/query/stream",
            json={"query": "  Where did I go?  "},
            headers={"accept": "text/event-stream"},
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == [
        "status",
        "scaffold",
        "evidence",
        "delta",
        "delta",
        "final",
    ]
    assert '"text":"You visited "' in frames[3][1]
    assert '"schema_version":"m35.agent_bridge_query.v0"' in frames[-1][1]
    assert '"mode":"GROUNDED"' in frames[-1][1]


def test_stream_query_passes_conversation_id_through_to_gateway():
    gateway = CapturingConversationGateway()
    with patch("backend.routers.agent_bridge.get_gateway_client", return_value=gateway):
        first = client.post(
            "/api/agent-bridge/query/stream",
            json={"query": "First question", "conversation_id": "conv-abc"},
            headers={"accept": "text/event-stream"},
        )
        second = client.post(
            "/api/agent-bridge/query/stream",
            json={"query": "Follow up", "conversation_id": "conv-abc"},
            headers={"accept": "text/event-stream"},
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert [call["conversation_id"] for call in gateway.stream_calls] == [
        "conv-abc",
        "conv-abc",
    ]
    assert [call["query"] for call in gateway.stream_calls] == [
        "First question",
        "Follow up",
    ]


def test_stream_query_without_conversation_id_keeps_single_turn_behavior():
    gateway = CapturingConversationGateway()
    with patch("backend.routers.agent_bridge.get_gateway_client", return_value=gateway):
        response = client.post(
            "/api/agent-bridge/query/stream",
            json={"query": "Standalone question"},
            headers={"accept": "text/event-stream"},
        )

    assert response.status_code == 200
    assert gateway.stream_calls == [
        {
            "query": "Standalone question",
            "scaffold": None,
            "conversation_id": None,
        }
    ]


def test_stream_query_maps_gateway_error_event_to_standard_envelope():
    gateway = MockAgentGatewayClient(error_on_query=True)
    with patch("backend.routers.agent_bridge.get_gateway_client", return_value=gateway):
        response = client.post(
            "/api/agent-bridge/query/stream",
            json={"query": "force error"},
            headers={"accept": "text/event-stream"},
        )

    assert response.status_code == 200
    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["status", "error"]
    assert '"ok":false' in frames[-1][1]
    assert '"code":"AGENT_GATEWAY_ERROR"' in frames[-1][1]


def test_stream_query_rejects_blank_query_without_gateway_call():
    gateway = MockAgentGatewayClient(warm_on_start=True)
    with patch.object(gateway, "stream", wraps=gateway.stream) as stream:
        with patch("backend.routers.agent_bridge.get_gateway_client", return_value=gateway):
            response = client.post(
                "/api/agent-bridge/query/stream",
                json={"query": "   "},
                headers={"accept": "text/event-stream"},
            )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    stream.assert_not_called()


def test_stream_query_does_not_change_cold_query_route_behavior():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = QUERY_PAYLOAD
        response = client.post(
            "/api/agent-bridge/query",
            json={"query": "What changed this week?"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["synthesis"] == "You focused on shipping the operator surface."
    run_json.assert_awaited_once_with(
        ["agent-bridge", "--query", "What changed this week?"],
        timeout=90.0,
    )
