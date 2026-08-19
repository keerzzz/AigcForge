import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ProductMode } from "../src/product-mode"
import { AssetKindId } from "../src/asset"
import { Session } from "../src/session"

describe("ProductMode", () => {
  test("decodes all five product modes", () => {
    const modes = ["chat", "coding", "work", "assistant", "custom"] as const
    for (const mode of modes) {
      expect(Schema.decodeSync(ProductMode.ID)(mode)).toBe(mode)
    }
  })

  test("rejects explicit unknown product mode", () => {
    expect(() => Schema.decodeUnknownSync(ProductMode.ID)("invalid_mode")).toThrow()
    expect(() => Schema.decodeUnknownSync(ProductMode.ID)("")).toThrow()
    expect(() => Schema.decodeUnknownSync(ProductMode.ID)(123)).toThrow()
  })

  test("default product mode remains coding", () => {
    expect(ProductMode.Default).toBe("coding")
  })

  test("Session decoding default preserves missing mode as coding", () => {
    const decoded = Schema.decodeUnknownSync(Session.Info)({
      id: "session_123",
      slug: "test-slug",
      projectID: "proj_123",
      location: { directory: "/test" },
      title: "Test Session",
      version: "1.0",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1000, updated: 1000 },
    })
    expect(decoded.mode).toBe("coding")
  })

  test("Session decoding with custom mode succeeds", () => {
    const decoded = Schema.decodeUnknownSync(Session.Info)({
      id: "session_123",
      slug: "test-slug",
      projectID: "proj_123",
      location: { directory: "/test" },
      title: "Test Session",
      version: "1.0",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1000, updated: 1000 },
      mode: "custom",
    })
    expect(decoded.mode).toBe("custom")
  })
})

describe("AssetKindId", () => {
  test("includes custom-profile as eighth asset kind", () => {
    const kinds = ["prompt", "skill", "mcp", "command", "agent", "workflow", "plugin", "custom-profile"] as const
    for (const kind of kinds) {
      expect(Schema.decodeSync(AssetKindId)(kind)).toBe(kind)
    }
  })
})
