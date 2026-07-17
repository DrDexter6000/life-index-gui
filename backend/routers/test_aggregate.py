"""Contract tests for the deterministic Panel aggregate adapter."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.main import app

client = TestClient(app)


def _aggregate_envelope(
    *,
    since: str = "2026-01-01",
    until: str = "2026-07-14",
    buckets: list[dict] | None = None,
    count: int = 4,
) -> dict:
    return {
        "success": True,
        "schema_version": "m16.aggregate.v0",
        "query": "",
        "command": "aggregate",
        "metric": "journal_count",
        "unit": "month",
        "range": {"since": since, "until": until},
        "predicate": {
            "type": "journal_count",
            "definition": "count of journal entries per aggregation unit",
        },
        "result": {
            "count": count,
            "denominator": 7,
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


def test_aggregate_maps_explicit_range_to_exact_cli_contract():
    payload = _aggregate_envelope(
        buckets=[{"key": "2026-01", "count": 2, "total": 2, "evidence_paths": []}]
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get(
            "/api/aggregate",
            params={"from": "2026-01-01", "to": "2026-07-14"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["schema_version"] == "m16.aggregate.v0"
    run_json.assert_awaited_once_with(
        [
            "aggregate",
            "--range",
            "2026-01-01..2026-07-14",
            "--unit",
            "month",
            "--predicate",
            "journal_count",
            "--json",
        ]
    )


def test_aggregate_rejects_invalid_cli_envelope_without_inventing_data():
    invalid_payload = _aggregate_envelope()
    invalid_payload["schema_version"] = "wrong.schema"

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = invalid_payload
        response = client.get(
            "/api/aggregate",
            params={"from": "2026-01-01", "to": "2026-07-14"},
        )

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_CONTRACT_ERROR"


def test_aggregate_rejects_invalid_bucket_shape():
    payload = _aggregate_envelope(
        buckets=[{"key": "2026-01", "count": "not-a-count", "total": 2}]
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get(
            "/api/aggregate",
            params={"from": "2026-01-01", "to": "2026-07-14"},
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "CLI_CONTRACT_ERROR"


def test_aggregate_maps_cli_failure_to_existing_error_envelope():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.side_effect = CLIError(1, "aggregate command failed")
        response = client.get(
            "/api/aggregate",
            params={"from": "2026-01-01", "to": "2026-07-14"},
        )

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_ERROR"
