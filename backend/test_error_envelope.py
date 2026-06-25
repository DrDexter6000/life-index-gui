"""Global exception handler — root cause B regression guard.

An unhandled error must surface as the standard structured envelope with a
real error code (so the GUI shows an honest message instead of a network
failure) and must be logged with its traceback (so the cause is never lost
again, as it was during manual acceptance).
"""

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.main import unhandled_exception_handler


def _app_with_failing_route() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(Exception, unhandled_exception_handler)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("kaboom")

    return app


def test_unhandled_exception_returns_structured_envelope(caplog):
    """An unexpected error returns ok=false + INTERNAL_ERROR, not a bare 500."""
    client = TestClient(_app_with_failing_route(), raise_server_exceptions=False)

    with caplog.at_level(logging.ERROR):
        response = client.get("/boom")

    assert response.status_code == 500
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "INTERNAL_ERROR"


def test_unhandled_exception_logs_traceback(caplog):
    """The real cause must be preserved in logs, not swallowed."""
    client = TestClient(_app_with_failing_route(), raise_server_exceptions=False)

    with caplog.at_level(logging.ERROR):
        client.get("/boom")

    assert "kaboom" in caplog.text
