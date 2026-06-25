"""Tests for search router — CLI-backed full-text search."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


@pytest.mark.asyncio
async def test_search_journals_success():
    """POST /api/search returns matched journals."""
    mock_data = {
        "l2_results": [
            {
                "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                "date": "2026-04-19",
                "title": "Search Result",
                "metadata": {
                    "title": "Search Result",
                    "topic": "Travel",
                    "mood": "Excited",
                },
            }
        ],
        "total_found": 1,
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "travel", "level": 2, "limit": 10},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["total"] == 1
    assert len(data["results"]) == 1
    assert data["results"][0]["title"] == "Search Result"


@pytest.mark.asyncio
async def test_search_journals_uses_first_non_empty_cli_results_list():
    """POST /api/search ignores empty result buckets when later buckets have data."""
    mock_data = {
        "merged_results": [],
        "l2_results": [
            {
                "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                "date": "2026-04-19",
                "metadata": {"title": "L2 Result"},
            }
        ],
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "travel", "level": 2, "limit": 10},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert len(payload["data"]["results"]) == 1
    assert payload["data"]["results"][0]["title"] == "L2 Result"


@pytest.mark.asyncio
async def test_search_journals_enforces_limit_and_total_matches():
    """POST /api/search caps GUI results and reads current CLI total fields."""
    mock_data = {
        "merged_results": [
            {
                "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                "date": "2026-04-19",
                "metadata": {"title": "First"},
            },
            {
                "rel_path": "Journals/2026/04/life-index_2026-04-20_001.md",
                "date": "2026-04-20",
                "metadata": {"title": "Second"},
            },
        ],
        "total_matches": 9,
        "total_available": 12,
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "travel", "level": 3, "limit": 1},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["total"] == 9
    assert len(data["results"]) == 1
    assert data["results"][0]["title"] == "First"


@pytest.mark.asyncio
async def test_search_journals_preserves_people_project_tags_metadata():
    """POST /api/search preserves v1 journal metadata fields from CLI results."""
    mock_data = {
        "merged_results": [
            {
                "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                "date": "2026-04-19",
                "metadata": {
                    "title": "Metadata Rich Result",
                    "topic": "work",
                    "mood": ["focused"],
                    "people": ["Alice", "Bob"],
                    "project": "Life Index",
                    "tags": ["search", "v1"],
                },
            },
        ],
        "total_matches": 1,
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "metadata", "level": 3, "limit": 10},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    result = payload["data"]["results"][0]
    assert result["people"] == ["Alice", "Bob"]
    assert result["project"] == "Life Index"
    assert result["tags"] == ["search", "v1"]


@pytest.mark.asyncio
async def test_search_journals_with_filters():
    """POST /api/search passes topic/mood/people/date filters to CLI."""
    mock_data = {"l1_results": [], "total_found": 0}

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={
                "query": "",
                "topics": ["Work", "Life"],
                "moods": ["Calm"],
                "people": ["Alice"],
                "dateStart": "2026-01-01",
                "dateEnd": "2026-12-31",
                "limit": 5,
                "level": 1,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    # Verify CLI was called with the right args
    call_args = mock_adapter.run_json.call_args[0][0]
    assert "--topic" in call_args
    assert "Work" in call_args
    assert "--mood" in call_args
    assert "--people" in call_args
    assert "--date-from" in call_args
    assert "--date-to" in call_args


@pytest.mark.asyncio
async def test_search_journals_disables_semantic_by_default():
    """POST /api/search uses keyword-only CLI search unless explicitly expanded."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={"l2_results": []})

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "test", "level": 2, "limit": 10},
        )

    assert response.status_code == 200
    call_args = mock_adapter.run_json.call_args[0][0]
    assert "--no-semantic" in call_args


