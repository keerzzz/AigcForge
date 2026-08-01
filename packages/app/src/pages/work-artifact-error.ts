/**
 * 判定 SDK apply 调用是否因同名冲突（409 ConflictError）失败。
 * throwOnError 抛出的错误体即服务端响应 JSON（{ _tag, message, resource }），无 status 字段。
 */
export function isConflictError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "_tag" in error
    ? (error as { _tag: unknown })._tag === "ConflictError"
    : false
}

/** 提取可安全打印的失败原因：仅取 message 字符串，不打印整个错误对象，避免 Clean Logs 泄漏请求 payload。 */
export function describeApplyError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === "string") return message
  }
  return typeof error === "string" ? error : "unknown error"
}
