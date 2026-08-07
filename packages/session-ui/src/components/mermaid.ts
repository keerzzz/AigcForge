import type { Mermaid } from "mermaid"
import type { ElementHook } from "dompurify"
import DOMPurify from "dompurify"

function resolveCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

let mermaidReady: Promise<Mermaid> | undefined

// mermaid registers anonymous before/afterSanitizeAttributes hooks on the
// shared DOMPurify instance during its first render; its after-hook would
// overwrite rel to just "noopener" for target=_blank links in all markdown.
// Isolate the render behind a drain/restore of the original hooks so mermaid's
// hooks never survive a render batch, whatever they are.
type AttributeHook = ElementHook
let markdownHooks: { before: AttributeHook[]; after: AttributeHook[] } | undefined

function drainHooks(entryPoint: "beforeSanitizeAttributes" | "afterSanitizeAttributes"): AttributeHook[] {
  const out: AttributeHook[] = []
  for (let hook = DOMPurify.removeHook(entryPoint); hook !== undefined; hook = DOMPurify.removeHook(entryPoint)) {
    out.push(hook)
  }
  return out
}

function restoreHooks(entryPoint: "beforeSanitizeAttributes" | "afterSanitizeAttributes", hooks: AttributeHook[]) {
  for (let i = hooks.length - 1; i >= 0; i--) {
    DOMPurify.addHook(entryPoint, hooks[i]!)
  }
}

function isolateMarkdownHooks() {
  if (markdownHooks) return
  markdownHooks = {
    before: drainHooks("beforeSanitizeAttributes"),
    after: drainHooks("afterSanitizeAttributes"),
  }
}

function restoreMarkdownHooks() {
  if (!markdownHooks) return
  restoreHooks("beforeSanitizeAttributes", markdownHooks.before)
  restoreHooks("afterSanitizeAttributes", markdownHooks.after)
  markdownHooks = undefined
}

function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "base",
        htmlLabels: false,
        themeVariables: {
          primaryColor: resolveCssVar("--v2-background-bg-accent", "#ECECFF"),
          primaryTextColor: resolveCssVar("--v2-text-text-base", "#000000"),
          primaryBorderColor: resolveCssVar("--v2-border-border-base", "#9370DB"),
          lineColor: resolveCssVar("--v2-text-text-muted", "#333333"),
          background: resolveCssVar("--v2-background-bg-base", "#ffffff"),
        },
        securityLevel: "strict",
      })
      return m.default
    })
  }
  return mermaidReady
}

const mermaidSvgConfig = {
  USE_PROFILES: { svg: true },
  SANITIZE_NAMED_PROPS: false,
  FORBID_TAGS: ["foreignObject", "script"],
  FORBID_ATTR: ["onload", "onclick", "onerror"],
}

export function sanitizeMermaidSvg(svg: string): string {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(svg, mermaidSvgConfig)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function decodeSrc(encoded: string): string {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

export async function renderMermaidBlocks(html: string): Promise<string> {
  if (!html.includes("data-mermaid")) return html
  const mermaid = await getMermaid()
  const doc = new DOMParser().parseFromString(html, "text/html")
  const placeholders = doc.querySelectorAll<HTMLDivElement>("[data-mermaid]")
  if (placeholders.length === 0) return html
  isolateMarkdownHooks()
  for (const el of placeholders) {
    const src = decodeSrc(el.getAttribute("data-mermaid") ?? "")
    try {
      const id = `mermaid-${crypto.randomUUID()}`
      const { svg } = await mermaid.render(id, src)
      el.outerHTML = sanitizeMermaidSvg(svg)
    } catch (error) {
      console.error("[mermaid] render failed, fallback to source", error)
      el.outerHTML = `<pre><code class="language-mermaid">${escapeHtml(src)}</code></pre>`
    }
  }
  restoreMarkdownHooks()
  return doc.body.innerHTML
}

export * as Mermaid from "./mermaid"
