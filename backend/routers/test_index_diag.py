"""Tests for read-only index diagnostics router.

S3 exit gate:
- Index diagnostics are rendered from CLI-mediated verify --json,
  index --check --json, or index --cache-dry-run payloads.
- Boundary tests (test_l1_boundary.py) prove no direct SQLite/index
  import, directory scan, file read, or filesystem existence probe
  is used in production code.
"""

from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import index_diag

client = TestClient(app)


# ── Index check ────────────────────────────────────────────────────────────


def test_index_check_returns_cli_payload():
    """GET /api/index/check returns CLI index --check --json diagnostics.

    S3 exit gate: index diagnostics rendered from CLI-mediated payloads.
    """
    mock_adapter = MagicMock()
    mock_adapter.index_check = AsyncMock(
        return_value={
            "healthy": True,
            "fts_count": 12,
            "vector_count": 10,
            "file_count": 14,
            "manifest": {"exists": True},
            "freshness": {"stale": False},
            "issues": [],
        }
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/check")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["healthy"] is True
    assert payload["data"]["fts_count"] == 12
    assert payload["data"]["vector_count"] == 10
    assert payload["data"]["issues"] == []


def test_index_check_surfaces_unhealthy_state():
    """GET /api/index/check surfaces unhealthy index from CLI payload.

    CLI may exit non-zero when unhealthy — adapter treats it as
    diagnostic payload, not fatal error.
    """
    mock_adapter = MagicMock()
    mock_adapter.index_check = AsyncMock(
        return_value={
            "healthy": False,
            "fts_count": 12,
            "vector_count": 10,
            "file_count": 14,
            "issues": ["manifest missing", "vector index stale"],
        }
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/check")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["healthy"] is False
    assert len(payload["data"]["issues"]) == 2
    assert "manifest missing" in payload["data"]["issues"]


def test_index_check_graceful_on_cli_failure():
    """GET /api/index/check returns structured error when CLI fails."""
    mock_adapter = MagicMock()
    mock_adapter.index_check = AsyncMock(
        return_value={"healthy": False, "error": "index-check-unavailable"}
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/check")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["healthy"] is False
    assert payload["data"]["error"] == "index-check-unavailable"


# ── Verify integrity ───────────────────────────────────────────────────────


def test_index_verify_returns_cli_payload():
    """GET /api/index/verify returns CLI verify --json integrity diagnostics.

    S3 exit gate: verify diagnostics rendered from CLI-mediated payloads.
    """
    mock_adapter = MagicMock()
    mock_adapter.verify = AsyncMock(
        return_value={
            "success": True,
            "total_journals": 14,
            "checks": [{"name": "journal_integrity", "status": "ok"}],
            "issues_count": 0,
        }
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/verify")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["success"] is True
    assert payload["data"]["total_journals"] == 14
    assert payload["data"]["issues_count"] == 0


def test_index_verify_surfaces_issues():
    """GET /api/index/verify surfaces integrity issues from CLI payload.

    CLI may exit non-zero when issues found — adapter captures stdout
    as diagnostic, not fatal error.
    """
    mock_adapter = MagicMock()
    mock_adapter.verify = AsyncMock(
        return_value={
            "success": False,
            "total_journals": 14,
            "issues_count": 1,
            "suggestion": "Run diagnostics before repair.",
        }
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/verify")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["issues_count"] == 1
    assert payload["data"]["suggestion"] == "Run diagnostics before repair."


def test_index_verify_graceful_on_cli_failure():
    """GET /api/index/verify returns structured error when CLI fails."""
    mock_adapter = MagicMock()
    mock_adapter.verify = AsyncMock(
        return_value={"success": False, "error": "verify-unavailable", "issues_count": 0}
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/verify")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["success"] is False
    assert payload["data"]["error"] == "verify-unavailable"


# ── Cache dry-run ──────────────────────────────────────────────────────────


def test_index_cache_dry_run_returns_cli_payload():
    """GET /api/index/cache-dry-run returns cache-only dry-run diagnostics.

    S3 exit gate: cache dry-run rendered from CLI-mediated payloads.
    """
    mock_adapter = MagicMock()
    mock_adapter.index_cache_dry_run = AsyncMock(
        return_value={
            "success": True,
            "dry_run": True,
            "cache_version": {
                "would_rebuild": True,
                "reasons": ["no_existing_version"],
            },
        }
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/cache-dry-run")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["dry_run"] is True
    assert payload["data"]["cache_version"]["would_rebuild"] is True
    assert "no_existing_version" in payload["data"]["cache_version"]["reasons"]


def test_index_cache_dry_run_no_rebuild():
    """GET /api/index/cache-dry-run returns clean state when no rebuild needed."""
    mock_adapter = MagicMock()
    mock_adapter.index_cache_dry_run = AsyncMock(
        return_value={
            "success": True,
            "dry_run": True,
            "cache_version": {
                "would_rebuild": False,
                "reasons": [],
            },
        }
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/cache-dry-run")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["cache_version"]["would_rebuild"] is False


def test_index_cache_dry_run_graceful_on_cli_failure():
    """GET /api/index/cache-dry-run returns structured error when CLI fails."""
    mock_adapter = MagicMock()
    mock_adapter.index_cache_dry_run = AsyncMock(
        return_value={"success": False, "error": "cache-dry-run-unavailable"}
    )

    app.dependency_overrides[index_diag.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/index/cache-dry-run")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["success"] is False
    assert payload["data"]["error"] == "cache-dry-run-unavailable"
