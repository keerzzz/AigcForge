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
  ReadTextFileRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  Stream,
} from "@agentclientprotocol/sdk"
import { makeClientConnection } from "../src/acp-client/connection"
import { Deferred, Effect, Layer } from "effect"
import { awaitWithTimeout, testEffect } from "./lib/effect"

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

for (const enabled of [false, true])
  testEffect(Layer.empty).live(
    `MC06 ACP formal file reads ${enabled ? "advertise their callback" : "omit the capability"} and retain the prompt owner`,
    () =>
      Effect.gen(function* () {
        const [clientStream, agentStream] = duplexStreamPair()
        const initialized: InitializeRequest[] = []
        const requests: ReadTextFileRequest[] = []
        const rejected: string[] = []
        const server = new AgentSideConnection(
          (conn) => ({
            initialize: async (params) => {
              initialized.push(params)
              return { protocolVersion: 1 }
            },
            newSession: async () => {
              await conn
                .readTextFile({ sessionId: "ses_fs", path: "/tmp/ws/early.txt" })
                .catch(() => rejected.push("early"))
              return { sessionId: "ses_fs" }
            },
            loadSession: async () => ({}),
            authenticate: async () => {},
            cancel: async () => {},
            prompt: async (params) => {
              await conn
                .readTextFile({ sessionId: "ses_other", path: "/tmp/ws/foreign.txt" })
                .catch(() => rejected.push("foreign"))
              if (enabled)
                expect(
                  await conn.readTextFile({
                    sessionId: params.sessionId,
                    path: "/tmp/ws/original.txt",
                    line: 2,
                    limit: 1,
                  }),
                ).toEqual({ content: "  原文🙂  " })
              return { stopReason: "end_turn" }
            },
          }),
          agentStream,
        )
        const client = makeClientConnection(clientStream, {
          onUpdate: () => {},
          requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
          ...(enabled
            ? {
                readTextFile: async (request: ReadTextFileRequest) => {
                  requests.push(request)
                  return { content: "  原文🙂  " }
                },
              }
            : {}),
        })
        yield* Effect.addFinalizer(() => Effect.promise(() => client.close()))
        yield* Effect.promise(() => client.initialize())
        const sid = yield* Effect.promise(() => client.newSession("/tmp/ws"))
        yield* Effect.promise(() => client.prompt(sid, "read once"))
        const late = yield* Effect.promise(() =>
          server.readTextFile({ sessionId: sid, path: "/tmp/ws/late.txt" }).then(
            () => undefined,
            (error: unknown) => error,
          ),
        )
        if (enabled) expect(late).toBeInstanceOf(Error)
        expect(initialized[0]?.clientCapabilities?.fs?.readTextFile ?? false).toBe(enabled)
        if (enabled) expect(rejected).toEqual(["early", "foreign"])
        expect(requests).toEqual(enabled ? [{ sessionId: sid, path: "/tmp/ws/original.txt", line: 2, limit: 1 }] : [])
        yield* Effect.promise(() => client.close())
        yield* awaitWithTimeout(
          Effect.promise(() => server.closed),
          "The fs ACP peer did not close",
        )
      }),
  )

