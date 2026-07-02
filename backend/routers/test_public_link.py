"""Tests for opt-in public link tunnel operations and public-link auth gate."""

import json
import os
import time
from subprocess import CompletedProcess
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routers import health, public_link
from backend.public_link_auth import _code_store, clear_code_store

client = TestClient(app)

SCRIPT_OUTPUT = """
Mobile Cloudflare Quick Tunnel ready:
https://phone-test.trycloudflare.com
{
  "frontendUrl": "http://127.0.0.1:5173",
  "backendUrl": "http://127.0.0.1:8021",
  "bridgeUrl": "http://127.0.0.1:8791",
  "tunnelUrl": "https://phone-test.trycloudflare.com",
  "logDir": ".tmp/mobile-tunnel-logs/test",
  "processes": [
    {"name": "bridge", "pid": 4101},
    {"name": "backend", "pid": 4102},
    {"name": "frontend", "pid": 4103},
    {"name": "cloudflared", "pid": 4321, "stdout": "cloudflared.out.log", "stderr": "cloudflared.err.log"}
  ]
}
""".strip()

AUTH_ENV_KEYS = (
    "LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN",
    "LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE",
    "LIFE_INDEX_PUBLIC_LINK_SESSION_COOKIE",
    "LIFE_INDEX_PUBLIC_LINK_OPS_DISABLED",
    "LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT",
)


@pytest.fixture(autouse=True)
def clear_all_env_and_state():
    """Wipe tunnel state, code store, and all relevant env vars before each test."""
    public_link._active_tunnel = None
    public_link._start_job = None
    public_link.EVENT_POLL_SECONDS = 0.01
    _code_store.clear()
    client.cookies.clear()
    saved = {}
    for key in AUTH_ENV_KEYS:
        saved[key] = os.environ.pop(key, None)
    yield
    public_link._active_tunnel = None
    public_link._start_job = None
    _code_store.clear()
    client.cookies.clear()
    for key, val in saved.items():
        if val is not None:
            os.environ[key] = val
        else:
            os.environ.pop(key, None)


def _wait_for_public_link_ready(timeout: float = 1.0) -> dict:
    deadline = time.time() + timeout
    last_payload = None
    while time.time() < deadline:
        response = client.get("/api/public-link/status")
        assert response.status_code == 200
        last_payload = response.json()["data"]
        if last_payload["running"] is True:
            return last_payload
        time.sleep(0.01)
    raise AssertionError(f"public link did not become ready: {last_payload}")


def _wait_for_public_link_error(timeout: float = 1.0) -> dict:
    deadline = time.time() + timeout
    last_payload = None
    while time.time() < deadline:
        response = client.get("/api/public-link/status")
        assert response.status_code == 200
        last_payload = response.json()["data"]
        if last_payload.get("error"):
            return last_payload
        time.sleep(0.01)
    raise AssertionError(f"public link did not fail: {last_payload}")


def _wait_for_public_link_ready_direct(timeout: float = 1.0) -> dict:
    deadline = time.time() + timeout
    last_payload = None
    while time.time() < deadline:
        last_payload = public_link._public_state(public_link._active_tunnel is not None)
        if last_payload["running"] is True:
            return last_payload
        time.sleep(0.01)
    raise AssertionError(f"public link did not become ready: {last_payload}")


def _enable_auth_env(token: str = "test-session-token-abc123", code: str = "test-otc-placeholder"):
    os.environ["LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN"] = token
    os.environ["LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE"] = code
    os.environ["LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT"] = str(int(time.time()) + 120)


def _patch_public_link_preflight():
    return patch("backend.routers.public_link.public_link_preflight", return_value=None)


@pytest.fixture()
def auth_env():
    _enable_auth_env()
    yield


# =========================================================================
# Existing tests (unchanged contract)
# =========================================================================


def test_public_link_start_requires_explicit_risk_acknowledgement():
    response = client.post("/api/public-link/start", json={})

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PUBLIC_LINK_RISK_ACK_REQUIRED"


