"""Map CLI stderr / exit codes to structured error codes."""

import json

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


def _parse_negative_error(channel: str) -> tuple[str, str] | None:
    """Extract code/message only from an explicit negative CLI envelope."""
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
    return code, message


def map_import_error(exc: CLIError) -> tuple[str, str]:
    """Map a CLI import error to (error_code, Chinese_user_message).

    Parses the CLI JSON error envelope from CLIError.stdout to extract
    ``error.code`` and maps it to a GUI error constant and user message.
    Unrecognized codes fall back to ``IMPORT_INTERNAL_ERROR``.
    """
    for channel in (exc.stderr, exc.stdout):
        structured_error = _parse_negative_error(channel)
        if structured_error is None:
            continue
        code, message = structured_error
        if code in {"CLI_VERSION_UNSUPPORTED", "CLI_VERSION_INVALID"}:
            return code, message
        if code in IMPORT_ERROR_MESSAGES:
            return (code, IMPORT_ERROR_MESSAGES[code])

    try:
        payload = json.loads(exc.stdout) if exc.stdout else {}
    except (TypeError, json.JSONDecodeError):
        return (E.IMPORT_INTERNAL_ERROR, IMPORT_ERROR_MESSAGES[E.IMPORT_INTERNAL_ERROR])

    error_block = payload.get("error") if isinstance(payload, dict) else None
    error_data = error_block if isinstance(error_block, dict) else {}
    code = str(error_data.get("code") or "")

    if code in IMPORT_ERROR_MESSAGES:
        return (code, IMPORT_ERROR_MESSAGES[code])

    return (E.IMPORT_INTERNAL_ERROR, IMPORT_ERROR_MESSAGES[E.IMPORT_INTERNAL_ERROR])


def map_cli_error(stderr: str, returncode: int = 1) -> tuple[str, str]:
    """Map CLI error output to (error_code, user_message).

    Returns a tuple of (machine-readable code, user-friendly Chinese message).
    """
    structured_error = _parse_negative_error(stderr)
    if structured_error is not None:
        return structured_error

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
