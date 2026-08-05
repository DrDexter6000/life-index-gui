"""Import router — plan/run/status/rollback endpoints.

All import operations are CLI-mediated through the ``life-index import``
command family.  The GUI backend handles only:
- building CLI arguments
- calling the CLI adapter
- normalizing CLI JSON envelopes into the GUI contract shape
- transient in-memory plan storage with TTL eviction

It must NOT perform direct durable writes, rollback manifest reads, or
backdoor user-data access.
"""

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.adapter.error_mapper import M7_IMPORT_ERROR_MESSAGES, map_import_error
from backend.adapter.import_adapter import (
    build_import_plan_args,
    build_import_run_args,
    build_import_status_args,
    build_import_rollback_args,
    build_import_validate_args,
    build_import_stage_args,
    build_import_confirm_edit_args,
    build_import_rebind_args,
    build_import_batch_run_args,
    build_import_preview_args,
    build_import_reviews_args,
    build_import_review_args,
    get_transient_source_root,
    get_transient_plan,
    normalize_plan_envelope,
    normalize_rollback_envelope,
    normalize_run_envelope,
    normalize_status_envelope,
    normalize_validate_envelope,
    normalize_stage_envelope,
    normalize_confirm_edit_envelope,
    normalize_rebind_envelope,
    normalize_batch_run_envelope,
    normalize_reviews_envelope,
    normalize_review_queue_envelope,
    normalize_review_status_envelope,
    store_transient_plan,
    write_temp_plan,
    write_temp_edit,
    unique_metadata_path,
    read_preview_metadata,
    verify_preview_sidecar,
    PreviewVerificationError,
)
from backend.models import errors as E
from backend.models.response import APIResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["imports"])

# One shared CLIAdapter so the per-instance write lock and the positive
# compatibility-probe TTL span requests (M7 contract). Test code overrides the
# ``get_cli`` dependency instead of populating this.
_shared_cli: CLIAdapter | None = None


def get_cli() -> CLIAdapter:
    global _shared_cli
    if _shared_cli is None:
        _shared_cli = CLIAdapter()
    return _shared_cli


def _cli_meta(raw: dict[str, Any]) -> dict[str, Any]:
    """Expose stable CLI top-level envelope fields without renaming them."""
    return {
        "schema_version": raw.get("schema_version"),
        "command": raw.get("command"),
    }


# ── Request models ─────────────────────────────────────────────────────────


class PlanRequest(BaseModel):
    source: str
    input_path: str


class RunRequest(BaseModel):
    import_id: str
    # plan_path is intentionally EXCLUDED — the backend manages temp plan
    # files internally from the transient store.  The frontend must never
    # supply a plan_path.
    model_config = {"extra": "forbid"}


# ── POST /api/imports/plan ────────────────────────────────────────────────


@router.post("/imports/plan")
async def import_plan(
    body: PlanRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """Plan an import: call ``life-index import plan`` and return the
    normalized plan envelope.

    The envelope is stored in the transient in-memory store so the
    subsequent ``run`` call can materialize the plan JSON.
    """
    args = build_import_plan_args(body.source, Path(body.input_path))

    try:
        raw = await cli.run_json(args)
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    if not isinstance(raw, dict):
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的导入计划数据"
        )

    try:
        envelope = normalize_plan_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR,
            f"无法解析 CLI 导入计划结果: {exc}",
        )

    import_id = envelope.get("import_id", "")
    if import_id:
        source = envelope.get("source")
        adapter_id = source.get("adapter_id") if isinstance(source, dict) else None
        source_root = Path(body.input_path) if adapter_id == "media.photo_timeline" else None
        store_transient_plan(import_id, envelope, source_root=source_root)

    return APIResponse.success(envelope, meta=_cli_meta(raw))


# ── POST /api/imports/run ─────────────────────────────────────────────────


@router.post("/imports/run")
async def import_run(
    body: RunRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """Run a confirmed import: look up the transient plan, materialize a
    temp JSON file, call ``life-index import run`` under the serialization
    lock, and return the normalized run envelope.
    """
    plan_envelope = get_transient_plan(body.import_id)
    if plan_envelope is None:
        return APIResponse.error_response(
            E.VALIDATION_ERROR,
            "导入计划已过期或不存在，请重新执行计划步骤",
            details={"reason": "replan_required"},
        )

    source = plan_envelope.get("source")
    adapter_id = source.get("adapter_id") if isinstance(source, dict) else None
    source_root = get_transient_source_root(body.import_id)
    if adapter_id == "media.photo_timeline" and source_root is None:
        return APIResponse.error_response(
            E.VALIDATION_ERROR,
            "导入计划的照片源目录已过期或不存在，请重新执行计划步骤",
            details={"reason": "replan_required", "missing": "source_root"},
        )

    plan_path = write_temp_plan(plan_envelope)

    try:
        args = build_import_run_args(plan_path, body.import_id, source_root=source_root)
        stdout = await cli.run_serialized(args)
        try:
            raw = json.loads(stdout)
        except json.JSONDecodeError:
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR,
                "CLI 返回了无效的导入执行结果",
            )
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)
    finally:
        plan_path.unlink(missing_ok=True)

    if not isinstance(raw, dict):
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的导入执行结果"
        )

    try:
        envelope = normalize_run_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR,
            f"无法解析 CLI 导入执行结果: {exc}",
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