def test_public_link_start_fails_fast_when_cloudflared_missing():
    """Missing cloudflared must fail before token/code creation or script launch."""
    def fake_which(command: str) -> str | None:
        if command == "powershell.exe":
            return "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        if command == "cloudflared":
            return None
        return None

    with (
        patch("backend.routers.public_link.os.path.isfile", return_value=True),
        patch("backend.routers.public_link.shutil.which", side_effect=fake_which),
        patch("backend.routers.public_link.subprocess.run") as run,
    ):
        run.return_value = CompletedProcess(args=[], returncode=0, stdout=SCRIPT_OUTPUT, stderr="")
        response = client.post("/api/public-link/start", json={"accept_risk": True})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["running"] is False
    assert payload["data"]["starting"] is False
    assert payload["data"]["error"]["code"] == "PUBLIC_LINK_CLOUDFLARED_MISSING"
    run.assert_not_called()
    assert len(_code_store) == 0


def test_public_link_start_reuses_script_to_launch_tunnel_stack():
    """Start always generates token/code and returns oneTimeUrl + qrDataUrl."""
    with _patch_public_link_preflight(), patch("backend.routers.public_link.subprocess.run") as run:
        run.return_value = CompletedProcess(args=[], returncode=0, stdout=SCRIPT_OUTPUT, stderr="")
        response = client.post("/api/public-link/start", json={"accept_risk": True, "frontend_port": 5173})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["running"] is False
    assert payload["data"]["starting"] is True

    ready = _wait_for_public_link_ready()
    assert ready["tunnelUrl"] == "https://phone-test.trycloudflare.com"
    assert ready["frontendUrl"] == "http://127.0.0.1:5173"
    assert ready["processes"] == [
        {"name": "bridge", "pid": 4101},
        {"name": "backend", "pid": 4102},
        {"name": "frontend", "pid": 4103},
        {"name": "cloudflared", "pid": 4321},
    ]
    assert ready["warnings"]

    # oneTimeUrl always present when auth token generated
    assert ready["oneTimeUrl"] is not None
    assert "/link?code=" in ready["oneTimeUrl"]

    # qrDataUrl present if qrcode installed; still present on success
    assert "qrDataUrl" in ready

    command = run.call_args.args[0]
    assert "powershell.exe" in command[0]
    assert "start-mobile-cloudflare-tunnel.ps1" in " ".join(command)
    assert "-FrontendMode" in command
    assert "stable" in command
    assert "-SkipBridge" not in command
    assert "-SkipBackend" not in command
    assert "-SkipFrontend" not in command
    assert "-FrontendPort" in command
    assert "5173" in command

    # Auth args always included
    assert "-SessionToken" in command
    assert "-OneTimeCode" in command
    assert "-CodeExpiresAt" in command


def test_public_link_stop_kills_started_processes_and_clears_status():
    with _patch_public_link_preflight(), patch("backend.routers.public_link.subprocess.run") as run:
        run.side_effect = [
            CompletedProcess(args=[], returncode=0, stdout=SCRIPT_OUTPUT, stderr=""),
            CompletedProcess(args=[], returncode=0, stdout="", stderr=""),
            CompletedProcess(args=[], returncode=0, stdout="", stderr=""),
            CompletedProcess(args=[], returncode=0, stdout="", stderr=""),
            CompletedProcess(args=[], returncode=0, stdout="", stderr=""),
        ]
        start_response = client.post("/api/public-link/start", json={"accept_risk": True})
        _wait_for_public_link_ready()
        stop_response = client.post("/api/public-link/stop")

    assert start_response.status_code == 200
    assert stop_response.status_code == 200
    payload = stop_response.json()
    assert payload["ok"] is True
    assert payload["data"]["running"] is False

    stop_commands = [call.args[0] for call in run.call_args_list[1:]]
    stopped_pids = {command[2] for command in stop_commands}
    assert stopped_pids == {"4101", "4102", "4103", "4321"}
    for stop_command in stop_commands:
        assert stop_command[:2] == ["taskkill", "/PID"]
        assert "/T" in stop_command
        assert "/F" in stop_command

    status_response = client.get("/api/public-link/status")
    assert status_response.status_code == 200
    assert status_response.json()["data"]["running"] is False


def test_public_link_ops_disabled_returns_403():
    os.environ["LIFE_INDEX_PUBLIC_LINK_OPS_DISABLED"] = "1"
    response = client.post("/api/public-link/start", json={"accept_risk": True})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PUBLIC_LINK_OPS_DISABLED"


