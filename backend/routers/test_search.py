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
async def test_search_journals_uses_keyword_args_without_retired_semantic_flags():
    """POST /api/search no longer sends retired semantic/vector flags."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={"l2_results": []})

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "test", "level": 2, "limit": 10},
        )

    assert response.status_code == 200
    call_args = mock_adapter.run_json.call_args[0][0]
    assert call_args[0] == "search"
    assert call_args[call_args.index("--level") + 1] == "2"
    assert call_args[call_args.index("--limit") + 1] == "10"
    assert "test" in call_args
    assert "--no-semantic" not in call_args
    assert not any(arg.startswith("--semantic") for arg in call_args)
    assert "--fts-weight" not in call_args


@pytest.mark.asyncio
async def test_search_journals_ignores_retired_semantic_request_fields():
    """Retired semantic request fields are ignored and never reach the CLI."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={"l2_results": []})

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={
                "query": "sleep patterns",
                "semanticPolicy": "hybrid",
                "semanticWeight": 0.7,
                "ftsWeight": 1.3,
            },
        )

    assert response.status_code == 200
    call_args = mock_adapter.run_json.call_args[0][0]
    assert call_args[call_args.index("--level") + 1] == "3"
    assert not any(arg.startswith("--semantic") for arg in call_args)
    assert "--fts-weight" not in call_args


@pytest.mark.asyncio
async def test_search_journals_does_not_retry_retired_semantic_fallback():
    """POST /api/search treats semantic/vector errors as ordinary CLI errors."""
    from backend.adapter.cli_adapter import CLIError

    semantic_error = CLIError(
        1,
        "vector index missing: semantic search unavailable; rebuild index",
    )
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(side_effect=semantic_error)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/search",
            json={"query": "投资", "level": 2, "limit": 10},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CLI_ERROR"
    assert mock_adapter.run_json.call_count == 1
    call_args = mock_adapter.run_json.call_args_list[0][0][0]
    assert not any(arg.startswith("--semantic") for arg in call_args)
    assert "--no-semantic" not in call_args


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


CLI_SMART_SEARCH_GOLDEN = {
    # Captured from `life-index smart-search -q "最近睡得好不好"` on the
    # authorized sandbox, with values scrubbed but the CLI contract shape kept.
    "success": True,
    "query": "最近睡得好不好",
    "rewritten_query": "最近睡得好不好",
    "filtered_results": [
        {
            "date": "2026-06-02",
            "similarity": 0.71,
            "source": "semantic_fallback",
            "path": "D:/sandbox/Journals/2026/06/life-index_2026-06-02_001.md",
            "rel_path": "Journals/2026/06/life-index_2026-06-02_001.md",
            "journal_route_path": "2026/06/life-index_2026-06-02_001.md",
            "title": "Sleep note",
            "snippet": "Slept late and woke tired.",
            "location": "Home",
            "weather": "Cloudy",
            "metadata": {
                "title": "Sleep note",
                "topic": "health",
                "mood": "tired",
                "people": "Alice, Bob",
                "project": "Recovery",
                "tags": "sleep, v1",
                "location": "Home",
                "abstract": "Slept late and woke tired.",
            },
            "related_entries": [],
            "backlinked_by": [],
            "search_rank": 1,
            "rrf_score": 0.5,
            "final_score": 0.7,
            "relevance_score": 0.7,
            "fts_score": 0.0,
            "semantic_score": 0.7,
            "confidence": 0.7,
            "title_promoted": False,
        },
        {
            "date": "2026-06-03",
            "similarity": 0.63,
            "source": "semantic_fallback",
            "path": "D:/sandbox/Journals/2026/06/life-index_2026-06-03_001.md",
            "rel_path": "Journals/2026/06/life-index_2026-06-03_001.md",
            "journal_route_path": "2026/06/life-index_2026-06-03_001.md",
            "title": "Sleep follow-up",
            "snippet": "Sleep was still unstable.",
            "metadata": {
                "title": "Sleep follow-up",
                "topic": ["health"],
                "mood": ["uneasy"],
                "tags": ["sleep", "follow-up"],
            },
            "related_entries": [],
            "backlinked_by": [],
            "search_rank": 2,
            "semantic_score": 0.63,
        },
    ],
    "summary": {
        "result_count": 2,
        "strategy": "keyword_with_semantic_fallback",
    },
    "citations": [
        {"path": "Journals/2026/06/life-index_2026-06-02_001.md"},
        {"path": "Journals/2026/06/life-index_2026-06-03_001.md"},
    ],
    "agent_unavailable": True,
    "performance": {"total_ms": 12477.41},
    "semantic_fallback_used": True,
    "smart_search_mode": "deterministic_scaffold",
    "agent_instructions": "Use filtered_results as evidence.",
    "answer_scaffold": {
        "step": "synthesize",
        "description": "Summarize sleep-related evidence from filtered results.",
    },
    "query_plan": {"strategy": "keyword_with_semantic_fallback"},
    "agent_decisions_summary": {"mode": "deterministic"},
    "schema_version": "smart_search.v1",
}


