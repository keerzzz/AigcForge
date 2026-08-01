/**
 * 判定 SDK apply 调用是否因同名冲突（409 ConflictError）失败。
 * throwOnError 抛出的错误体即服务端响应 JSON（{ _tag, message, resource }），无 status 字段。
 */
export function isConflictError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "_tag" in error
    ? (error as { _tag: unknown })._tag === "ConflictError"
    : false
}
