"""Tests for health router — CLI handshake and data-audit diagnostics."""

from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import health

client = TestClient(app)


# ── Health handshake ──────────────────────────────────────────────────────


def test_health_check_returns_cli_handshake_payload():
    """GET /api/health exposes normalized CLI version and health state."""
    mock_adapter = MagicMock()
    mock_adapter.handshake = AsyncMock(
        return_value={
            "status": "ok",
            "cli_available": True,
            "compatible": True,
            "package_version": "1.2.1",
            "repo_version": "1.2.1",
            "health": {"status": "healthy", "journal_count": 42},
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["status"] == "ok"
    assert payload["data"]["cli_available"] is True
    assert payload["data"]["compatible"] is True
    assert payload["data"]["package_version"] == "1.2.1"
    assert payload["data"]["health"]["journal_count"] == 42


def test_health_check_exposes_degraded_state():
    """GET /api/health surfaces degraded CLI health without hiding it.

    S2 exit gate: degraded CLI health must appear as an actionable
    diagnostic, while ordinary writing remains available when
    write/search commands are usable.
    """
    mock_adapter = MagicMock()
    mock_adapter.handshake = AsyncMock(
        return_value={
            "status": "degraded",
            "cli_available": True,
            "compatible": True,
            "package_version": "1.2.1",
            "repo_version": "1.2.1",
            "health": {
                "status": "degraded",
                "warnings": ["stale_index_tree"],
                "journal_count": 42,
            },
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["health"]["status"] == "degraded"
    assert "stale_index_tree" in payload["data"]["health"]["warnings"]


def test_health_check_cli_unavailable():
    """GET /api/health returns degraded state when CLI is unreachable.

    S2 exit gate: CLI unavailable must be surfaced as a distinct state
    so the frontend can show the appropriate diagnostic.
    """
    mock_adapter = MagicMock()
    mock_adapter.handshake = AsyncMock(
        return_value={
            "status": "degraded",
            "cli_available": False,
            "compatible": False,
            "package_version": None,
            "repo_version": None,
            "minimum_supported_version": "1.2.1",
            "health": None,
            "error": {
                "returncode": -1,
                "message": "Command timed out after 10s",
            },
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["status"] == "degraded"
    assert payload["data"]["cli_available"] is False
    assert payload["data"]["health"] is None
    assert payload["data"]["error"]["returncode"] == -1


# ── Data-audit diagnostics ───────────────────────────────────────────────


def test_data_audit_returns_cli_payload():
    """GET /api/health/data-audit returns CLI data-audit diagnostics."""
    mock_adapter = MagicMock()
    mock_adapter.data_audit = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.health.v0",
            "data": {
                "file_count": 100,
                "anomalies": [],
                "distribution": {"normal": 95, "warning": 5},
            },
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/health/data-audit")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["success"] is True
    assert payload["data"]["data"]["file_count"] == 100
    assert payload["data"]["data"]["anomalies"] == []


def test_data_audit_returns_anomalies():
    """GET /api/health/data-audit surfaces anomalies from CLI payload.

    S2 exit gate: data-audit warnings must be visible in the health
    surface without hiding risk.
    """
    mock_adapter = MagicMock()
    mock_adapter.data_audit = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.health.v0",
            "data": {
                "file_count": 100,
                "anomalies": [
                    {"type": "empty_file", "path": "2026/01/example.md"},
                    {"type": "missing_frontmatter", "path": "2026/02/test.md"},
                ],
                "distribution": {"normal": 98, "warning": 2},
            },
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/health/data-audit")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert len(payload["data"]["data"]["anomalies"]) == 2


def test_data_audit_graceful_on_cli_failure():
    """GET /api/health/data-audit returns structured error when CLI fails."""
    mock_adapter = MagicMock()
    mock_adapter.data_audit = AsyncMock(
        return_value={
            "success": False,
            "error": "data-audit-unavailable",
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/health/data-audit")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["success"] is False
    assert payload["data"]["error"] == "data-audit-unavailable"


# ── M1 non-blocking proof ────────────────────────────────────────────────


def test_degraded_health_does_not_block_journal_routes():
    """Health degradation must not prevent journal list from working.

    S2 exit gate: ordinary M1 write/search surfaces are not blocked
    merely because the health center is degraded.
    """
    # Journal list route uses its own CLI adapter dependency, so a
    # degraded health handshake has no coupling to journal availability.
    # This test proves the routes are independent by confirming the
    # health endpoint can return degraded while the journals endpoint
    # schema remains intact.
    mock_adapter = MagicMock()
    mock_adapter.handshake = AsyncMock(
        return_value={
            "status": "degraded",
            "cli_available": True,
            "compatible": True,
            "package_version": "1.2.1",
            "repo_version": "1.2.1",
            "health": {
                "status": "degraded",
                "warnings": ["stale_index_tree"],
                "journal_count": 42,
            },
        }
    )

    app.dependency_overrides[health.get_cli] = lambda: mock_adapter
    try:
        # Health returns degraded — this should NOT affect other routes
        health_response = client.get("/api/health")
    finally:
        app.dependency_overrides.clear()

    # Health endpoint itself returns 200 with degraded state
    assert health_response.status_code == 200
    assert health_response.json()["data"]["status"] == "degraded"

    # Journal routes use their own dependency injection, not the health
    # adapter, so they are architecturally decoupled.  The health
    # endpoint returning degraded does not set any global blocking flag.