@pytest.mark.asyncio
async def test_smart_search_endpoint_maps_real_cli_filtered_results_to_evidence():
    """POST /api/smart-search maps current CLI filtered_results into evidence."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=CLI_SMART_SEARCH_GOLDEN)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "最近睡得好不好"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert "scaffold" in data
    assert "evidence" in data
    assert data["provenance"] == "deterministic_scaffold"
    assert data["scaffold"] == [CLI_SMART_SEARCH_GOLDEN["answer_scaffold"]]
    assert len(data["evidence"]) == len(CLI_SMART_SEARCH_GOLDEN["filtered_results"])
    assert len(data["evidence"]) > 0
    for evidence in data["evidence"]:
        assert evidence["title"]
        assert evidence["date"]
        assert evidence["path"]
    assert data["evidence"][0]["title"] == "Sleep note"
    assert data["evidence"][0]["abstract"] == "Slept late and woke tired."


@pytest.mark.asyncio
async def test_smart_search_endpoint_preserves_evidence_people_project_tags():
    """POST /api/smart-search preserves v1 metadata on evidence entries."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=CLI_SMART_SEARCH_GOLDEN)

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
    assert evidence["project"] == "Recovery"
    assert evidence["tags"] == ["sleep", "v1"]


@pytest.mark.asyncio
async def test_smart_search_endpoint_preserves_cli_metadata():
    """POST /api/smart-search preserves current CLI metadata fields."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=CLI_SMART_SEARCH_GOLDEN)

    with patch("backend.routers.search.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/smart-search",
            json={"query": "test"},
        )

    assert response.status_code == 200
    payload = response.json()
    envelope_meta = payload["meta"]
    assert envelope_meta["schemaVersion"] == "smart_search.v1"
    assert envelope_meta["smartSearchMode"] == "deterministic_scaffold"
    assert envelope_meta["semanticFallbackUsed"] is True
    assert envelope_meta["queryPlanStrategy"] == "keyword_with_semantic_fallback"
    assert len(envelope_meta["citations"]) == 2
    meta = payload["data"]["meta"]
    assert meta["schemaVersion"] == "smart_search.v1"
    assert meta["smartSearchMode"] == "deterministic_scaffold"
    assert meta["semanticFallbackUsed"] is True
    assert meta["queryPlanStrategy"] == "keyword_with_semantic_fallback"
    assert len(meta["citations"]) == 2


@pytest.mark.asyncio
async def test_smart_search_endpoint_uses_build_smart_search_args():
    """POST /api/smart-search calls CLI with args from build_smart_search_args."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={
        "filtered_results": [],
        "answer_scaffold": [],
        "smart_search_mode": "deterministic_scaffold",
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