# ── GET /api/imports/{import_id}/status ────────────────────────────────────


@router.get("/imports/{import_id}/status")
async def import_status(
    import_id: str,
    cli: CLIAdapter = Depends(get_cli),
):
    """Query the status of an import job."""
    args = build_import_status_args(import_id)

    try:
        raw = await cli.run_json(args)
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    if not isinstance(raw, dict):
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的导入状态数据"
        )

    try:
        envelope = normalize_status_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR,
            f"无法解析 CLI 导入状态结果: {exc}",
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


# ── POST /api/imports/{import_id}/rollback ────────────────────────────────


@router.post("/imports/{import_id}/rollback")
async def import_rollback(
    import_id: str,
    cli: CLIAdapter = Depends(get_cli),
):
    """Roll back an import job."""
    args = build_import_rollback_args(import_id)

    try:
        raw = await cli.run_json(args)
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    if not isinstance(raw, dict):
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的回滚数据"
        )

    try:
        envelope = normalize_rollback_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR,
            f"无法解析 CLI 回滚结果: {exc}",
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


# ── M7 historical-photo review/batch routes ───────────────────────────────
# The CLI import job remains the sole durable authority; these routes only
# translate + strip unsafe locator/hash fields and keep the backend stateless.


class ValidateRequest(BaseModel):
    source_root: str
    model_config = {"extra": "forbid"}


@router.post("/imports/validate")
async def import_validate(
    body: ValidateRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """Validate a photo source root: ``import validate`` (read-only)."""
    args = build_import_validate_args(Path(body.source_root))
    try:
        raw = await cli.run_json(args)
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    try:
        envelope = normalize_validate_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 校验结果: {exc}"
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


@router.get("/imports/reviews")
async def import_reviews(
    after: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    cli: CLIAdapter = Depends(get_cli),
):
    """Discover persisted parent review jobs: ``import reviews`` (read-only)."""
    args = build_import_reviews_args(after=after, limit=limit)
    try:
        raw = await cli.run_json(args)
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    try:
        envelope = normalize_reviews_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 审阅列表结果: {exc}"
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


@router.get("/imports/reviews/{parent_id}")
async def import_review_queue(
    parent_id: str,
    offset: int | None = Query(default=None, ge=0),
    limit: int | None = Query(default=None, ge=1, le=100),
    state: list[str] | None = Query(default=None),
    cli: CLIAdapter = Depends(get_cli),
):
    """Bounded read of a review queue: ``import review`` (read-only).

    Parent ids carry no ``#`` and are safe in the URL path; child batch ids
    (``PARENT#batch-N``) never appear in URLs.
    """
    args = build_import_review_args(parent_id, offset=offset, limit=limit, states=state)
    try:
        raw = await cli.run_json(args)
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    try:
        envelope = normalize_review_queue_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 审阅队列结果: {exc}"
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


@router.get("/imports/reviews/{parent_id}/status")
async def import_review_status(
    parent_id: str,
    cli: CLIAdapter = Depends(get_cli),
):
    """Review-parent status: ``import status --import-id <parent>`` (read-only).

    Distinct from the legacy ``import_status.v1`` status route — a review
    parent returns ``import_review.v1``. ``review_plan_rel_path`` is stripped.
    """
    args = build_import_status_args(parent_id)
    try:
        raw = await cli.run_json(args)
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    try:
        envelope = normalize_review_status_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 审阅状态结果: {exc}"
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


# ── M7 review write / preview routes ──────────────────────────────────────
# The CLI import job remains the sole durable authority. These routes only
# translate, strip unsafe locator/hash fields, keep transient state in memory,
# and run mutating CLI calls under the serialization lock.


class StageRequest(BaseModel):
    source_root: str
    model_config = {"extra": "forbid"}


@router.post("/imports/reviews/stage")
async def import_stage(
    body: StageRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """Composite: ``import plan`` then ``import stage`` for the photo adapter.

    Plan is read-only; stage persists the review queue (serialized write). The
    bound source root is kept transiently keyed by the review parent id so the
    preview / batch-run routes can recover it without a second durable source.
    The photo adapter id is fixed for this slice's GUI contract.
    """
    source_root = Path(body.source_root)

    try:
        plan_raw = await cli.run_json(
            build_import_plan_args("media.photo_timeline", source_root)
        )
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    try:
        plan_envelope = normalize_plan_envelope(plan_raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 导入计划结果: {exc}"
        )

    plan_path = write_temp_plan(plan_envelope)
    try:
        try:
            stdout = await cli.run_serialized(
                build_import_stage_args(plan_path, source_root)
            )
            try:
                raw = json.loads(stdout)
            except json.JSONDecodeError:
                return APIResponse.error_response(
                    E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的审阅暂存结果"
                )
        except CLIError as exc:
            code, message, details = map_import_error(exc)
            return APIResponse.error_response(code, message, details=details)

        if not isinstance(raw, dict):
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的审阅暂存结果"
            )

        try:
            envelope = normalize_stage_envelope(raw)
        except (ValueError, KeyError, TypeError) as exc:
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 审阅暂存结果: {exc}"
            )
    finally:
        plan_path.unlink(missing_ok=True)

    parent_id = envelope.get("parent_id") or envelope.get("import_id") or ""
    if parent_id:
        store_transient_plan(parent_id, envelope, source_root=source_root)

    return APIResponse.success(envelope, meta=_cli_meta(raw))


