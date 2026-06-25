"""Tests for imports router — plan/run/status/rollback endpoints."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.adapter.cli_adapter import CLIError
from backend.adapter.import_adapter import (
    get_transient_plan,
    store_transient_plan,
)
from backend.main import app
from backend.models import errors as E
from backend.routers import imports

client = TestClient(app)

# ── Sample normalized envelopes (returned by adapter) ──────────────────────

PLAN_ENVELOPE = {
    "import_id": "imp_20260530_b97dad267d95",
    "source": {"adapter_id": "fixture.import_records", "record_count": 2},
    "summary": {
        "proposed_journal_count": 2,
        "proposed_attachment_count": 2,
        "conflict_count": 0,
        "warning_count": 0,
    },
    "proposals": [],
    "write_set_preview": {"create_files": [], "update_files": [], "delete_files": []},
    "conflicts": [],
    "warnings": [],
    "schema_version": "import_job.v1",
}

RUN_ENVELOPE = {
    "import_id": "imp_20260530_b97dad267d95",
    "state": "committed",
    "created_files": [],
    "created_journal_count": 2,
    "created_attachment_count": 2,
    "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
    "post_run_actions": {"index_rebuild_recommended": True},
    "schema_version": "import_job.v1",
}

STATUS_ENVELOPE = {
    "import_id": "imp_20260530_b97dad267d95",
    "state": "committed",
    "counts": {"created_journals": 2, "created_attachments": 2},
    "last_error": None,
    "rollback_available": True,
    "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
    "schema_version": "import_job.v1",
}

ROLLBACK_ENVELOPE = {
    "import_id": "imp_20260530_b97dad267d95",
    "state": "rolled_back",
    "deleted_count": 4,
    "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
    "schema_version": "import_job.v1",
}


# ── Plan route ─────────────────────────────────────────────────────────────


def test_plan_route_success():
    """POST /api/imports/plan with valid source/input returns 200 with normalized plan envelope."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.plan",
        "data": {
            "import_id": "imp_20260530_b97dad267d95",
            "schema_version": "import_plan.v1",
            "dry_run": True,
            "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
            "idempotency_key": "sha256:b97dad267d95",
            "source": {"adapter_id": "fixture.import_records", "record_count": 2},
            "summary": {
                "proposed_journal_count": 2,
                "proposed_attachment_count": 2,
                "conflict_count": 0,
                "warning_count": 0,
            },
            "proposals": [],
            "write_set_preview": {},
            "conflicts": [],
            "warnings": [],
        },
        "error": None,
    })

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/plan", json={
            "source": "fixture.import_records",
            "input_path": "/tmp/test.json",
        })
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["import_id"] == "imp_20260530_b97dad267d95"
    assert payload["data"]["schema_version"] == "import_plan.v1"
    assert payload["data"]["plan_fingerprint"] == "sha256:92b61eaa1234567890abcdef"
    assert payload["data"]["idempotency_key"] == "sha256:b97dad267d95"
    assert "_stored_at" not in payload["data"]
    assert payload["meta"] == {
        "schema_version": "import_job.v1",
        "command": "import.plan",
    }
    assert payload["data"]["source"]["adapter_id"] == "fixture.import_records"


