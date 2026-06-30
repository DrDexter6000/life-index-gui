"""Local-only public link operations for mobile GUI acceptance."""

from __future__ import annotations

import asyncio
import base64
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse, StreamingResponse

from backend.models.response import APIResponse
from backend.public_link_auth import (
    clear_code_store,
    set_code,
)

router = APIRouter(prefix="/public-link", tags=["public-link"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "start-mobile-cloudflare-tunnel.ps1"
DEFAULT_FRONTEND_PORT = int(os.environ.get("LIFE_INDEX_PUBLIC_LINK_FRONTEND_PORT", "15173"))
DEFAULT_BACKEND_PORT = int(os.environ.get("LIFE_INDEX_PUBLIC_LINK_BACKEND_PORT", "18021"))
DEFAULT_BRIDGE_PORT = int(os.environ.get("LIFE_INDEX_PUBLIC_LINK_BRIDGE_PORT", "18791"))
DEFAULT_WAIT_SECONDS = int(os.environ.get("LIFE_INDEX_PUBLIC_LINK_WAIT_SECONDS", "120"))
DEFAULT_CODE_EXPIRY = int(os.environ.get("LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRY", "120"))
EVENT_POLL_SECONDS = float(os.environ.get("LIFE_INDEX_PUBLIC_LINK_EVENT_POLL_SECONDS", "1"))

_active_tunnel: dict[str, Any] | None = None
_start_job: dict[str, Any] | None = None
_state_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    payload = APIResponse.error_response(code, message)
    return JSONResponse(status_code=status_code, content=payload.model_dump())


def _ops_disabled() -> bool:
    return os.environ.get("LIFE_INDEX_PUBLIC_LINK_OPS_DISABLED") == "1"


def _body_bool(body: dict[str, Any], *names: str) -> bool:
    return any(body.get(name) is True for name in names)


def _body_int(body: dict[str, Any], *names: str, default: int) -> int:
    for name in names:
        value = body.get(name)
        if value is None:
            continue
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed > 0:
            return parsed
    return default


def _public_link_warnings() -> list[str]:
    return [
        "This starts a temporary token-gated Cloudflare Quick Tunnel for owner-only mobile access.",
        "Prerequisites: cloudflared must be installed, and the stable mobile server must be able to serve a built dist/ "
        "on the configured frontend port.",
        "The tunnel is protected by a one-time code exchanged for an HttpOnly session cookie — "
        "share the code only with the intended device, then stop the tunnel when done.",
        "For persistent private access, graduate to a named tunnel with Cloudflare Access or another "
        "owner-approved auth layer.",
    ]


def _job_id() -> str:
    return secrets.token_urlsafe(8)


def _copy_start_job() -> dict[str, Any] | None:
    with _state_lock:
        return dict(_start_job) if _start_job is not None else None


def _update_start_job(
    job_id: str,
    *,
    status: str,
    phase: str,
    message: str,
    error: dict[str, str] | None = None,
) -> None:
    with _state_lock:
        if _start_job is None or _start_job.get("id") != job_id:
            return
        _start_job.update({
            "status": status,
            "phase": phase,
            "message": message,
            "updatedAt": _now_iso(),
            "error": error,
        })


def _fail_start_job(job_id: str, code: str, message: str) -> None:
    clear_code_store()
    _update_start_job(
        job_id,
        status="error",
        phase="failed",
        message=message,
        error={"code": code, "message": message},
    )


def _public_state(running: bool = False) -> dict[str, Any]:
    with _state_lock:
        active = dict(_active_tunnel) if _active_tunnel is not None else None
        job = dict(_start_job) if _start_job is not None else None

    if not running or active is None:
        starting = job is not None and job.get("status") == "starting"
        return {
            "running": False,
            "tunnelUrl": None,
            "frontendUrl": None,
            "logDir": None,
            "processes": [],
            "startedAt": None,
            "warnings": _public_link_warnings(),
            "oneTimeUrl": None,
            "qrDataUrl": None,
            "starting": starting,
            "startJobId": job.get("id") if job else None,
            "phase": job.get("phase") if job else None,
            "message": job.get("message") if job else None,
            "error": job.get("error") if job and job.get("status") == "error" else None,
        }
    state = {
        "running": True,
        "tunnelUrl": active.get("tunnelUrl"),
        "frontendUrl": active.get("frontendUrl"),
        "logDir": active.get("logDir"),
        "processes": active.get("processes", []),
        "startedAt": active.get("startedAt"),
        "warnings": active.get("warnings", _public_link_warnings()),
        "oneTimeUrl": active.get("oneTimeUrl"),
        "qrDataUrl": active.get("qrDataUrl"),
        "starting": False,
        "startJobId": job.get("id") if job else None,
        "phase": "ready",
        "message": "Public link ready.",
        "error": None,
    }
    return state


def _parse_trailing_json(stdout: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(stdout):
        if char != "{":
            continue
        try:
            value, _end = decoder.raw_decode(stdout[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and "tunnelUrl" in value:
            return value
    raise ValueError("Cloudflare tunnel script did not return a JSON object with tunnelUrl.")


def _normalize_processes(processes: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    if not isinstance(processes, list):
        return normalized
    for item in processes:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "process")
        try:
            pid = int(item.get("pid"))
        except (TypeError, ValueError):
            continue
        normalized.append({"name": name, "pid": pid})
    return normalized


def _start_command(
    frontend_port: int,
    backend_port: int,
    bridge_port: int,
    wait_seconds: int,
    session_token: str | None = None,
    one_time_code: str | None = None,
    code_expires_at: float | None = None,
) -> list[str]:
    cmd: list[str] = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(SCRIPT_PATH),
        "-FrontendMode",
        "stable",
        "-FrontendPort",
        str(frontend_port),
        "-BackendPort",
        str(backend_port),
        "-BridgePort",
        str(bridge_port),
        "-TunnelUrlWaitSeconds",
        str(wait_seconds),
    ]
    if session_token is not None:
        cmd.extend(["-SessionToken", session_token])
    if one_time_code is not None:
        cmd.extend(["-OneTimeCode", one_time_code])
    if code_expires_at is not None:
        cmd.extend(["-CodeExpiresAt", str(int(code_expires_at))])
    return cmd


def _generate_qr_data_url(text: str) -> str | None:
    """Encode *text* into a QR code and return a data:image/png URL, or None."""
    try:
        import qrcode  # noqa: F811
    except ImportError:
        return None
    img = qrcode.make(text)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _sse_frame(event_type: str, data: dict[str, Any]) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {text}\n\n"


def _run_start_job(job_id: str, command: list[str], wait_seconds: int, one_time_code: str) -> None:
    global _active_tunnel

    _update_start_job(
        job_id,
        status="starting",
        phase="launching",
        message="Starting the stable mobile stack and Cloudflare tunnel.",
    )
    try:
        _update_start_job(
            job_id,
            status="starting",
            phase="waiting_for_tunnel",
            message="Waiting for Cloudflare to return a tunnel URL.",
        )
        result = subprocess.run(command, capture_output=True, text=True, timeout=wait_seconds + 30)
    except subprocess.TimeoutExpired:
        _fail_start_job(job_id, "PUBLIC_LINK_START_TIMEOUT", "Timed out waiting for Cloudflare tunnel URL.")
        return
    except OSError as exc:
        _fail_start_job(job_id, "PUBLIC_LINK_START_FAILED", str(exc))
        return

    if result.returncode != 0:
        _fail_start_job(
            job_id,
            "PUBLIC_LINK_START_FAILED",
            result.stderr.strip() or result.stdout.strip() or "Cloudflare tunnel script failed.",
        )
        return

    try:
        script_payload = _parse_trailing_json(result.stdout)
    except ValueError as exc:
        _fail_start_job(job_id, "PUBLIC_LINK_OUTPUT_INVALID", str(exc))
        return

    tunnel_url = script_payload.get("tunnelUrl")
    if not isinstance(tunnel_url, str) or not tunnel_url.startswith("https://"):
        _fail_start_job(job_id, "PUBLIC_LINK_OUTPUT_INVALID", "Cloudflare tunnel script returned an invalid tunnelUrl.")
        return

    processes = _normalize_processes(script_payload.get("processes"))
    one_time_url = f"{tunnel_url}/link?code={one_time_code}"
    qr_data_url = _generate_qr_data_url(one_time_url)

    state: dict[str, Any] = {
        "tunnelUrl": tunnel_url,
        "frontendUrl": script_payload.get("frontendUrl"),
        "logDir": script_payload.get("logDir"),
        "processes": processes,
        "startedAt": _now_iso(),
        "warnings": _public_link_warnings(),
        "oneTimeUrl": one_time_url,
        "qrDataUrl": qr_data_url,
    }

    with _state_lock:
        if _start_job is None or _start_job.get("id") != job_id:
            clear_code_store()
            return
        _active_tunnel = state
        _start_job.update({
            "status": "ready",
            "phase": "ready",
            "message": "Public link ready.",
            "updatedAt": _now_iso(),
            "error": None,
        })


@router.get("/status")
def public_link_status() -> APIResponse[dict[str, Any]]:
    return APIResponse.success(_public_state(_active_tunnel is not None))


@router.get("/events")
async def public_link_events():
    async def event_generator() -> AsyncIterator[str]:
        while True:
            state = _public_state(_active_tunnel is not None)
            if state.get("error"):
                yield _sse_frame("error", state)
                return
            if state.get("running"):
                yield _sse_frame("ready", state)
                return
            yield _sse_frame("status", state)
            if not state.get("starting"):
                return
            await asyncio.sleep(EVENT_POLL_SECONDS)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/start")
def start_public_link(
    body: dict[str, Any] = Body(default_factory=dict),
):
    global _start_job

    if _ops_disabled():
        return _error(403, "PUBLIC_LINK_OPS_DISABLED", "Public link controls are disabled for this backend process.")

    if not _body_bool(body, "accept_risk", "acceptRisk"):
        return _error(400, "PUBLIC_LINK_RISK_ACK_REQUIRED", "Explicit public exposure acknowledgement is required.")

    if _active_tunnel is not None:
        return APIResponse.success(_public_state(True))

    existing_job = _copy_start_job()
    if existing_job is not None and existing_job.get("status") == "starting":
        return APIResponse.success(_public_state(False))

    frontend_port = _body_int(body, "frontend_port", "frontendPort", default=DEFAULT_FRONTEND_PORT)
    backend_port = _body_int(body, "backend_port", "backendPort", default=DEFAULT_BACKEND_PORT)
    bridge_port = _body_int(body, "bridge_port", "bridgePort", default=DEFAULT_BRIDGE_PORT)
    wait_seconds = _body_int(body, "wait_seconds", "waitSeconds", default=DEFAULT_WAIT_SECONDS)
    code_expiry = _body_int(body, "code_expiry", "codeExpiry", default=DEFAULT_CODE_EXPIRY)

    # Always generate a fresh session token, one-time code, and absolute expiry
    session_token = secrets.token_urlsafe(32)
    one_time_code = secrets.token_urlsafe(24)
    code_expires_at = time.time() + code_expiry

    # Store code locally for the main backend's in-memory validation path
    set_code(one_time_code, expires_in=code_expiry)

    command = _start_command(
        frontend_port, backend_port, bridge_port, wait_seconds,
        session_token=session_token,
        one_time_code=one_time_code,
        code_expires_at=code_expires_at,
    )

    job_id = _job_id()
    with _state_lock:
        _start_job = {
            "id": job_id,
            "status": "starting",
            "phase": "queued",
            "message": "Public link start requested.",
            "startedAt": _now_iso(),
            "updatedAt": _now_iso(),
            "error": None,
        }

    thread = threading.Thread(
        target=_run_start_job,
        args=(job_id, command, wait_seconds, one_time_code),
        name=f"public-link-start-{job_id}",
        daemon=True,
    )
    thread.start()
    return APIResponse.success(_public_state(False))


@router.post("/stop")
def stop_public_link():
    global _active_tunnel, _start_job

    if _ops_disabled():
        return _error(403, "PUBLIC_LINK_OPS_DISABLED", "Public link controls are disabled for this backend process.")

    if _active_tunnel is None:
        return APIResponse.success(_public_state(False))

    for process in reversed(_active_tunnel.get("processes", [])):
        pid = process.get("pid")
        if not isinstance(pid, int):
            continue
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True, timeout=10)

    with _state_lock:
        _active_tunnel = None
        _start_job = None
    clear_code_store()
    return APIResponse.success(_public_state(False))
