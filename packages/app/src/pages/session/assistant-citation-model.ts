/**
 * 引文锚定纯逻辑（批次 4 G4，F2）：assistant 回答中的 `[标题](kb://id)`
 * markdown 链接由 marked 渲染为普通链接，app 层 timeline 后处理（仅
 * assistant 模式）拦截点击 → 展开摘要 → openEntityPanel("kb", id)。
 * 宽容解析：解析失败/无记录 → 不渲染摘要，不阻塞回答。
 */

/** 解析 kb:// 引用 URI；宽容：任何非空 opaque id 均接受。 */
export function parseKbUri(href: string): string | undefined {
  const value = href.trim()
  if (!value.startsWith("kb://")) return undefined
  const id = value.slice("kb://".length)
  if (!id || /\s/.test(id)) return undefined
  return id
}

/** 摘要截断：正文前 maxLength 字符，词边界 + 省略号。 */
export function citationSummary(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content
  const slice = content.slice(0, maxLength)
  const boundary = slice.lastIndexOf(" ")
  const cut = boundary > maxLength * 0.6 ? boundary : maxLength
  return `${slice.slice(0, cut).trimEnd()}…`
}
