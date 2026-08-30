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

const ok = (input: string) => {
  const exit = parse(input)
  if (!Exit.isSuccess(exit)) throw new Error(`parse died: ${String(exit.cause).split("\n")[0]}`)
  return exit.value
}

describe("入口尺寸与单块尺寸分离（P1-7 回归）", () => {
  it("150KB 文档 + 多个小块 → 正常解析，不再整体 too_large", () => {
    const filler = "prose line that pads the document out\n".repeat(1900)
    const input = [
      filler,
      "```yaml",
      "kind: workflow",
      "steps: [a]",
      "```",
      filler,
      "```",
      "a prompt body",
      "```",
    ].join("\n")
    const bytes = new TextEncoder().encode(input).length
    const r = ok(input)
    console.log(
      `[SIZE] input=${(bytes / 1024).toFixed(0)}KB candidates=${r.candidates.length} errors=${JSON.stringify(r.errors.map((e) => e.reason))}`,
    )
    expect(bytes).toBeGreaterThan(100_000)
    expect(bytes).toBeLessThan(200 * 1024)
    expect(r.candidates.length).toBe(2)
    expect(r.errors.length).toBe(0)
  })

  it("超过入口上限 (200KB) 仍返回 typed too_large，不是 defect", () => {
    const r = ok("a".repeat(210 * 1024))
    expect(r.errors.map((e) => e.reason)).toEqual(["too_large"])
    expect(r.candidates.length).toBe(0)
  })

  it("单块超过 100,000 字节 → 该块记 too_large 并跳过，其余块保留", () => {
    const big = "x".repeat(100_001)
    const input = ["```", big, "```", "```", "small body", "```"].join("\n")
    const r = ok(input)
    console.log(
      `[SIZE] per-block: candidates=${r.candidates.length} errors=${JSON.stringify(r.errors.map((e) => `${e.section}:${e.reason}`))}`,
    )
    expect(r.candidates.length).toBe(1)
    expect(r.errors.some((e) => e.reason === "too_large")).toBe(true)
  })
})

describe("warning 只在内容真被改动时发出（假阳性回归）", () => {
  it("fenced 块内的 User:/Assistant: 保留，且不报 stripped_conversation", () => {
    const r = ok(["```", "You are a translator.", "User: Hello", "Assistant: 你好", "```"].join("\n"))
    const t = r.candidates[0]?.template ?? ""
    console.log(`[WARN] warnings=${JSON.stringify(r.warnings)}`)
    expect(t).toContain("User: Hello")
    expect(t).toContain("Assistant: 你好")
    expect(r.warnings).not.toContain("stripped_conversation")
  })

  it("纯文本里的 User:/Assistant: 确实被剥离，并报 stripped_conversation", () => {
    const r = ok("User: hi\nsome real content\nAssistant: yo")
    expect(r.warnings).toContain("stripped_conversation")
    expect(r.candidates[0]?.template).not.toContain("User: hi")
  })

  it("纯文本里的注释被剥离时报 stripped_comments（此前完全无提示）", () => {
    const r = ok("<!-- internal note -->\nreal content here")
    console.log(`[WARN] comment warnings=${JSON.stringify(r.warnings)}`)
    expect(r.warnings).toContain("stripped_comments")
  })

  it("代码块内的 /* */ 许可头保留，且不报 stripped_comments", () => {
    const r = ok(["```js", "/* Copyright 2026 ACME */", "export const x = 1", "```"].join("\n"))
    const t = r.candidates[0]?.template ?? ""
    expect(t).toContain("Copyright 2026 ACME")
    expect(r.warnings).not.toContain("stripped_comments")
  })

  it("thinking 未被剥离时不报 stripped_thinking", () => {
    const r = ok("plain content with no tags")
    expect(r.warnings).toEqual([])
  })
})
