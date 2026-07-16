import type { V2ColorValue } from "../types"

const ref = (name: string): V2ColorValue => `var(--${name})`

/**
 * Diff tokens.
 *
 * Differentiated from state tokens by using different ramp steps:
 *   v2-state-bg-success → green-100         (light, faded — status indicators)
 *   v2-diff-add-bg     → green-200          (light, one step deeper — code context)
 *   v2-state-fg-success → green-800         (deep — labels)
 *   v2-diff-add-text   → green-600          (mid — inline code text)
 */
export function mapV2Diff(isDark: boolean): Record<string, V2ColorValue> {
  return {
    // Background — one step deeper than state bg for code context
    "v2-diff-add-bg": ref(isDark ? "v2-green-1200" : "v2-green-200"),
    "v2-diff-add-bg-strong": ref(isDark ? "v2-green-1000" : "v2-green-300"),
    "v2-diff-delete-bg": ref(isDark ? "v2-red-1200" : "v2-red-200"),
    "v2-diff-delete-bg-strong": ref(isDark ? "v2-red-1000" : "v2-red-300"),
    "v2-diff-unchanged-bg": ref("v2-background-bg-base"),

    // Foreground (text/icon) — mid ramp, distinct from state fg
    "v2-diff-add-text": ref(isDark ? "v2-green-400" : "v2-green-600"),
    "v2-diff-delete-text": ref(isDark ? "v2-red-400" : "v2-red-600"),
    "v2-diff-add-icon": ref(isDark ? "v2-green-400" : "v2-green-500"),
    "v2-diff-delete-icon": ref(isDark ? "v2-red-400" : "v2-red-500"),

    // Diff hidden (interactive diff collapsed regions)
    "v2-diff-hidden-bg": ref(isDark ? "v2-alpha-light-4" : "v2-alpha-dark-4"),
    "v2-diff-hidden-bg-hover": ref(isDark ? "v2-alpha-light-8" : "v2-alpha-dark-8"),
  }
}
