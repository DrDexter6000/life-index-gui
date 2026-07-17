"""Tests for application-level API boundaries."""

import base64
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
import pytest

from backend.adapter.cli_adapter import CLIError
from backend.main import app

client = TestClient(app)


def test_attachment_endpoint_prefers_cli_media_contract_for_preview_variant():
    """Preview variants should stream bytes from the CLI media contract."""
    content = b"preview image bytes"
    mock_adapter = MagicMock()

    async def run_bytes(args):
        metadata_path = Path(args[args.index("--metadata-output") + 1])
        metadata_path.write_text(
            json.dumps(
                {
                    "success": True,
                    "schema_version": "m17.attachment-media.v1",
                    "data": {
                        "size": len(content),
                        "content_type": "image/jpeg",
                        "headers": {
                            "Content-Type": "image/jpeg",
                            "Content-Length": str(len(content)),
                            "ETag": '"preview-sha"',
                            "Cache-Control": "public, max-age=86400",
                            "Content-Disposition": (
                                "inline; filename=\"photo.jpg\"; "
                                "filename*=UTF-8''photo.jpg"
                            ),
                            "Accept-Ranges": "bytes",
                        },
                        "stream": {"status_code": 200},
                    },
                    "error": None,
                }
            ),
            encoding="utf-8",
        )
        return content

    mock_adapter.run_bytes = AsyncMock(side_effect=run_bytes)
    mock_adapter.run_json = AsyncMock()

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/photo.jpg?variant=preview&max_px=1400")

    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.headers["etag"] == '"preview-sha"'
    assert response.headers["cache-control"] == "public, max-age=86400"
    assert response.headers["x-life-index-attachment-variant"] == "preview"
    assert mock_adapter.run_json.await_count == 0

    args = mock_adapter.run_bytes.call_args[0][0]
    assert args[:5] == [
        "attachment",
        "media",
        "2026/05/photo.jpg",
        "--variant",
        "preview",
    ]
    assert "--output" in args
    assert args[args.index("--output") + 1] == "-"
    assert "--metadata-output" in args
    assert "--max-px" in args
    assert args[args.index("--max-px") + 1] == "1400"


def test_attachment_endpoint_uses_cli_media_contract_for_original_range():
    """Original media requests should pass Range through to the CLI media contract."""
    content = b"x" * 1024
    mock_adapter = MagicMock()

    async def run_bytes(args):
        metadata_path = Path(args[args.index("--metadata-output") + 1])
        metadata_path.write_text(
            json.dumps(
                {
                    "success": True,
                    "schema_version": "m17.attachment-media.v1",
                    "data": {
                        "size": len(content),
                        "content_type": "video/mp4",
                        "headers": {
                            "Content-Type": "video/mp4",
                            "Content-Length": "1024",
                            "Content-Range": "bytes 0-1023/9000",
                            "Accept-Ranges": "bytes",
                            "Cache-Control": "public, max-age=86400",
                        },
                        "stream": {"status_code": 206},
                    },
                    "error": None,
                }
            ),
            encoding="utf-8",
        )
        return content

    mock_adapter.run_bytes = AsyncMock(side_effect=run_bytes)
    mock_adapter.run_json = AsyncMock()

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get(
            "/api/attachments/2026/04/video.mp4",
            headers={"Range": "bytes=0-1023"},
        )

    assert response.status_code == 206
    assert response.content == content
    assert response.headers["content-type"].startswith("video/mp4")
    assert response.headers["content-range"] == "bytes 0-1023/9000"
    assert response.headers["accept-ranges"] == "bytes"
    assert mock_adapter.run_json.await_count == 0

    args = mock_adapter.run_bytes.call_args[0][0]
    assert args[:5] == [
        "attachment",
        "media",
        "2026/04/video.mp4",
        "--variant",
        "original",
    ]
    assert "--range" in args
    assert args[args.index("--range") + 1] == "bytes=0-1023"


