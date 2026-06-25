"""Agent Gateway client seam — warm/spawn/reconnect abstraction for host agents.

The GUI never calls the host agent directly.  The backend owns the gateway
lifecycle and forwards contract events to the frontend over SSE.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol

import httpx

from backend.adapter.cli_adapter import CLIAdapter

logger = logging.getLogger(__name__)

LIFE_INDEX_GATEWAY_MODE = "LIFE_INDEX_GATEWAY_MODE"
LIFE_INDEX_GATEWAY_URL = "LIFE_INDEX_GATEWAY_URL"
LIFE_INDEX_GATEWAY_LAUNCH = "LIFE_INDEX_GATEWAY_LAUNCH"
DEFAULT_GATEWAY_URL = "http://127.0.0.1:8765"

GatewayLaunchRunner = Callable[[str, float], Awaitable[str]]


class AgentGatewayClient(Protocol):
    """Gateway lifecycle seam H1 can implement with a real life-index server."""

    async def ensure_running(self) -> None:
        """Discover or start the gateway without binding it to the GUI process."""

    async def health(self) -> dict[str, Any]:
        """Return a quick nonblocking health snapshot."""

    async def query(
        self,
        query: str,
        scaffold: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Return a complete rich Agent Bridge envelope."""

    def stream(
        self,
        query: str,
        scaffold: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield contract SSE event dictionaries."""


class MockAgentGatewayClient:
    """Deterministic stand-in for the Agent Gateway lifecycle client.

    Used in the H0 warm-gateway scaffold so the GUI stream route and tests
    can exercise the full event contract without a real host-agent process.
    """

    def __init__(self, warm_on_start: bool = False, error_on_query: bool = False):
        self._warm_on_start = warm_on_start
        self._error_on_query = error_on_query
        self._running = warm_on_start
        self._reconnects = 0

    async def health(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "reconnects": self._reconnects,
            "lifecycle": {
                "warm_on_start": self._warm_on_start,
                "discover_or_start": True,
                "bound_to_gui_process": False,
            },
        }

    async def ensure_running(self) -> None:
        if not self._running:
            self._running = True
            self._reconnects += 1

    def mark_disconnected(self) -> None:
        self._running = False

    async def stream(
        self,
        query: str,
        scaffold: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield the contract event sequence for the query stream."""
        _ = conversation_id
        await self.ensure_running()

        yield {
            "type": "status",
            "data": {"phase": "warming", "message": "Warming gateway"},
        }

        if self._error_on_query:
            yield {
                "type": "error",
                "data": {
                    "code": "AGENT_GATEWAY_ERROR",
                    "message": "mock gateway query failed",
                },
            }
            return

        effective_scaffold = scaffold or {
            "intent": "location",
            "queries": ["where"],
            "filters": {},
        }
        yield {"type": "scaffold", "data": effective_scaffold}

        evidence = [
            {
                "id": "2026/06/e1",
                "rel_path": "Journals/2026/06/e1.md",
                "title": "Park",
                "date": "2026-06-01",
            }
        ]
        yield {"type": "evidence", "data": evidence}

        yield {"type": "delta", "data": {"text": "You visited "}}
        yield {"type": "delta", "data": {"text": "the park."}}

        yield {
            "type": "final",
            "data": {
                "schema_version": "m35.agent_bridge_query.v0",
                "command": "agent-bridge query",
                "source": "host-agent",
                "query": query,
                "mode": "GROUNDED",
                "scaffold": effective_scaffold,
                "evidence": evidence,
                "answer": {
                    "mode": "GROUNDED",
                    "summary": "You visited the park.",
                    "insights": [
                        {
                            "theme": "location",
                            "interpretation": "Park visit",
                            "evidence_refs": ["2026/06/e1"],
                        }
                    ],
                    "related_findings": [],
                    "gap": None,
                    "explanation": None,
                    "what_was_found": [],
                    "suggestions": [],
                },
                "synthesis": "You visited the park.",
            },
        }

    async def query(
        self,
        query: str,
        scaffold: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Collect the stream and return the final rich envelope."""
        final_payload: dict[str, Any] | None = None
        async for event in self.stream(
            query,
            scaffold=scaffold,
            conversation_id=conversation_id,
        ):
            if event["type"] == "error":
                raise RuntimeError(event["data"].get("message", "Agent gateway error"))
            if event["type"] == "final":
                final_payload = event["data"]
        if final_payload is None:
            raise RuntimeError("Agent gateway stream ended without a final event.")
        return final_payload


class GatewayClientError(Exception):
    """Honest gateway error surfaced to the router for standard error mapping."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        self.details = details or {}
        super().__init__(message)


class LifeIndexServerGatewayClient:
    """Real gateway client backed by a warm ``life-index server`` process.

    Implements the same ``AgentGatewayClient`` seam as the H0 mock.  The
    backend-mediated design intentionally never falls back to a direct LLM or
    host-agent call: if the gateway cannot be reached or started, the client
    raises ``GatewayClientError`` so the router can emit a standard error
    envelope.
    """

    def __init__(
        self,
        gateway_url: str = DEFAULT_GATEWAY_URL,
        cli_adapter: CLIAdapter | None = None,
        http_client: Any | None = None,
        health_timeout: float = 2.0,
        query_timeout: float = 90.0,
        start_timeout: float = 90.0,
        start_command_timeout: float = 90.0,
        health_poll_interval: float = 0.5,
        launch_command: str | None = None,
        launch_runner: GatewayLaunchRunner | None = None,
    ):
        self._gateway_url = gateway_url.rstrip("/")
        self._cli = cli_adapter or CLIAdapter()
        self._http = http_client or httpx.AsyncClient()
        self._health_timeout = health_timeout
        self._query_timeout = query_timeout
        self._start_timeout = start_timeout
        self._start_command_timeout = start_command_timeout
        self._health_poll_interval = health_poll_interval
        self._launch_command = launch_command.strip() if launch_command else None
        self._launch_runner = launch_runner or self._run_shell_launch_command
        self._ensure_lock = asyncio.Lock()

    def _http_client(self) -> Any:
        return self._http

    async def health(self) -> dict[str, Any]:
        """Short nonblocking probe of the gateway ``/healthz`` endpoint."""
        client = self._http_client()
        try:
            response = await client.get(
                f"{self._gateway_url}/healthz",
                timeout=self._health_timeout,
            )
            body: dict[str, Any] = {}
            try:
                body = response.json()
            except Exception:
                pass
            gateway_status = str(body.get("state") or body.get("status") or "").lower()
            running = (
                response.status_code == 200
                and gateway_status != "degraded"
                and body.get("degraded") is not True
                and body.get("is_alive") is not False
            )
            degraded = body.get("degraded") is True or gateway_status == "degraded"
            return {
                "running": running,
                "gateway_status": gateway_status or None,
                "degraded": degraded,
                "gateway_url": self._gateway_url,
            }
        except Exception as exc:  # noqa: BLE001
            return {
                "running": False,
                "gateway_url": self._gateway_url,
                "error": f"{type(exc).__name__}: {exc}",
            }

    async def ensure_running(self) -> None:
        """Reuse a healthy gateway or start one via the CLI and poll until warm."""
        health = await self.health()
        if health.get("running"):
            logger.info("Gateway already healthy at %s", self._gateway_url)
            return

        async with self._ensure_lock:
            health = await self.health()
            if health.get("running"):
                logger.info("Gateway is warm at %s", self._gateway_url)
                return

            await self._launch_gateway()

            deadline = asyncio.get_running_loop().time() + self._start_timeout
            while True:
                health = await self.health()
                if health.get("running"):
                    logger.info("Gateway is warm at %s", self._gateway_url)
                    return
                if asyncio.get_running_loop().time() >= deadline:
                    raise TimeoutError(
                        f"Gateway at {self._gateway_url} did not become healthy within "
                        f"{self._start_timeout}s"
                    )
                await asyncio.sleep(self._health_poll_interval)

    async def _launch_gateway(self) -> None:
        """Start the gateway using configured deployment command or CLI fallback."""
        if self._launch_command:
            logger.info(
                "Starting gateway via configured launch command at %s",
                self._gateway_url,
            )
            try:
                await self._launch_runner(
                    self._launch_command,
                    self._start_command_timeout,
                )
            except GatewayClientError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise GatewayClientError(
                    f"Gateway launch command failed: {exc}"
                ) from exc
            return

        logger.info("Starting gateway via CLI at %s", self._gateway_url)
        await self._cli.run(
            ["server", "start"],
            timeout=self._start_command_timeout,
        )

    async def _run_shell_launch_command(self, command: str, timeout: float) -> str:
        """Run a trusted local deployment launch command.

        The command is intentionally a shell string because cross-runtime
        launchers often require quoting that cannot be represented portably as
        a fixed argv list by the GUI.
        """

        def _run() -> str:
            try:
                completed = subprocess.run(
                    command,
                    shell=True,
                    capture_output=True,
                    env=os.environ.copy(),
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired as exc:
                raise GatewayClientError(
                    f"Gateway launch command timed out after {timeout}s"
                ) from exc

            stdout = completed.stdout.decode("utf-8", errors="replace")
            stderr = completed.stderr.decode("utf-8", errors="replace")
            if completed.returncode != 0:
                raise GatewayClientError(
                    f"Gateway launch command failed with exit code {completed.returncode}",
                    details={
                        "stdout": stdout[-1000:],
                        "stderr": stderr[-1000:],
                    },
                )
            return stdout

        return await asyncio.to_thread(_run)

    async def _post_with_retry(
        self,
        path: str,
        payload: dict[str, Any],
    ) -> httpx.Response:
        """POST to the gateway, attempting one reconnect cycle on failure."""
        client = self._http_client()
        url = f"{self._gateway_url}{path}"

        try:
            response = await client.post(url, json=payload, timeout=self._query_timeout)
            response.raise_for_status()
            return response
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            logger.warning("Gateway request failed (%s), attempting reconnect: %s", type(exc).__name__, exc)
            await self.ensure_running()

        response = await client.post(url, json=payload, timeout=self._query_timeout)
        response.raise_for_status()
        return response

    async def query(
        self,
        query: str,
        scaffold: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """POST ``/query`` and return the rich ``m35.agent_bridge_query.v0`` envelope."""
        try:
            response = await self._post_with_retry(
                "/query",
                self._query_payload(query, scaffold, conversation_id),
            )
            return response.json()
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            raise GatewayClientError(f"Gateway query failed: {exc}") from exc

    async def stream(
        self,
        query: str,
        scaffold: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """POST ``/query/stream`` and yield contract SSE event dictionaries."""
        payload = self._query_payload(query, scaffold, conversation_id)
        try:
            async for event in self._stream_once(payload):
                yield event
            return
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            logger.warning("Gateway stream failed (%s), attempting reconnect: %s", type(exc).__name__, exc)
            await self.ensure_running()

        try:
            async for event in self._stream_once(payload):
                yield event
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            raise GatewayClientError(f"Gateway stream failed: {exc}") from exc

    def _query_payload(
        self,
        query: str,
        scaffold: dict[str, Any] | None,
        conversation_id: str | None,
    ) -> dict[str, Any]:
        payload = {"query": query.strip(), "scaffold": scaffold or {}}
        if conversation_id:
            payload["conversation_id"] = conversation_id
        return payload

    async def _stream_once(self, payload: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        """Open one streaming POST request and yield parsed contract events."""
        client = self._http_client()
        url = f"{self._gateway_url}/query/stream"
        async with client.stream(
            "POST",
            url,
            json=payload,
            headers={"accept": "text/event-stream"},
            timeout=self._query_timeout,
        ) as response:
            response.raise_for_status()
            async for event in self._parse_sse_lines(response.aiter_lines()):
                yield event

    async def _parse_sse_lines(
        self, lines: AsyncIterator[str]
    ) -> AsyncIterator[dict[str, Any]]:
        """Parse SSE lines into contract event dictionaries as they arrive."""
        current_event: str | None = None
        current_data: list[str] = []

        def flush_event() -> dict[str, Any] | None:
            if current_event is None or not current_data:
                return None
            try:
                data = json.loads("\n".join(current_data))
            except json.JSONDecodeError:
                data = {"text": "\n".join(current_data)}
            return {"type": current_event, "data": data}

        async for line in lines:
            if line.startswith("event: "):
                flushed = flush_event()
                if flushed is not None:
                    yield flushed
                current_event = line[len("event: "):]
                current_data = []
            elif line.startswith("data: "):
                current_data.append(line[len("data: "):])
            elif line == "":
                flushed = flush_event()
                if flushed is not None:
                    yield flushed
                current_event = None
                current_data = []

        flushed = flush_event()
        if flushed is not None:
            yield flushed


# Module-level default client so the router has something to call when no
# override is injected (e.g. in tests).  In production this will be replaced
# by a process-aware client that discovers or starts the configured gateway.
_default_gateway_client: AgentGatewayClient | None = None


def get_gateway_client() -> AgentGatewayClient:
    """Return the current gateway client, lazily creating a warm mock default.

    Selection is controlled by ``LIFE_INDEX_GATEWAY_MODE``:

    - ``real``  -> ``LifeIndexServerGatewayClient`` (backed by ``life-index server``).
    - unset or any other value -> ``MockAgentGatewayClient(warm_on_start=True)``.

    The gateway URL defaults to ``http://127.0.0.1:8765`` and can be overridden
    with ``LIFE_INDEX_GATEWAY_URL``.
    """
    global _default_gateway_client
    if _default_gateway_client is None:
        mode = os.environ.get(LIFE_INDEX_GATEWAY_MODE, "mock").lower()
        if mode == "real":
            gateway_url = os.environ.get(LIFE_INDEX_GATEWAY_URL, DEFAULT_GATEWAY_URL)
            launch_command = os.environ.get(LIFE_INDEX_GATEWAY_LAUNCH)
            _default_gateway_client = LifeIndexServerGatewayClient(
                gateway_url=gateway_url,
                launch_command=launch_command,
            )
        else:
            _default_gateway_client = MockAgentGatewayClient(warm_on_start=True)
    return _default_gateway_client


def start_gateway_prewarm_task() -> asyncio.Task | None:
    """Schedule a nonblocking background prewarm when real gateway mode is active.

    The returned task must not be awaited on startup; callers should let it run
    in the background so that backend boot is not blocked by a cold gateway.
    """
    mode = os.environ.get(LIFE_INDEX_GATEWAY_MODE, "mock").lower()
    if mode != "real":
        return None

    client = get_gateway_client()

    async def _prewarm() -> None:
        try:
            await client.ensure_running()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Gateway prewarm failed (non-fatal): %s", exc)

    return asyncio.create_task(_prewarm())
