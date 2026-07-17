"""RED contract coverage for the GUI-owned ``gui.dashboard.v1`` Panel provider.

These tests deliberately exercise the provider boundary rather than the legacy
Archives routes.  They are expected to fail until ``/api/dashboard`` exists.
"""

from datetime import date
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.main import app

client = TestClient(app)


def _health_handshake(*, journal_count: int = 501) -> dict:
    return {
        "status": "ok",
        "cli_available": True,
        "compatible": True,
        "package_version": "1.4.5",
        "repo_version": "1.4.5",
        "health": {
            "success": True,
            "schema_version": "m16.health.v0",
            "data": {
                "status": "healthy",
                "checks": [
                    {"name": "data_directory", "journal_count": journal_count},
                ],
            },
            "events": [],
        },
    }


def _aggregate(
    *,
    unit: str,
    since: str,
    until: str,
    count: int,
    buckets: list[dict] | None = None,
) -> dict:
    return {
        "success": True,
        "schema_version": "m16.aggregate.v0",
        "query": "",
        "command": "aggregate",
        "metric": "journal_count",
        "unit": unit,
        "range": {"since": since, "until": until},
        "predicate": {
            "type": "journal_count",
            "definition": "count of journal entries per aggregation unit",
        },
        "result": {
            "count": count,
            "denominator": max(count, 1),
            "exactness": "exact",
            "confidence": "high",
        },
        "buckets": buckets or [],
        "matched_entries": [],
        "excluded_entries": [],
        "unknown_entries": [],
        "evidence_paths": [],
        "limitations": [],
        "performance": {"total_time_ms": 1.0},
        "claim_envelope": {},
        "evidence_pack": {},
    }


def _discover(*, month: str = "2026-07") -> dict:
    def menu(facet: str, values: list[tuple[str, int]]) -> dict:
        return {
            "facet": facet,
            "value_count": len(values),
            "values": [
                {
                    "value": value,
                    "count": count,
                    "sample_entry_pointers": [],
                    "raw_values": [value],
                }
                for value, count in values
            ],
        }

    return {
        "success": True,
        "schema_version": "m31.index_tree.v1",
        "command": "index-tree.discover",
        "generated_at": "2026-07-15T00:00:00Z",
        "data": {
            "truth_source": "journals",
            "privacy_level": "same_as_journals",
            "source": "index-b",
            "artifact": "index-b",
            "date_from": month,
            "date_to": month,
            "operation_model": "deterministic_navigation.v1",
            "selection_contract": "host_agent_selects_values; tool_executes_only",
            "exhaustive": True,
            "facets": {
                "topic": menu("topic", [("work", 3), ("life", 2)]),
                "tag": menu("tag", [("urgent", 4), ("notes", 1)]),
                "people": menu("people", [("Ada", 2), ("Lin", 1)]),
            },
            "freshness": {"fresh": True, "issues": []},
            "fallback": {"used": False, "reason": None, "journal_fallback_pointers": []},
        },
        "errors": [],
    }


def _dashboard_response(*, top: int = 2, month: str = "2026-07"):
    selected_entry = _aggregate(
        unit="entry", since="2026-07-01", until="2026-07-31", count=3
    )
    selected_day = _aggregate(
        unit="day",
        since="2026-07-01",
        until="2026-07-31",
        count=2,
        buckets=[
            {"key": "2026-07-02", "count": 2, "total": 2, "evidence_paths": []},
            {"key": "2026-07-14", "count": 1, "total": 1, "evidence_paths": []},
        ],
    )
    today = _aggregate(
        unit="entry", since="2026-07-15", until="2026-07-15", count=1
    )
    with (
        patch(
            "backend.routers.dashboard.host_local_today",
            return_value=date(2026, 7, 15),
        ),
        patch.object(CLIAdapter, "handshake", new_callable=AsyncMock) as handshake,
        patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json,
    ):
        handshake.return_value = _health_handshake()
        run_json.side_effect = [selected_entry, selected_day, today, _discover()]
        return client.get("/api/dashboard", params={"month": month, "top": top}), run_json


