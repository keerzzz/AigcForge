/**
 * SDK-transport adapter contract — M4 Phase A. Mock SDK factories drive the
 * adapters without spawning a CLI or touching the network:
 *
 * - claude: stream → DelegationResult, resumeId → options.resume, canUseTool
 *   bridges allow/deny decisions
 * - codex: run() → finalResponse, resumeId → resumeThread
 *
 * @see packages/core/src/tool/claude-code-sdk.ts
 * @see packages/core/src/tool/codex-sdk.ts
 */

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeClaudeCodeSdkAdapter, type ClaudeSdk } from "../src/tool/claude-code-sdk"
import { makeCodexSdkAdapter, type CodexSdk } from "../src/tool/codex-sdk"

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe("claude-code SDK adapter", () => {
  type SdkMessage = { type: string; result?: string; is_error?: boolean; session_id?: string }
  type QueryInput = {
    prompt: string
    options?: {
      cwd?: string
      resume?: string
      canUseTool?: (
        tool: string,
        input: Record<string, unknown>,
      ) => Promise<{ behavior: "allow" | "deny"; message?: string } | null>
    }
  }
  const streamSdk = (messages: SdkMessage[], onQuery?: (input: QueryInput) => void): ClaudeSdk => ({
    query: (input) => {
      onQuery?.(input)
      return (async function* () {
        for (const message of messages) yield message
      })()
    },
  })

  test("streams to a DelegationResult from the result message", async () => {
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([{ type: "assistant" }, { type: "result", result: "Done the work", is_error: false }]),
    )
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(result.status).toBe("success")
    expect(result.summary).toBe("Done the work")
  })

  test("marks an errored run as failed", async () => {
    const adapter = makeClaudeCodeSdkAdapter(streamSdk([{ type: "result", is_error: true, result: "boom" }]))
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(result.status).toBe("failed")
  })

  test("passes resumeId into the SDK options", async () => {
    let seenResume: string | undefined
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([{ type: "result", is_error: false, result: "ok" }], (input) => {
        seenResume = input.options?.resume
      }),
    )
    await run(adapter.execute!({ prompt: "x", cwd: "/p", resumeId: "ext_1" }))
    expect(seenResume).toBe("ext_1")
  })

  test("bridges canUseTool allow/deny decisions", async () => {
    let sdkCallback: ((
      tool: string,
      input: Record<string, unknown>,
    ) => Promise<{ behavior: "allow" | "deny"; message?: string } | null>) | undefined
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([{ type: "result", is_error: false, result: "ok" }], (input) => {
        sdkCallback = input.options?.canUseTool
      }),
    )
    const decisions: string[] = []
    await run(
      adapter.execute!({
        prompt: "x",
        cwd: "/p",
        canUseTool: async (request) => {
          decisions.push(request.toolName)
          return "deny"
        },
      }),
    )
    // Exercise the bridge callback the SDK would invoke.
    const permission = await sdkCallback?.("Bash", { command: "ls" })
    expect(decisions).toContain("Bash")
    expect(permission?.behavior).toBe("deny")
  })

  test("captures the session id from the init message into sessionId", async () => {
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([
        { type: "system", session_id: "ses_abc" },
        { type: "result", is_error: false, result: "ok", session_id: "ses_abc" },
      ]),
    )
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(result.sessionId).toBe("ses_abc")
  })
})

describe("codex SDK adapter", () => {
  test("runs a turn and returns finalResponse", async () => {
    let seenInput: string | undefined
    const sdk: CodexSdk = {
      startThread: () => ({
        run: async (input) => {
          seenInput = input
          return { finalResponse: "Codex done" }
        },
      }),
      resumeThread: () => ({ run: async () => ({ finalResponse: "resumed" }) }),
    }
    const adapter = makeCodexSdkAdapter(sdk)
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(result.status).toBe("success")
    expect(result.summary).toBe("Codex done")
    // The real SDK's run() takes a string (or UserInput[]) — a bare object is
    // not iterable and would crash normalizeInput at runtime.
    expect(seenInput).toBe("x")
  })

  test("resumes an existing thread by id", async () => {
    let resumed: string | undefined
    const sdk: CodexSdk = {
      startThread: () => ({ run: async () => ({ finalResponse: "new" }) }),
      resumeThread: (id) => {
        resumed = id
        return { run: async () => ({ finalResponse: "resumed" }) }
      },
    }
    const adapter = makeCodexSdkAdapter(sdk)
    await run(adapter.execute!({ prompt: "x", cwd: "/p", resumeId: "thread_1" }))
    expect(resumed).toBe("thread_1")
  })

  test("returns the thread id as sessionId", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({ id: "thread_9", run: async () => ({ finalResponse: "done" }) }),
      resumeThread: (id) => ({ id, run: async () => ({ finalResponse: "resumed" }) }),
    }
    const adapter = makeCodexSdkAdapter(sdk)
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(result.sessionId).toBe("thread_9")
  })
})
