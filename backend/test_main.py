"""Tests for application-level API boundaries."""

import base64
from io import BytesIO
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from PIL import Image

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


def test_attachment_endpoint_falls_back_to_cli_export_when_media_contract_unavailable():
    """Older CLI installs keep working until the raw media contract lands locally."""
    content = b"legacy export bytes"
    mock_adapter = MagicMock()
    mock_adapter.run_bytes = AsyncMock(
        side_effect=CLIError(2, "Unknown command: attachment media", "")
    )
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.attachment.v0",
            "data": {
                "rel_path": "attachments/2026/05/example.txt",
                "filename": "example.txt",
                "content_type": "text/plain",
                "size": len(content),
                "sha256": "unused-by-gui",
                "content_base64": base64.b64encode(content).decode("ascii"),
            },
            "error": None,
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/example.txt")

    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"].startswith("text/plain")
    assert mock_adapter.run_json.call_args[0][0] == [
        "attachment",
        "--export",
        "2026/05/example.txt",
    ]


def test_attachment_endpoint_serves_bytes_from_cli_export():
    """Attachment bytes are served only after CLI-owned export."""
    content = b"hello from cli\n"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.attachment.v0",
            "data": {
                "rel_path": "attachments/2026/05/example.txt",
                "filename": "example.txt",
                "content_type": "text/plain",
                "size": len(content),
                "sha256": "unused-by-gui",
                "content_base64": base64.b64encode(content).decode("ascii"),
            },
            "error": None,
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/example.txt")

    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["x-life-index-rel-path"] == "attachments/2026/05/example.txt"
    assert 'filename="example.txt"' in response.headers["content-disposition"]
    assert mock_adapter.run_json.call_args[0][0] == [
        "attachment",
        "--export",
        "2026/05/example.txt",
    ]


def test_attachment_endpoint_serves_unicode_named_attachments_with_ascii_safe_headers():
    """Chinese attachment names must not crash Starlette's latin-1 header encoder."""
    content = b"fake jpeg bytes"
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.attachment.v0",
            "data": {
                "rel_path": "../../../attachments/2026/04/微信图片_20260501085614_25_25.jpg",
                "filename": "微信图片_20260501085614_25_25.jpg",
                "content_type": "image/jpeg",
                "size": len(content),
                "sha256": "unused-by-gui",
                "content_base64": base64.b64encode(content).decode("ascii"),
            },
            "error": None,
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get(
            "/api/attachments/2026/04/%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260501085614_25_25.jpg"
        )

    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"].startswith("image/jpeg")
    assert "filename=" in response.headers["content-disposition"]
    assert "filename*=UTF-8''%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87" in response.headers[
        "content-disposition"
    ]
    assert "微信图片" not in response.headers["content-disposition"]
    assert "%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87" in response.headers[
        "x-life-index-rel-path"
    ]
    assert "微信图片" not in response.headers["x-life-index-rel-path"]
    assert mock_adapter.run_json.call_args[0][0] == [
        "attachment",
        "--export",
        "2026/04/微信图片_20260501085614_25_25.jpg",
    ]


def test_attachment_endpoint_serves_thumbnail_variant_from_cli_exported_image():
    """Thumbnail variants are derived from CLI-exported bytes, never filesystem reads."""
    image_buffer = BytesIO()
    Image.new("RGB", (220, 140), color=(120, 40, 20)).save(image_buffer, format="PNG")
    content = image_buffer.getvalue()
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.attachment.v0",
            "data": {
                "rel_path": "attachments/2026/05/photo.png",
                "filename": "photo.png",
                "content_type": "image/png",
                "size": len(content),
                "sha256": "unused-by-gui",
                "content_base64": base64.b64encode(content).decode("ascii"),
            },
            "error": None,
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/photo.png?variant=thumbnail&max_px=64")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/png")
    assert response.headers["x-life-index-attachment-variant"] == "thumbnail"
    assert response.headers["x-life-index-rel-path"] == "attachments/2026/05/photo.png"
    assert len(response.content) < len(content)
    thumbnail = Image.open(BytesIO(response.content))
    assert max(thumbnail.size) <= 64
    assert mock_adapter.run_json.call_args[0][0] == [
        "attachment",
        "--export",
        "2026/05/photo.png",
    ]


def test_attachment_endpoint_serves_preview_variant_from_cli_exported_image():
    """Preview variants are display-only downsizes from CLI-exported bytes."""
    image_buffer = BytesIO()
    Image.new("RGB", (2400, 1600), color=(40, 120, 160)).save(image_buffer, format="JPEG")
    content = image_buffer.getvalue()
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": True,
            "schema_version": "m16.attachment.v0",
            "data": {
                "rel_path": "attachments/2026/05/large-photo.jpg",
                "filename": "large-photo.jpg",
                "content_type": "image/jpeg",
                "size": len(content),
                "sha256": "unused-by-gui",
                "content_base64": base64.b64encode(content).decode("ascii"),
            },
            "error": None,
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get(
            "/api/attachments/2026/05/large-photo.jpg?variant=preview&max_px=1400"
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/jpeg")
    assert response.headers["x-life-index-attachment-variant"] == "preview"
    assert response.headers["x-life-index-preview-max-px"] == "1400"
    assert response.headers["cache-control"] == "public, max-age=86400"
    assert len(response.content) < len(content)
    preview = Image.open(BytesIO(response.content))
    assert max(preview.size) <= 1400
    assert mock_adapter.run_json.call_args[0][0] == [
        "attachment",
        "--export",
        "2026/05/large-photo.jpg",
    ]


def test_attachment_endpoint_maps_cli_contract_error():
    """CLI attachment errors are exposed as API errors, not filesystem reads."""
    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        return_value={
            "success": False,
            "schema_version": "m16.attachment.v0",
            "data": None,
            "error": {
                "code": "ATTACHMENT_PATH_INVALID",
                "message": "bad attachment path",
            },
        }
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/bad.txt")

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ATTACHMENT_PATH_INVALID"


def test_attachment_endpoint_parses_cli_error_stdout():
    """Non-zero CLI exits can still carry structured attachment JSON."""
    from backend.adapter.cli_adapter import CLIError

    mock_adapter = MagicMock()
    mock_adapter.run_json = AsyncMock(
        side_effect=CLIError(
            1,
            "",
            stdout=json.dumps(
                {
                    "success": False,
                    "schema_version": "m16.attachment.v0",
                    "data": None,
                    "error": {
                        "code": "ATTACHMENT_NOT_FOUND",
                        "message": "missing",
                    },
                }
            ),
        )
    )

    with patch("backend.main.CLIAdapter", return_value=mock_adapter):
        response = client.get("/api/attachments/2026/05/missing.png")

    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ATTACHMENT_NOT_FOUND"
