"""Tests for entity graph router — read/review CLI surfaces."""

import json
import shutil
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.main import app

client = TestClient(app)


def test_get_entity_stats_calls_cli_stats():
    """GET /api/entities/stats exposes entity graph stats."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {"total_entities": 13, "total_relationships": 22},
            "schema_version": "v1.1.1",
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["total_entities"] == 13
    assert payload["data"]["total_relationships"] == 22
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--stats"]


def test_list_entities_passes_optional_type_filter():
    """GET /api/entities optionally filters by entity type."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": [{"id": "person-a", "type": "person", "primary_name": "A"}],
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities?type=person")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"][0]["id"] == "person-a"
    assert mock_adapter.run_json.call_args[0][0] == [
        "entity",
        "--list",
        "--type",
        "person",
    ]


def test_check_entities_calls_cli_check():
    """GET /api/entities/check exposes graph integrity issues."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={"success": True, "data": {"issues": [], "total_entities": 13}}
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/check")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["issues"] == []
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--check"]


def test_review_entities_calls_cli_review():
    """GET /api/entities/review exposes graph curation queue."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {"queue": [{"item_id": "review-1"}], "total": 1},
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/review")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["total"] == 1
    assert payload["data"]["queue"][0]["item_id"] == "review-1"
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--review"]


def test_audit_entities_calls_cli_audit():
    """GET /api/entities/audit exposes entity quality audit."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {"issues": [{"type": "possible_duplicate"}], "summary": {"high": 1}},
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/audit")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["summary"]["high"] == 1
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--audit"]


def test_candidate_edges_caps_large_cli_output():
    """GET /api/entities/candidate-edges caps huge read-only candidate output."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "candidates": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "A", "target": "D"},
            ],
            "total": 3,
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/candidate-edges?limit=2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["total"] == 3
    assert len(payload["data"]["candidates"]) == 2
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--candidate-edges"]


