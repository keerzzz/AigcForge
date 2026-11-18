/**
 * `transport: "acp"` adapter contract tests (M5 Phase A #2).
 *
 * Injects a mock ACP connection factory so the adapter's orchestration — and
 * its mapping of ACP protocol results onto `DelegationResult` / the permission
 * bridge / live tool-call progress — is exercised without a real bridge process.
 *
 * @see packages/core/src/tool/acp.ts
 * @see packages/core/src/tool/claude-code-acp.ts
 */
import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { AnyMessage, RequestPermissionResponse, Stream } from "@agentclientprotocol/sdk"
import type { AcpClientConnectionValue, PermissionHandler, UpdateHandler } from "../src/acp-client/connection"
import { makeClientConnection } from "../src/acp-client/connection"
import type { ToolCallProgress } from "../src/acp-client/update"
import { makeClaudeCodeAcpAdapter } from "../src/tool/claude-code-acp"
import type { AcpConnectionFactory } from "../src/tool/acp"
import type { AcpReadTextFileHandler, DelegationStatus, SdkPermissionRequest } from "../src/tool/cli-adapter"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

interface MockState {
  factoryInput?: { cwd: string; resumeId?: string; onUpdate: UpdateHandler; requestPermission: PermissionHandler }
  newSessionCalls: string[]
  loadSessionCalls: Array<{ cwd: string; sessionId: string }>
  initializeCalls: number
  closeCalls: number
  permissionResponses: RequestPermissionResponse[]
}

const freshState = (): MockState => ({
  newSessionCalls: [],
  loadSessionCalls: [],
  initializeCalls: 0,
  closeCalls: 0,
  permissionResponses: [],
})

