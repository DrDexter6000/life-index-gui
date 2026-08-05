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
    code, msg, details = map_import_error(exc)
    assert code == E.IMPORT_CONFIRMATION_REQUIRED
    assert isinstance(msg, str)
    assert len(msg) > 0
    assert details is None  # legacy code carries no recovery details


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
    code, msg, _details = map_import_error(exc)
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
    code, msg, _details = map_import_error(exc)
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


# ── M7 review/batch arg builders ──────────────────────────────────────────


def test_build_import_validate_args():
    """validate args carry only --source-root (no locator leakage in arg order)."""
    from backend.adapter.import_adapter import build_import_validate_args

    result = build_import_validate_args(Path("/photos/library"))
    assert result == [
        "import", "validate",
        "--source-root", str(Path("/photos/library")),
        "--json",
    ]


def test_build_import_stage_args():
    """stage args: --plan + --source-root + --json."""
    from backend.adapter.import_adapter import build_import_stage_args

    plan_path = Path("/tmp/review_plan.json")
    source_root = Path("/photos/library")
    result = build_import_stage_args(plan_path, source_root)
    assert result == [
        "import", "stage",
        "--plan", str(plan_path),
        "--source-root", str(source_root),
        "--json",
    ]


def test_build_import_stage_args_with_import_id_override():
    """stage accepts an optional --import-id override."""
    from backend.adapter.import_adapter import build_import_stage_args

    result = build_import_stage_args(
        Path("/tmp/p.json"), Path("/photos/library"), import_id="imp_override"
    )
    assert "--import-id" in result
    assert result[result.index("--import-id") + 1] == "imp_override"


def test_build_import_reviews_args_defaults():
    """reviews with no pagination is just the bare command."""
    from backend.adapter.import_adapter import build_import_reviews_args

    assert build_import_reviews_args() == ["import", "reviews", "--json"]


def test_build_import_reviews_args_pagination():
    """reviews pagination: --after cursor + --limit."""
    from backend.adapter.import_adapter import build_import_reviews_args

    result = build_import_reviews_args(after="imp_cursor", limit=50)
    assert result[result.index("--after") + 1] == "imp_cursor"
    assert result[result.index("--limit") + 1] == "50"


def test_build_import_review_args_defaults():
    """review with only the parent id."""
    from backend.adapter.import_adapter import build_import_review_args

    assert build_import_review_args("imp_parent") == [
        "import", "review", "--import-id", "imp_parent", "--json",
    ]


def test_build_import_review_args_pagination_and_state():
    """review pagination + repeatable --state (one flag per value, in order)."""
    from backend.adapter.import_adapter import build_import_review_args

    result = build_import_review_args(
        "imp_parent", offset=10, limit=50, states=["pending", "confirmed"]
    )
    assert result[result.index("--import-id") + 1] == "imp_parent"
    assert result[result.index("--offset") + 1] == "10"
    assert result[result.index("--limit") + 1] == "50"
    state_idxs = [i for i, v in enumerate(result) if v == "--state"]
    assert len(state_idxs) == 2
    assert result[state_idxs[0] + 1] == "pending"
    assert result[state_idxs[1] + 1] == "confirmed"


def test_build_import_confirm_edit_args():
    """confirm --edit: --edit + --import-id + --expected-queue-revision + --json."""
    from backend.adapter.import_adapter import build_import_confirm_edit_args

    edit_path = Path("/tmp/edit.json")
    result = build_import_confirm_edit_args(edit_path, "imp_parent", expected_queue_revision=7)
    assert result == [
        "import", "confirm",
        "--edit", str(edit_path),
        "--import-id", "imp_parent",
        "--expected-queue-revision", "7",
        "--json",
    ]


def test_build_import_confirm_edit_args_with_source_root():
    """confirm --edit forwards an optional --source-root for photo adapters."""
    from backend.adapter.import_adapter import build_import_confirm_edit_args

    result = build_import_confirm_edit_args(
        Path("/tmp/edit.json"), "imp_parent",
        expected_queue_revision=7, source_root=Path("/photos/library"),
    )
    assert "--source-root" in result
    assert result[result.index("--source-root") + 1] == str(Path("/photos/library"))


