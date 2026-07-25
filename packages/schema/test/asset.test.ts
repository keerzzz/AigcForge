import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { AssetError, AssetKindId, AssetSummary } from "../src/asset"

describe("AssetSummary", () => {
  test("validates minimal summary", () => {
    const s = Schema.decodeUnknownSync(AssetSummary)({
      kind: "prompt",
      name: "test",
      description: "",
      relativePath: "test.md",
      revision: "a".repeat(64),
    })
    expect(s.kind).toBe("prompt")
  })

  test("rejects unknown kind", () => {
    expect(() =>
      Schema.decodeUnknownSync(AssetSummary)({
        kind: "bogus",
        name: "x",
        description: "",
        relativePath: "x.md",
        revision: "a".repeat(64),
      })
    ).toThrow()
  })
})

describe("AssetError", () => {
  test("creates error with tagged reason", () => {
    const err = new AssetError({ kind: "mcp", reason: "unknown_kind", message: "Not registered" })
    expect(err.reason).toBe("unknown_kind")
    expect(err._tag).toBe("AssetError")
  })
})
