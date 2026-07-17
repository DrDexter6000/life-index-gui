"""Tests for runtime-neutral Host Agent handoff endpoints."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
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


class _RawResponse:
    def __init__(self, text: str | None = None, chunks: list[str] | None = None):
        self.text = text or ""
        self._chunks = chunks or []

    def raise_for_status(self):
        return None

    def json(self):
        raise AssertionError("raw relay must not call response.json()")

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _tb):
        return None

    async def aiter_text(self):
        for chunk in self._chunks:
            yield chunk


class _RawClient:
    def __init__(self, response: _RawResponse):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _tb):
        return None

    async def get(self, _url):
        return self.response

    async def post(self, _url, json=None):
        return self.response

    def stream(self, *_args, **_kwargs):
        return self.response


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


def test_host_agent_configured_invalid_health_maps_to_envelope_invalid(monkeypatch):
    """A configured upstream with an invalid health envelope is not unconfigured."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    class FakeResponse:
        text = json.dumps(
            {
                "schema_version": "gui.host_agent.health.v1",
                "running": True,
                "ready": True,
                "degraded": False,
                "mode": "READY",
                "reason": "invalid-running-type",
                "runtime": {"kind": "external-host-agent", "interface_version": "v1"},
                "checks": "MALFORMED-CHECKS-SECRET",
            }
        )

        def raise_for_status(self):
            return None

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return None

        async def get(self, _url):
            return FakeResponse()

    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: FakeClient())

    payload = asyncio.run(host_agent.get_host_agent_health())

    assert payload["mode"] == "UNAVAILABLE"
    assert payload["reason"] == "host-agent-envelope-invalid"


@pytest.mark.parametrize(
    "raw",
    [
        '{"schema_version":"gui.host_agent.health.v1","running":true,"ready":true,"degraded":false,"mode":"READY","reason":"first","reason":"ready","runtime":{"kind":"external-host-agent","interface_version":"v1"},"checks":[]}',
        '{"schema_version":"gui.host_agent.health.v1","running":true,"ready":true,"degraded":false,"mode":"READY","reason":"ready","runtime":{"kind":"external-host-agent","interface_version":"v1","latency":NaN},"checks":[]}',
    ],
)
def test_host_agent_health_rejects_duplicate_or_nonfinite_raw_json(monkeypatch, raw):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    response = _RawResponse(text=raw)
    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: _RawClient(response))

    payload = asyncio.run(host_agent.get_host_agent_health())

    assert payload["mode"] == "UNAVAILABLE"
    assert payload["reason"] == "host-agent-envelope-invalid"


def test_host_agent_metadata_parses_raw_response_text_and_preserves_additive_fields(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    raw = (
        '{"schema_version":"gui.host_agent.metadata_proposal.v1",'
        '"request_id":"metadata-raw-1","mode":"PROPOSED",'
        '"reason":"raw proposal","fields":{"title":{"value":"Raw title"}},'
        '"warnings":[],"future":{"provider_neutral":true}}'
    )
    response = _RawResponse(text=raw)
    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: _RawClient(response))

    payload = asyncio.run(
        host_agent.post_host_agent_metadata(
            {"request_id": "metadata-raw-1", "draft": {"content": "Draft"}}
        )
    )

    assert payload["future"] == {"provider_neutral": True}
    assert payload["fields"]["title"]["value"] == "Raw title"


@pytest.mark.parametrize(
    "raw",
    [
        '{"schema_version":"gui.host_agent.metadata_proposal.v1","reason":"first","reason":"second","fields":{},"warnings":[]}',
        '{"schema_version":"gui.host_agent.metadata_proposal.v1","reason":"raw","fields":{"title":{"confidence":NaN}},"warnings":[]}',
    ],
)
def test_host_agent_metadata_rejects_duplicate_or_nonfinite_raw_json(monkeypatch, raw):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    response = _RawResponse(text=raw)
    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: _RawClient(response))

    with pytest.raises(ValueError) as exc_info:
        asyncio.run(
            host_agent.post_host_agent_metadata(
                {"request_id": "metadata-invalid-raw", "draft": {"content": "Draft"}}
            )
        )

    assert str(exc_info.value) == "host-agent-envelope-invalid"


