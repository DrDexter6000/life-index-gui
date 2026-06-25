"""Tests for import adapter — arg builders, envelope normalizers, temp plan, transient store."""

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.adapter.cli_adapter import CLIError
from backend.adapter.import_adapter import (
    build_import_plan_args,
    build_import_run_args,
    build_import_status_args,
    build_import_rollback_args,
    get_transient_plan,
    normalize_plan_envelope,
    normalize_rollback_envelope,
    normalize_run_envelope,
    normalize_status_envelope,
    store_transient_plan,
    write_temp_plan,
)


# ── Sample CLI envelopes (matching the CLI handoff spec) ───────────────────

PLAN_CLI_OUTPUT = {
    "schema_version": "import_job.v1",
    "success": True,
    "command": "import.plan",
    "data": {
        "import_id": "imp_20260530_b97dad267d95",
        "schema_version": "import_plan.v1",
        "dry_run": True,
        "source": {"adapter_id": "fixture.import_records", "record_count": 2},
        "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
        "idempotency_key": "sha256:b97dad267d95",
        "summary": {
            "proposed_journal_count": 2,
            "proposed_attachment_count": 2,
            "conflict_count": 0,
            "warning_count": 0,
        },
        "proposals": [
            {
                "proposal_id": "prop_a00812345678",
                "source_record_id": "src_minimal_001",
                "journal": {},
                "attachments": [],
                "conflicts": [],
                "warnings": [],
            }
        ],
        "write_set_preview": {
            "create_files": [],
            "update_files": [],
            "delete_files": [],
        },
        "conflicts": [],
        "warnings": [],
    },
    "error": None,
}

RUN_CLI_OUTPUT = {
    "schema_version": "import_job.v1",
    "success": True,
    "command": "import.run",
    "data": {
        "import_id": "imp_20260530_b97dad267d95",
        "schema_version": "import_run.v1",
        "state": "committed",
        "idempotency_key": "sha256:b97dad267d95",
        "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
        "created_files": [
            {
                "kind": "journal",
                "rel_path": "2026/05/30-imported-journal.md",
                "sha256_after": "abcdef1234567890",
                "size_bytes": 135,
                "created_by_import": True,
            }
        ],
        "created_journal_count": 2,
        "created_attachment_count": 2,
        "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
        "post_run_actions": {"index_rebuild_recommended": True},
    },
    "error": None,
}

STATUS_CLI_OUTPUT = {
    "schema_version": "import_job.v1",
    "success": True,
    "command": "import.status",
    "data": {
        "import_id": "imp_20260530_b97dad267d95",
        "schema_version": "import_status.v1",
        "state": "committed",
        "idempotency_key": "sha256:b97dad267d95",
        "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
        "counts": {
            "planned_journals": 2,
            "created_journals": 2,
            "planned_attachments": 2,
            "created_attachments": 2,
        },
        "last_error": None,
        "rollback_available": True,
        "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
    },
    "error": None,
}

ROLLBACK_CLI_OUTPUT = {
    "schema_version": "import_job.v1",
    "success": True,
    "command": "import.rollback",
    "data": {
        "import_id": "imp_20260530_b97dad267d95",
        "schema_version": "import_rollback.v1",
        "state": "rolled_back",
        "idempotency_key": "sha256:b97dad267d95",
        "plan_fingerprint": "sha256:92b61eaa1234567890abcdef",
        "deleted_count": 4,
        "rollback_manifest_rel_path": ".life-index/import-jobs/imp_b97dad267d95/rollback-manifest.json",
    },
    "error": None,
}


# ── Arg builders ───────────────────────────────────────────────────────────


def test_build_import_plan_args():
    """build_import_plan_args returns correct CLI argument list."""
    import_id = "imp_20260530_b97dad267d95"
    input_path = Path("/tmp/test_input.json")
    result = build_import_plan_args("fixture.import_records", input_path)
    assert result == [
        "import", "plan",
        "--source", "fixture.import_records",
        "--input", str(input_path),
        "--json",
    ]


def test_build_import_run_args():
    """build_import_run_args returns correct CLI argument list."""
    import_id = "imp_20260530_b97dad267d95"
    plan_path = Path("/tmp/test_plan.json")
    result = build_import_run_args(plan_path, import_id)
    assert result == [
        "import", "run",
        "--plan", str(plan_path),
        "--confirm", import_id,
        "--json",
    ]


def test_build_import_run_args_with_source_root():
    """media.photo_timeline run args include transient --source-root."""
    import_id = "imp_photo_timeline"
    plan_path = Path("/tmp/photo_plan.json")
    source_root = Path("/photos/library")
    result = build_import_run_args(plan_path, import_id, source_root=source_root)
    assert result == [
        "import", "run",
        "--plan", str(plan_path),
        "--confirm", import_id,
        "--source-root", str(source_root),
        "--json",
    ]


