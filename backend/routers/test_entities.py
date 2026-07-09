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
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--review", "--json"]


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


def test_get_entity_profile_by_id_calls_cli_profile_and_preserves_payload():
    """GET /api/entities/profile?id=... consumes CLI entity profile JSON."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "v1.1.1",
            "provenance": {"generator": "entity"},
            "data": {
                "identity": {
                    "entity_id": "actor-alice",
                    "primary_name": "Alice",
                    "aliases": ["Ally"],
                    "type": "actor",
                    "kind": "human",
                    "status": "confirmed",
                    "is_self": True,
                },
                "relationships": [
                    {
                        "target": "actor-bob",
                        "target_name": "Bob",
                        "relation": "friend_of",
                        "source": "user",
                        "status": "confirmed",
                        "evidence": ["Journals/2026/03/life-index_2026-03-15_001.md"],
                    }
                ],
                "mentions": [
                    {
                        "rel_path": "Journals/2026/03/life-index_2026-03-15_001.md",
                        "date": "2026-03-15",
                        "title": "Primary Mention",
                    }
                ],
                "evidence": ["Journals/2026/03/life-index_2026-03-15_001.md"],
                "stats": {
                    "first_mention": "2026-03-15",
                    "latest_mention": "2026-03-15",
                    "mention_count": 1,
                    "relationship_count": 1,
                },
            },
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/profile?id=actor-alice")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["identity"]["entity_id"] == "actor-alice"
    assert payload["data"]["relationships"][0]["status"] == "confirmed"
    assert payload["data"]["mentions"][0]["rel_path"].startswith("Journals/")
    assert payload["data"]["schemaVersion"] == "v1.1.1"
    assert payload["data"]["provenance"]["generator"] == "entity"
    assert mock_adapter.run_json.call_args[0][0] == [
        "entity",
        "profile",
        "--id",
        "actor-alice",
        "--json",
    ]


def test_get_entity_profile_by_name_calls_cli_profile_name_selector():
    """GET /api/entities/profile?name=... preserves the CLI name selector."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {
                "identity": {
                    "entity_id": "actor-alice",
                    "primary_name": "Alice",
                    "aliases": ["Ally"],
                    "type": "actor",
                    "kind": "human",
                    "status": "confirmed",
                    "is_self": False,
                },
                "relationships": [],
                "mentions": [],
                "evidence": [],
                "stats": {"mention_count": 0, "relationship_count": 0},
            },
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/profile?name=Ally")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert mock_adapter.run_json.call_args[0][0] == [
        "entity",
        "profile",
        "--name",
        "Ally",
        "--json",
    ]


def test_get_entity_profile_requires_exactly_one_selector():
    """Profile endpoint fails closed unless exactly one selector is present."""
    response = client.get("/api/entities/profile")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "VALIDATION_ERROR"

    response = client.get("/api/entities/profile?id=actor-alice&name=Alice")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "VALIDATION_ERROR"


def test_get_entity_profile_candidate_fails_closed_with_review_details():
    """Candidate entities must not render as confirmed GUI profiles."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": False,
            "data": {
                "entity_id": "actor-morgan",
                "status": "candidate",
                "suggested_command": "life-index entity --review",
            },
            "error": {
                "code": "ENTITY_PROFILE_CANDIDATE",
                "message": "candidate entities do not have confirmed profiles",
            },
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/entities/profile?id=actor-morgan")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ENTITY_PROFILE_CANDIDATE"
    assert payload["error"]["details"]["suggested_command"] == "life-index entity --review"


def test_preview_delete_uses_cli_preview_without_serialized_mutation():
    """POST /api/entities/mutations/preview previews delete through CLI."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {
                "workflow": "maintain.delete",
                "preview": True,
                "applied": False,
                "backup_path": None,
                "deleted_id": "person-a",
                "deleted_name": "Zhang San",
                "cleaned_refs": [{"entity_id": "person-b", "relation": "colleague_of"}],
            },
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
    assert payload["data"]["preview"]["cleaned_refs"][0]["entity_id"] == "person-b"
    assert payload["data"]["schemaVersion"] == "v1.1.1"
    assert mock_adapter.run_json.call_args[0][0] == [
        "entity",
        "maintain",
        "--delete",
        "--id",
        "person-a",
        "--preview",
        "--json",
    ]
    mock_adapter.run_serialized.assert_not_called()


