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


# ── M7 review/batch arg builders ──────────────────────────────────────────


def build_import_validate_args(source_root: Path) -> list[str]:
    """Build CLI args for ``life-index import validate``."""
    return ["import", "validate", "--source-root", str(source_root), "--json"]


def build_import_stage_args(
    plan_path: Path, source_root: Path, import_id: str | None = None
) -> list[str]:
    """Build CLI args for ``life-index import stage``."""
    args = [
        "import", "stage",
        "--plan", str(plan_path),
        "--source-root", str(source_root),
    ]
    if import_id is not None:
        args.extend(["--import-id", import_id])
    args.append("--json")
    return args


def build_import_reviews_args(
    after: str | None = None, limit: int | None = None
) -> list[str]:
    """Build CLI args for ``life-index import reviews``."""
    args = ["import", "reviews"]
    if after is not None:
        args.extend(["--after", after])
    if limit is not None:
        args.extend(["--limit", str(limit)])
    args.append("--json")
    return args


def build_import_review_args(
    import_id: str,
    offset: int | None = None,
    limit: int | None = None,
    states: list[str] | None = None,
) -> list[str]:
    """Build CLI args for ``life-index import review``."""
    args = ["import", "review", "--import-id", import_id]
    if offset is not None:
        args.extend(["--offset", str(offset)])
    if limit is not None:
        args.extend(["--limit", str(limit)])
    # --state is repeatable on the CLI: emit one flag per value, in order.
    for state in states or []:
        args.extend(["--state", state])
    args.append("--json")
    return args


def build_import_confirm_edit_args(
    edit_path: Path,
    import_id: str,
    expected_queue_revision: int,
    source_root: Path | None = None,
) -> list[str]:
    """Build CLI args for ``life-index import confirm --edit``."""
    args = [
        "import", "confirm",
        "--edit", str(edit_path),
        "--import-id", import_id,
        "--expected-queue-revision", str(expected_queue_revision),
    ]
    if source_root is not None:
        args.extend(["--source-root", str(source_root)])
    args.append("--json")
    return args


def build_import_rebind_args(import_id: str, source_root: Path) -> list[str]:
    """Build CLI args for ``life-index import rebind``."""
    return [
        "import", "rebind",
        "--import-id", import_id,
        "--source-root", str(source_root),
        "--json",
    ]


def build_import_preview_args(
    import_id: str,
    attachment_id: str,
    *,
    proposal_id: str | None = None,
    source_root: Path | None = None,
    output: str | None = None,
    metadata_output: Path | None = None,
) -> list[str]:
    """Build CLI args for ``life-index import preview``.

    ``output`` is the CLI's byte-sink selector: ``"-"`` streams raw bytes to
    stdout (consumed by ``run_preview_bytes``); any other value is a path the
    CLI writes to. ``metadata_output`` is a path the CLI writes a metadata
    sidecar JSON to. The two are independent and may be combined.
    """
    args = [
        "import", "preview",
        "--import-id", import_id,
        "--attachment", attachment_id,
    ]
    if proposal_id is not None:
        args.extend(["--proposal-id", proposal_id])
    if source_root is not None:
        args.extend(["--source-root", str(source_root)])
    if output is not None:
        args.extend(["--output", output])
    if metadata_output is not None:
        args.extend(["--metadata-output", str(metadata_output)])
    args.append("--json")
    return args


def build_import_batch_run_args(
    import_id: str, source_root: Path | None = None
) -> list[str]:
    """Build CLI args for ``life-index import run --import-id`` (batch path)."""
    args = ["import", "run", "--import-id", import_id]
    if source_root is not None:
        args.extend(["--source-root", str(source_root)])
    args.append("--json")
    return args


# ── Envelope normalizers ──────────────────────────────────────────────────


def _validate_envelope(
    raw: dict[str, Any],
    expected_data_schema: str,
    *,
    strip_keys: tuple[str, ...] = (),
) -> dict[str, Any]:
    """Validate a CLI import envelope and return the nested data block.

    Confirms the outer ``import_job.v1`` envelope, a successful result, and the
    expected nested ``data.schema_version``. Any ``strip_keys`` (locator paths
    or hashes the backend policy keeps out of the GUI contract) are removed
    from the returned copy — never from the caller's dict.
    """
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
    result = dict(data)
    for key in strip_keys:
        result.pop(key, None)
    return result


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