def test_dashboard_returns_exact_v1_envelope_and_canonical_argv():
    response, run_json = _dashboard_response()

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    data = body["data"]
    assert set(data) == {"period", "totals", "daily_activity", "facets", "warnings"}
    assert set(data["totals"]) == {
        "journal_count",
        "month_entry_count",
        "month_active_day_count",
        "today_entry_count",
    }
    assert data["totals"] == {
        "journal_count": 501,
        "month_entry_count": 3,
        "month_active_day_count": 2,
        "today_entry_count": 1,
    }
    assert data["daily_activity"] == [
        {"date": "2026-07-02", "count": 2},
        {"date": "2026-07-14", "count": 1},
    ]
    assert data["facets"]["topics"] == [
        {"value": "work", "count": 3},
        {"value": "life", "count": 2},
    ]
    assert run_json.await_args_list[0].args[0] == [
        "aggregate",
        "--range",
        "2026-07-01..2026-07-31",
        "--unit",
        "entry",
        "--predicate",
        "journal_count",
        "--json",
    ]
    assert run_json.await_args_list[1].args[0] == [
        "aggregate",
        "--range",
        "2026-07-01..2026-07-31",
        "--unit",
        "day",
        "--predicate",
        "journal_count",
        "--json",
    ]
    assert run_json.await_args_list[2].args[0] == [
        "aggregate",
        "--range",
        "2026-07-15..2026-07-15",
        "--unit",
        "entry",
        "--predicate",
        "journal_count",
        "--json",
    ]
    assert run_json.await_args_list[3].args[0] == [
        "index-tree",
        "discover",
        "--from",
        "2026-07",
        "--to",
        "2026-07",
        "--facet",
        "topic",
        "--facet",
        "tag",
        "--facet",
        "people",
        "--json",
    ]


def test_dashboard_keeps_sources_independent_and_never_fabricates_zero():
    selected_entry = _aggregate(
        unit="entry", since="2026-07-01", until="2026-07-31", count=3
    )
    selected_day = _aggregate(
        unit="day", since="2026-07-01", until="2026-07-31", count=1,
        buckets=[{"key": "2026-07-02", "count": 3, "total": 3}],
    )
    today = _aggregate(unit="entry", since="2026-07-15", until="2026-07-15", count=0)
    with (
        patch.object(CLIAdapter, "handshake", new_callable=AsyncMock) as handshake,
        patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json,
    ):
        handshake.return_value = {"status": "degraded", "health": None, "error": {"message": "offline"}}
        run_json.side_effect = [selected_entry, selected_day, CLIError(1, "today failed"), _discover()]
        response = client.get("/api/dashboard?month=2026-07&top=5")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["totals"]["journal_count"] is None
    assert data["totals"]["month_entry_count"] == 3
    assert data["totals"]["month_active_day_count"] == 1
    assert data["totals"]["today_entry_count"] is None
    assert any(w["source"] == "health" for w in data["warnings"])
    assert any(w["source"] == "today_entry_count" for w in data["warnings"])


def test_dashboard_redacts_cli_and_exception_diagnostics_from_warnings():
    sentinel = "DASHBOARD_SENTINEL_SECRET"
    absolute_path = r"C:\Users\owner\Life Index\private\journal.md"
    cli_error = CLIError(
        1,
        stderr=f"raw stderr: {sentinel}",
        stdout=f"raw stdout: {absolute_path}",
    )
    selected_day = _aggregate(
        unit="day",
        since="2026-07-01",
        until="2026-07-31",
        count=1,
        buckets=[{"key": "2026-07-02", "count": 1, "total": 1}],
    )
    today = _aggregate(
        unit="entry", since="2026-07-15", until="2026-07-15", count=1
    )
    with (
        patch("backend.routers.dashboard.host_local_today", return_value=date(2026, 7, 15)),
        patch.object(CLIAdapter, "handshake", new_callable=AsyncMock) as handshake,
        patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json,
    ):
        handshake.side_effect = RuntimeError(
            f"health exception: {sentinel} at {absolute_path}"
        )
        run_json.side_effect = [
            cli_error,
            selected_day,
            today,
            RuntimeError(f"discover exception: {sentinel} at {absolute_path}"),
        ]
        response = client.get("/api/dashboard?month=2026-07")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["totals"]["journal_count"] is None
    assert data["totals"]["month_entry_count"] is None
    assert data["totals"]["month_active_day_count"] == 1
    assert data["totals"]["today_entry_count"] == 1
    assert data["facets"] == {"topics": [], "tags": [], "people": []}

    warnings = {warning["source"]: warning for warning in data["warnings"]}
    assert warnings["health"]["code"] == "HEALTH_UNAVAILABLE"
    assert warnings["month_entry_count"]["code"] == "CLI_ERROR"
    assert warnings["facets"]["code"] == "DISCOVER_UNAVAILABLE"
    assert all(
        warning["message"] == "Dashboard source unavailable; retry the dashboard."
        for warning in warnings.values()
    )

    def string_values(value: object):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for nested in value.values():
                yield from string_values(nested)
        elif isinstance(value, list):
            for nested in value:
                yield from string_values(nested)

    response_body = response.json()
    response_strings = list(string_values(response_body))
    response_text = response.text
    assert sentinel not in response_text
    assert all(sentinel not in value for value in response_strings)
    assert all(absolute_path not in value for value in response_strings)
    assert all(sentinel not in warning["message"] for warning in warnings.values())
    assert all(absolute_path not in warning["message"] for warning in warnings.values())


