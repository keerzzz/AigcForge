import { describe, expect, test } from "bun:test"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { BUILTIN_MODES, isMode, modeDefinition, modeDraft, modeHref, MODE_DEFINITIONS } from "./mode"

describe("product mode", () => {
  test("accepts only built-in modes", () => {
    for (const definition of MODE_DEFINITIONS) {
      expect(isMode(definition.id)).toBe(true)
    }

    expect(isMode("unknown-mode")).toBe(false)
    expect(isMode(undefined)).toBe(false)
  })

  test("keeps every navigation and presentation field in one registry", () => {
    expect(BUILTIN_MODES).toEqual(MODE_DEFINITIONS.map((definition) => definition.id))
    expect(new Set(MODE_DEFINITIONS.map((definition) => definition.id)).size).toBe(MODE_DEFINITIONS.length)
    expect(new Set(MODE_DEFINITIONS.map((definition) => definition.href)).size).toBe(MODE_DEFINITIONS.length)
    expect(new Set(MODE_DEFINITIONS.map((definition) => definition.icon)).size).toBe(MODE_DEFINITIONS.length)
    expect(new Set(MODE_DEFINITIONS.map((definition) => definition.surface)).size).toBe(MODE_DEFINITIONS.length)

    for (const definition of MODE_DEFINITIONS) {
      expect(modeDefinition(definition.id)).toBe(definition)
      expect(modeHref(definition.id)).toBe(definition.href)
      expect(definition.href).toBe(`/mode/${definition.id}`)
      expect(definition.icon).toBe(`mode-${definition.id}`)
      expect(definition.labelKey).toBe(`mode.${definition.id}`)
      expect(definition.descriptionKey).toBe(`mode.${definition.id}.description`)
      expect(definition.surface).toBe(definition.id)
    }
  })

  test("binds chat/work/coding drafts to meta and assistant drafts to assistant-orchestrator (2026-08-11 + plan §3.3)", () => {
    expect(modeDraft("chat")).toEqual({ mode: "chat", agent: "meta" })
    expect(modeDraft("coding")).toEqual({ mode: "coding", agent: "meta" })
    expect(modeDraft("work")).toEqual({ mode: "work", agent: "meta" })
    expect(modeDraft("assistant")).toEqual({ mode: "assistant", agent: "assistant-orchestrator" })
  })

  test("the definitions and the schema mode union cover each other", () => {
    // Two independent lists until now: `MODE_DEFINITIONS` is the app's navigation contract and
    // `ProductMode.ID` is the wire union. S7 made them load-bearing for each other — a schema
    // mode with no definition makes `modeHref` throw when a non-creatable mode is routed to,
    // and a definition for a mode the server does not know routes to a surface that cannot
    // create anything. Neither had a gate.
    expect([...BUILTIN_MODES].sort()).toEqual([...ProductMode.ID.literals].sort())
  })

  test("custom has no draft path", () => {
    // It used to be in the case above, asserting `{ mode: "custom", agent: "meta" }`. That
    // draft was the defect: custom sessions are created atomically from a composition
    // snapshot, so a custom draft's first send goes to plain `POST /session` and is rejected.
    // @ts-expect-error custom is not a generically creatable mode
    const draft = modeDraft("custom")
    // The suppression above IS the assertion — it fails the build the day custom becomes
    // generically creatable. Comparing against the literal would re-introduce the type error
    // inside the matcher, so this only keeps the binding alive.
    expect(typeof draft.mode).toBe("string")
  })
})
