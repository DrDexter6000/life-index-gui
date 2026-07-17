"""Stateless GUI-owned composition for the Archives Panel.

The CLI remains the source of truth.  This router only validates and projects
the small set of canonical read-only contracts needed by the Panel; it does
not read user data or retain a dashboard cache.
"""

from calendar import monthrange
from datetime import date
import re
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.models.response import APIResponse

router = APIRouter(tags=["dashboard"])

GUI_DASHBOARD_SCHEMA = "gui.dashboard.v1"
AGGREGATE_SCHEMA = "m16.aggregate.v0"
INDEX_TREE_SCHEMA = "m31.index_tree.v1"
FACETS = ("topic", "tag", "people")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DASHBOARD_SOURCE_UNAVAILABLE = "Dashboard source unavailable; retry the dashboard."
DASHBOARD_PAYLOAD_INVALID = "Dashboard source returned an invalid response; retry the dashboard."


def get_cli() -> CLIAdapter:
    return CLIAdapter()


def host_local_today() -> date:
    """Return the executing host's local calendar day.

    Kept as a small helper so boundary tests can inject a day without relying
    on UTC or browser ``toISOString`` conversions.
    """

    return date.today()


@router.get("/dashboard")
async def dashboard(
    month: str | None = Query(None),
    top: str | None = Query(None),
    cli: CLIAdapter = Depends(get_cli),
) -> JSONResponse:
    """Return the transient ``gui.dashboard.v1`` presentation envelope."""

    today = host_local_today()
    current_month = _month_key(today)
    selected_month, top_n, request_error = _parse_request(month, top, current_month)
    if request_error is not None:
        status_code, code, message = request_error
        return _error_response(status_code, code, message)

    # A future month is rejected before the first CLI call.  Lexicographic
    # comparison is safe for the strict YYYY-MM representation.
    if selected_month > current_month:
        return _error_response(
            400,
            "DASHBOARD_MONTH_FUTURE",
            "Dashboard month must not be in the future.",
        )

    selected_since, selected_until = _month_bounds(selected_month)
    today_key = today.isoformat()
    warnings: list[dict[str, str]] = []

    journal_count: int | None = None
    try:
        handshake = await cli.handshake()
        journal_count = _extract_canonical_journal_count(handshake)
        if journal_count is None:
            warnings.append(
                _warning(
                    "health",
                    "HEALTH_JOURNAL_COUNT_UNAVAILABLE",
                    "CLI health did not expose a valid canonical journal_count.",
                )
            )
    except Exception:  # per-source failure must not collapse the envelope
        warnings.append(_exception_warning("health", "HEALTH_UNAVAILABLE"))

    month_entry_count: int | None = None
    month_entry_payload, warning = await _run_aggregate(
        cli,
        since=selected_since,
        until=selected_until,
        unit="entry",
        source="month_entry_count",
    )
    if warning is not None:
        warnings.append(warning)
    elif month_entry_payload is not None:
        month_entry_count = _result_count(month_entry_payload)

    month_active_day_count: int | None = None
    daily_activity: list[dict[str, int | str]] = []
    month_day_payload, warning = await _run_aggregate(
        cli,
        since=selected_since,
        until=selected_until,
        unit="day",
        source="month_active_day_count",
    )
    if warning is not None:
        warnings.append(warning)
    elif month_day_payload is not None:
        month_active_day_count = _result_count(month_day_payload)
        daily_activity = _daily_activity(month_day_payload)

    today_entry_count: int | None = None
    today_payload, warning = await _run_aggregate(
        cli,
        since=today_key,
        until=today_key,
        unit="entry",
        source="today_entry_count",
    )
    if warning is not None:
        warnings.append(warning)
    elif today_payload is not None:
        today_entry_count = _result_count(today_payload)

    facets: dict[str, list[dict[str, int | str]]] = {
        "topics": [],
        "tags": [],
        "people": [],
    }
    discover_payload, warning = await _run_discover(cli, selected_month)
    if warning is not None:
        warnings.append(warning)
    elif discover_payload is not None:
        facets = _facet_projection(discover_payload, top_n)

    data = {
        "period": {
            "selected_month": selected_month,
            "today": today_key,
            "current_month": current_month,
        },
        "totals": {
            "journal_count": journal_count,
            "month_entry_count": month_entry_count,
            "month_active_day_count": month_active_day_count,
            "today_entry_count": today_entry_count,
        },
        "daily_activity": daily_activity,
        "facets": facets,
        "warnings": warnings,
    }
    return JSONResponse(
        status_code=200,
        content=APIResponse.success(data).model_dump(),
    )