def test_attachment_endpoint_maps_structured_media_metadata_error():
    """A valid m17 error sidecar is mapped without consulting legacy JSON export."""
    mock_adapter = MagicMock()

    async def run_bytes(args):
        metadata_path = Path(args[args.index("--metadata-output") + 1])
        metadata_path.write_text(
            json.dumps(
                {
                    "success": False,
                    "schema_version": "m17.attachment-media.v1",
                    "data": None,
                    "error": {
                        "code": "ATTACHMENT_NOT_FOUND",
                        "message": "missing",
                    },
                }
            ),
            encoding="utf-8",
        )
        return b""

    mock_adapter.run_bytes = AsyncMock(side_effect=run_bytes)
    mock_adapter.run_json = AsyncMock()

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/missing.png")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ATTACHMENT_NOT_FOUND"
    mock_adapter.run_json.assert_not_awaited()


@pytest.mark.parametrize(
    "case",
    [
        "error",
        "missing_headers",
        "bad_status",
        "missing_content",
        "content_length_mismatch",
        "content_length_non_decimal",
        "unsupported_status",
        "partial_missing_range",
        "partial_bad_range",
        "partial_missing_accept_ranges",
        "partial_bad_accept_ranges",
        "full_content_range",
        "header_crlf",
    ],
)
def test_attachment_endpoint_rejects_incomplete_media_success_sidecars(case):
    """Success envelopes must carry exact relay metadata and error: null."""
    mock_adapter = MagicMock()
    content = b"media"

    async def run_bytes(args):
        metadata_path = Path(args[args.index("--metadata-output") + 1])
        data = {
            "size": len(content),
            "content_type": "image/jpeg",
            "headers": {
                "Content-Type": "image/jpeg",
                "Content-Length": str(len(content)),
            },
            "stream": {"status_code": 200},
        }
        error = None
        if case == "error":
            error = {"code": "ATTACHMENT_NOT_FOUND", "message": "missing"}
        elif case == "missing_headers":
            data.pop("headers")
        elif case == "bad_status":
            data["stream"]["status_code"] = "200"
        elif case == "missing_content":
            data.pop("content_type")
            data.pop("size")
        elif case == "content_length_mismatch":
            data["headers"]["Content-Length"] = "99"
        elif case == "content_length_non_decimal":
            data["headers"]["Content-Length"] = "five"
        elif case == "unsupported_status":
            data["stream"]["status_code"] = 201
        elif case == "partial_missing_range":
            data["stream"]["status_code"] = 206
            data["headers"]["Accept-Ranges"] = "bytes"
        elif case == "partial_bad_range":
            data["stream"]["status_code"] = 206
            data["headers"]["Accept-Ranges"] = "bytes"
            data["headers"]["Content-Range"] = "bytes 0-9/10"
        elif case == "partial_missing_accept_ranges":
            data["stream"]["status_code"] = 206
            data["headers"]["Content-Range"] = "bytes 0-4/10"
        elif case == "partial_bad_accept_ranges":
            data["stream"]["status_code"] = 206
            data["headers"]["Accept-Ranges"] = "none"
            data["headers"]["Content-Range"] = "bytes 0-4/10"
        elif case == "full_content_range":
            data["headers"]["Content-Range"] = "bytes 0-4/5"
        elif case == "header_crlf":
            data["headers"]["ETag"] = '"safe"\r\nX-Evil: yes'
        metadata_path.write_text(
            json.dumps(
                {
                    "success": True,
                    "schema_version": "m17.attachment-media.v1",
                    "data": data,
                    "error": error,
                }
            ),
            encoding="utf-8",
        )
        return content

    mock_adapter.run_bytes = AsyncMock(side_effect=run_bytes)
    mock_adapter.run_json = AsyncMock()

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get(f"/api/attachments/2026/05/invalid-{case}.jpg")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "INVALID_CLI_ATTACHMENT_PAYLOAD"
    mock_adapter.run_json.assert_not_awaited()


