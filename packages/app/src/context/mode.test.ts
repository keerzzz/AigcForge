import { describe, expect, test } from "bun:test"
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

  test("binds chat/work/coding/custom drafts to meta and assistant drafts to assistant-orchestrator (2026-08-11 + plan §3.3)", () => {
    expect(modeDraft("chat")).toEqual({ mode: "chat", agent: "meta" })
    expect(modeDraft("coding")).toEqual({ mode: "coding", agent: "meta" })
    expect(modeDraft("work")).toEqual({ mode: "work", agent: "meta" })
    expect(modeDraft("custom")).toEqual({ mode: "custom", agent: "meta" })
    expect(modeDraft("assistant")).toEqual({ mode: "assistant", agent: "assistant-orchestrator" })
  })
})
