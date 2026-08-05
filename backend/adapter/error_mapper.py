"""Map CLI stderr / exit codes to structured error codes.

``map_import_error`` returns a ``(code, message, details)`` triple. ``details``
is ``None`` for legacy/version/internal codes (preserving the existing
behaviour), and a strictly-stripped *safe recovery* dict for the M7
review/batch authority codes. Safe recovery facts are extracted only from the
nested ``error.details`` block of a frozen-CLI negative envelope — never from
the whole error block, and never as arbitrary CLI messages.
"""

import json
import re

from backend.adapter.cli_adapter import CLIError
from backend.models import errors as E

# ── Import error messages (Chinese) ────────────────────────────────────────

IMPORT_ERROR_MESSAGES = {
    E.IMPORT_SOURCE_UNSUPPORTED: "不支持的导入来源类型",
    E.IMPORT_SOURCE_UNREADABLE: "无法读取导入源文件，请检查文件是否存在",
    E.IMPORT_PLAN_SCHEMA_UNSUPPORTED: "导入方案格式不兼容，请检查 CLI 版本",
    E.IMPORT_PLAN_INVALID: "导入方案校验失败，请检查数据格式",
    E.IMPORT_PLAN_CONFLICTS_UNRESOLVED: "存在未解决的冲突，请先处理后再导入",
    E.IMPORT_CONFIRMATION_REQUIRED: "需要确认导入操作",
    E.IMPORT_CONFLICT_EXISTING_PATH: "目标路径已存在，请重新生成或通过 CLI 处理",
    E.IMPORT_IDEMPOTENCY_CONFLICT: "导入任务标识冲突，请勿重复提交",
    E.IMPORT_JOB_NOT_COMMITTED: "导入任务尚未提交",
    E.IMPORT_WRITE_FAILURE: "写入失败，请检查磁盘空间和权限",
    E.IMPORT_JOB_NOT_FOUND: "未找到该导入任务",
    E.IMPORT_ROLLBACK_MANIFEST_MISSING: "回滚证据缺失，无法执行回滚",
    E.IMPORT_ROLLBACK_CHECKSUM_MISMATCH: "文件已被修改，回滚不安全",
    E.IMPORT_ROLLBACK_UNSAFE: "回滚操作不安全，已中止",
    E.IMPORT_INTERNAL_ERROR: "导入过程中遇到意外错误",
}

# ── M7 review/batch authority messages (stable, fixed — never CLI passthrough)

M7_IMPORT_ERROR_MESSAGES = {
    E.IMPORT_REVIEW_ALREADY_STAGED: "该照片源已存在进行中的审阅任务，可直接继续",
    E.IMPORT_REVIEW_REVISION_CONFLICT: "审阅队列已更新，请刷新后重试",
    E.IMPORT_REVIEW_RECOVERY_REQUIRED: "审阅队列需要恢复后才能继续操作",
    E.IMPORT_REVIEW_PROPOSAL_FROZEN: "该条目已进入导入流程，无法再编辑",
    E.IMPORT_REVIEW_EDIT_INVALID: "编辑内容校验未通过，请检查后重试",
    E.IMPORT_REVIEW_PLAN_MISSING: "未找到审阅方案，请重新发起",
    E.IMPORT_SOURCE_ROOT_UNREADABLE: "照片源目录无法读取，请检查路径",
    E.IMPORT_SOURCE_ROOT_IDENTITY_MISMATCH: "照片源与已记录的不一致，请确认目录",
    E.IMPORT_PREVIEW_UNAVAILABLE: "无法预览该照片",
    E.IMPORT_BATCH_ALREADY_ACTIVE: "已有正在进行的批次导入，请等待其完成",
    E.IMPORT_NO_RUNNABLE_PROPOSALS: "当前没有可导入的条目",
    E.IMPORT_RECOVERY_REQUIRED: "导入任务需要恢复后才能继续操作",
    E.IMPORT_ROLLBACK_PARENT_NOT_ALLOWED: "父审阅任务不能整体回滚，请回滚其子批次",
    E.IMPORT_ROLLBACK_INTERRUPTED: "回滚已中断，恢复状态已保留，可重试",
}

