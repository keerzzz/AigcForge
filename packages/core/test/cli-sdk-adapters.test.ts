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
import { Deferred, Effect, Fiber } from "effect"
import { randomUUID } from "node:crypto"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { DelegationReceipt } from "../src/delegation/receipt"
import { makeClaudeCodeSdkAdapter, type ClaudeSdk } from "../src/tool/claude-code-sdk"
import { makeCodexSdkAdapter, type CodexSdk } from "../src/tool/codex-sdk"
import type { SdkPermissionRequest } from "../src/tool/cli-adapter"
import { awaitWithTimeout } from "./lib/effect"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("claude-code SDK adapter", () => {
  type SdkMessage = {
    type: string
    subtype?: string
    result?: string
    errors?: string[]
    is_error?: boolean
    session_id?: string
    uuid?: string
  }
  type QueryInput = Parameters<ClaudeSdk["query"]>[0]
  const streamSdk = (messages: SdkMessage[], onQuery?: (input: QueryInput) => void): ClaudeSdk => ({
    query: (input) => {
      onQuery?.(input)
      return (async function* () {
        for (const message of messages) yield { session_id: "ses_test", uuid: "msg_result", ...message }
      })()
    },
  })

  test("activity input preserves each actual SDK observation and one original query", async () => {
    const a = randomUUID()
    const b = randomUUID()
    const resultUUID = randomUUID()
    const lifecycleUUID = randomUUID()
    const body = " \nSDK_B_" + "完整🙂".repeat(2048) + "\n "
    const users: SDKUserMessage[] = []
    const observations: DelegationReceipt.SdkObservation[] = []
    const state = { queried: 0, closed: 0, returned: 0 }
    const sdk: ClaudeSdk = {
      query: (input) => {
        state.queried += 1
        const iterator = (async function* () {
          if (typeof input.prompt === "string") throw new Error("The activity input lost its original iterable")
          for await (const user of input.prompt) users.push(user)
          yield { type: "system", subtype: "init", session_id: "sdk-original", uuid: randomUUID() }
          yield {
            type: "command_lifecycle",
            command_uuid: a,
            state: "started",
            session_id: "sdk-original",
            uuid: lifecycleUUID,
          }
          yield {
            type: "result",
            subtype: "success",
            is_error: false,
            session_id: "sdk-original",
            uuid: resultUUID,
            user_message_uuid: b,
            terminal_reason: "completed",
            result: body,
          }
          yield {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            session_id: "sdk-original",
            uuid: randomUUID(),
            errors: ["Unassigned physical Query error"],
          }
        })()
        const returned = iterator.return.bind(iterator)
        iterator.return = async (...args: Parameters<typeof iterator.return>) => {
          const done = await returned(...args)
          state.returned += 1
          return done
        }
        return {
          [Symbol.asyncIterator]: () => iterator,
          close: () => {
            state.closed += 1
          },
        }
      },
    }
    const feed = (async function* (): AsyncGenerator<SDKUserMessage> {
      yield { type: "user", uuid: a, parent_tool_use_id: null, message: { role: "user", content: "Original A" } }
      yield {
        type: "user",
        uuid: b,
        session_id: "sdk-original",
        priority: "now",
        parent_tool_use_id: null,
        message: { role: "user", content: "Independent B" },
      }
    })()
    const physical = await run(
      makeClaudeCodeSdkAdapter(sdk).execute({
        prompt: "Original A",
        cwd: "/p",
        sdkInput: feed,
        onSdkObservation: (observation) =>
          Effect.sync(() => {
            observations.push(observation)
          }),
      }),
    )
    expect(users.map((user) => user.uuid)).toEqual([a, b])
    expect(users[1]?.priority).toBe("now")
    expect(observations).toHaveLength(4)
    expect(observations[1]).toEqual(
      new DelegationReceipt.SdkLifecycle({
        type: "command_lifecycle",
        command_uuid: a,
        state: "started",
        session_id: "sdk-original",
        uuid: lifecycleUUID,
      }),
    )
    expect(observations[2]).toEqual(
      new DelegationReceipt.SdkResultObservation({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "sdk-original",
        uuid: resultUUID,
        user_message_uuid: b,
        terminal_reason: "completed",
        result: body,
      }),
    )
    expect(observations[3]).toMatchObject({
      type: "result",
      is_error: true,
      errors: ["Unassigned physical Query error"],
    })
    expect(physical.status).toBe("failed")
    expect(state).toEqual({ queried: 1, closed: 1, returned: 1 })
  })

  test("activity cleanup awaits the original iterator return after output EOF", async () => {
    const state = { closed: 0, returned: 0 }
    await run(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const completed = yield* Deferred.make<void>()
          const observe = Effect.runPromiseWith(yield* Effect.context())
          const frames: SdkMessage[] = [
            { type: "result", result: "complete", session_id: "sdk-original", uuid: "sdk-result" },
          ]
          const sdk: ClaudeSdk = {
            query: () => ({
              close: () => {
                state.closed += 1
              },
              [Symbol.asyncIterator]: () => ({
                next: async () => {
                  const frame = frames.shift()
                  return frame ? { done: false as const, value: frame } : { done: true as const, value: undefined }
                },
                return: async () => {
                  await observe(Deferred.succeed(entered, undefined))
                  await observe(Deferred.await(release))
                  state.returned += 1
                  return { done: true as const, value: undefined }
                },
              }),
            }),
          }
          const feed = (async function* (): AsyncGenerator<SDKUserMessage> {
            yield {
              type: "user",
              uuid: randomUUID(),
              message: { role: "user", content: "A" },
              parent_tool_use_id: null,
            }
          })()
          const scope = yield* Effect.scope
          const pending = yield* makeClaudeCodeSdkAdapter(sdk)
            .execute({ prompt: "A", cwd: "/p", sdkInput: feed })
            .pipe(
              Effect.tap(() => Deferred.succeed(completed, undefined)),
              Effect.forkIn(scope, { startImmediately: true }),
            )
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
          yield* awaitWithTimeout(Deferred.await(entered), "The adapter did not enter its original iterator return")
          expect(yield* Deferred.isDone(completed)).toBe(false)
          expect(state).toEqual({ closed: 1, returned: 0 })
          yield* Deferred.succeed(release, undefined)
          expect((yield* Fiber.join(pending)).status).toBe("success")
          expect(state).toEqual({ closed: 1, returned: 1 })
        }),
      ),
    )
  })

  test("legacy single-input query retains its original close-only fake contract", async () => {
    const state = { closed: 0, returned: 0 }
    const frames: SdkMessage[] = [{ type: "result", result: "legacy", session_id: "sdk-legacy", uuid: "sdk-result" }]
    const sdk: ClaudeSdk = {
      query: () => ({
        close: () => {
          state.closed += 1
        },
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            const frame = frames.shift()
            return frame ? { done: false as const, value: frame } : { done: true as const, value: undefined }
          },
          return: async () => {
            state.returned += 1
            return { done: true as const, value: undefined }
          },
        }),
      }),
    }
    expect((await run(makeClaudeCodeSdkAdapter(sdk).execute({ prompt: "legacy", cwd: "/p" }))).summary).toBe("legacy")
    expect(state).toEqual({ closed: 1, returned: 0 })
  })

  test("preserves the full result and its native SDK message identity", async () => {
    const text = " \n" + "结果🙂".repeat(2048) + "\n "
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([{ type: "assistant" }, { type: "result", result: text, is_error: false }]),
    )
    const result = await run(adapter.execute({ prompt: "x", cwd: "/p" }))
    expect(result.status).toBe("success")
    expect(result.summary).toBe(text)
    expect(result.sdkMessage).toEqual({ sessionID: "ses_test", messageID: "msg_result" })
    expect(result.turnId).toBeUndefined()
  })

  test("marks an errored run as failed", async () => {
    const adapter = makeClaudeCodeSdkAdapter(streamSdk([{ type: "result", is_error: true, result: "boom" }]))
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/p" }))
    expect(result.status).toBe("failed")
    expect(result.sdkMessage).toEqual({ sessionID: "ses_test", messageID: "msg_result" })
  })

  test("preserves the native SDK error array as complete Unicode text and actual result identity", async () => {
    const errors = [
      " \nSDK_NATIVE_ERROR_" + "原生错误🙂\n".repeat(15_000) + "_FIRST_TAIL\n ",
      "\nSECOND_NATIVE_ERROR\n  ",
    ]
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors,
          session_id: "sdk-native-errors",
          uuid: "sdk-native-error-result",
        },
      ]),
    )
    const result = await run(adapter.execute({ prompt: "Read the original errors", cwd: "/p" }))
    expect(result.status).toBe("failed")
    expect(result.errorCode).toBe("provider_error")
    expect(result.recoveryRequired).toBe(true)
    expect(result.summary).toBe(errors.join("\n"))
    expect(result.summary.length).toBeGreaterThan(50 * 1024)
    expect(result.errors?.join("\n")).toBe(errors.join("\n"))
    expect(result.sdkMessage).toEqual({ sessionID: "sdk-native-errors", messageID: "sdk-native-error-result" })
    expect(result.turnId).toBeUndefined()
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
        expect(input.options?.hooks).toBeUndefined()
        expect(input.options?.tools).toBeUndefined()
      }),
    )
    const requests: SdkPermissionRequest[] = []
    await run(
      adapter.execute!({
        prompt: "x",
        cwd: "/p",
        canUseTool: async (request) => {
          requests.push(request)
          return request.toolName === "Read" ? "allow" : "deny"
        },
      }),
    )
    // Exercise the bridge callback the SDK would invoke.
    const signal = new AbortController().signal
    const allowed = await sdkCallback?.(
      "Read",
      { file_path: "/p/a.ts" },
      { signal, toolUseID: "tool_read", requestId: "request_read" },
    )
    const denied = await sdkCallback?.(
      "Bash",
      { command: "ls" },
      {
        signal,
        toolUseID: "tool_1",
        requestId: "request_1",
      },
    )
    expect(allowed?.behavior).toBe("allow")
    expect(denied?.behavior).toBe("deny")
    expect(requests).toEqual([
      {
        toolName: "Read",
        input: { file_path: "/p/a.ts" },
        externalSessionID: "ses_test",
        toolUseID: "tool_read",
        requestId: "request_read",
        signal,
      },
      {
        toolName: "Bash",
        input: { command: "ls" },
        externalSessionID: "ses_test",
        toolUseID: "tool_1",
        requestId: "request_1",
        signal,
      },
    ])
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

  test("uses only the result frame for SDK identity", async () => {
    const adapter = makeClaudeCodeSdkAdapter(
      streamSdk([
        { type: "system", session_id: "ses_init", uuid: "msg_init" },
        { type: "result", is_error: false, result: "ok", session_id: "ses_result", uuid: "msg_completed" },
        { type: "assistant", session_id: "ses_later", uuid: "msg_later" },
      ]),
    )
    const result = await run(adapter.execute({ prompt: "x", cwd: "/p", resumeId: "ses_resume" }))
    expect(result.sessionId).toBe("ses_result")
    expect(result.sdkMessage).toEqual({ sessionID: "ses_result", messageID: "msg_completed" })
    expect(result.turnId).toBeUndefined()
  })
  ;[
    { field: "session_id", result: { type: "result", result: "ok", session_id: undefined, uuid: "msg_completed" } },
    { field: "uuid", result: { type: "result", result: "ok", session_id: "ses_result", uuid: undefined } },
  ].forEach((missing) =>
    test(`fails a result missing ${missing.field} without borrowing init or resume identity`, async () => {
      const adapter = makeClaudeCodeSdkAdapter(
        streamSdk([{ type: "system", session_id: "ses_init", uuid: "msg_init" }, missing.result]),
      )
      const result = await run(adapter.execute({ prompt: "x", cwd: "/p", resumeId: "ses_resume" }))
      expect(result.status).toBe("failed")
      expect(result.sdkMessage).toBeUndefined()
      expect(result.turnId).toBeUndefined()
    }),
  )
  ;(["allow", "deny"] as const).forEach((decision) =>
    test(`read-only SDK ${decision} passes through one PreToolUse approval`, async () => {
      const requests: SdkPermissionRequest[] = []
      let options: QueryInput["options"]
      let hookResult: unknown
      let closed = 0
      const sdk: ClaudeSdk = {
        query: (input) => {
          options = input.options
          return Object.assign(
            (async function* () {
              const hook = input.options?.hooks?.PreToolUse?.[0]?.hooks[0]
              const signal = input.options?.abortController?.signal
              if (!hook || !signal) throw new Error("SDK readonly hook is missing")
              yield { type: "system", session_id: "ses_readonly", uuid: "msg_init" }
              hookResult = await hook(
                {
                  hook_event_name: "PreToolUse",
                  session_id: "ses_readonly",
                  transcript_path: "/p/session.jsonl",
                  cwd: "/p",
                  tool_name: "Read",
                  tool_input: { file_path: "/p/a.ts" },
                  tool_use_id: "tool_read",
                },
                "tool_read",
                { signal },
              )
              yield { type: "result", result: "analysis", session_id: "ses_readonly", uuid: "msg_readonly_result" }
            })(),
            { close: () => closed++ },
          )
        },
      }
      const result = await run(
        makeClaudeCodeSdkAdapter(sdk).execute({
          prompt: "analyze",
          cwd: "/p",
          readOnly: true,
          canUseTool: async (request) => {
            requests.push(request)
            return decision
          },
        }),
      )
      expect(options?.tools).toEqual(["Read", "Grep", "Glob"])
      expect(options?.settingSources).toEqual([])
      expect(options?.strictMcpConfig).toBe(true)
      expect(options?.mcpServers).toEqual({})
      expect(options?.canUseTool).toBeUndefined()
      expect(requests).toEqual([
        {
          toolName: "Read",
          input: { file_path: "/p/a.ts" },
          externalSessionID: "ses_readonly",
          toolUseID: "tool_read",
          signal: options?.abortController?.signal,
        },
      ])
      expect(hookResult).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision } })
      expect(result.sdkMessage).toEqual({ sessionID: "ses_readonly", messageID: "msg_readonly_result" })
      expect(closed).toBe(1)
      expect(options?.abortController?.signal.aborted).toBe(true)
    }),
  )
  ;[
    { name: "Write", input: { file_path: "/p/a.ts", content: "changed" } },
    { name: "mcp__fixture__mutate", input: { value: "changed" } },
    { name: "Read", input: null },
  ].forEach((invalid) =>
    test(`read-only SDK denies invalid ${invalid.name} before the parent callback`, async () => {
      let parentCalls = 0
      let hookResult: unknown
      const sdk: ClaudeSdk = {
        query: (input) =>
          (async function* () {
            const hook = input.options?.hooks?.PreToolUse?.[0]?.hooks[0]
            const signal = input.options?.abortController?.signal
            if (!hook || !signal) throw new Error("SDK readonly hook is missing")
            hookResult = await hook(
              {
                hook_event_name: "PreToolUse",
                session_id: "ses_readonly",
                transcript_path: "/p/session.jsonl",
                cwd: "/p",
                tool_name: invalid.name,
                tool_input: invalid.input,
                tool_use_id: "tool_invalid",
              },
              "tool_invalid",
              { signal },
            )
            yield { type: "result", result: "declined", session_id: "ses_readonly", uuid: "msg_declined" }
          })(),
      }
      await run(
        makeClaudeCodeSdkAdapter(sdk).execute({
          prompt: "analyze",
          cwd: "/p",
          readOnly: true,
          canUseTool: async () => {
            parentCalls++
            return "allow"
          },
        }),
      )
      expect(parentCalls).toBe(0)
      expect(hookResult).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } })
    }),
  )

  test("constructs the configured CLI lazily through forCommand", async () => {
    const commands: string[] = []
    const descriptor = makeClaudeCodeSdkAdapter(async (command) => {
      commands.push(command)
      return streamSdk([{ type: "result", result: "configured" }])
    })
    const adapter = descriptor.forCommand?.("/configured/claude")
    if (!adapter?.execute) throw new Error("Configured SDK adapter is missing")
    expect(commands).toEqual([])
    expect(adapter.command).toBe("/configured/claude")
    const result = await run(adapter.execute({ prompt: "x", cwd: "/p", readOnly: true }))
    expect(commands).toEqual(["/configured/claude"])
    expect(result.status).toBe("success")
    expect(result.sdkMessage).toEqual({ sessionID: "ses_test", messageID: "msg_result" })
  })
})

describe("codex SDK adapter", () => {
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
})
