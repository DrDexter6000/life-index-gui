"""Deterministic aggregate adapter used by the Archives Panel."""

from datetime import date
import re
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.models.response import APIResponse

router = APIRouter(tags=["aggregate"])

SCHEMA_VERSION = "m16.aggregate.v0"
_MONTH_KEY_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def get_cli() -> CLIAdapter:
    return CLIAdapter()


@router.get("/aggregate")
async def aggregate(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Run the canonical monthly ``journal_count`` aggregate contract.

    The GUI adapter deliberately forwards one fixed predicate/unit pair. It
    validates the returned M16 payload before exposing it so a malformed CLI
    response cannot become a fabricated Panel value.
    """
    if date_from > date_to:
        return _error_response(
            400,
            "AGGREGATE_RANGE_INVALID",
            "Aggregate range start must not be after its end.",
        )

    range_str = f"{date_from.isoformat()}..{date_to.isoformat()}"
    args = [
        "aggregate",
        "--range",
        range_str,
        "--unit",
        "month",
        "--predicate",
        "journal_count",
        "--json",
    ]

    try:
        payload = await cli.run_json(args)
    except CLIError as exc:
        return _error_response(
            502, "CLI_ERROR", exc.stderr or "Aggregate command failed."
        )

    try:
        _validate_aggregate_payload(
            payload,
            expected_since=date_from.isoformat(),
            expected_until=date_to.isoformat(),
        )
    except ValueError as exc:
        return _error_response(502, "CLI_CONTRACT_ERROR", str(exc))

    return JSONResponse(
        status_code=200,
        content=APIResponse.success(payload).model_dump(),
    )


def _validate_aggregate_payload(
    payload: object,
    *,
    expected_since: str,
    expected_until: str,
) -> None:
    """Validate the M16 fields consumed by Archives before returning them."""
    if not isinstance(payload, dict):
        raise ValueError("Aggregate CLI response must be an object.")
    if payload.get("success") is not True:
        raise ValueError("Aggregate CLI response did not report success.")
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"Aggregate CLI schema_version must be {SCHEMA_VERSION}.")
    if payload.get("command") != "aggregate":
        raise ValueError("Aggregate CLI command must be 'aggregate'.")
    if payload.get("metric") != "journal_count":
        raise ValueError("Aggregate CLI metric must be 'journal_count'.")
    if payload.get("unit") != "month":
        raise ValueError("Aggregate CLI unit must be 'month'.")

    result_range = payload.get("range")
    if not isinstance(result_range, dict):
        raise ValueError("Aggregate CLI range must be an object.")
    if (
        result_range.get("since") != expected_since
        or result_range.get("until") != expected_until
    ):
        raise ValueError("Aggregate CLI range does not match the requested range.")

    predicate = payload.get("predicate")
    if not isinstance(predicate, dict) or predicate.get("type") != "journal_count":
        raise ValueError("Aggregate CLI predicate must be journal_count.")

    result = payload.get("result")
    if not isinstance(result, dict):
        raise ValueError("Aggregate CLI result must be an object.")
    for field in ("count", "denominator"):
        if not _non_negative_int(result.get(field)):
            raise ValueError(
                f"Aggregate CLI result.{field} must be a non-negative integer."
            )

    buckets = payload.get("buckets")
    if not isinstance(buckets, list):
        raise ValueError("Aggregate CLI buckets must be an array.")
    for index, bucket in enumerate(buckets):
        if not isinstance(bucket, dict):
            raise ValueError(f"Aggregate CLI bucket {index} must be an object.")
        key = bucket.get("key")
        if not isinstance(key, str) or _MONTH_KEY_RE.fullmatch(key) is None:
            raise ValueError(f"Aggregate CLI bucket {index} has an invalid month key.")
        if not _non_negative_int(bucket.get("count")):
            raise ValueError(
                f"Aggregate CLI bucket {index}.count must be a non-negative integer."
            )
        if not _non_negative_int(bucket.get("total")):
            raise ValueError(
                f"Aggregate CLI bucket {index}.total must be a non-negative integer."
            )
        if bucket["count"] > bucket["total"]:
            raise ValueError(f"Aggregate CLI bucket {index}.count cannot exceed total.")


def _non_negative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=APIResponse.error_response(code, message).model_dump(),
    )