def test_attachment_contract_does_not_fallback_from_stderr_wording():
    """Structured media error codes win even when messages contain legacy wording."""
    mock_adapter = MagicMock()
    structured_errors = [
        (
            "ATTACHMENT_UNSUPPORTED_MEDIA",
            502,
        ),
        (
            "ATTACHMENT_NOT_FOUND",
            404,
        ),
    ]
    mock_adapter.run_bytes = AsyncMock(
        side_effect=[
            CLIError(
                1,
                json.dumps(
                    {
                        "success": False,
                        "schema_version": "m17.attachment-media.v1",
                        "data": None,
                        "error": {
                            "code": code,
                            "message": "unknown option: attachment media",
                        },
                    }
                ),
                "",
            )
            for code, _status in structured_errors
        ]
    )
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.attachment.v0",
            "data": {"content_base64": base64.b64encode(b"legacy").decode("ascii")},
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        for index, (code, expected_status) in enumerate(structured_errors):
            response = client.get(f"/api/attachments/2026/05/failure-{index}.bin")

            assert response.status_code == expected_status
            assert response.json()["error"]["code"] == code

    mock_adapter.run_json.assert_not_awaited()


def test_attachment_contract_malformed_error_never_falls_back_to_legacy_export():
    """A missing/malformed structured envelope is an honest contract failure."""
    mock_adapter = MagicMock()
    mock_adapter.run_bytes = AsyncMock(
        side_effect=CLIError(1, "unknown option: attachment media", "")
    )
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.attachment.v0",
            "data": {"content_base64": base64.b64encode(b"legacy").decode("ascii")},
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/malformed.bin")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ATTACHMENT_MEDIA_CLI_ERROR"
    mock_adapter.run_json.assert_not_awaited()


def test_attachment_contract_rejects_positive_gui_error_envelope():
    """A positive GUI envelope with an error object is not a CLI failure contract."""
    mock_adapter = MagicMock()
    mock_adapter.run_bytes = AsyncMock(
        side_effect=CLIError(
            1,
            json.dumps(
                {
                    "ok": True,
                    "error": {
                        "code": "CLI_VERSION_UNSUPPORTED",
                        "message": "not a negative envelope",
                    },
                }
            ),
            "",
        )
    )
    mock_adapter.run_json = AsyncMock()

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/positive-error.bin")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ATTACHMENT_MEDIA_CLI_ERROR"
    mock_adapter.run_json.assert_not_awaited()


def test_attachment_endpoint_maps_cli_contract_error():
    """CLI attachment errors are exposed as API errors, not filesystem reads."""
    mock_adapter = MagicMock()
    mock_adapter.run_bytes = AsyncMock(
        side_effect=CLIError(
            1,
            json.dumps(
                {
                    "success": False,
                    "schema_version": "m17.attachment-media.v1",
                    "data": None,
                    "error": {
                        "code": "ATTACHMENT_PATH_INVALID",
                        "message": "bad attachment path",
                    },
                }
            ),
            "",
        )
    )
    mock_adapter.run_json = AsyncMock()

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/bad.txt")

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ATTACHMENT_PATH_INVALID"
    mock_adapter.run_json.assert_not_awaited()


def test_attachment_endpoint_parses_cli_error_stdout():
    """Non-zero CLI exits can still carry structured attachment JSON."""
    mock_adapter = MagicMock()
    mock_adapter.run_bytes = AsyncMock(
        side_effect=CLIError(
            1,
            "",
            json.dumps(
                {
                    "success": False,
                    "schema_version": "m17.attachment-media.v1",
                    "data": None,
                    "error": {
                        "code": "ATTACHMENT_NOT_FOUND",
                        "message": "missing",
                    },
                }
            ),
        )
    )
    mock_adapter.run_json = AsyncMock()

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/missing.png")

    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ATTACHMENT_NOT_FOUND"
    mock_adapter.run_json.assert_not_awaited()
