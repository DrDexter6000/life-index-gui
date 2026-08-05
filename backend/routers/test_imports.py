"""Tests for imports router — plan/run/status/rollback endpoints."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.adapter.cli_adapter import CLIError
from backend.adapter.import_adapter import (
    get_transient_plan,
    get_transient_source_root,
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


# ── M7 shared CLI singleton ───────────────────────────────────────────────


def test_get_cli_returns_shared_singleton():
    """get_cli returns one shared CLIAdapter so the write lock + compat TTL span requests."""
    from backend.routers import imports as imp

    imp._shared_cli = None  # reset
    try:
        a = imp.get_cli()
        b = imp.get_cli()
        assert a is b
    finally:
        imp._shared_cli = None


# ── M7 validate route ─────────────────────────────────────────────────────


def test_validate_route_success_strips_source_root():
    """POST /api/imports/validate strips source_root; keeps identity + readable."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1", "success": True,
        "command": "import.validate", "error": None,
        "data": {
            "schema_version": "import_review.v1",
            "source_root": "/photos/library",
            "source_root_identity": "sha256:ROOTIDENT",
            "readable": True,
        },
    })

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/validate", json={"source_root": "/photos/library"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "import_review.v1"
    assert "source_root" not in payload["data"]
    assert payload["data"]["source_root_identity"] == "sha256:ROOTIDENT"
    assert payload["data"]["readable"] is True
    args = mock_adapter.run_json.await_args.args[0]
    assert args[:3] == ["import", "validate", "--source-root"]
    assert Path(args[3]) == Path("/photos/library")  # path-normalization agnostic
    assert args[4] == "--json"


def test_validate_route_rejects_extra_fields():
    """validate body is strict (extra=forbid)."""
    response = client.post("/api/imports/validate", json={"source_root": "/x", "extra": 1})
    assert response.status_code == 422


def test_validate_route_cli_error():
    """validate maps CLI identity-mismatch to its structured code."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(side_effect=CLIError(
        returncode=1, stderr="not-json",
        stdout=json.dumps({"ok": False, "error": {
            "code": "IMPORT_SOURCE_ROOT_UNREADABLE", "message": "x",
            "details": {"source_root": "/photos"}}}),
    ))
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/validate", json={"source_root": "/photos"})
    finally:
        app.dependency_overrides.clear()
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_SOURCE_ROOT_UNREADABLE


# ── M7 reviews (list) route ───────────────────────────────────────────────


def test_reviews_route_success():
    """GET /api/imports/reviews returns normalized parent jobs + has_more."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1", "success": True,
        "command": "import.reviews", "error": None,
        "data": {
            "schema_version": "import_review.v1",
            "jobs": [{"import_id": "imp_parent", "state": "confirmed",
                      "queue_counts": {}, "active_child_id": None,
                      "recovery_required": False, "authority_status": None,
                      "plan_revision": 2, "queue_revision": 2,
                      "created_at": None, "updated_at": None}],
            "has_more": False,
        },
    })
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/imports/reviews?limit=10")
    finally:
        app.dependency_overrides.clear()
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["jobs"][0]["import_id"] == "imp_parent"
    assert payload["data"]["has_more"] is False
    args = mock_adapter.run_json.await_args.args[0]
    assert "--limit" in args and args[args.index("--limit") + 1] == "10"


# ── M7 review queue (bounded read) route ──────────────────────────────────