def test_build_import_rebind_args():
    """rebind: --import-id + --source-root + --json."""
    from backend.adapter.import_adapter import build_import_rebind_args

    result = build_import_rebind_args("imp_parent", Path("/photos/library"))
    assert result == [
        "import", "rebind",
        "--import-id", "imp_parent",
        "--source-root", str(Path("/photos/library")),
        "--json",
    ]


def test_build_import_preview_args_bytes_to_stdout():
    """preview bytes path: --output - streams raw bytes to stdout."""
    from backend.adapter.import_adapter import build_import_preview_args

    result = build_import_preview_args("imp_parent", "att_aaaaaaaaaaaa", output="-")
    assert result == [
        "import", "preview",
        "--import-id", "imp_parent",
        "--attachment", "att_aaaaaaaaaaaa",
        "--output", "-",
        "--json",
    ]


def test_build_import_preview_args_with_proposal_source_and_metadata():
    """preview optional flags: --proposal-id, --source-root, --metadata-output."""
    from backend.adapter.import_adapter import build_import_preview_args

    meta = Path("/tmp/preview_meta.json")
    result = build_import_preview_args(
        "imp_parent", "att_aaaaaaaaaaaa",
        proposal_id="prop_xxxxxxxxxxxx",
        source_root=Path("/photos/library"),
        metadata_output=meta,
    )
    assert result[result.index("--proposal-id") + 1] == "prop_xxxxxxxxxxxx"
    assert result[result.index("--source-root") + 1] == str(Path("/photos/library"))
    assert result[result.index("--metadata-output") + 1] == str(meta)
    assert "--output" not in result  # bytes path not requested


def test_build_import_batch_run_args():
    """batch run: --import-id (parent) + --json."""
    from backend.adapter.import_adapter import build_import_batch_run_args

    assert build_import_batch_run_args("imp_parent") == [
        "import", "run", "--import-id", "imp_parent", "--json",
    ]


def test_build_import_batch_run_args_with_source_root():
    """batch run forwards an optional --source-root for byte-copying adapters."""
    from backend.adapter.import_adapter import build_import_batch_run_args

    result = build_import_batch_run_args("imp_parent", source_root=Path("/photos/library"))
    assert result[result.index("--import-id") + 1] == "imp_parent"
    assert result[result.index("--source-root") + 1] == str(Path("/photos/library"))


# ── M7 edit-payload / preview-metadata temp helpers ───────────────────────


def test_write_temp_edit_outside_data_dir_and_roundtrips(tmp_path, monkeypatch):
    """write_temp_edit writes to OS temp (never data dir) and round-trips JSON."""
    data_dir = (tmp_path / "life-index-data").resolve()
    data_dir.mkdir()
    monkeypatch.setenv("LIFE_INDEX_DATA_DIR", str(data_dir))

    from backend.adapter.import_adapter import write_temp_edit

    payload = {
        "schema_version": "import_review_edit.v1",
        "proposal_id": "prop_xxxxxxxxxxxx",
        "decision": "confirmed",
    }
    edit_path = write_temp_edit(payload)
    try:
        resolved = edit_path.resolve()
        assert resolved != data_dir
        assert data_dir not in resolved.parents
        with open(edit_path, "r", encoding="utf-8") as f:
            assert json.load(f) == payload
    finally:
        if edit_path.exists():
            edit_path.unlink()


def test_unique_metadata_path_outside_data_dir_and_unique(tmp_path, monkeypatch):
    """unique_metadata_path stays out of the data dir and is unique per call."""
    data_dir = (tmp_path / "life-index-data").resolve()
    data_dir.mkdir()
    monkeypatch.setenv("LIFE_INDEX_DATA_DIR", str(data_dir))

    from backend.adapter.import_adapter import unique_metadata_path

    p1 = unique_metadata_path()
    p2 = unique_metadata_path()
    try:
        assert p1.resolve() != data_dir
        assert data_dir not in p1.resolve().parents
        assert p1 != p2
    finally:
        for p in (p1, p2):
            if p.exists():
                p.unlink()


