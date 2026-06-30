"""Life Index GUI Backend -- FastAPI application entry point."""

import base64
import binascii
import inspect
from io import BytesIO
import json
import logging
import os
from secrets import compare_digest
import tempfile
from urllib.parse import quote

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from PIL import Image, UnidentifiedImageError

from backend.adapter.cli_adapter import CLIAdapter, CLIError
from backend import config
from backend.models.response import APIResponse
from backend.public_link_auth import (
    auth_env_complete,
    auth_env_enabled,
    cookie_header_value,
    exchange_code,
    get_cookie_name,
    get_session_token,
)
from backend.routers import (
    entities,
    geocode,
    health,
    host_agent,
    imports,
    index_diag,
    index_tree,
    journals,
    maintenance,
    public_link,
    search,
    stats,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s  %(message)s",
)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Life Index GUI Backend",
    version="0.1.0",
    description="API layer between GUI frontend and v1.x CLI",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Public-link auth middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def public_link_auth_middleware(request: Request, call_next):  # noqa: ANN001
    """Fail-closed cookie check for all /api/* routes when auth env is enabled.

    - Every /api/* request requires the session cookie matching
      LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN.
    - /api/public-link/* routes are blocked entirely (403) in auth mode.
    - Non-/api routes are untouched.
    """
    path: str = request.url.path or ""

    if not path.startswith("/api/"):
        return await call_next(request)

    if auth_env_enabled():
        # Block public-link control endpoints entirely in auth mode
        if path.startswith("/api/public-link/"):
            payload = APIResponse.error_response(
                "PUBLIC_LINK_AUTH_BLOCKED",
                "Public-link control endpoints are unavailable when token-gated auth is active.",
            )
            return JSONResponse(status_code=403, content=payload.model_dump())

        expected_token = get_session_token()
        cookie_name = get_cookie_name()
        cookie_header = request.headers.get("cookie", "")
        cookie_value: str | None = None
        for part in cookie_header.split(";"):
            candidate = part.strip()
            if candidate.startswith(f"{cookie_name}="):
                cookie_value = candidate[len(cookie_name) + 1:]
                break

        if (
            not auth_env_complete()
            or not expected_token
            or cookie_value is None
            or not compare_digest(cookie_value, expected_token)
        ):
            payload = APIResponse.error_response(
                "PUBLIC_LINK_AUTH_REQUIRED",
                "Valid session cookie required.",
            )
            return JSONResponse(status_code=401, content=payload.model_dump())

    return await call_next(request)


# ---------------------------------------------------------------------------
# /auth/exchange — one-time code → session cookie
# ---------------------------------------------------------------------------

@app.post("/auth/exchange")
async def auth_exchange(request: Request):  # noqa: ANN001
    """Exchange a one-time code for a session cookie.

    Returns 200 with {redirectTo: "/"} and sets the HttpOnly/Secure/SameSite=Lax
    cookie on success.  Returns 401 for missing/wrong/expired/used codes.
    """
    if not auth_env_enabled():
        payload = APIResponse.error_response(
            "PUBLIC_LINK_AUTH_NOT_CONFIGURED",
            "Public-link auth is not configured on this backend.",
        )
        return JSONResponse(status_code=404, content=payload.model_dump())

    try:
        body = await request.json()
    except Exception:
        payload = APIResponse.error_response(
            "INVALID_REQUEST_BODY",
            "Request body must be valid JSON.",
        )
        return JSONResponse(status_code=400, content=payload.model_dump())

    code = body.get("code") if isinstance(body, dict) else None
    if not isinstance(code, str) or not code:
        payload = APIResponse.error_response(
            "PUBLIC_LINK_CODE_REQUIRED",
            "A non-empty 'code' field is required.",
        )
        return JSONResponse(status_code=401, content=payload.model_dump())

    if not exchange_code(code):
        payload = APIResponse.error_response(
            "PUBLIC_LINK_CODE_INVALID",
            "Code is missing, wrong, expired, or already used.",
        )
        return JSONResponse(status_code=401, content=payload.model_dump())

    token = get_session_token()
    cookie_name = get_cookie_name()
    set_cookie = cookie_header_value(cookie_name, token)
    response = JSONResponse(
        status_code=200,
        content=APIResponse.success({"redirectTo": "/"}).model_dump(),
    )
    response.headers["Set-Cookie"] = set_cookie
    return response


