"""Focused tests for structured CLI error envelope mapping."""

import json

import pytest

from backend.adapter.cli_adapter import CLIError
from backend.adapter.error_mapper import map_cli_error, map_import_error
from backend.models import errors as E


@pytest.mark.parametrize("status_field", ["ok", "success"])
def test_map_cli_error_rejects_positive_error_envelopes(status_field: str):
    """Only explicit negative envelopes may override fallback mapping."""
    stderr = json.dumps(
        {
            status_field: True,
            "error": {"code": "SHOULD_NOT_MAP", "message": "not an error envelope"},
        }
    )

    code, _message = map_cli_error(stderr)

    assert code == E.CLI_ERROR


@pytest.mark.parametrize("channel_name", ["stderr", "stdout"])
@pytest.mark.parametrize("code", ["CLI_VERSION_UNSUPPORTED", "CLI_VERSION_INVALID"])
def test_map_import_error_preserves_cli_version_error_from_negative_envelope(
    channel_name: str,
    code: str,
):
    """Version guard errors survive import routing from either CLI channel."""
    message = f"actionable {code.lower()} upgrade guidance"
    envelope = json.dumps(
        {
            "ok": False,
            "error": {"code": code, "message": message},
        }
    )
    exc = CLIError(
        returncode=2,
        stderr=envelope if channel_name == "stderr" else "not-json",
        stdout=envelope if channel_name == "stdout" else "",
    )

    mapped_code, mapped_message, mapped_details = map_import_error(exc)

    assert mapped_code == code
    assert mapped_message == message
    assert mapped_details is None  # version guard carries no recovery details


# ── M7 nested error.details → safe recovery facts ──────────────────────────


def _import_clierr(
    code: str, details: dict | None = None, *, message: str = "x", channel: str = "stdout"
) -> CLIError:
    """Build a CLIError whose channel carries a frozen-CLI-shaped negative envelope.

    The frozen CLI emits ``import_job.v1`` with ``error={code,message,details}``;
    safe recovery facts live under ``error.details`` (never beside ``code``).
    """
    envelope: dict = {
        "schema_version": "import_job.v1",
        "success": False,
        "ok": False,
        "command": "import.review",
        "data": None,
        "error": {"code": code, "message": message},
    }
    if details is not None:
        envelope["error"]["details"] = details
    payload = json.dumps(envelope)
    return CLIError(
        returncode=1,
        stderr=payload if channel == "stderr" else "not-json",
        stdout=payload if channel == "stdout" else "",
    )


