"""RED contract tests for the future read-only index-tree backend consumer."""

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


def test_nodes_month_level_returns_cli_envelope():
    payload = _envelope(
        "index-tree.nodes",
        {
            "truth_source": "journals",
            "level": "month",
            "nodes": [
                {
                    "node_id": "month:2026-05",
                    "level": "month",
                    "relative_path": "Journals/2026/05/index_2026-05.md",
                    "entry_count": 1,
                    "freshness": "fresh",
                    "entry_refs": [
                        {
                            "relative_path": "Journals/2026/05/life-index_2026-05-01_001.md",
                            "signals": {"topic": ["work"]},
                        }
                    ],
                    "signal_coverage": {
                        "topic": {
                            "entries_in_scope": 1,
                            "present": 1,
                            "parseable": 1,
                        }
                    },
                }
            ],
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get("/api/index-tree/nodes", params={"level": "month"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["schema_version"] == "m31.index_tree.v1"
    assert body["data"]["command"] == "index-tree.nodes"
    assert body["data"]["success"] is True
    assert body["data"]["data"]["nodes"][0]["freshness"] == "fresh"
    assert body["data"]["errors"] == []
    run_json.assert_awaited_once_with(
        ["index-tree", "nodes", "--level", "month", "--json"]
    )


def test_nodes_invalid_level_returns_structured_error_without_cli_call():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        response = client.get("/api/index-tree/nodes", params={"level": "day"})

    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    run_json.assert_not_awaited()


def test_lens_topic_signal_returns_cli_envelope():
    payload = _envelope(
        "index-tree.lens",
        {
            "truth_source": "journals",
            "privacy_level": "same_as_journals",
            "signal": "topic",
            "coverage": {"entries_in_scope": 2, "present": 2, "parseable": 2},
            "items": [
                {
                    "value": "work",
                    "count": 1,
                    "node_refs": [{"type": "month", "node_id": "month:2026-05"}],
                    "evidence_paths": [
                        "Journals/2026/05/life-index_2026-05-01_001.md"
                    ],
                    "freshness": ["fresh"],
                }
            ],
        },
    )

    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.return_value = payload
        response = client.get("/api/index-tree/lens", params={"signal": "topic"})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["schema_version"] == "m31.index_tree.v1"
    assert body["data"]["command"] == "index-tree.lens"
    assert body["data"]["data"]["privacy_level"] == "same_as_journals"
    assert body["data"]["data"]["items"][0]["evidence_paths"]
    run_json.assert_awaited_once_with(
        ["index-tree", "lens", "--signal", "topic", "--json"]
    )


def test_lens_invalid_signal_returns_structured_error_without_cli_call():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        response = client.get("/api/index-tree/lens", params={"signal": "mood"})

    assert response.status_code == 400
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    run_json.assert_not_awaited()


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


def test_nodes_cli_failure_returns_structured_error():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.side_effect = CLIError(1, "index-tree command failed")
        response = client.get("/api/index-tree/nodes", params={"level": "month"})

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_ERROR"


def test_lens_cli_failure_returns_structured_error():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.side_effect = CLIError(1, "index-tree lens command failed")
        response = client.get("/api/index-tree/lens", params={"signal": "topic"})

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_ERROR"


def test_shadow_cli_failure_returns_structured_error():
    with patch.object(CLIAdapter, "run_json", new_callable=AsyncMock) as run_json:
        run_json.side_effect = CLIError(1, "index-tree shadow command failed")
        response = client.get("/api/index-tree/shadow", params={"query": "memories"})

    assert response.status_code == 502
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "CLI_ERROR"
