import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { DateTime, Effect, FileSystem, Layer, Schema } from "effect"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { Schedule } from "@aigcfroge/schema/schedule"
import { AIGCFROGE_V2_RUNTIME, AppLayer } from "../../src/effect/app-runtime"
import { Server } from "../../src/server/server"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffectShared } from "../lib/effect"
import { LegacyHistory } from "../lib/legacy-history"
import { reply, TestLLMServer } from "../lib/llm-server"

const it = testEffectShared(Layer.mergeAll(AppLayer, Layer.fresh(TestLLMServer.layer), NodeFileSystem.layer))

class CreatedSession extends Schema.Class<CreatedSession>("AssistantRecovery.CreatedSession")({
  id: SessionV2.ID,
  mode: Schema.Literal("assistant"),
  agent: Schema.Literal(ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR),
}) {}

class MessagesResponse extends Schema.Class<MessagesResponse>("AssistantRecovery.MessagesResponse")({
  data: Schema.Array(SessionMessage.Message),
}) {}

class DeltaEnvelope extends Schema.Class<DeltaEnvelope>("AssistantRecovery.DeltaEnvelope")({
  type: Schema.Literal(SessionEvent.Text.Delta.type),
  // The legacy /event text stream JSON-stringifies live DateTime values as ISO
  // strings; the durable event codec uses milliseconds instead.
  properties: Schema.Struct({ ...SessionEvent.Text.Delta.data.fields, timestamp: Schema.DateTimeUtcFromString }),
}) {}