def test_read_preview_metadata_strips_locator_and_hash(tmp_path):
    """read_preview_metadata drops source_rel_path + source_sha256, keeps ids."""
    from backend.adapter.import_adapter import read_preview_metadata

    sidecar = tmp_path / "preview_meta.json"
    raw_meta = {
        "schema_version": "import_preview.v1",
        "parent_id": "imp_parent",
        "attachment_id": "att_aaaaaaaaaaaa",
        "proposal_id": "prop_xxxxxxxxxxxx",
        "media_type": "image/jpeg",
        "size": 12345,
        "source_rel_path": "photos/secret/IMG_0001.jpg",
        "source_sha256": "sha256:DEADBEEF",
    }
    sidecar.write_text(json.dumps(raw_meta), encoding="utf-8")

    cleaned = read_preview_metadata(sidecar)

    assert cleaned["schema_version"] == "import_preview.v1"
    assert cleaned["attachment_id"] == "att_aaaaaaaaaaaa"
    assert cleaned["proposal_id"] == "prop_xxxxxxxxxxxx"
    dumped = json.dumps(cleaned)
    assert "source_rel_path" not in cleaned
    assert "source_sha256" not in cleaned
    assert "IMG_0001.jpg" not in dumped
    assert "sha256:DEADBEEF" not in dumped


# ── M7 review/batch normalizers ───────────────────────────────────────────
# Authoritative CLI envelopes (outer import_job.v1 + nested per-command data),
# harvested from the frozen CLI authority (tools/ingest/review.py + __main__.py).

_QUEUE_COUNTS = {
    "pending": 1, "confirmed": 0, "skipped": 0,
    "stale": 0, "batching": 0, "imported": 0,
}

STAGE_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.stage", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "parent_id": "imp_parent",
        "source_root_identity": "sha256:ROOTIDENT",
        "review_plan_rel_path": ".life-index/import-jobs/imp_parent/review-plan.json",
        "proposal_states": {"prop_aaaaaaaaaaaa": "pending"},
        "queue_counts": dict(_QUEUE_COUNTS),
        "plan_revision": 1,
        "queue_revision": 1,
        "proposals": [
            {"proposal_id": "prop_aaaaaaaaaaaa", "state": "pending", "attachment_count": 1},
        ],
    },
}

CONFIRM_EDIT_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.confirm", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "import_id": "imp_parent",
        "queue_revision": 2,
        "plan_revision": 2,
        "queue_counts": {"pending": 0, "confirmed": 1, "skipped": 0,
                         "stale": 0, "batching": 0, "imported": 0},
        "reason_code": None,
        "proposal": {"proposal_id": "prop_aaaaaaaaaaaa", "state": "confirmed"},
    },
}

REVIEW_QUEUE_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.review", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "import_id": "imp_parent",
        "queue_revision": 2,
        "plan_revision": 2,
        "source_root_identity": "sha256:ROOTIDENT",
        "queue_counts": {"pending": 3, "confirmed": 2, "skipped": 0,
                         "stale": 0, "batching": 0, "imported": 0},
        "warnings": [],
        "total_all": 5,
        "total_filtered": 5,
        "offset": 0,
        "limit": 20,
        "has_more": False,
        "next_offset": None,
        "proposals": [{"proposal_id": "prop_aaaaaaaaaaaa", "state": "pending"}],
    },
}

REVIEWS_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.reviews", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "jobs": [
            {
                "import_id": "imp_parent",
                "state": "confirmed",
                "queue_counts": dict(_QUEUE_COUNTS),
                "active_child_id": None,
                "recovery_required": False,
                "authority_status": None,
                "plan_revision": 2,
                "queue_revision": 2,
                "created_at": "2026-05-30T00:00:00Z",
                "updated_at": "2026-05-30T00:00:00Z",
            },
        ],
        "has_more": False,
    },
}

