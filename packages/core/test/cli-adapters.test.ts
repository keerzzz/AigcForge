/**
 * CLI adapter contract tests — pure-function coverage of the four built-in
 * adapters (claude-code / gemini / codex / opencode): argv construction for
 * fresh vs. resumed sessions, resume_hint parsing, and per-CLI output parsing.
 *
 * No layers required — `parseOutput` is synchronous inside its Effect, so tests
 * run it with `Effect.runSync`.
 *
 * @see packages/core/src/tool/claude-code.ts
 * @see packages/core/src/tool/gemini.ts
 * @see packages/core/src/tool/codex.ts
 * @see packages/core/src/tool/opencode.ts
 */

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { adapter as claudeCode } from "@aigcfroge/core/tool/claude-code"
import { adapter as gemini } from "@aigcfroge/core/tool/gemini"
import { adapter as codex } from "@aigcfroge/core/tool/codex"
import { adapter as opencode } from "@aigcfroge/core/tool/opencode"

describe("CLI adapters — buildArgs", () => {
  const prompt = "do the thing"
  const resumeId = "ses_ext_resume_123"

  test("claude-code fresh session keeps prompt inline", () =>
    expect(Effect.runSync(claudeCode.buildArgs({ prompt, cwd: "/p" }))).toEqual([
      "-p",
      "--no-chrome",
      "--output-format",
      "json",
      prompt,
    ]))

  test("claude-code resumed session passes --resume", () =>
    expect(Effect.runSync(claudeCode.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "-p",
      "--no-chrome",
      "--output-format",
      "json",
      "--resume",
      resumeId,
      prompt,
    ]))

  test("gemini fresh session keeps prompt inline", () =>
    expect(Effect.runSync(gemini.buildArgs({ prompt, cwd: "/p" }))).toEqual(["-p", prompt]))

  test("gemini resumed session passes --resume", () =>
    expect(Effect.runSync(gemini.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "-p",
      prompt,
      "--resume",
      resumeId,
    ]))

  test("codex fresh session keeps prompt inline", () =>
    expect(Effect.runSync(codex.buildArgs({ prompt, cwd: "/p" }))).toEqual(["exec", "--json", prompt]))

  test("codex resumed session passes --resume", () =>
    expect(Effect.runSync(codex.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "exec",
      "resume",
      "--json",
      resumeId,
      prompt,
    ]))

  test("opencode fresh session keeps prompt inline", () =>
    expect(Effect.runSync(opencode.buildArgs({ prompt, cwd: "/p" }))).toEqual(["run", prompt]))

  test("opencode resumed session passes --resume", () =>
    expect(Effect.runSync(opencode.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "run",
      "--session",
      resumeId,
      prompt,
    ]))
})

describe("CLI adapters — parseResumeHint", () => {
  test("extracts sessionID from a valid resume_hint frame", () => {
    const stdout = JSON.stringify({ type: "session.resume_hint", sessionID: "abc123" })
    expect(claudeCode.parseResumeHint?.(stdout)).toBe("abc123")
  })

  test("returns undefined for noise frames", () => {
    const stdout = [
      JSON.stringify({ type: "text", text: "working" }),
      JSON.stringify({ type: "result", content: "done" }),
    ].join("\n")
    expect(claudeCode.parseResumeHint?.(stdout)).toBeUndefined()
  })

  test("returns undefined for malformed JSON", () => {
    expect(claudeCode.parseResumeHint?.("not json at all\n{broken")).toBeUndefined()
  })
})

describe("CLI adapters — parseOutput", () => {
  test("claude type:result frame yields a DelegationResult", () => {
    const stdout = JSON.stringify({
      type: "result",
      content: "<task_result>\nInvestigated the thing.\n</task_result>",
    })
    const result = Effect.runSync(claudeCode.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Investigated the thing")
  })

  test("codex text.delta frame yields a DelegationResult", () => {
    const stdout = JSON.stringify({ type: "text.delta", text: "<task_result>\nDelta result\n</task_result>" })
    const result = Effect.runSync(codex.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Delta result")
  })

  test("codex item.completed frame yields a DelegationResult", () => {
    const stdout = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "<task_result>\nItem result\n</task_result>" },
    })
    const result = Effect.runSync(codex.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Item result")
  })

  test("codex falls back to tagged output parsing", () => {
    const result = Effect.runSync(codex.parseOutput("<task_result>\nFallback result\n</task_result>", ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Fallback result")
  })

  test("codex marks a stderr-only run as failed", () => {
    const result = Effect.runSync(codex.parseOutput("", "command not found"))
    expect(result.status).toBe("failed")
  })
})
