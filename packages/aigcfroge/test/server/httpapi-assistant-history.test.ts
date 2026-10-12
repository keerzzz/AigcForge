import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { AIGCFROGE_V2_RUNTIME, AppLayer } from "../../src/effect/app-runtime"
import { Server } from "../../src/server/server"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffectShared } from "../lib/effect"
import { LegacyHistory } from "../lib/legacy-history"
import { TestLLMServer } from "../lib/llm-server"

// Share the production handler's service identities. Inbound requests exercise the
// real HttpApi web handler; the provider is a separate native loopback HTTP server.
const it = testEffectShared(Layer.mergeAll(AppLayer, TestLLMServer.layer, NodeFileSystem.layer))

class SessionResponse extends Schema.Class<SessionResponse>("HistoryHttpApi.SessionResponse")({
  data: SessionV2.Info,
}) {}

class MessagesResponse extends Schema.Class<MessagesResponse>("HistoryHttpApi.MessagesResponse")({
  data: Schema.Array(SessionMessage.Message),
}) {}

it.live("Assistant history survives product HTTP reads and reaches the provider after prompt_async", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        expect(AIGCFROGE_V2_RUNTIME).toBe(false)
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const filesystem = yield* FileSystem.FileSystem
        const seeded = yield* LegacyHistory.seedLegacyTranscript(dir, "_product_http")
        yield* Effect.addFinalizer(() =>
          execution.interrupt(seeded.sessionID).pipe(Effect.andThen(sessions.remove(seeded.sessionID)), Effect.orDie),
        )
        const before = yield* LegacyHistory.persistedState(seeded.sessionID)
        expect(before.events).toEqual([])
        expect(before.inputs).toEqual([])

        const opened = yield* request(dir, `/api/session/${seeded.sessionID}`)
        expect(opened.status).toBe(200)
        const info = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(SessionResponse))(
          yield* Effect.promise(() => opened.json()),
        )
        expect(info.data).toMatchObject({ id: seeded.sessionID, mode: "assistant" })
        const history = yield* messages(dir, seeded.sessionID)
        expect(history.map((message) => message.id)).toEqual([
          SessionMessage.ID.make(seeded.user),
          SessionMessage.ID.make(seeded.assistant),
        ])
        expect(history[0]).toMatchObject({ type: "user", text: "Historical question." })
        expect(history[1]).toMatchObject({ type: "assistant", ...LegacyHistory.historicalUsage })
        expect(yield* messages(dir, seeded.sessionID)).toEqual(history)

        const legacy = yield* request(dir, `/session/${seeded.sessionID}/message`)
        expect(legacy.status).toBe(200)
        const legacyMessages = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(Schema.Array(SessionV1.WithParts)))(
          yield* Effect.promise(() => legacy.json()),
        )
        expect(legacyMessages.map((message) => message.info.id)).toEqual([seeded.user, seeded.assistant])

        const imported = yield* LegacyHistory.persistedState(seeded.sessionID)
        expect(imported.source).toEqual(before.source)
        expect(imported.usage).toEqual(before.usage)
        expect(imported.events.map((event) => event.type)).toEqual([
          "session.next.history.imported.1",
          "session.next.history.imported.1",
        ])
        expect(imported.inputs).toEqual([])
        expect(yield* llm.calls).toBe(0)

        const input = {
          messageID: "msg_history_product_http_continue",
          parts: [{ type: "text", text: "Continue through the product HTTP endpoint." }],
        }
        yield* llm.text("The product HTTP path preserved the history.", { usage: { input: 7, output: 3 } })
        const submitted = yield* request(dir, `/session/${seeded.sessionID}/prompt_async`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
        expect(submitted.status).toBe(204)
        expect(yield* Effect.promise(() => submitted.text())).toBe("")
        yield* awaitWithTimeout(llm.wait(1), "Product prompt_async did not reach the provider", "20 seconds")
        const completed = yield* pollWithTimeout(
          messages(dir, seeded.sessionID).pipe(
            Effect.map((current) => {
              const last = current.at(-1)
              return current.length === 4 && last?.type === "assistant" && last.finish === "stop" ? current : undefined
            }),
          ),
          "Canonical HTTP read did not expose the completed Assistant reply",
          "20 seconds",
        )
        yield* pollWithTimeout(
          execution.isActive(seeded.sessionID).pipe(Effect.map((active) => (active ? undefined : true))),
          "Product HTTP turn did not become idle",
        )
        expect(completed.slice(0, 2)).toEqual([...history])
        expect(completed[2]).toMatchObject({ id: input.messageID, type: "user", text: input.parts[0]?.text })
        expect(completed[3]).toMatchObject({
          type: "assistant",
          agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
          finish: "stop",
          content: [{ type: "text", text: "The product HTTP path preserved the history." }],
          tokens: { input: 7, output: 3 },
        })

        const hits = yield* llm.hits
        expect(hits.length).toBe(1)
        expect(hits[0]?.url.pathname).toBe("/v1/chat/completions")
        expect({ model: hits[0]?.body.model, stream: hits[0]?.body.stream }).toEqual({
          model: LegacyHistory.modelID,
          stream: true,
        })
        const wire = LegacyHistory.decodeMessages(hits[0]?.body.messages)
        expect(wire).toEqual([
          { role: "user", content: "Historical question." },
          {
            role: "assistant",
            content: "Historical answer.",
            tool_calls: [
              {
                id: "history-completed-call",
                type: "function",
                function: { name: "write", arguments: JSON.stringify(seeded.completedInput) },
              },
              {
                id: "history-pending-call",
                type: "function",
                function: { name: "write", arguments: JSON.stringify(seeded.pendingInput) },
              },
            ],
          },
          { role: "tool", tool_call_id: "history-completed-call", content: "Historical tool output." },
          {
            role: "tool",
            tool_call_id: "history-pending-call",
            content: expect.any(String),
          },
          { role: "user", content: input.parts[0]?.text },
        ])
        expect(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(wire[3]?.content)).toEqual({
          error: { type: "unknown", message: "[Tool execution was interrupted]" },
          content: [],
          structured: {},
        })
        expect(JSON.stringify(wire)).not.toContain("private-tool-metadata")
        expect(yield* llm.pending).toBe(0)

        const after = yield* LegacyHistory.persistedState(seeded.sessionID)
        expect(after.source).toEqual(before.source)
        expect(after.events.filter((event) => event.type === "session.next.history.imported.1")).toEqual(
          imported.events,
        )
        expect(after.events.filter((event) => event.type === "session.next.step.started.1")).toHaveLength(1)
        expect(after.events.filter((event) => event.type.startsWith("session.next.tool."))).toEqual([])
        expect(after.inputs).toHaveLength(1)
        expect(after.inputs[0]).toMatchObject({ id: input.messageID, session_id: seeded.sessionID })
        expect(after.inputs[0]?.promoted_seq).not.toBeNull()
        expect(yield* filesystem.exists(seeded.completedInput.filePath)).toBe(false)
        expect(yield* filesystem.exists(seeded.pendingInput.filePath)).toBe(false)
        expect(yield* messages(dir, seeded.sessionID)).toEqual(completed)
        expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(after)
        const retried = yield* request(dir, `/session/${seeded.sessionID}/prompt_async`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        })
        expect(retried.status).toBe(204)
        yield* pollWithTimeout(
          execution.isActive(seeded.sessionID).pipe(Effect.map((active) => (active ? undefined : true))),
          "Product HTTP retry did not become idle",
        )
        expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(after)
        expect(yield* llm.calls).toBe(1)

        const evidenceDirectory = process.env.AIGCFROGE_HISTORY_HTTP_EVIDENCE_DIR
        if (evidenceDirectory) {
          yield* filesystem.makeDirectory(evidenceDirectory, { recursive: true })
          yield* filesystem.writeFileString(
            `${evidenceDirectory}/history-product-http.json`,
            JSON.stringify(
              {
                runtime: {
                  v2: AIGCFROGE_V2_RUNTIME,
                  mode: "assistant",
                  inbound: "production-httpapi-web-handler",
                  provider: "native-loopback-http",
                },
                routes: [
                  { method: "GET", path: `/api/session/${seeded.sessionID}`, status: opened.status },
                  { method: "GET", path: `/session/${seeded.sessionID}/message`, status: legacy.status },
                  { method: "POST", path: `/session/${seeded.sessionID}/prompt_async`, status: submitted.status },
                  { method: "GET", path: `/api/session/${seeded.sessionID}/message?order=asc`, status: 200 },
                  {
                    method: "POST",
                    path: `/session/${seeded.sessionID}/prompt_async`,
                    status: retried.status,
                    retry: true,
                  },
                ],
                requests: hits.map((hit) => ({
                  path: hit.url.pathname,
                  receivedBodySha256: LegacyHistory.digest(hit.body),
                  model: hit.body.model,
                  stream: hit.body.stream,
                  messages: wire,
                })),
                canonicalMessages: completed,
                events: after.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
                inputs: after.inputs,
                usage: { before: before.usage, afterImport: imported.usage },
                source: {
                  beforeSha256: LegacyHistory.digest(before.source),
                  afterSha256: LegacyHistory.digest(after.source),
                },
                toolReplayFiles: {
                  completed: yield* filesystem.exists(seeded.completedInput.filePath),
                  pending: yield* filesystem.exists(seeded.pendingInput.filePath),
                },
              },
              null,
              2,
            ) + "\n",
          )
        }
      }),
    { config: LegacyHistory.providerConfig },
  ),
)

function request(directory: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
  return Effect.promise(() => Promise.resolve(Server.Default().app.request(path, { ...init, headers })))
}

const messages = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID) {
  const response = yield* request(directory, `/api/session/${sessionID}/message?order=asc`)
  expect(response.status).toBe(200)
  return (yield* Schema.decodeUnknownEffect(Schema.toCodecJson(MessagesResponse))(
    yield* Effect.promise(() => response.json()),
  )).data
})
