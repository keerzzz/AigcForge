import { describe, expect, it } from "bun:test"
import { Schema } from "effect"

const AssetEntry = Schema.Struct({
  kind: Schema.String,
  name: Schema.String,
  relativePath: Schema.String,
})

const Output = Schema.Struct({
  assets: Schema.Array(AssetEntry),
})

describe("ListAssetsTool schema", () => {
  describe("AssetEntry", () => {
    it("decodes a valid entry", () => {
      const entry = { kind: "prompt", name: "code-review", relativePath: ".aigcfroge/prompts/code-review" }
      const decoded = Schema.decodeUnknownSync(AssetEntry)(entry)
      expect(decoded.kind).toBe("prompt")
      expect(decoded.name).toBe("code-review")
      expect(decoded.relativePath).toBe(".aigcfroge/prompts/code-review")
    })

    it("rejects missing required fields", () => {
      expect(() => Schema.decodeUnknownSync(AssetEntry)({ kind: "prompt" })).toThrow()
    })
  })

  describe("Output", () => {
    it("decodes empty list", () => {
      const decoded = Schema.decodeUnknownSync(Output)({ assets: [] })
      expect(decoded.assets).toEqual([])
    })

    it("decodes multiple assets", () => {
      const data = {
        assets: [
          { kind: "prompt", name: "a", relativePath: ".aigcfroge/prompts/a" },
          { kind: "skill", name: "b", relativePath: ".aigcfroge/skills/b" },
        ],
      }
      const decoded = Schema.decodeUnknownSync(Output)(data)
      expect(decoded.assets.length).toBe(2)
    })
  })

  describe("Input (optional kind)", () => {
    it("decodes input without kind", () => {
      const inputSchema = Schema.Struct({ kind: Schema.optional(Schema.String) })
      const decoded = Schema.decodeUnknownSync(inputSchema)({})
      expect(decoded.kind).toBeUndefined()
    })

    it("decodes input with kind", () => {
      const inputSchema = Schema.Struct({ kind: Schema.optional(Schema.String) })
      const decoded = Schema.decodeUnknownSync(inputSchema)({ kind: "prompt" })
      expect(decoded.kind).toBe("prompt")
    })
  })
})