def test_public_link_events_report_ready_after_async_start():
    with _patch_public_link_preflight(), patch("backend.routers.public_link.subprocess.run") as run:
        run.return_value = CompletedProcess(args=[], returncode=0, stdout=SCRIPT_OUTPUT, stderr="")
        start_response = client.post("/api/public-link/start", json={"accept_risk": True})
        events_response = client.get("/api/public-link/events")

    assert start_response.status_code == 200
    assert events_response.status_code == 200
    assert "event: ready" in events_response.text
    assert "https://phone-test.trycloudflare.com" in events_response.text


def test_public_link_start_failure_is_fail_closed_and_streams_error():
    with _patch_public_link_preflight(), patch("backend.routers.public_link.subprocess.run") as run:
        run.return_value = CompletedProcess(args=[], returncode=1, stdout="", stderr="cloudflared missing")
        response = client.post("/api/public-link/start", json={"accept_risk": True})

    assert response.status_code == 200
    failed = _wait_for_public_link_error()
    assert failed["running"] is False
    assert failed["starting"] is False
    assert failed["error"]["code"] == "PUBLIC_LINK_START_FAILED"
    assert "cloudflared missing" in failed["error"]["message"]
    assert len(_code_store) == 0

    events_response = client.get("/api/public-link/events")
    assert "event: error" in events_response.text
    assert "cloudflared missing" in events_response.text


# =========================================================================
# Public-link auth mode: env-gated middleware
# =========================================================================


def test_unauthenticated_api_health_returns_401_in_auth_mode(auth_env):
    """When auth env is set, /api/health without cookie → 401."""
    with patch("backend.routers.health.get_cli") as mock_get_cli:
        mock_cli = mock_get_cli.return_value
        mock_cli.handshake.return_value = {"status": "ok"}
        response = client.get("/api/health")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PUBLIC_LINK_AUTH_REQUIRED"


def test_valid_cookie_allows_api_health_in_auth_mode(auth_env):
    """Cookie matching session token → request passes through."""
    client.cookies.set("life_index_public_link_session", "test-session-token-abc123")

    class StubCLI:
        async def handshake(self):
            return {"status": "ok"}

    app.dependency_overrides[health.get_cli] = lambda: StubCLI()
    try:
        response = client.get("/api/health")
    finally:
        app.dependency_overrides.pop(health.get_cli, None)

    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_partial_auth_env_blocks_api_fail_closed():
    """Any partial auth env enters auth mode and denies API access."""
    os.environ["LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN"] = "partial-token"
    client.cookies.set("life_index_public_link_session", "partial-token")

    with patch("backend.routers.health.get_cli") as mock_get_cli:
        response = client.get("/api/health")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PUBLIC_LINK_AUTH_REQUIRED"
    mock_get_cli.assert_not_called()


def test_api_public_link_endpoints_blocked_in_auth_mode(auth_env):
    """All /api/public-link/* are 403 when auth env enabled."""
    for path, method in [
        ("/api/public-link/status", "get"),
        ("/api/public-link/start", "post"),
        ("/api/public-link/stop", "post"),
    ]:
        if method == "get":
            response = client.get(path)
        else:
            response = client.post(path, json={})
        assert response.status_code == 403, f"{method.upper()} {path} should be 403"
        assert response.json()["error"]["code"] == "PUBLIC_LINK_AUTH_BLOCKED"


def test_non_api_routes_unaffected_by_auth_mode(auth_env):
    """Non-/api routes should not be gated by the auth middleware."""
    response = client.post("/auth/exchange", json={"code": "anything"})
    # Should get a 401 for invalid code, NOT a 401 for missing cookie
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PUBLIC_LINK_CODE_INVALID"


# =========================================================================
# /auth/exchange
# =========================================================================