def test_dashboard_rejects_malformed_aggregate_as_warning_not_zero():
    malformed = _aggregate(unit="entry", since="2026-07-01", until="2026-07-31", count=3)
    malformed["schema_version"] = "wrong"
    with (
        patch.object(CLIAdapter, "handshake", new_callable=AsyncMock) as handshake,
        patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json,
    ):
        handshake.return_value = _health_handshake()
        run_json.side_effect = [malformed, CLIError(1, "day failed"), CLIError(1, "today failed"), _discover()]
        response = client.get("/api/dashboard?month=2026-07")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["totals"]["month_entry_count"] is None
    assert data["totals"]["month_active_day_count"] is None
    assert data["totals"]["today_entry_count"] is None
    assert all(value != 0 for value in data["totals"].values() if value is not None)
    assert any(w["code"] == "AGGREGATE_CONTRACT_ERROR" for w in data["warnings"])


def test_dashboard_rejects_discover_errors_as_warning_not_empty_success():
    malformed = _discover()
    malformed["errors"] = [{"code": "INDEX_STALE", "message": "stale"}]
    with (
        patch.object(CLIAdapter, "handshake", new_callable=AsyncMock) as handshake,
        patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json,
    ):
        handshake.return_value = _health_handshake()
        run_json.side_effect = [
            _aggregate(unit="entry", since="2026-07-01", until="2026-07-31", count=1),
            _aggregate(
                unit="day",
                since="2026-07-01",
                until="2026-07-31",
                count=1,
                buckets=[{"key": "2026-07-02", "count": 1, "total": 1}],
            ),
            _aggregate(unit="entry", since="2026-07-15", until="2026-07-15", count=1),
            malformed,
        ]
        response = client.get("/api/dashboard?month=2026-07")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["facets"] == {"topics": [], "tags": [], "people": []}
    assert any(w["code"] == "DISCOVER_CONTRACT_ERROR" for w in data["warnings"])


def test_dashboard_rejects_future_month_before_any_cli_call():
    with (
        patch.object(CLIAdapter, "handshake", new_callable=AsyncMock) as handshake,
        patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json,
    ):
        response = client.get("/api/dashboard?month=2026-08")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "DASHBOARD_MONTH_FUTURE"
    handshake.assert_not_awaited()
    run_json.assert_not_awaited()


def test_dashboard_rejects_invalid_month_and_top():
    for query in ("month=", "month=2026-13", "month=202607", "top=", "top=0", "top=21", "top=nope"):
        response = client.get(f"/api/dashboard?{query}")
        assert response.status_code == 400, query
        assert response.json()["error"]["code"] == "DASHBOARD_REQUEST_INVALID"


def test_dashboard_uses_host_local_today_for_cross_midnight_range():
    selected_entry = _aggregate(unit="entry", since="2026-07-01", until="2026-07-31", count=1)
    selected_day = _aggregate(unit="day", since="2026-07-01", until="2026-07-31", count=1,
                              buckets=[{"key": "2026-07-15", "count": 1, "total": 1}])
    today = _aggregate(unit="entry", since="2026-07-15", until="2026-07-15", count=1)
    with (
        patch("backend.routers.dashboard.host_local_today", return_value=date(2026, 7, 15)),
        patch.object(CLIAdapter, "handshake", new_callable=AsyncMock) as handshake,
        patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json,
    ):
        handshake.return_value = _health_handshake(journal_count=1)
        run_json.side_effect = [selected_entry, selected_day, today, _discover()]
        response = client.get("/api/dashboard?month=2026-07")

    assert response.status_code == 200
    assert response.json()["data"]["period"]["today"] == "2026-07-15"
    assert run_json.await_args_list[2].args[0][2] == "2026-07-15..2026-07-15"


def test_dashboard_does_not_call_ensure_or_legacy_source_families():
    response, run_json = _dashboard_response()
    assert response.status_code == 200
    commands = [call.args[0] for call in run_json.await_args_list]
    assert all(command[:2] != ["index-tree", "ensure"] for command in commands)
    assert not any(command[:2] in (["index-tree", "nodes"], ["index-tree", "lens"], ["index-tree", "shadow"]) for command in commands)