testEffect(Layer.empty).live(
  "MC06 ACP formal late file-read reply cannot become the next same-SID prompt's content",
  () =>
    Effect.gen(function* () {
      const [clientStream, agentStream] = duplexStreamPair()
      const entered = yield* Deferred.make<void>()
      const readGate = yield* Deferred.make<void>()
      const reply = yield* Deferred.make<unknown>()
      const nextEntered = yield* Deferred.make<void>()
      const nextGate = yield* Deferred.make<void>()
      const run = Effect.runPromiseWith(yield* Effect.context())
      const server = new AgentSideConnection(
        (conn) => ({
          initialize: async () => ({ protocolVersion: 1 }),
          newSession: async () => ({ sessionId: "ses_fs_owner" }),
          loadSession: async () => ({}),
          authenticate: async () => {},
          cancel: async () => {},
          prompt: async (params) => {
            if (params.prompt.some((part) => part.type === "text" && part.text === "second")) {
              await run(Deferred.succeed(nextEntered, undefined))
              await run(Deferred.await(nextGate))
              return { stopReason: "end_turn" }
            }
            void conn.readTextFile({ sessionId: params.sessionId, path: "/tmp/ws/original.txt" }).then(
              (response) => run(Deferred.succeed(reply, response)),
              (error: unknown) => run(Deferred.succeed(reply, error)),
            )
            await run(Deferred.await(entered))
            return { stopReason: "end_turn" }
          },
        }),
        agentStream,
      )
      const reads: ReadTextFileRequest[] = []
      const client = makeClientConnection(clientStream, {
        onUpdate: () => {},
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
        readTextFile: async (request) => {
          reads.push(request)
          await run(Deferred.succeed(entered, undefined))
          await run(Deferred.await(readGate))
          return { content: "original owner" }
        },
      })
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(readGate, undefined).pipe(
          Effect.andThen(Deferred.succeed(nextGate, undefined)),
          Effect.andThen(Effect.promise(() => client.close())),
        ),
      )
      yield* Effect.promise(() => client.initialize())
      const sid = yield* Effect.promise(() => client.newSession("/tmp/ws"))
      yield* Effect.promise(() => client.prompt(sid, "first"))
      const next = client.prompt(sid, "second")
      yield* awaitWithTimeout(Deferred.await(nextEntered), "The next file-read prompt did not start")
      yield* Deferred.succeed(readGate, undefined)
      const late = yield* awaitWithTimeout(Deferred.await(reply), "The original file-read reply did not settle")
      expect(late).toBeInstanceOf(Error)
      expect(reads).toEqual([{ sessionId: sid, path: "/tmp/ws/original.txt" }])
      yield* Deferred.succeed(nextGate, undefined)
      yield* awaitWithTimeout(
        Effect.promise(() => next),
        "The next file-read prompt did not finish",
      )
      yield* Effect.promise(() => client.close())
      yield* awaitWithTimeout(
        Effect.promise(() => server.closed),
        "The late file-read ACP peer did not close",
      )
    }),
)

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

testEffect(Layer.empty).live(
  "MC06 ACP foundation close releases a backpressured prompt before the transport write finishes",
  () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const gate = yield* Deferred.make<void>()
      const aborted = yield* Deferred.make<void>()
      const run = Effect.runPromiseWith(yield* Effect.context())
      const stream: Stream = {
        readable: new ReadableStream<AnyMessage>(),
        writable: new WritableStream<AnyMessage>({
          write: () => run(Deferred.succeed(entered, undefined)).then(() => run(Deferred.await(gate))),
          abort: () => run(Deferred.succeed(aborted, undefined)).then(() => undefined),
        }),
      }
      const client = makeClientConnection(stream, {
        onUpdate: () => {},
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      })
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(gate, undefined).pipe(Effect.andThen(Effect.promise(() => client.close()))),
      )
      const prompt = client.prompt("ses_backpressure", "Blocked original prompt").then(
        () => undefined,
        (error: unknown) => error,
      )
      yield* awaitWithTimeout(Deferred.await(entered), "The ACP prompt did not reach the backpressured transport")
      yield* awaitWithTimeout(
        Effect.promise(() => client.close()),
        "ACP close waited for its blocked transport write",
      )
      expect(yield* Deferred.isDone(gate)).toBe(false)
      expect(stream.readable.locked).toBe(false)
      expect(stream.writable.locked).toBe(false)
      const error = yield* awaitWithTimeout(
        Effect.promise(() => prompt),
        "The SDK pending prompt was not rejected by close",
      )
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) return yield* Effect.die(new Error("ACP close did not retain its SDK failure"))
      expect(error.message).toContain("closed")
      yield* Deferred.succeed(gate, undefined)
      yield* awaitWithTimeout(Deferred.await(aborted), "The original transport did not finish its queued abort")
      yield* Effect.promise(() => client.close())
    }),
)

