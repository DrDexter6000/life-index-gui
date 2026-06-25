"""Entity graph router — read/review/mutation surfaces via CLI."""

import json

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.adapter.error_mapper import map_cli_error
from backend.models.response import APIResponse

router = APIRouter(tags=["entities"])


class EntityMutationRequest(BaseModel):
    """Payload for guarded entity graph mutation preview/confirmation."""

    operation: str
    entity_id: str | None = Field(None, alias="entityId")
    source_id: str | None = Field(None, alias="sourceId")
    target_id: str | None = Field(None, alias="targetId")
    preview_accepted: bool = Field(False, alias="previewAccepted")

    model_config = {"populate_by_name": True}


@router.get("/entities/stats")
async def get_entity_stats() -> APIResponse[dict]:
    """Return entity graph statistics."""
    return await _entity_data(["entity", "--stats"])


@router.get("/entities")
async def list_entities(
    entity_type: str | None = Query(default=None, alias="type"),
) -> APIResponse[list | dict]:
    """List entities, optionally filtered by entity type."""
    args = ["entity", "--list"]
    if entity_type:
        args.extend(["--type", entity_type])
    return await _entity_data(args)


@router.get("/entities/check")
async def check_entities() -> APIResponse[dict]:
    """Return entity graph integrity check results."""
    return await _entity_data(["entity", "--check"])


@router.get("/entities/review")
async def review_entities() -> APIResponse[dict]:
    """Return entity graph review queue."""
    return await _entity_data(["entity", "--review"])


@router.get("/entities/audit")
async def audit_entities() -> APIResponse[dict]:
    """Return entity graph quality audit results."""
    return await _entity_data(["entity", "--audit"])


@router.get("/entities/candidate-edges")
async def candidate_edges(
    limit: int = Query(default=50, ge=1, le=200),
) -> APIResponse[dict]:
    """Return capped read-only candidate relationship edges."""
    cli = CLIAdapter()
    try:
        payload = await cli.run_json(["entity", "--candidate-edges"], timeout=30.0)
        data = _as_dict(payload)
        candidates = data.get("candidates")
        candidate_list = candidates if isinstance(candidates, list) else []
        return APIResponse.success(
            {
                "candidates": candidate_list[:limit],
                "total": _int_value(data.get("total"), len(candidate_list)),
                "schemaVersion": data.get("schema_version"),
                "provenance": data.get("provenance"),
            }
        )
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


@router.post("/entities/mutations/preview")
async def preview_entity_mutation(body: EntityMutationRequest) -> APIResponse[dict]:
    """Preview a supported entity mutation without modifying the graph."""
    validation_error = _validate_mutation_request(body)
    if validation_error:
        return validation_error

    cli = CLIAdapter()
    try:
        payload = await cli.run_json(_mutation_preview_args(body), timeout=30.0)
        data = _as_dict(payload)
        if data.get("success") is False:
            return _entity_error_response(
                data,
                "ENTITY_PREVIEW_FAILED",
                "Entity mutation preview failed",
            )
        return APIResponse.success(
            {
                "operation": body.operation,
                "preview": _unwrap_entity_payload(data),
                "requiresConfirmation": True,
                "schemaVersion": data.get("schema_version"),
                "provenance": data.get("provenance"),
            }
        )
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