@pytest.mark.parametrize(
    "raw",
    [
        '{"schema_version":"gui.host_agent.metadata_proposal.v1","reason":"first","reason":"second","fields":{},"warnings":[]}',
        '{"schema_version":"gui.host_agent.metadata_proposal.v1","reason":"raw","fields":{"title":{"confidence":NaN}},"warnings":[]}',
    ],
)
def test_host_agent_metadata_raw_parse_failure_maps_to_envelope_invalid(monkeypatch, raw):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    response = _RawResponse(text=raw)
    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: _RawClient(response))

    result = client.post(
        "/api/host-agent/metadata/propose",
        json={"request_id": "metadata-invalid-raw", "draft": {"content": "Draft"}},
    )

    assert result.status_code == 200
    data = result.json()["data"]
    assert data["mode"] == "UNAVAILABLE"
    assert data["reason"] == "host-agent-envelope-invalid"
    assert data["fields"] == {}
    assert "NaN" not in result.text


def test_host_agent_health_exception_does_not_expose_raw_error(monkeypatch):
    monkeypatch.setattr(
        host_agent,
        "get_host_agent_health",
        AsyncMock(side_effect=RuntimeError("HEALTH-SECRET prompt/journal content")),
    )

    response = client.get("/api/host-agent/health")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert "HEALTH-SECRET" not in response.text
    assert payload["error_type"] == "RuntimeError"
    assert "error" not in payload


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


