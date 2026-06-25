/**
 * Frontend error message mapping — translates backend error codes
 * to user-friendly Chinese messages.
 *
 * No traceback, no English tech terms, no stack traces leaking.
 */

const ERROR_MESSAGES: Record<string, string> = {
  // Client errors
  NOT_FOUND: '未找到这篇日志',
  VALIDATION_ERROR: '信息不完整，请检查后重试',
  PERMISSION_DENIED: '没有权限执行此操作',

  // CLI/Backend errors
  CLI_ERROR: '遇到了一点小插曲，请稍后再试',
  CLI_TIMEOUT: '连接超时，请稍后重试',
  WRITE_ERROR: '保存失败，请重试',
  EDIT_ERROR: '编辑保存时遇到了问题，请重试',
  LIST_ERROR: '加载日志列表时遇到了问题',
  READ_ERROR: '读取日志时遇到了问题',
  SEARCH_ERROR: '搜索时遇到了问题',

  // External service
  GEOCODE_ERROR: '暂时无法获取位置，请手动输入',

  // Schema / response errors
  SCHEMA_ERROR: '遇到了一点小插曲，请稍后再试',
  MALFORMED_RESPONSE: '遇到了一点小插曲，请稍后再试',

  // HTTP errors
  HTTP_ERROR: '网络连接失败，请稍后重试',

  // Server-side errors — the network is fine, the server responded with an
  // error. Must not be mislabeled as a network failure.
  SERVER_ERROR: '服务暂时出错了，请稍后重试',
  INTERNAL_ERROR: '服务暂时出错了，请稍后重试',

  // Catch-all
  UNKNOWN_ERROR: '遇到了一点小插曲，请稍后再试',
};

/**
 * Get a user-friendly error message from a backend error code.
 * Falls back to the generic catch-all for unknown codes.
 */
export function getUserMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN_ERROR;
}

/**
 * Get a user-friendly error message from an APIClientError.
 */
export function getErrorMessage(error: { code?: string; message?: string }): string {
  if (error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }
  // Don't expose raw error messages — they might contain technical details
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}
