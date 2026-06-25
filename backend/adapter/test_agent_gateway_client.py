"""Tests for the Agent Gateway client seam, including H1 real gateway client."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from backend.adapter.agent_gateway_client import (
    GatewayClientError,
    LIFE_INDEX_GATEWAY_LAUNCH,
    LIFE_INDEX_GATEWAY_MODE,
    LIFE_INDEX_GATEWAY_URL,
    MockAgentGatewayClient,
    get_gateway_client,
    start_gateway_prewarm_task,
)


# ---------------------------------------------------------------------------
# H0 mock client tests (preserved)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mock_gateway_stream_yields_contract_event_sequence():
    client = MockAgentGatewayClient(warm_on_start=True)

    events = [
        event async for event in client.stream("Where did I go?", scaffold={"intent": "location"})
    ]

    assert [event["type"] for event in events] == [
        "status",
        "scaffold",
        "evidence",
        "delta",
        "delta",
        "final",
    ]
    assert events[3]["data"] == {"text": "You visited "}
    final = events[-1]["data"]
    assert final["schema_version"] == "m35.agent_bridge_query.v0"
    assert final["mode"] == "GROUNDED"
    assert final["answer"]["mode"] == "GROUNDED"
    assert final["evidence"][0]["id"] in final["answer"]["insights"][0]["evidence_refs"]


@pytest.mark.asyncio
async def test_mock_gateway_stream_can_emit_standard_error_event_without_fallback():
    client = MockAgentGatewayClient(error_on_query=True)

    events = [event async for event in client.stream("force an error")]

    assert [event["type"] for event in events] == ["status", "error"]
    assert events[-1]["data"]["code"] == "AGENT_GATEWAY_ERROR"
    assert "fallback" not in events[-1]["data"]["message"].lower()


@pytest.mark.asyncio
async def test_mock_gateway_health_reconnects_through_discover_or_start():
    client = MockAgentGatewayClient(warm_on_start=False)

    cold_health = await client.health()
    assert cold_health["running"] is False
    assert cold_health["lifecycle"]["warm_on_start"] is False
    assert cold_health["lifecycle"]["discover_or_start"] is True
    assert cold_health["lifecycle"]["bound_to_gui_process"] is False

    await client.ensure_running()
    warm_health = await client.health()
    assert warm_health["running"] is True
    assert warm_health["reconnects"] == 1

    client.mark_disconnected()
    await client.ensure_running()
    reconnected_health = await client.health()
    assert reconnected_health["running"] is True
    assert reconnected_health["reconnects"] == 2


# ---------------------------------------------------------------------------
# H1 real gateway client tests
# ---------------------------------------------------------------------------


class _FakeGatewayTransport(httpx.AsyncBaseTransport):
    """Stateful fake transport that mimics a life-index server gateway."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8765",
        healthy_after: int = 0,
        never_healthy: bool = False,
        require_start_for_health: bool = False,
        degraded_health: bool = False,
    ):
        self.base_url = base_url.rstrip("/")
        self.healthy_after = healthy_after
        self.never_healthy = never_healthy
        self.require_start_for_health = require_start_for_health
        self.degraded_health = degraded_health
        self.started = False
        self._health_calls = 0
        self._requests: list[httpx.Request] = []
        self.json_bodies: list[dict[str, object]] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self._requests.append(request)
        url = str(request.url)
        method = request.method

        if url == f"{self.base_url}/healthz" and method == "GET":
            self._health_calls += 1
            healthy_by_call = self._health_calls > self.healthy_after
            started_ok = not self.require_start_for_health or self.started
            if self.degraded_health:
                return httpx.Response(
                    200,
                    json={
                        "status": "ok",
                        "state": "degraded",
                        "degraded": True,
                        "is_alive": False,
                    },
                )
            if self.never_healthy or not (healthy_by_call and started_ok):
                return httpx.Response(503, json={"status": "down"})
            return httpx.Response(200, json={"status": "ok", "gateway": "life-index"})

        if url == f"{self.base_url}/query" and method == "POST":
            body = json.loads(request.content or "{}")
            self.json_bodies.append(body)
            return httpx.Response(
                200,
                json={
                    "success": True,
                    "schema_version": "m35.agent_bridge_query.v0",
                    "command": "agent-bridge query",
                    "source": "host-agent",
                    "query": body.get("query"),
                    "mode": "GROUNDED",
                    "scaffold": body.get("scaffold"),
                    "evidence": [],
                    "answer": {"summary": "fake answer"},
                    "synthesis": "fake answer",
                },
            )

        if url == f"{self.base_url}/query/stream" and method == "POST":
            body = json.loads(request.content or "{}")
            self.json_bodies.append(body)
            events = [
                {"event": "status", "data": json.dumps({"phase": "warming"})},
                {
                    "event": "scaffold",
                    "data": json.dumps({"intent": "location", "query": body.get("query")}),
                },
                {"event": "delta", "data": json.dumps({"text": "fake "})},
                {"event": "delta", "data": json.dumps({"text": "answer"})},
                {
                    "event": "final",
                    "data": json.dumps(
                        {
                            "schema_version": "m35.agent_bridge_query.v0",
                            "query": body.get("query"),
                            "mode": "GROUNDED",
                            "answer": {"summary": "fake answer"},
                        }
                    ),
                },
            ]
            sse_body = "".join(
                f"event: {e['event']}\ndata: {e['data']}\n\n" for e in events
            )
            return httpx.Response(200, text=sse_body, headers={"content-type": "text/event-stream"})

        return httpx.Response(404, text="not found")