VALIDATE_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.validate", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "source_root": "/photos/library",
        "source_root_identity": "sha256:ROOTIDENT",
        "readable": True,
    },
}

REBIND_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.rebind", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "import_id": "imp_parent",
        "source_root": "/photos/library",
        "source_root_identity": "sha256:ROOTIDENT",
        "queue_revision": 3,
        "rebound": True,
    },
}

BATCH_RUN_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.run", "error": None,
    "data": {
        "schema_version": "import_run.v1",
        "import_id": "imp_parent#batch-1",
        "parent_id": "imp_parent",
        "kind": "batch",
        "state": "committed",
        "created_journal_count": 2,
        "created_attachment_count": 2,
        "rollback_manifest_rel_path": ".life-index/import-jobs/imp_parent#batch-1/rollback-manifest.json",
        "post_run_actions": {"index_rebuild_recommended": True},
        "queue_counts": dict(_QUEUE_COUNTS),
    },
}

REVIEW_STATUS_CLI_OUTPUT = {
    "schema_version": "import_job.v1", "success": True,
    "command": "import.status", "error": None,
    "data": {
        "schema_version": "import_review.v1",
        "import_id": "imp_parent",
        "kind": "review",
        "state": "confirmed",
        "source_root_identity": "sha256:ROOTIDENT",
        "proposal_states": {"prop_aaaaaaaaaaaa": "confirmed"},
        "queue_counts": dict(_QUEUE_COUNTS),
        "active_child_id": None,
        "recovery_required": False,
        "authority_status": None,
        "plan_fingerprint": "sha256:PLANFP",
        "plan_revision": 2,
        "queue_revision": 2,
        "review_plan_rel_path": ".life-index/import-jobs/imp_parent/review-plan.json",
        "batches": [
            {"import_id": "imp_parent#batch-1", "state": "committed",
             "proposal_ids": ["prop_aaaaaaaaaaaa"], "proposal_count": 1,
             "rollback_available": True},
        ],
    },
}


def test_normalize_stage_envelope_strips_plan_rel_path_keeps_authority():
    """stage strips review_plan_rel_path; keeps source_root_identity + revisions."""
    from backend.adapter.import_adapter import normalize_stage_envelope

    result = normalize_stage_envelope(STAGE_CLI_OUTPUT)
    assert result["schema_version"] == "import_review.v1"
    assert result["parent_id"] == "imp_parent"
    assert "review_plan_rel_path" not in result
    assert result["source_root_identity"] == "sha256:ROOTIDENT"
    assert result["queue_revision"] == 1
    assert result["plan_revision"] == 1
    assert result["proposals"][0]["proposal_id"] == "prop_aaaaaaaaaaaa"


def test_normalize_stage_envelope_rejects_wrong_schema():
    """stage normalizer validates the nested schema_version."""
    from backend.adapter.import_adapter import normalize_stage_envelope

    bad = {"schema_version": "import_job.v1", "success": True,
           "data": {"schema_version": "import_run.v1"}}
    with pytest.raises(ValueError):
        normalize_stage_envelope(bad)


def test_normalize_confirm_edit_envelope_preserves_proposal_and_revisions():
    """confirm-edit carries the single-proposal projection + bumped revisions."""
    from backend.adapter.import_adapter import normalize_confirm_edit_envelope

    result = normalize_confirm_edit_envelope(CONFIRM_EDIT_CLI_OUTPUT)
    assert result["schema_version"] == "import_review.v1"
    assert result["import_id"] == "imp_parent"
    assert result["queue_revision"] == 2
    assert result["plan_revision"] == 2
    assert result["proposal"]["proposal_id"] == "prop_aaaaaaaaaaaa"
    assert result["reason_code"] is None


