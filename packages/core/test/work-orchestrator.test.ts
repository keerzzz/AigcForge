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

  test("handles an inline task spec (user workflow) by skipping the work-preset load", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("inline task specification")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("skip the `work-preset` tool")
  })

  test("plans execution steps via task_create before drafting (M1.5)", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("Plan steps")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("task_create")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("in_progress")
  })

  test("writes a one-line outputDigest when a step completes (M1.5)", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("task_update")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("outputDigest")
  })

  test("provides a Resume branch that reads the task list and prior digests (M1.5)", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("Resume")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("outputDigest")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("currentStepIndex")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("without regenerating")
  })

  test("guides Mermaid usage for unclear prose in step 5 (M3)", () => {
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("Mermaid")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("```mermaid")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("when text alone is unclear")
    expect(WorkOrchestratorPrompt.SYSTEM_PROMPT).toContain("do not force diagrams into every document")
  })
})
