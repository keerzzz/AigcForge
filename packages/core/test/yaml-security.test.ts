import { describe, expect, test } from "bun:test"
import yaml from "js-yaml"

describe("js-yaml security regression", () => {
  test("normal YAML parses", () => {
    const doc = yaml.load("name: test\ndescription: A test plugin\nversion: 1.0.0")
    expect(doc).toBeObject()
    expect((doc as any).name).toBe("test")
  })

  test("anchor + alias resolves", () => {
    const doc = yaml.load("defaults: &def\n  version: 1.0.0\nplugin:\n  <<: *def\n  name: test")
    expect(doc).toBeObject()
    expect((doc as any).plugin.name).toBe("test")
  })

  test("deeply nested YAML is rejected by v4 safe load", () => {
    let deep = "root: leaf\n"
    for (let i = 0; i < 1000; i++) {
      deep = `a:\n${deep.replace(/^/gm, "  ")}`
    }
    // js-yaml v4 has built-in maxDepth: 100 — rejects excessive nesting
    expect(() => yaml.load(deep)).toThrow()
  })

  test("custom tag is rejected in v4 safe load", () => {
    expect(() => yaml.load("value: !custom x")).toThrow()
  })

  test("large input (1MB) does not crash", () => {
    const large = "items:\n" + Array.from({ length: 50000 }, (_, i) => `  - id: ${i}\n    name: item-${i}\n`).join("")
    expect(large.length).toBeGreaterThan(900_000)
    expect(() => yaml.load(large)).not.toThrow()
  })
})
