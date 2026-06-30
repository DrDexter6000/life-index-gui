"""Public-link auth gate: one-time-code exchange + cookie verification.

The spawned (tunneled) backend validates /auth/exchange from env-seeded auth
values passed by the main backend via script arguments:

  LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN      — expected session cookie value
  LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE       — single-use code for /auth/exchange
  LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT     — absolute unix-epoch expiry (required)
  LIFE_INDEX_PUBLIC_LINK_SESSION_COOKIE      — optional cookie name override

The in-memory _code_store is retained for route-level tests that call set_code().
"""

from __future__ import annotations

import os
from secrets import compare_digest
import time
from typing import Any


# ---------------------------------------------------------------------------
# Environment-driven gate
# ---------------------------------------------------------------------------

_REQUIRED_AUTH_ENV_KEYS = (
    "LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN",
    "LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE",
    "LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT",
)


def auth_env_enabled() -> bool:
    """Return True when any required auth env var is present."""
    return any(os.environ.get(key, "") for key in _REQUIRED_AUTH_ENV_KEYS)


def auth_env_complete() -> bool:
    """Return True only when required auth env is complete and parseable."""
    return (
        bool(get_session_token())
        and bool(os.environ.get("LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE", ""))
        and _read_env_expiry() is not None
    )


def get_session_token() -> str:
    return os.environ.get("LIFE_INDEX_PUBLIC_LINK_SESSION_TOKEN", "")


def get_cookie_name() -> str:
    return os.environ.get("LIFE_INDEX_PUBLIC_LINK_SESSION_COOKIE", "life_index_public_link_session")


# ---------------------------------------------------------------------------
# In-memory single-use code store (populated by set_code / start_public_link)
# ---------------------------------------------------------------------------

_code_store: dict[str, dict[str, Any]] = {}  # code -> {"expires_at": float, "used": bool}


def set_code(code: str, expires_in: int = 120) -> None:
    """Register a code with a relative TTL.  Kept for route-level tests."""
    _code_store[code] = {"expires_at": time.time() + expires_in, "used": False}


def set_code_absolute(code: str, expires_at: float) -> None:
    """Register a code with an absolute unix-epoch expiry."""
    _code_store[code] = {"expires_at": expires_at, "used": False}


def clear_code_store() -> None:
    """Wipe all pending codes (called on stop)."""
    _code_store.clear()


# ---------------------------------------------------------------------------
# exchange_code — lazy env-seeded validation, single-use, TTL, fail-closed
# ---------------------------------------------------------------------------

def _read_env_expiry() -> float | None:
    """Read and validate CODE_EXPIRES_AT from env.  Returns None if absent/malformed."""
    raw = os.environ.get("LIFE_INDEX_PUBLIC_LINK_CODE_EXPIRES_AT")
    if not raw:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Cookie helpers (pure functions — no framework dependency)
# ---------------------------------------------------------------------------


def _cookie_flags() -> dict[str, str]:
    """Standard cookie attributes for the session cookie."""
    return {
        "httponly": "True",
        "secure": "True",
        "samesite": "Lax",
        "path": "/",
    }


def cookie_header_value(name: str, value: str) -> str:
    """Build a Set-Cookie header line."""
    parts = [f"{name}={value}"]
    for k, v in _cookie_flags().items():
        parts.append(f"{k}={v}")
    return "; ".join(parts)


def exchange_code(code: str) -> bool:
    """Validate and consume *code*.  Returns True on success.

    Strategy:
    1. If the code exists in the in-memory store, validate there (keeps
       set_code()-based tests working).
    2. Otherwise, lazily seed from env vars when the code matches the env-
       seeded one_time_code AND CODE_EXPIRES_AT is present and valid.
    3. Single-use, TTL/fail-closed: expired / malformed expiry → reject.
    """
    # --- in-memory path (set_code / set_code_absolute) ---
    entry = _code_store.get(code)
    if entry is not None:
        if entry["used"]:
            return False
        if time.time() > entry["expires_at"]:
            return False
        entry["used"] = True
        return True

    # --- lazy env-seeded path (spawned backend) ---
    env_code = os.environ.get("LIFE_INDEX_PUBLIC_LINK_ONE_TIME_CODE", "")
    if not get_session_token() or not env_code or not compare_digest(code, env_code):
        return False

    expires_at = _read_env_expiry()
    if expires_at is None:
        return False

    if time.time() > expires_at:
        return False

    # Seed into in-memory store and consume atomically
    set_code_absolute(code, expires_at)
    _code_store[code]["used"] = True
    return True