# ── M7 review/batch normalizers ───────────────────────────────────────────
# Each validates the outer import_job.v1 envelope + its nested schema_version,
# then strips the locator/hash fields the backend policy keeps out of the GUI
# contract. Authority tokens the CLI emits for client change-detection
# (source_root_identity) and idempotency (plan_fingerprint) are preserved.


def normalize_stage_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an ``import stage`` envelope (import_review.v1).

    Strips ``review_plan_rel_path`` (a locator into CLI-internal storage).
    """
    return _validate_envelope(
        raw, "import_review.v1", strip_keys=("review_plan_rel_path",)
    )


def normalize_confirm_edit_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an ``import confirm --edit`` envelope (import_review.v1).

    The single-proposal projection is already locator-free; no strip needed.
    """
    return _validate_envelope(raw, "import_review.v1")


def normalize_review_queue_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an ``import review`` envelope (import_review.v1).

    review_queue emits no rel paths; source_root_identity is kept as the
    authority token for source-drift detection.
    """
    return _validate_envelope(raw, "import_review.v1")


def normalize_reviews_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an ``import reviews`` envelope (import_review.v1).

    list_reviews is locator-free by design (job-lifecycle metadata only).
    """
    return _validate_envelope(raw, "import_review.v1")


def normalize_validate_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an ``import validate`` envelope (import_review.v1).

    Strips the absolute ``source_root`` (the GUI already has it from the
    request); keeps ``source_root_identity`` for drift detection.
    """
    return _validate_envelope(raw, "import_review.v1", strip_keys=("source_root",))


def normalize_rebind_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an ``import rebind`` envelope (import_review.v1).

    Strips the absolute ``source_root``; keeps import_id, queue_revision,
    rebound, and source_root_identity.
    """
    return _validate_envelope(raw, "import_review.v1", strip_keys=("source_root",))


def normalize_batch_run_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize an ``import run --import-id`` batch envelope (import_run.v1).

    Strips ``rollback_manifest_rel_path`` (a locator into user data). Unlike
    the legacy run normalizer (same schema), the batch path hides the manifest.
    The child batch id under ``import_id`` (``PARENT#batch-N``) is preserved.
    """
    return _validate_envelope(
        raw, "import_run.v1", strip_keys=("rollback_manifest_rel_path",)
    )


def normalize_review_status_envelope(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a review-parent ``import status`` envelope (import_review.v1).

    Strips ``review_plan_rel_path`` only (per the M7 contract); keeps
    source_root_identity, plan_fingerprint, revisions, and child batches.
    """
    return _validate_envelope(
        raw, "import_review.v1", strip_keys=("review_plan_rel_path",)
    )


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


# ── M7 edit-payload / preview-metadata temp helpers ───────────────────────


def write_temp_edit(edit_payload: dict[str, Any]) -> Path:
    """Write an import_review_edit.v1 payload to a unique OS temp file.

    Distinct prefix from ``write_temp_plan`` so review edits and plans never
    collide on disk; always in the OS temp dir, never in user data.
    """
    file = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix="life_index_import_edit_",
        delete=False,
        encoding="utf-8",
    )
    try:
        json.dump(edit_payload, file, ensure_ascii=False)
    finally:
        file.close()
    return Path(file.name)


def unique_metadata_path() -> Path:
    """Return a unique OS temp path for a preview metadata sidecar.

    The CLI writes the sidecar; the backend only generates the path, then
    reads + unlinks it. The path is outside ``LIFE_INDEX_DATA_DIR``.
    ``mkstemp`` creates an empty file (closed immediately) that the CLI
    truncates and rewrites, guaranteeing a unique, collision-free name.
    """
    fd, name = tempfile.mkstemp(suffix=".json", prefix="life_index_preview_meta_")
    os.close(fd)
    return Path(name)


