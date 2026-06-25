"""Import adapter — arg builders, envelope normalizers, temp plan, transient store."""

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

from backend import config

# ── Transient plan store (in-memory, TTL eviction) ─────────────────────────
# Keyed by import_id, holds a timestamp plus a copy of the plan envelope.

_TRANSIENT_TTL_SECONDS = 600  # 10 minutes

_transient_plan_store: dict[str, dict[str, Any]] = {}


def store_transient_plan(
    import_id: str,
    envelope: dict[str, Any],
    source_root: Path | str | None = None,
) -> None:
    """Store a plan envelope in the transient in-memory store."""
    _transient_plan_store[import_id] = {
        "stored_at": time.time(),
        "envelope": dict(envelope),
        "source_root": Path(source_root) if source_root is not None else None,
    }
    _evict_expired()


def get_transient_plan(import_id: str) -> dict[str, Any] | None:
    """Retrieve a transient plan envelope, or None if missing/expired."""
    _evict_expired()
    record = _transient_plan_store.get(import_id)
    if record is None:
        return None
    envelope = record.get("envelope")
    if not isinstance(envelope, dict):
        return None
    return dict(envelope)


def get_transient_source_root(import_id: str) -> Path | None:
    """Retrieve a transient source root needed by run-only CLI adapters."""
    _evict_expired()
    record = _transient_plan_store.get(import_id)
    if record is None:
        return None
    source_root = record.get("source_root")
    if source_root is None:
        return None
    return Path(source_root)


def _evict_expired() -> None:
    """Remove entries whose TTL has elapsed."""
    now = time.time()
    expired = [
        key for key, record in _transient_plan_store.items()
        if now - float(record.get("stored_at", 0)) > _TRANSIENT_TTL_SECONDS
    ]
    for key in expired:
        _transient_plan_store.pop(key, None)


# ── Arg builders ───────────────────────────────────────────────────────────


def build_import_plan_args(source: str, input_path: Path) -> list[str]:
    """Build CLI args for ``life-index import plan``."""
    return [
        "import", "plan",
        "--source", source,
        "--input", str(input_path),
        "--json",
    ]


def build_import_run_args(
    plan_path: Path,
    import_id: str,
    source_root: Path | None = None,
) -> list[str]:
    """Build CLI args for ``life-index import run``."""
    args = [
        "import", "run",
        "--plan", str(plan_path),
        "--confirm", import_id,
    ]
    if source_root is not None:
        args.extend(["--source-root", str(source_root)])
    args.append("--json")
    return args


def build_import_status_args(import_id: str) -> list[str]:
    """Build CLI args for ``life-index import status``."""
    return [
        "import", "status",
        "--import-id", import_id,
        "--json",
    ]


def build_import_rollback_args(import_id: str) -> list[str]:
    """Build CLI args for ``life-index import rollback``."""
    return [
        "import", "rollback",
        "--import-id", import_id,
        "--json",
    ]


# ── Envelope normalizers ──────────────────────────────────────────────────


def _validate_envelope(raw: dict[str, Any], expected_data_schema: str) -> dict[str, Any]:
    """Validate CLI import envelope and return the nested data block unchanged."""
    if raw.get("schema_version") != "import_job.v1":
        raise ValueError(
            f"Unexpected schema_version: {raw.get('schema_version')}, expected import_job.v1"
        )
    if raw.get("success") is not True:
        error = raw.get("error")
        raise ValueError(f"CLI command failed: {error}")
    data = raw.get("data")
    if not isinstance(data, dict):
        raise ValueError("CLI response data is not a dict")
    if data.get("schema_version") != expected_data_schema:
        raise ValueError(
            "Unexpected data.schema_version: "
            f"{data.get('schema_version')}, expected {expected_data_schema}"
        )
    return dict(data)


def normalize_plan_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a plan CLI JSON envelope into the GUI contract shape."""
    return _validate_envelope(raw, "import_plan.v1")


def normalize_run_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a run CLI JSON envelope into the GUI contract shape."""
    return _validate_envelope(raw, "import_run.v1")


def normalize_status_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a status CLI JSON envelope into the GUI contract shape."""
    return _validate_envelope(raw, "import_status.v1")


def normalize_rollback_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a rollback CLI JSON envelope into the GUI contract shape."""
    return _validate_envelope(raw, "import_rollback.v1")


# ── Temp plan file ─────────────────────────────────────────────────────────


def write_temp_plan(plan_data: dict[str, Any]) -> Path:
    """Write plan JSON to a system temp file and return its path.

    The temp file is placed in the OS temp directory, never inside
    ``LIFE_INDEX_DATA_DIR``, to avoid polluting user data directories with
    backend transient artifacts.
    """
    file = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="life_index_import_plan_",
        delete=False,
        encoding="utf-8",
    )
    try:
        json.dump(plan_data, file, ensure_ascii=False)
    finally:
        file.close()
    return Path(file.name)
