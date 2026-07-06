"""Tests for GUI/backend version compatibility surface."""

from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import health

client = TestClient(app)


def test_version_endpoint_exposes_single_compatibility_source():
    mock_adapter = MagicMock()
    mock_adapter.handshake = AsyncMock(
        return_value={
            "status": "ok",
            "cli_available": True,
            "compatible": True,
            "package_version": "1.3.7",
            "repo_version": "cli-main-abc123",
            "minimum_supported_version": "1.2.1",
            "cli_minimum_version": "1.2.1",
            "health": {"status": "healthy"},
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/version")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["gui_version"]
    assert payload["data"]["cli_minimum_version"] == "1.3.7"
    assert payload["data"]["repo_version"] == "cli-main-abc123"
    assert payload["data"]["compatible"] is True


def test_health_endpoint_carries_version_aliases_for_agents():
    mock_adapter = MagicMock()
    mock_adapter.handshake = AsyncMock(
        return_value={
            "status": "degraded",
            "cli_available": False,
            "compatible": False,
            "package_version": None,
            "repo_version": None,
            "minimum_supported_version": "1.2.1",
            "cli_minimum_version": "1.2.1",
            "health": None,
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["gui_version"]
    assert payload["data"]["cli_minimum_version"] == "1.3.7"
    assert payload["data"]["minimum_supported_version"] == "1.3.7"