def read_preview_metadata(metadata_path: Path) -> dict[str, Any]:
    """Bounded-read + clean a preview metadata sidecar via OS primitives only.

    Reads at most ``_PREVIEW_SIDECAR_MAX_BYTES`` (1 MiB) using
    ``os.open``/``os.read``/``os.close`` (never ``open()`` or
    ``Path.read_text``) to honour the L1 boundary, then strips the source
    locator (``source_rel_path``) and content hash (``source_sha256``) the CLI
    embeds for its own byte-streaming bookkeeping. Oversized, unreadable, or
    malformed sidecars fail closed as ``preview_unavailable``.
    """
    try:
        fd = os.open(str(metadata_path), os.O_RDONLY)
    except OSError as exc:
        raise PreviewVerificationError(PREVIEW_REASON_UNAVAILABLE) from exc
    try:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            total += len(chunk)
            if total > _PREVIEW_SIDECAR_MAX_BYTES:
                raise PreviewVerificationError(PREVIEW_REASON_UNAVAILABLE)
            chunks.append(chunk)
    finally:
        os.close(fd)

    try:
        payload = json.loads(b"".join(chunks).decode("utf-8"))
    except ValueError as exc:
        raise PreviewVerificationError(PREVIEW_REASON_UNAVAILABLE) from exc
    if not isinstance(payload, dict):
        raise PreviewVerificationError(PREVIEW_REASON_UNAVAILABLE)
    payload.pop("source_rel_path", None)
    payload.pop("source_sha256", None)
    return payload


# ── Preview sidecar verification (fail-closed) ─────────────────────────────
# The CLI's naked sidecar contract is import_preview.v1 with parent_id,
# proposal_id, attachment_id, source_rel_path, source_sha256, size_bytes,
# media_type, available. The backend strips the locator/hash and verifies the
# rest against the request before trusting any byte — never the other way.

_PREVIEW_SIDECAR_MAX_BYTES = 1024 * 1024  # 1 MiB bounded read

# Closed reasons for preview verification failures (surfaced verbatim in
# error.details.reason; never CLI passthrough, never paths/hashes/bytes).
PREVIEW_REASON_SCHEMA_UNSUPPORTED = "preview_schema_unsupported"
PREVIEW_REASON_UNAVAILABLE = "preview_unavailable"
PREVIEW_REASON_IDENTITY_MISMATCH = "preview_identity_mismatch"
PREVIEW_REASON_MEDIA_UNSUPPORTED = "preview_media_unsupported"
PREVIEW_REASON_SIZE_MISMATCH = "preview_size_mismatch"


class PreviewVerificationError(Exception):
    """Raised when a preview sidecar fails a fail-closed verification check.

    Carries a closed ``reason`` from the preview-failure set so the route can
    surface a fixed ``IMPORT_PREVIEW_UNAVAILABLE`` without leaking bytes,
    paths, or hashes.
    """

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def verify_preview_sidecar(
    metadata: dict[str, Any],
    *,
    parent_id: str,
    proposal_id: str,
    attachment_id: str,
    content: bytes,
) -> dict[str, Any]:
    """Fail-closed verification of a parsed preview metadata sidecar.

    Validates, in order: ``schema_version == import_preview.v1``,
    ``available is True``, exact identity (parent_id/proposal_id/attachment_id
    equal the request), ``media_type == image/jpeg`` (v1), and a strict-integer
    ``size_bytes`` (not bool) that equals ``len(content)``. Returns the
    locator/hash-free metadata on success; any failure raises
    ``PreviewVerificationError`` with a closed reason.
    """
    if metadata.get("schema_version") != "import_preview.v1":
        raise PreviewVerificationError(PREVIEW_REASON_SCHEMA_UNSUPPORTED)
    if metadata.get("available") is not True:
        raise PreviewVerificationError(PREVIEW_REASON_UNAVAILABLE)
    if not (
        metadata.get("parent_id") == parent_id
        and metadata.get("proposal_id") == proposal_id
        and metadata.get("attachment_id") == attachment_id
    ):
        raise PreviewVerificationError(PREVIEW_REASON_IDENTITY_MISMATCH)
    if metadata.get("media_type") != "image/jpeg":
        raise PreviewVerificationError(PREVIEW_REASON_MEDIA_UNSUPPORTED)
    size_bytes = metadata.get("size_bytes")
    if not (isinstance(size_bytes, int) and not isinstance(size_bytes, bool)):
        raise PreviewVerificationError(PREVIEW_REASON_SIZE_MISMATCH)
    if size_bytes != len(content):
        raise PreviewVerificationError(PREVIEW_REASON_SIZE_MISMATCH)
    return metadata