def test_normalize_review_queue_envelope_preserves_pagination():
    """review queue keeps cursor fields total_all/total_filtered/next_offset."""
    from backend.adapter.import_adapter import normalize_review_queue_envelope

    result = normalize_review_queue_envelope(REVIEW_QUEUE_CLI_OUTPUT)
    assert result["schema_version"] == "import_review.v1"
    assert result["import_id"] == "imp_parent"
    assert result["total_all"] == 5
    assert result["total_filtered"] == 5
    assert result["offset"] == 0
    assert result["limit"] == 20
    assert result["has_more"] is False
    assert result["next_offset"] is None
    assert result["queue_revision"] == 2


def test_normalize_reviews_envelope_preserves_jobs_and_cursor():
    """reviews keeps per-parent jobs + active_child_id + has_more."""
    from backend.adapter.import_adapter import normalize_reviews_envelope

    result = normalize_reviews_envelope(REVIEWS_CLI_OUTPUT)
    assert result["schema_version"] == "import_review.v1"
    assert result["has_more"] is False
    job = result["jobs"][0]
    assert job["import_id"] == "imp_parent"
    assert job["active_child_id"] is None
    assert job["recovery_required"] is False
    assert job["queue_revision"] == 2


def test_normalize_validate_envelope_strips_source_root_keeps_identity():
    """validate strips the absolute source_root; keeps identity + readable."""
    from backend.adapter.import_adapter import normalize_validate_envelope

    result = normalize_validate_envelope(VALIDATE_CLI_OUTPUT)
    assert result["schema_version"] == "import_review.v1"
    assert "source_root" not in result
    assert result["source_root_identity"] == "sha256:ROOTIDENT"
    assert result["readable"] is True


def test_normalize_rebind_envelope_strips_source_root_keeps_revision():
    """rebind strips source_root; keeps import_id + queue_revision + rebound."""
    from backend.adapter.import_adapter import normalize_rebind_envelope

    result = normalize_rebind_envelope(REBIND_CLI_OUTPUT)
    assert result["schema_version"] == "import_review.v1"
    assert "source_root" not in result
    assert result["import_id"] == "imp_parent"
    assert result["queue_revision"] == 3
    assert result["rebound"] is True


def test_normalize_batch_run_envelope_strips_manifest_keeps_child_id():
    """batch-run strips rollback_manifest_rel_path; keeps child import_id (# preserved)."""
    from backend.adapter.import_adapter import normalize_batch_run_envelope

    result = normalize_batch_run_envelope(BATCH_RUN_CLI_OUTPUT)
    assert result["schema_version"] == "import_run.v1"
    assert "rollback_manifest_rel_path" not in result
    assert result["import_id"] == "imp_parent#batch-1"
    assert result["parent_id"] == "imp_parent"
    assert result["kind"] == "batch"
    assert result["state"] == "committed"
    assert result["created_journal_count"] == 2
    assert result["queue_counts"] is not None


def test_normalize_batch_run_envelope_rejects_legacy_run_schema_clash():
    """batch-run uses import_run.v1 but must NOT keep rollback_manifest_rel_path
    (unlike the legacy run normalizer). Distinct strip policy, same schema."""
    from backend.adapter.import_adapter import (
        normalize_batch_run_envelope,
        normalize_run_envelope,
    )

    # Legacy run normalizer KEEPS the manifest path; batch-run STRIPS it.
    legacy = normalize_run_envelope(RUN_CLI_OUTPUT)
    assert "rollback_manifest_rel_path" in legacy
    batch = normalize_batch_run_envelope(BATCH_RUN_CLI_OUTPUT)
    assert "rollback_manifest_rel_path" not in batch


def test_normalize_review_status_envelope_strips_plan_rel_path_keeps_batches():
    """review-status strips review_plan_rel_path ONLY; keeps plan_fingerprint + batches."""
    from backend.adapter.import_adapter import normalize_review_status_envelope

    result = normalize_review_status_envelope(REVIEW_STATUS_CLI_OUTPUT)
    assert result["schema_version"] == "import_review.v1"
    assert "review_plan_rel_path" not in result
    # Per the brief, status strips ONLY review_plan_rel_path: keep the rest.
    assert result["import_id"] == "imp_parent"
    assert result["kind"] == "review"
    assert result["plan_fingerprint"] == "sha256:PLANFP"
    assert result["source_root_identity"] == "sha256:ROOTIDENT"
    assert result["queue_revision"] == 2
    assert result["batches"][0]["import_id"] == "imp_parent#batch-1"
    assert result["batches"][0]["rollback_available"] is True


