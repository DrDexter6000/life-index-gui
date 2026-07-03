"""Backend configuration — loaded from environment variables with sensible defaults."""

import json
import os
from pathlib import Path


def _load_package_version() -> str:
    package_path = Path(__file__).resolve().parents[1] / "package.json"
    try:
        return str(json.loads(package_path.read_text(encoding="utf-8")).get("version") or "0.0.0")
    except (OSError, json.JSONDecodeError):
        return "0.0.0"


GUI_VERSION: str = os.environ.get("LIFE_INDEX_GUI_VERSION", _load_package_version())

# CLI
CLI_COMMAND: str = os.environ.get("LIFE_INDEX_CLI", "life-index")
CLI_TIMEOUT: float = float(os.environ.get("CLI_TIMEOUT", "10"))
CLI_HEALTH_TIMEOUT: float = float(os.environ.get("CLI_HEALTH_TIMEOUT", "30"))

# Server
HOST: str = os.environ.get("BACKEND_HOST", "0.0.0.0")
PORT: int = int(os.environ.get("BACKEND_PORT", "8000"))

# CORS
CORS_ORIGINS: list[str] = os.environ.get(
    "CORS_ORIGINS",
    "http://127.0.0.1:5173,http://127.0.0.1:3000,http://127.0.0.1:3001,"
    "http://localhost:5173,http://localhost:3000,http://localhost:3001",
).split(",")

# Data directory is owned by the CLI (tools/lib/paths.py).
# GUI/backend must not resolve, cache, or pass a default path.
# If LIFE_INDEX_DATA_DIR is set in the backend process environment,
# CLIAdapter passes it through to CLI subprocesses so the CLI can
# honour the override.  Otherwise the CLI falls back to its own
# platform default (Path.home()/Documents/Life-Index).
