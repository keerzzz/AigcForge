import type { Mermaid } from "mermaid"
import DOMPurify from "dompurify"

function resolveCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

let mermaidReady: Promise<Mermaid> | undefined

// mermaid registers anonymous before/afterSanitizeAttributes hooks on the
// shared DOMPurify instance on first render (it would overwrite rel to just
// "noopener" for target=_blank links in all markdown). Remove them once, after
// mermaid's setup guard has run, so global markdown sanitize keeps its own
// noopener+noreferrer behavior. removeHook pops the last-registered hook, which
// is mermaid's (markdown-cache registers at module load, before mermaid loads).
let mermaidHooksRemoved = false

function removeMermaidDompurifyHooks() {
  if (mermaidHooksRemoved) return
  mermaidHooksRemoved = true
  DOMPurify.removeHook("beforeSanitizeAttributes")
  DOMPurify.removeHook("afterSanitizeAttributes")
}

function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "base",
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
  removeMermaidDompurifyHooks()
  return doc.body.innerHTML
}

export * as Mermaid from "./mermaid"