for (const resume of [false, true])
  testEffect(Layer.empty).live(
    `MC06 ACP foundation ${resume ? "same-SID load" : "new session"} keeps the actual wire receipt and full owning agent text`,
    () =>
      Effect.gen(function* () {
        const sid = "ses_wire"
        const text = ` \nACP_${resume ? "RESUME" : "NEW"}_${"汉字🙂\n".repeat(1000)}_TAIL\n  `
        const messageID = "11111111-1111-4111-8111-111111111111"
        const userMessageID = "22222222-2222-4222-8222-222222222222"
        const outgoing: AnyMessage[] = []
        const incoming: AnyMessage[] = []
        const reads: Parameters<AcpReadTextFileHandler>[0][] = []
        const c2a = new TransformStream<AnyMessage, AnyMessage>({
          transform: (message, controller) => {
            outgoing.push(message)
            controller.enqueue(message)
          },
        })
        const a2c = new TransformStream<AnyMessage, AnyMessage>({
          transform: (message, controller) => {
            incoming.push(message)
            controller.enqueue(message)
            const request = outgoing.find((frame) => "method" in frame && frame.method === "session/prompt")
            if (!request || !("id" in request) || "method" in message || message.id !== request.id) return
            const late: AnyMessage[] = [
              {
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: sid,
                  update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "LATE_TEXT" } },
                },
              },
              {
                jsonrpc: "2.0",
                method: "session/update",
                params: {
                  sessionId: sid,
                  update: { sessionUpdate: "tool_call", toolCallId: "late_progress", title: "Late", kind: "read" },
                },
              },
            ]
            late.forEach((frame) => {
              incoming.push(frame)
              controller.enqueue(frame)
            })
          },
        })
        const clientStream: Stream = { writable: c2a.writable, readable: a2c.readable }
        const agentStream: Stream = { writable: a2c.writable, readable: c2a.readable }
        const responses: RequestPermissionResponse[] = []
        const server = new AgentSideConnection((conn) => {
          const history = async () => {
            await conn.sessionUpdate({
              sessionId: sid,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "LOAD_HISTORY" } },
            })
            await conn.sessionUpdate({
              sessionId: sid,
              update: { sessionUpdate: "tool_call", toolCallId: "history_progress", title: "History", kind: "read" },
            })
            responses.push(
              await conn.requestPermission({
                sessionId: sid,
                toolCall: { toolCallId: "history_permission", kind: "read" },
                options: [{ optionId: "history_allow", name: "Allow", kind: "allow_once" }],
              }),
            )
          }
          return {
            initialize: async () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true } }),
            newSession: async () => {
              await history()
              return { sessionId: sid }
            },
            loadSession: async () => {
              await history()
              return {}
            },
            cancel: async () => {},
            authenticate: async () => {},
            prompt: async (params) => {
              expect(
                await conn.readTextFile({
                  sessionId: params.sessionId,
                  path: "/tmp/ws/original.txt",
                  line: 2,
                  limit: 1,
                }),
              ).toEqual({ content: "parent file line" })
              responses.push(
                await conn.requestPermission({
                  sessionId: "ses_foreign",
                  toolCall: { toolCallId: "foreign_permission", kind: "read" },
                  options: [{ optionId: "foreign_allow", name: "Allow", kind: "allow_once" }],
                }),
              )
              responses.push(
                await conn.requestPermission({
                  sessionId: params.sessionId,
                  toolCall: { toolCallId: "active_permission", kind: "read", rawInput: { path: "original.txt" } },
                  options: [
                    { optionId: "always", name: "Always", kind: "allow_always" },
                    { optionId: "once", name: "Once", kind: "allow_once" },
                  ],
                }),
              )
              responses.push(
                await conn.requestPermission({
                  sessionId: params.sessionId,
                  toolCall: { toolCallId: "no_once_permission", kind: "read", rawInput: { path: "second.txt" } },
                  options: [
                    { optionId: "always_only", name: "Always", kind: "allow_always" },
                    { optionId: "reject_once", name: "Reject", kind: "reject_once" },
                  ],
                }),
              )
              await conn.sessionUpdate({
                sessionId: params.sessionId,
                update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "USER_TEXT" } },
              })
              await conn.sessionUpdate({
                sessionId: "ses_foreign",
                update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "FOREIGN_TEXT" } },
              })
              await conn.sessionUpdate({
                sessionId: "ses_foreign",
                update: { sessionUpdate: "tool_call", toolCallId: "foreign_progress", title: "Foreign", kind: "read" },
              })
              for (const chunk of [text.slice(0, 4096), text.slice(4096)])
                await conn.sessionUpdate({
                  sessionId: params.sessionId,
                  update: {
                    sessionUpdate: "agent_message_chunk",
                    content: { type: "text", text: chunk },
                    ...(resume ? {} : { messageId: messageID }),
                  },
                })
              await conn.sessionUpdate({
                sessionId: params.sessionId,
                update: {
                  sessionUpdate: "tool_call",
                  toolCallId: "active_progress",
                  title: "Read original",
                  kind: "read",
                  status: "completed",
                  _meta: { parentToolUseId: "parent_task" },
                },
              })
              return { stopReason: "end_turn", ...(resume ? {} : { userMessageId: userMessageID }) }
            },
          }
        }, agentStream)
        let client: AcpClientConnectionValue | undefined
        const factory: AcpConnectionFactory = (input) =>
          Effect.sync(() => {
            const connection = makeClientConnection(clientStream, input)
            client = connection
            return {
              ...connection,
              prompt: async (sessionID, prompt) => {
                const result = await connection.prompt(sessionID, prompt)
                // Read a real post-response peer request before the adapter can return.
                responses.push(
                  await server.requestPermission({
                    sessionId: sessionID,
                    toolCall: { toolCallId: "after_terminal", kind: "read" },
                    options: [{ optionId: "late_allow", name: "Allow", kind: "allow_once" }],
                  }),
                )
                return result
              },
            }
          })
        yield* Effect.addFinalizer(() => Effect.promise(() => client?.close() ?? Promise.resolve()))
        const adapter = makeClaudeCodeAcpAdapter(factory)
        const execute = adapter.execute
        if (!execute) return yield* Effect.die(new Error("The ACP adapter has no execution method"))
        const permissions: SdkPermissionRequest[] = []
        const progress: ToolCallProgress[] = []
        const result = yield* execute({
          prompt: "Original wire prompt",
          cwd: "/tmp/ws",
          ...(resume ? { resumeId: sid } : {}),
          canUseTool: async (request) => {
            permissions.push(request)
            return "allow"
          },
          readTextFile: async (request) => {
            reads.push(request)
            return { content: "parent file line" }
          },
          onProgress: (entry) => progress.push(entry),
        })
        expect(result.status).toBe("success")
        expect(result.summary).toBe(text)
        expect(result.sessionId).toBe(sid)
        const request = outgoing.find((frame) => "method" in frame && frame.method === "session/prompt")
        if (
          !request ||
          !("method" in request) ||
          !("id" in request) ||
          (typeof request.id !== "number" && typeof request.id !== "string")
        )
          return yield* Effect.die(new Error("The actual SDK prompt wire request is missing"))
        expect(request.params).toMatchObject({
          sessionId: sid,
          prompt: [{ type: "text", text: "Original wire prompt" }],
        })
        expect(incoming.some((frame) => !("method" in frame) && frame.id === request.id)).toBe(true)
        expect(
          incoming.some(
            (frame) =>
              "method" in frame &&
              frame.method === "session/request_permission" &&
              "id" in frame &&
              frame.id === request.id,
          ),
        ).toBe(true)
        expect(result.acpPrompt).toEqual({
          sessionID: sid,
          requestID: request.id,
          ...(resume ? {} : { userMessageID, agentMessageIDs: [messageID] }),
        })
        expect(result.turnId).toBeUndefined()
        expect(result.sdkMessage).toBeUndefined()
        expect(reads).toEqual([
          { sessionId: sid, path: "/tmp/ws/original.txt", line: 2, limit: 1, signal: expect.any(AbortSignal) },
        ])
        expect(reads[0]?.signal.aborted).toBe(true)
        expect(permissions).toEqual([
          {
            toolName: "read",
            input: { path: "original.txt" },
            externalSessionID: sid,
            toolUseID: "active_permission",
            signal: expect.any(AbortSignal),
          },
          {
            toolName: "read",
            input: { path: "second.txt" },
            externalSessionID: sid,
            toolUseID: "no_once_permission",
            signal: expect.any(AbortSignal),
          },
        ])
        expect(responses).toEqual([
          { outcome: { outcome: "cancelled" } },
          { outcome: { outcome: "cancelled" } },
          { outcome: { outcome: "selected", optionId: "once" } },
          { outcome: { outcome: "selected", optionId: "reject_once" } },
          { outcome: { outcome: "cancelled" } },
        ])
        expect(progress.map((entry) => entry.toolCallId)).toEqual(["active_progress"])
        expect(progress[0]?.parentToolUseId).toBe("parent_task")
        yield* awaitWithTimeout(
          Effect.promise(() => server.closed),
          "The actual ACP peer did not finish close",
        )
        expect(clientStream.readable.locked).toBe(false)
        expect(clientStream.writable.locked).toBe(false)
      }),
  )

