"""Tests for Maintenance Data Doctor router."""

from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import maintenance

client = TestClient(app)


def test_audit_returns_adapter_payload():
    """GET /api/maintenance/audit returns adapter payload."""
    mock_adapter = MagicMock()
    mock_adapter.maintenance_audit = AsyncMock(
        return_value={
            "schema_version": "m33.maintenance_audit.v0",
            "issues": [
                {
                    "issue_id": "layout.missing_generated_index:INDEX.md",
                    "domain": "layout",
                    "severity": "warning",
                }
            ],
        }
    )

    app.dependency_overrides[maintenance.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/maintenance/audit")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "m33.maintenance_audit.v0"
    assert len(payload["data"]["issues"]) == 1
    mock_adapter.maintenance_audit.assert_called_once_with(domain=None)


def test_audit_with_domain_filter():
    """GET /api/maintenance/audit?domain=layout,frontmatter passes domain."""
    mock_adapter = MagicMock()
    mock_adapter.maintenance_audit = AsyncMock(
        return_value={
            "schema_version": "m33.maintenance_audit.v0",
            "summary": {"domain_counts": {"layout": 0, "frontmatter": 0}},
            "issues": [],
        }
    )

    app.dependency_overrides[maintenance.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/maintenance/audit?domain=layout,frontmatter")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["summary"]["domain_counts"] == {
        "layout": 0,
        "frontmatter": 0,
    }
    mock_adapter.maintenance_audit.assert_called_once_with(domain="layout,frontmatter")


def test_plan_returns_plan_payload():
    """GET /api/maintenance/plan?issueId=<id> returns plan payload."""
    issue_id = "layout.missing_generated_index:INDEX.md"
    mock_adapter = MagicMock()
    mock_adapter.maintenance_plan = AsyncMock(
        return_value={
            "schema_version": "m33.maintenance_plan.v0",
            "issue_id": issue_id,
            "repairable": True,
            "touched_paths": ["INDEX.md"],
        }
    )

    app.dependency_overrides[maintenance.get_cli] = lambda: mock_adapter
    try:
        response = client.get(f"/api/maintenance/plan?issueId={issue_id}")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "m33.maintenance_plan.v0"
    assert payload["data"]["issue_id"] == issue_id
    mock_adapter.maintenance_plan.assert_called_once_with(issue_id)


def test_repair_dry_run_returns_payload():
    """GET /api/maintenance/repair/dry-run?issueId=<id> returns dry-run payload."""
    issue_id = "layout.missing_generated_index:INDEX.md"
    mock_adapter = MagicMock()
    mock_adapter.maintenance_repair_dry_run = AsyncMock(
        return_value={
            "schema_version": "m33.maintenance_repair.v0",
            "issue_id": issue_id,
            "dry_run": True,
            "planned_paths": ["INDEX.md"],
        }
    )

    app.dependency_overrides[maintenance.get_cli] = lambda: mock_adapter
    try:
        response = client.get(f"/api/maintenance/repair/dry-run?issueId={issue_id}")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "m33.maintenance_repair.v0"
    assert payload["data"]["dry_run"] is True
    assert payload["data"]["issue_id"] == issue_id
    mock_adapter.maintenance_repair_dry_run.assert_called_once_with(issue_id)


def test_repair_apply_rejected_without_confirmation():
    """POST /api/maintenance/repair/apply with confirmed=false does not call CLI."""
    mock_adapter = MagicMock()
    mock_adapter.maintenance_repair_apply = AsyncMock(return_value={"applied": True})

    app.dependency_overrides[maintenance.get_cli] = lambda: mock_adapter
    try:
        response = client.post(
            "/api/maintenance/repair/apply",
            json={"issueId": "layout.broken", "confirmed": False},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CONFIRMATION_REQUIRED"
    mock_adapter.maintenance_repair_apply.assert_not_called()


def test_repair_apply_calls_cli_when_confirmed():
    """POST /api/maintenance/repair/apply with confirmed=true calls apply."""
    issue_id = "layout.missing_generated_index:INDEX.md"
    mock_adapter = MagicMock()
    mock_adapter.maintenance_repair_apply = AsyncMock(
        return_value={
            "schema_version": "m33.maintenance_repair.v0",
            "issue_id": issue_id,
            "dry_run": False,
            "applied": True,
            "changed_paths": ["INDEX.md"],
        }
    )

    app.dependency_overrides[maintenance.get_cli] = lambda: mock_adapter
    try:
        response = client.post(
            "/api/maintenance/repair/apply",
            json={"issueId": issue_id, "confirmed": True},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "m33.maintenance_repair.v0"
    assert payload["data"]["applied"] is True
    assert payload["data"]["issue_id"] == issue_id
    mock_adapter.maintenance_repair_apply.assert_called_once_with(issue_id)
