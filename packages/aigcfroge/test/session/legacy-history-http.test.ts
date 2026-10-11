import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { asc, eq } from "drizzle-orm"
import { Context, Deferred, Effect, FileSystem, Layer, Schema } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventTable } from "@aigcfroge/core/event/sql"
import { ModelV2 } from "@aigcfroge/core/model"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { MessageTable, PartTable, SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { ConfigV1 } from "@aigcfroge/core/v1/config/config"
import { MessageID, PartID, SessionV1 } from "@aigcfroge/core/v1/session"
import { AIGCFROGE_V2_RUNTIME, AppLayer } from "../../src/effect/app-runtime"
import { EffectBridge } from "../../src/effect/bridge"
import { provideTmpdirServer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const it = testEffect(Layer.mergeAll(AppLayer, TestLLMServer.layer, NodeFileSystem.layer))
const providerID = ProviderV2.ID.make("history-http")
const modelID = ModelV2.ID.make("history-model")
const historicalUsage = {
  cost: 2,
  tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
}
class WireFunction extends Schema.Class<WireFunction>("LegacyHistory.WireFunction")({
  name: Schema.String,
  arguments: Schema.String,
}) {}

class WireToolCall extends Schema.Class<WireToolCall>("LegacyHistory.WireToolCall")({
  id: Schema.String,
  type: Schema.String,
  function: WireFunction,
}) {}

class WireMessage extends Schema.Class<WireMessage>("LegacyHistory.WireMessage")({
  role: Schema.String,
  content: Schema.optional(Schema.NullOr(Schema.String)),
  tool_call_id: Schema.optional(Schema.String),
  tool_calls: Schema.optional(Schema.Array(WireToolCall)),
}) {}

function decodeMessages(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Provider request must contain a messages array")
  // Remove privileged context before parsing so decoder failures cannot print it.
  return Schema.decodeUnknownSync(Schema.Array(WireMessage))(
    value.filter(
      (message) =>
        !(
          typeof message === "object" &&
          message !== null &&
          "role" in message &&
          (message.role === "system" || message.role === "developer")
        ),
    ),
  )
}

it.live("adopted Assistant history reaches native HTTP once without replaying tools or billing", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        expect(AIGCFROGE_V2_RUNTIME).toBe(false)
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const filesystem = yield* FileSystem.FileSystem
        const seeded = yield* seedLegacyTranscript(dir)
        yield* Effect.addFinalizer(() =>
          execution.interrupt(seeded.sessionID).pipe(Effect.andThen(sessions.remove(seeded.sessionID)), Effect.orDie),
        )
        const before = yield* persistedState(seeded.sessionID)
        const input = {
          id: SessionMessage.ID.make("msg_history_http_continue"),
          sessionID: seeded.sessionID,
          prompt: { text: "Continue from the historical answer." },
        }

        yield* llm.text("The imported history is available.", { usage: { input: 7, output: 3 } })
        const admitted = yield* sessions.prompt({ ...input, resume: false })
        expect(yield* llm.calls).toBe(0)
        const adopted = yield* sessions.messages({ sessionID: seeded.sessionID, order: "asc" })
        expect(adopted.map((message) => message.id)).toEqual([
          SessionMessage.ID.make(seeded.user),
          SessionMessage.ID.make(seeded.assistant),
        ])
        expect(adopted[1]).toMatchObject({ type: "assistant", ...historicalUsage })
        const imported = yield* persistedState(seeded.sessionID)
        expect(imported.source).toEqual(before.source)
        expect(imported.usage).toEqual(before.usage)
        expect(imported.events.map((event) => event.type)).toEqual([
          "session.next.history.imported.1",
          "session.next.history.imported.1",
          "session.next.prompt.admitted.1",
        ])
        expect(imported.inputs).toHaveLength(1)
        expect(imported.inputs[0]).toMatchObject({ id: input.id, promoted_seq: null })

        yield* awaitWithTimeout(sessions.resume(seeded.sessionID), "Native history turn did not finish", "20 seconds")
        expect(yield* execution.isActive(seeded.sessionID)).toBe(false)
        const hits = yield* llm.hits
        expect(hits.length).toBe(1)
        expect(hits[0]?.url.pathname).toBe("/v1/chat/completions")
        expect({ model: hits[0]?.body.model, stream: hits[0]?.body.stream }).toEqual({ model: modelID, stream: true })
        // Inspect the actual provider body; privileged environment context is not fixture history.
        const messages = decodeMessages(hits[0]?.body.messages)
        expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "tool", "user"])
        expect(messages[0]).toEqual({ role: "user", content: "Historical question." })
        expect(messages[1]).toEqual({
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
        })
        expect(messages[2]).toEqual({
          role: "tool",
          tool_call_id: "history-completed-call",
          content: "Historical tool output.",
        })
        expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "history-pending-call" })
        expect(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(messages[3]?.content)).toEqual({
          error: { type: "unknown", message: "[Tool execution was interrupted]" },
          content: [],
          structured: {},
        })
        expect(messages[4]).toEqual({ role: "user", content: input.prompt.text })
        expect(JSON.stringify(messages)).not.toContain("private-tool-metadata")
        expect(yield* llm.pending).toBe(0)

        const completed = yield* sessions.messages({ sessionID: seeded.sessionID, order: "asc" })
        expect(completed).toHaveLength(4)
        expect(completed.slice(0, 2)).toEqual(adopted)
        expect(completed[2]).toMatchObject({ id: input.id, type: "user", text: input.prompt.text })
        expect(completed[3]).toMatchObject({
          type: "assistant",
          agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
          finish: "stop",
          content: [{ type: "text", text: "The imported history is available." }],
          tokens: { input: 7, output: 3 },
        })
        const after = yield* persistedState(seeded.sessionID)
        expect(after.source).toEqual(before.source)
        expect(after.events.filter((event) => event.type === "session.next.history.imported.1")).toHaveLength(2)
        expect(after.events.filter((event) => event.type === "session.next.step.started.1")).toHaveLength(1)
        expect(after.events.filter((event) => event.type.startsWith("session.next.tool."))).toEqual([])
        expect(after.inputs).toHaveLength(1)
        expect(after.inputs[0]?.promoted_seq).not.toBeNull()
        expect(yield* filesystem.exists(seeded.completedInput.filePath)).toBe(false)
        expect(yield* filesystem.exists(seeded.pendingInput.filePath)).toBe(false)

        // An advisory retry drains no work. Calling resume here would force a new provider turn.
        const retried = yield* sessions.prompt(input)
        expect(retried.id).toBe(admitted.id)
        expect(retried.admittedSeq).toBe(admitted.admittedSeq)
        yield* pollWithTimeout(
          execution.isActive(seeded.sessionID).pipe(Effect.map((active) => (active ? undefined : true))),
          "Exact retry did not become idle",
        )
        expect(yield* llm.calls).toBe(1)
        expect(yield* persistedState(seeded.sessionID)).toEqual(after)

        const conflicts = [
          { ...input, prompt: { text: "A different prompt." } },
          { ...input, delivery: "queue" as const },
        ]
        yield* Effect.forEach(conflicts, (conflict) =>
          Effect.gen(function* () {
            const rejected = yield* sessions.prompt(conflict).pipe(
              Effect.as(false),
              Effect.catchTag("Session.PromptConflictError", () => Effect.succeed(true)),
            )
            expect(rejected).toBe(true)
          }),
        )
        expect(yield* llm.calls).toBe(1)
        expect(yield* persistedState(seeded.sessionID)).toEqual(after)

        const evidenceDirectory = process.env.AIGCFROGE_HISTORY_HTTP_EVIDENCE_DIR
        if (evidenceDirectory) {
          // Persist only the synthetic transcript; omit privileged context, tool definitions and authentication.
          yield* filesystem.makeDirectory(evidenceDirectory, { recursive: true })
          yield* filesystem.writeFileString(
            `${evidenceDirectory}/history-http.json`,
            JSON.stringify(
              {
                runtime: { v2: AIGCFROGE_V2_RUNTIME, mode: "assistant", transport: "native-loopback-http" },
                requests: hits.map((hit) => ({
                  path: hit.url.pathname,
                  receivedBodySha256: digest(hit.body),
                  model: hit.body.model,
                  stream: hit.body.stream,
                  messages,
                })),
                canonicalMessages: completed,
                importedEvents: imported.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
                finalEvents: after.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
                inputs: after.inputs,
                usage: { before: before.usage, afterImport: imported.usage },
                source: { beforeSha256: digest(before.source), afterSha256: digest(after.source) },
                toolReplayFiles: {
                  completed: yield* filesystem.exists(seeded.completedInput.filePath),
                  pending: yield* filesystem.exists(seeded.pendingInput.filePath),
                },
                callsAfterRetryAndConflicts: yield* llm.calls,
              },
              null,
              2,
            ) + "\n",
          )
        }
      }),
    { config: providerConfig },
  ),
)