@pytest.mark.asyncio
async def test_search_journals_cli_error():
    """POST /api/search returns error envelope when CLI fails."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        side_effect=CLIError(1, "search index corrupted")
    )

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "test", "level": 2, "limit": 10},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CLI_ERROR"


def test_smart_search_contract_args_exclude_use_llm():
    """S1 gate: smart-search CLI contract uses --query without --use-llm.

    Smart-search must not default to LLM orchestration. The adapter helper
    must construct args that call 'smart-search --query <q>' deterministically.
    """
    from backend.routers.search import build_smart_search_args

    args = build_smart_search_args("what did I do last summer")

    assert args[0] == "smart-search"
    assert "--query" in args
    assert "what did I do last summer" in args
    assert "--use-llm" not in args


# --- S4 Exit Gate: Smart-search endpoint tests ---


@pytest.mark.asyncio
async def test_smart_search_endpoint_success():
    """POST /api/smart-search returns scaffold/evidence with provenance."""
    mock_data = {
        "scaffold": [
            {"step": "retrieve", "description": "Searching journal entries"},
            {"step": "evidence", "description": "Compiling evidence from results"},
        ],
        "evidence": [
            {
                "rel_path": "Journals/2026/05/life-index_2026-05-10_001.md",
                "date": "2026-05-10",
                "title": "Summer Trip",
                "metadata": {"topic": "Travel", "mood": "Excited"},
            }
        ],
        "provenance": "deterministic",
        "schema_version": "1.0",
        "events": [{"type": "search", "detail": "keyword scan"}],
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "what did I do last summer"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert "scaffold" in data
    assert "evidence" in data
    assert data["provenance"] == "deterministic"
    assert len(data["evidence"]) == 1
    assert data["evidence"][0]["title"] == "Summer Trip"


@pytest.mark.asyncio
async def test_smart_search_endpoint_preserves_evidence_people_project_tags():
    """POST /api/smart-search preserves v1 metadata on evidence entries."""
    mock_data = {
        "scaffold": [],
        "evidence": [
            {
                "rel_path": "Journals/2026/05/life-index_2026-05-10_001.md",
                "date": "2026-05-10",
                "metadata": {
                    "title": "Summer Trip",
                    "topic": "Travel",
                    "mood": "Excited",
                    "people": "Alice, Bob",
                    "project": "Vacation",
                    "tags": "travel, v1",
                },
            }
        ],
        "provenance": "deterministic",
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "summer"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    evidence = payload["data"]["evidence"][0]
    assert evidence["people"] == ["Alice", "Bob"]
    assert evidence["project"] == "Vacation"
    assert evidence["tags"] == ["travel", "v1"]


@pytest.mark.asyncio
async def test_smart_search_endpoint_preserves_cli_metadata():
    """POST /api/smart-search preserves schema_version, provenance, events."""
    mock_data = {
        "scaffold": [],
        "evidence": [],
        "provenance": "deterministic",
        "schema_version": "2.1",
        "events": [{"type": "index_scan"}, {"type": "evidence_compile"}],
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "test"},
        )

    assert response.status_code == 200
    payload = response.json()
    envelope_meta = payload["meta"]
    assert envelope_meta["schemaVersion"] == "2.1"
    assert envelope_meta["provenance"] == "deterministic"
    assert len(envelope_meta["events"]) == 2
    meta = payload["data"]["meta"]
    assert meta["schemaVersion"] == "2.1"
    assert meta["provenance"] == "deterministic"
    assert len(meta["events"]) == 2


@pytest.mark.asyncio
async def test_smart_search_endpoint_uses_build_smart_search_args():
    """POST /api/smart-search calls CLI with args from build_smart_search_args."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "scaffold": [], "evidence": [], "provenance": "deterministic",
    })

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "my summer vacation"},
        )

    assert response.status_code == 200
    call_args = mock_adapter.run_json.call_args[0][0]
    assert call_args[0] == "smart-search"
    assert "--query" in call_args
    assert "my summer vacation" in call_args
    assert "--use-llm" not in call_args


@pytest.mark.asyncio
async def test_smart_search_endpoint_cli_error():
    """POST /api/smart-search returns error envelope when CLI fails."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        side_effect=CLIError(1, "smart-search index corrupted")
    )

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "test"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CLI_ERROR"


@pytest.mark.asyncio
async def test_smart_search_endpoint_empty_results():
    """POST /api/smart-search returns empty scaffold/evidence with provenance."""
    mock_data = {
        "scaffold": [],
        "evidence": [],
        "provenance": "deterministic",
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "nonexistent content xyz"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["scaffold"] == []
    assert data["evidence"] == []
    assert data["provenance"] == "deterministic"


@pytest.mark.asyncio
async def test_keyword_search_preserves_cli_totals_and_schema():
    """POST /api/search preserves CLI totals, schema_version, and events."""
    mock_data = {
        "merged_results": [
            {
                "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                "date": "2026-04-19",
                "metadata": {"title": "Result"},
            },
        ],
        "total_matches": 5,
        "total_available": 10,
        "schema_version": "1.3",
        "events": [{"type": "keyword_scan"}],
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "travel", "level": 3, "limit": 20},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["total"] == 5
    assert payload["meta"]["schemaVersion"] == "1.3"
    assert payload["meta"]["events"] == [{"type": "keyword_scan"}]
    assert payload["data"]["meta"]["schemaVersion"] == "1.3"
    assert payload["data"]["meta"]["events"] == [{"type": "keyword_scan"}]