def test_host_agent_sse_parser_accepts_crlf_status_and_final(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    chunks = [
        'event: status\r\ndata: "status text"\r\n\r\nevent: final\r\ndata: {"mode":"PARTIAL"}\r\n\r\n'
    ]

    class FakeResponse:
        def raise_for_status(self):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return None

        async def aiter_text(self):
            for chunk in chunks:
                yield chunk

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return None

        def stream(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: FakeClient())

    async def collect_events():
        return [event async for event in host_agent.stream_host_agent_query({"query": "q"})]

    events = asyncio.run(collect_events())

    assert [event["type"] for event in events] == ["status", "final"]
    assert events[0]["data"] == "status text"
    assert events[1]["data"] == {"mode": "PARTIAL"}


def test_host_agent_sse_parser_handles_delimiter_split_across_chunks(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    chunks = [
        'event: status\ndata: "status text"\n',
        '\nevent: final\ndata: {"mode":"PARTIAL"}\n',
        "\n",
    ]

    class FakeResponse:
        def raise_for_status(self):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return None

        async def aiter_text(self):
            for chunk in chunks:
                yield chunk

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return None

        def stream(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: FakeClient())

    async def collect_events():
        return [event async for event in host_agent.stream_host_agent_query({"query": "q"})]

    events = asyncio.run(collect_events())

    assert [event["type"] for event in events] == ["status", "final"]
    assert events.count(events[-1]) == 1


def test_host_agent_sse_parser_preserves_crlf_split_inside_event_line(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    response = _RawResponse(
        chunks=[
            'event: status\r',
            '\ndata: "status text"\r\n\r\nevent: final\r\ndata: {"mode":"PARTIAL"}\r\n\r\n',
        ]
    )
    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: _RawClient(response))

    async def collect_events():
        return [event async for event in host_agent.stream_host_agent_query({"query": "q"})]

    events = asyncio.run(collect_events())

    assert [event["type"] for event in events] == ["status", "final"]
    assert events[0]["data"] == "status text"
    assert events.count(events[-1]) == 1


def test_host_agent_sse_parser_normalizes_lone_cr_across_chunks(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    final = {
        "schema_version": "gui.host_agent.query_response.v1",
        "request_id": None,
        "conversation_id": None,
        "source": "host-agent",
        "mode": "PARTIAL",
        "reason": "partial",
        "query": "q",
        "answer": {
            "mode": "PARTIAL",
            "summary": "partial",
            "insights": [],
            "gap": "missing evidence",
            "suggestions": [],
        },
        "evidence": [],
        "tool_trace": [],
    }
    chunks = [
        'event: status\rdata: "status text"\r\r',
        f"event: final\rdata: {json.dumps(final, separators=(',', ':'))}\r\r",
    ]

    class FakeResponse:
        def raise_for_status(self):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return None

        async def aiter_text(self):
            for chunk in chunks:
                yield chunk

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, _exc_type, _exc, _tb):
            return None

        def stream(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: FakeClient())

    async def collect_events():
        return [event async for event in host_agent.stream_host_agent_query({"query": "q"})]

    events = asyncio.run(collect_events())

    assert [event["type"] for event in events] == ["status", "final"]
    assert events[0]["data"] == "status text"
    assert events.count(events[-1]) == 1
    assert events[1]["data"] == final


@pytest.mark.parametrize(
    "raw_final",
    [
        '{"schema_version":"gui.host_agent.query_response.v1","request_id":null,"conversation_id":null,"source":"host-agent","mode":"PARTIAL","reason":"first","reason":"partial","query":"q","answer":{"mode":"PARTIAL","summary":"ok","insights":[],"gap":"gap","suggestions":[]},"evidence":[],"tool_trace":[]}',
        '{"schema_version":"gui.host_agent.query_response.v1","request_id":null,"conversation_id":null,"source":"host-agent","mode":"PARTIAL","reason":"partial","query":"q","answer":{"mode":"PARTIAL","summary":"ok","insights":[],"gap":"gap","suggestions":[]},"evidence":[],"tool_trace":[],"future":{"score":NaN}}',
    ],
)
def test_host_agent_sse_rejects_duplicate_or_nonfinite_raw_final(monkeypatch, raw_final):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    response = _RawResponse(chunks=[f"event: final\ndata: {raw_final}\n\n"])
    monkeypatch.setattr(host_agent.httpx, "AsyncClient", lambda **_kwargs: _RawClient(response))

    result = client.post(
        "/api/host-agent/query/stream",
        json={"query": "q"},
        headers={"accept": "text/event-stream"},
    )

    frames = _parse_sse(result.text)
    assert [event for event, _data in frames] == ["final"]
    final = json.loads(frames[0][1])
    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"
    assert "NaN" not in result.text


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
        post_metadata.side_effect = RuntimeError("METADATA-SECRET prompt/journal content")
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
    assert "METADATA-SECRET" not in response.text
    assert data["diagnostics"]["error_type"] == "RuntimeError"
    assert "error" not in data["diagnostics"]
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


def test_host_agent_metadata_relay_preserves_non_dict_additive_diagnostics_and_timings():
    payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "non-dict-diagnostics-1",
        "mode": "PROPOSED",
        "reason": "proposal",
        "fields": {"title": {"value": "Timing Test"}},
        "warnings": [],
        "diagnostics": {"timings": "do-not-replace", "future": "preserve"},
    }

    assert host_agent.attach_backend_relay_timing(payload, 12.5) == payload

    diagnostics_payload = dict(payload)
    diagnostics_payload["diagnostics"] = "do-not-replace"
    assert host_agent.attach_backend_relay_timing(diagnostics_payload, 12.5) == diagnostics_payload


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


def test_host_agent_query_relay_invalid_final_maps_to_unavailable_and_preserves_status_delta(monkeypatch):
    """Final envelopes are validated while progress frames remain passthrough."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {"type": "status", "data": {"phase": "planning", "message": "host planning"}}
        yield {"type": "delta", "data": {"text": "host partial output"}}
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "req-invalid-final",
                "conversation_id": "conv-invalid-final",
                "source": "host-agent",
                "mode": "GROUNDED",
                "reason": "contradictory evidence",
                "query": "What did I write?",
                "answer": {
                    "mode": "GROUNDED",
                    "summary": "This must not be relayed.",
                    "insights": [],
                    "gap": None,
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={"query": "What did I write?", "conversation_id": "conv-invalid-final"},
            headers={"accept": "text/event-stream"},
        )

    assert response.status_code == 200
    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["status", "delta", "final"]
    assert frames[0][1] == '{"phase":"planning","message":"host planning"}'
    assert frames[1][1] == '{"text":"host partial output"}'
    final = json.loads(frames[2][1])
    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"
    assert final["conversation_id"] == "conv-invalid-final"
    assert final["evidence"] == []


def test_host_agent_query_relay_preserves_scalar_status_and_delta_data(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {"type": "status", "data": "status text"}
        yield {"type": "delta", "data": "delta text"}
        yield {"type": "message", "data": ["future", "message"]}
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": None,
                "conversation_id": None,
                "source": "host-agent",
                "mode": "PARTIAL",
                "reason": "partial",
                "query": "body query",
                "answer": {
                    "mode": "PARTIAL",
                    "summary": "partial",
                    "insights": [],
                    "gap": "missing evidence",
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={"query": "body query"},
            headers={"accept": "text/event-stream"},
        )

    assert response.status_code == 200
    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["status", "delta", "message", "final"]
    assert frames[0][1] == '"status text"'
    assert frames[1][1] == '"delta text"'
    assert frames[2][1] == '["future","message"]'


def test_host_agent_query_relay_stops_after_first_invalid_final(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "invalid-first",
                "conversation_id": "invalid-first-conversation",
                "source": "host-agent",
                "mode": "GROUNDED",
                "reason": "invalid-first-final",
                "query": "must not leak",
                "answer": {
                    "mode": "GROUNDED",
                    "summary": "invalid",
                    "insights": [],
                    "gap": None,
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "later-valid",
                "conversation_id": "later-valid-conversation",
                "source": "host-agent",
                "mode": "PARTIAL",
                "reason": "later-valid",
                "query": "later query",
                "answer": {
                    "mode": "PARTIAL",
                    "summary": "must not replace first final",
                    "insights": [],
                    "gap": "gap",
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={
                "query": "body query",
                "request_id": "body-request",
                "conversation_id": "body-conversation",
            },
            headers={"accept": "text/event-stream"},
        )

    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["final"]
    final = json.loads(frames[0][1])
    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"
    assert final["request_id"] == "invalid-first"
    assert final["conversation_id"] == "invalid-first-conversation"
    assert final["query"] == "body query"


def test_host_agent_query_relay_emits_one_unavailable_final_when_upstream_has_none(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {"type": "status", "data": {"phase": "planning"}}
        yield {"type": "delta", "data": "partial text"}

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={"query": "missing final"},
            headers={"accept": "text/event-stream"},
        )

    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["status", "delta", "final"]
    final = json.loads(frames[-1][1])
    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"


def test_host_agent_query_relay_does_not_emit_second_final_after_exception(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "first-final",
                "conversation_id": None,
                "source": "host-agent",
                "mode": "PARTIAL",
                "reason": "first-final",
                "query": "body query",
                "answer": {
                    "mode": "PARTIAL",
                    "summary": "first final",
                    "insights": [],
                    "gap": "gap",
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }
        raise RuntimeError("AFTER-FINAL-SECRET")

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={"query": "body query"},
            headers={"accept": "text/event-stream"},
        )

    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["final"]
    assert "AFTER-FINAL-SECRET" not in response.text


def test_host_agent_query_relay_maps_upstream_error_to_one_unavailable_final(monkeypatch):
    """An upstream error is terminal and late frames cannot replace it."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {
            "type": "status",
            "data": {"phase": "calling_host_agent", "message": "runtime"},
        }
        yield {
            "type": "error",
            "data": {"code": "RUNTIME_TIMEOUT", "message": "secret runtime output"},
        }
        # A broken upstream may continue producing frames after its terminal error.
        yield {"type": "delta", "data": {"text": "late output must not leak"}}
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "late-final",
                "conversation_id": None,
                "source": "host-agent",
                "mode": "PARTIAL",
                "reason": "late final",
                "query": "late query",
                "answer": {
                    "mode": "PARTIAL",
                    "summary": "late answer must not replace terminal error",
                    "insights": [],
                    "gap": "late",
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={"query": "runtime query"},
            headers={"accept": "text/event-stream"},
        )

    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["status", "final"]
    final = json.loads(frames[-1][1])
    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "RUNTIME_TIMEOUT"
    assert "secret runtime output" not in response.text
    assert "late output" not in response.text