it.live("a failed native history turn requires explicit resume after an exact prompt retry", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        expect(AIGCFROGE_V2_RUNTIME).toBe(false)
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const filesystem = yield* FileSystem.FileSystem
        const seeded = yield* seedLegacyTranscript(dir, "_failure")
        yield* Effect.addFinalizer(() =>
          execution.interrupt(seeded.sessionID).pipe(Effect.andThen(sessions.remove(seeded.sessionID)), Effect.orDie),
        )
        const before = yield* persistedState(seeded.sessionID)
        const input = {
          id: SessionMessage.ID.make("msg_history_http_failure_continue"),
          sessionID: seeded.sessionID,
          prompt: { text: "Continue this history after the provider recovers." },
        }

        // This plain HTTP 400 is non-retryable and does not describe context overflow.
        yield* llm.error(400, { error: { message: "Synthetic history request rejected." } })
        yield* llm.text("The explicit resume recovered.", { usage: { input: 9, output: 4 } })
        const admitted = yield* sessions.prompt({ ...input, resume: false })
        const adopted = yield* sessions.messages({ sessionID: seeded.sessionID, order: "asc" })
        const imported = yield* persistedState(seeded.sessionID)
        expect(imported.source).toEqual(before.source)
        expect(imported.usage).toEqual(before.usage)
        expect(yield* llm.calls).toBe(0)

        const failure = yield* awaitWithTimeout(
          sessions.resume(seeded.sessionID).pipe(
            Effect.asVoid,
            Effect.catchTag("LLM.Error", (error) =>
              Effect.succeed({
                type: error._tag,
                reason: error.reason._tag,
                retryable: error.retryable,
                status: "http" in error.reason ? error.reason.http?.response?.status : undefined,
              }),
            ),
          ),
          "Native history failure did not settle",
          "20 seconds",
        )
        expect(failure).toEqual({ type: "LLM.Error", reason: "InvalidRequest", retryable: false, status: 400 })
        expect(yield* execution.isActive(seeded.sessionID)).toBe(false)
        expect(yield* llm.calls).toBe(1)
        expect(yield* llm.pending).toBe(1)
        const failedMessages = yield* sessions.messages({ sessionID: seeded.sessionID, order: "asc" })
        expect(failedMessages).toHaveLength(4)
        expect(failedMessages.slice(0, 2)).toEqual(adopted)
        expect(failedMessages[2]).toMatchObject({ id: input.id, type: "user", text: input.prompt.text })
        expect(failedMessages[3]).toMatchObject({
          type: "assistant",
          agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
          finish: "error",
          content: [],
          error: { type: "unknown" },
        })
        const failedAssistant = failedMessages[3]
        if (failedAssistant?.type !== "assistant") throw new Error("Expected a durable failed assistant turn")
        expect(failedAssistant.time.completed).toBeDefined()
        expect(failedAssistant.error?.message).toContain("HTTP 400")
        expect(failedAssistant.error?.message).toContain("Synthetic history request rejected.")
        const failed = yield* persistedState(seeded.sessionID)
        expect(failed.source).toEqual(before.source)
        expect(failed.events.map((event) => event.type)).toEqual([
          "session.next.history.imported.1",
          "session.next.history.imported.1",
          "session.next.prompt.admitted.1",
          "session.next.prompted.1",
          "session.next.step.started.1",
          "session.next.step.failed.2",
        ])
        expect(failed.events.at(-1)?.data.assistantMessageID).toBe(failedAssistant.id)
        expect(failed.inputs).toHaveLength(1)
        expect(failed.inputs[0]?.promoted_seq).not.toBeNull()

        // An exact retry has no pending input left to promote, even after provider failure.
        const retried = yield* sessions.prompt(input)
        expect(retried.id).toBe(admitted.id)
        expect(retried.admittedSeq).toBe(admitted.admittedSeq)
        yield* pollWithTimeout(
          execution.isActive(seeded.sessionID).pipe(Effect.map((active) => (active ? undefined : true))),
          "Failed-turn exact retry did not become idle",
        )
        const callsAfterRetry = yield* llm.calls
        expect(callsAfterRetry).toBe(1)
        expect(yield* llm.pending).toBe(1)
        expect(yield* persistedState(seeded.sessionID)).toEqual(failed)
        expect(yield* sessions.messages({ sessionID: seeded.sessionID, order: "asc" })).toEqual(failedMessages)

        yield* awaitWithTimeout(
          sessions.resume(seeded.sessionID),
          "Explicit history resume did not finish",
          "20 seconds",
        )
        expect(yield* execution.isActive(seeded.sessionID)).toBe(false)
        const hits = yield* llm.hits
        expect(hits.length).toBe(2)
        expect(hits.map((hit) => hit.url.pathname)).toEqual(["/v1/chat/completions", "/v1/chat/completions"])
        expect(hits.map((hit) => ({ model: hit.body.model, stream: hit.body.stream }))).toEqual([
          { model: modelID, stream: true },
          { model: modelID, stream: true },
        ])
        const messages = hits.map((hit) => decodeMessages(hit.body.messages))
        expect(messages[0]?.map((message) => message.role)).toEqual(["user", "assistant", "tool", "tool", "user"])
        expect(messages[0]?.[0]).toEqual({ role: "user", content: "Historical question." })
        expect(messages[0]?.[1]).toMatchObject({ role: "assistant", content: "Historical answer." })
        expect(messages[0]?.[1]?.tool_calls?.map((call) => call.id)).toEqual([
          "history-completed-call",
          "history-pending-call",
        ])
        expect(messages[0]?.[2]).toEqual({
          role: "tool",
          tool_call_id: "history-completed-call",
          content: "Historical tool output.",
        })
        expect(messages[0]?.[3]?.content).toContain("[Tool execution was interrupted]")
        expect(messages[0]?.[4]).toEqual({ role: "user", content: input.prompt.text })
        // The empty failed assistant remains durable but has no provider-visible content.
        expect(messages[1]).toEqual(messages[0])
        expect(yield* llm.pending).toBe(0)
        const completed = yield* sessions.messages({ sessionID: seeded.sessionID, order: "asc" })
        expect(completed).toHaveLength(5)
        expect(completed.slice(0, 4)).toEqual(failedMessages)
        expect(completed[4]).toMatchObject({
          type: "assistant",
          agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
          finish: "stop",
          content: [{ type: "text", text: "The explicit resume recovered." }],
          tokens: { input: 9, output: 4 },
        })
        const after = yield* persistedState(seeded.sessionID)
        expect(after.source).toEqual(before.source)
        expect(after.inputs).toEqual(failed.inputs)
        expect(after.events.filter((event) => event.type === "session.next.history.imported.1")).toHaveLength(2)
        expect(after.events.filter((event) => event.type === "session.next.step.started.1")).toHaveLength(2)
        expect(after.events.filter((event) => event.type === "session.next.step.failed.2")).toHaveLength(1)
        expect(after.events.filter((event) => event.type === "session.next.step.ended.2")).toHaveLength(1)
        expect(after.events.filter((event) => event.type.startsWith("session.next.tool."))).toEqual([])
        expect(yield* filesystem.exists(seeded.completedInput.filePath)).toBe(false)
        expect(yield* filesystem.exists(seeded.pendingInput.filePath)).toBe(false)

        const evidenceDirectory = process.env.AIGCFROGE_HISTORY_HTTP_EVIDENCE_DIR
        if (evidenceDirectory) {
          yield* filesystem.makeDirectory(evidenceDirectory, { recursive: true })
          yield* filesystem.writeFileString(
            `${evidenceDirectory}/history-http-failure.json`,
            JSON.stringify(
              {
                runtime: { v2: AIGCFROGE_V2_RUNTIME, mode: "assistant", transport: "native-loopback-http" },
                failure,
                requests: hits.map((hit, index) => ({
                  path: hit.url.pathname,
                  receivedBodySha256: digest(hit.body),
                  model: hit.body.model,
                  stream: hit.body.stream,
                  messages: messages[index],
                })),
                failedMessages,
                canonicalMessages: completed,
                failedEvents: failed.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
                finalEvents: after.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
                inputs: after.inputs,
                usage: { before: before.usage, afterImport: imported.usage },
                source: { beforeSha256: digest(before.source), afterSha256: digest(after.source) },
                callsAfterRetry,
                callsAfterExplicitResume: hits.length,
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
    { config: providerConfig },
  ),
)

it.live("Assistant Locations isolate native HTTP endpoints and history while another Session is blocked", () =>
  Effect.gen(function* () {
    expect(AIGCFROGE_V2_RUNTIME).toBe(false)
    const sessions = yield* SessionV2.Service
    const execution = yield* SessionExecution.Service
    const filesystem = yield* FileSystem.FileSystem
    const first = yield* TestLLMServer
    // Separate fixture servers share the same production AppLayer and execution owner.
    const peerContext = yield* Layer.buildWithMemoMap(
      TestLLMServer.layer,
      yield* Layer.makeMemoMap,
      yield* Effect.scope,
    )
    const second = Context.get(peerContext, TestLLMServer)
    expect(first.url).not.toBe(second.url)
    const leftDirectory = yield* tmpdirScoped({ config: providerConfig(first.url) })
    const rightDirectory = yield* tmpdirScoped({ config: providerConfig(second.url) })
    const left = yield* Effect.acquireRelease(
      sessions.create({
        location: { directory: AbsolutePath.make(leftDirectory) },
        mode: "assistant",
        title: "Left Location fixture",
        model: { id: modelID, providerID },
      }),
      (session) => execution.interrupt(session.id).pipe(Effect.andThen(sessions.remove(session.id)), Effect.orDie),
    )
    const right = yield* Effect.acquireRelease(
      sessions.create({
        location: { directory: AbsolutePath.make(rightDirectory) },
        mode: "assistant",
        title: "Right Location fixture",
        model: { id: modelID, providerID },
      }),
      (session) => execution.interrupt(session.id).pipe(Effect.andThen(sessions.remove(session.id)), Effect.orDie),
    )
    const release = yield* Deferred.make<void>()
    // The HTTP fixture accepts a Promise. Release it before Session and server finalizers, including on failure.
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    const bridge = yield* EffectBridge.make()
    yield* first.hold("Left Location first response.", bridge.promise(Deferred.await(release)))
    const leftAdmission = yield* sessions.prompt({
      sessionID: left.id,
      prompt: { text: "Left Location first input." },
    })
    yield* awaitWithTimeout(first.wait(1), "Left Location did not reach its provider", "20 seconds")
    expect(yield* execution.isActive(left.id)).toBe(true)

    yield* second.text("Right Location response.")
    const rightAdmission = yield* sessions.prompt({
      sessionID: right.id,
      prompt: { text: "Right Location input." },
    })
    yield* awaitWithTimeout(second.wait(1), "Right Location did not reach its provider", "20 seconds")
    yield* pollWithTimeout(
      execution.isActive(right.id).pipe(Effect.map((active) => (active ? undefined : true))),
      "Right Session did not complete while the left provider was held",
    )
    expect(yield* execution.isActive(left.id)).toBe(true)
    const rightCompleted = yield* sessions.messages({ sessionID: right.id, order: "asc" })
    expect(rightCompleted).toHaveLength(2)
    expect(rightCompleted[0]).toMatchObject({ id: rightAdmission.id, type: "user", text: "Right Location input." })
    expect(rightCompleted[1]).toMatchObject({
      type: "assistant",
      finish: "stop",
      content: [{ type: "text", text: "Right Location response." }],
    })
    const rightState = yield* persistedState(right.id)

    yield* Deferred.succeed(release, undefined)
    yield* pollWithTimeout(
      execution.isActive(left.id).pipe(Effect.map((active) => (active ? undefined : true))),
      "Left Session did not settle after its provider was released",
    )
    const leftFirst = yield* sessions.messages({ sessionID: left.id, order: "asc" })
    expect(leftFirst).toHaveLength(2)
    expect(leftFirst[0]).toMatchObject({ id: leftAdmission.id, type: "user", text: "Left Location first input." })
    expect(leftFirst[1]).toMatchObject({
      type: "assistant",
      finish: "stop",
      content: [{ type: "text", text: "Left Location first response." }],
    })

    yield* first.text("Left Location continued response.")
    const continued = yield* sessions.prompt({
      sessionID: left.id,
      prompt: { text: "Left Location follow-up input." },
    })
    yield* awaitWithTimeout(first.wait(2), "Left continuation did not return to its provider", "20 seconds")
    yield* pollWithTimeout(
      execution.isActive(left.id).pipe(Effect.map((active) => (active ? undefined : true))),
      "Left continuation did not complete",
    )
    const leftHits = yield* first.hits
    const rightHits = yield* second.hits
    expect(leftHits.length).toBe(2)
    expect(rightHits.length).toBe(1)
    expect([...leftHits, ...rightHits].map((hit) => ({ path: hit.url.pathname, model: hit.body.model }))).toEqual([
      { path: "/v1/chat/completions", model: modelID },
      { path: "/v1/chat/completions", model: modelID },
      { path: "/v1/chat/completions", model: modelID },
    ])
    const leftWire = leftHits.map((hit) => decodeMessages(hit.body.messages))
    const rightWire = rightHits.map((hit) => decodeMessages(hit.body.messages))
    expect(leftWire).toEqual([
      [{ role: "user", content: "Left Location first input." }],
      [
        { role: "user", content: "Left Location first input." },
        { role: "assistant", content: "Left Location first response." },
        { role: "user", content: "Left Location follow-up input." },
      ],
    ])
    expect(rightWire).toEqual([[{ role: "user", content: "Right Location input." }]])
    const leftCompleted = yield* sessions.messages({ sessionID: left.id, order: "asc" })
    expect(leftCompleted).toHaveLength(4)
    expect(leftCompleted.slice(0, 2)).toEqual(leftFirst)
    expect(leftCompleted[2]).toMatchObject({ id: continued.id, type: "user", text: "Left Location follow-up input." })
    expect(leftCompleted[3]).toMatchObject({
      type: "assistant",
      finish: "stop",
      content: [{ type: "text", text: "Left Location continued response." }],
    })
    expect(yield* sessions.messages({ sessionID: right.id, order: "asc" })).toEqual(rightCompleted)
    expect(yield* persistedState(right.id)).toEqual(rightState)
    expect((yield* sessions.get(left.id)).location.directory).toBe(AbsolutePath.make(leftDirectory))
    expect((yield* sessions.get(right.id)).location.directory).toBe(AbsolutePath.make(rightDirectory))
    const leftState = yield* persistedState(left.id)
    expect(leftState.inputs.map((input) => input.id)).toEqual([leftAdmission.id, continued.id])
    expect(rightState.inputs.map((input) => input.id)).toEqual([rightAdmission.id])
    expect([...leftState.inputs, ...rightState.inputs].every((input) => input.promoted_seq !== null)).toBe(true)
    expect(leftState.events.filter((event) => event.type === "session.next.step.ended.2")).toHaveLength(2)
    expect(rightState.events.filter((event) => event.type === "session.next.step.ended.2")).toHaveLength(1)
    expect(yield* first.pending).toBe(0)
    expect(yield* second.pending).toBe(0)

    const evidenceDirectory = process.env.AIGCFROGE_HISTORY_HTTP_EVIDENCE_DIR
    if (evidenceDirectory) {
      yield* filesystem.makeDirectory(evidenceDirectory, { recursive: true })
      yield* filesystem.writeFileString(
        `${evidenceDirectory}/assistant-location-http.json`,
        JSON.stringify(
          {
            runtime: { v2: AIGCFROGE_V2_RUNTIME, mode: "assistant", transport: "native-loopback-http" },
            sharedSelection: { providerID, modelID },
            left: {
              directory: leftDirectory,
              providerURL: first.url,
              sessionID: left.id,
              requests: leftWire,
              canonicalMessages: leftCompleted,
              inputs: leftState.inputs,
              events: leftState.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
            },
            right: {
              directory: rightDirectory,
              providerURL: second.url,
              sessionID: right.id,
              requests: rightWire,
              canonicalMessages: rightCompleted,
              inputs: rightState.inputs,
              events: rightState.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
            },
            overlap: "Right Session completed while the left provider response was held",
          },
          null,
          2,
        ) + "\n",
      )
    }
  }),
)

function digest(value: unknown) {
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex")
}

function providerConfig(url: string) {
  return {
    model: `${providerID}/${modelID}`,
    provider: {
      [providerID]: {
        name: "History HTTP fixture",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: url, apiKey: "synthetic-history-key" },
        models: {
          [modelID]: {
            name: "History fixture model",
            tool_call: true,
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
          },
        },
      },
    },
  } satisfies Partial<ConfigV1.Info>
}

// Seed durable V1 rows directly so the canonical reader, rather than a test converter, adopts them.
const seedLegacyTranscript = Effect.fnUntraced(function* (directory: string, suffix = "") {
  const db = (yield* Database.Service).db
  const sessionID = SessionV2.ID.make(`ses_history_http${suffix}`)
  const user = MessageID.make(`msg_history_http_old_user${suffix}`)
  const assistant = MessageID.make(`msg_history_http_old_assistant${suffix}`)
  const completedInput = { filePath: `${directory}/completed-replay.txt`, content: "Unexpected historical replay." }
  const pendingInput = { filePath: `${directory}/pending-replay.txt`, content: "Unexpected pending replay." }
  yield* db
    .insert(ProjectTable)
    .values({
      id: Project.ID.global,
      worktree: AbsolutePath.make(directory),
      sandboxes: [],
    })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      mode: "assistant",
      slug: "history-http",
      directory: AbsolutePath.make(directory),
      title: "Existing Assistant history",
      version: "test",
      time_created: 1,
      time_updated: 3,
      agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
      model: { id: modelID, providerID },
      cost: historicalUsage.cost,
      tokens_input: historicalUsage.tokens.input,
      tokens_output: historicalUsage.tokens.output,
    })
    .run()
    .pipe(Effect.orDie)
  // Insert out of order: the importer owns chronology, not fixture insertion order or lexical IDs.
  yield* db
    .insert(MessageTable)
    .values([
      {
        id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({
            role: "assistant",
            parentID: user,
            agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
            mode: "assistant",
            providerID,
            modelID,
            path: { cwd: directory, root: directory },
            time: { created: 2, completed: 3 },
            ...historicalUsage,
            finish: "stop",
          } satisfies Omit<SessionV1.Assistant, "id" | "sessionID">),
        },
      },
      {
        id: user,
        session_id: sessionID,
        time_created: 1,
        time_updated: 1,
        data: {
          ...({
            role: "user",
            agent: ProductModeAgentPolicy.ASSISTANT_ORCHESTRATOR,
            model: { providerID, modelID },
            time: { created: 1 },
          } satisfies Omit<SessionV1.User, "id" | "sessionID">),
        },
      },
    ])
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(PartTable)
    .values([
      {
        id: PartID.make(`prt_history_http_1${suffix}`),
        message_id: user,
        session_id: sessionID,
        time_created: 1,
        time_updated: 1,
        data: {
          ...({ type: "text", text: "Historical question." } satisfies Omit<
            SessionV1.TextPart,
            "id" | "sessionID" | "messageID"
          >),
        },
      },
      {
        id: PartID.make(`prt_history_http_2${suffix}`),
        message_id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({ type: "text", text: "Historical answer." } satisfies Omit<
            SessionV1.TextPart,
            "id" | "sessionID" | "messageID"
          >),
        },
      },
      {
        id: PartID.make(`prt_history_http_3${suffix}`),
        message_id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({
            type: "tool",
            callID: "history-completed-call",
            tool: "write",
            state: {
              status: "completed",
              input: completedInput,
              output: "Historical tool output.",
              title: "Historical write",
              metadata: { title: "private-tool-metadata" },
              time: { start: 2, end: 3 },
            },
          } satisfies Omit<SessionV1.ToolPart, "id" | "sessionID" | "messageID">),
        },
      },
      {
        id: PartID.make(`prt_history_http_4${suffix}`),
        message_id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({
            type: "tool",
            callID: "history-pending-call",
            tool: "write",
            state: { status: "pending", input: pendingInput, raw: JSON.stringify(pendingInput) },
          } satisfies Omit<SessionV1.ToolPart, "id" | "sessionID" | "messageID">),
        },
      },
    ])
    .run()
    .pipe(Effect.orDie)
  return { sessionID, user, assistant, completedInput, pendingInput }
})

const persistedState = Effect.fnUntraced(function* (sessionID: SessionV2.ID) {
  const db = (yield* Database.Service).db
  const messages = yield* db
    .select()
    .from(MessageTable)
    .where(eq(MessageTable.session_id, sessionID))
    .orderBy(asc(MessageTable.id))
    .all()
    .pipe(Effect.orDie)
  const parts = yield* db
    .select()
    .from(PartTable)
    .where(eq(PartTable.session_id, sessionID))
    .orderBy(asc(PartTable.id))
    .all()
    .pipe(Effect.orDie)
  const usage = yield* db
    .select({
      cost: SessionTable.cost,
      input: SessionTable.tokens_input,
      output: SessionTable.tokens_output,
      reasoning: SessionTable.tokens_reasoning,
      cacheRead: SessionTable.tokens_cache_read,
      cacheWrite: SessionTable.tokens_cache_write,
    })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  const events = yield* db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(Effect.orDie)
  const inputs = yield* db
    .select()
    .from(SessionInputTable)
    .where(eq(SessionInputTable.session_id, sessionID))
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return { source: { messages, parts }, usage, events, inputs }
})