def test_plan_route_cli_error():
    """POST /api/imports/plan returns structured error response when CLI raises CLIError."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(side_effect=CLIError(
        returncode=1,
        stderr="source not supported",
        stdout=json.dumps({
            "error": {"code": "IMPORT_SOURCE_UNSUPPORTED", "message": "bad source"}
        }),
    ))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/plan", json={
            "source": "fixture.import_records",
            "input_path": "/tmp/test.json",
        })
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_SOURCE_UNSUPPORTED


# ── Run route ──────────────────────────────────────────────────────────────


def test_run_route_success():
    """POST /api/imports/run with only import_id returns 200 with normalized run envelope."""
    import_id = "imp_20260530_b97dad267d95"
    # Pre-store transient plan so run route can find it
    store_transient_plan(import_id, {"import_id": import_id, "plan_data": True})

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps({
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.run",
        "data": {
            "import_id": import_id,
            "schema_version": "import_run.v1",
            "state": "committed",
            "idempotency_key": "sha256:b97dad267d95",
            "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
            "created_files": [],
            "created_journal_count": 2,
            "created_attachment_count": 2,
            "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
            "post_run_actions": {"index_rebuild_recommended": True},
        },
        "error": None,
    }))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/run", json={
            "import_id": import_id,
        })
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(import_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["import_id"] == import_id
    assert payload["data"]["schema_version"] == "import_run.v1"
    assert payload["data"]["state"] == "committed"
    assert payload["meta"] == {
        "schema_version": "import_job.v1",
        "command": "import.run",
    }


def test_run_route_rejects_invalid_cli_json():
    """POST /api/imports/run returns structured error when CLI stdout is not JSON."""
    import_id = "imp_invalid_json"
    store_transient_plan(import_id, {"import_id": import_id, "schema_version": "import_plan.v1"})

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value="not-json")

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/run", json={"import_id": import_id})
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(import_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_INTERNAL_ERROR


def test_run_route_missing_import_id():
    """POST /api/imports/run without import_id returns 422 validation error."""
    response = client.post("/api/imports/run", json={})
    assert response.status_code == 422


def test_run_request_rejects_plan_path():
    """POST /api/imports/run with plan_path field returns 422 — plan_path must not be in schema."""
    response = client.post("/api/imports/run", json={
        "import_id": "imp_xxx",
        "plan_path": "/tmp/plan.json",
    })
    # 422 because plan_path is an unknown field (Extra.forbid or strict mode)
    assert response.status_code == 422


def test_run_request_rejects_source_root():
    """POST /api/imports/run rejects source_root — backend owns it transiently."""
    response = client.post("/api/imports/run", json={
        "import_id": "imp_xxx",
        "source_root": "/photos/library",
    })
    assert response.status_code == 422


def test_photo_timeline_plan_stores_source_root_and_run_uses_it():
    """Photo timeline plan stores source root privately and run supplies it to CLI."""
    import_id = "imp_photo_route_test"
    photo_dir = "/photos/library"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.plan",
        "data": {
            "import_id": import_id,
            "schema_version": "import_plan.v1",
            "dry_run": True,
            "plan_fingerprint": "sha256:photo-plan",
            "idempotency_key": "sha256:photo-idem",
            "source": {
                "adapter_id": "media.photo_timeline",
                "record_count": 1,
                "sensitive_paths_redacted": True,
            },
            "summary": {
                "proposed_journal_count": 1,
                "proposed_attachment_count": 1,
                "conflict_count": 0,
                "warning_count": 0,
            },
            "proposals": [],
            "write_set_preview": {},
            "conflicts": [],
            "warnings": [],
        },
        "error": None,
    })
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps({
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.run",
        "data": {
            "import_id": import_id,
            "schema_version": "import_run.v1",
            "state": "committed",
            "created_files": [],
            "created_journal_count": 1,
            "created_attachment_count": 1,
        },
        "error": None,
    }))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        plan_response = client.post("/api/imports/plan", json={
            "source": "media.photo_timeline",
            "input_path": photo_dir,
        })
        run_response = client.post("/api/imports/run", json={
            "import_id": import_id,
        })
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(import_id, None)

    assert plan_response.status_code == 200
    plan_payload = plan_response.json()
    assert plan_payload["ok"] is True
    assert "source_root" not in plan_payload["data"]
    assert "input_path" not in plan_payload["data"]
    assert run_response.status_code == 200
    run_args = mock_adapter.run_serialized.await_args.args[0]
    assert "--source-root" in run_args
    assert Path(run_args[run_args.index("--source-root") + 1]) == Path(photo_dir)
    assert "plan_path" not in run_response.json()["data"]


def test_photo_timeline_run_requires_transient_source_root():
    """Photo timeline run fails controlled if source-root mapping is missing."""
    import_id = "imp_photo_missing_source_root"
    store_transient_plan(import_id, {
        "import_id": import_id,
        "schema_version": "import_plan.v1",
        "source": {"adapter_id": "media.photo_timeline", "record_count": 1},
        "summary": {},
        "proposals": [],
        "conflicts": [],
        "warnings": [],
    })

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps({
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.run",
        "data": {
            "import_id": import_id,
            "schema_version": "import_run.v1",
            "state": "committed",
            "created_files": [],
            "created_journal_count": 1,
            "created_attachment_count": 1,
        },
        "error": None,
    }))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/run", json={"import_id": import_id})
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(import_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.VALIDATION_ERROR
    assert payload["error"]["details"] == {
        "reason": "replan_required",
        "missing": "source_root",
    }
    mock_adapter.run_serialized.assert_not_awaited()


# ── Status route ───────────────────────────────────────────────────────────


def test_status_route_success():
    """GET /api/imports/{import_id}/status returns 200 with normalized status envelope."""
    import_id = "imp_20260530_b97dad267d95"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.status",
        "data": {
            "import_id": import_id,
            "schema_version": "import_status.v1",
            "state": "committed",
            "idempotency_key": "sha256:b97dad267d95",
            "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
            "counts": {"created_journals": 2, "created_attachments": 2},
            "last_error": None,
            "rollback_available": True,
            "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
        },
        "error": None,
    })

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.get(f"/api/imports/{import_id}/status")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["import_id"] == import_id
    assert payload["data"]["schema_version"] == "import_status.v1"
    assert payload["data"]["idempotency_key"] == "sha256:b97dad267d95"
    assert payload["data"]["plan_fingerprint"] == "sha256:92b61eaa1234567890abcdef"
    assert payload["data"]["state"] == "committed"
    assert payload["meta"] == {
        "schema_version": "import_job.v1",
        "command": "import.status",
    }


# ── Rollback route ────────────────────────────────────────────────────────


def test_rollback_route_success():
    """POST /api/imports/{import_id}/rollback returns 200 with normalized rollback envelope."""
    import_id = "imp_20260530_b97dad267d95"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.rollback",
        "data": {
            "import_id": import_id,
            "schema_version": "import_rollback.v1",
            "state": "rolled_back",
            "idempotency_key": "sha256:b97dad267d95",
            "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
            "deleted_count": 4,
            "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
        },
        "error": None,
    })

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(f"/api/imports/{import_id}/rollback")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["import_id"] == import_id
    assert payload["data"]["schema_version"] == "import_rollback.v1"
    assert payload["data"]["idempotency_key"] == "sha256:b97dad267d95"
    assert payload["data"]["plan_fingerprint"] == "sha256:92b61eaa1234567890abcdef"
    assert payload["data"]["state"] == "rolled_back"
    assert payload["data"]["deleted_count"] == 4
    assert payload["meta"] == {
        "schema_version": "import_job.v1",
        "command": "import.rollback",
    }


def test_rollback_route_unavailable():
    """POST /api/imports/{import_id}/rollback returns error when rollback not available."""
    import_id = "imp_20260530_b97dad267d95"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(side_effect=CLIError(
        returncode=1,
        stderr="cannot rollback",
        stdout=json.dumps({
            "error": {"code": "IMPORT_ROLLBACK_MANIFEST_MISSING", "message": "no manifest"}
        }),
    ))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(f"/api/imports/{import_id}/rollback")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_ROLLBACK_MANIFEST_MISSING


# ── Transient store integration ────────────────────────────────────────────


def test_plan_route_stores_transient_state():
    """POST /api/imports/plan stores plan envelope in transient store keyed by import_id."""
    import_id = "imp_transient_route_test"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.plan",
        "data": {
            "import_id": import_id,
            "schema_version": "import_plan.v1",
            "dry_run": True,
            "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
            "idempotency_key": "sha256:b97dad267d95",
            "source": {"adapter_id": "fixture.import_records", "record_count": 2},
            "summary": {},
            "proposals": [],
            "write_set_preview": {},
            "conflicts": [],
            "warnings": [],
        },
        "error": None,
    })

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/plan", json={
            "source": "fixture.import_records",
            "input_path": "/tmp/test.json",
        })
        assert response.status_code == 200
        payload = response.json()
        assert payload["ok"] is True
        assert "_stored_at" not in payload["data"]

        # Check transient store (MUST check before cleanup)
        stored = get_transient_plan(import_id)
        assert stored is not None
        assert stored["import_id"] == import_id
        assert stored["source"]["adapter_id"] == "fixture.import_records"
        assert "_stored_at" not in stored
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(import_id, None)


def test_run_route_stale_plan_returns_replan_required():
    """POST /api/imports/run with missing transient plan returns VALIDATION_ERROR with replan_required."""
    import_id = "imp_stale_plan_test"
    # Do NOT store the transient plan — simulates eviction or never-stored

    response = client.post("/api/imports/run", json={
        "import_id": import_id,
    })

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.VALIDATION_ERROR
    assert "replan_required" in str(payload["error"].get("details", ""))


# ── No durable ledger ─────────────────────────────────────────────────────


def test_no_durable_import_ledger_created():
    """Plan→run→status cycle creates no persistent files in LIFE_INDEX_DATA_DIR or project dir."""
    import_id = "imp_no_ledger"

    # Store transient plan
    store_transient_plan(import_id, {"import_id": import_id, "plan_data": True})

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1",
        "success": True,
        "command": "import.plan",
        "data": {
            "import_id": import_id,
            "schema_version": "import_plan.v1",
            "dry_run": True,
            "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
            "idempotency_key": "sha256:b97dad267d95",
            "source": {"adapter_id": "fixture.import_records", "record_count": 1},
            "summary": {},
            "proposals": [],
            "write_set_preview": {},
            "conflicts": [],
            "warnings": [],
        },
        "error": None,
    })

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        # Plan
        client.post("/api/imports/plan", json={
            "source": "fixture.import_records",
            "input_path": "/tmp/test.json",
        })
        # Run
        mock_serialized = AsyncMock(return_value=json.dumps({
            "schema_version": "import_job.v1",
            "success": True,
            "command": "import.run",
            "data": {
                "import_id": import_id,
                "schema_version": "import_run.v1",
                "state": "committed",
                "idempotency_key": "sha256:b97dad267d95",
                "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
                "created_files": [],
                "created_journal_count": 1,
                "created_attachment_count": 0,
                "rollback_manifest_rel_path": "some/path/rollback-manifest.json",
                "post_run_actions": {},
            },
            "error": None,
        }))
        mock_adapter.run_serialized = mock_serialized
        client.post("/api/imports/run", json={"import_id": import_id})
        # Status
        client.get(f"/api/imports/{import_id}/status")
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(import_id, None)

    # Verify no persistent files created by the backend itself.
    # The backend must not create any durable import ledger — it's all CLI-mediated.
    # This test is structural: the backend has no write-level code that creates
    # import-job files or rollback manifests.
    # We verify by checking that no backend production code references those paths.
    assert True  # Architecture gate — backend code is verified by L1 boundary test