@router.post("/entities/mutations/confirm")
async def confirm_entity_mutation(body: EntityMutationRequest) -> APIResponse[dict]:
    """Apply a supported entity mutation, then run entity --check."""
    validation_error = _validate_mutation_request(body, require_preview=True)
    if validation_error:
        return validation_error

    cli = CLIAdapter()
    try:
        stdout = await cli.run_serialized(_mutation_confirm_args(body), timeout=30.0)
        mutation_payload = _parse_cli_json_stdout(stdout)
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)
    except json.JSONDecodeError:
        return APIResponse.error_response(
            "CLI_PARSE_ERROR", "Entity mutation output was not valid JSON"
        )

    if mutation_payload.get("success") is False:
        return _entity_error_response(
            mutation_payload,
            "ENTITY_MUTATION_FAILED",
            "Entity mutation failed",
        )

    post_check: dict
    try:
        check_payload = await cli.run_json(["entity", "--check"], timeout=30.0)
        check_data = _as_dict(check_payload)
        post_check = {
            "ok": check_data.get("success", True) is not False,
            "data": _unwrap_entity_payload(check_data),
            "schemaVersion": check_data.get("schema_version"),
            "provenance": check_data.get("provenance"),
        }
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        post_check = {"ok": False, "error": {"code": code, "message": msg}}

    return APIResponse.success(
        {
            "operation": body.operation,
            "mutation": _unwrap_entity_payload(mutation_payload),
            "postCheck": post_check["data"] if post_check.get("ok") else post_check,
            "postCheckOk": bool(post_check.get("ok")),
            "schemaVersion": mutation_payload.get("schema_version"),
            "provenance": mutation_payload.get("provenance"),
        }
    )


async def _entity_data(args: list[str]) -> APIResponse:
    cli = CLIAdapter()
    try:
        payload = await cli.run_json(args, timeout=30.0)
        data = _as_dict(payload)
        if data.get("success") is False:
            error = _as_dict(data.get("error"))
            return APIResponse.error_response(
                str(error.get("code") or "CLI_ERROR"),
                str(error.get("message") or "Entity graph command failed"),
            )
        return APIResponse.success(data.get("data", data))
    except CLIError as e:
        code, msg = map_cli_error(e.stderr, e.returncode)
        return APIResponse.error_response(code, msg)


def _as_dict(value) -> dict:
    return value if isinstance(value, dict) else {}


def _int_value(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _validate_mutation_request(
    body: EntityMutationRequest,
    require_preview: bool = False,
) -> APIResponse | None:
    """Validate mutation request against the current CLI preview contract."""
    if body.operation not in {"delete", "merge_as_alias"}:
        return APIResponse.error_response(
            "UNSUPPORTED_ENTITY_MUTATION",
            "Only delete and merge_as_alias are exposed until the CLI provides preview support for other entity mutations",
        )

    if require_preview and not body.preview_accepted:
        return APIResponse.error_response(
            "PREVIEW_REQUIRED",
            "Entity mutations require an accepted preview before confirmation",
        )

    if body.operation == "delete" and not body.entity_id:
        return APIResponse.error_response(
            "VALIDATION_ERROR", "delete requires entityId"
        )

    if body.operation == "merge_as_alias":
        if not body.source_id or not body.target_id:
            return APIResponse.error_response(
                "VALIDATION_ERROR", "merge_as_alias requires sourceId and targetId"
            )
        if body.source_id == body.target_id:
            return APIResponse.error_response(
                "VALIDATION_ERROR", "sourceId and targetId must be different"
            )

    return None


def _mutation_preview_args(body: EntityMutationRequest) -> list[str]:
    if body.operation == "delete":
        return ["entity", "--delete", "--preview", "--id", str(body.entity_id)]
    return [
        "entity",
        "--review",
        "--action",
        "preview",
        "--id",
        str(body.source_id),
        "--target-id",
        str(body.target_id),
    ]


def _mutation_confirm_args(body: EntityMutationRequest) -> list[str]:
    if body.operation == "delete":
        return ["entity", "--delete", "--id", str(body.entity_id)]
    return [
        "entity",
        "--merge",
        str(body.source_id),
        "--id",
        str(body.source_id),
        "--target-id",
        str(body.target_id),
    ]


def _parse_cli_json_stdout(stdout: str) -> dict:
    text = stdout.strip()
    if not text:
        return {}
    start = text.find("{")
    if start > 0:
        text = text[start:]
    payload = json.loads(text)
    return payload if isinstance(payload, dict) else {}


def _unwrap_entity_payload(payload: dict) -> dict | list:
    return payload.get("data", payload)


def _entity_error_response(
    payload: dict,
    code: str,
    fallback_message: str,
) -> APIResponse:
    error = payload.get("error")
    if isinstance(error, dict):
        return APIResponse.error_response(
            str(error.get("code") or code),
            str(error.get("message") or fallback_message),
        )
    return APIResponse.error_response(code, str(error or fallback_message))