def test_already_staged_surfaces_existing_import_id_and_strips_identity():
    """Duplicate stage surfaces existing_import_id so the GUI can resume; the
    source-root identity hash is stripped (no hash leakage)."""
    exc = _import_clierr(
        "IMPORT_REVIEW_ALREADY_STAGED",
        {
            "import_id": "imp_p1",
            "existing_import_id": "imp_p0",
            "source_root_identity": "sha256:SECRET_IDENTITY",
        },
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_REVIEW_ALREADY_STAGED
    assert details["existing_import_id"] == "imp_p0"
    assert details["reason"] == "already_staged"
    dumped = json.dumps(details)
    assert "sha256:SECRET_IDENTITY" not in dumped


def test_revision_conflict_surfaces_current_queue_revision_as_strict_int():
    """Revision conflict surfaces current_queue_revision so the GUI can refetch."""
    exc = _import_clierr(
        "IMPORT_REVIEW_REVISION_CONFLICT",
        {
            "import_id": "imp_p1",
            "expected_queue_revision": 3,
            "current_queue_revision": 5,
        },
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_REVIEW_REVISION_CONFLICT
    assert details["current_queue_revision"] == 5
    assert isinstance(details["current_queue_revision"], int)
    assert details["expected_queue_revision"] == 3
    assert details["reason"] == "revision_conflict"


def test_batch_already_active_surfaces_active_child_id():
    """An active child batch surfaces active_child_id (verbatim, '#' preserved)."""
    exc = _import_clierr(
        "IMPORT_BATCH_ALREADY_ACTIVE",
        {"import_id": "imp_p1", "active_child_id": "imp_p1#batch-1"},
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_BATCH_ALREADY_ACTIVE
    assert details["active_child_id"] == "imp_p1#batch-1"
    assert details["reason"] == "batch_active"


def test_recovery_required_surfaces_bool_and_authority_status():
    """Recovery-required surfaces recovery_required(bool) + authority_status."""
    exc = _import_clierr(
        "IMPORT_REVIEW_RECOVERY_REQUIRED",
        {
            "import_id": "imp_p1",
            "recovery_required": True,
            "authority_status": "plan_ledger_mismatch",
        },
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_REVIEW_RECOVERY_REQUIRED
    assert details["recovery_required"] is True
    assert details["authority_status"] == "plan_ledger_mismatch"
    assert details["reason"] == "recovery_required"


def test_rollback_interrupted_preserves_only_safe_retry_facts():
    """A caught partial rollback stays explicit and strips CLI locator/error text."""
    exc = _import_clierr(
        "IMPORT_ROLLBACK_INTERRUPTED",
        {
            "import_id": "imp_p1#batch-2",
            "deleted_count": 1,
            "reason": "filesystem_delete_failed",
            "path": "C:/private/photos/secret.jpg",
            "error": "arbitrary filesystem diagnostics",
        },
    )

    code, message, details = map_import_error(exc)

    assert code == "IMPORT_ROLLBACK_INTERRUPTED"
    assert message == "回滚已中断，恢复状态已保留，可重试"
    assert details == {
        "import_id": "imp_p1#batch-2",
        "deleted_count": 1,
        "reason": "rollback_interrupted",
    }
    assert isinstance(details["deleted_count"], int)


@pytest.mark.parametrize("unsafe_count", [True, "1", 1.0])
def test_rollback_interrupted_rejects_non_integer_deleted_count(unsafe_count):
    exc = _import_clierr(
        "IMPORT_ROLLBACK_INTERRUPTED",
        {"import_id": "imp_p1#batch-2", "deleted_count": unsafe_count},
    )

    code, _message, details = map_import_error(exc)

    assert code == "IMPORT_ROLLBACK_INTERRUPTED"
    assert details == {
        "import_id": "imp_p1#batch-2",
        "reason": "rollback_interrupted",
    }


def test_preview_unavailable_strips_locators_and_hashes():
    """Preview-unavailable keeps only safe ids; source path/hashes/reason stripped."""
    exc = _import_clierr(
        "IMPORT_PREVIEW_UNAVAILABLE",
        {
            "import_id": "imp_p1",
            "attachment_id": "att_aaaaaaaaaaaa",
            "proposal_id": "prop_xxxxxxxxxxxx",
            "source_rel_path": "photos/secret/IMG_0001.jpg",
            "expected": "sha256:DEADBEEF",
            "actual": "sha256:CAFEBABE",
            "reason": "stale",
        },
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_PREVIEW_UNAVAILABLE
    assert details.get("attachment_id") == "att_aaaaaaaaaaaa"
    assert details.get("proposal_id") == "prop_xxxxxxxxxxxx"
    dumped = json.dumps(details)
    assert "IMG_0001.jpg" not in dumped
    assert "sha256:DEADBEEF" not in dumped
    assert "sha256:CAFEBABE" not in dumped
    assert "stale" not in dumped


def test_identity_mismatch_strips_expected_actual_hashes():
    """Identity mismatch keeps no expected/actual hashes; only the closed reason."""
    exc = _import_clierr(
        "IMPORT_SOURCE_ROOT_IDENTITY_MISMATCH",
        {"import_id": "imp_p1", "expected": "sha256:A", "actual": "sha256:B"},
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_SOURCE_ROOT_IDENTITY_MISMATCH
    dumped = json.dumps(details)
    assert "sha256:A" not in dumped
    assert "sha256:B" not in dumped
    assert details["reason"] == "identity_mismatch"


def test_queue_counts_preserved_as_strict_integers():
    """queue_counts are preserved only as strict integer counts."""
    exc = _import_clierr(
        "IMPORT_BATCH_ALREADY_ACTIVE",
        {
            "import_id": "imp_p1",
            "active_child_id": "imp_p1#batch-2",
            "queue_counts": {"pending": 2, "confirmed": "3", "imported": True},
        },
    )
    _code, _msg, details = map_import_error(exc)

    qc = details["queue_counts"]
    assert qc["pending"] == 2
    # Non-integer values ("3" str, True bool) are dropped, never coerced.
    assert "confirmed" not in qc
    assert "imported" not in qc


@pytest.mark.parametrize(
    ("code", "reason"),
    [
        ("IMPORT_REVIEW_ALREADY_STAGED", "already_staged"),
        ("IMPORT_REVIEW_REVISION_CONFLICT", "revision_conflict"),
        ("IMPORT_REVIEW_RECOVERY_REQUIRED", "recovery_required"),
        ("IMPORT_REVIEW_PROPOSAL_FROZEN", "proposal_frozen"),
        ("IMPORT_REVIEW_EDIT_INVALID", "edit_invalid"),
        ("IMPORT_REVIEW_PLAN_MISSING", "plan_missing"),
        ("IMPORT_SOURCE_ROOT_UNREADABLE", "source_root_unreadable"),
        ("IMPORT_SOURCE_ROOT_IDENTITY_MISMATCH", "identity_mismatch"),
        ("IMPORT_PREVIEW_UNAVAILABLE", "preview_unavailable"),
        ("IMPORT_BATCH_ALREADY_ACTIVE", "batch_active"),
        ("IMPORT_NO_RUNNABLE_PROPOSALS", "no_runnable"),
        ("IMPORT_RECOVERY_REQUIRED", "recovery_required"),
        ("IMPORT_ROLLBACK_PARENT_NOT_ALLOWED", "rollback_parent_not_allowed"),
        ("IMPORT_ROLLBACK_INTERRUPTED", "rollback_interrupted"),
    ],
)
def test_every_mandatory_code_maps_to_itself_with_closed_reason(code, reason):
    """Every mandatory CLI code maps to its own GUI code with a stable reason."""
    exc = _import_clierr(code, {})
    mapped_code, _msg, details = map_import_error(exc)

    assert mapped_code == code
    assert details["reason"] == reason


def test_proposal_frozen_surfaces_proposal_id_and_state():
    """A frozen proposal surfaces its proposal_id + frozen state."""
    exc = _import_clierr(
        "IMPORT_REVIEW_PROPOSAL_FROZEN",
        {"import_id": "imp_p1", "proposal_id": "prop_froz", "state": "imported"},
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_REVIEW_PROPOSAL_FROZEN
    assert details["proposal_id"] == "prop_froz"
    assert details["reason"] == "proposal_frozen"


def test_no_runnable_proposals_strips_proposal_id_arrays():
    """No-runnable strips the stale/skipped proposal-id arrays (only import_id)."""
    exc = _import_clierr(
        "IMPORT_NO_RUNNABLE_PROPOSALS",
        {"import_id": "imp_p1", "stale": ["prop_a", "prop_b"], "skipped": ["prop_c"]},
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_NO_RUNNABLE_PROPOSALS
    dumped = json.dumps(details)
    assert "prop_a" not in dumped
    assert details["reason"] == "no_runnable"


def test_argparse_invalid_choice_maps_to_feature_unavailable():
    """An argparse exit (code 2, invalid choice / unrecognized) → CLI_FEATURE_UNAVAILABLE."""
    exc = CLIError(
        returncode=2,
        stderr=(
            "usage: life-index import ...\n"
            "life-index import: error: argument {subcommand}: invalid choice: "
            "'validate' (choose from 'plan', 'run', 'status', 'rollback')"
        ),
        stdout="",
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.CLI_FEATURE_UNAVAILABLE
    assert details["reason"] == "feature_unavailable"


def test_argparse_unrecognized_argument_maps_to_feature_unavailable():
    """An unrecognized-argument argparse failure (code 2) → CLI_FEATURE_UNAVAILABLE."""
    exc = CLIError(
        returncode=2,
        stderr="life-index import stage: error: unrecognized arguments: --source-root",
        stdout="",
    )
    code, _msg, details = map_import_error(exc)

    assert code == E.CLI_FEATURE_UNAVAILABLE


def test_legacy_code_carries_no_details():
    """Legacy import codes retain their existing behaviour: code + message, no details."""
    exc = _import_clierr("IMPORT_CONFIRMATION_REQUIRED", None, message="请确认")
    code, msg, details = map_import_error(exc)

    assert code == E.IMPORT_CONFIRMATION_REQUIRED
    assert isinstance(msg, str) and msg
    assert details is None


def test_unknown_code_falls_back_to_internal_with_no_details():
    """An unrecognized code still falls back to IMPORT_INTERNAL_ERROR."""
    exc = _import_clierr("SOME_WEIRD_CODE", {})
    code, _msg, details = map_import_error(exc)

    assert code == E.IMPORT_INTERNAL_ERROR
    assert details is None
