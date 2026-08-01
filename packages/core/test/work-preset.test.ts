import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { WorkPresetRegistry } from "../src/session/work-preset"

const CATEGORIES = ["it-development", "video-creation", "academic", "general-office"] as const

describe("WorkPresetRegistry", () => {
  test("registers exactly 4 high-confidence presets", () => {
    expect(WorkPresetRegistry.list()).toHaveLength(4)
  })

  test("every preset decodes against the WorkPreset schema", () => {
    for (const preset of WorkPresetRegistry.list()) {
      const decoded = Schema.decodeUnknownSync(WorkPreset.Preset)(preset)
      expect(decoded.id).toBe(preset.id)
    }
  })

  test("preset ids are unique", () => {
    const ids = WorkPresetRegistry.list().map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("covers all 4 categories", () => {
    const cats = new Set(WorkPresetRegistry.list().map((p) => p.category))
    for (const c of CATEGORIES) expect(cats.has(c)).toBe(true)
  })

  test("each preset asks at most 5 questions", () => {
    for (const preset of WorkPresetRegistry.list()) {
      expect(preset.questions.length).toBeLessThanOrEqual(5)
    }
  })

  test("every question has a key, prompt, and required flag", () => {
    for (const preset of WorkPresetRegistry.list()) {
      for (const q of preset.questions) {
        expect(q.key.length).toBeGreaterThan(0)
        expect(q.prompt.length).toBeGreaterThan(0)
        expect(typeof q.required).toBe("boolean")
      }
    }
  })

  test("artifact spec has a filename for every preset", () => {
    for (const preset of WorkPresetRegistry.list()) {
      expect(preset.artifact.filename.length).toBeGreaterThan(0)
    }
  })

  test("byId finds a preset by id and returns undefined otherwise", () => {
    const first = WorkPresetRegistry.list()[0]
    expect(WorkPresetRegistry.byId(first.id)?.id).toBe(first.id)
    expect(WorkPresetRegistry.byId("nope")).toBeUndefined()
  })

  test("M1 plan §3.1 lists storyboard-video as a video-creation preset", () => {
    const storyboard = WorkPresetRegistry.byId("storyboard-video")
    expect(storyboard?.category).toBe("video-creation")
    expect(storyboard?.questions.length).toBeLessThanOrEqual(5)
  })
})
