import { describe, expect, test } from "bun:test"
import { WorkOrchestratorPrompt } from "../src/agent/prompt/work-orchestrator"

describe("WorkOrchestratorPrompt", () => {
  test("mentions the work-preset tool for loading guidance", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("work-preset")
  })

  test("mentions the question tool for clarifying", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("question")
  })

  test("declares message-body candidate delivery (D1)", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("assistant message body")
  })

  test("explicitly disallows file editing tools", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("not write it to a file")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("edit/write")
  })

  test("explicitly disallows shell and task delegation", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("shell commands")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("task delegation")
  })

  test("covers conflict rename-or-overwrite guidance", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("rename or overwrite")
  })
})