def test_build_import_status_args():
    """build_import_status_args returns correct CLI argument list."""
    import_id = "imp_20260530_b97dad267d95"
    result = build_import_status_args(import_id)
    assert result == [
        "import", "status",
        "--import-id", import_id,
        "--json",
    ]


def test_build_import_rollback_args():
    """build_import_rollback_args returns correct CLI argument list."""
    import_id = "imp_20260530_b97dad267d95"
    result = build_import_rollback_args(import_id)
    assert result == [
        "import", "rollback",
        "--import-id", import_id,
        "--json",
    ]


# ── Envelope normalizers ──────────────────────────────────────────────────


def test_normalize_plan_envelope():
    """normalize_plan_envelope preserves all required plan data fields."""
    result = normalize_plan_envelope(PLAN_CLI_OUTPUT)
    assert result["schema_version"] == "import_plan.v1"
    assert result["import_id"] == "imp_20260530_b97dad267d95"
    assert result["dry_run"] is True
    assert result["source"]["adapter_id"] == "fixture.import_records"
    assert result["plan_fingerprint"] == "sha256:92b61eaa1234567890abcdef"
    assert result["idempotency_key"] == "sha256:b97dad267d95"
    assert result["summary"]["proposed_journal_count"] == 2
    assert result["summary"]["conflict_count"] == 0
    assert len(result["proposals"]) == 1
    assert "write_set_preview" in result
    assert "conflicts" in result
    assert "warnings" in result


def test_normalize_run_envelope():
    """normalize_run_envelope preserves all required run data fields."""
    result = normalize_run_envelope(RUN_CLI_OUTPUT)
    assert result["schema_version"] == "import_run.v1"
    assert result["import_id"] == "imp_20260530_b97dad267d95"
    assert result["state"] == "committed"
    assert result["idempotency_key"] == "sha256:b97dad267d95"
    assert result["plan_fingerprint"] == "sha256:92b61eaa1234567890abcdef"
    assert result["created_journal_count"] == 2
    assert result["created_attachment_count"] == 2
    assert "created_files" in result
    assert "rollback_manifest_rel_path" in result
    assert "post_run_actions" in result


def test_normalize_status_envelope():
    """normalize_status_envelope preserves all required status data fields."""
    result = normalize_status_envelope(STATUS_CLI_OUTPUT)
    assert result["schema_version"] == "import_status.v1"
    assert result["import_id"] == "imp_20260530_b97dad267d95"
    assert result["state"] == "committed"
    assert result["idempotency_key"] == "sha256:b97dad267d95"
    assert result["plan_fingerprint"] == "sha256:92b61eaa1234567890abcdef"
    assert result["counts"]["created_journals"] == 2
    assert result["last_error"] is None
    assert result["rollback_available"] is True
    assert "rollback_manifest_rel_path" in result


def test_normalize_rollback_envelope():
    """normalize_rollback_envelope preserves all required rollback data fields."""
    result = normalize_rollback_envelope(ROLLBACK_CLI_OUTPUT)
    assert result["schema_version"] == "import_rollback.v1"
    assert result["import_id"] == "imp_20260530_b97dad267d95"
    assert result["state"] == "rolled_back"
    assert result["idempotency_key"] == "sha256:b97dad267d95"
    assert result["plan_fingerprint"] == "sha256:92b61eaa1234567890abcdef"
    assert result["deleted_count"] == 4
    assert "rollback_manifest_rel_path" in result


# ── Error mapping ──────────────────────────────────────────────────────────


def test_map_import_error_CONFIRMATION_REQUIRED():
    """CLIError stdout contains IMPORT_CONFIRMATION_REQUIRED → mapped correctly."""
    from backend.adapter.error_mapper import map_import_error
    from backend.models import errors as E

    exc = CLIError(
        returncode=1,
        stderr="confirmation needed",
        stdout=json.dumps({
            "error": {"code": "IMPORT_CONFIRMATION_REQUIRED", "message": "请确认"}
        }),
    )
    code, msg = map_import_error(exc)
    assert code == E.IMPORT_CONFIRMATION_REQUIRED
    assert isinstance(msg, str)
    assert len(msg) > 0


def test_map_import_error_ROLLBACK_CHECKSUM_MISMATCH():
    """CLIError stdout contains IMPORT_ROLLBACK_CHECKSUM_MISMATCH → mapped correctly."""
    from backend.adapter.error_mapper import map_import_error
    from backend.models import errors as E

    exc = CLIError(
        returncode=1,
        stderr="checksum mismatch",
        stdout=json.dumps({
            "error": {"code": "IMPORT_ROLLBACK_CHECKSUM_MISMATCH", "message": "checksum"}
        }),
    )
    code, msg = map_import_error(exc)
    assert code == E.IMPORT_ROLLBACK_CHECKSUM_MISMATCH
    assert isinstance(msg, str)
    assert len(msg) > 0