def _fake_http_client(
    *,
    healthy_after: int = 0,
    never_healthy: bool = False,
    require_start_for_health: bool = False,
    degraded_health: bool = False,
) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=_FakeGatewayTransport(
            healthy_after=healthy_after,
            never_healthy=never_healthy,
            require_start_for_health=require_start_for_health,
            degraded_health=degraded_health,
        )
    )


def _fake_cli_adapter(transport: _FakeGatewayTransport | None = None) -> AsyncMock:
    cli = AsyncMock()

    async def _start_and_return(*args, **kwargs):
        if transport is not None:
            transport.started = True
        return "started"

    cli.run.side_effect = _start_and_return
    cli.run_json.side_effect = AssertionError("server start must not require JSON output")
    return cli


@pytest.mark.asyncio
async def test_default_mode_returns_mock_client(monkeypatch):
    monkeypatch.delenv(LIFE_INDEX_GATEWAY_MODE, raising=False)
    # Ensure global state is reset for a clean selection.
    with patch(
        "backend.adapter.agent_gateway_client._default_gateway_client", None
    ):
        client = get_gateway_client()

    assert isinstance(client, MockAgentGatewayClient)
    assert (await client.health())["running"] is True


@pytest.mark.asyncio
async def test_real_mode_returns_life_index_server_gateway_client(monkeypatch):
    monkeypatch.setenv(LIFE_INDEX_GATEWAY_MODE, "real")
    with patch(
        "backend.adapter.agent_gateway_client._default_gateway_client", None
    ):
        client = get_gateway_client()

    assert type(client).__name__ == "LifeIndexServerGatewayClient"
    assert client._start_timeout == 90.0


@pytest.mark.asyncio
async def test_real_mode_url_env_is_honored(monkeypatch):
    monkeypatch.setenv(LIFE_INDEX_GATEWAY_MODE, "real")
    monkeypatch.setenv(LIFE_INDEX_GATEWAY_URL, "http://127.0.0.1:9999")
    with patch(
        "backend.adapter.agent_gateway_client._default_gateway_client", None
    ):
        client = get_gateway_client()

    assert type(client).__name__ == "LifeIndexServerGatewayClient"
    assert client._gateway_url == "http://127.0.0.1:9999"


