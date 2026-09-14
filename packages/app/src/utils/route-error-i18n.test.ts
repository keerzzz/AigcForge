import { describe, expect, test } from "bun:test"
import { dict } from "@/i18n/en"
import { routeErrorKey } from "./route-error"

// Every failure kind renders a title and a description built from this map. A
// missing key renders an empty heading in production (silent, no gate) — which
// is exactly what happened when the kinds were kebab-case and the dictionary
// segments camelCase. This test makes that class of bug loud.
describe("route error i18n coverage", () => {
  const entries = Object.entries(routeErrorKey)
  // Membership checks are dynamic by design: the dictionary's literal key type
  // is what these assertions validate against.
  const english: Readonly<Record<string, string>> = dict
  // The declared kinds, spelled out so adding a kind to the union without a
  // dictionary entry fails here instead of rendering a blank heading.
  const declaredKinds = [
    "invalid-server-key",
    "location-unresolved",
    "parent-not-found",
    "session-load-failed",
    "session-not-found",
    "unknown-route",
    "unknown-server",
  ]

  test("maps every declared kind exactly once", () => {
    expect(Object.keys(routeErrorKey).sort()).toEqual(declaredKinds)
    for (const [kind, segment] of entries) {
      expect(segment.length, `${kind} segment`).toBeGreaterThan(0)
    }
  })

  test("every kind has a title and a description in the English dictionary", () => {
    for (const [kind, segment] of entries) {
      expect(english[`route.error.${segment}.title`], `${kind} title`).toBeTruthy()
      expect(english[`route.error.${segment}.description`], `${kind} description`).toBeTruthy()
    }
  })

  test("every action and label the surface renders exists in the English dictionary", () => {
    for (const key of [
      "route.error.action.home",
      "route.error.action.retry",
      "route.error.action.copyDiagnostics",
      "route.error.action.copied",
      "route.error.diagnostics",
    ]) {
      expect(english[key], key).toBeTruthy()
    }
  })
})
