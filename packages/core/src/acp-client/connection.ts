export * as AcpClientConnection from "./connection"

import { ClientSideConnection } from "@agentclientprotocol/sdk"
import type {
  Client,
  InitializeResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  Stream,
} from "@agentclientprotocol/sdk"

/**
 * A `session/update` notification pushed by the agent while a prompt turn runs.
 * The adapter accumulates text chunks / tool-call progress from these.
 */
export type Update = SessionNotification

/** Handler invoked for every `session/update` notification during a turn. */
export type UpdateHandler = (update: Update) => void | Promise<void>

/** Handler that resolves an ACP `session/request_permission` into a response. */
export type PermissionHandler = (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>

/**
 * A client-side ACP connection with a lifecycle surface that mirrors the
 * protocol: initialize → session/new|session/load → session/prompt →
 * session/cancel. Wraps the protocol SDK's `ClientSideConnection`; callers drive
 * the lifecycle and MUST `close()` to release the underlying stream/process.
 *
 * `makeClientConnection` takes a stream so tests can feed an in-memory transport
 * while production passes an `ndJsonStream` over a spawned bridge process.
 */
export interface AcpClientConnection {
  initialize(): Promise<InitializeResponse>
  /** Create a session and return its id. */
  newSession(cwd: string): Promise<string>
  /** Load an existing session (resume) — the id is echoed back by the agent. */
  loadSession(cwd: string, sessionId: string): Promise<void>
  /** Send one turn and wait for the agent's stop reason. */
  prompt(sessionId: string, prompt: string): Promise<{ stopReason: string }>
  /** Request cancellation of the in-flight turn (a notification). */
  cancel(sessionId: string): Promise<void>
  /** Close the underlying stream / release the process. */
  close(): Promise<void>
}

// The client side has no user presence to answer fs/terminal requests, so only
// the two handlers the ACP adapter needs are wired; everything else is absent
// (the SDK answers method-not-found for unimplemented client capabilities).
const makeClient = (handlers: { onUpdate: UpdateHandler; requestPermission: PermissionHandler }): Client => ({
  sessionUpdate: (params) => Promise.resolve(handlers.onUpdate(params)),
  requestPermission: (params) => handlers.requestPermission(params),
})

export function makeClientConnection(
  stream: Stream,
  handlers: { onUpdate: UpdateHandler; requestPermission: PermissionHandler },
): AcpClientConnection {
  const conn = new ClientSideConnection(() => makeClient(handlers), stream)
  return {
    initialize: () => conn.initialize({ protocolVersion: 1, clientInfo: { name: "AigcForge", version: "1.0" } }),
    newSession: async (cwd) => (await conn.newSession({ cwd, mcpServers: [] })).sessionId,
    loadSession: async (cwd, sessionId) => {
      await conn.loadSession({ sessionId, cwd, mcpServers: [] })
    },
    prompt: async (sessionId, prompt) => {
      const response = await conn.prompt({ sessionId, prompt: [{ type: "text", text: prompt }] })
      return { stopReason: response.stopReason }
    },
    cancel: (sessionId) => conn.cancel({ sessionId }),
    close: async () => {
      // Close the writable (EOF to the agent → it exits) and cancel the readable
      // so the connection's receive loop terminates, leaving no dangling reader.
      try {
        await stream.writable.close()
      } catch {
        // The transport may already be closed (agent exited); that is fine.
      }
      try {
        await stream.readable.cancel()
      } catch {
        // The readable may already be errored/closed.
      }
    },
  }
}