def test_preview_delete_uses_cli_preview_without_serialized_mutation():
    """POST /api/entities/mutations/preview previews delete through CLI."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {"deleted_id": "person-a", "cleaned_refs": []},
            "schema_version": "v1.1.1",
            "provenance": {"generator": "entity"},
        }
    )
    mock_adapter.run_serialized = AsyncMock()

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/preview",
            json={"operation": "delete", "entityId": "person-a"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["operation"] == "delete"
    assert payload["data"]["requiresConfirmation"] is True
    assert payload["data"]["preview"]["deleted_id"] == "person-a"
    assert payload["data"]["schemaVersion"] == "v1.1.1"
    assert mock_adapter.run_json.call_args[0][0] == [
        "entity",
        "--delete",
        "--preview",
        "--id",
        "person-a",
    ]
    mock_adapter.run_serialized.assert_not_called()


def test_preview_merge_uses_review_preview_surface():
    """Merge preview uses CLI review preview because direct merge has no dry-run."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {
                "item_id": "person-b",
                "action": "merge_as_alias",
                "changes": [{"type": "merge"}],
            },
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/preview",
            json={
                "operation": "merge_as_alias",
                "sourceId": "person-b",
                "targetId": "person-a",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["preview"]["changes"][0]["type"] == "merge"
    assert mock_adapter.run_json.call_args[0][0] == [
        "entity",
        "--review",
        "--action",
        "preview",
        "--id",
        "person-b",
        "--target-id",
        "person-a",
    ]


def test_confirm_entity_mutation_requires_preview_acceptance():
    """Confirm endpoint refuses mutation without explicit preview acceptance."""
    mock_adapter = MagicMock()

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/confirm",
            json={"operation": "delete", "entityId": "person-a"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PREVIEW_REQUIRED"
    mock_adapter.run_json.assert_not_called()
    mock_adapter.run_serialized.assert_not_called()


def test_confirm_delete_runs_serialized_mutation_then_entity_check():
    """Delete confirmation mutates via CLI and immediately runs post-check."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value=json.dumps(
            {
                "success": True,
                "data": {"deleted_id": "person-a", "cleaned_refs": []},
                "schema_version": "v1.1.1",
            }
        )
    )
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {"total_entities": 2, "issues": []},
            "schema_version": "v1.1.1",
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/confirm",
            json={
                "operation": "delete",
                "entityId": "person-a",
                "previewAccepted": True,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["mutation"]["deleted_id"] == "person-a"
    assert payload["data"]["postCheck"]["issues"] == []
    assert mock_adapter.run_serialized.call_args[0][0] == [
        "entity",
        "--delete",
        "--id",
        "person-a",
    ]
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--check"]


def test_confirm_merge_uses_cli_merge_and_post_check():
    """Merge confirmation uses the CLI's historical --merge argument shape."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value=json.dumps(
            {
                "success": True,
                "action": "merge_as_alias",
                "source_id": "person-b",
                "target_id": "person-a",
                "transferred_names": ["张叁"],
            }
        )
    )
    mock_adapter.run_json = AsyncMock(
        return_value={"success": True, "data": {"total_entities": 2, "issues": []}}
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/confirm",
            json={
                "operation": "merge_as_alias",
                "sourceId": "person-b",
                "targetId": "person-a",
                "previewAccepted": True,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["mutation"]["action"] == "merge_as_alias"
    assert mock_adapter.run_serialized.call_args[0][0] == [
        "entity",
        "--merge",
        "person-b",
        "--id",
        "person-b",
        "--target-id",
        "person-a",
    ]
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--check"]


def test_add_alias_mutation_is_rejected_until_cli_preview_contract_exists():
    """Update/add-alias is not exposed because current CLI has no preview mode."""
    mock_adapter = MagicMock()

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/preview",
            json={
                "operation": "add_alias",
                "entityId": "person-a",
                "alias": "老张",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "UNSUPPORTED_ENTITY_MUTATION"
    mock_adapter.run_json.assert_not_called()


@pytest.mark.skipif(
    shutil.which(config.CLI_COMMAND) is None,
    reason="life-index CLI is not installed on PATH",
)
def test_real_cli_entity_stats_read_only():
    """GET /api/entities/stats works against the real read-only CLI surface."""
    response = client.get("/api/entities/stats")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert isinstance(payload["data"]["total_entities"], int)


@pytest.mark.skipif(
    shutil.which(config.CLI_COMMAND) is None,
    reason="life-index CLI is not installed on PATH",
)
def test_real_cli_entity_delete_preview_and_confirm_sandbox(tmp_path, monkeypatch):
    """Entity delete mutation runs only against a sandbox LIFE_INDEX_DATA_DIR."""
    monkeypatch.setenv("LIFE_INDEX_DATA_DIR", str(tmp_path))
    (tmp_path / "entity_graph.yaml").write_text(
        """
entities:
  - id: person-a
    type: person
    primary_name: Zhang San
    aliases: []
    attributes: {}
    relationships: []
  - id: person-b
    type: person
    primary_name: Li Si
    aliases: []
    attributes: {}
    relationships:
      - target: person-a
        relation: colleague_of
""".strip(),
        encoding="utf-8",
    )

    preview_response = client.post(
        "/api/entities/mutations/preview",
        json={"operation": "delete", "entityId": "person-a"},
    )

    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["ok"] is True
    assert preview_payload["data"]["preview"]["deleted_id"] == "person-a"
    assert preview_payload["data"]["preview"]["cleaned_refs"][0]["entity_id"] == "person-b"

    confirm_response = client.post(
        "/api/entities/mutations/confirm",
        json={
            "operation": "delete",
            "entityId": "person-a",
            "previewAccepted": True,
        },
    )

    assert confirm_response.status_code == 200
    confirm_payload = confirm_response.json()
    assert confirm_payload["ok"] is True
    assert confirm_payload["data"]["mutation"]["deleted_id"] == "person-a"
    assert confirm_payload["data"]["postCheck"]["issues"] == []

    list_response = client.get("/api/entities")
    listed_ids = {item["id"] for item in list_response.json()["data"]}
    assert listed_ids == {"person-b"}