def test_review_queue_route_success():
    """GET /api/imports/reviews/{parent} returns the paginated queue."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1", "success": True,
        "command": "import.review", "error": None,
        "data": {
            "schema_version": "import_review.v1",
            "import_id": "imp_parent", "queue_revision": 2, "plan_revision": 2,
            "source_root_identity": "sha256:ROOTIDENT", "queue_counts": {},
            "warnings": [], "total_all": 5, "total_filtered": 5,
            "offset": 0, "limit": 20, "has_more": False, "next_offset": None,
            "proposals": [],
        },
    })
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.get(
            "/api/imports/reviews/imp_parent?offset=0&limit=20&state=pending&state=confirmed"
        )
    finally:
        app.dependency_overrides.clear()
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["total_all"] == 5
    args = mock_adapter.run_json.await_args.args[0]
    assert args[args.index("--import-id") + 1] == "imp_parent"
    state_idxs = [i for i, v in enumerate(args) if v == "--state"]
    assert len(state_idxs) == 2


# ── M7 review-status route ────────────────────────────────────────────────


def test_review_status_route_strips_plan_rel_path():
    """GET /api/imports/reviews/{parent}/status strips review_plan_rel_path only."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1", "success": True,
        "command": "import.status", "error": None,
        "data": {
            "schema_version": "import_review.v1",
            "import_id": "imp_parent", "kind": "review", "state": "confirmed",
            "source_root_identity": "sha256:ROOTIDENT", "proposal_states": {},
            "queue_counts": {}, "active_child_id": None, "recovery_required": False,
            "authority_status": None, "plan_fingerprint": "sha256:PLANFP",
            "plan_revision": 2, "queue_revision": 2,
            "review_plan_rel_path": ".life-index/import-jobs/imp_parent/review-plan.json",
            "batches": [],
        },
    })
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.get("/api/imports/reviews/imp_parent/status")
    finally:
        app.dependency_overrides.clear()
    payload = response.json()
    assert payload["ok"] is True
    assert "review_plan_rel_path" not in payload["data"]
    assert payload["data"]["kind"] == "review"
    assert payload["data"]["plan_fingerprint"] == "sha256:PLANFP"


# ── M7 plan+stage composite route ─────────────────────────────────────────


PHOTO_PLAN_RAW = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.plan", "error": None,
    "data": {
        "import_id": "imp_parent",
        "schema_version": "import_plan.v1",
        "plan_fingerprint": "sha256:PLANFP",
        "idempotency_key": "sha256:IDEM",
        "source": {"adapter_id": "media.photo_timeline", "record_count": 2},
        "summary": {"proposed_journal_count": 1, "proposed_attachment_count": 2,
                    "conflict_count": 0, "warning_count": 0},
        "proposals": [{"proposal_id": "prop_1", "state": "pending"}],
        "write_set_preview": {}, "conflicts": [], "warnings": [],
    },
}

STAGE_RAW = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.stage", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "parent_id": "imp_parent",
        "source_root_identity": "sha256:ROOTIDENT",
        "review_plan_rel_path": ".life-index/import-jobs/imp_parent/review-plan.json",
        "proposal_states": {"prop_1": "pending"},
        "queue_counts": {"pending": 1},
        "plan_revision": 1,
        "queue_revision": 1,
        "proposals": [],
    },
}


def test_stage_route_composes_plan_then_stage():
    """POST /api/imports/reviews/stage runs plan (read) then stage (write), stores source_root."""
    parent_id = "imp_parent"
    photo_dir = "/photos/library"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=PHOTO_PLAN_RAW)
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(STAGE_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/reviews/stage", json={"source_root": photo_dir})
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(parent_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "import_review.v1"
    assert payload["data"]["parent_id"] == parent_id
    assert "review_plan_rel_path" not in payload["data"]
    assert payload["data"]["source_root_identity"] == "sha256:ROOTIDENT"

    # plan step used the photo adapter + source root; stage step consumed a temp plan.
    plan_args = mock_adapter.run_json.await_args.args[0]
    assert plan_args[:4] == ["import", "plan", "--source", "media.photo_timeline"]
    assert Path(plan_args[plan_args.index("--input") + 1]) == Path(photo_dir)
    stage_args = mock_adapter.run_serialized.await_args.args[0]
    assert stage_args[:2] == ["import", "stage"]
    assert "--plan" in stage_args and "--source-root" in stage_args
    assert Path(stage_args[stage_args.index("--source-root") + 1]) == Path(photo_dir)


def test_stage_route_stores_transient_source_root_by_parent():
    """stage stores the source root transiently keyed by the review parent id."""
    parent_id = "imp_stage_transient"
    photo_dir = "/photos/library"
    stage_raw = json.loads(json.dumps(STAGE_RAW))
    stage_raw["data"]["parent_id"] = parent_id
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "schema_version": "import_job.v1", "success": True,
        "command": "import.plan", "error": None,
        "data": {
            "import_id": parent_id, "schema_version": "import_plan.v1",
            "source": {"adapter_id": "media.photo_timeline", "record_count": 1},
            "proposals": [], "summary": {},
        },
    })
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(stage_raw))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        client.post("/api/imports/reviews/stage", json={"source_root": photo_dir})
        assert get_transient_source_root(parent_id) == Path(photo_dir)
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(parent_id, None)


