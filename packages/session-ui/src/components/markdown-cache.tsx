import { checksum } from "@aigcfroge/core/util/encode"
import DOMPurify from "dompurify"
import { project } from "./markdown-stream"

export type MarkdownCacheEntry = {
  raw: string
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, MarkdownCacheEntry>()
// DOMPurify 默认 ALLOWED_URI_REGEXP 只放行常见网络协议；assistant 引文锚定
// 使用 [note title](kb://<noteID>)（批次 4 G4），需显式加入 kb: 协议，
// 否则 sanitize 会剥掉 href 导致角标不可点击。其余部分与 DOMPurify 默认
// 白名单逐字一致（勿额外放行 file: 等默认不含的协议）。
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|kb):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  // form 必须同时进 FORBID_CONTENTS：FORBID_TAGS 只剥标签本身并跳过子树
  // 检查（KEEP_CONTENT），form 的 input/button 子节点会原样留在输出里。
  FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea"],
  FORBID_CONTENTS: ["style", "script", "form"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
  ALLOWED_URI_REGEXP,
}

// 内联 style **不能**整条禁掉：KaTeX 的视觉层完全靠它定位（实测用到 height /
// top / margin-left|right / vertical-align / border-bottom-width / min-width /
// width / padding-left），禁掉后 \frac{a}{b} 的分子分母会叠在一起。
// 真正的攻击面是「脱离文档流后盖住 permission / question 提示框」，所以这里只摘掉
// 出流能力：position 一旦移除，top/left/inset/z-index 随之失效，元素回到文档流。
// KaTeX 的内联 position 只用 relative（实测 13 种构造），不在下表内，不受影响。
// 结构性兜底在 markdown.css 的 contain: layout（容器成为定位包含块 + 层叠上下文）。
const OUT_OF_FLOW_POSITIONS = new Set(["absolute", "fixed", "sticky"])

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLElement)) return

    // 用 CSSOM 读写而不是自己写 CSS 解析器：空白与重复声明都由浏览器归一化。
    // 关键字大小写必须自己兜：Chromium 的 CSSOM 会把 STICKY 归一成 sticky，
    // happy-dom 原样返回 "STICKY"，靠实现归一化就等于让防线取决于 DOM 实现。
    // mermaid 的图走 mermaidSvgConfig 且是 SVGElement，不会命中这里。
    if (OUT_OF_FLOW_POSITIONS.has(node.style.position.toLowerCase())) node.style.removeProperty("position")
    // transform 不在 KaTeX 的内联属性表里，但能把元素画到自身盒子之外。
    if (node.style.transform) node.style.removeProperty("transform")
    if (node.hasAttribute("style") && node.getAttribute("style") === "") node.removeAttribute("style")

    if (!(node instanceof HTMLAnchorElement) || !node.hasAttribute("href")) return

    // marked 的默认 link renderer 只输出转义后的 href/title（接管渲染的覆写
    // 已删除，见 packages/ui/src/context/marked.tsx），外链行为在这里补齐。
    node.setAttribute("target", "_blank")
    const rel = new Set((node.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean))
    rel.add("noopener")
    rel.add("noreferrer")
    node.setAttribute("rel", Array.from(rel).join(" "))
    const cls = new Set((node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean))
    cls.add("external-link")
    node.setAttribute("class", Array.from(cls).join(" "))
  })
}

export function sanitizeMarkdown(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function getCachedMarkdown(key: string) {
  return cache.get(key)
}

export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export async function preloadMarkdown(
  text: string,
  cacheKey: string,
  parser: { parse(text: string): string | Promise<string> },
) {
  await Promise.all(
    project(undefined, text, false).blocks.map(async (block, index) => {
      if (block.mode === "code") return
      const key = `${cacheKey}:${index}:${block.mode}`
      const cached = getCachedMarkdown(key)
      if (cached?.raw === block.raw) {
        touchCachedMarkdown(key, cached)
        return
      }
      const hash = checksum(block.raw)
      if (!hash) return
      touchCachedMarkdown(key, {
        raw: block.raw,
        hash,
        html: sanitizeMarkdown(await Promise.resolve(parser.parse(block.src))),
      })
    }),
  )
}
