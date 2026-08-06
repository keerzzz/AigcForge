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
import { Effect } from "effect"
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { AcpClientConnection, PermissionHandler, UpdateHandler } from "../src/acp-client/connection"
import type { ToolCallProgress } from "../src/acp-client/update"
import { makeClaudeCodeAcpAdapter } from "../src/tool/claude-code-acp"
import type { AcpConnectionFactory } from "../src/tool/acp"
import type { DelegationStatus, SdkPermissionRequest } from "../src/tool/cli-adapter"

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

type PromptInput = { sessionId: string; prompt: string; input: MockState["factoryInput"] }

// A mock connection factory whose prompt() drives the captured handlers the way
// a real agent would: push text + tool-call updates, optionally request
// permission, then settle the turn.
const mockFactory = (state: MockState, behavior: (p: PromptInput) => Promise<{ stopReason: string }>): AcpConnectionFactory => {
  return (input) => {
    state.factoryInput = input
    const connection: AcpClientConnection = {
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
      prompt: async (sessionId, prompt) => behavior({ sessionId, prompt, input }),
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
    const adapter = makeClaudeCodeAcpAdapter(
      mockFactory(state, async () => ({ stopReason: "end_turn" })),
    )
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
    const result = await run(adapter.execute!({ prompt: "x", cwd: "/tmp/ws", onProgress: (entry) => progress.push(entry) }))
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
    expect(permissionRequests).toEqual([{ toolName: "execute", input: { command: "ls" } }])
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
      const adapter = makeClaudeCodeAcpAdapter(mockFactory(state, async () => ({ stopReason: c.stopReason })))
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
