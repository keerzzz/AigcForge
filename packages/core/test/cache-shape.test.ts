import { describe, expect, test } from "bun:test"
import { CacheShape } from "@aigcfroge/core/cache/cache-shape"

describe("CacheShape.capture", () => {
  test("returns stable hash for identical input", () => {
    const a = CacheShape.capture("system prompt", [], 0)
    const b = CacheShape.capture("system prompt", [], 0)
    expect(a.prefixHash).toBe(b.prefixHash)
    expect(a.systemHash).toBe(b.systemHash)
  })

  test("produces different hash for different system prompts", () => {
    const a = CacheShape.capture("system one", [], 0)
    const b = CacheShape.capture("system two", [], 0)
    expect(a.prefixHash).not.toBe(b.prefixHash)
    expect(a.systemHash).not.toBe(b.systemHash)
  })

  test("produces different hash for different tool schemas", () => {
    const tools = [{ name: "read_file", description: "read" }]
    const a = CacheShape.capture("system", [], 0)
    const b = CacheShape.capture("system", tools, 0)
    expect(a.prefixHash).not.toBe(b.prefixHash)
    expect(a.toolsHash).not.toBe(b.toolsHash)
  })

  test("normalizes tool schema order", () => {
    const schemasA = [
      { name: "write_file", description: "write" },
      { name: "read_file", description: "read" },
    ]
    const schemasB = [
      { name: "read_file", description: "read" },
      { name: "write_file", description: "write" },
    ]
    const a = CacheShape.capture("system", schemasA, 0)
    const b = CacheShape.capture("system", schemasB, 0)
    expect(a.toolsHash).toBe(b.toolsHash)
    expect(a.prefixHash).toBe(b.prefixHash)
  })

  test("reflects rewriteVersion", () => {
    const a = CacheShape.capture("system", [], 1)
    const b = CacheShape.capture("system", [], 2)
    expect(a.rewriteVersion).toBe(1)
    expect(b.rewriteVersion).toBe(2)
    // prefixHash only covers system+tools; rewriteVersion is a separate field
    expect(a.prefixHash).toBe(b.prefixHash)
  })
})

describe("CacheShape.compare", () => {
  const shape = CacheShape.capture("system", [{ name: "read_file", description: "read" }], 0)

  test("returns no change when prev is undefined (first turn)", () => {
    const diag = CacheShape.compare(undefined, shape, 100, 50)
    expect(diag.prefixChanged).toBe(false)
    expect(diag.prefixChangeReasons).toEqual([])
    expect(diag.cacheReadInputTokens).toBe(100)
    expect(diag.nonCachedInputTokens).toBe(50)
  })

  test("detects system prompt change", () => {
    const prev = CacheShape.capture("old system", [], 0)
    const cur = CacheShape.capture("new system", [], 0)
    const diag = CacheShape.compare(prev, cur, 0, 100)
    expect(diag.prefixChanged).toBe(true)
    expect(diag.prefixChangeReasons).toContain("system")
  })

  test("detects tool schema change", () => {
    const prev = CacheShape.capture("system", [{ name: "read_file", description: "read" }], 0)
    const cur = CacheShape.capture("system", [{ name: "write_file", description: "write" }], 0)
    const diag = CacheShape.compare(prev, cur, 0, 100)
    expect(diag.prefixChanged).toBe(true)
    expect(diag.prefixChangeReasons).toContain("tools")
  })

  test("detects rewriteVersion change (log_rewrite)", () => {
    const prev = CacheShape.capture("system", [], 1)
    const cur = CacheShape.capture("system", [], 2)
    const diag = CacheShape.compare(prev, cur, 0, 100)
    expect(diag.prefixChanged).toBe(true)
    expect(diag.prefixChangeReasons).toContain("log_rewrite")
  })

  test("detects multiple simultaneous changes", () => {
    const prev = CacheShape.capture("old system", [{ name: "read_file", description: "read" }], 1)
    const cur = CacheShape.capture("new system", [{ name: "write_file", description: "write" }], 2)
    const diag = CacheShape.compare(prev, cur, 0, 100)
    expect(diag.prefixChanged).toBe(true)
    expect(diag.prefixChangeReasons).toContain("system")
    expect(diag.prefixChangeReasons).toContain("tools")
    expect(diag.prefixChangeReasons).toContain("log_rewrite")
  })

  test("reports no change for identical shapes with different history version", () => {
    // Same input but both before and after use same version — no change
    const prev = CacheShape.capture("system", [], 0)
    const cur = CacheShape.capture("system", [], 0)
    const diag = CacheShape.compare(prev, cur, 50, 50)
    expect(diag.prefixChanged).toBe(false)
    expect(diag.prefixChangeReasons).toEqual([])
  })

  test("carries through cache token counts", () => {
    const prev = CacheShape.capture("system", [], 0)
    const cur = CacheShape.capture("system", [], 0)
    const diag = CacheShape.compare(prev, cur, 80, 20)
    expect(diag.cacheReadInputTokens).toBe(80)
    expect(diag.nonCachedInputTokens).toBe(20)
  })
})