async def unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Convert any unhandled exception into the standard error envelope.

    Without this, an unexpected error (e.g. a platform-specific subprocess
    failure) surfaces as a bare HTTP 500 with no error code, which the GUI
    then mislabels as a network failure — hiding the real cause and forcing
    a dig through backend logs. We log the full traceback so the cause is
    never lost again, and return the standard envelope so the frontend can
    show an honest, mapped message.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    payload = APIResponse.error_response(
        "INTERNAL_ERROR", "服务器内部错误，请稍后重试"
    )
    return JSONResponse(status_code=500, content=payload.model_dump())


app.add_exception_handler(Exception, unhandled_exception_handler)

app.include_router(health.router, prefix="/api")
app.include_router(imports.router, prefix="/api")
app.include_router(index_diag.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(journals.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(index_tree.router, prefix="/api")
app.include_router(entities.router, prefix="/api")
app.include_router(geocode.router, prefix="/api")
app.include_router(host_agent.router, prefix="/api")
app.include_router(maintenance.router, prefix="/api")
app.include_router(public_link.router, prefix="/api")


@app.api_route("/api/attachments/{file_path:path}", methods=["GET", "HEAD"])
async def download_attachment(
    request: Request,
    file_path: str,
    variant: str | None = None,
    max_px: int | None = Query(None, ge=32, le=4096),
) -> Response:
    """Serve attachment bytes through the CLI attachment export contract."""
    if variant not in (None, "", "thumbnail", "preview", "original"):
        api_payload = APIResponse.error_response(
            "ATTACHMENT_VARIANT_INVALID",
            "Unsupported attachment variant.",
        )
        return JSONResponse(status_code=400, content=api_payload.model_dump())

    adapter = CLIAdapter()
    media_variant = variant or "original"
    try:
        media_response = await _try_cli_attachment_media_contract(
            adapter=adapter,
            file_path=file_path,
            variant=media_variant,
            max_px=max_px,
            range_header=request.headers.get("range"),
        )
    except CLIError as exc:
        return _attachment_cli_error_response(exc)
    if media_response is not None:
        return media_response

    try:
        payload = await adapter.run_json(["attachment", "--export", file_path])
    except CLIError as exc:
        return _attachment_cli_error_response(exc)

    if not isinstance(payload, dict) or payload.get("success") is not True:
        return _attachment_contract_error_response(payload)

    data = payload.get("data")
    if not isinstance(data, dict):
        return _attachment_invalid_payload_response("Attachment CLI data must be an object.")

    encoded_content = data.get("content_base64")
    if not isinstance(encoded_content, str):
        return _attachment_invalid_payload_response(
            "Attachment CLI payload is missing content_base64."
        )

    try:
        content = base64.b64decode(encoded_content, validate=True)
    except (binascii.Error, ValueError):
        return _attachment_invalid_payload_response(
            "Attachment CLI payload contains invalid base64 content."
        )

    filename = _safe_attachment_filename(data.get("filename"))
    rel_path = str(data.get("rel_path") or "")
    content_type = str(data.get("content_type") or "application/octet-stream")
    headers = {"Content-Disposition": _attachment_content_disposition(filename)}
    if rel_path:
        headers["X-Life-Index-Rel-Path"] = _attachment_header_percent_encode(rel_path)
        headers["X-Life-Index-Rel-Path-Encoding"] = "percent-encoded"

    if variant in ("thumbnail", "preview") and content_type.lower().startswith("image/"):
        effective_max_px = max_px or (1400 if variant == "preview" else 160)
        image_variant = _make_attachment_image_variant(content, content_type, effective_max_px)
        if image_variant is not None:
            content, content_type = image_variant
            headers["X-Life-Index-Attachment-Variant"] = variant
            if variant == "preview":
                headers["X-Life-Index-Preview-Max-Px"] = str(effective_max_px)
            else:
                headers["X-Life-Index-Thumbnail-Max-Px"] = str(effective_max_px)
            headers["Cache-Control"] = "public, max-age=86400"

    return Response(content=content, media_type=content_type, headers=headers)


async def _try_cli_attachment_media_contract(
    adapter: CLIAdapter,
    file_path: str,
    variant: str,
    max_px: int | None,
    range_header: str | None,
) -> Response | None:
    run_bytes = getattr(adapter, "run_bytes", None)
    if not inspect.iscoroutinefunction(run_bytes):
        return None

    metadata_fd, metadata_path = tempfile.mkstemp(
        prefix="life-index-attachment-media-",
        suffix=".json",
    )
    args = [
        "attachment",
        "media",
        file_path,
        "--variant",
        variant,
        "--output",
        "-",
        "--metadata-output",
        metadata_path,
    ]
    if variant in ("thumbnail", "preview"):
        effective_max_px = max_px or (1400 if variant == "preview" else 160)
        args.extend(["--max-px", str(effective_max_px)])
    if variant == "original" and range_header:
        args.extend(["--range", range_header])

    try:
        try:
            content = await run_bytes(args)
        except CLIError as exc:
            if _attachment_media_contract_unavailable(exc):
                return None
            raise

        metadata = _read_attachment_media_metadata(metadata_fd)
        if not isinstance(metadata, dict):
            return _attachment_invalid_payload_response(
                "Attachment media CLI did not write valid metadata."
            )
        if metadata.get("success") is False:
            return _attachment_contract_error_response(metadata)

        return _attachment_media_response(content, metadata, variant)
    finally:
        try:
            os.close(metadata_fd)
        except OSError:
            pass
        try:
            os.unlink(metadata_path)
        except FileNotFoundError:
            pass


def _read_attachment_media_metadata(metadata_fd: int) -> dict | None:
    try:
        os.lseek(metadata_fd, 0, os.SEEK_SET)
        raw_metadata = os.read(metadata_fd, 1024 * 1024)
        return json.loads(raw_metadata.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None


def _attachment_media_response(
    content: bytes,
    metadata: dict,
    variant: str,
) -> Response:
    headers = _attachment_media_headers(metadata)
    media_type = headers.pop("Content-Type", None) or _attachment_media_content_type(
        metadata
    )
    headers["X-Life-Index-Attachment-Variant"] = variant
    return Response(
        content=content,
        status_code=_attachment_media_status_code(metadata),
        media_type=media_type,
        headers=headers,
    )


def _attachment_media_headers(metadata: dict) -> dict[str, str]:
    raw_headers = _attachment_media_raw_headers(metadata)
    allowed_headers = {
        "accept-ranges": "Accept-Ranges",
        "cache-control": "Cache-Control",
        "content-disposition": "Content-Disposition",
        "content-length": "Content-Length",
        "content-range": "Content-Range",
        "content-type": "Content-Type",
        "etag": "ETag",
        "last-modified": "Last-Modified",
    }
    headers: dict[str, str] = {}
    for key, value in raw_headers.items():
        canonical_key = allowed_headers.get(str(key).lower())
        if canonical_key is None or value is None:
            continue
        header_value = str(value)
        if "\r" in header_value or "\n" in header_value:
            continue
        headers[canonical_key] = header_value
    return headers


def _attachment_media_raw_headers(metadata: dict) -> dict:
    headers = metadata.get("headers")
    if isinstance(headers, dict):
        return headers
    data = metadata.get("data")
    if isinstance(data, dict) and isinstance(data.get("headers"), dict):
        return data["headers"]
    return {}


def _attachment_media_content_type(metadata: dict) -> str:
    for holder in (metadata.get("data"), metadata):
        if isinstance(holder, dict) and isinstance(holder.get("content_type"), str):
            return holder["content_type"]
    return "application/octet-stream"


def _attachment_media_status_code(metadata: dict) -> int:
    data = metadata.get("data")
    candidates = [metadata.get("stream")]
    if isinstance(data, dict):
        candidates.append(data.get("stream"))
    candidates.append(metadata)
    for holder in candidates:
        if not isinstance(holder, dict):
            continue
        raw_status = holder.get("status_code")
        try:
            status_code = int(raw_status)
        except (TypeError, ValueError):
            continue
        if 100 <= status_code <= 599:
            return status_code
    return 200


def _attachment_media_contract_unavailable(exc: CLIError) -> bool:
    output = f"{exc.stderr}\n{exc.stdout}".lower()
    return any(
        marker in output
        for marker in (
            "unknown command",
            "no such command",
            "invalid choice",
            "no such option",
            "unrecognized arguments",
            "unrecognized option",
            "unknown option",
        )
    )


def _make_attachment_image_variant(
    content: bytes,
    content_type: str,
    max_px: int,
) -> tuple[bytes, str] | None:
    try:
        with Image.open(BytesIO(content)) as image:
            image.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
            output = BytesIO()
            image_format = (image.format or "").upper()
            if image_format in {"JPEG", "JPG"} or content_type.lower() == "image/jpeg":
                if image.mode not in ("RGB", "L"):
                    image = image.convert("RGB")
                image.save(output, format="JPEG", quality=82, optimize=True, progressive=True)
                return output.getvalue(), "image/jpeg"
            if image_format == "WEBP" or content_type.lower() == "image/webp":
                image.save(output, format="WEBP", quality=80, method=4)
                return output.getvalue(), "image/webp"

            image.save(output, format="PNG", optimize=True)
            return output.getvalue(), "image/png"
    except (OSError, UnidentifiedImageError, ValueError):
        logger.warning("Unable to generate attachment image variant from CLI-exported bytes.")
        return None


def _attachment_cli_error_response(exc: CLIError) -> JSONResponse:
    try:
        payload = json.loads(exc.stdout)
    except json.JSONDecodeError:
        payload = {
            "success": False,
            "error": {
                "code": "CLI_ERROR",
                "message": exc.stderr or exc.stdout or "Attachment CLI failed.",
            },
        }
    return _attachment_contract_error_response(payload)


def _attachment_contract_error_response(payload: object) -> JSONResponse:
    error = payload.get("error") if isinstance(payload, dict) else None
    error_data = error if isinstance(error, dict) else {}
    code = str(error_data.get("code") or "INVALID_CLI_ATTACHMENT_PAYLOAD")
    message = str(error_data.get("message") or "Attachment CLI returned an invalid payload.")
    api_payload = APIResponse.error_response(code, message)
    return JSONResponse(
        status_code=_attachment_http_status(code),
        content=api_payload.model_dump(),
    )


def _attachment_invalid_payload_response(message: str) -> JSONResponse:
    api_payload = APIResponse.error_response("INVALID_CLI_ATTACHMENT_PAYLOAD", message)
    return JSONResponse(status_code=502, content=api_payload.model_dump())


def _attachment_http_status(code: str) -> int:
    return {
        "ATTACHMENT_PATH_INVALID": 400,
        "ATTACHMENT_NOT_FILE": 400,
        "ATTACHMENT_NOT_FOUND": 404,
    }.get(code, 502)


def _safe_attachment_filename(value: object) -> str:
    filename = str(value or "attachment")
    filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    filename = filename.replace('"', "").replace("\r", "").replace("\n", "")
    return filename or "attachment"


def _attachment_content_disposition(filename: str) -> str:
    ascii_filename = filename.encode("ascii", "ignore").decode("ascii").strip()
    ascii_filename = ascii_filename.replace("\\", "_").replace("/", "_").replace('"', "")
    if not ascii_filename:
        ascii_filename = "attachment"
    encoded_filename = quote(filename, safe="")
    return f"inline; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}"


def _attachment_header_percent_encode(value: str) -> str:
    return quote(value, safe="/._-")


@app.get("/api")
async def api_root() -> dict:
    return {"name": "Life Index GUI Backend", "version": "0.1.0"}
