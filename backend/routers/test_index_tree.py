"""Contract tests for canonical read-only index-tree backend consumer."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend.main import app

client = TestClient(app)


def _envelope(command: str, data: dict) -> dict:
    return {
        "success": True,
        "schema_version": "m31.index_tree.v1",
        "command": command,
        "generated_at": "2026-05-31T00:00:00Z",
        "data": data,
        "errors": [],
    }


def test_discover_topic_facet_returns_cli_envelope():
    payload = _envelope(
        "index-tree.discover",
        {
            "truth_source": "journals",
            "privacy_level": "same_as_journals",
            "selection_contract": "host_agent_selects_values; tool_executes_only",
            "facets": {
                "topic": {
                    "facet": "topic",
                    "value_count": 1,
                    "values": [
                        {
                            "value": "work",
                            "count": 2,
                            "sample_entry_pointers": [
                                "Journals/2026/05/life-index_2026-05-01_001.md"
                            ],
                            "raw_values": ["work"],
                        }
                    ],
                }
            },
            "freshness": {"fresh": True},
            "fallback": {"used": False, "reason": None},
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get("/api/index-tree/discover", params={"facet": "topic"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["schema_version"] == "m31.index_tree.v1"
    assert body["data"]["command"] == "index-tree.discover"
    assert body["data"]["data"]["selection_contract"] == (
        "host_agent_selects_values; tool_executes_only"
    )
    assert body["data"]["data"]["facets"]["topic"]["values"][0]["value"] == "work"
    run_json.assert_awaited_once_with(
        ["index-tree", "discover", "--facet", "topic", "--json"]
    )


def test_discover_date_range_and_multiple_facets_are_passed_through():
    payload = _envelope(
        "index-tree.discover",
        {
            "truth_source": "journals",
            "privacy_level": "same_as_journals",
            "selection_contract": "host_agent_selects_values; tool_executes_only",
            "facets": {},
            "freshness": {"fresh": True},
            "fallback": {"used": False, "reason": None},
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get(
            "/api/index-tree/discover?from=2026-03&to=2026-04&facet=topic&facet=project"
        )

    assert response.status_code == 200
    run_json.assert_awaited_once_with(
        [
            "index-tree",
            "discover",
            "--from",
            "2026-03",
            "--to",
            "2026-04",
            "--facet",
            "topic",
            "--facet",
            "project",
            "--json",
        ]
    )


def test_navigate_filter_returns_cli_envelope():
    payload = _envelope(
        "index-tree.navigate",
        {
            "truth_source": "journals",
            "privacy_level": "same_as_journals",
            "operation_model": "deterministic_navigation.v1",
            "operations": [{"type": "facet_filter", "facet": "topic"}],
            "entry_pointers": [
                "Journals/2026/05/life-index_2026-05-01_001.md"
            ],
            "entries": [
                {
                    "relative_path": "Journals/2026/05/life-index_2026-05-01_001.md",
                    "title": "Work note",
                }
            ],
            "freshness": {"fresh": True},
            "fallback": {"used": False, "reason": None},
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.post(
            "/api/index-tree/navigate",
            json={"filters": [{"facet": "topic", "values": ["work"]}]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["command"] == "index-tree.navigate"
    assert body["data"]["data"]["entry_pointers"][0].endswith("001.md")
    run_json.assert_awaited_once_with(
        ["index-tree", "navigate", "--filter", "topic=work", "--json"]
    )


def test_navigate_multi_value_filter_and_entity_options_are_passed_through():
    payload = _envelope(
        "index-tree.navigate",
        {
            "truth_source": "journals",
            "privacy_level": "same_as_journals",
            "entry_pointers": [],
            "entries": [],
            "freshness": {"fresh": True},
            "fallback": {"used": False, "reason": None},
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.post(
            "/api/index-tree/navigate",
            json={
                "dateFrom": "2026-03",
                "dateTo": "2026-04",
                "filters": [{"facet": "topic", "values": ["work", "life"]}],
                "entityNeighbors": ["entity-life-index"],
                "entityRelations": ["related_to"],
                "entityMaxHops": 2,
            },
        )

    assert response.status_code == 200
    run_json.assert_awaited_once_with(
        [
            "index-tree",
            "navigate",
            "--from",
            "2026-03",
            "--to",
            "2026-04",
            "--filter",
            "topic=work||life",
            "--entity-neighbors",
            "entity-life-index",
            "--entity-relation",
            "related_to",
            "--entity-max-hops",
            "2",
            "--json",
        ]
    )


def test_ensure_stale_index_returns_journal_fallback_without_500():
    payload = _envelope(
        "index-tree.ensure",
        {
            "truth_source": "journals",
            "source": "journal-fallback",
            "freshness": {"fresh": False, "issues": ["index-b stale"]},
            "fallback": {
                "used": True,
                "reason": "index_b_stale",
                "journal_fallback_pointers": [
                    "Journals/2026/05/life-index_2026-05-01_001.md"
                ],
            },
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get("/api/index-tree/ensure", params={"from": "2026-05"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["command"] == "index-tree.ensure"
    assert body["data"]["data"]["freshness"]["fresh"] is False
    assert body["data"]["data"]["fallback"]["used"] is True
    run_json.assert_awaited_once_with(
        ["index-tree", "ensure", "--from", "2026-05", "--json"]
    )


def test_shadow_query_returns_diagnostic_only_envelope():
    payload = _envelope(
        "index-tree.shadow",
        {
            "query": "memories",
            "enabled": True,
            "diagnostic_only": True,
            "baseline_paths": [
                "Journals/2026/05/life-index_2026-05-01_001.md"
            ],
            "shadow_candidate_paths": [
                "Journals/2026/05/life-index_2026-05-01_001.md"
            ],
            "recall_preserved": True,
            "dropped_paths": [],
            "default_search_mutated": False,
            "default_smart_search_mutated": False,
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get("/api/index-tree/shadow", params={"query": "memories"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["schema_version"] == "m31.index_tree.v1"
    assert body["data"]["command"] == "index-tree.shadow"
    assert body["data"]["data"]["diagnostic_only"] is True
    assert body["data"]["data"]["default_search_mutated"] is False
    assert body["data"]["data"]["default_smart_search_mutated"] is False
    run_json.assert_awaited_once_with(
        ["index-tree", "shadow", "--query", "memories", "--json"]
    )


def test_canonical_cli_failure_returns_structured_error():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.side_effect = CLIError(1, "index-tree command failed")
        response = client.get("/api/index-tree/discover", params={"facet": "topic"})

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_ERROR"