def test_host_agent_query_relay_ignores_status_and_delta_after_valid_final(monkeypatch):
    """A valid final is accepted once; post-terminal progress is never relayed."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "accepted-final",
                "conversation_id": None,
                "source": "host-agent",
                "mode": "PARTIAL",
                "reason": "accepted",
                "query": "body query",
                "answer": {
                    "mode": "PARTIAL",
                    "summary": "accepted answer",
                    "insights": [],
                    "gap": "partial",
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }
        yield {"type": "status", "data": {"phase": "error", "message": "late status"}}
        yield {"type": "delta", "data": {"text": "late delta"}}

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={"query": "body query"},
            headers={"accept": "text/event-stream"},
        )

    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["final"]
    assert json.loads(frames[0][1])["reason"] == "accepted"


def test_host_agent_query_relay_redacts_exception_text(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        raise RuntimeError("QUERY-SECRET prompt/journal content")
        yield  # pragma: no cover

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={"query": "body query"},
            headers={"accept": "text/event-stream"},
        )

    frames = _parse_sse(response.text)
    assert [event for event, _data in frames] == ["final"]
    assert "QUERY-SECRET" not in response.text
    final = json.loads(frames[0][1])
    assert final["reason"] == "host-agent-stream-unavailable"
    assert final["error_type"] == "RuntimeError"


def test_host_agent_invalid_final_preserves_safe_upstream_ids_and_body_query(monkeypatch):
    """Invalid final semantics do not leak, but safe upstream identities survive."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")

    async def fake_stream(_payload):
        yield {
            "type": "final",
            "data": {
                "schema_version": "gui.host_agent.query_response.v1",
                "request_id": "upstream-request-id",
                "conversation_id": "upstream-conversation-id",
                "source": "host-agent",
                "mode": "GROUNDED",
                "reason": "invalid-grounded-without-evidence",
                "query": "upstream query must not leak",
                "answer": {
                    "mode": "GROUNDED",
                    "summary": "invalid",
                    "insights": [],
                    "gap": None,
                    "suggestions": [],
                },
                "evidence": [],
                "tool_trace": [],
            },
        }

    with patch("backend.routers.host_agent.stream_host_agent_query", fake_stream):
        response = client.post(
            "/api/host-agent/query/stream",
            json={
                "query": "body query remains authoritative",
                "request_id": "body-request-id",
                "conversation_id": "body-conversation-id",
            },
            headers={"accept": "text/event-stream"},
        )

    assert response.status_code == 200
    frames = _parse_sse(response.text)
    final = json.loads(frames[-1][1])
    assert final["mode"] == "UNAVAILABLE"
    assert final["reason"] == "host-agent-envelope-invalid"
    assert final["request_id"] == "upstream-request-id"
    assert final["conversation_id"] == "upstream-conversation-id"
    assert final["query"] == "body query remains authoritative"