testEffect(Layer.empty).live(
  "MC06 ACP foundation interrupt releases a prompt blocked in the original write queue",
  () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const run = Effect.runPromiseWith(yield* Effect.context())
      const c2a = new TransformStream<AnyMessage, AnyMessage>({
        transform: async (message, controller) => {
          if ("method" in message && message.method === "session/prompt") {
            await run(Deferred.succeed(entered, undefined))
            await run(Deferred.await(gate))
          }
          controller.enqueue(message)
        },
      })
      const a2c = new TransformStream<AnyMessage, AnyMessage>()
      const clientStream: Stream = { writable: c2a.writable, readable: a2c.readable }
      const server = new AgentSideConnection(
        () => ({
          initialize: async () => ({ protocolVersion: 1 }),
          newSession: async () => ({ sessionId: "ses_blocked" }),
          loadSession: async () => ({}),
          prompt: async () => ({ stopReason: "end_turn" }),
          cancel: async () => {},
          authenticate: async () => {},
        }),
        { writable: a2c.writable, readable: c2a.readable },
      )
      let client: AcpClientConnectionValue | undefined
      const adapter = makeClaudeCodeAcpAdapter((input) =>
        Effect.sync(() => {
          client = makeClientConnection(clientStream, input)
          return client
        }),
      )
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(gate, undefined).pipe(
          Effect.andThen(Effect.promise(() => client?.close() ?? Promise.resolve())),
        ),
      )
      const execute = adapter.execute
      if (!execute) return yield* Effect.die(new Error("The ACP adapter has no execution method"))
      const scope = yield* Effect.scope
      const fiber = yield* execute({ prompt: "Blocked SDK prompt", cwd: "/tmp/ws" }).pipe(
        Effect.exit,
        Effect.forkIn(scope),
      )
      yield* awaitWithTimeout(Deferred.await(entered), "The actual ACP prompt did not reach write backpressure")
      yield* awaitWithTimeout(Fiber.interrupt(fiber), "ACP interruption waited on the queued cancel write")
      const stopped = yield* Fiber.await(fiber)
      if (Exit.isSuccess(stopped)) return yield* Effect.die(new Error("The original ACP execution was not interrupted"))
      expect(Cause.hasInterruptsOnly(stopped.cause)).toBe(true)
      expect(yield* Deferred.isDone(gate)).toBe(false)
      expect(clientStream.readable.locked).toBe(false)
      expect(clientStream.writable.locked).toBe(false)
      yield* Deferred.succeed(gate, undefined)
      yield* awaitWithTimeout(
        Effect.promise(() => server.closed),
        "The released actual peer SDK did not close",
      )
    }),
)

