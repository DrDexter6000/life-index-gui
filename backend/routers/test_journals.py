"""Tests for journals router — CLI-backed list, detail, write, edit."""

import io
import json
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient

import backend.routers.journals as journals_module
from backend.main import app

client = TestClient(app)


def _patch_cli_adapter(return_value=None, side_effect=None, json_return=None):
    """Patch CLIAdapter methods for a test."""
    patches = []

    def enter():
        mock_adapter = MagicMock()
        if return_value is not None:
            mock_adapter.run = AsyncMock(return_value=return_value)
        if side_effect is not None:
            mock_adapter.run = AsyncMock(side_effect=side_effect)
        if json_return is not None:
            mock_adapter.run_json = AsyncMock(return_value=json_return)

        p = patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter)
        patches.append(p)
        p.start()
        return mock_adapter

    def exit():
        for p in patches:
            p.stop()

    return enter, exit


@pytest.mark.asyncio
async def test_list_journals_success():
    """GET /api/journals returns a list of journal summaries via journal list --recent."""
    mock_data = {
        "success": True,
        "schema_version": "m16.journal.v0",
        "data": {
            "items": [
                {
                    "id": "2026/04/life-index_2026-04-19_001",
                    "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                    "journal_route_path": "2026/04/life-index_2026-04-19_001.md",
                    "title": "Test Entry",
                    "date": "2026-04-19",
                    "metadata": {
                        "topic": "Work",
                        "mood": "Calm",
                        "location": "Shanghai",
                    },
                    "attachments": [],
                    "word_count": 3,
                }
            ],
            "total_matches": 1,
            "total_found": 1,
            "limit": 20,
            "offset": 0,
            "has_more": False,
            "sort": "date_desc",
        },
        "error": None,
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/journals?limit=5")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert len(data) == 1
    assert data[0]["title"] == "Test Entry"
    assert data[0]["topics"] == ["Work"]
    assert data[0]["moods"] == ["Calm"]
    assert mock_adapter.run_json.call_args[0][0] == [
        "journal",
        "list",
        "--recent",
        "--limit",
        "5",
        "--json",
    ]


@pytest.mark.asyncio
async def test_list_journals_enforces_gui_limit_when_cli_returns_more():
    """GET /api/journals caps output even if CLI returns extra rows."""
    mock_data = {
        "success": True,
        "schema_version": "m16.journal.v0",
        "data": {
            "items": [
                {
                    "id": f"2026/04/life-index_2026-04-{day:02d}_001",
                    "rel_path": f"Journals/2026/04/life-index_2026-04-{day:02d}_001.md",
                    "journal_route_path": f"2026/04/life-index_2026-04-{day:02d}_001.md",
                    "title": f"Entry {day}",
                    "date": f"2026-04-{day:02d}",
                    "metadata": {},
                    "attachments": [],
                    "word_count": 10,
                }
                for day in range(1, 4)
            ],
            "total_matches": 3,
            "total_found": 3,
            "limit": 1,
            "offset": 0,
            "has_more": True,
            "sort": "date_desc",
        },
        "error": None,
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/journals?limit=1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert len(payload["data"]) == 1
    assert payload["data"][0]["title"] == "Entry 1"


@pytest.mark.asyncio
async def test_list_journals_filters_generated_index_documents():
    """GET /api/journals defensively filters non-journal items from a mixed payload."""
    mock_data = {
        "success": True,
        "schema_version": "m16.journal.v0",
        "data": {
            "items": [
                {
                    "id": "2026/04/index_2026-04",
                    "rel_path": "Journals/2026/04/index_2026-04.md",
                    "journal_route_path": "2026/04/index_2026-04.md",
                    "title": "",
                    "date": "",
                    "metadata": {},
                    "attachments": [],
                    "word_count": 0,
                },
                {
                    "id": "2026/04/monthly_report_2026-04",
                    "rel_path": "Journals/2026/04/monthly_report_2026-04.md",
                    "journal_route_path": "2026/04/monthly_report_2026-04.md",
                    "title": "",
                    "date": "",
                    "metadata": {},
                    "attachments": [],
                    "word_count": 0,
                },
                {
                    "id": "2026/04/life-index_2026-04-19_001",
                    "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                    "journal_route_path": "2026/04/life-index_2026-04-19_001.md",
                    "title": "Real Journal",
                    "date": "2026-04-19",
                    "metadata": {},
                    "attachments": [],
                    "word_count": 5,
                },
            ],
            "total_matches": 3,
            "total_found": 3,
            "limit": 20,
            "offset": 0,
            "has_more": False,
            "sort": "date_desc",
        },
        "error": None,
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/journals?limit=10")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert [item["title"] for item in payload["data"]] == ["Real Journal"]


@pytest.mark.asyncio
async def test_list_journals_cli_error():
    """GET /api/journals returns error envelope when CLI fails."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        side_effect=CLIError(1, "search command failed")
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/journals")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "CLI_ERROR"


@pytest.mark.asyncio
async def test_get_journal_success():
    """GET /api/journals/{id} resolves detail via stable CLI journal get."""
    journal_id = "2026/04/life-index_2026-04-19_001"
    mock_data = {
        "success": True,
        "schema_version": "m16.journal.v0",
        "data": {
            "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
            "journal_route_path": "2026/04/life-index_2026-04-19_001.md",
            "date": "2026-04-19",
            "content": "This is the content.",
            "word_count": 120,
            "metadata": {
                "title": "Test Entry",
                "location": "Shanghai",
                "mood": ["Calm"],
                "weather": "Sunny",
                "topic": ["Work", "Life"],
                "people": ["Alice"],
                "links": [],
            },
        },
        "error": None,
    }

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value=mock_data)

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get(f"/api/journals/{journal_id}")

    assert response.status_code == 200
    called_args = mock_adapter.run_json.call_args[0][0]
    assert called_args == [
        "journal",
        "get",
        "--path",
        "Journals/2026/04/life-index_2026-04-19_001.md",
        "--json",
    ]
    assert mock_adapter.run_json.call_args.kwargs["timeout"] == 30.0

    payload = response.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data["id"] == journal_id
    assert data["title"] == "Test Entry"
    assert data["content"] == "This is the content."
    assert data["topics"] == ["Work", "Life"]
    assert data["moods"] == ["Calm"]
    assert data["people"] == ["Alice"]
    assert data["wordCount"] == 120


@pytest.mark.asyncio
async def test_get_journal_does_not_whitespace_count_cjk_when_cli_omits_word_count():
    """ISS-012: GUI must not invent a CJK-breaking whitespace word count."""
    journal_id = "2026/04/life-index_2026-04-19_001"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.journal.v0",
            "data": {
                "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                "date": "2026-04-19",
                "content": "今天去了杭州西湖然后写了很多中文内容",
                "metadata": {"title": "中文日志"},
            },
            "error": None,
        }
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get(f"/api/journals/{journal_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["wordCount"] == 0


@pytest.mark.asyncio
async def test_get_journal_maps_cli_attachments_to_detail_contract():
    """ISS-016: journal detail should expose CLI attachment references for GUI rendering."""
    journal_id = "2026/04/life-index_2026-04-19_001"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.journal.v0",
            "data": {
                "rel_path": "Journals/2026/04/life-index_2026-04-19_001.md",
                "date": "2026-04-19",
                "content": "Attachment test.",
                "word_count": 2,
                "metadata": {"title": "Attachment Entry"},
                "attachments": [
                    {
                        "rel_path": "attachments/2026/04/photo.jpg",
                        "filename": "photo.jpg",
                        "content_type": "image/jpeg",
                        "size_bytes": 12345,
                    },
                    {
                        "target_rel_path": "attachments/2026/04/movie.mp4",
                        "name": "movie.mp4",
                        "media_type": "video/mp4",
                    },
                ],
            },
            "error": None,
        }
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get(f"/api/journals/{journal_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    attachments = payload["data"]["attachments"]
    assert attachments == [
        {
            "relPath": "attachments/2026/04/photo.jpg",
            "filename": "photo.jpg",
            "contentType": "image/jpeg",
            "sizeBytes": 12345,
        },
        {
            "relPath": "attachments/2026/04/movie.mp4",
            "filename": "movie.mp4",
            "contentType": "video/mp4",
            "sizeBytes": None,
        },
    ]


@pytest.mark.asyncio
async def test_get_journal_not_found():
    """GET /api/journals/{id} returns CLI error envelope when the journal is missing."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": False,
            "schema_version": "m16.journal.v0",
            "data": None,
            "error": {
                "code": "JOURNAL_NOT_FOUND",
                "message": "Journal not found",
            },
        }
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/journals/2026/04/missing")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "JOURNAL_NOT_FOUND"


@pytest.mark.asyncio
async def test_get_journal_rejects_malformed_cli_payload():
    """S3 gate: GET /api/journals/{id} rejects malformed CLI journal envelopes."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(return_value={"success": True, "data": None})

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/journals/2026/04/life-index_2026-04-19_001")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_create_journal_success():
    """POST /api/journals creates a journal via CLI write."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value="/path/to/new.md")

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={
                "title": "New Journal",
                "content": "This is the content.",
                "date": "2026-04-19",
                "topic": "Life",
                "mood": "Happy",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    called_args = mock_adapter.run_serialized.call_args[0][0]
    assert called_args[:3] == ["write", "write", "--data"]


@pytest.mark.asyncio
async def test_create_journal_cli_error():
    """POST /api/journals returns error when CLI write fails."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        side_effect=CLIError(1, "write failed: missing date")
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={"title": "Bad", "content": "x", "date": "2026-04-19"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False


@pytest.mark.asyncio
async def test_edit_journal_delegates_existence_check_to_cli():
    """PUT /api/journals/{id} must not inspect L1 files before calling CLI."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value='{"success": true}')

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.put(
            "/api/journals/2026/04/nonexistent",
            json={"contentAppend": "append through CLI"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    called_args = mock_adapter.run_serialized.call_args[0][0]
    assert called_args[:3] == ["edit", "--journal", "Journals/2026/04/nonexistent.md"]


# --- S2 Exit Gate: Write, Draft, And Confirmation Flow ---


@pytest.mark.asyncio
async def test_create_journal_passes_complete_data_json_to_cli():
    """S2 gate: POST /api/journals sends all provided fields as --data JSON."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value='{"journal_path": "Journals/2026/05/life-index_2026-05-28_001.md"}'
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={
                "title": "S2 Test Entry",
                "content": "Content for the test.",
                "date": "2026-05-28",
                "location": "Shanghai",
                "weather": "Sunny",
                "topic": "Work",
                "mood": "Happy",
                "people": "Alice, Bob",
                "project": "Life Index",
                "abstract": "Test abstract",
                "tags": "test, s2",
                "links": "https://example.com",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True

    # Verify CLI was called with ["write", "write", "--data", <json>]
    call_args = mock_adapter.run_serialized.call_args[0][0]
    assert call_args[:3] == ["write", "write", "--data"]
    data_json = json.loads(call_args[3])
    assert data_json["title"] == "S2 Test Entry"
    assert data_json["content"] == "Content for the test."
    assert data_json["date"] == "2026-05-28"
    assert data_json["location"] == "Shanghai"
    assert data_json["weather"] == "Sunny"
    assert data_json["topic"] == "Work"
    assert data_json["mood"] == "Happy"
    assert data_json["people"] == "Alice, Bob"
    assert data_json["project"] == "Life Index"
    assert data_json["abstract"] == "Test abstract"
    assert data_json["tags"] == "test, s2"
    assert data_json["links"] == "https://example.com"


@pytest.mark.asyncio
async def test_create_journal_extracts_confirmation_state_from_cli_output():
    """S2 gate: POST /api/journals returns needsConfirmation when CLI requests it."""
    cli_output = json.dumps({
        "journal_path": "Journals/2026/05/life-index_2026-05-28_001.md",
        "needs_confirmation": True,
        "confirmation": {
            "message": "A journal already exists for this date. Overwrite?",
            "choices": ["yes", "no"],
        },
    })

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(return_value=cli_output)

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={
                "title": "Duplicate Date",
                "content": "content",
                "date": "2026-05-28",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["needsConfirmation"] is True
    assert payload["data"]["confirmation"]["message"] == (
        "A journal already exists for this date. Overwrite?"
    )
    assert payload["data"]["id"] == "2026/05/life-index_2026-05-28_001"


@pytest.mark.asyncio
async def test_create_journal_validation_error_returns_structured_error():
    """S2 gate: POST /api/journals returns structured validation error from CLI."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        side_effect=CLIError(1, "write failed: missing date field")
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={"title": "No Date", "content": "x", "date": "2026-05-28"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "VALIDATION_ERROR"
    assert isinstance(payload["error"]["message"], str)
    assert len(payload["error"]["message"]) > 0


@pytest.mark.asyncio
async def test_create_journal_cli_failure_returns_structured_error():
    """S2 gate: POST /api/journals returns structured error on generic CLI failure."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        side_effect=CLIError(2, "internal CLI error: disk full")
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={"title": "Test", "content": "x", "date": "2026-05-28"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False
    assert "code" in payload["error"]
    assert "message" in payload["error"]


@pytest.mark.asyncio
async def test_create_journal_extracts_id_from_path_in_cli_output():
    """S2 gate: POST /api/journals extracts journal ID from raw CLI path output."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value="Journals/2026/05/life-index_2026-05-28_003.md"
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={"title": "Path Test", "content": "c", "date": "2026-05-28"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["id"] == "2026/05/life-index_2026-05-28_003"


# --- TA-3: Create-time attachment upload (multipart) ---


@pytest.mark.asyncio
async def test_create_journal_with_attachment_stages_temp_file_and_passes_source_path_to_cli():
    """Multipart create uploads files; CLI --data receives absolute source_path; temp files are cleaned."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value='{"journal_path": "Journals/2026/05/life-index_2026-05-28_004.md"}'
    )

    file_content = b"fake image bytes"
    files = [
        ("files", ("test-image.png", io.BytesIO(file_content), "image/png")),
    ]

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={
                "title": "Attachment Test",
                "content": "See attached image.",
                "date": "2026-05-28",
            },
            files=files,
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True

    call_args = mock_adapter.run_serialized.call_args[0][0]
    assert call_args[:3] == ["write", "write", "--data"]
    data_json = json.loads(call_args[3])
    assert data_json["title"] == "Attachment Test"
    assert data_json["content"] == "See attached image."
    assert "attachments" in data_json
    assert len(data_json["attachments"]) == 1

    attachment = data_json["attachments"][0]
    assert "source_path" in attachment
    source_path = Path(attachment["source_path"])
    assert source_path.is_absolute()
    assert source_path.name == "test-image.png"

    # The staged temp file must have been cleaned up after the request.
    assert not source_path.exists()
    assert not source_path.parent.exists()


@pytest.mark.asyncio
async def test_prepare_attachments_keeps_safe_basenames_in_unique_request_children():
    """Staging strips path components but preserves each safe basename and bytes."""
    contents = [
        b"forward slash bytes",
        b"backslash bytes",
        b"first duplicate bytes",
        b"second duplicate bytes",
        b"unicode filename bytes",
    ]
    uploads = [
        UploadFile(file=io.BytesIO(contents[0]), filename="../nested/forward.txt"),
        UploadFile(file=io.BytesIO(contents[1]), filename=r"..\nested\backslash.txt"),
        UploadFile(file=io.BytesIO(contents[2]), filename="duplicate.txt"),
        UploadFile(file=io.BytesIO(contents[3]), filename="duplicate.txt"),
        UploadFile(file=io.BytesIO(contents[4]), filename="照片.png"),
    ]

    with tempfile.TemporaryDirectory() as request_dir:
        request_root = Path(request_dir).resolve()
        attachments = await journals_module._prepare_attachments(uploads, request_dir)
        source_paths = [Path(item["source_path"]) for item in attachments]

        assert [path.name for path in source_paths] == [
            "forward.txt",
            "backslash.txt",
            "duplicate.txt",
            "duplicate.txt",
            "照片.png",
        ]
        assert all(request_root in path.parents for path in source_paths)
        assert all(path.parent.parent == request_root for path in source_paths)
        assert len({path.parent for path in source_paths}) == len(source_paths)
        assert [path.read_bytes() for path in source_paths] == contents


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "filename",
    ["", ".", "..", "folder/..", r"folder\..", "unsafe\x00name.txt", "bad:name.txt"],
)
async def test_prepare_attachments_falls_back_for_unsafe_filenames(filename):
    """Empty, traversal, NUL, and platform-unsafe names stage as a safe fallback."""
    with tempfile.TemporaryDirectory() as request_dir:
        request_root = Path(request_dir).resolve()
        upload = UploadFile(file=io.BytesIO(b"safe fallback bytes"), filename=filename)

        attachment = (await journals_module._prepare_attachments([upload], request_dir))[0]
        source_path = Path(attachment["source_path"])

        assert source_path.name == "attachment"
        assert source_path.parent.parent == request_root
        assert source_path.read_bytes() == b"safe fallback bytes"


@pytest.mark.asyncio
async def test_create_journal_without_attachment_does_not_include_attachments_in_data():
    """When no files are uploaded, the CLI --data dict omits attachments entirely."""
    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        return_value='{"journal_path": "Journals/2026/05/life-index_2026-05-28_005.md"}'
    )

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        response = client.post(
            "/api/journals",
            data={"title": "No Attachment", "content": "Plain text.", "date": "2026-05-28"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True

    call_args = mock_adapter.run_serialized.call_args[0][0]
    data_json = json.loads(call_args[3])
    assert "attachments" not in data_json


@pytest.mark.asyncio
async def test_create_journal_attachment_cli_error_still_cleans_temp_files():
    """If CLI write fails, staged temp files are still removed."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_serialized = AsyncMock(
        side_effect=CLIError(1, "write failed: disk full")
    )

    file_content = b"fake image bytes"
    files = [
        ("files", ("test-image.png", io.BytesIO(file_content), "image/png")),
    ]

    captured_paths: list[Path] = []
    original_prepare = journals_module._prepare_attachments

    async def capturing_prepare(files, temp_dir):
        result = await original_prepare(files, temp_dir)
        for item in result:
            captured_paths.append(Path(item["source_path"]))
        return result

    with patch("backend.routers.journals.CLIAdapter", return_value=mock_adapter):
        with patch(
            "backend.routers.journals._prepare_attachments",
            side_effect=capturing_prepare,
        ):
            response = client.post(
                "/api/journals",
                data={
                    "title": "Failing Attachment",
                    "content": "See attached image.",
                    "date": "2026-05-28",
                },
                files=files,
            )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is False

    assert len(captured_paths) == 1
    assert not captured_paths[0].exists()
    assert not captured_paths[0].parent.exists()
