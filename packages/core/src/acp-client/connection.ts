export * as AcpClientConnection from "./connection.js"

import { ClientSideConnection } from "@agentclientprotocol/sdk"
import type {
  AnyMessage,
  Client,
  InitializeResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestId,
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

export type ReadTextFileHandler = (request: ReadTextFileRequest) => Promise<ReadTextFileResponse>

/** Request identity belongs to this connection's prompt call, not a native turn. */
export type PromptResult = {
  stopReason: string
  sessionID: string
  requestID: NonNullable<RequestId>
  userMessageID?: string | null
}

type PromptScope = {
  sessionID: string
  requestID?: NonNullable<RequestId>
  active: boolean
}

/**
 * A client-side ACP connection with a lifecycle surface that mirrors the
 * protocol: initialize → session/new|session/load → session/prompt →
 * session/cancel. Wraps the protocol SDK's `ClientSideConnection`; callers drive
 * the lifecycle and MUST `close()` to release the underlying stream/process.
 *
 * `makeClientConnection` takes a stream so tests can feed an in-memory transport
 * while production passes an `ndJsonStream` over a spawned bridge process.
 */
export interface AcpClientConnectionValue {
  initialize(): Promise<InitializeResponse>
  /** Create a session and return its id. */
  newSession(cwd: string): Promise<string>
  /** Load an existing session; the original request owns the resumed SID. */
  loadSession(cwd: string, sessionId: string): Promise<void>
  /** Send one prompt and retain its actual connection-local request identity. */
  prompt(sessionId: string, prompt: string): Promise<PromptResult>
  /** Request cancellation of the in-flight turn (a notification). */
  cancel(sessionId: string): Promise<void>
  /** Close the underlying stream / release the process. */
  close(): Promise<void>
}

export function makeClientConnection(
  stream: Stream,
  handlers: { onUpdate: UpdateHandler; requestPermission: PermissionHandler; readTextFile?: ReadTextFileHandler },
): AcpClientConnectionValue {
  const readTextFile = handlers.readTextFile
  const reader = stream.readable.getReader()
  const writer = stream.writable.getWriter()
  const shutdown = Promise.withResolvers<void>()
  const closedError = new Error("ACP connection closed")
  let pending: PromptScope | undefined
  let closing: Promise<void> | undefined
  const observed: Stream = {
    writable: new WritableStream<AnyMessage>({
      write: async (message) => {
        if (
          pending?.active &&
          "method" in message &&
          message.method === "session/prompt" &&
          "id" in message &&
          (typeof message.id === "number" || typeof message.id === "string")
        ) {
          const params = message.params
          if (
            typeof params === "object" &&
            params !== null &&
            "sessionId" in params &&
            params.sessionId === pending.sessionID
          )
            pending.requestID = message.id
        }
        await Promise.race([
          writer.write(message),
          shutdown.promise.then(() => {
            throw closedError
          }),
        ])
      },
    }),
    readable: new ReadableStream<AnyMessage>(
      {
        pull: async (controller) => {
          try {
            const next = await Promise.race([
              reader.read(),
              shutdown.promise.then(() => {
                throw closedError
              }),
            ])
            if (next.done) {
              if (pending) pending.active = false
              controller.close()
              return
            }
            if (
              pending &&
              pending.requestID !== undefined &&
              !("method" in next.value) &&
              next.value.id === pending.requestID
            )
              pending.active = false
            controller.enqueue(next.value)
          } catch (error) {
            if (pending) pending.active = false
            controller.error(error)
          }
        },
      },
      { highWaterMark: 0 },
    ),
  }
  const conn = new ClientSideConnection(
    (): Client => ({
      sessionUpdate: async (params) => {
        if (!pending?.active || pending.requestID === undefined || params.sessionId !== pending.sessionID) return
        await handlers.onUpdate(params)
      },
      requestPermission: async (params) => {
        const owner = pending
        if (!owner?.active || owner.requestID === undefined || params.sessionId !== owner.sessionID)
          return { outcome: { outcome: "cancelled" } }
        const response = await handlers.requestPermission(params)
        if (pending !== owner || !owner.active) return { outcome: { outcome: "cancelled" } }
        return response
      },
      ...(readTextFile
        ? {
            readTextFile: async (params: ReadTextFileRequest) => {
              const owner = pending
              if (!owner?.active || owner.requestID === undefined || params.sessionId !== owner.sessionID)
                throw new Error("ACP file read has no owning prompt")
              const response = await readTextFile(params)
              if (pending !== owner || !owner.active) throw new Error("ACP file read prompt ended")
              return response
            },
          }
        : {}),
    }),
    observed,
  )
  return {
    initialize: () =>
      conn.initialize({
        protocolVersion: 1,
        clientInfo: { name: "AigcForge", version: "1.0" },
        ...(readTextFile ? { clientCapabilities: { fs: { readTextFile: true } } } : {}),
      }),
    newSession: async (cwd) => (await conn.newSession({ cwd, mcpServers: [] })).sessionId,
    loadSession: async (cwd, sessionId) => {
      await conn.loadSession({ sessionId, cwd, mcpServers: [] })
    },
    prompt: async (sessionId, prompt) => {
      // Updates carry no prompt request ID, so this connection owns one pending prompt.
      if (pending) throw new Error("ACP connection already has a pending prompt")
      if (closing) throw new Error("ACP connection is closing")
      const current: PromptScope = { sessionID: sessionId, active: true }
      pending = current
      try {
        const response = await conn.prompt({ sessionId, prompt: [{ type: "text", text: prompt }] })
        if (current.requestID === undefined) throw new Error("ACP prompt has no observed wire request identity")
        return {
          stopReason: response.stopReason,
          sessionID: current.sessionID,
          requestID: current.requestID,
          ...(response.userMessageId === undefined ? {} : { userMessageID: response.userMessageId }),
        }
      } finally {
        if (pending === current) pending = undefined
      }
    },
    cancel: (sessionId) => {
      if (pending?.sessionID === sessionId) pending.active = false
      return conn.cancel({ sessionId })
    },
    close: () => {
      if (closing) return closing
      if (pending) pending.active = false
      closing = (async () => {
        shutdown.resolve()
        // Pending transport writes may need the enclosing process Scope to end.
        // Stop observation and release our locks before waiting for that transport.
        void reader.cancel().catch(() => {})
        void writer.abort(closedError).catch(() => {})
        reader.releaseLock()
        writer.releaseLock()
        await conn.closed
      })()
      return closing
    },
  }
}