for (const rejected of [
  { status: 400, attempts: 1, label: "provider failure", evidence: "assistant-post-tool-recovery.json" },
  { status: 503, attempts: 3, label: "503 retry exhaustion", evidence: "assistant-503-retry-recovery.json" },
]) {
  it.live(`Assistant HTTP retry and explicit recovery preserve a completed reminder after ${rejected.label}`, () =>
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          expect(AIGCFROGE_V2_RUNTIME).toBe(false)
          const sessions = yield* SessionV2.Service
          const execution = yield* SessionExecution.Service
          const filesystem = yield* FileSystem.FileSystem
          const created = yield* request(dir, "/session", {
            method: "POST",
            body: JSON.stringify({ mode: "assistant", title: "Assistant recovery after a completed reminder" }),
          })
          expect(created.status).toBe(200)
          const session = yield* Schema.decodeUnknownEffect(CreatedSession)(yield* Effect.promise(() => created.json()))
          yield* Effect.addFinalizer(() =>
            execution.interrupt(session.id).pipe(Effect.andThen(sessions.remove(session.id)), Effect.orDie),
          )
          expect(yield* messages(dir, session.id)).toEqual([])
          expect(yield* schedules(dir, session.id)).toEqual([])

          // Assistant's production policy forbids file writes and shell. Its own reminder
          // tool supplies the durable side effect without widening the agent's permissions.
          const reminder = {
            content: "Synthetic recovery reminder",
            dueAt: (yield* DateTime.nowAsDate).getTime() + 3_600_000,
            timezone: "UTC",
          }
          const input = {
            messageID: SessionMessage.ID.create(),
            agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
            model: { providerID: LegacyHistory.providerID, modelID: LegacyHistory.modelID },
            parts: [
              {
                type: "text",
                text: `I confirm the reminder "${reminder.content}" at ${new Date(reminder.dueAt).toISOString()}, timezone UTC, including catch-up after offline. Create it once.`,
              },
            ],
          }
          yield* llm.push(reply().text("Creating the confirmed reminder.").tool("reminder_create", reminder))
          // Fail the continuation only after the real tool result has reached the provider.
          // Ordinary 400 is non-retryable. Three real 503 responses exhaust the executor's
          // initial request plus its two production retries without creating extra turns.
          yield* Effect.forEach(
            Array.from({ length: rejected.attempts }),
            () =>
              llm.error(rejected.status, {
                error: { message: "Synthetic continuation rejected after reminder creation." },
              }),
            { discard: true },
          )
          yield* llm.text("The existing reminder is preserved; no second reminder was created.")

          const admitted = yield* request(dir, `/session/${session.id}/prompt_async`, {
            method: "POST",
            body: JSON.stringify(input),
          })
          expect(admitted.status).toBe(204)
          yield* awaitWithTimeout(
            llm.wait(rejected.attempts + 1),
            "Assistant did not exhaust the post-tool provider attempts",
            "20 seconds",
          )
          const failedMessages = yield* pollWithTimeout(
            Effect.gen(function* () {
              if (yield* execution.isActive(session.id)) return undefined
              const history = yield* messages(dir, session.id)
              const last = history.at(-1)
              if (last?.type !== "assistant" || last.finish !== "error") return undefined
              return history
            }),
            "Assistant provider failure did not settle durably",
            "20 seconds",
          )
          expect(yield* llm.calls).toBe(rejected.attempts + 1)
          expect(yield* llm.pending).toBe(1)
          // admitWithSelection persists the first model choice before promoting the user input.
          expect(failedMessages.map((message) => message.type)).toEqual([
            "model-switched",
            "user",
            "assistant",
            "assistant",
          ])
          expect(failedMessages[0]).toMatchObject({
            type: "model-switched",
            model: { id: LegacyHistory.modelID, providerID: LegacyHistory.providerID },
          })
          expect(failedMessages[1]).toMatchObject({ id: input.messageID, type: "user", text: input.parts[0]?.text })
          const toolTurn = failedMessages[2]
          if (toolTurn?.type !== "assistant") throw new Error("Expected the completed Assistant tool turn")
          expect(toolTurn).toMatchObject({
            agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
            finish: "tool-calls",
            content: [
              { type: "text", text: "Creating the confirmed reminder." },
              { type: "tool", id: "call_1", name: "reminder_create", state: { status: "completed", input: reminder } },
            ],
          })
          expect(toolTurn.time.completed).toBeDefined()
          const failure = failedMessages[3]
          if (failure?.type !== "assistant") throw new Error("Expected a durable failed continuation")
          expect(failure).toMatchObject({ finish: "error", content: [], error: { type: "unknown" } })
          expect(failure.time.completed).toBeDefined()
          expect(failure.error?.message).toContain(`HTTP ${rejected.status}`)
          expect(failure.error?.message).toContain("Synthetic continuation rejected after reminder creation.")

          const saved = yield* schedules(dir, session.id)
          expect(saved).toHaveLength(1)
          expect(saved[0]).toMatchObject({
            ...reminder,
            sessionID: session.id,
            kind: "reminder",
            status: "pending",
            attempts: 0,
          })
          expect(toolTurn.content.find((part) => part.type === "tool")).toMatchObject({
            state: { structured: { id: saved[0]?.id, deliveryKey: saved[0]?.deliveryKey, ...reminder } },
          })
          const failed = yield* LegacyHistory.persistedState(session.id)
          expect(failed.inputs).toHaveLength(1)
          expect(failed.inputs[0]).toMatchObject({ id: input.messageID, session_id: session.id })
          expect(failed.inputs[0]?.promoted_seq).not.toBeNull()
          expect(failed.events.filter((event) => event.type === "session.next.model.switched.1")).toHaveLength(1)
          expect(failed.events.filter((event) => event.type === "session.next.step.started.1")).toHaveLength(2)
          expect(failed.events.filter((event) => event.type === "session.next.step.ended.2")).toHaveLength(1)
          expect(failed.events.filter((event) => event.type === "session.next.step.failed.2")).toHaveLength(1)
          expect(failed.events.filter((event) => event.type === "session.next.tool.called.1")).toHaveLength(1)
          expect(failed.events.filter((event) => event.type === "session.next.tool.success.1")).toHaveLength(1)
          expect(
            failed.events.find((event) => event.type === "session.next.step.failed.2")?.data.assistantMessageID,
          ).toBe(failure.id)
          expect(yield* messages(dir, session.id)).toEqual(failedMessages)
          expect(yield* schedules(dir, session.id)).toEqual(saved)

          const retried = yield* request(dir, `/session/${session.id}/prompt_async`, {
            method: "POST",
            body: JSON.stringify(input),
          })
          expect(retried.status).toBe(204)
          yield* pollWithTimeout(
            execution.isActive(session.id).pipe(Effect.map((active) => (active ? undefined : true))),
            "The exact Assistant HTTP retry did not become idle",
          )
          expect(yield* llm.calls).toBe(rejected.attempts + 1)
          expect(yield* llm.pending).toBe(1)
          expect(yield* messages(dir, session.id)).toEqual(failedMessages)
          expect(yield* LegacyHistory.persistedState(session.id)).toEqual(failed)
          expect(yield* schedules(dir, session.id)).toEqual(saved)

          // There is no public HTTP resume endpoint. Exercise the existing explicit service
          // contract, while creation, admission, retry and persisted readback stay on HTTP.
          yield* awaitWithTimeout(
            sessions.resume(session.id),
            "Explicit Assistant recovery did not finish",
            "20 seconds",
          )
          expect(yield* execution.isActive(session.id)).toBe(false)
          expect(yield* llm.calls).toBe(rejected.attempts + 2)
          expect(yield* llm.pending).toBe(0)
          const recovered = yield* messages(dir, session.id)
          expect(recovered.map((message) => message.type)).toEqual([
            "model-switched",
            "user",
            "assistant",
            "assistant",
            "assistant",
          ])
          expect(recovered.slice(0, 4)).toEqual([...failedMessages])
          expect(recovered[4]).toMatchObject({
            type: "assistant",
            finish: "stop",
            content: [{ type: "text", text: "The existing reminder is preserved; no second reminder was created." }],
          })
          expect(yield* messages(dir, session.id)).toEqual(recovered)
          expect(yield* schedules(dir, session.id)).toEqual(saved)
          const after = yield* LegacyHistory.persistedState(session.id)
          expect(after.inputs).toEqual(failed.inputs)
          expect(after.events.filter((event) => event.type === "session.next.step.started.1")).toHaveLength(3)
          expect(after.events.filter((event) => event.type === "session.next.step.ended.2")).toHaveLength(2)
          expect(after.events.filter((event) => event.type === "session.next.step.failed.2")).toEqual(
            failed.events.filter((event) => event.type === "session.next.step.failed.2"),
          )
          // The schedule's idempotency constraint alone could hide a replay. The unchanged
          // Called/Success identities prove that recovery did not dispatch the tool again.
          expect(after.events.filter((event) => event.type.startsWith("session.next.tool."))).toEqual(
            failed.events.filter((event) => event.type.startsWith("session.next.tool.")),
          )

          const hits = yield* llm.hits
          expect(hits.length).toBe(rejected.attempts + 2)
          expect(hits.map((hit) => hit.url.pathname)).toEqual(Array(rejected.attempts + 2).fill("/v1/chat/completions"))
          const wire = hits.map((hit) => LegacyHistory.decodeMessages(hit.body.messages))
          expect(wire[0]).toEqual([{ role: "user", content: input.parts[0]?.text }])
          expect(wire[1]?.map((message) => message.role)).toEqual(["user", "assistant", "tool"])
          expect(wire[1]?.[1]).toMatchObject({
            role: "assistant",
            content: "Creating the confirmed reminder.",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "reminder_create" } }],
          })
          expect(
            Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(wire[1]?.[1]?.tool_calls?.[0]?.function.arguments),
          ).toEqual(reminder)
          expect(wire[1]?.[2]?.tool_call_id).toBe("call_1")
          expect(wire[1]?.[2]?.content).toContain(reminder.content)
          // Empty failed turns are omitted by the canonical history lowerer; the restored
          // request and every HTTP retry carry the original completed call/result exactly once.
          expect(wire.slice(1)).toEqual(Array(rejected.attempts + 1).fill(wire[1]))

          const evidenceDirectory = process.env.AIGCFROGE_ASSISTANT_RECOVERY_EVIDENCE_DIR
          if (evidenceDirectory) {
            yield* filesystem.makeDirectory(evidenceDirectory, { recursive: true })
            yield* filesystem.writeFileString(
              `${evidenceDirectory}/${rejected.evidence}`,
              JSON.stringify(
                {
                  runtime: { v2: AIGCFROGE_V2_RUNTIME, mode: "assistant", provider: "native-loopback-http" },
                  inbound: "production-httpapi-web-handler",
                  explicitRecovery: "SessionV2.Service.resume (no public HTTP resume endpoint)",
                  sessionID: session.id,
                  rejected: { status: rejected.status, attempts: rejected.attempts },
                  calls: {
                    afterFailure: rejected.attempts + 1,
                    afterExactRetry: rejected.attempts + 1,
                    afterExplicitResume: rejected.attempts + 2,
                  },
                  schedules: saved,
                  canonicalMessages: recovered,
                  events: after.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
                  inputs: after.inputs,
                  requests: hits.map((hit, index) => ({
                    path: hit.url.pathname,
                    model: hit.body.model,
                    stream: hit.body.stream,
                    messages: wire[index],
                  })),
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
}

for (const ending of ["connection reset", "missing finish reason"] as const) {
  it.live(`Assistant HTTP preserves visible partial output after ${ending} and explicit recovery`, () =>
    provideTmpdirServer(
      ({ dir, llm }) =>
        Effect.gen(function* () {
          expect(AIGCFROGE_V2_RUNTIME).toBe(false)
          const sessions = yield* SessionV2.Service
          const execution = yield* SessionExecution.Service
          const created = yield* request(dir, "/session", {
            method: "POST",
            body: JSON.stringify({ mode: "assistant", title: "Assistant partial output recovery" }),
          })
          expect(created.status).toBe(200)
          const session = yield* Schema.decodeUnknownEffect(CreatedSession)(yield* Effect.promise(() => created.json()))
          yield* Effect.addFinalizer(() =>
            execution.interrupt(session.id).pipe(Effect.andThen(sessions.remove(session.id)), Effect.orDie),
          )
          const partial = "This partial Assistant answer arrived before the connection failed."
          const gate = Promise.withResolvers<void>()
          yield* Effect.addFinalizer(() => Effect.sync(() => gate.resolve()))
          const stream =
            ending === "connection reset" ? reply().text(partial).reset().item() : reply().text(partial).item()
          if (stream.type !== "sse") throw new Error("Expected the provider's SSE fixture")
          const events = yield* request(dir, "/event")
          expect(events.status).toBe(200)
          if (!events.body) throw new Error("The production event stream has no body")
          const reader = events.body.getReader()
          yield* Effect.addFinalizer(() => Effect.promise(() => reader.cancel()))
          // Deltas are live-only. Confirm delivery through the actual product SSE
          // stream before breaking the provider; canonical reads test settlement below.
          yield* llm.push({ ...stream, head: [...stream.head, ...stream.tail], tail: [], wait: gate.promise })
          yield* llm.text("Recovered after the partial answer without repeating the prompt.")
          const input = {
            messageID: SessionMessage.ID.create(),
            agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
            model: { providerID: LegacyHistory.providerID, modelID: LegacyHistory.modelID },
            parts: [{ type: "text", text: "Give a synthetic answer that exercises partial output recovery." }],
          }
          const admitted = yield* request(dir, `/session/${session.id}/prompt_async`, {
            method: "POST",
            body: JSON.stringify(input),
          })
          expect(admitted.status).toBe(204)
          yield* awaitWithTimeout(llm.wait(1), "Assistant did not reach the streaming provider", "20 seconds")
          const visible = yield* awaitWithTimeout(
            Effect.promise(() => readPartialDelta(reader, session.id, partial)),
            "Partial Assistant output was not delivered through the product event stream",
            "20 seconds",
          )
          expect(yield* execution.isActive(session.id)).toBe(true)
          yield* Effect.sync(() => gate.resolve())
          const failedMessages = yield* pollWithTimeout(
            Effect.gen(function* () {
              if (yield* execution.isActive(session.id)) return undefined
              return yield* messages(dir, session.id)
            }),
            "The interrupted Assistant stream did not become idle",
            "20 seconds",
          )
          const failed = failedMessages.at(-1)
          if (failed?.type !== "assistant") throw new Error("Expected the failed Assistant message")
          expect({ finish: failed.finish, error: failed.error?.type, calls: yield* llm.calls }).toEqual({
            finish: "error",
            error: "unknown",
            calls: 1,
          })
          if (ending === "missing finish reason") expect(failed.error?.message).toContain("finish_reason")
          expect(failed.id).toBe(visible.assistantMessageID)
          expect(failed.content).toHaveLength(1)
          expect(failed.content[0]).toMatchObject({ type: "text", text: partial, id: visible.textID })
          expect(failed.time.completed).toBeDefined()
          expect(failed.error).toBeDefined()
          expect(failedMessages.filter((message) => message.type === "user").map((message) => message.id)).toEqual([
            input.messageID,
          ])
          const beforeRetry = yield* LegacyHistory.persistedState(session.id)
          expect(beforeRetry.inputs).toHaveLength(1)
          expect(beforeRetry.inputs[0]?.promoted_seq).not.toBeNull()
          expect(beforeRetry.events.filter((event) => event.type === "session.next.step.started.1")).toHaveLength(1)
          expect(beforeRetry.events.filter((event) => event.type === "session.next.step.failed.2")).toHaveLength(1)
          expect(beforeRetry.events.filter((event) => event.type === "session.next.step.ended.2")).toHaveLength(0)
          expect(yield* llm.calls).toBe(1)

          const retried = yield* request(dir, `/session/${session.id}/prompt_async`, {
            method: "POST",
            body: JSON.stringify(input),
          })
          expect(retried.status).toBe(204)
          yield* pollWithTimeout(
            execution.isActive(session.id).pipe(Effect.map((active) => (active ? undefined : true))),
            "The exact partial-output retry did not become idle",
          )
          expect(yield* llm.calls).toBe(1)
          expect(yield* messages(dir, session.id)).toEqual(failedMessages)
          expect(yield* LegacyHistory.persistedState(session.id)).toEqual(beforeRetry)

          yield* awaitWithTimeout(
            sessions.resume(session.id),
            "Explicit partial-output recovery did not finish",
            "20 seconds",
          )
          expect(yield* execution.isActive(session.id)).toBe(false)
          expect(yield* llm.calls).toBe(2)
          expect(yield* llm.pending).toBe(0)
          const recovered = yield* messages(dir, session.id)
          expect(recovered.slice(0, -1)).toEqual([...failedMessages])
          expect(recovered.at(-1)).toMatchObject({
            type: "assistant",
            finish: "stop",
            content: [{ type: "text", text: "Recovered after the partial answer without repeating the prompt." }],
          })
          const after = yield* LegacyHistory.persistedState(session.id)
          expect(after.inputs).toEqual(beforeRetry.inputs)
          expect(after.events.filter((event) => event.type === "session.next.step.started.1")).toHaveLength(2)
          expect(after.events.filter((event) => event.type === "session.next.step.ended.2")).toHaveLength(1)
          expect(after.events.filter((event) => event.type === "session.next.step.failed.2")).toEqual(
            beforeRetry.events.filter((event) => event.type === "session.next.step.failed.2"),
          )
          expect(after.events.filter((event) => event.type.startsWith("session.next.tool."))).toEqual([])
          const hits = yield* llm.hits
          expect(hits.map((hit) => hit.url.pathname)).toEqual(Array(2).fill("/v1/chat/completions"))
          expect(LegacyHistory.decodeMessages(hits[1]?.body.messages)).toEqual([
            { role: "user", content: input.parts[0]?.text },
            { role: "assistant", content: partial },
          ])
          expect(yield* messages(dir, session.id)).toEqual(recovered)
        }),
      { config: LegacyHistory.providerConfig },
    ),
  )
}

function request(directory: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
  if (init.body !== undefined) headers.set("content-type", "application/json")
  return Effect.promise(() => Promise.resolve(Server.Default().app.request(path, { ...init, headers })))
}

async function readPartialDelta(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  sessionID: SessionV2.ID,
  text: string,
) {
  const decoder = new TextDecoder()
  let buffered = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error("The product event stream ended before the partial answer")
    buffered += decoder.decode(chunk.value, { stream: true })
    const frames = buffered.split("\n\n")
    buffered = frames.pop() ?? ""
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
      if (!data) continue
      const value = Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(data)
      if (
        typeof value !== "object" ||
        value === null ||
        !("type" in value) ||
        value.type !== SessionEvent.Text.Delta.type
      )
        continue
      const event = Schema.decodeUnknownSync(Schema.toCodecJson(DeltaEnvelope))(value)
      if (event.properties.sessionID === sessionID && event.properties.delta === text) return event.properties
    }
  }
}

const messages = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID) {
  const response = yield* request(directory, `/api/session/${sessionID}/message?order=asc`)
  expect(response.status).toBe(200)
  return (yield* Schema.decodeUnknownEffect(Schema.toCodecJson(MessagesResponse))(
    yield* Effect.promise(() => response.json()),
  )).data
})

const schedules = Effect.fnUntraced(function* (directory: string, sessionID: SessionV2.ID) {
  const response = yield* request(directory, `/schedule/${sessionID}`)
  expect(response.status).toBe(200)
  return yield* Schema.decodeUnknownEffect(Schema.Array(Schedule.Info))(yield* Effect.promise(() => response.json()))
})
