import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Context, Deferred, Effect, FileSystem, Layer, Schema } from "effect"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { AIGCFROGE_V2_RUNTIME, AppLayer } from "../../src/effect/app-runtime"
import { EffectBridge } from "../../src/effect/bridge"
import { provideTmpdirServer, tmpdirScoped } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { LegacyHistory } from "../lib/legacy-history"

const it = testEffect(Layer.mergeAll(AppLayer, TestLLMServer.layer, NodeFileSystem.layer))
it.live("adopted Assistant history reaches native HTTP once without replaying tools or billing", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        expect(AIGCFROGE_V2_RUNTIME).toBe(false)
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const filesystem = yield* FileSystem.FileSystem
        const seeded = yield* LegacyHistory.seedLegacyTranscript(dir)
        yield* Effect.addFinalizer(() =>
          execution.interrupt(seeded.sessionID).pipe(Effect.andThen(sessions.remove(seeded.sessionID)), Effect.orDie),
        )
        const before = yield* LegacyHistory.persistedState(seeded.sessionID)
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
        expect(adopted[1]).toMatchObject({ type: "assistant", ...LegacyHistory.historicalUsage })
        const imported = yield* LegacyHistory.persistedState(seeded.sessionID)
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
        expect({ model: hits[0]?.body.model, stream: hits[0]?.body.stream }).toEqual({
          model: LegacyHistory.modelID,
          stream: true,
        })
        // Inspect the actual provider body; privileged environment context is not fixture history.
        const messages = LegacyHistory.decodeMessages(hits[0]?.body.messages)
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
        const after = yield* LegacyHistory.persistedState(seeded.sessionID)
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
        expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(after)

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
        expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(after)

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
                  receivedBodySha256: LegacyHistory.digest(hit.body),
                  model: hit.body.model,
                  stream: hit.body.stream,
                  messages,
                })),
                canonicalMessages: completed,
                importedEvents: imported.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
                finalEvents: after.events.map((event) => ({ id: event.id, type: event.type, seq: event.seq })),
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
                callsAfterRetryAndConflicts: yield* llm.calls,
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

it.live("a failed native history turn requires explicit resume after an exact prompt retry", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        expect(AIGCFROGE_V2_RUNTIME).toBe(false)
        const sessions = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const filesystem = yield* FileSystem.FileSystem
        const seeded = yield* LegacyHistory.seedLegacyTranscript(dir, "_failure")
        yield* Effect.addFinalizer(() =>
          execution.interrupt(seeded.sessionID).pipe(Effect.andThen(sessions.remove(seeded.sessionID)), Effect.orDie),
        )
        const before = yield* LegacyHistory.persistedState(seeded.sessionID)
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
        const imported = yield* LegacyHistory.persistedState(seeded.sessionID)
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
        const failed = yield* LegacyHistory.persistedState(seeded.sessionID)
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
        expect(yield* LegacyHistory.persistedState(seeded.sessionID)).toEqual(failed)
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
          { model: LegacyHistory.modelID, stream: true },
          { model: LegacyHistory.modelID, stream: true },
        ])
        const messages = hits.map((hit) => LegacyHistory.decodeMessages(hit.body.messages))
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
        const after = yield* LegacyHistory.persistedState(seeded.sessionID)
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
                  receivedBodySha256: LegacyHistory.digest(hit.body),
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
                source: {
                  beforeSha256: LegacyHistory.digest(before.source),
                  afterSha256: LegacyHistory.digest(after.source),
                },
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
    { config: LegacyHistory.providerConfig },
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
    const leftDirectory = yield* tmpdirScoped({ config: LegacyHistory.providerConfig(first.url) })
    const rightDirectory = yield* tmpdirScoped({ config: LegacyHistory.providerConfig(second.url) })
    const left = yield* Effect.acquireRelease(
      sessions.create({
        location: { directory: AbsolutePath.make(leftDirectory) },
        mode: "assistant",
        title: "Left Location fixture",
        model: { id: LegacyHistory.modelID, providerID: LegacyHistory.providerID },
      }),
      (session) => execution.interrupt(session.id).pipe(Effect.andThen(sessions.remove(session.id)), Effect.orDie),
    )
    const right = yield* Effect.acquireRelease(
      sessions.create({
        location: { directory: AbsolutePath.make(rightDirectory) },
        mode: "assistant",
        title: "Right Location fixture",
        model: { id: LegacyHistory.modelID, providerID: LegacyHistory.providerID },
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
    const rightState = yield* LegacyHistory.persistedState(right.id)

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
      { path: "/v1/chat/completions", model: LegacyHistory.modelID },
      { path: "/v1/chat/completions", model: LegacyHistory.modelID },
      { path: "/v1/chat/completions", model: LegacyHistory.modelID },
    ])
    const leftWire = leftHits.map((hit) => LegacyHistory.decodeMessages(hit.body.messages))
    const rightWire = rightHits.map((hit) => LegacyHistory.decodeMessages(hit.body.messages))
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
    expect(yield* LegacyHistory.persistedState(right.id)).toEqual(rightState)
    expect((yield* sessions.get(left.id)).location.directory).toBe(AbsolutePath.make(leftDirectory))
    expect((yield* sessions.get(right.id)).location.directory).toBe(AbsolutePath.make(rightDirectory))
    const leftState = yield* LegacyHistory.persistedState(left.id)
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
            sharedSelection: { providerID: LegacyHistory.providerID, modelID: LegacyHistory.modelID },
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