class ConfirmEditRequest(BaseModel):
    expected_queue_revision: int
    proposal_id: str
    decision: str
    journal: dict[str, Any] | None = None
    selected_attachment_ids: list[str] | None = None
    model_config = {"extra": "forbid"}


@router.post("/imports/reviews/{parent_id}/confirm-edit")
async def import_confirm_edit(
    parent_id: str,
    body: ConfirmEditRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """``import confirm --edit``: atomic single-proposal edit (serialized write).

    Builds an ``import_review_edit.v1`` payload from the request, writes it to a
    temp file, and runs the CLI under the serialization lock. The CLI re-derives
    the selection from persisted source facts, so no source locator is forwarded.
    """
    edit_payload: dict[str, Any] = {
        "schema_version": "import_review_edit.v1",
        "proposal_id": body.proposal_id,
        "decision": body.decision,
    }
    if body.journal is not None:
        edit_payload["journal"] = body.journal
    if body.selected_attachment_ids is not None:
        edit_payload["selected_attachment_ids"] = body.selected_attachment_ids

    edit_path = write_temp_edit(edit_payload)
    try:
        try:
            stdout = await cli.run_serialized(
                build_import_confirm_edit_args(
                    edit_path, parent_id, body.expected_queue_revision
                )
            )
            try:
                raw = json.loads(stdout)
            except json.JSONDecodeError:
                return APIResponse.error_response(
                    E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的审阅确认结果"
                )
        except CLIError as exc:
            code, message, details = map_import_error(exc)
            return APIResponse.error_response(code, message, details=details)

        if not isinstance(raw, dict):
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的审阅确认结果"
            )

        try:
            envelope = normalize_confirm_edit_envelope(raw)
        except (ValueError, KeyError, TypeError) as exc:
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 审阅确认结果: {exc}"
            )
    finally:
        edit_path.unlink(missing_ok=True)

    return APIResponse.success(envelope, meta=_cli_meta(raw))


class RebindRequest(BaseModel):
    source_root: str
    model_config = {"extra": "forbid"}


@router.post("/imports/reviews/{parent_id}/rebind")
async def import_rebind(
    parent_id: str,
    body: RebindRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """``import rebind``: re-bind a review parent to a source root (serialized)."""
    args = build_import_rebind_args(parent_id, Path(body.source_root))
    try:
        stdout = await cli.run_serialized(args)
        try:
            raw = json.loads(stdout)
        except json.JSONDecodeError:
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的源重绑定结果"
            )
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    if not isinstance(raw, dict):
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的源重绑定结果"
        )

    try:
        envelope = normalize_rebind_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 源重绑定结果: {exc}"
        )

    # Restore the transient source-root binding so preview / batch-run can
    # recover it after a backend restart. Stored only in the existing in-memory
    # store keyed by the review parent — never as durable state — and on every
    # successful rebind, including a same-root no-op (rebound is False). The
    # CLI import job remains the sole durable queue authority.
    store_transient_plan(parent_id, envelope, source_root=Path(body.source_root))

    return APIResponse.success(envelope, meta=_cli_meta(raw))