def test_host_agent_metadata_relay_invalid_final_maps_to_unavailable(monkeypatch):
    """Malformed metadata proposals are never exposed as PROPOSED fields."""
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    invalid_payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "metadata-invalid-1",
        "mode": "PROPOSED",
        "reason": "scalar field shape",
        "fields": {"title": "not-an-object"},
        "warnings": [],
    }

    with patch("backend.routers.host_agent.post_host_agent_metadata", new_callable=AsyncMock) as post_metadata:
        post_metadata.return_value = invalid_payload
        response = client.post(
            "/api/host-agent/metadata/propose",
            json={
                "request_id": "metadata-invalid-1",
                "draft": {"content": "Draft", "date": "2026-06-23"},
                "policy": {"preserve_user_fields": True},
            },
        )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["request_id"] == "metadata-invalid-1"
    assert data["mode"] == "UNAVAILABLE"
    assert data["reason"] == "host-agent-envelope-invalid"
    assert data["fields"] == {}


def test_host_agent_metadata_relay_rejects_unknown_weather_field_without_filtering(monkeypatch):
    monkeypatch.setenv("LIFE_INDEX_HOST_AGENT_URL", "http://host-agent.invalid")
    invalid_payload = {
        "schema_version": "gui.host_agent.metadata_proposal.v1",
        "request_id": "metadata-weather-1",
        "mode": "PROPOSED",
        "reason": "third-party weather fixture",
        "fields": {"weather": {"value": "sunny"}},
        "warnings": [],
        "policy": {"preserve_user_fields": True},
    }

    with patch("backend.routers.host_agent.post_host_agent_metadata", new_callable=AsyncMock) as post_metadata:
        post_metadata.return_value = invalid_payload
        response = client.post(
            "/api/host-agent/metadata/propose",
            json={
                "request_id": "metadata-weather-1",
                "draft": {"content": "Draft", "date": "2026-06-23"},
                "policy": {"preserve_user_fields": True},
            },
        )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["mode"] == "UNAVAILABLE"
    assert data["reason"] == "host-agent-envelope-invalid"
    assert data["fields"] == {}
    assert data["policy"]["preserve_user_fields"] is True