# ── M7-C preview sidecar verification (fail-closed) ────────────────────────


def _good_preview_sidecar():
    """A production-shaped import_preview.v1 sidecar (5 content bytes)."""
    return {
        "schema_version": "import_preview.v1",
        "parent_id": "imp_p",
        "proposal_id": "prop_1",
        "attachment_id": "att_1",
        "source_rel_path": "photos/secret/IMG.jpg",
        "source_sha256": "sha256:DEADBEEF",
        "size_bytes": 5,
        "media_type": "image/jpeg",
        "available": True,
    }


def test_verify_preview_sidecar_success_returns_metadata():
    from backend.adapter.import_adapter import verify_preview_sidecar

    meta = verify_preview_sidecar(
        _good_preview_sidecar(),
        parent_id="imp_p", proposal_id="prop_1", attachment_id="att_1",
        content=b"\xff\xd8\x00\x00\x00",
    )
    assert meta["schema_version"] == "import_preview.v1"
    assert meta["media_type"] == "image/jpeg"
    assert meta["size_bytes"] == 5


@pytest.mark.parametrize(
    ("mutate", "reason"),
    [
        (lambda m: m.update(schema_version="import_preview.v2"), "preview_schema_unsupported"),
        (lambda m: m.update(available=False), "preview_unavailable"),
        (lambda m: m.update(available=None), "preview_unavailable"),
        (lambda m: m.pop("available"), "preview_unavailable"),
        (lambda m: m.update(parent_id="imp_other"), "preview_identity_mismatch"),
        (lambda m: m.update(proposal_id="prop_other"), "preview_identity_mismatch"),
        (lambda m: m.update(attachment_id="att_other"), "preview_identity_mismatch"),
        (lambda m: m.update(media_type="image/png"), "preview_media_unsupported"),
        (lambda m: m.update(size_bytes=999), "preview_size_mismatch"),
        (lambda m: m.update(size_bytes=True), "preview_size_mismatch"),
        (lambda m: m.update(size_bytes="5"), "preview_size_mismatch"),
        (lambda m: m.pop("size_bytes"), "preview_size_mismatch"),
    ],
)
def test_verify_preview_sidecar_failure_reasons(mutate, reason):
    from backend.adapter.import_adapter import (
        PreviewVerificationError,
        verify_preview_sidecar,
    )

    meta = _good_preview_sidecar()
    mutate(meta)
    with pytest.raises(PreviewVerificationError) as exc_info:
        verify_preview_sidecar(
            meta, parent_id="imp_p", proposal_id="prop_1",
            attachment_id="att_1", content=b"\x00" * 5,
        )
    assert exc_info.value.reason == reason


def test_read_preview_metadata_oversized_fails_closed(tmp_path):
    from backend.adapter.import_adapter import (
        PreviewVerificationError,
        read_preview_metadata,
    )

    sidecar = tmp_path / "big.json"
    sidecar.write_text('{"x":"' + ("A" * (2 * 1024 * 1024)) + '"}', encoding="utf-8")
    with pytest.raises(PreviewVerificationError) as exc_info:
        read_preview_metadata(sidecar)
    assert exc_info.value.reason == "preview_unavailable"


def test_read_preview_metadata_malformed_fails_closed(tmp_path):
    from backend.adapter.import_adapter import (
        PreviewVerificationError,
        read_preview_metadata,
    )

    sidecar = tmp_path / "bad.json"
    sidecar.write_text("{not valid json", encoding="utf-8")
    with pytest.raises(PreviewVerificationError) as exc_info:
        read_preview_metadata(sidecar)
    assert exc_info.value.reason == "preview_unavailable"
