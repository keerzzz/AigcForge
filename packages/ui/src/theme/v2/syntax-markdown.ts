import type { V2ColorValue } from "../types"

const ref = (name: string): V2ColorValue => `var(--${name})`

/**
 * Syntax highlighting tokens.
 *
 * Each token references a hue ramp step appropriate for the hue's luminance:
 *   blue/cyan/purple have low luminance → dark mode needs 200-300 for contrast
 *   green/yellow/orange have higher luminance → 400-500 is safe in dark mode
 *   Light mode uniformly uses 500-600 for sufficient depth against light bg
 *
 * Mapping rationale (vs v1 compact mode):
 *   string  → green  (v1: content(success, scale))
 *   keyword → purple (v1: content(accent, scale))
 *   primitive → blue (v1: content(primary, scale))
 *   type    → yellow (v1: content(warning, scale))
 *   property → cyan  (v1: content(info, scale))
 *   constant → purple (v1: content(accent, scale))
 *   comment/operator/punctuation → text-muted/faint (v1: same ref)
 *   variable/object → text-base (v1: same ref)
 */
export function mapV2Syntax(isDark: boolean): Record<string, V2ColorValue> {
  return {
    "v2-syntax-comment": ref("v2-text-text-faint"),
    "v2-syntax-regexp": ref("v2-text-text-muted"),
    "v2-syntax-string": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-syntax-keyword": ref(isDark ? "v2-purple-300" : "v2-purple-600"),
    "v2-syntax-primitive": ref(isDark ? "v2-blue-200" : "v2-blue-600"),
    "v2-syntax-operator": ref("v2-text-text-muted"),
    "v2-syntax-variable": ref("v2-text-text-base"),
    "v2-syntax-property": ref(isDark ? "v2-cyan-200" : "v2-cyan-600"),
    "v2-syntax-type": ref(isDark ? "v2-yellow-500" : "v2-yellow-600"),
    "v2-syntax-constant": ref(isDark ? "v2-purple-300" : "v2-purple-600"),
    "v2-syntax-punctuation": ref("v2-text-text-muted"),
    "v2-syntax-object": ref("v2-text-text-base"),
    "v2-syntax-success": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-syntax-warning": ref(isDark ? "v2-orange-400" : "v2-orange-600"),
    "v2-syntax-critical": ref(isDark ? "v2-red-400" : "v2-red-600"),
    "v2-syntax-info": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-syntax-diff-add": ref(isDark ? "v2-green-400" : "v2-green-500"),
    "v2-syntax-diff-delete": ref(isDark ? "v2-red-400" : "v2-red-500"),
    "v2-syntax-diff-unknown": ref("v2-red-500"),
  }
}

/**
 * Markdown rendering tokens.
 *
 * Uses the same hue mapping as syntax tokens but for markdown-specific roles:
 *   heading    → blue   (was: primary hue / v1 hardcoded)
 *   link       → blue   (was: interactive hue)
 *   code       → green  (was: success hue)
 *   block-quote → yellow (was: warning hue)
 *   strong     → orange (was: accent hue)
 */
export function mapV2Markdown(isDark: boolean): Record<string, V2ColorValue> {
  return {
    "v2-markdown-heading": ref(isDark ? "v2-blue-200" : "v2-blue-600"),
    "v2-markdown-text": ref("v2-text-text-base"),
    "v2-markdown-link": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-markdown-link-text": ref(isDark ? "v2-blue-200" : "v2-blue-400"),
    "v2-markdown-code": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-markdown-block-quote": ref(isDark ? "v2-yellow-500" : "v2-yellow-600"),
    "v2-markdown-emph": ref(isDark ? "v2-yellow-500" : "v2-yellow-600"),
    "v2-markdown-strong": ref(isDark ? "v2-orange-500" : "v2-orange-600"),
    "v2-markdown-horizontal-rule": ref("v2-border-border-muted"),
    "v2-markdown-list-item": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-markdown-list-enumeration": ref(isDark ? "v2-blue-200" : "v2-blue-400"),
    "v2-markdown-image": ref(isDark ? "v2-blue-300" : "v2-blue-500"),
    "v2-markdown-image-text": ref(isDark ? "v2-blue-200" : "v2-blue-400"),
    "v2-markdown-code-block": ref("v2-text-text-base"),
  }
}
