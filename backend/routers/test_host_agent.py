"""Tests for runtime-neutral Host Agent handoff endpoints."""

from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import host_agent

client = TestClient(app)


def _parse_sse(raw: str):
    frames = []
    for chunk in raw.strip().split("\n\n"):
        if not chunk.strip():
            continue
        event_type = None
        data = None
        for line in chunk.splitlines():
            if line.startswith("event: "):
                event_type = line.removeprefix("event: ")
            if line.startswith("data: "):
                data = line.removeprefix("data: ")
        frames.append((event_type, data))
    return frames


def test_host_agent_health_defaults_to_unavailable_without_runtime(monkeypatch):
    """GET /api/host-agent/health is honest when no host-agent endpoint exists."""
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_URL", raising=False)

    response = client.get("/api/host-agent/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["running"] is False
    assert payload["data"]["ready"] is False
    assert payload["data"]["mode"] == "UNAVAILABLE"
    assert payload["data"]["reason"] == "host-agent-unconfigured"
    assert payload["data"]["runtime"]["kind"] == "external-host-agent"


def test_host_agent_router_source_has_no_backend_orchestration_calls():
    """CI gate: host-agent router must stay transport-only, not smart."""
    source = Path(host_agent.__file__).read_text(encoding="utf-8")

    forbidden = [
        "CLIAdapter",
        "aggregate(",
        "trajectory(",
        "smart-search",
        "agent" + "-bridge",
        "openai",
        "llm",
    ]

    for token in forbidden:
        assert token not in source


def test_host_agent_health_downgrades_false_green_index_stale():
    """CI gate: ready health cannot stay ready when index/retrieval checks are stale."""
    payload = {
        "schema_version": "gui.host_agent.health.v1",
        "running": True,
        "ready": True,
        "degraded": False,
        "mode": "READY",
        "reason": "ready",
        "runtime": {"kind": "external-host-agent", "interface_version": "v1"},
        "checks": [
            {"name": "index_freshness", "status": "stale", "reason": "background_rebuild"},
        ],
    }

    normalized = host_agent.normalize_host_agent_health(payload)

    assert normalized["running"] is True
    assert normalized["ready"] is False
    assert normalized["degraded"] is True
    assert normalized["mode"] == "NOT_READY"
    assert normalized["reason"] == "background_rebuild"


def test_host_agent_stream_returns_unavailable_final_without_runtime(monkeypatch):
    """Streaming query never fabricates an answer when host agent is unavailable."""
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_URL", raising=False)

    response = client.post(
        "/api/host-agent/query/stream",
        json={"query": "今年 SkyVision Africa 有多少篇？"},
        headers={"accept": "text/event-stream"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["final"]
    assert '"mode":"UNAVAILABLE"' in frames[0][1]
    assert '"reason":"host-agent-unconfigured"' in frames[0][1]
    assert '"evidence":[]' in frames[0][1]
    assert '"tool_trace":[]' in frames[0][1]


def test_host_agent_stream_rejects_blank_query_without_runtime_call(monkeypatch):
    """Blank stream requests fail validation before any host handoff."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    response = client.post(
        "/api/host-agent/query/stream",
        json={"query": "   "},
        headers={"accept": "text/event-stream"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "VALIDATION_ERROR"


def test_host_agent_metadata_propose_defaults_to_unavailable_without_runtime(monkeypatch):
    """Metadata proposal returns a structured unavailable proposal, not fake fields."""
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_URL", raising=False)

    response = client.post(
        "/api/host-agent/metadata/propose",
        json={
            "draft": {
                "title": "",
                "content": "今天和 Morgan 讨论 SkyVision 项目。",
                "date": "2026-06-21",
                "existing_metadata": {"project": "User Project"},
            },
            "policy": {"preserve_user_fields": True},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["mode"] == "UNAVAILABLE"
    assert payload["data"]["reason"] == "host-agent-unconfigured"
    assert payload["data"]["fields"] == {}
    assert payload["data"]["policy"]["preserve_user_fields"] is True


def test_host_agent_metadata_policy_defaults_to_preserve_user_fields(monkeypatch):
    """CI gate: metadata handoff defaults to preserve_user_fields when omitted."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    host_payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": None,
        "mode": "PROPOSED",
        "reason": "ok",
        "fields": {},
        "warnings": [],
    }

    with patch("backend.routers.host_agent.post_host_agent_metadata", new_callable=AsyncMock) as post_metadata:
        post_metadata.return_value = host_payload
        response = client.post(
            "/api/host-agent/metadata/propose",
            json={
                "draft": {
                    "title": "Manual title",
                    "content": "Draft body",
                    "date": "2026-06-21",
                    "existing_metadata": {"title": "Manual title"},
                },
            },
        )

    assert response.status_code == 200
    post_metadata.assert_awaited_once()
    sent_payload = post_metadata.await_args.args[0]
    assert sent_payload["policy"]["preserve_user_fields"] is True


def test_host_agent_metadata_unavailable_preserves_diagnostics(monkeypatch):
    """Metadata handoff failures keep bounded diagnostics for reliability triage."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    with patch("backend.routers.host_agent.post_host_agent_metadata", new_callable=AsyncMock) as post_metadata:
        post_metadata.side_effect = RuntimeError("bridge exploded")
        response = client.post(
            "/api/host-agent/metadata/propose",
            json={
                "request_id": "metadata-retry-1",
                "draft": {
                    "title": "",
                    "content": "今天和 Morgan 讨论 SkyVision 项目。",
                    "date": "2026-06-21",
                    "existing_metadata": {"project": "User Project"},
                },
                "policy": {"preserve_user_fields": True},
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["request_id"] == "metadata-retry-1"
    assert data["mode"] == "UNAVAILABLE"
    assert data["reason"] == "host-agent-metadata-unavailable"
    assert data["diagnostics"]["error"] == "bridge exploded"
    assert data["diagnostics"]["stage"] == "backend-host-agent-metadata-relay"
    assert data["diagnostics"]["timings"]["backend_relay_ms"] >= 0
    assert data["policy"]["preserve_user_fields"] is True


def test_host_agent_metadata_relay_adds_backend_timing_without_clobbering_bridge_timings(monkeypatch):
    """Metadata relay preserves bridge timings and adds backend relay timing for slow-path diagnosis."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    host_payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "timing-1",
        "mode": "PROPOSED",
        "reason": "semantic-fields-proposed-by-host-agent",
        "fields": {
            "title": {
                "value": "Timing Test",
                "field_source": "host-agent",
            }
        },
        "warnings": [],
        "diagnostics": {
            "timings": {
                "runtime_ms": 123.4,
                "parse_ms": 2.5,
                "bridge_total_ms": 130.0,
            }
        },
    }

    with patch("backend.routers.host_agent.post_host_agent_metadata", new_callable=AsyncMock) as post_metadata:
        post_metadata.return_value = host_payload
        response = client.post(
            "/api/host-agent/metadata/propose",
            json={
                "request_id": "timing-1",
                "draft": {
                    "title": "",
                    "content": "Metadata timing draft.",
                    "date": "2026-06-23",
                    "existing_metadata": {},
                },
                "policy": {"preserve_user_fields": True},
            },
        )

    assert response.status_code == 200
    data = response.json()["data"]
    timings = data["diagnostics"]["timings"]
    assert timings["runtime_ms"] == 123.4
    assert timings["parse_ms"] == 2.5
    assert timings["bridge_total_ms"] == 130.0
    assert timings["backend_relay_ms"] >= 0


def test_host_agent_handoff_http_timeout_defaults_to_product_upper_bound(monkeypatch):
    """Host-agent metadata handoff allows real agent loops to run past one minute."""
    monkeypatch.delenv("LIFE_INDEX_HOST_AGENT_HTTP_TIMEOUT_SECONDS", raising=False)

    assert host_agent.host_agent_http_timeout_seconds() == 600.0

    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_HTTP_TIMEOUT_SECONDS", "120")

    assert host_agent.host_agent_http_timeout_seconds() == 120.0


def test_host_agent_stream_relay_does_not_call_cli_or_choose_tools(monkeypatch):
    """Configured handoff streams host frames without backend CLI orchestration."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {
            "type": "status",
            "data": {"phase": "planning", "message": "host planning"},
        }
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "req-1",
                "conversation_id": "conv-1",
                "source": "host-agent",
                "mode": "PARTIAL",
                "reason": "host-returned-partial",
                "query": "最近晚睡趋势怎么样？",
                "answer": {
                    "mode": "PARTIAL",
                    "reason": "host-returned-partial",
                    "summary": "没有足够证据确认趋势。",
                    "insights": [],
                    "gap": "sleep observations missing",
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [{"tool": "trajectory", "status": "ok"}],
            },
        }

    with patch("backend.adapter.cli_adapter.CLIAdapter.run_json", new_callable=AsyncMock) as run_json:
        with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
            response = client.post(
                "/api/host-agent/query/stream",
                json={"query": "最近晚睡趋势怎么样？", "conversation_id": "conv-1"},
                headers={"accept": "text/event-stream"},
            )

    assert response.status_code == 200
    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["status", "final"]
    assert '"mode":"PARTIAL"' in frames[1][1]
    assert '"reason":"host-returned-partial"' in frames[1][1]
    run_json.assert_not_awaited()


def test_host_agent_metadata_relay_does_not_call_cli_or_extract_fields(monkeypatch):
    """Configured metadata handoff relays host proposal without backend extraction."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    host_payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "req-1",
        "mode": "PROPOSED",
        "reason": "semantic-fields-proposed-by-host-agent",
        "fields": {
            "project": {
                "value": "SkyVision Africa",
                "field_source": "agent_semantic",
                "confidence": 0.9,
                "rationale": "正文提到 SkyVision 项目。",
            }
        },
        "warnings": [],
    }

    with patch("backend.adapter.cli_adapter.CLIAdapter.run_json", new_callable=AsyncMock) as run_json:
        with patch("backend.routers.host_agent.post_host_agent_metadata", new_callable=AsyncMock) as post_metadata:
            post_metadata.return_value = host_payload
            response = client.post(
                "/api/host-agent/metadata/propose",
                json={
                    "draft": {
                        "title": "",
                        "content": "今天和 Morgan 讨论 SkyVision 项目。",
                        "date": "2026-06-21",
                        "existing_metadata": {"project": "User Project"},
                    },
                    "policy": {"preserve_user_fields": True},
                },
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"] == host_payload
    post_metadata.assert_awaited_once()
    run_json.assert_not_awaited()
