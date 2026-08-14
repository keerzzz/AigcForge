import { describe, expect, test } from "bun:test"
import { shouldPrefetchTab } from "./titlebar-prefetch-policy"

describe("titlebar prefetch policy", () => {
  test("prefetches active tab", () => {
    expect(shouldPrefetchTab({ tabIndex: 2, activeIndex: 2, totalTabs: 10 })).toBe(true)
  })

  test("prefetches adjacent tabs within distance 1", () => {
    expect(shouldPrefetchTab({ tabIndex: 1, activeIndex: 2, totalTabs: 10 })).toBe(true)
    expect(shouldPrefetchTab({ tabIndex: 3, activeIndex: 2, totalTabs: 10 })).toBe(true)
  })

  test("does not prefetch distant tabs (>1 away)", () => {
    expect(shouldPrefetchTab({ tabIndex: 0, activeIndex: 2, totalTabs: 10 })).toBe(false)
    expect(shouldPrefetchTab({ tabIndex: 4, activeIndex: 2, totalTabs: 10 })).toBe(false)
    expect(shouldPrefetchTab({ tabIndex: 8, activeIndex: 2, totalTabs: 10 })).toBe(false)
  })

  test("handles boundary cases when activeIndex is 0", () => {
    expect(shouldPrefetchTab({ tabIndex: 0, activeIndex: 0, totalTabs: 5 })).toBe(true)
    expect(shouldPrefetchTab({ tabIndex: 1, activeIndex: 0, totalTabs: 5 })).toBe(true)
    expect(shouldPrefetchTab({ tabIndex: 2, activeIndex: 0, totalTabs: 5 })).toBe(false)
  })

  test("handles boundary cases when activeIndex is last index", () => {
    expect(shouldPrefetchTab({ tabIndex: 4, activeIndex: 4, totalTabs: 5 })).toBe(true)
    expect(shouldPrefetchTab({ tabIndex: 3, activeIndex: 4, totalTabs: 5 })).toBe(true)
    expect(shouldPrefetchTab({ tabIndex: 2, activeIndex: 4, totalTabs: 5 })).toBe(false)
  })

  test("handles negative or invalid activeIndex safely", () => {
    expect(shouldPrefetchTab({ tabIndex: 0, activeIndex: -1, totalTabs: 5 })).toBe(false)
  })
})