async def _run_aggregate(
    cli: CLIAdapter,
    *,
    since: str,
    until: str,
    unit: str,
    source: str,
) -> tuple[dict | None, dict[str, str] | None]:
    args = [
        "aggregate",
        "--range",
        f"{since}..{until}",
        "--unit",
        unit,
        "--predicate",
        "journal_count",
        "--json",
    ]
    try:
        payload = await cli.run_json(args)
    except CLIError:
        return None, _warning(source, "CLI_ERROR", DASHBOARD_SOURCE_UNAVAILABLE)
    except Exception:
        return None, _exception_warning(source, "AGGREGATE_UNAVAILABLE")

    try:
        _validate_aggregate(payload, since=since, until=until, unit=unit)
    except ValueError:
        return None, _warning(source, "AGGREGATE_CONTRACT_ERROR", DASHBOARD_PAYLOAD_INVALID)
    return payload, None


async def _run_discover(
    cli: CLIAdapter,
    month: str,
) -> tuple[dict | None, dict[str, str] | None]:
    args = [
        "index-tree",
        "discover",
        "--from",
        month,
        "--to",
        month,
        "--facet",
        "topic",
        "--facet",
        "tag",
        "--facet",
        "people",
        "--json",
    ]
    try:
        payload = await cli.run_json(args)
    except CLIError:
        return None, _warning("facets", "CLI_ERROR", DASHBOARD_SOURCE_UNAVAILABLE)
    except Exception:
        return None, _exception_warning("facets", "DISCOVER_UNAVAILABLE")

    try:
        _validate_discover(payload, month)
    except ValueError:
        return None, _warning("facets", "DISCOVER_CONTRACT_ERROR", DASHBOARD_PAYLOAD_INVALID)
    return payload, None


def _parse_request(
    month: str | None,
    top: str | None,
    current_month: str,
) -> tuple[str, int, tuple[int, str, str] | None]:
    selected = current_month if month is None else month
    if not isinstance(selected, str) or MONTH_RE.fullmatch(selected) is None:
        return selected if isinstance(selected, str) else current_month, 5, (
            400,
            "DASHBOARD_REQUEST_INVALID",
            "month must use YYYY-MM format.",
        )

    if top is None:
        top_n = 5
    else:
        try:
            if not re.fullmatch(r"[0-9]+", top):
                raise ValueError
            top_n = int(top)
        except (TypeError, ValueError):
            return selected, 5, (
                400,
                "DASHBOARD_REQUEST_INVALID",
                "top must be an integer from 1 to 20.",
            )
        if not 1 <= top_n <= 20:
            return selected, top_n, (
                400,
                "DASHBOARD_REQUEST_INVALID",
                "top must be an integer from 1 to 20.",
            )
    return selected, top_n, None


def _month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_bounds(month: str) -> tuple[str, str]:
    year, month_number = (int(part) for part in month.split("-"))
    last_day = monthrange(year, month_number)[1]
    return f"{month}-01", f"{month}-{last_day:02d}"


def _extract_canonical_journal_count(handshake: object) -> int | None:
    if not isinstance(handshake, dict):
        return None
    health = handshake.get("health")
    if not isinstance(health, dict):
        return None
    data = health.get("data")
    if not isinstance(data, dict):
        return None
    checks = data.get("checks")
    if not isinstance(checks, list):
        return None
    for check in checks:
        if not isinstance(check, dict) or check.get("name") != "data_directory":
            continue
        value = check.get("journal_count")
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
        return None
    return None