type PromptInput = { sessionId: string; prompt: string; input: NonNullable<MockState["factoryInput"]> }

// A mock connection factory whose prompt() drives the captured handlers the way
// a real agent would: push text + tool-call updates, optionally request
// permission, then settle the turn.
const mockFactory = (
  state: MockState,
  behavior: (p: PromptInput) => Promise<{ stopReason: string }>,
): AcpConnectionFactory => {
  return (input) => {
    state.factoryInput = input
    const connection: AcpClientConnectionValue = {
      initialize: async () => {
        state.initializeCalls++
        return { protocolVersion: 1 }
      },
      newSession: async (cwd) => {
        state.newSessionCalls.push(cwd)
        return "ses_new"
      },
      loadSession: async (cwd, sessionId) => {
        state.loadSessionCalls.push({ cwd, sessionId })
      },
      prompt: async (sessionId, prompt) => ({
        ...(await behavior({ sessionId, prompt, input })),
        sessionID: sessionId,
        requestID: "mock-acp-prompt",
      }),
      cancel: async () => {},
      close: async () => {
        state.closeCalls++
      },
    }
    return Effect.succeed(connection)
  }
}

describe("transport:acp adapter", () => {
  test("new session: creates a session, streams text into the summary, settles success", async () => {
    const state = freshState()
    const adapter = makeClaudeCodeAcpAdapter(
      mockFactory(state, async ({ input }) => {
        await input!.onUpdate({
          sessionId: "ses_new",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Agent says hi" } },
        })
        return { stopReason: "end_turn" }
      }),
    )
    const result = await run(adapter.execute!({ prompt: "do it", cwd: "/tmp/ws" }))
    expect(state.newSessionCalls).toEqual(["/tmp/ws"])
    expect(state.loadSessionCalls).toEqual([])
    expect(state.initializeCalls).toBe(1)
    expect(result.status).toBe("success")
    expect(result.summary).toBe("Agent says hi")
    expect(result.sessionId).toBe("ses_new")
    expect(state.closeCalls).toBe(1)
  })

  test("session/load: resumeId is loaded and echoed back as DelegationResult.sessionId", async () => {
    const state = freshState()
    const adapter = makeClaudeCodeAcpAdapter(mockFactory(state, async () => ({ stopReason: "end_turn" })))
    const result = await run(adapter.execute!({ prompt: "continue", cwd: "/tmp/ws", resumeId: "ses_resume" }))
    expect(state.loadSessionCalls).toEqual([{ cwd: "/tmp/ws", sessionId: "ses_resume" }])
    expect(state.newSessionCalls).toEqual([])
    // session/load backfills the persisted external session id.
    expect(result.sessionId).toBe("ses_resume")
  })

  test("tool_call updates surface live progress with _meta.parentToolUseId", async () => {
    const state = freshState()
    const progress: ToolCallProgress[] = []
    const adapter = makeClaudeCodeAcpAdapter(
      mockFactory(state, async ({ input }) => {
        await input!.onUpdate({
          sessionId: "ses_new",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
        })
        await input!.onUpdate({
          sessionId: "ses_new",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tc_1",
            title: "Read file",
            kind: "read",
            status: "in_progress",
            _meta: { parentToolUseId: "task_42" },
          },
        })
        return { stopReason: "end_turn" }
      }),
    )
    const result = await run(
      adapter.execute!({ prompt: "x", cwd: "/tmp/ws", onProgress: (entry) => progress.push(entry) }),
    )
    expect(result.status).toBe("success")
    expect(progress).toEqual([
      { parentToolUseId: "task_42", toolCallId: "tc_1", title: "Read file", kind: "read", status: "in_progress" },
    ])
  })

  test("request_permission bridges to canUseTool: allow selects the allow option", async () => {
    const state = freshState()
    const permissionRequests: SdkPermissionRequest[] = []
    const adapter = makeClaudeCodeAcpAdapter(
      mockFactory(state, async ({ input }) => {
        const response = await input!.requestPermission({
          sessionId: "ses_new",
          toolCall: { toolCallId: "tc_2", title: "Run the command", kind: "execute", rawInput: { command: "ls" } },
          options: [
            { optionId: "allow_1", name: "Allow", kind: "allow_once" },
            { optionId: "reject_1", name: "Reject", kind: "reject_once" },
          ],
        })
        state.permissionResponses.push(response)
        await input!.onUpdate({
          sessionId: "ses_new",
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
        })
        return { stopReason: "end_turn" }
      }),
    )
    const result = await run(
      adapter.execute!({
        prompt: "x",
        cwd: "/tmp/ws",
        canUseTool: async (request) => {
          permissionRequests.push(request)
          return "allow"
        },
      }),
    )
    expect(result.status).toBe("success")
    // The ACP tool call maps onto the shared SDK-shaped permission bridge.
    expect(permissionRequests).toEqual([
      {
        toolName: "execute",
        input: { command: "ls" },
        externalSessionID: "ses_new",
        toolUseID: "tc_2",
        signal: expect.any(AbortSignal),
      },
    ])
    expect(state.permissionResponses).toEqual([{ outcome: { outcome: "selected", optionId: "allow_1" } }])
  })

  test("request_permission deny selects the reject option", async () => {
    const state = freshState()
    const adapter = makeClaudeCodeAcpAdapter(
      mockFactory(state, async ({ input }) => {
        const response = await input!.requestPermission({
          sessionId: "ses_new",
          toolCall: { toolCallId: "tc_2", title: "Run the command", kind: "execute", rawInput: { command: "rm -rf" } },
          options: [
            { optionId: "allow_1", name: "Allow", kind: "allow_once" },
            { optionId: "reject_1", name: "Reject", kind: "reject_once" },
          ],
        })
        state.permissionResponses.push(response)
        return { stopReason: "end_turn" }
      }),
    )
    await run(
      adapter.execute!({
        prompt: "x",
        cwd: "/tmp/ws",
        canUseTool: async () => "deny",
      }),
    )
    expect(state.permissionResponses).toEqual([{ outcome: { outcome: "selected", optionId: "reject_1" } }])
  })

  test("stop reasons map to delegation status", async () => {
    const cases: Array<{ stopReason: string; status: DelegationStatus }> = [
      { stopReason: "end_turn", status: "success" },
      { stopReason: "max_tokens", status: "partial" },
      { stopReason: "max_turn_requests", status: "partial" },
      { stopReason: "refusal", status: "failed" },
      { stopReason: "cancelled", status: "failed" },
    ]
    for (const c of cases) {
      const state = freshState()
      const adapter = makeClaudeCodeAcpAdapter(
        mockFactory(state, async ({ input }) => {
          if (c.status !== "failed") {
            await input!.onUpdate({
              sessionId: "ses_new",
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done" } },
            })
          }
          return { stopReason: c.stopReason }
        }),
      )
      const result = await run(adapter.execute!({ prompt: "x", cwd: "/tmp/ws" }))
      expect(result.status).toBe(c.status)
    }
  })

  test("connection factory failure surfaces as a failed DelegationResult, not a throw", async () => {
    const adapter = makeClaudeCodeAcpAdapter(() => Effect.fail(new Error("bridge spawn failed")))
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/tmp/ws" }))
    expect(result.status).toBe("failed")
    expect(result.errors?.[0]).toContain("bridge spawn failed")
    expect(result.summary).toContain("ACP execution failed")
  })
})
