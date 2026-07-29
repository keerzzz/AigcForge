import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ImportParser } from "../src/import-parser"

describe("ImportParser.Candidate", () => {
  test("encodes/decodes valid candidate", () => {
    const result = Schema.decodeUnknownSync(ImportParser.Candidate)({
      kind: "prompt",
      name: "test",
      description: "desc",
      template: "body",
    })
    expect(result.kind).toBe("prompt")
    expect(result.name).toBe("test")
    expect(result.description).toBe("desc")
    expect(result.template).toBe("body")
  })

  test("rejects empty name", () => {
    expect(() =>
      Schema.decodeUnknownSync(ImportParser.Candidate)({
        kind: "prompt",
        name: "",
        description: "desc",
        template: "body",
      })
    ).toThrow()
  })

  test("rejects name over 80 code points", () => {
    expect(() =>
      Schema.decodeUnknownSync(ImportParser.Candidate)({
        kind: "prompt",
        name: "x".repeat(81),
        description: "desc",
        template: "body",
      })
    ).toThrow()
  })

  test("rejects description over 300 code points", () => {
    expect(() =>
      Schema.decodeUnknownSync(ImportParser.Candidate)({
        kind: "prompt",
        name: "test",
        description: "x".repeat(301),
        template: "body",
      })
    ).toThrow()
  })

  test("accepts empty description", () => {
    const result = Schema.decodeUnknownSync(ImportParser.Candidate)({
      kind: "prompt",
      name: "test",
      description: "",
      template: "body",
    })
    expect(result.description).toBe("")
  })

  test("rejects empty template", () => {
    expect(() =>
      Schema.decodeUnknownSync(ImportParser.Candidate)({
        kind: "prompt",
        name: "test",
        description: "desc",
        template: "",
      })
    ).toThrow()
  })
})

describe("ImportParser.ParseError", () => {
  test("encodes/decodes parse error", () => {
    const result = Schema.decodeUnknownSync(ImportParser.ParseError)({
      section: "Block #3",
      reason: "unknown_type",
    })
    expect(result.section).toBe("Block #3")
    expect(result.reason).toBe("unknown_type")
  })
})

describe("ImportParser.Result", () => {
  test("encodes with candidates, warnings, and errors", () => {
    const result = Schema.decodeUnknownSync(ImportParser.Result)({
      candidates: [
        { kind: "prompt", name: "test", description: "desc", template: "body" },
      ],
      warnings: ["bad_format"],
      errors: [{ section: "Block #1", reason: "unknown_type" }],
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].name).toBe("test")
    expect(result.warnings).toEqual(["bad_format"])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe("unknown_type")
  })

  test("encodes empty result", () => {
    const result = Schema.decodeUnknownSync(ImportParser.Result)({
      candidates: [],
      warnings: [],
      errors: [],
    })
    expect(result.candidates).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})
