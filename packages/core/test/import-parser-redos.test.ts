import { describe, expect, it } from "bun:test"
import { ImportParser } from "../src/import-parser"
import { Effect, Exit } from "effect"

const parse = (input: string) =>
  Effect.runSyncExit(
    Effect.gen(function* () {
      const svc = yield* ImportParser.Service
      return yield* svc.parse(input)
    }).pipe(Effect.provide(ImportParser.ImportParserLive)),
  )

describe("P1-8 regression: unclosed thinking tags must stay linear", () => {
  for (const n of [5000, 10000, 20000]) {
    it(`${n} unclosed <thinking>`, () => {
      const t0 = performance.now()
      parse("<thinking>".repeat(n))
      const ms = performance.now() - t0
      console.log(`[P1-8] ${n} unclosed <thinking>: ${ms.toFixed(0)} ms`)
      expect(ms).toBeLessThan(500)
    })
  }
  it("10000 unclosed <thought>", () => {
    const t0 = performance.now()
    parse("<thought>".repeat(10000))
    const ms = performance.now() - t0
    console.log(`[P1-8] 10000 unclosed <thought>: ${ms.toFixed(0)} ms`)
    expect(ms).toBeLessThan(500)
  })
})

describe("P1-8 behaviour preservation: closed spans still stripped", () => {
  it("strips a closed thinking span and warns", () => {
    const exit = parse("<thinking>secret reasoning</thinking>\n\nkeep this")
    expect(Exit.isSuccess(exit)).toBe(true)
    if (!Exit.isSuccess(exit)) return
    const t = exit.value.candidates[0]?.template ?? ""
    console.log(`[P1-8] template=${JSON.stringify(t)} warnings=${JSON.stringify(exit.value.warnings)}`)
    expect(t).toBe("keep this")
    expect(exit.value.warnings).toContain("stripped_thinking")
  })
  it("strips multiple spans of both tag names", () => {
    const exit = parse("a<thinking>x</thinking>b<thought>y</thought>c")
    if (!Exit.isSuccess(exit)) throw new Error("died")
    expect(exit.value.candidates[0]?.template).toBe("abc")
  })
  it("leaves an unclosed tag as literal content", () => {
    const exit = parse("before <thinking> after")
    if (!Exit.isSuccess(exit)) throw new Error("died")
    const t = exit.value.candidates[0]?.template ?? ""
    console.log(`[P1-8] unclosed passthrough=${JSON.stringify(t)}`)
    expect(t).toContain("<thinking>")
    expect(exit.value.warnings).not.toContain("stripped_thinking")
  })
  it("unclosed open followed by a later close still strips the span (regex parity)", () => {
    const exit = parse("<thinking>one<thinking>two</thinking>tail")
    if (!Exit.isSuccess(exit)) throw new Error("died")
    expect(exit.value.candidates[0]?.template).toBe("tail")
  })
})

describe("P1-6 must remain fixed", () => {
  it("few-shot turns survive inside a fenced block", () => {
    const exit = parse(["```", "You are a translator.", "User: Hello", "Assistant: 你好", "```"].join("\n"))
    if (!Exit.isSuccess(exit)) throw new Error("died")
    const t = exit.value.candidates[0]?.template ?? ""
    expect(t).toContain("User: Hello")
    expect(t).toContain("Assistant: 你好")
  })
})