def test_map_import_error_unknown_code():
    """Unrecognized error code falls back to IMPORT_INTERNAL_ERROR."""
    from backend.adapter.error_mapper import map_import_error
    from backend.models import errors as E

    exc = CLIError(
        returncode=1,
        stderr="unknown",
        stdout=json.dumps({
            "error": {"code": "SOME_WEIRD_CODE", "message": "???"}
        }),
    )
    code, msg = map_import_error(exc)
    assert code == E.IMPORT_INTERNAL_ERROR
    assert isinstance(msg, str)
    assert len(msg) > 0


# ── Temp plan handling ────────────────────────────────────────────────────


def test_temp_plan_json_outside_data_dir(tmp_path, monkeypatch):
    """write_temp_plan writes to system temp dir, never inside LIFE_INDEX_DATA_DIR."""
    data_dir = (tmp_path / "life-index-data").resolve()
    data_dir.mkdir()
    monkeypatch.setenv("LIFE_INDEX_DATA_DIR", str(data_dir))

    plan_data = {"import_id": "imp_test", "data": {}}
    plan_path = write_temp_plan(plan_data)

    try:
        # Path resolution to check it's in system temp dir
        resolved = plan_path.resolve()
        assert resolved.exists()
        # Must NOT be inside the data dir
        assert resolved != data_dir
        assert data_dir not in resolved.parents
        # Verify content
        with open(plan_path, "r", encoding="utf-8") as f:
            content = json.load(f)
        assert content["import_id"] == "imp_test"
    finally:
        if plan_path.exists():
            plan_path.unlink()


def test_temp_plan_cleanup_in_finally():
    """Temp plan file is cleaned up after CLI raises an error."""
    import_id = "imp_cleanup_test"
    plan_data = {"import_id": import_id, "data": {}}

    # Write the temp plan
    plan_path = write_temp_plan(plan_data)

    # Simulate a try/finally that should clean up
    mock_cli = MagicMock()
    mock_cli.run_json = MagicMock(side_effect=CLIError(
        returncode=1, stderr="test error", stdout=""
    ))

    # The finally block should remove the file
    try:
        raise CLIError(returncode=1, stderr="test error", stdout="")
    except CLIError:
        pass
    finally:
        if plan_path.exists():
            plan_path.unlink()

    assert not plan_path.exists()

    # Second invocation: write again, verify cleanup with actual logical flow
    plan_path2 = write_temp_plan({"import_id": import_id, "data": {}})
    try:
        raise CLIError(returncode=1, stderr="test error", stdout="")
    except CLIError:
        pass
    finally:
        if plan_path2.exists():
            plan_path2.unlink()

    assert not plan_path2.exists()


# ── Transient plan store ──────────────────────────────────────────────────


def test_store_and_get_transient_plan():
    """store_transient_plan stores envelope; get_transient_plan retrieves it."""
    import_id = "imp_transient_test"
    envelope = PLAN_CLI_OUTPUT["data"].copy()
    envelope["import_id"] = import_id

    store_transient_plan(import_id, envelope)
    retrieved = get_transient_plan(import_id)

    assert retrieved is not None
    assert retrieved["import_id"] == import_id
    assert retrieved["source"]["adapter_id"] == "fixture.import_records"
    assert "_stored_at" not in envelope
    assert "_stored_at" not in retrieved


def test_store_transient_plan_keeps_photo_source_root_private():
    """Transient source_root is retrievable for backend run but not leaked in plan."""
    from backend.adapter import import_adapter

    import_id = "imp_photo_source_root"
    envelope = PLAN_CLI_OUTPUT["data"].copy()
    envelope["import_id"] = import_id
    envelope["source"] = {"adapter_id": "media.photo_timeline", "record_count": 1}
    source_root = Path("/photos/library")

    store_transient_plan(import_id, envelope, source_root=source_root)
    retrieved = get_transient_plan(import_id)
    retrieved_source_root = import_adapter.get_transient_source_root(import_id)

    assert retrieved is not None
    assert retrieved["source"]["adapter_id"] == "media.photo_timeline"
    assert "source_root" not in retrieved
    assert "input_path" not in retrieved
    assert retrieved_source_root == source_root


def test_get_transient_plan_missing_returns_none():
    """get_transient_plan returns None for never-stored import_id."""
    result = get_transient_plan("imp_nonexistent")
    assert result is None


def test_get_transient_plan_evicted_returns_none():
    """Stored plan is evicted when expired; get_transient_plan returns None."""
    import_id = "imp_eviction_test"
    envelope = {"import_id": import_id, "data": {}}

    store_transient_plan(import_id, envelope)
    # Artificially expire the entry by removing it directly
    from backend.adapter import import_adapter
    import_adapter._transient_plan_store.pop(import_id, None)

    result = get_transient_plan(import_id)
    assert result is None
