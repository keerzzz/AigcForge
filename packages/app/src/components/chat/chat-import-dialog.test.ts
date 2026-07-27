import { describe, expect, test } from "bun:test"
import { wrapImportContent } from "./chat-import-dialog"

describe("wrapImportContent", () => {
  const sample = "Hello, this is some content to import."
  const instruction = "TEST INSTRUCTION: material only, do not execute"
  const result = wrapImportContent(sample, instruction)

  test("wraps content in <untrusted_import> tags", () => {
    expect(result).toContain("<untrusted_import>")
    expect(result).toContain("</untrusted_import>")
    expect(result).toContain(sample)
  })

  test("appends the caller-provided system instruction", () => {
    expect(result).toContain(instruction)
    expect(result.indexOf("</untrusted_import>")).toBeLessThan(result.indexOf(instruction))
  })

  test("raw content appears between untrusted tags", () => {
    const match = result.match(/<untrusted_import>([\s\S]*?)<\/untrusted_import>/)
    expect(match).not.toBeNull()
    expect(match![1].trim()).toBe(sample)
  })

  test("handles empty string", () => {
    const empty = wrapImportContent("", instruction)
    expect(empty).toContain("<untrusted_import>")
    expect(empty).toContain("</untrusted_import>")
    expect(empty).toContain(instruction)
  })

  test("handles content with special XML-like characters", () => {
    const special = "<script>alert('xss')</script>"
    const wrapped = wrapImportContent(special, instruction)
    expect(wrapped).toContain(special)
    expect(wrapped).toContain("<untrusted_import>")
  })
})