def _validate_aggregate(payload: object, *, since: str, until: str, unit: str) -> None:
    if not isinstance(payload, dict):
        raise ValueError("Aggregate payload must be an object.")
    if payload.get("success") is not True:
        raise ValueError("Aggregate payload did not report success.")
    if payload.get("schema_version") != AGGREGATE_SCHEMA:
        raise ValueError(f"Aggregate schema_version must be {AGGREGATE_SCHEMA}.")
    if payload.get("command") != "aggregate":
        raise ValueError("Aggregate command must be aggregate.")
    if payload.get("metric") != "journal_count":
        raise ValueError("Aggregate metric must be journal_count.")
    if payload.get("unit") != unit:
        raise ValueError(f"Aggregate unit must be {unit}.")

    result_range = payload.get("range")
    if not isinstance(result_range, dict) or result_range.get("since") != since or result_range.get("until") != until:
        raise ValueError("Aggregate range does not match the requested local range.")

    predicate = payload.get("predicate")
    if not isinstance(predicate, dict) or predicate.get("type") != "journal_count":
        raise ValueError("Aggregate predicate must be journal_count.")

    result = payload.get("result")
    if not isinstance(result, dict) or not _non_negative_int(result.get("count")) or not _non_negative_int(result.get("denominator")):
        raise ValueError("Aggregate result count and denominator must be non-negative integers.")

    buckets = payload.get("buckets")
    if not isinstance(buckets, list):
        raise ValueError("Aggregate buckets must be an array.")
    if unit == "entry" and buckets:
        raise ValueError("Entry aggregate buckets must be empty.")

    seen: set[str] = set()
    for index, bucket in enumerate(buckets):
        if not isinstance(bucket, dict):
            raise ValueError(f"Aggregate bucket {index} must be an object.")
        key = bucket.get("key")
        if unit == "day":
            if not isinstance(key, str) or DAY_RE.fullmatch(key) is None:
                raise ValueError(f"Aggregate day bucket {index} has an invalid date key.")
            try:
                key_date = date.fromisoformat(key)
                if not (date.fromisoformat(since) <= key_date <= date.fromisoformat(until)):
                    raise ValueError
            except ValueError:
                raise ValueError(f"Aggregate day bucket {index} is outside the requested range.")
        if not isinstance(key, str) or key in seen:
            raise ValueError(f"Aggregate bucket {index} has a duplicate or invalid key.")
        seen.add(key)
        if not _non_negative_int(bucket.get("count")) or not _non_negative_int(bucket.get("total")):
            raise ValueError(f"Aggregate bucket {index} count and total must be non-negative integers.")
        if bucket["count"] > bucket["total"]:
            raise ValueError(f"Aggregate bucket {index} count cannot exceed total.")


def _validate_discover(payload: object, month: str) -> None:
    if not isinstance(payload, dict):
        raise ValueError("Index Tree discover payload must be an object.")
    if payload.get("success") is not True:
        raise ValueError("Index Tree discover did not report success.")
    if payload.get("schema_version") != INDEX_TREE_SCHEMA:
        raise ValueError(f"Index Tree schema_version must be {INDEX_TREE_SCHEMA}.")
    if payload.get("command") != "index-tree.discover":
        raise ValueError("Index Tree command must be index-tree.discover.")
    errors = payload.get("errors")
    if not isinstance(errors, list):
        raise ValueError("Index Tree errors must be an array.")
    if errors:
        raise ValueError("Index Tree discover reported errors.")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("Index Tree discover data must be an object.")
    for field in ("truth_source", "privacy_level", "selection_contract", "date_from", "date_to"):
        if not isinstance(data.get(field), str) or not data.get(field):
            raise ValueError(f"Index Tree discover data.{field} is required.")
    if data.get("date_from") != month or data.get("date_to") != month:
        raise ValueError("Index Tree discover range does not match the requested month.")
    facets = data.get("facets")
    if not isinstance(facets, dict):
        raise ValueError("Index Tree discover facets must be an object.")
    for facet in FACETS:
        menu = facets.get(facet)
        if not isinstance(menu, dict) or menu.get("facet") != facet or not isinstance(menu.get("values"), list):
            raise ValueError(f"Index Tree discover facet {facet} is malformed or missing.")
        for index, value in enumerate(menu["values"]):
            if not isinstance(value, dict) or not isinstance(value.get("value"), str) or not value["value"].strip() or not _non_negative_int(value.get("count")):
                raise ValueError(f"Index Tree discover facet {facet} value {index} is malformed.")


def _facet_projection(payload: dict, top: int) -> dict[str, list[dict[str, int | str]]]:
    data = payload["data"]
    source_facets = data["facets"]
    result: dict[str, list[dict[str, int | str]]] = {}
    for source_name, output_name in (("topic", "topics"), ("tag", "tags"), ("people", "people")):
        values = [
            {"value": value["value"], "count": value["count"]}
            for value in source_facets[source_name]["values"]
        ]
        values.sort(key=lambda item: (-int(item["count"]), str(item["value"]).casefold(), str(item["value"])))
        result[output_name] = values[:top]
    return result


def _result_count(payload: dict) -> int:
    return int(payload["result"]["count"])


def _daily_activity(payload: dict) -> list[dict[str, int | str]]:
    buckets = payload["buckets"]
    return [
        {"date": bucket["key"], "count": int(bucket["count"])}
        for bucket in sorted(buckets, key=lambda item: item["key"])
    ]


def _non_negative_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _warning(source: str, code: str, message: str) -> dict[str, str]:
    return {"source": source, "code": code, "message": message}


def _exception_warning(source: str, fallback_code: str) -> dict[str, str]:
    return _warning(source, fallback_code, DASHBOARD_SOURCE_UNAVAILABLE)


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=APIResponse.error_response(code, message).model_dump(),
    )
