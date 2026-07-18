import { describe, expect, test } from "bun:test"
import { BUILTIN_MODES, isMode, modeDefinition, modeDraft, modeHref, MODE_DEFINITIONS } from "./mode"

describe("product mode", () => {
  test("accepts only built-in modes", () => {
    for (const definition of MODE_DEFINITIONS) {
      expect(isMode(definition.id)).toBe(true)
    }

    expect(isMode("custom")).toBe(false)
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

  test("binds chat drafts to the chat orchestrator", () => {
    expect(modeDraft("chat")).toEqual({ mode: "chat", agent: "chat-orchestrator" })
    expect(modeDraft("coding")).toEqual({ mode: "coding", agent: undefined })
  })
})
