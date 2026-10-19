import { describe, expect } from "bun:test"
import { Duration, Effect, Fiber, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { makeClaudeCodeSdkAdapter, type ClaudeSdk } from "@aigcfroge/core/tool/claude-code-sdk"
import { makeCodexSdkAdapter, type CodexSdk } from "@aigcfroge/core/tool/codex-sdk"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const codexClient: CodexSdk = {
  startThread: () => ({ id: "thread_default", run: async () => ({ finalResponse: "codex done" }) }),
  resumeThread: (id) => ({ id, run: async () => ({ finalResponse: "codex resumed" }) }),
}

const claudeClient: ClaudeSdk = {
  query: () =>
    (async function* () {
      yield { type: "result", result: "claude done", session_id: "session_default" }
    })(),
}

describe("SDK adapter lifecycle", () => {
  it.live("does not construct either SDK during adapter creation or discovery", () =>
    Effect.gen(function* () {
      let codexCalls = 0
      let claudeCalls = 0
      const codex = makeCodexSdkAdapter(async () => {
        codexCalls += 1
        return codexClient
      })
      const claude = makeClaudeCodeSdkAdapter(async () => {
        claudeCalls += 1
        return claudeClient
      })

      expect(codexCalls).toBe(0)
      expect(claudeCalls).toBe(0)

      yield* codex.detect()
      yield* claude.detect()

      expect(codexCalls).toBe(0)
      expect(claudeCalls).toBe(0)
    }),
  )

  it.live("constructs each SDK once per execute invocation", () =>
    Effect.gen(function* () {
      let codexCalls = 0
      let claudeCalls = 0
      const codex = makeCodexSdkAdapter(async () => {
        codexCalls += 1
        return codexClient
      })
      const claude = makeClaudeCodeSdkAdapter(async () => {
        claudeCalls += 1
        return claudeClient
      })

      const firstCodex = yield* codex.execute({ prompt: "first", cwd: "/tmp" })
      expect(codexCalls).toBe(1)
      const secondCodex = yield* codex.execute({ prompt: "second", cwd: "/tmp" })
      expect(codexCalls).toBe(2)

      const firstClaude = yield* claude.execute({ prompt: "first", cwd: "/tmp" })
      expect(claudeCalls).toBe(1)
      const secondClaude = yield* claude.execute({ prompt: "second", cwd: "/tmp" })
      expect(claudeCalls).toBe(2)

      expect([firstCodex.status, secondCodex.status, firstClaude.status, secondClaude.status]).toEqual([
        "success",
        "success",
        "success",
        "success",
      ])
    }),
  )

  it.live("returns initialization failures as recoverable results", () =>
    Effect.gen(function* () {
      let codexCalls = 0
      const codex = makeCodexSdkAdapter(async () => {
        codexCalls += 1
        if (codexCalls === 1) throw new Error("codex CLI unavailable")
        return codexClient
      })
      const codexFailed = yield* codex.execute({ prompt: "first", cwd: "/tmp" })
      expect(codexFailed.status).toBe("failed")
      expect(codexFailed.summary).toContain("codex CLI unavailable")
      const codexRecovered = yield* codex.execute({ prompt: "second", cwd: "/tmp" })
      expect(codexRecovered.status).toBe("success")
      expect(codexCalls).toBe(2)

      let claudeCalls = 0
      const claude = makeClaudeCodeSdkAdapter(async () => {
        claudeCalls += 1
        if (claudeCalls === 1) throw new Error("claude CLI unavailable")
        return claudeClient
      })
      const claudeFailed = yield* claude.execute({ prompt: "first", cwd: "/tmp" })
      expect(claudeFailed.status).toBe("failed")
      expect(claudeFailed.summary).toContain("claude CLI unavailable")
      const claudeRecovered = yield* claude.execute({ prompt: "second", cwd: "/tmp" })
      expect(claudeRecovered.status).toBe("success")
      expect(claudeCalls).toBe(2)
    }),
  )

  it.live("preserves a Codex thread id assigned before a provider failure", () =>
    Effect.gen(function* () {
      const thread = {
        id: undefined as string | undefined,
        run: async () => {
          thread.id = "thread_failed"
          throw new Error("provider disconnected")
        },
      }
      const adapter = makeCodexSdkAdapter({ startThread: () => thread, resumeThread: () => thread })
      const result = yield* adapter.execute({ prompt: "x", cwd: "/tmp" })
      expect(result.errorCode).toBe("provider_error")
      expect(result.recoveryRequired).toBe(true)
      expect(result.sessionId).toBe("thread_failed")
    }),
  )

  it.effect("preserves a Codex thread id on timeout and aborts its execution", () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>()
      const state = { aborted: false }
      const thread = {
        id: undefined as string | undefined,
        run: (_input: string, options?: { signal?: AbortSignal }) =>
          new Promise<{ finalResponse: string }>((_resolve, reject) => {
            thread.id = "thread_timed_out"
            options?.signal?.addEventListener(
              "abort",
              () => {
                state.aborted = true
                reject(new Error("aborted"))
              },
              { once: true },
            )
            started.resolve()
          }),
      }
      const adapter = makeCodexSdkAdapter({ startThread: () => thread, resumeThread: () => thread })
      const fiber = yield* adapter
        .execute({ prompt: "x", cwd: "/tmp", timeoutMs: 1000 })
        .pipe(Effect.forkIn(yield* Effect.scope))
      yield* Effect.promise(() => started.promise)
      yield* TestClock.adjust(Duration.seconds(1))
      const result = yield* Fiber.join(fiber)
      expect(result.errorCode).toBe("timeout")
      expect(result.sessionId).toBe("thread_timed_out")
      expect(state.aborted).toBe(true)
    }),
  )

  it.live("preserves a Claude session id when its result stream fails", () =>
    Effect.gen(function* () {
      const adapter = makeClaudeCodeSdkAdapter({
        query: () =>
          (async function* () {
            yield { type: "system", session_id: "session_failed" }
            throw new Error("stream disconnected")
          })(),
      })
      const result = yield* adapter.execute({ prompt: "x", cwd: "/tmp" })
      expect(result.errorCode).toBe("provider_error")
      expect(result.recoveryRequired).toBe(true)
      expect(result.sessionId).toBe("session_failed")
    }),
  )

  it.live("reads a Codex thread id assigned during run", () =>
    Effect.gen(function* () {
      const thread: {
        id?: string | null
        run: (input: string, options?: { signal?: AbortSignal }) => Promise<{ finalResponse: string }>
      } = {
        run: async () => {
          thread.id = "thread_after_run"
          return { finalResponse: "done" }
        },
      }
      const adapter = makeCodexSdkAdapter({
        startThread: () => thread,
        resumeThread: () => {
          throw new Error("unexpected resume")
        },
      })

      const result = yield* adapter.execute({ prompt: "x", cwd: "/tmp" })
      expect(result.status).toBe("success")
      expect(result.sessionId).toBe("thread_after_run")
    }),
  )
})
