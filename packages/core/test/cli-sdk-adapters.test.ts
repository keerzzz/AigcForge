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
import { Effect, Fiber } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { makeClaudeCodeSdkAdapter, type ClaudeSdk } from "../src/tool/claude-code-sdk"
import { makeCodexSdkAdapter, type CodexSdk } from "../src/tool/codex-sdk"
import { it } from "./lib/effect"

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe("claude-code SDK adapter", () => {
  type SdkMessage = { type: string; result?: string; is_error?: boolean; session_id?: string }
  type QueryInput = Parameters<ClaudeSdk["query"]>[0]
  const streamSdk = (messages: SdkMessage[], onQuery?: (input: QueryInput) => void): ClaudeSdk => ({
    query: (input) => {
      onQuery?.(input)
      return (async function* () {
        for (const message of messages) yield { session_id: "ses_test", ...message }
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
    let sdkCallback: NonNullable<NonNullable<QueryInput["options"]>["canUseTool"]> | undefined
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
    const permission = await sdkCallback?.(
      "Bash",
      { command: "ls" },
      {
        signal: new AbortController().signal,
        toolUseID: "tool_1",
        requestId: "request_1",
      },
    )
    expect(decisions).toContain("Bash")
    expect(permission?.behavior).toBe("deny")
  })

  test("persists sessions explicitly and captures the session id", async () => {
    let persistSession: boolean | undefined
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([{ type: "result", is_error: false, result: "ok", session_id: "ses_abc" }], (input) => {
        persistSession = input.options?.persistSession
      }),
    )
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(persistSession).toBe(true)
    expect(result.sessionId).toBe("ses_abc")
  })

  test("fails a run without a final response", async () => {
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([{ type: "result", is_error: false, result: "", session_id: "ses_empty" }]),
    )
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(result.status).toBe("failed")
    expect(result.summary).toContain("without a final response")
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
  test("constructs an optional SDK only when its execution runs", async () => {
    const constructions: string[] = []
    const starts: unknown[] = []
    const adapter = makeCodexSdkAdapter(async () => {
      constructions.push("constructed")
      return {
        startThread: (options) => {
          starts.push(options)
          return { id: "thread_lazy", run: async () => ({ finalResponse: "lazy result" }) }
        },
        resumeThread: (id) => ({ id, run: async () => ({ finalResponse: "resumed" }) }),
      } satisfies CodexSdk
    })
    await run(adapter.detect())
    expect(constructions).toEqual([])
    if (!adapter.execute) throw new Error("SDK adapter has no execute method")
    const execution = adapter.execute({ prompt: "x", cwd: "/p" })
    expect(constructions).toEqual([])
    expect(await run(execution)).toMatchObject({ status: "success", summary: "lazy result", sessionId: "thread_lazy" })
    expect(constructions).toEqual(["constructed"])
    expect(starts).toEqual([{ workingDirectory: "/p", approvalPolicy: "never" }])
  })

  test.each(["construction", "async construction", "start", "resume", "run"] as const)(
    "returns provider_error without a defect when %s fails",
    async (stage) => {
      const sdk: CodexSdk = {
        startThread: () => {
          if (stage === "start") throw new Error(`${stage} failed`)
          return {
            id: "thread_started",
            run: async () => {
              throw new Error(`${stage} failed`)
            },
          }
        },
        resumeThread: () => {
          throw new Error(`${stage} failed`)
        },
      }
      const adapter = makeCodexSdkAdapter(
        stage === "construction"
          ? () => {
              throw new Error(`${stage} failed`)
            }
          : stage === "async construction"
            ? async () => {
                throw new Error(`${stage} failed`)
              }
            : sdk,
      )
      if (!adapter.execute) throw new Error("SDK adapter has no execute method")
      const result = await run(
        adapter.execute({ prompt: "x", cwd: "/p", ...(stage === "resume" ? { resumeId: "thread_existing" } : {}) }),
      )
      expect(result).toEqual({
        status: "failed",
        summary: `CLI "codex" SDK execution failed: ${stage} failed`,
        ...(stage === "resume" ? { sessionId: "thread_existing" } : {}),
        ...(stage === "run" ? { sessionId: "thread_started" } : {}),
        errorCode: "provider_error",
        recoveryRequired: true,
        errors: [`${stage} failed`],
      })
    },
  )

  test("runs a turn and returns finalResponse", async () => {
    let seenInput: string | undefined
    const sdk: CodexSdk = {
      startThread: () => ({
        id: "thread_1",
        run: async (input) => {
          seenInput = input
          return { finalResponse: "Codex done" }
        },
      }),
      resumeThread: () => ({ id: "thread_1", run: async () => ({ finalResponse: "resumed" }) }),
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

  test("fails a run without a final response", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({ id: "thread_empty", run: async () => ({ finalResponse: "" }) }),
      resumeThread: (id) => ({ id, run: async () => ({ finalResponse: "" }) }),
    }
    const result = await run(makeCodexSdkAdapter(sdk).execute!({ prompt: "x", cwd: "/p" }))
    expect(result.status).toBe("failed")
    expect(result.summary).toContain("without a final response")
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

  test("reads the persistent thread id assigned during the first run", async () => {
    let id: string | null = null
    const sdk: CodexSdk = {
      startThread: () => ({
        get id() {
          return id
        },
        run: async () => {
          id = "thread_after_run"
          return { finalResponse: "Completed after thread.started" }
        },
      }),
      resumeThread: (threadID) => ({ id: threadID, run: async () => ({ finalResponse: "resumed" }) }),
    }
    const adapter = makeCodexSdkAdapter(sdk)
    if (!adapter.execute) throw new Error("SDK adapter has no execute method")
    expect(await run(adapter.execute({ prompt: "x", cwd: "/p" }))).toMatchObject({
      status: "success",
      summary: "Completed after thread.started",
      sessionId: "thread_after_run",
    })
  })

  it.effect("preserves the persistent thread id when the first run rejects", () =>
    Effect.gen(function* () {
      let id: string | null = null
      const sdk: CodexSdk = {
        startThread: () => ({
          get id() {
            return id
          },
          run: async () => {
            id = "thread_failed_after_start"
            throw new Error("First turn failed after thread.started")
          },
        }),
        resumeThread: (threadID) => ({ id: threadID, run: async () => ({ finalResponse: "resumed" }) }),
      }
      const adapter = makeCodexSdkAdapter(sdk)
      if (!adapter.execute) throw new Error("SDK adapter has no execute method")
      const result = yield* adapter.execute({ prompt: "x", cwd: "/p" })
      expect(result).toMatchObject({
        status: "failed",
        sessionId: "thread_failed_after_start",
        errorCode: "provider_error",
        recoveryRequired: true,
        errors: ["First turn failed after thread.started"],
      })
    }),
  )

  it.effect("preserves the persistent thread id when the first run times out", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      let id: string | null = null
      let aborted = false
      const sdk: CodexSdk = {
        startThread: () => ({
          get id() {
            return id
          },
          run: (_input, options) =>
            new Promise((_resolve, reject) => {
              if (!options?.signal) {
                reject(new Error("SDK run requires the adapter's abort signal"))
                return
              }
              options.signal.addEventListener(
                "abort",
                () => {
                  aborted = true
                  reject(new Error("SDK run aborted"))
                },
                { once: true },
              )
              id = "thread_timed_out_after_start"
              started.resolve()
            }),
        }),
        resumeThread: (threadID) => ({ id: threadID, run: async () => ({ finalResponse: "resumed" }) }),
      }
      const adapter = makeCodexSdkAdapter(sdk)
      if (!adapter.execute) throw new Error("SDK adapter has no execute method")
      const fiber = yield* adapter
        .execute({ prompt: "x", cwd: "/p", timeoutMs: 1_000 })
        .pipe(Effect.forkIn(yield* Effect.scope))
      yield* Effect.promise(() => started.promise)
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(fiber)).toMatchObject({
        status: "failed",
        sessionId: "thread_timed_out_after_start",
        errorCode: "timeout",
        recoveryRequired: true,
      })
      expect(aborted).toBe(true)
    }),
  )
})
