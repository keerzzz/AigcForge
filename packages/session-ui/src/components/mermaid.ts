import type { Mermaid } from "mermaid"
import DOMPurify from "dompurify"
import { escapeHtml } from "./markdown-cache"

function resolveCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

let mermaidReady: Promise<Mermaid> | undefined

// Mermaid rejects CSS var strings ("Unsupported color format: var(--v2-...)"),
// so themeVariables must be resolved to concrete values at init time via
// resolveCssVar. Hex fallbacks are SSR/early-load only -- v2 tokens are always
// set in production by the theme system. Consequently a light/dark switch does
// NOT re-color already-rendered diagrams; re-initializing mermaid and
// re-rendering visible blocks on theme change is tracked as tech debt (plan §11).
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
  FORBID_TAGS: ["foreignObject", "script", "style"],
  FORBID_ATTR: ["onload", "onclick", "onerror"],
}

export function sanitizeMermaidSvg(svg: string): string {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(svg, mermaidSvgConfig)
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
  return doc.body.innerHTML
}

export * as Mermaid from "./mermaid"
