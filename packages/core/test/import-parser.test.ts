import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ImportParser } from "../src/import-parser"
import type { ImportParser as SchemaImportParser } from "@aigcfroge/schema/import-parser"

function runNow<A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return (Effect as unknown as { runPromise: (e: Effect.Effect<A, unknown>) => Promise<A> }).runPromise(
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    effect as unknown as Effect.Effect<A, unknown>,
  )
}

function parse(input: string, maxBytes?: number) {
  return runNow<SchemaImportParser.Result>(
    Effect.gen(function* () {
      const svc = yield* ImportParser.Service
      return yield* svc.parse(input, { maxBytes })
    }).pipe(Effect.provide(ImportParser.ImportParserLive)),
  )
}

describe("ImportParser", () => {
  test("extracts single Markdown code block as prompt candidate", async () => {
    const result = await parse("```\nYou are a helpful assistant\n```")
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe("prompt")
    expect(result.candidates[0].template).toBe("You are a helpful assistant")
  })

  test("extracts YAML code block as workflow kind", async () => {
    const input = "```yaml\nkind: workflow\nsteps:\n  - id: step1\n```"
    const result = await parse(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe("workflow")
  })

  test("strips thinking/analysis noise blocks", async () => {
    const input = "Let me think...\n<thinking>irrelevant reasoning</thinking>\n\nHere:\n```\nprompt text\n```"
    const result = await parse(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe("prompt")
    expect(result.warnings).toContain("stripped_thinking")
  })

  test("strips chat conversation noise", async () => {
    const input =
      "User: can you help me?\nAssistant: sure\n\nHere is the template:\n```\nYou are a code reviewer\n```"
    const result = await parse(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.warnings).toContain("stripped_conversation")
  })

  test("handles plain text as single prompt candidate", async () => {
    const result = await parse("You are a code reviewer. Check for bugs.")
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe("prompt")
    expect(result.candidates[0].template).toBe("You are a code reviewer. Check for bugs.")
  })

  test("injects name from first heading", async () => {
    const result = await parse("# Code Review Prompt\n\nCheck for these bugs:")
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].name).toBe("Code Review Prompt")
  })

  test("handles empty input", async () => {
    const result = await parse("")
    expect(result.candidates).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors[0].reason).toBe("empty")
  })

  test("handles oversized input above limit", async () => {
    const large = "x".repeat(200 * 1024 + 1)
    const result = await parse(large)
    expect(result.candidates).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors[0].reason).toBe("too_large")
  })

  test("handles multiple candidates from multi-block input", async () => {
    const input = "```\nprompt1\n```\n\n```\nprompt2\n```"
    const result = await parse(input)
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0].template).toBe("prompt1")
    expect(result.candidates[1].template).toBe("prompt2")
  })

  test("detects YAML as plugin kind with tools and hooks", async () => {
    const input = "```yaml\nname: my-plugin\ntools:\n  - name: tool1\nhooks:\n  - onStart\n```"
    const result = await parse(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe("plugin")
  })

  test("detects JSON config as mcp kind", async () => {
    const input = '```json\n{"mcpServers": {"server1": {"url": "http://localhost"}}}\n```'
    const result = await parse(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe("mcp")
  })

  test("fails JSON parse gracefully falls back to plain text", async () => {
    const input = "```json\n{invalid json}\n```"
    const result = await parse(input)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].kind).toBe("prompt")
  })
})
