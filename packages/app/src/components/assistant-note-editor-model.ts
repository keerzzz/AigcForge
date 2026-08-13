/**
 * 双栏笔记编辑器纯逻辑（批次 3 G4，计划 §3.4）：`[[补全]]` 从现有标题索引
 * 补全（find → candidates → insert）+ 悬空链接检测（wikilink 目标不存在）。
 */

export type WikilinkCompletion = {
  start: number
  query: string
}

/** 定位 caret 之前最后一个未闭合的 `[[`（同在一行内）。 */
export function findWikilinkBeforeCaret(text: string, caret: number): WikilinkCompletion | undefined {
  if (caret <= 0) return undefined
  const before = text.slice(0, caret)
  const lineStart = before.lastIndexOf("\n") + 1
  const open = before.lastIndexOf("[[")
  if (open < lineStart) return undefined
  const query = before.slice(open + 2)
  if (query.includes("]]")) return undefined
  return { start: open, query }
}

/** 标题补全候选：包含 query 的标题，前缀优先，封顶 limit 条。 */
export function wikilinkCandidates(titles: string[], query: string, limit = 8): string[] {
  const needle = query.toLowerCase()
  const match = titles.filter((title) => title.toLowerCase().includes(needle))
  const score = (title: string) => (title.toLowerCase().startsWith(needle) ? 0 : 1)
  return [...match].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, limit)
}

/** 把 `[[query` 替换为 `[[title]]`（保留 caret 之后的内容）。 */
export function insertCompletion(text: string, match: WikilinkCompletion, title: string): string {
  return `${text.slice(0, match.start)}[[${title}]]${text.slice(match.start + match.query.length + 2)}`
}

/** 提取内容中全部唯一 `[[标题]]`。 */
export function extractWikilinks(text: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const pattern = /\[\[([^\[\]\n]+)\]\]/g
  for (const match of text.matchAll(pattern)) {
    const title = match[1]?.trim()
    if (!title || seen.has(title)) continue
    seen.add(title)
    result.push(title)
  }
  return result
}

/** 悬空链接：内容中引用了但标题索引里不存在的 wikilink。 */
export function danglingWikilinks(text: string, knownTitles: ReadonlySet<string>): string[] {
  return extractWikilinks(text).filter((title) => !knownTitles.has(title))
}