@pytest.mark.asyncio
async def test_real_mode_launch_env_is_honored(monkeypatch):
    monkeypatch.setenv(LIFE_INDEX_GATEWAY_MODE, "real")
    monkeypatch.setenv(LIFE_INDEX_GATEWAY_LAUNCH, "runtime-launch --server start")
    with patch(
        "backend.adapter.agent_gateway_client._default_gateway_client", None
    ):
        client = get_gateway_client()

    assert type(client).__name__ == "LifeIndexServerGatewayClient"
    assert client._launch_command == "runtime-launch --server start"


@pytest.mark.asyncio
async def test_health_reports_running_true_on_fake_healthz_success():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=_fake_http_client(healthy_after=0),
    )
    result = await client.health()

    assert result["running"] is True
    assert result["gateway_status"] == "ok"


@pytest.mark.asyncio
async def test_health_reports_running_false_on_fake_failure():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=_fake_http_client(never_healthy=True),
    )
    result = await client.health()

    assert result["running"] is False
    assert result["gateway_status"] == "down"


@pytest.mark.asyncio
async def test_health_reports_running_false_when_gateway_is_degraded():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=_fake_http_client(degraded_health=True),
    )

    result = await client.health()

    assert result["running"] is False
    assert result["gateway_status"] == "degraded"
    assert result["degraded"] is True


@pytest.mark.asyncio
async def test_ensure_running_reuses_healthy_gateway_without_cli_start():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport(healthy_after=0)
    cli = _fake_cli_adapter(transport=transport)
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=httpx.AsyncClient(transport=transport),
    )

    await client.ensure_running()

    assert transport._health_calls >= 1
    cli.run.assert_not_awaited()


@pytest.mark.asyncio
async def test_ensure_running_reuses_healthy_gateway_without_launch_command():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport(healthy_after=0)
    cli = _fake_cli_adapter(transport=transport)
    launch_calls: list[tuple[str, float]] = []

    async def _launch(command: str, timeout: float) -> str:
        launch_calls.append((command, timeout))
        transport.started = True
        return "started"

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=httpx.AsyncClient(transport=transport),
        launch_command="runtime-launch --server start",
        launch_runner=_launch,
    )

    await client.ensure_running()

    assert transport._health_calls >= 1
    assert launch_calls == []
    cli.run.assert_not_awaited()


@pytest.mark.asyncio
async def test_ensure_running_runs_configured_launch_then_polls_until_healthy():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport(
        healthy_after=2,
        require_start_for_health=True,
    )
    cli = _fake_cli_adapter(transport=transport)
    launch_calls: list[tuple[str, float]] = []

    async def _launch(command: str, timeout: float) -> str:
        launch_calls.append((command, timeout))
        transport.started = True
        return "started"

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=httpx.AsyncClient(transport=transport),
        launch_command="runtime-launch --server start",
        launch_runner=_launch,
        health_poll_interval=0.01,
    )

    await client.ensure_running()

    assert launch_calls == [
        ("runtime-launch --server start", pytest.approx(90.0, rel=0.1))
    ]
    cli.run.assert_not_awaited()
    assert transport._health_calls >= 2


@pytest.mark.asyncio
async def test_ensure_running_launch_failure_does_not_fallback_to_cli():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    cli = _fake_cli_adapter()
    launch_calls: list[tuple[str, float]] = []

    async def _launch(command: str, timeout: float) -> str:
        launch_calls.append((command, timeout))
        raise RuntimeError("launch failed")

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=_fake_http_client(never_healthy=True),
        launch_command="runtime-launch --server start",
        launch_runner=_launch,
        start_timeout=0.05,
        health_poll_interval=0.01,
    )

    with pytest.raises(GatewayClientError, match="Gateway launch command failed"):
        await client.ensure_running()

    assert launch_calls == [
        ("runtime-launch --server start", pytest.approx(90.0, rel=0.1))
    ]
    cli.run.assert_not_awaited()