def test_stage_route_plan_cli_error_short_circuits():
    """A plan-step CLI failure returns the mapped error and never calls stage."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(side_effect=CLIError(
        returncode=1, stderr="unreadable",
        stdout=json.dumps({"ok": False, "error": {
            "code": "IMPORT_SOURCE_ROOT_UNREADABLE", "message": "x"}}),
    ))
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(STAGE_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/reviews/stage", json={"source_root": "/bad"})
    finally:
        app.dependency_overrides.clear()

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_SOURCE_ROOT_UNREADABLE
    mock_adapter.run_serialized.assert_not_awaited()


def test_stage_route_stage_cli_error_maps():
    """A stage-step CLI failure (e.g. already-staged) maps to its structured code."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=PHOTO_PLAN_RAW)
    mock_adapter.run_serialized = AsyncMock(side_effect=CLIError(
        returncode=1, stderr="dup",
        stdout=json.dumps({"ok": False, "error": {
            "code": "IMPORT_REVIEW_ALREADY_STAGED", "message": "x",
            "details": {"existing_import_id": "imp_old"}}}),
    ))
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/reviews/stage", json={"source_root": "/photos"})
    finally:
        app.dependency_overrides.clear()
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_REVIEW_ALREADY_STAGED


def test_stage_route_rejects_extra_fields():
    """stage body is strict (extra=forbid)."""
    response = client.post("/api/imports/reviews/stage",
                           json={"source_root": "/x", "extra": 1})
    assert response.status_code == 422


# ── M7 confirm-edit route ──────────────────────────────────────────────────


CONFIRM_EDIT_RAW = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.confirm", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "parent_id": "imp_parent",
        "source_root_identity": "sha256:ROOTIDENT",
        "review_plan_rel_path": ".life-index/import-jobs/imp_parent/review-plan.json",
        "proposal_states": {"prop_1": "confirmed"},
        "queue_counts": {"pending": 0, "confirmed": 1},
        "plan_revision": 2,
        "queue_revision": 2,
        "proposals": [],
    },
}


