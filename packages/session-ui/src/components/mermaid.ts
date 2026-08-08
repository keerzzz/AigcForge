import type { Mermaid } from "mermaid"
import DOMPurify from "dompurify"
import { escapeHtml } from "./markdown-cache"

function resolveCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

let mermaidReady: Promise<Mermaid> | undefined
let mermaidThemeKey = ""

// Mermaid rejects CSS var strings ("Unsupported color format: var(--v2-...)"),
// so themeVariables must be resolved to concrete values at init time via
// resolveCssVar. Hex fallbacks are SSR/early-load only -- v2 tokens are always
// set in production by the theme system. The theme key fingerprints the
// resolved values: a light/dark (or theme) switch invalidates the cached
// instance, so the next initialize picks up the new colors and
// recolorMermaidDiagrams re-renders in-place.
const resolveThemeVars = () => ({
  primaryColor: resolveCssVar("--v2-background-bg-accent", "#ECECFF"),
  primaryTextColor: resolveCssVar("--v2-text-text-base", "#000000"),
  primaryBorderColor: resolveCssVar("--v2-border-border-base", "#9370DB"),
  lineColor: resolveCssVar("--v2-text-text-muted", "#333333"),
  background: resolveCssVar("--v2-background-bg-base", "#ffffff"),
})

const themeKey = (vars: ReturnType<typeof resolveThemeVars>) => Object.values(vars).join("|")

function getMermaid() {
  const vars = resolveThemeVars()
  const key = themeKey(vars)
  if (!mermaidReady || key !== mermaidThemeKey) {
    mermaidThemeKey = key
    mermaidReady = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "base",
        htmlLabels: false,
        themeVariables: vars,
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
      // Keep the diagram source on a wrapper so recolorMermaidDiagrams can
      // re-render it in place after a theme switch. The wrapper is a block
      // div (same layout as the placeholder it replaces).
      el.outerHTML = `<div data-mermaid-src="${encodeURIComponent(src)}">${sanitizeMermaidSvg(svg)}</div>`
    } catch (error) {
      console.error("[mermaid] render failed, fallback to source", error)
      el.outerHTML = `<pre><code class="language-mermaid">${escapeHtml(src)}</code></pre>`
    }
  }
  return doc.body.innerHTML
}

let recolorChain: Promise<void> = Promise.resolve()

/**
 * Re-render already-rendered diagrams in place after a theme (or light/dark)
 * switch. No-op when nothing is rendered yet -- the next renderMermaidBlocks
 * already picks up the new theme via the fingerprint check. Renders are
 * serialized so rapid theme toggles cannot interleave two mermaid.render calls
 * on the same element. Resolves when the re-render pass settles.
 */
export function recolorMermaidDiagrams(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve()
  const pass = recolorChain.then(async () => {
    const targets = [...document.querySelectorAll<HTMLElement>("[data-mermaid-src]")]
    if (targets.length === 0) return
    const mermaid = await getMermaid()
    for (const el of targets) {
      if (!el.isConnected) continue
      const src = decodeSrc(el.getAttribute("data-mermaid-src") ?? "")
      if (!src) continue
      try {
        const id = `mermaid-${crypto.randomUUID()}`
        const { svg } = await mermaid.render(id, src)
        el.innerHTML = sanitizeMermaidSvg(svg)
      } catch (error) {
        // Keep the previous render; a transient theme race is not worth
        // destroying a working diagram.
        console.error("[mermaid] recolor failed, keeping previous render", error)
      }
    }
  })
  recolorChain = pass.catch(() => {})
  return pass
}

export * as Mermaid from "./mermaid"