# Closed-set backend reason surfaced inside ``details``. The CLI's own message
# text is never passed through; the GUI maps ``reason`` to localized copy.
REASON_FOR_CODE = {
    E.IMPORT_REVIEW_ALREADY_STAGED: "already_staged",
    E.IMPORT_REVIEW_REVISION_CONFLICT: "revision_conflict",
    E.IMPORT_REVIEW_RECOVERY_REQUIRED: "recovery_required",
    E.IMPORT_REVIEW_PROPOSAL_FROZEN: "proposal_frozen",
    E.IMPORT_REVIEW_EDIT_INVALID: "edit_invalid",
    E.IMPORT_REVIEW_PLAN_MISSING: "plan_missing",
    E.IMPORT_SOURCE_ROOT_UNREADABLE: "source_root_unreadable",
    E.IMPORT_SOURCE_ROOT_IDENTITY_MISMATCH: "identity_mismatch",
    E.IMPORT_PREVIEW_UNAVAILABLE: "preview_unavailable",
    E.IMPORT_BATCH_ALREADY_ACTIVE: "batch_active",
    E.IMPORT_NO_RUNNABLE_PROPOSALS: "no_runnable",
    E.IMPORT_RECOVERY_REQUIRED: "recovery_required",
    E.IMPORT_ROLLBACK_PARENT_NOT_ALLOWED: "rollback_parent_not_allowed",
    E.IMPORT_ROLLBACK_INTERRUPTED: "rollback_interrupted",
    E.CLI_FEATURE_UNAVAILABLE: "feature_unavailable",
}

# Safe scalar string recovery facts (typed ids / opaque status only). The
# frozen CLI treats attachment_id as a stable opaque id (att_<sha-prefix>) and
# itself whitelists it as non-locator in _available_attachments.
_SAFE_STRING_KEYS = (
    "existing_import_id",
    "active_child_id",
    "import_id",
    "parent_id",
    "child_id",
    "proposal_id",
    "attachment_id",
    "authority_status",
)

# Safe strict-integer recovery facts.
_SAFE_INT_KEYS = (
    "current_queue_revision",
    "expected_queue_revision",
    "queue_revision",
    "plan_revision",
    "deleted_count",
)

# argparse / no-such-command signal: the frozen CLI uses sys.exit(1) for its
# own JSON errors, so a non-zero exit of exactly 2 is argparse's own usage
# failure (invalid choice / unrecognized arguments / missing required). The
# stdout channel then carries no JSON envelope.
_ARGPARSE_PATTERN = re.compile(
    r"invalid choice|unrecognized arguments|the following arguments are required|"
    r"are required:|--(?:plan|edit|source-root|import-id|attachment)"
)


def _is_argparse_failure(exc: CLIError) -> bool:
    """True when the CLI failed at argparse (no such command / bad args).

    The frozen import provider exits 1 for every JSON error it emits, so an
    exit code of 2 is argparse's own usage error. We additionally accept a
    matching stderr usage line for robustness on platforms that remap codes.
    """
    if exc.returncode == 2:
        return True
    stderr = (exc.stderr or "")
    return bool(stderr) and bool(_ARGPARSE_PATTERN.search(stderr))


def _parse_negative_error(channel: str) -> tuple[str, str, dict] | None:
    """Extract (code, message, details) from an explicit negative CLI envelope.

    The frozen CLI emits ``import_job.v1`` with ``error={code, message,
    details, retryable}``; safe recovery facts live under ``error.details``.
    """
    try:
        payload = json.loads(channel) if channel else None
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or not (
        payload.get("ok") is False or payload.get("success") is False
    ):
        return None
    error = payload.get("error")
    if not isinstance(error, dict):
        return None
    code = error.get("code")
    message = error.get("message")
    if not isinstance(code, str) or not code.strip():
        return None
    if not isinstance(message, str) or not message.strip():
        return None
    details = error.get("details")
    details = details if isinstance(details, dict) else {}
    return code, message, details


def _safe_recovery(code: str, details: dict) -> dict:
    """Project only the safe, typed recovery facts needed by the UI.

    Drops source paths, source-root identity/hash, content hashes/fingerprints,
    manifest blobs, arbitrary reason text, and any non-typed value. Adds one
    closed-set ``reason``.
    """
    out: dict = {}
    for key in _SAFE_STRING_KEYS:
        value = details.get(key)
        if isinstance(value, str) and value:
            out[key] = value
    for key in _SAFE_INT_KEYS:
        value = details.get(key)
        # Strict int: reject bools and numeric strings.
        if isinstance(value, int) and not isinstance(value, bool):
            out[key] = value
    recovery = details.get("recovery_required")
    if isinstance(recovery, bool):
        out["recovery_required"] = recovery
    queue_counts = details.get("queue_counts")
    if isinstance(queue_counts, dict):
        safe_counts = {
            str(k): v
            for k, v in queue_counts.items()
            if isinstance(v, int) and not isinstance(v, bool)
        }
        if safe_counts:
            out["queue_counts"] = safe_counts
    out["reason"] = REASON_FOR_CODE.get(code, "import_error")
    return out


