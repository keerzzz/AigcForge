/**
 * 预览中 `[[wikilink]]` 装饰（批次 3 G4）：Markdown 渲染后把 wikilink 文本
 * 包裹为可定位 span（data-title + data-dangling），悬空（目标标题不存在）
 * 高亮。幂等（MutationObserver 重入安全），跳过代码块。
 */

export const WIKILINK_PATTERN = /\[\[([^[\]\n]+)\]\]/g

export const WIKILINK_SPAN = "data-wikilink"

export function wikilinkSpans(root: HTMLElement): HTMLSpanElement[] {
  return Array.from(root.querySelectorAll<HTMLSpanElement>(`[${WIKILINK_SPAN}]`))
}

function skipNode(node: Node): boolean {
  if (node.nodeType !== Node.TEXT_NODE) return true
  const parent = node.parentElement
  if (!parent) return true
  if (parent.closest("pre, code, [data-wikilink], a, h1, h2, h3, h4, h5, h6")) return true
  return false
}

/**
 * 把根节点下所有 wikilink 文本包裹为 span。resolve(title) 返回目标 id →
 * data-dangling="false"；返回 undefined → data-dangling="true"。
 */
export function decorateWikilinks(root: HTMLElement, resolve: (title: string) => string | undefined) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!(node instanceof Text)) continue
    if (skipNode(node)) continue
    if (!node.data.includes("[[")) continue
    nodes.push(node)
  }
  for (const node of nodes) {
    const parent = node.parentElement
    if (!parent) continue
    if (parent.closest("[data-wikilink]")) continue
    const fragments = node.data.split(WIKILINK_PATTERN)
    const fragment = document.createDocumentFragment()
    for (let index = 0; index < fragments.length; index += 3) {
      const plain = fragments[index]
      if (plain) fragment.append(document.createTextNode(plain))
      const title = fragments[index + 1]
      if (title !== undefined) {
        const span = document.createElement("span")
        span.setAttribute(WIKILINK_SPAN, "")
        span.setAttribute("data-title", title)
        span.setAttribute("data-dangling", resolve(title) === undefined ? "true" : "false")
        span.textContent = `[[${title}]]`
        fragment.append(span)
      }
    }
    parent.replaceChild(fragment, node)
  }
}
