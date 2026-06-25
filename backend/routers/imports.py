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

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.adapter.error_mapper import map_import_error
from backend.adapter.import_adapter import (
    build_import_plan_args,
    build_import_run_args,
    build_import_status_args,
    build_import_rollback_args,
    get_transient_source_root,
    get_transient_plan,
    normalize_plan_envelope,
    normalize_rollback_envelope,
    normalize_run_envelope,
    normalize_status_envelope,
    store_transient_plan,
    write_temp_plan,
)
from backend.models import errors as E
from backend.models.response import APIResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["imports"])


def get_cli() -> CLIAdapter:
    return CLIAdapter()


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
        code, message = map_import_error(exc)
        return APIResponse.error_response(code, message)

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
        code, message = map_import_error(exc)
        return APIResponse.error_response(code, message)
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
        code, message = map_import_error(exc)
        return APIResponse.error_response(code, message)

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
        code, message = map_import_error(exc)
        return APIResponse.error_response(code, message)

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