def test_auth_exchange_not_configured_when_env_absent():
    """Without auth env, /auth/exchange returns 404."""
    response = client.post("/auth/exchange", json={"code": "anything"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PUBLIC_LINK_AUTH_NOT_CONFIGURED"


def test_auth_exchange_missing_code_returns_401(auth_env):
    response = client.post("/auth/exchange", json={})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PUBLIC_LINK_CODE_REQUIRED"


def test_auth_exchange_wrong_code_returns_401(auth_env):
    response = client.post("/auth/exchange", json={"code": "wrong-code"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PUBLIC_LINK_CODE_INVALID"


def test_auth_exchange_success_sets_cookie(auth_env):
    from backend.public_link_auth import set_code as _set_code

    _set_code("good-code", expires_in=30)
    response = client.post("/auth/exchange", json={"code": "good-code"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["redirectTo"] == "/"

    # Validate Set-Cookie header
    set_cookie = response.headers.get("set-cookie", "")
    assert "life_index_public_link_session=test-session-token-abc123" in set_cookie
    assert "httponly" in set_cookie.lower()
    assert "secure" in set_cookie.lower()
    assert "samesite=lax" in set_cookie.lower()
    assert "path=/" in set_cookie.lower()


def test_auth_exchange_code_single_use(auth_env):
    from backend.public_link_auth import set_code as _set_code

    _set_code("once-code", expires_in=30)

    # First use succeeds
    r1 = client.post("/auth/exchange", json={"code": "once-code"})
    assert r1.status_code == 200

    # Second use fails
    r2 = client.post("/auth/exchange", json={"code": "once-code"})
    assert r2.status_code == 401
    assert r2.json()["error"]["code"] == "PUBLIC_LINK_CODE_INVALID"


def test_auth_exchange_expired_code_fails(auth_env):
    from backend.public_link_auth import set_code as _set_code

    _set_code("expiring-code", expires_in=0)
    time.sleep(1)

    response = client.post("/auth/exchange", json={"code": "expiring-code"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PUBLIC_LINK_CODE_INVALID"


def test_auth_exchange_invalid_body_returns_400(auth_env):
    response = client.post(
        "/auth/exchange",
        content=b"not-json",
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST_BODY"


# =========================================================================
# Env-seeded one-time code exchange (spawned backend path)
# =========================================================================


def test_env_seeded_code_exchange_without_set_code():
    """exchange_code validates against env-seeded code without calling set_code()."""
    _enable_auth_env(token="env-tok-xyz", code="env-code-abc")
    future_expiry = str(int(time.time()) + 120)
    os.environ["LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT"] = future_expiry

    from backend.public_link_auth import exchange_code
    # Should NOT be in the in-memory store
    assert "env-code-abc" not in _code_store

    # Exchange succeeds, lazily seeding
    assert exchange_code("env-code-abc") is True
    assert "env-code-abc" in _code_store


def test_env_seeded_code_rejects_reuse():
    """Env-seeded code is single-use."""
    _enable_auth_env(token="tok", code="env-once")
    os.environ["LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT"] = str(int(time.time()) + 120)

    from backend.public_link_auth import exchange_code
    assert exchange_code("env-once") is True
    assert exchange_code("env-once") is False


def test_env_seeded_code_rejects_expired():
    """Expired env code → reject, never allow."""
    _enable_auth_env(token="tok", code="env-expired")
    os.environ["LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT"] = str(int(time.time()) - 10)

    from backend.public_link_auth import exchange_code
    assert exchange_code("env-expired") is False


def test_env_seeded_code_rejects_malformed_expiry():
    """Non-numeric CODE_EXPIRES_AT → reject."""
    _enable_auth_env(token="tok", code="env-malformed")
    os.environ["LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT"] = "not-a-number"

    from backend.public_link_auth import exchange_code
    assert exchange_code("env-malformed") is False


def test_env_seeded_code_rejects_missing_expiry():
    """No CODE_EXPIRES_AT env → reject."""
    _enable_auth_env(token="tok", code="env-no-expiry")
    os.environ.pop("LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT", None)

    from backend.public_link_auth import exchange_code
    assert exchange_code("env-no-expiry") is False


def test_env_seeded_code_rejects_missing_token():
    """Env-seeded exchange cannot mint an empty session cookie."""
    os.environ["LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE"] = "env-no-token"
    os.environ["LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT"] = str(int(time.time()) + 120)

    from backend.public_link_auth import exchange_code
    assert exchange_code("env-no-token") is False


# =========================================================================
# Start with auth env: token/code generation, args, oneTimeUrl, QR
# =========================================================================


def test_start_in_auth_mode_is_blocked_by_middleware(auth_env):
    """In auth mode, /api/public-link/* is blocked by middleware."""
    with _patch_public_link_preflight(), patch("backend.routers.public_link.subprocess.run") as run:
        run.return_value = CompletedProcess(args=[], returncode=0, stdout=SCRIPT_OUTPUT, stderr="")
        response = client.post("/api/public-link/start", json={"accept_risk": True})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PUBLIC_LINK_AUTH_BLOCKED"


def test_start_without_auth_env_still_generates_token_code_args():
    """Normal start (no auth env) still includes SessionToken/OneTimeCode/CodeExpiresAt."""
    with _patch_public_link_preflight(), patch("backend.routers.public_link.subprocess.run") as run:
        run.return_value = CompletedProcess(args=[], returncode=0, stdout=SCRIPT_OUTPUT, stderr="")
        response = client.post("/api/public-link/start", json={"accept_risk": True})

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    ready = _wait_for_public_link_ready()

    # oneTimeUrl and qrDataUrl always present
    assert ready["oneTimeUrl"] is not None
    assert "/link?code=" in ready["oneTimeUrl"]
    assert "qrDataUrl" in ready

    # Command always includes auth args
    command = run.call_args.args[0]
    assert "-SessionToken" in command
    assert "-OneTimeCode" in command
    assert "-CodeExpiresAt" in command

    # CodeExpiresAt value should be an integer (unix epoch)
    idx = command.index("-CodeExpiresAt")
    epoch_val = command[idx + 1]
    assert epoch_val.isdigit() and len(epoch_val) >= 10


def test_start_command_includes_auth_args_when_provided():
    """_start_command includes token/code/CodeExpiresAt args when passed."""
    from backend.routers.public_link import _start_command

    cmd = _start_command(
        frontend_port=15173,
        backend_port=18021,
        bridge_port=18791,
        wait_seconds=120,
        session_token="tok123",
        one_time_code="code456",
        code_expires_at=1700000000.0,
    )
    assert "-SessionToken" in cmd
    assert "tok123" in cmd
    assert "-OneTimeCode" in cmd
    assert "code456" in cmd
    assert "-CodeExpiresAt" in cmd
    assert "1700000000" in cmd[cmd.index("-CodeExpiresAt") + 1]


def test_start_with_auth_env_calls_set_code_and_generates_qr():
    """Direct call to start_public_link with auth env to test full flow."""
    _enable_auth_env()

    with _patch_public_link_preflight(), patch("backend.routers.public_link.subprocess.run") as run:
        run.return_value = CompletedProcess(args=[], returncode=0, stdout=SCRIPT_OUTPUT, stderr="")
        resp = public_link.start_public_link(body={"accept_risk": True})

    # Direct call returns APIResponse (not JSONResponse) and starts asynchronously
    assert resp.ok is True
    assert resp.data["starting"] is True
    ready = _wait_for_public_link_ready_direct()
    assert "oneTimeUrl" in ready
    assert "/link?code=" in ready["oneTimeUrl"]

    # QR data URL should be present if qrcode is available
    if "qrDataUrl" in ready and ready["qrDataUrl"]:
        assert ready["qrDataUrl"].startswith("data:image/png;base64,")

    # Verify the code was stored and the command included auth args
    command = run.call_args.args[0]
    assert "-SessionToken" in command
    assert "-OneTimeCode" in command
    assert "-CodeExpiresAt" in command

    # Clean up
    public_link._active_tunnel = None
    _code_store.clear()


# =========================================================================
# Stop clears token/code state
# =========================================================================


def test_stop_clears_code_store():
    from backend.public_link_auth import set_code as _set_code

    _set_code("stop-test-code", expires_in=120)
    assert len(_code_store) == 1

    public_link._active_tunnel = {
        "processes": [],
        "startedAt": "2026-01-01T00:00:00+00:00",
        "warnings": [],
    }
    with patch("backend.routers.public_link.subprocess.run"):
        resp = public_link.stop_public_link()

    # Direct call returns APIResponse on success
    assert resp.ok is True
    assert len(_code_store) == 0
    assert public_link._active_tunnel is None


# =========================================================================
# Warnings content
# =========================================================================


def test_warnings_describe_token_gated_tunnel():
    warnings = public_link._public_link_warnings()
    combined = " ".join(warnings).lower()
    # Should mention token-gated / one-time code
    assert "token-gated" in combined or "one-time code" in combined
    # Should NOT mention sandbox/passwordless
    assert "passwordless" not in combined
    assert "sandbox" not in combined


# =========================================================================
# Cookie name override via env
# =========================================================================


def test_cookie_name_override_via_env():
    os.environ["LIFE_INDEX_PUBLIC_LINK_SESSION_COOKIE"] = "my_custom_cookie"
    os.environ["LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN"] = "tok"
    os.environ["LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE"] = "code"

    from backend.public_link_auth import get_cookie_name
    assert get_cookie_name() == "my_custom_cookie"
