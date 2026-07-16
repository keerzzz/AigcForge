import { describe, it, expect } from "bun:test"
import { DelegationParser } from "../../../../src/agent/meta/adapters/delegation-parser"

describe("delegation parser", () => {
  it("parses <summary> tag", () => {
    const result = DelegationParser.parseDelegationResult("<summary>Task completed</summary>")
    expect(result).toBeDefined()
    expect(result!.summary).toBe("Task completed")
    expect(result!.status).toBe("success")
  })

  it("parses <task_error> tag", () => {
    const result = DelegationParser.parseDelegationResult('<task id="1" state="error"><task_error>Something broke</task_error></task>')
    expect(result).toBeDefined()
    expect(result!.summary).toContain("Something broke")
  })

  it("parses status from attribute", () => {
    const result = DelegationParser.parseDelegationResult('status = "partial"')
    expect(result).toBeDefined()
    expect(result!.status).toBe("partial")
  })

  it("returns undefined for empty input", () => {
    const result = DelegationParser.parseDelegationResult("")
    expect(result).toBeUndefined()
  })

  it("falls back to first 200 chars", () => {
    const long = "x".repeat(300)
    const result = DelegationParser.parseDelegationResult(long)
    expect(result).toBeDefined()
    expect(result!.summary.length).toBe(200)
  })
})