def test_preview_delete_passthroughs_maintain_not_found_error():
    """Delete preview preserves structured maintain errors from the CLI."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": False,
            "error": {
                "code": "ENTITY_MAINTAIN_DELETE_NOT_FOUND",
                "message": "Entity not found: person-missing",
            },
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/preview",
            json={"operation": "delete", "entityId": "person-missing"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ENTITY_MAINTAIN_DELETE_NOT_FOUND"
    assert payload["error"]["message"] == "Entity not found: person-missing"


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
        "--review-action",
        "merge_as_alias",
        "--id",
        "person-b",
        "--source-id",
        "person-b",
        "--target-id",
        "person-a",
        "--json",
    ]


def test_preview_review_action_uses_structured_contract_args():
    """Review action previews consume the CLI #155 structured action contract."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "data": {
                "item_id": "review-1",
                "action": "keep_separate",
                "preview": True,
                "will_write": [{"type": "not_duplicate_of"}],
            },
            "schema_version": "v1.4.1",
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/preview",
            json={
                "operation": "keep_separate",
                "reviewItemId": "review-1",
                "sourceId": "person-b",
                "targetId": "person-a",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["preview"]["action"] == "keep_separate"
    assert mock_adapter.run_json.call_args[0][0] == [
        "entity",
        "--review",
        "--action",
        "preview",
        "--review-action",
        "keep_separate",
        "--id",
        "review-1",
        "--source-id",
        "person-b",
        "--target-id",
        "person-a",
        "--json",
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
                "data": {
                    "workflow": "maintain.delete",
                    "preview": False,
                    "applied": True,
                    "backup_path": "entity_graph.yaml.backup_20260705_120000",
                    "deleted_id": "person-a",
                    "deleted_name": "Zhang San",
                    "cleaned_refs": [
                        {"entity_id": "person-b", "relation": "colleague_of"}
                    ],
                },
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
    assert payload["data"]["mutation"]["backup_path"].endswith(
        "entity_graph.yaml.backup_20260705_120000"
    )
    assert payload["data"]["mutation"]["cleaned_refs"][0]["entity_id"] == "person-b"
    assert payload["data"]["postCheck"]["issues"] == []
    assert mock_adapter.run_serialized.call_args[0][0] == [
        "entity",
        "maintain",
        "--delete",
        "--id",
        "person-a",
        "--apply",
        "--backup",
        "--json",
    ]
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--check"]


def test_confirm_delete_passthroughs_maintain_backup_required_error():
    """Delete confirmation preserves structured maintain errors before post-check."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value=json.dumps(
            {
                "success": False,
                "error": {
                    "code": "ENTITY_MAINTAIN_DELETE_BACKUP_REQUIRED",
                    "message": "entity maintain --delete --apply requires --backup",
                },
            }
        )
    )
    mock_adapter.run_json = AsyncMock()

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
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ENTITY_MAINTAIN_DELETE_BACKUP_REQUIRED"
    assert "requires --backup" in payload["error"]["message"]
    mock_adapter.run_json.assert_not_called()


def test_confirm_merge_uses_cli_merge_and_post_check():
    """Merge confirmation uses the CLI review action surface."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value=json.dumps(
            {
                "success": True,
                "data": {
                    "action": "merge_as_alias",
                    "source_id": "person-b",
                    "target_id": "person-a",
                    "transferred_names": ["张叁"],
                },
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
        "--review",
        "--action",
        "merge_as_alias",
        "--id",
        "person-b",
        "--source-id",
        "person-b",
        "--target-id",
        "person-a",
        "--json",
    ]
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--check"]


def test_confirm_review_action_uses_structured_contract_args_and_post_check():
    """Review action apply uses the same serialized mutation path as existing mutations."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value=json.dumps(
            {
                "success": True,
                "data": {
                    "item_id": "review-2",
                    "action": "reject_candidate",
                    "applied": True,
                    "source_id": "candidate-a",
                },
                "schema_version": "v1.4.1",
            }
        )
    )
    mock_adapter.run_json = AsyncMock(
        return_value={"success": True, "data": {"total_entities": 3, "issues": []}}
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/confirm",
            json={
                "operation": "reject_candidate",
                "reviewItemId": "review-2",
                "sourceId": "candidate-a",
                "previewAccepted": True,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["mutation"]["action"] == "reject_candidate"
    assert mock_adapter.run_serialized.call_args[0][0] == [
        "entity",
        "--review",
        "--action",
        "reject_candidate",
        "--id",
        "review-2",
        "--source-id",
        "candidate-a",
        "--json",
    ]
    assert mock_adapter.run_json.call_args[0][0] == ["entity", "--check"]


def test_preview_review_action_passthroughs_cli_error_details():
    """Review action preview failures remain fail-closed and preserve CLI details."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": False,
            "error": {
                "code": "ENTITY_REVIEW_ACTION_INVALID",
                "message": "review action is not available for this item",
            },
            "data": {"item_id": "review-9", "action": "confirm_candidate"},
        }
    )

    with patch("backend.routers.entities.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/entities/mutations/preview",
            json={
                "operation": "confirm_candidate",
                "reviewItemId": "review-9",
                "sourceId": "candidate-a",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ENTITY_REVIEW_ACTION_INVALID"
    assert payload["error"]["details"]["item_id"] == "review-9"


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
def test_real_cli_entity_stats_read_only(tmp_path, monkeypatch):
    """GET /api/entities/stats works against a valid real CLI sandbox graph."""
    monkeypatch.setenv("LIFE_INDEX_DATA_DIR", str(tmp_path))
    (tmp_path / "entity_graph.yaml").write_text(
        """
entities:
  - id: person-a
    type: actor
    primary_name: Zhang San
    aliases: []
    attributes:
      kind: human
    relationships: []
""".strip(),
        encoding="utf-8",
    )

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
    type: actor
    primary_name: Zhang San
    aliases: []
    attributes:
      kind: human
    relationships: []
  - id: person-b
    type: actor
    primary_name: Li Si
    aliases: []
    attributes:
      kind: human
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
    assert confirm_payload["data"]["mutation"]["backup_path"]
    assert confirm_payload["data"]["mutation"]["cleaned_refs"][0]["entity_id"] == "person-b"
    assert confirm_payload["data"]["postCheck"]["issues"] == []

    list_response = client.get("/api/entities")
    listed_ids = {item["id"] for item in list_response.json()["data"]}
    assert listed_ids == {"person-b"}


@pytest.mark.skipif(
    shutil.which(config.CLI_COMMAND) is None,
    reason="life-index CLI is not installed on PATH",
)
def test_real_cli_entity_merge_preview_and_confirm_sandbox(tmp_path, monkeypatch):
    """Entity merge mutation uses the real review action CLI surface in a sandbox."""
    monkeypatch.setenv("LIFE_INDEX_DATA_DIR", str(tmp_path))
    (tmp_path / "entity_graph.yaml").write_text(
        """
entities:
  - id: person-a
    type: actor
    primary_name: Zhang San
    aliases: []
    attributes:
      kind: human
    relationships: []
  - id: person-b
    type: actor
    primary_name: Zhang S.
    aliases:
      - Old Zhang
    attributes:
      kind: human
    relationships:
      - target: place-a
        relation: visited
  - id: place-a
    type: place
    primary_name: Western Sichuan
    aliases: []
    attributes: {}
    relationships: []
""".strip(),
        encoding="utf-8",
    )

    preview_response = client.post(
        "/api/entities/mutations/preview",
        json={
            "operation": "merge_as_alias",
            "sourceId": "person-b",
            "targetId": "person-a",
        },
    )

    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["ok"] is True
    assert preview_payload["data"]["preview"]["action"] == "merge_as_alias"

    confirm_response = client.post(
        "/api/entities/mutations/confirm",
        json={
            "operation": "merge_as_alias",
            "sourceId": "person-b",
            "targetId": "person-a",
            "previewAccepted": True,
        },
    )

    assert confirm_response.status_code == 200
    confirm_payload = confirm_response.json()
    assert confirm_payload["ok"] is True
    assert confirm_payload["data"]["mutation"]["action"] == "merge_as_alias"
    assert confirm_payload["data"]["mutation"]["source_id"] == "person-b"
    assert confirm_payload["data"]["mutation"]["target_id"] == "person-a"
    assert confirm_payload["data"]["postCheck"]["issues"] == []

    list_response = client.get("/api/entities")
    listed_ids = {item["id"] for item in list_response.json()["data"]}
    assert listed_ids == {"person-a", "place-a"}