testEffect(Layer.empty).live(
  "MC06 ACP foundation late permission retains its original owner during the next same-SID prompt",
  () =>
    Effect.gen(function* () {
      const [clientStream, agentStream] = duplexStreamPair()
      const permissionEntered = yield* Deferred.make<void>()
      const permissionGate = yield* Deferred.make<void>()
      const permissionReply = yield* Deferred.make<RequestPermissionResponse, Error>()
      const nextEntered = yield* Deferred.make<void>()
      const nextGate = yield* Deferred.make<void>()
      const run = Effect.runPromiseWith(yield* Effect.context())
      const server = new AgentSideConnection(
        (conn) => ({
          initialize: async () => ({ protocolVersion: 1 }),
          newSession: async () => ({ sessionId: "ses_owner" }),
          loadSession: async () => ({}),
          authenticate: async () => {},
          cancel: async () => {},
          prompt: async (params) => {
            if (params.prompt.some((part) => part.type === "text" && part.text === "second")) {
              await run(Deferred.succeed(nextEntered, undefined))
              await run(Deferred.await(nextGate))
              return { stopReason: "end_turn" }
            }
            void conn
              .requestPermission({
                sessionId: params.sessionId,
                toolCall: { toolCallId: "tc_original", kind: "read" },
                options: [{ optionId: "allow_original", name: "Allow once", kind: "allow_once" }],
              })
              .then(
                (response) => run(Deferred.succeed(permissionReply, response)),
                (error: unknown) =>
                  run(Deferred.fail(permissionReply, error instanceof Error ? error : new Error(String(error)))),
              )
            await conn.sessionUpdate({
              sessionId: params.sessionId,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "first result" } },
            })
            return { stopReason: "end_turn" }
          },
        }),
        agentStream,
      )
      const requests: RequestPermissionRequest[] = []
      const client = makeClientConnection(clientStream, {
        onUpdate: () => {},
        requestPermission: async (request) => {
          requests.push(request)
          await run(Deferred.succeed(permissionEntered, undefined))
          await run(Deferred.await(permissionGate))
          return { outcome: { outcome: "selected", optionId: "allow_original" } }
        },
      })
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(permissionGate, undefined).pipe(
          Effect.andThen(Deferred.succeed(nextGate, undefined)),
          Effect.andThen(Effect.promise(() => client.close())),
        ),
      )
      yield* Effect.promise(() => client.initialize())
      const sid = yield* Effect.promise(() => client.newSession("/tmp/ws"))
      const first = client.prompt(sid, "first")
      yield* awaitWithTimeout(
        Deferred.await(permissionEntered),
        "The original prompt did not own its permission callback",
      )
      const original = yield* awaitWithTimeout(
        Effect.promise(() => first),
        "The original SDK prompt did not finish",
      )
      const second = client.prompt(sid, "second")
      yield* awaitWithTimeout(Deferred.await(nextEntered), "The same-SID successor did not begin")
      yield* Deferred.succeed(permissionGate, undefined)
      expect(
        yield* awaitWithTimeout(Deferred.await(permissionReply), "The original permission reply did not settle"),
      ).toEqual({
        outcome: { outcome: "cancelled" },
      })
      expect(requests.map((request) => request.toolCall.toolCallId)).toEqual(["tc_original"])
      yield* Deferred.succeed(nextGate, undefined)
      const successor = yield* awaitWithTimeout(
        Effect.promise(() => second),
        "The same-SID successor did not finish",
      )
      expect(successor.sessionID).toBe(original.sessionID)
      expect(successor.requestID).not.toBe(original.requestID)
      yield* Effect.promise(() => client.close())
      yield* awaitWithTimeout(
        Effect.promise(() => server.closed),
        "The actual peer SDK did not close",
      )
      expect(clientStream.readable.locked).toBe(false)
      expect(clientStream.writable.locked).toBe(false)
    }),
)
