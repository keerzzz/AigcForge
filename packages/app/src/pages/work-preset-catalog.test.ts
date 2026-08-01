import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { buildWorkPresetCatalog, CATEGORIES } from "./work-preset-catalog"

describe("buildWorkPresetCatalog", () => {
  test("covers all 4 preset categories in order", () => {
    const catalog = buildWorkPresetCatalog()
    expect(catalog.categories.map((c) => c.category)).toEqual(Array.from(CATEGORIES))
  })

  test("exposes M1 high-confidence presets under their category", () => {
    const catalog = buildWorkPresetCatalog()
    const video = catalog.categories.find((c) => c.category === "video-creation")
    expect(video?.presets.map((p) => p.id)).toContain("storyboard-video")
  })

  test("every preset decodes against the schema", () => {
    for (const category of buildWorkPresetCatalog().categories) {
      for (const preset of category.presets) {
        expect(() => Schema.decodeUnknownSync(WorkPreset.Preset)(preset)).not.toThrow()
      }
    }
  })

  test("reserved presets have no create entry (empty presets list)", () => {
    const catalog = buildWorkPresetCatalog()
    for (const category of catalog.categories) {
      expect(Array.isArray(category.reserved)).toBe(true)
      expect(category.presets.every((p) => !category.reserved.includes(p.title))).toBe(true)
    }
  })

  test("each category carries a work.* i18n label key", () => {
    for (const category of buildWorkPresetCatalog().categories) {
      expect(category.labelKey).toMatch(/^work\.preset\./)
    }
  })
})
