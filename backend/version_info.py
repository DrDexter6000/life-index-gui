"""GUI/backend version compatibility helpers."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from backend import config
from backend.adapter.cli_adapter import MIN_SUPPORTED_CLI_VERSION


@lru_cache(maxsize=1)
def get_gui_version() -> str:
    """Return the GUI package version from package.json."""
    return config.GUI_VERSION


def enrich_handshake_version(payload: dict[str, Any]) -> dict[str, Any]:
    """Add GUI and canonical CLI compatibility aliases to a handshake payload."""
    data = dict(payload)
    minimum = MIN_SUPPORTED_CLI_VERSION
    data["gui_version"] = get_gui_version()
    data["cli_minimum_version"] = minimum
    data["minimum_supported_version"] = minimum
    return data


def compatibility_version_payload(handshake_payload: dict[str, Any]) -> dict[str, Any]:
    """Return the concise version object agents should treat as authoritative."""
    data = enrich_handshake_version(handshake_payload)
    return {
        "gui_version": data["gui_version"],
        "cli_minimum_version": data["cli_minimum_version"],
        "repo_version": data.get("repo_version"),
        "cli_package_version": data.get("package_version"),
        "cli_available": data.get("cli_available"),
        "compatible": data.get("compatible"),
        "status": data.get("status"),
    }