@router.post("/imports/reviews/{parent_id}/batch-run")
async def import_batch_run(
    parent_id: str,
    cli: CLIAdapter = Depends(get_cli),
):
    """``import run --import-id``: run a child batch off the staged source root.

    The source root bound at stage (or rebind) time is recovered from the
    transient store; if it is gone (backend restart) the caller must rebind the
    source root before retrying — re-staging the same actionable source is
    blocked by IMPORT_REVIEW_ALREADY_STAGED, so rebind is the only recovery.
    """
    source_root = get_transient_source_root(parent_id)
    if source_root is None:
        return APIResponse.error_response(
            E.VALIDATION_ERROR,
            "审阅任务的源目录已过期，请重新绑定源目录",
            details={"reason": "rebind_required", "missing": "source_root"},
        )

    args = build_import_batch_run_args(parent_id, source_root=source_root)
    try:
        stdout = await cli.run_serialized(args)
        try:
            raw = json.loads(stdout)
        except json.JSONDecodeError:
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的批次执行结果"
            )
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    if not isinstance(raw, dict):
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的批次执行结果"
        )

    try:
        envelope = normalize_batch_run_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 批次执行结果: {exc}"
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


class ChildRollbackRequest(BaseModel):
    import_id: str
    model_config = {"extra": "forbid"}


@router.post("/imports/rollback")
async def import_child_rollback(
    body: ChildRollbackRequest,
    cli: CLIAdapter = Depends(get_cli),
):
    """Roll back a child batch by id (``import rollback``), serialized.

    Child ids carry ``#`` (``PARENT#batch-N``) and cannot appear in a URL path,
    so the id travels in the request body. Reuses the legacy rollback normalizer,
    which keeps the manifest locator.
    """
    args = build_import_rollback_args(body.import_id)
    try:
        stdout = await cli.run_serialized(args)
        try:
            raw = json.loads(stdout)
        except json.JSONDecodeError:
            return APIResponse.error_response(
                E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的回滚结果"
            )
    except CLIError as exc:
        code, message, details = map_import_error(exc)
        return APIResponse.error_response(code, message, details=details)

    if not isinstance(raw, dict):
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, "CLI 返回了无效的回滚结果"
        )

    try:
        envelope = normalize_rollback_envelope(raw)
    except (ValueError, KeyError, TypeError) as exc:
        return APIResponse.error_response(
            E.IMPORT_INTERNAL_ERROR, f"无法解析 CLI 回滚结果: {exc}"
        )

    return APIResponse.success(envelope, meta=_cli_meta(raw))


@router.get("/imports/reviews/{parent_id}/preview")
async def import_preview(
    parent_id: str,
    attachment_id: str = Query(...),
    proposal_id: str = Query(...),
    cli: CLIAdapter = Depends(get_cli),
):
    """``import preview``: stream attachment bytes + a verified metadata sidecar.

    The CLI streams raw bytes to stdout (``--output -``) and writes a metadata
    sidecar to a backend-owned temp path. ``proposal_id`` is required so the
    sidecar's exact identity can be checked. After the byte subprocess returns,
    the sidecar is read with a bounded (1 MiB) OS-primitive read, stripped of
    source locator/hash, and verified fail-closed (schema, availability,
    identity, media type, size) before any byte is trusted. Requires the staged
    or rebound source root. The temp sidecar is cleaned on every branch.
    """
    source_root = get_transient_source_root(parent_id)
    if source_root is None:
        return APIResponse.error_response(
            E.VALIDATION_ERROR,
            "审阅任务的源目录已过期，请重新绑定源目录",
            details={"reason": "rebind_required", "missing": "source_root"},
        )

    meta_path = unique_metadata_path()
    try:
        args = build_import_preview_args(
            parent_id,
            attachment_id,
            proposal_id=proposal_id,
            source_root=source_root,
            output="-",
            metadata_output=meta_path,
        )
        try:
            content = await cli.run_preview_bytes(args)
        except CLIError as exc:
            code, message, details = map_import_error(exc)
            return APIResponse.error_response(code, message, details=details)

        try:
            metadata = read_preview_metadata(meta_path)
            verify_preview_sidecar(
                metadata,
                parent_id=parent_id,
                proposal_id=proposal_id,
                attachment_id=attachment_id,
                content=content,
            )
        except PreviewVerificationError as exc:
            return APIResponse.error_response(
                E.IMPORT_PREVIEW_UNAVAILABLE,
                M7_IMPORT_ERROR_MESSAGES[E.IMPORT_PREVIEW_UNAVAILABLE],
                details={"reason": exc.reason},
            )
    finally:
        meta_path.unlink(missing_ok=True)

    return Response(
        content=content,
        media_type=str(metadata.get("media_type")),
        headers={"x-preview-metadata": json.dumps(metadata, ensure_ascii=False)},
    )
