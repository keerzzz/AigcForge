import { describe, expect, test } from "bun:test"
import { CUSTOM_MODE_ICON_POOL, activeRailModeID, customModeHref, nextCycleIcon, resolveRailIcon } from "./mode-rail"

describe("mode-rail helpers", () => {
  test("nextCycleIcon picks unused icons in pool order and wraps cleanly", () => {
    expect(nextCycleIcon([])).toBe(CUSTOM_MODE_ICON_POOL[0])
    expect(nextCycleIcon([CUSTOM_MODE_ICON_POOL[0]])).toBe(CUSTOM_MODE_ICON_POOL[1])
    expect(nextCycleIcon([CUSTOM_MODE_ICON_POOL[1]])).toBe(CUSTOM_MODE_ICON_POOL[0])
    expect(nextCycleIcon([...CUSTOM_MODE_ICON_POOL])).toBe(CUSTOM_MODE_ICON_POOL[0])
    expect(nextCycleIcon([...CUSTOM_MODE_ICON_POOL, CUSTOM_MODE_ICON_POOL[0]])).toBe(CUSTOM_MODE_ICON_POOL[1])
  })

  test("customModeHref and activeRailModeID round-trip rail ids and compose flag", () => {
    const href = customModeHref("mode_1", { compose: true })
    expect(href).toBe("/mode/custom?rail=mode_1&tab=compose")
    expect(activeRailModeID(href.slice(href.indexOf("?")))).toBe("mode_1")
    expect(activeRailModeID("")).toBeUndefined()
  })

  test("resolveRailIcon falls back to the first pool icon for unknown names", () => {
    expect(resolveRailIcon("globe")).toBe("globe")
    expect(resolveRailIcon("nonexistent-icon")).toBe(CUSTOM_MODE_ICON_POOL[0])
  })
})