def map_import_error(exc: CLIError) -> tuple[str, str, dict | None]:
    """Map a CLI import error to (code, Chinese message, safe details|None).

    A real CLI error (version guard or import code) always rides in a
    structured negative envelope on either channel, so it is parsed first and
    respected ahead of any exit-code heuristic. The nested ``error.details``
    block is the sole source of recovery facts; only a closed whitelist of
    typed fields survives, plus a closed ``reason``. Only when no envelope is
    present do we fall back to argparse / no-such-command detection
    (``CLI_FEATURE_UNAVAILABLE``). Legacy and version codes keep their existing
    behaviour (``details=None``).
    """
    for channel in (exc.stderr, exc.stdout):
        structured = _parse_negative_error(channel)
        if structured is None:
            continue
        code, message, details = structured
        if code in {"CLI_VERSION_UNSUPPORTED", "CLI_VERSION_INVALID"}:
            return (code, message, None)
        if code in IMPORT_ERROR_MESSAGES:
            return (code, IMPORT_ERROR_MESSAGES[code], None)
        if code in M7_IMPORT_ERROR_MESSAGES:
            return (code, M7_IMPORT_ERROR_MESSAGES[code], _safe_recovery(code, details))

    # No structured envelope ⇒ an argparse / no-such-command failure on the
    # review/batch surface. The frozen CLI exits 1 for its own JSON errors, so
    # a bare exit 2 (or a matching usage line) with no envelope is argparse's
    # own usage error.
    if _is_argparse_failure(exc):
        return (
            E.CLI_FEATURE_UNAVAILABLE,
            "当前 CLI 版本不支持该导入能力，请升级 Life Index CLI",
            {"reason": REASON_FOR_CODE[E.CLI_FEATURE_UNAVAILABLE]},
        )

    # Fallback: a stdout JSON block without an explicit negative marker.
    try:
        payload = json.loads(exc.stdout) if exc.stdout else {}
    except (TypeError, json.JSONDecodeError):
        return (
            E.IMPORT_INTERNAL_ERROR,
            IMPORT_ERROR_MESSAGES[E.IMPORT_INTERNAL_ERROR],
            None,
        )

    error_block = payload.get("error") if isinstance(payload, dict) else None
    error_data = error_block if isinstance(error_block, dict) else {}
    code = str(error_data.get("code") or "")
    if code in IMPORT_ERROR_MESSAGES:
        return (code, IMPORT_ERROR_MESSAGES[code], None)

    return (
        E.IMPORT_INTERNAL_ERROR,
        IMPORT_ERROR_MESSAGES[E.IMPORT_INTERNAL_ERROR],
        None,
    )


def map_cli_error(stderr: str, returncode: int = 1) -> tuple[str, str]:
    """Map CLI error output to (error_code, user_message).

    Returns a tuple of (machine-readable code, user-friendly Chinese message).
    """
    structured_error = _parse_negative_error(stderr)
    if structured_error is not None:
        code, message, _details = structured_error
        return (code, message)

    lower = stderr.lower()

    # Permission issues
    if "permission denied" in lower or "access denied" in lower:
        return (E.PERMISSION_DENIED, "没有权限执行此操作")

    # Not found
    if "not found" in lower or "no journal" in lower:
        return (E.NOT_FOUND, "未找到这篇日志")

    # Timeout (from our own CLIAdapter)
    if "timed out" in lower or "timeout" in lower:
        return (E.CLI_TIMEOUT, "连接有点慢，请稍后再试")

    # Write-specific errors
    if "write" in lower and ("fail" in lower or "error" in lower):
        if "缺少必填字段" in stderr or "date" in lower:
            return (E.VALIDATION_ERROR, "缺少必填信息，请检查后重试")
        return (E.WRITE_ERROR, "保存日志时遇到了问题")

    # Generic CLI error
    return (E.CLI_ERROR, "遇到了一点小插曲，请稍后再试")


def map_geocode_error(message: str) -> tuple[str, str]:
    """Map geocode service error to user-friendly message."""
    if "timeout" in message.lower():
        return (E.GEOCODE_ERROR, "位置服务响应较慢，请稍后再试")
    return (E.GEOCODE_ERROR, "暂时无法获取位置，请手动输入")