@pytest.mark.asyncio
async def test_ensure_running_runs_cli_server_start_then_polls_until_healthy():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport(healthy_after=2)
    cli = _fake_cli_adapter(transport=transport)
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=httpx.AsyncClient(transport=transport),
        health_poll_interval=0.01,
    )

    await client.ensure_running()

    cli.run.assert_awaited_once_with(["server", "start"], timeout=pytest.approx(90.0, rel=0.1))
    assert transport._health_calls >= 2


@pytest.mark.asyncio
async def test_ensure_running_times_out_honestly_when_gateway_never_healthy():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    cli = _fake_cli_adapter()
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=_fake_http_client(never_healthy=True),
        start_timeout=0.05,
        health_poll_interval=0.01,
    )

    with pytest.raises(TimeoutError):
        await client.ensure_running()

    cli.run.assert_awaited_once_with(["server", "start"], timeout=pytest.approx(90.0, rel=0.1))


@pytest.mark.asyncio
async def test_query_posts_trimmed_query_and_scaffold_and_returns_rich_envelope():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=_fake_http_client(),
    )

    result = await client.query(
        "  where did I go?  ",
        scaffold={"intent": "location", "queries": ["where did I go"]},
    )

    assert result["schema_version"] == "m35.agent_bridge_query.v0"
    assert result["query"] == "where did I go?"
    assert result["scaffold"]["intent"] == "location"


@pytest.mark.asyncio
async def test_query_defaults_missing_scaffold_to_empty_object_for_gateway_contract():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport()
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=httpx.AsyncClient(transport=transport),
    )

    await client.query("where?")

    assert transport.json_bodies[-1]["scaffold"] == {}


@pytest.mark.asyncio
async def test_query_includes_conversation_id_when_provided():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport()
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=httpx.AsyncClient(transport=transport),
    )

    await client.query("where?", conversation_id="conv-abc")

    assert transport.json_bodies[-1]["conversation_id"] == "conv-abc"


@pytest.mark.asyncio
async def test_stream_parses_fake_sse_in_order_and_keeps_delta_clean():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=_fake_http_client(),
    )

    events = [event async for event in client.stream("  where?  ", scaffold={"intent": "location"})]

    assert [event["type"] for event in events] == [
        "status",
        "scaffold",
        "delta",
        "delta",
        "final",
    ]
    deltas = [event for event in events if event["type"] == "delta"]
    assert deltas[0]["data"] == {"text": "fake "}
    assert deltas[1]["data"] == {"text": "answer"}


@pytest.mark.asyncio
async def test_stream_defaults_missing_scaffold_to_empty_object_for_gateway_contract():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport()
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=httpx.AsyncClient(transport=transport),
    )

    events = [event async for event in client.stream("where?")]

    assert [event["type"] for event in events][-1] == "final"
    assert transport.json_bodies[-1]["scaffold"] == {}


@pytest.mark.asyncio
async def test_stream_includes_conversation_id_when_provided():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport()
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=httpx.AsyncClient(transport=transport),
    )

    events = [event async for event in client.stream("where?", conversation_id="conv-abc")]

    assert [event["type"] for event in events][-1] == "final"
    assert transport.json_bodies[-1]["conversation_id"] == "conv-abc"


@pytest.mark.asyncio
async def test_query_reconnects_after_first_request_fails():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    # Gateway is down until the CLI starts it; the first /query fails, the client
    # reconnects, and the retry succeeds.
    transport = _FakeGatewayTransport(
        healthy_after=0, require_start_for_health=True
    )
    call_count = 0

    class _FailingThenHealthyTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            if request.url.path == "/query" and call_count == 1:
                raise httpx.ConnectError("connection refused", request=request)
            return await transport.handle_async_request(request)

    cli = _fake_cli_adapter(transport=transport)
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=httpx.AsyncClient(transport=_FailingThenHealthyTransport()),
        health_poll_interval=0.01,
    )

    result = await client.query("where?")

    assert result["schema_version"] == "m35.agent_bridge_query.v0"
    cli.run.assert_awaited_once_with(["server", "start"], timeout=pytest.approx(90.0, rel=0.1))