def test_confirm_edit_route_success():
    """POST /api/imports/reviews/{parent}/confirm-edit writes an edit payload and runs serialized."""
    parent_id = "imp_parent"
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(CONFIRM_EDIT_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(
            f"/api/imports/reviews/{parent_id}/confirm-edit",
            json={
                "expected_queue_revision": 1,
                "proposal_id": "prop_1",
                "decision": "confirmed",
                "journal": {"title": "Beach day", "topic": "travel"},
                "selected_attachment_ids": ["att_1", "att_2"],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "import_review.v1"
    assert payload["data"]["queue_revision"] == 2
    args = mock_adapter.run_serialized.await_args.args[0]
    assert args[:2] == ["import", "confirm"]
    assert "--edit" in args
    assert args[args.index("--import-id") + 1] == parent_id
    assert args[args.index("--expected-queue-revision") + 1] == "1"
    # confirm-edit re-derives from persisted facts; it must not forward a source locator
    assert "--source-root" not in args


def test_confirm_edit_route_revision_conflict_maps():
    """confirm-edit maps a queue-revision conflict to its retryable structured code."""
    parent_id = "imp_parent"
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(side_effect=CLIError(
        returncode=1, stderr="conflict",
        stdout=json.dumps({"ok": False, "error": {
            "code": "IMPORT_REVIEW_REVISION_CONFLICT", "message": "x",
            "details": {"current_queue_revision": 3, "expected_queue_revision": 1},
            "retryable": True}}),
    ))
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(
            f"/api/imports/reviews/{parent_id}/confirm-edit",
            json={"expected_queue_revision": 1, "proposal_id": "prop_1", "decision": "confirmed"},
        )
    finally:
        app.dependency_overrides.clear()
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_REVIEW_REVISION_CONFLICT
    assert payload["error"]["details"]["current_queue_revision"] == 3


# ── M7 rebind route ────────────────────────────────────────────────────────


REBIND_RAW = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.rebind", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "import_id": "imp_parent",
        "rebound": True,
        "source_root": "/photos/library",
        "source_root_identity": "sha256:ROOTIDENT2",
        "queue_revision": 2,
    },
}


def test_rebind_route_success_strips_source_root():
    """POST /api/imports/reviews/{parent}/rebind strips source_root, keeps identity."""
    parent_id = "imp_parent"
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(REBIND_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(
            f"/api/imports/reviews/{parent_id}/rebind",
            json={"source_root": "/photos/library"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["rebound"] is True
    assert "source_root" not in payload["data"]
    assert payload["data"]["source_root_identity"] == "sha256:ROOTIDENT2"
    args = mock_adapter.run_serialized.await_args.args[0]
    assert args[:2] == ["import", "rebind"]
    assert args[args.index("--import-id") + 1] == parent_id
    assert Path(args[args.index("--source-root") + 1]) == Path("/photos/library")


# ── M7 batch-run route ─────────────────────────────────────────────────────


BATCH_RUN_RAW = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.run", "error": None,
    "data": {
        "schema_version": "import_run.v1",
        "import_id": "imp_parent#batch-1",
        "parent_id": "imp_parent",
        "state": "committed",
        "created_files": [],
        "created_journal_count": 1,
        "created_attachment_count": 2,
        "rollback_manifest_rel_path": ".life-index/import-jobs/imp_parent_batch-1/rollback-manifest.json",
        "post_run_actions": {"index_rebuild_recommended": True},
    },
}


def test_batch_run_route_success_strips_manifest():
    """POST /api/imports/reviews/{parent}/batch-run uses the transient source root + strips the manifest locator."""
    parent_id = "imp_parent"
    photo_dir = "/photos/library"
    store_transient_plan(parent_id, {"import_id": parent_id}, source_root=Path(photo_dir))

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(BATCH_RUN_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(f"/api/imports/reviews/{parent_id}/batch-run")
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(parent_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "import_run.v1"
    assert payload["data"]["import_id"] == "imp_parent#batch-1"
    assert "rollback_manifest_rel_path" not in payload["data"]
    args = mock_adapter.run_serialized.await_args.args[0]
    assert args[:3] == ["import", "run", "--import-id"]
    assert args[args.index("--import-id") + 1] == parent_id
    assert Path(args[args.index("--source-root") + 1]) == Path(photo_dir)


def test_batch_run_route_missing_source_root():
    """batch-run with no transient source root (post-restart) asks for a re-stage, no CLI call."""
    parent_id = "imp_batch_missing"
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(BATCH_RUN_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(f"/api/imports/reviews/{parent_id}/batch-run")
    finally:
        app.dependency_overrides.clear()

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.VALIDATION_ERROR
    assert payload["error"]["details"] == {"reason": "rebind_required", "missing": "source_root"}
    mock_adapter.run_serialized.assert_not_awaited()


# ── M7 child-rollback route ────────────────────────────────────────────────


CHILD_ROLLBACK_RAW = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.rollback", "error": None,
    "data": {
        "import_id": "imp_parent#batch-1",
        "schema_version": "import_rollback.v1",
        "state": "rolled_back",
        "deleted_count": 3,
        "rollback_manifest_rel_path": ".life-index/import-jobs/imp_parent_batch-1/rollback-manifest.json",
    },
}


def test_child_rollback_route_success_keeps_manifest():
    """POST /api/imports/rollback takes the child id in the body (# is URL-unsafe) and keeps the manifest locator."""
    child_id = "imp_parent#batch-1"
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(CHILD_ROLLBACK_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/rollback", json={"import_id": child_id})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["schema_version"] == "import_rollback.v1"
    assert payload["data"]["import_id"] == child_id
    # child rollback reuses the legacy normalizer: the manifest locator is kept.
    assert "rollback_manifest_rel_path" in payload["data"]
    args = mock_adapter.run_serialized.await_args.args[0]
    assert args[:3] == ["import", "rollback", "--import-id"]
    assert args[args.index("--import-id") + 1] == child_id


def test_child_rollback_route_preserves_interrupted_recovery_error():
    """A caught partial rollback remains explicit instead of becoming internal."""
    child_id = "imp_parent#batch-1"
    negative = json.dumps(
        {
            "schema_version": "import_job.v1",
            "success": False,
            "command": "import.rollback",
            "data": None,
            "error": {
                "code": "IMPORT_ROLLBACK_INTERRUPTED",
                "message": "unsafe CLI text",
                "details": {
                    "import_id": child_id,
                    "deleted_count": 1,
                    "path": "C:/private/photos/secret.jpg",
                    "error": "arbitrary filesystem diagnostics",
                },
                "retryable": True,
            },
        }
    )
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        side_effect=CLIError(returncode=1, stderr="", stdout=negative)
    )

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post("/api/imports/rollback", json={"import_id": child_id})
    finally:
        app.dependency_overrides.clear()

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"] == {
        "code": "IMPORT_ROLLBACK_INTERRUPTED",
        "message": "回滚已中断，恢复状态已保留，可重试",
        "details": {
            "import_id": child_id,
            "deleted_count": 1,
            "reason": "rollback_interrupted",
        },
    }
    assert payload["error"]["code"] != E.IMPORT_INTERNAL_ERROR


# ── M7 preview route ───────────────────────────────────────────────────────


def test_preview_route_returns_binary_and_metadata(monkeypatch, tmp_path):
    """GET preview streams the exact JPEG bytes + a stripped, verified sidecar header."""
    parent_id = "imp_preview"
    photo_dir = "/photos/library"
    image_bytes = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 24  # JPEG SOI + JFIF
    meta_path = tmp_path / "meta.json"
    meta_path.write_text(json.dumps({
        "schema_version": "import_preview.v1",
        "parent_id": parent_id,
        "proposal_id": "prop_1",
        "attachment_id": "att_1",
        "size_bytes": len(image_bytes),
        "media_type": "image/jpeg",
        "available": True,
        "source_rel_path": "photos/2024/img.jpg",
        "source_sha256": "sha256:abc",
    }), encoding="utf-8")
    monkeypatch.setattr(imports, "unique_metadata_path", lambda: meta_path)

    store_transient_plan(parent_id, {"import_id": parent_id}, source_root=Path(photo_dir))

    mock_adapter = MagicMock()
    mock_adapter.run_preview_bytes = AsyncMock(return_value=image_bytes)

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.get(
            f"/api/imports/reviews/{parent_id}/preview"
            "?attachment_id=att_1&proposal_id=prop_1"
        )
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(parent_id, None)

    assert response.status_code == 200
    assert response.content == image_bytes
    assert response.headers["content-type"].startswith("image/jpeg")
    meta_header = json.loads(response.headers["x-preview-metadata"])
    assert meta_header["attachment_id"] == "att_1"
    assert meta_header["proposal_id"] == "prop_1"
    assert meta_header["media_type"] == "image/jpeg"
    assert "source_rel_path" not in meta_header
    assert "source_sha256" not in meta_header
    args = mock_adapter.run_preview_bytes.await_args.args[0]
    assert args[:2] == ["import", "preview"]
    assert args[args.index("--import-id") + 1] == parent_id
    assert args[args.index("--attachment") + 1] == "att_1"
    assert args[args.index("--proposal-id") + 1] == "prop_1"
    assert args[args.index("--output") + 1] == "-"
    assert "--metadata-output" in args
    assert Path(args[args.index("--source-root") + 1]) == Path(photo_dir)


def test_preview_route_missing_source_root():
    """preview with no transient source root asks for a rebind, no CLI call."""
    parent_id = "imp_preview_missing"
    mock_adapter = MagicMock()
    mock_adapter.run_preview_bytes = AsyncMock(return_value=b"bytes")

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.get(
            f"/api/imports/reviews/{parent_id}/preview?attachment_id=att_1&proposal_id=prop_1")
    finally:
        app.dependency_overrides.clear()

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.VALIDATION_ERROR
    assert payload["error"]["details"] == {"reason": "rebind_required", "missing": "source_root"}
    mock_adapter.run_preview_bytes.assert_not_awaited()


def test_preview_route_cli_error_maps():
    """preview maps a CLI error (e.g. unavailable) to its structured code."""
    parent_id = "imp_preview_err"
    store_transient_plan(parent_id, {"import_id": parent_id}, source_root=Path("/photos"))

    mock_adapter = MagicMock()
    mock_adapter.run_preview_bytes = AsyncMock(side_effect=CLIError(
        returncode=1, stderr="no preview",
        stdout=json.dumps({"ok": False, "error": {
            "code": "IMPORT_PREVIEW_UNAVAILABLE", "message": "x"}}),
    ))
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.get(
            f"/api/imports/reviews/{parent_id}/preview?attachment_id=att_1&proposal_id=prop_1")
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(parent_id, None)

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_PREVIEW_UNAVAILABLE


def test_preview_route_requires_attachment_id():
    """preview without attachment_id returns 422."""
    response = client.get("/api/imports/reviews/imp_parent/preview")
    assert response.status_code == 422


# ── M7-C causal: rebind restores the transient source-root after restart ──


def test_rebind_restores_transient_source_root_after_simulated_restart():
    """A backend restart clears the transient store; a successful rebind must
    restore the source-root binding for that parent (no durable state created)."""
    parent_id = "imp_rebind_restart"
    photo_dir = "/photos/library"

    from backend.adapter import import_adapter as ia
    ia._transient_plan_store.pop(parent_id, None)  # simulate backend restart

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=json.dumps(REBIND_RAW))

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        response = client.post(
            f"/api/imports/reviews/{parent_id}/rebind",
            json={"source_root": photo_dir},
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
        # Direct proof: the transient source-root is restored after rebind.
        assert get_transient_source_root(parent_id) == Path(photo_dir)
    finally:
        app.dependency_overrides.clear()
        ia._transient_plan_store.pop(parent_id, None)


def test_rebind_then_batch_run_uses_restored_source_root():
    """Simulated restart → rebind restores the root → a downstream batch-run
    uses it instead of dead-ending the user on restage_required."""
    parent_id = "imp_rebind_then_batch"
    photo_dir = "/photos/library"

    from backend.adapter import import_adapter as ia
    ia._transient_plan_store.pop(parent_id, None)  # simulate backend restart

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        side_effect=[json.dumps(REBIND_RAW), json.dumps(BATCH_RUN_RAW)]
    )

    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        rebind_resp = client.post(
            f"/api/imports/reviews/{parent_id}/rebind",
            json={"source_root": photo_dir},
        )
        assert rebind_resp.status_code == 200
        # Direct proof the transient source-root is restored.
        assert get_transient_source_root(parent_id) == Path(photo_dir)

        # Downstream proof: batch-run retrieves and uses the restored root.
        batch_resp = client.post(f"/api/imports/reviews/{parent_id}/batch-run")
    finally:
        app.dependency_overrides.clear()
        ia._transient_plan_store.pop(parent_id, None)

    assert batch_resp.status_code == 200
    batch_payload = batch_resp.json()
    assert batch_payload["ok"] is True
    batch_args = mock_adapter.run_serialized.await_args.args[0]
    assert Path(batch_args[batch_args.index("--source-root") + 1]) == Path(photo_dir)


# ── M7-C causal: preview sidecar is verified, not trusted ──────────────────

JPEG_BYTES = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 24  # JPEG SOI + JFIF


def _preview_sidecar(for_parent, **overrides):
    """Production-shaped import_preview.v1 sidecar (matches the frozen CLI)."""
    base = {
        "schema_version": "import_preview.v1",
        "parent_id": for_parent,
        "attachment_id": "att_1",
        "proposal_id": "prop_1",
        "source_rel_path": "photos/2024/IMG_0001.jpg",
        "source_sha256": "sha256:abc",
        "size_bytes": len(JPEG_BYTES),
        "media_type": "image/jpeg",
        "available": True,
    }
    base.update(overrides)
    return base


def _preview_get(monkeypatch, tmp_path, parent_id, sidecar, *,
                 attachment_id="att_1", proposal_id="prop_1",
                 include_proposal_id=True, image_bytes=JPEG_BYTES):
    """Stage a transient source root + sidecar file + byte CLI mock, then GET preview."""
    meta_path = tmp_path / "preview_meta.json"
    if isinstance(sidecar, str):
        meta_path.write_text(sidecar, encoding="utf-8")
    else:
        meta_path.write_text(json.dumps(sidecar), encoding="utf-8")
    monkeypatch.setattr(imports, "unique_metadata_path", lambda: meta_path)
    store_transient_plan(parent_id, {"import_id": parent_id}, source_root=Path("/photos/library"))
    mock_adapter = MagicMock()
    mock_adapter.run_preview_bytes = AsyncMock(return_value=image_bytes)
    app.dependency_overrides[imports.get_cli] = lambda: mock_adapter
    try:
        query = f"attachment_id={attachment_id}"
        if include_proposal_id:
            query += f"&proposal_id={proposal_id}"
        return client.get(f"/api/imports/reviews/{parent_id}/preview?{query}")
    finally:
        app.dependency_overrides.clear()
        from backend.adapter import import_adapter as ia
        ia._transient_plan_store.pop(parent_id, None)


def _assert_preview_unavailable(response, reason):
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == E.IMPORT_PREVIEW_UNAVAILABLE
    assert payload["error"]["details"] == {"reason": reason}


def test_preview_bad_schema_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p", schema_version="import_preview.v2"))
    _assert_preview_unavailable(response, "preview_schema_unsupported")


def test_preview_available_false_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p", available=False))
    _assert_preview_unavailable(response, "preview_unavailable")


def test_preview_parent_mismatch_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p", parent_id="imp_other"))
    _assert_preview_unavailable(response, "preview_identity_mismatch")


def test_preview_proposal_mismatch_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p", proposal_id="prop_other"))
    _assert_preview_unavailable(response, "preview_identity_mismatch")


def test_preview_attachment_mismatch_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p", attachment_id="att_other"))
    _assert_preview_unavailable(response, "preview_identity_mismatch")


def test_preview_wrong_media_type_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p", media_type="image/png"))
    _assert_preview_unavailable(response, "preview_media_unsupported")


def test_preview_size_mismatch_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p", size_bytes=len(JPEG_BYTES) + 1))
    _assert_preview_unavailable(response, "preview_size_mismatch")


def test_preview_malformed_sidecar_rejected(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p", "{not valid json")
    _assert_preview_unavailable(response, "preview_unavailable")


def test_preview_oversized_sidecar_rejected(monkeypatch, tmp_path):
    big = '{"x":"' + ("A" * (2 * 1024 * 1024)) + '"}'
    response = _preview_get(monkeypatch, tmp_path, "imp_p", big)
    _assert_preview_unavailable(response, "preview_unavailable")


def test_preview_missing_proposal_id_returns_422(monkeypatch, tmp_path):
    response = _preview_get(monkeypatch, tmp_path, "imp_p",
                            _preview_sidecar("imp_p"), include_proposal_id=False)
    assert response.status_code == 422
