/**
 * ACP client connection lifecycle contract tests (M5 Phase A #1).
 *
 * Drives the real `ClientSideConnection` (wrapped by `makeClientConnection`)
 * against a real `AgentSideConnection` — both from @agentclientprotocol/sdk —
 * over an in-memory duplex transport. The only thing faked is the byte
 * transport, so the protocol sequence is exercised end to end:
 *
 *   initialize → session/new|session/load → session/prompt → session/update
 *   (notification) + session/request_permission (request) → session/cancel
 *
 * @see packages/core/src/acp-client/connection.ts
 */
import { describe, expect, test } from "bun:test"
import { AgentSideConnection } from "@agentclientprotocol/sdk"
import type {
  Agent,
  AnyMessage,
  CancelNotification,
  InitializeRequest,
  LoadSessionRequest,
  NewSessionRequest,
  PromptRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  Stream,
} from "@agentclientprotocol/sdk"
import { makeClientConnection } from "../src/acp-client/connection"

// Two connected `Stream`s: messages written to [0].writable appear on [1].readable
// and vice versa — a full-duplex in-memory pipe between client and agent.
const duplexStreamPair = (): [Stream, Stream] => {
  const a2b = new TransformStream<AnyMessage, AnyMessage>()
  const b2a = new TransformStream<AnyMessage, AnyMessage>()
  return [
    { writable: a2b.writable, readable: b2a.readable },
    { writable: b2a.writable, readable: a2b.readable },
  ]
}

describe("ACP client connection lifecycle", () => {
  test("initialize → newSession → prompt (updates + permission) → cancel over the wire", async () => {
    const [clientStream, agentStream] = duplexStreamPair()
    const received: {
      initialize?: InitializeRequest
      newSession?: NewSessionRequest
      prompt?: PromptRequest
      cancel?: CancelNotification
    } = {}
    const updates: SessionNotification[] = []
    const permissionRequests: RequestPermissionRequest[] = []
    let permissionResponse: RequestPermissionResponse | undefined
    let agentConn: AgentSideConnection

    // The test-side "agent": responds to client requests and pushes updates.
    const agent: Agent = {
      initialize: async (params) => {
        received.initialize = params
        return { protocolVersion: 1, agentCapabilities: { loadSession: true } }
      },
      newSession: async (params) => {
        received.newSession = params
        return { sessionId: "ses_1" }
      },
      loadSession: async (_params) => {
        return {}
      },
      prompt: async (params) => {
        received.prompt = params
        // Request permission first; the client must answer before the turn ends.
        permissionResponse = await agentConn.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: "tc_1", title: "Run the command", kind: "execute" },
          options: [
            { optionId: "allow_1", name: "Allow", kind: "allow_once" },
            { optionId: "reject_1", name: "Reject", kind: "reject_once" },
          ],
        })
        // Push a session update, then complete the turn.
        await agentConn.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello from agent" } },
        })
        return { stopReason: "end_turn" }
      },
      cancel: async (params) => {
        received.cancel = params
      },
      authenticate: async () => {},
    }
    new AgentSideConnection((conn) => {
      agentConn = conn
      return agent
    }, agentStream)

    const client = makeClientConnection(clientStream, {
      onUpdate: (update) => {
        updates.push(update)
      },
      requestPermission: async (request) => {
        permissionRequests.push(request)
        return { outcome: { outcome: "cancelled" } }
      },
    })

    await client.initialize()
    expect(received.initialize?.protocolVersion).toBe(1)

    const sessionId = await client.newSession("/tmp/ws")
    expect(sessionId).toBe("ses_1")
    expect(received.newSession?.cwd).toBe("/tmp/ws")

    const { stopReason } = await client.prompt(sessionId, "hello")
    expect(stopReason).toBe("end_turn")
    expect(received.prompt?.prompt).toEqual([{ type: "text", text: "hello" }])
    // The permission request reached the client handler and its answer returned.
    expect(permissionRequests).toHaveLength(1)
    expect(permissionRequests[0].toolCall.toolCallId).toBe("tc_1")
    expect(permissionResponse).toEqual({ outcome: { outcome: "cancelled" } })
    // The agent's session/update notification reached the client handler.
    const chunk = updates.find((u) => u.update.sessionUpdate === "agent_message_chunk")
    expect(chunk).toBeDefined()
    const content = chunk?.update
    expect(content?.sessionUpdate).toBe("agent_message_chunk")
    if (content?.sessionUpdate === "agent_message_chunk" && content.content.type === "text") {
      expect(content.content.text).toBe("Hello from agent")
    }

    await client.cancel(sessionId)
    expect(received.cancel?.sessionId).toBe("ses_1")

    await client.close()
  })

  test("loadSession echoes the resume id for session/load", async () => {
    const [clientStream, agentStream] = duplexStreamPair()
    let loaded: LoadSessionRequest | undefined
    const agent: Agent = {
      initialize: async () => ({ protocolVersion: 1 }),
      newSession: async () => ({ sessionId: "new" }),
      loadSession: async (params) => {
        loaded = params
        return {}
      },
      prompt: async () => ({ stopReason: "end_turn" }),
      cancel: async () => {},
      authenticate: async () => {},
    }
    new AgentSideConnection((_conn) => agent, agentStream)

    const client = makeClientConnection(clientStream, {
      onUpdate: () => {},
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
    })
    await client.initialize()
    await client.loadSession("/tmp/ws", "ses_resume")
    expect(loaded?.sessionId).toBe("ses_resume")
    expect(loaded?.cwd).toBe("/tmp/ws")
    await client.close()
  })
})