@pytest.mark.asyncio
async def test_stream_reconnects_after_first_request_fails():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    transport = _FakeGatewayTransport(
        healthy_after=0, require_start_for_health=True
    )
    call_count = 0

    class _FailingThenHealthyStreamTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            if request.url.path == "/query/stream" and call_count == 1:
                raise httpx.ConnectError("connection refused", request=request)
            return await transport.handle_async_request(request)

    cli = _fake_cli_adapter(transport=transport)
    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        cli_adapter=cli,
        http_client=httpx.AsyncClient(transport=_FailingThenHealthyStreamTransport()),
        health_poll_interval=0.01,
    )

    events = [event async for event in client.stream("where?")]

    assert [event["type"] for event in events] == [
        "status",
        "scaffold",
        "delta",
        "delta",
        "final",
    ]
    cli.run.assert_awaited_once_with(["server", "start"], timeout=pytest.approx(90.0, rel=0.1))


@pytest.mark.asyncio
async def test_stream_uses_httpx_streaming_context_instead_of_buffered_post():
    from backend.adapter.agent_gateway_client import LifeIndexServerGatewayClient

    class _FakeStreamResponse:
        def raise_for_status(self) -> None:
            return None

        async def aiter_lines(self) -> AsyncIterator[str]:
            lines = [
                "event: status",
                'data: {"phase":"warming"}',
                "",
                "event: delta",
                'data: {"text":"live"}',
                "",
                "event: final",
                'data: {"schema_version":"m35.agent_bridge_query.v0","command":"agent-bridge query","query":"where?","mode":"GROUNDED","scaffold":{},"evidence":[],"answer":{"mode":"GROUNDED","summary":"live","insights":[],"related_findings":[],"gap":null,"explanation":null,"what_was_found":[],"suggestions":[]},"synthesis":"live"}',
                "",
            ]
            for line in lines:
                yield line

    class _FakeStreamContext:
        async def __aenter__(self) -> _FakeStreamResponse:
            return _FakeStreamResponse()

        async def __aexit__(self, *args: object) -> None:
            return None

    class _StreamingOnlyClient:
        async def get(self, *_args: object, **_kwargs: object) -> httpx.Response:
            return httpx.Response(200, json={"status": "ok"})

        async def post(self, *_args: object, **_kwargs: object) -> httpx.Response:
            raise AssertionError("stream() must use httpx streaming context, not buffered post()")

        def stream(self, *_args: object, **_kwargs: object) -> _FakeStreamContext:
            return _FakeStreamContext()

    client = LifeIndexServerGatewayClient(
        gateway_url="http://127.0.0.1:8765",
        http_client=_StreamingOnlyClient(),
    )

    events = [event async for event in client.stream("where?")]

    assert [event["type"] for event in events] == ["status", "delta", "final"]
    assert events[1]["data"] == {"text": "live"}


@pytest.mark.asyncio
async def test_prewarm_task_creates_asyncio_task_only_in_real_mode(monkeypatch):
    monkeypatch.setenv(LIFE_INDEX_GATEWAY_MODE, "real")
    fake_client = AsyncMock()
    fake_client.ensure_running = AsyncMock()

    with patch("backend.adapter.agent_gateway_client.get_gateway_client", return_value=fake_client):
        task = start_gateway_prewarm_task()

    assert isinstance(task, asyncio.Task)
    await task
    fake_client.ensure_running.assert_awaited_once()


@pytest.mark.asyncio
async def test_launch_env_does_not_create_prewarm_or_real_client_in_default_mock_mode(monkeypatch):
    monkeypatch.delenv(LIFE_INDEX_GATEWAY_MODE, raising=False)
    monkeypatch.setenv(LIFE_INDEX_GATEWAY_LAUNCH, "runtime-launch --server start")

    with patch(
        "backend.adapter.agent_gateway_client._default_gateway_client", None
    ):
        task = start_gateway_prewarm_task()
        client = get_gateway_client()

    assert task is None
    assert isinstance(client, MockAgentGatewayClient)
