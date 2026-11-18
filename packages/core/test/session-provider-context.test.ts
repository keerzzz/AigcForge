import { expect, test } from "bun:test"
import { CompactionPart, LanguageModel, Message, ToolCallPart, Media } from "@aigcfroge/ai"
import { OpenAIResponses } from "@aigcfroge/ai/protocols"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { EventTable } from "@aigcfroge/core/event/sql"
import { Instructions } from "@aigcfroge/core/instructions/index"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionConsultationReference } from "@aigcfroge/core/session/consultation-reference"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionHistory } from "@aigcfroge/core/session/history"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { InstructionState } from "@aigcfroge/core/session/instruction-state"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionPrompt } from "@aigcfroge/core/session/prompt"
import { SessionProviderContext } from "@aigcfroge/core/session/provider-context"
import { SessionRunnerModel } from "@aigcfroge/core/session/runner/model"
import { toLLMMessages } from "@aigcfroge/core/session/runner/to-llm-message"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { InstructionStateTable, SessionMessageTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Model } from "@aigcfroge/schema/model"
import { Base64, FileAttachment } from "@aigcfroge/schema/prompt"
import { asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { testEffect } from "./lib/effect"
import legacyMedia from "./fixture/provider-context/2.0.14-media.json"

const model = SessionRunnerModel.resolved(
  LanguageModel.make({ id: "deployment", provider: "openai", route: OpenAIResponses.route }),
  {
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [],
    limit: { context: 128_000, output: 4096 },
  },
)
const target = SessionProviderContext.provenance(model)
if (!target) throw new Error("Fixture must have a concrete endpoint")
const replacement = [
  Message.user("retained request"),
  Message.assistant(
    CompactionPart.make({ provider: model.model.provider, encrypted: "opaque-checkpoint", id: "cp_1" }),
  ),
]
const providerContext = SessionProviderContext.encode(target, replacement)
const sessionID = SessionSchema.ID.make("ses_provider_context")

// Frozen serialized data, deliberately not constructed using today's Message API.
const legacyContext = Schema.decodeUnknownSync(SessionProviderContext.Info)({
  ...providerContext,
  messages: legacyMedia,
})

test("reads pre-2.0.15 checkpoint media without rewriting the stored payload", async () => {
  const before = JSON.stringify(legacyContext)
  const decoded = SessionProviderContext.decode(legacyContext)
  expect(await Effect.runPromise(SessionProviderContext.validate(legacyContext))).toEqual(decoded)
  expect(decoded[0]?.content).toMatchObject([
    { type: "text", text: "retained attachments" },
    {
      type: "media",
      media: { source: { type: "base64", data: "AQID", mediaType: "image/png" } },
      filename: "attachment.png",
      cache: { type: "ephemeral" },
      metadata: { attachment: "original" },
      providerMetadata: { openai: { detail: "high" } },
    },
    { type: "media", media: { source: { type: "base64", data: "BAUG", mediaType: "image/jpeg" } } },
  ])
  expect(decoded[1]?.content).toMatchObject(legacyMedia[1]?.content ?? [])
  expect(JSON.stringify(legacyContext)).toBe(before)
})

test("reads mixed legacy and current media without overriding an existing asset", async () => {
  const current = {
    type: "media",
    media: { source: { type: "base64", data: "BAUG", mediaType: "image/jpeg" } },
    mediaType: "image/png",
    data: "AQID",
  }
  const context = Schema.decodeUnknownSync(SessionProviderContext.Info)({
    ...providerContext,
    messages: [{ role: "user", content: [...(legacyMedia[0]?.content ?? []), current] }],
  })
  const decoded = SessionProviderContext.decode(context)
  expect(await Effect.runPromise(SessionProviderContext.validate(context))).toEqual(decoded)
  expect(decoded[0]?.content.at(-1)).toMatchObject({ media: current.media })
  const invalid = { ...context, messages: [{ role: "user", content: [{ ...current, media: null }] }] }
  expect(() => SessionProviderContext.decode(invalid)).toThrow()
  expect(await Effect.runPromise(Effect.isFailure(SessionProviderContext.validate(invalid)))).toBe(true)
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionInbox.node, SessionStore.node]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const inbox = yield* SessionInbox.Service
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* bus.publish(SessionEvent.Created, {
    sessionID,
    projectID: Project.ID.global,
    location: { directory: AbsolutePath.make("/project") },
    slug: "provider-context",
    version: "test",
  })
  const state = { value: "initial instructions" }
  const instructions = Instructions.make({
    key: Instructions.Key.make("test/context"),
    codec: Schema.toCodecJson(Schema.String),
    read: Effect.sync(() => state.value),
    render: { initial: String, changed: (_previous, value) => value, removed: () => "removed" },
  })
  const prepare = InstructionState.prepare(database.db, bus, instructions, sessionID)
  const prompt = Effect.fnUntraced(function* (text: string) {
    const id = SessionMessage.ID.create()
    yield* inbox.admit({ id, sessionID, item: { type: "user", payload: { text }, delivery: "steer" } })
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: id })
    return id
  })
  const compact = (context?: SessionProviderContext.Info) =>
    bus.publish(SessionEvent.Compaction.Ended, {
      sessionID,
      reason: "manual",
      text: context ? "" : "local summary",
      recent: "",
      providerContext: context,
    })
  const load = (boundary: SessionHistory.Boundary) =>
    SessionHistory.entriesForRunner(database.db, sessionID, instructions, boundary)
  return { db: database.db, bus, state, instructions, prepare, prompt, compact, load }
})

it.effect("loads and replays a persisted pre-2.0.15 media checkpoint", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.prepare
    yield* s.prompt("original request")
    yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "" })
    yield* s.compact(legacyContext)
    yield* s.prompt("continue")
    const history = yield* SessionHistory.load(s.db, sessionID, target)
    expect(toLLMMessages(history, model.ref, model.model.provider, target).slice(0, 2)).toEqual([...SessionProviderContext.decode(legacyContext)])
    expect(history.some(SessionProviderContext.isCheckpoint)).toBe(true)
    const local = yield* SessionHistory.load(s.db, sessionID, "local")
    expect(local.some(SessionProviderContext.isCheckpoint)).toBe(false)
    expect(toLLMMessages(local, model.ref).map((message) => message.content)).toEqual([
      [Message.text("original request")],
      [Message.text("continue")],
    ])
  }),
)

test("canonical provider context round-trips tools, opaque checkpoints and binary media through JSON", () => {
  const messages = [
    ...replacement,
    Message.assistant(ToolCallPart.make({ id: "call_1", name: "read", input: { path: "file" } })),
    Message.tool({ id: "call_1", name: "read", result: { text: "result" } }),
    Message.user({ type: "media", media: Media.bytes(new Uint8Array([1, 2, 3]), "image/png") }),
  ]
  const context = SessionProviderContext.encode(providerContext.provenance, messages)
  const stored = Schema.decodeUnknownSync(Schema.fromJsonString(SessionProviderContext.Info))(JSON.stringify(context))
  const decoded = SessionProviderContext.decode(stored)
  expect(decoded).toEqual(messages)
  const optionalMetadata = SessionProviderContext.encode(providerContext.provenance, [
    Message.make({
      role: "user",
      content: [
        { type: "text", text: "attachment", metadata: { attachment: { name: undefined, source: { type: "inline" } } } },
      ],
      providerMetadata: { openai: { itemId: undefined, type: "message", status: undefined, phase: undefined } },
    }),
  ])
  expect(SessionProviderContext.decode(optionalMetadata)[0]).toMatchObject({
    providerMetadata: { openai: { type: "message" } },
    content: [{ metadata: { attachment: { source: { type: "inline" } } } }],
  })
  expect(() =>
    SessionProviderContext.decode({
      ...context,
      messages: [{ role: "assistant", content: [{ type: "compaction", provider: "openai" }] }],
    }),
  ).toThrow()
})

test("compatibility uses the actual deployment and endpoint rather than a catalog alias or variant", () => {
  expect(
    SessionProviderContext.compatible(
      providerContext.provenance,
      SessionProviderContext.provenance({
        ...model,
        ref: { ...model.ref, id: Model.ID.make("alias"), variant: Model.VariantID.make("high") },
      }),
    ),
  ).toBe(true)
  for (const changed of [
    { ...model, model: LanguageModel.update(model.model, { id: "other-deployment" }) },
    {
      ...model,
      model: LanguageModel.update(model.model, {
        route: model.model.route.with({ endpoint: { baseURL: "https://another.example/v1?api-key=secret" } }),
      }),
    },
    { ...model, model: LanguageModel.update(model.model, { route: model.model.route.with({ id: "other-route" }) }) },
  ])
    expect(
      SessionProviderContext.compatible(providerContext.provenance, SessionProviderContext.provenance(changed)),
    ).toBe(false)
  const privateEndpoint = SessionProviderContext.provenance({
    ...model,
    model: LanguageModel.update(model.model, {
      route: model.model.route.with({ endpoint: { baseURL: "https://user:secret@example.com/v1?api-key=secret" } }),
    }),
  })
  expect(JSON.stringify(privateEndpoint)).not.toContain("secret")
  expect(
    SessionProviderContext.provenance({
      ...model,
      model: LanguageModel.update(model.model, {
        route: model.model.route.with({ endpoint: { path: () => "/dynamic" } }),
      }),
    }),
  ).toBeUndefined()
  expect(SessionProviderContext.compatible(providerContext.provenance, undefined)).toBe(false)
})

test("P4 matches configured and observed URL construction, including query and WebSocket transport, and rejects missing deployment proof", () => {
  const selected = {
    ...model, connection: { type: "env" as const, name: "ACCOUNT_A" },
    model: LanguageModel.update(model.model, { route: model.model.route.with({ endpoint: {
      baseURL: "https://deployment.invalid/v1/", path: "/responses", query: { z: "last", a: "first" },
    } }) }),
  }
  const prepared = SessionProviderContext.provenance(selected)
  if (!prepared) throw new Error("The deployment fixture requires a concrete URL")
  const observed = SessionProviderContext.provenance(selected, "https://deployment.invalid/v1/responses?a=first&z=last")
  expect(SessionProviderContext.compatible(prepared, observed)).toBe(true)
  expect(SessionProviderContext.compatible(prepared, SessionProviderContext.provenance(selected, "wss://deployment.invalid/v1/responses?z=last&a=first"))).toBe(true)
  expect(SessionProviderContext.compatible(prepared, SessionProviderContext.provenance({ ...selected, connection: { type: "env", name: "ACCOUNT_B" } }))).toBe(false)
  expect(SessionProviderContext.compatible({ ...prepared, deployment: undefined }, prepared)).toBe(false)
  const anonymous = SessionProviderContext.provenance({ ...selected, connection: undefined })
  expect(anonymous?.deployment).toBeDefined()
  expect(anonymous && SessionProviderContext.compatible(anonymous, SessionProviderContext.provenance({ ...selected, connection: undefined }))).toBe(true)
  expect(SessionProviderContext.compatible(prepared, SessionProviderContext.provenance(selected, "https://other-deployment.invalid/v1/responses?a=first&z=last"))).toBe(false)
})

it.effect("P4 expands original readable history when a native checkpoint's connection or deployment proof is incompatible", () => Effect.gen(function* () {
  const s = yield* setup
  yield* s.prepare
  yield* s.prompt("Original readable request")
  const proof = SessionProviderContext.provenance({ ...model, connection: { type: "env", name: "ACCOUNT_A" } })
  if (!proof) return yield* Effect.die(new Error("The native fixture requires a proven endpoint"))
  yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "" })
  yield* s.compact(SessionProviderContext.encode(proof, replacement))
  yield* s.prompt("Continue visibly")
  expect((yield* s.load(proof)).entries.some((entry) => SessionProviderContext.isCheckpoint(entry.message))).toBe(true)
  for (const boundary of [
    { ...proof, connection: { type: "env" as const, name: "ACCOUNT_B" } },
    { ...proof, deployment: undefined },
  ]) {
    const expanded = yield* s.load(boundary)
    expect(expanded.entries.map((entry) => entry.message.type)).toEqual(["user", "user"])
    expect(toLLMMessages(expanded.entries.map((entry) => entry.message), model.ref, model.model.provider, boundary).map((message) => message.content))
      .toEqual([[Message.text("Original readable request")], [Message.text("Continue visibly")]])
  }
  const historical = { ...proof, deployment: undefined }
  yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "" })
  yield* s.compact(SessionProviderContext.encode(historical, replacement))
  const preserved = yield* s.load("latest")
  expect(preserved.entries.some((entry) => SessionProviderContext.isCheckpoint(entry.message))).toBe(true)
  expect((yield* s.load(proof)).entries[0]?.message).toMatchObject({ type: "compaction", providerContext: { provenance: proof } })
}))

it.effect(
  "advances the native instruction epoch and omits superseded chronological updates after durable replay and provider switches",
  () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.prepare
      yield* s.prompt("original request")
      s.state.value = "changed instructions"
      yield* s.prepare
      yield* s.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "manual", recent: "" })
      const completed = yield* s.compact(providerContext)
      s.state.value = "newest instructions"
      yield* s.prepare
      yield* s.prompt("continue")

      const verify = Effect.gen(function* () {
        expect(
          yield* s.db.select().from(InstructionStateTable).where(eq(InstructionStateTable.session_id, sessionID)).get(),
        ).toMatchObject({
          epoch_start: completed.durable.seq,
          initial_values: { "test/context": Instructions.hash("changed instructions") },
          current_values: { "test/context": Instructions.hash("newest instructions") },
        })
        const native = yield* s.load(target)
        expect(native.initial).toBe("changed instructions")
        expect(
          toLLMMessages(
            native.entries.map((entry) => entry.message),
            model.ref,
            model.model.provider,
            target,
          ),
        ).toEqual([
          ...replacement,
          Message.system("newest instructions"),
          expect.objectContaining({ role: "user", content: [Message.text("continue")] }),
        ])
        for (const incompatible of [
          "local" as const,
          { ...providerContext.provenance, modelID: "other" },
          { ...providerContext.provenance, provider: "other" },
        ]) {
          const expanded = yield* s.load(incompatible)
          expect(expanded.initial).toBe("changed instructions")
          expect(
            toLLMMessages(
              expanded.entries.map((entry) => entry.message),
              model.ref,
            ).map((message) => message.content),
          ).toEqual([
            [Message.text("original request")],
            [Message.text("newest instructions")],
            [Message.text("continue")],
          ])
        }
        const preview = yield* SessionHistory.preview(s.db, sessionID, s.instructions, target)
        expect(preview.initial).toBe("changed instructions")
        expect(preview.messages).toEqual(native.entries.map((entry) => entry.message))
        const store = yield* SessionStore.Service
        expect((yield* store.messages({ sessionID })).map((message) => message.type)).toEqual([
          "user",
          "system",
          "compaction",
          "system",
          "user",
        ])
      })
      yield* verify
      const recorded = yield* s.db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, sessionID))
        .orderBy(asc(EventTable.seq))
        .all()
      expect(recorded.filter((event) => event.data.providerContext !== undefined)).toHaveLength(1)
      yield* s.bus.remove(sessionID)
      yield* s.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
      for (const event of recorded)
        yield* s.bus.replay({
          id: event.id,
          created: event.created,
          aggregateID: event.aggregate_id,
          seq: event.seq,
          type: event.type,
          data: event.data,
        })
      yield* verify
    }),
)

it.effect("falls back to an earlier compatible native or local checkpoint", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.prepare
    yield* s.prompt("before local")
    s.state.value = "local baseline"
    yield* s.prepare
    yield* s.compact()
    yield* s.prompt("after local")
    yield* s.compact(providerContext)
    yield* s.prompt("after native")
    s.state.value = "new native baseline"
    yield* s.prepare
    yield* s.compact({ ...providerContext, provenance: { ...providerContext.provenance, modelID: "other" } })
    s.state.value = "post-epoch update"
    yield* s.prepare
    const native = yield* s.load(target)
    expect(native.initial).toBe("new native baseline")
    expect(native.entries.map((entry) => entry.message.type)).toEqual(["compaction", "user", "system"])
    expect(native.entries[0]?.message).toMatchObject({ providerContext })
    expect(
      toLLMMessages(
        native.entries.map((entry) => entry.message),
        model.ref,
        model.model.provider,
        target,
      ).filter((message) => message.role === "system"),
    ).toEqual([Message.system("post-epoch update")])
    const local = yield* s.load("local")
    expect(local.initial).toBe("new native baseline")
    expect(local.entries.map((entry) => entry.message.type)).toEqual(["compaction", "user", "user", "system"])
    expect(local.entries[0]?.message).toMatchObject({ summary: "local summary" })
  }),
)

it.effect("rejects malformed persisted native windows instead of silently dropping them", () =>
  Effect.gen(function* () {
    const s = yield* setup
    yield* s.compact({ ...providerContext, messages: [{ role: "invalid", content: [] }] })
    expect(yield* SessionHistory.load(s.db, sessionID, target).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.MessageDecodeError",
    })
    const store = yield* SessionStore.Service
    expect(yield* store.context(sessionID).pipe(Effect.flip)).toMatchObject({ _tag: "Session.MessageDecodeError" })
  }),
)

it.effect("SC04 freezes before and through windows without admitting later compactions or source mutations", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const first = yield* s.prompt("original text before compaction")
    const local = yield* s.compact()
    const native = yield* s.compact(providerContext)
    const selected = yield* s.prompt("selected consultation boundary")
    yield* s.compact()
    yield* s.prompt("future text outside the consultation")
    const localID = SessionMessage.ID.fromEvent(local.id)
    const nativeID = SessionMessage.ID.fromEvent(native.id)
    const original = yield* SessionConsultationReference.freeze(s.db, {
      sourceSessionID: sessionID,
      boundary: { type: "before", messageID: localID },
    })
    expect(original.sourceMessageIDs).toEqual([first])
    expect(Buffer.from(original.file.data, "base64").toString("utf8")).toContain("original text before compaction")
    const before = yield* SessionConsultationReference.freeze(s.db, {
      sourceSessionID: sessionID,
      boundary: { type: "before", messageID: selected },
    })
    expect(before.sourceMessageIDs).toEqual([localID, nativeID])
    const reference = yield* SessionConsultationReference.freeze(s.db, {
      sourceSessionID: sessionID,
      boundary: { type: "through", messageID: selected },
    })
    const bytes = Buffer.from(reference.file.data, "base64")
    const text = bytes.toString("utf8")
    expect(reference.sourceMessageIDs).toEqual([localID, nativeID, selected])
    expect(reference.file).toMatchObject({ mime: "text/plain", source: { type: "inline" } })
    expect(reference.digest).toBe(createHash("sha256").update(bytes).digest("hex"))
    expect(reference.omissions).toContainEqual({
      messageID: nativeID,
      type: "native-checkpoint",
      reason: "provider-bound-context",
    })
    expect(text).toContain("local summary")
    expect(text).toContain("selected consultation boundary")
    expect(text).not.toContain("opaque-checkpoint")
    expect(text).not.toContain("future text outside the consultation")
    yield* s.db
      .update(SessionMessageTable)
      .set({ data: { text: "source text changed after freezing", time: { created: 0 } } })
      .where(eq(SessionMessageTable.id, selected))
      .run()
    const changed = yield* SessionConsultationReference.freeze(s.db, {
      sourceSessionID: sessionID,
      boundary: reference.boundary,
    })
    expect(changed.digest).not.toBe(reference.digest)
    expect(Buffer.from(changed.file.data, "base64").toString("utf8")).toContain("source text changed after freezing")
    yield* s.db.delete(SessionTable).where(eq(SessionTable.id, sessionID)).run()
    expect(Buffer.from(reference.file.data, "base64")).toEqual(bytes)
    expect(reference.digest).toBe(createHash("sha256").update(bytes).digest("hex"))
    expect(
      yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: sessionID,
        boundary: reference.boundary,
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.NotFoundError" })
  }),
)

it.effect(
  "SC04 materializes source text and tool results while recording actual binary, native and partial omissions",
  () =>
    Effect.gen(function* () {
      const s = yield* setup
      yield* s.prepare
      const user = SessionMessage.ID.create()
      const inbox = yield* SessionInbox.Service
      yield* inbox.admit({
        id: user,
        sessionID,
        item: {
          type: "user",
          payload: {
            text: "source user body",
            files: [
              FileAttachment.create({
                data: Base64.make(Buffer.from("保存的附件正文").toString("base64")),
                mime: "text/plain",
                name: "frozen.txt",
                source: { type: "uri", uri: "file:///project/frozen.txt" },
              }),
              FileAttachment.create({
                data: Base64.make("AQID"),
                mime: "image/png",
                name: "binary.png",
                source: { type: "inline" },
              }),
              FileAttachment.create({
                data: Base64.make("/w=="),
                mime: "text/plain",
                name: "invalid.txt",
                source: { type: "inline" },
              }),
            ],
          },
          delivery: "steer",
        },
      })
      yield* s.bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: user })
      s.state.value = "source system instructions must stay source-owned"
      yield* s.prepare
      const shell = SessionMessage.ID.create()
      yield* s.db
        .insert(SessionMessageTable)
        .values({
          id: shell,
          session_id: sessionID,
          type: "shell",
          seq: 5_000,
          data: {
            shellID: "sh_reference",
            command: "printf saved",
            status: "exited",
            exit: 0,
            output: { output: "saved shell", cursor: 11, size: 20, truncated: true },
            time: { created: 0, completed: 1 },
          },
        })
        .run()
      const assistant = SessionMessage.ID.create()
      yield* s.db
        .insert(SessionMessageTable)
        .values({
          id: assistant,
          session_id: sessionID,
          type: "assistant",
          seq: 10_000,
          data: {
            agent: "source-agent",
            model: model.ref,
            time: { created: 0, completed: 1 },
            providerState: { opaque: "hidden-assistant-state" },
            content: [
              { type: "text", text: "source assistant body", state: { opaque: "hidden-text-state" } },
              { type: "reasoning", text: "readable source reasoning" },
              {
                type: "tool",
                id: "read_source",
                name: "read",
                time: { created: 0, completed: 1 },
                providerState: { opaque: "hidden-tool-state" },
                state: {
                  status: "completed",
                  input: { path: "/project/tool.txt" },
                  content: [
                    { type: "text", text: "durable tool result" },
                    {
                      type: "file",
                      uri: `data:text/plain;base64,${Buffer.from("inline tool file body").toString("base64")}`,
                      mime: "text/plain",
                      name: "inline-tool.txt",
                    },
                    {
                      type: "file",
                      uri: "file:///project/not-materialized.txt",
                      mime: "text/plain",
                      name: "not-materialized.txt",
                    },
                  ],
                },
              },
            ],
          },
        })
        .run()
      const reference = yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: sessionID,
        boundary: { type: "through", messageID: assistant },
      })
      const text = Buffer.from(reference.file.data, "base64").toString("utf8")
      expect(text).toContain("source user body")
      expect(text).toContain("保存的附件正文")
      expect(text).toContain("file:///project/frozen.txt")
      expect(text).toContain("binary.png")
      expect(text).toContain("source assistant body")
      expect(text).toContain("readable source reasoning")
      expect(text).toContain('Input: {"path":"/project/tool.txt"}')
      expect(text).toContain("durable tool result")
      expect(text).toContain("inline tool file body")
      expect(text).toContain("file:///project/not-materialized.txt")
      expect(text).toContain("saved shell")
      expect(text).not.toContain("source system instructions must stay source-owned")
      expect(text).not.toContain("hidden-assistant-state")
      expect(text).not.toContain("hidden-text-state")
      expect(text).not.toContain("hidden-tool-state")
      expect(reference.omissions).toContainEqual({ messageID: user, type: "attachment", reason: "binary-content" })
      expect(reference.omissions).toContainEqual({
        messageID: user,
        type: "attachment",
        reason: "invalid-text-content",
      })
      expect(reference.omissions).toContainEqual({
        messageID: assistant,
        type: "attachment",
        reason: "unmaterialized-uri",
      })
      expect(reference.omissions).toContainEqual({
        messageID: assistant,
        type: "provider-state",
        reason: "provider-bound-payload",
      })
      expect(reference.omissions).toContainEqual({ messageID: shell, type: "shell-output", reason: "partial-output" })
      expect(
        reference.omissions.some((omission) => omission.type === "system" && omission.reason === "source-instructions"),
      ).toBe(true)
    }),
)

it.effect("SC04 validates source and boundary ownership and only accepts the completed selected prefix", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const user = yield* s.prompt("complete promoted User")
    expect(
      yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: SessionSchema.ID.make("ses_missing_source"),
        boundary: { type: "through", messageID: user },
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.NotFoundError" })
    expect(
      yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: sessionID,
        boundary: { type: "through", messageID: SessionMessage.ID.make("msg_missing_boundary") },
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.MessageNotFoundError" })
    const other = SessionSchema.ID.make("ses_other_consultation_source")
    yield* s.bus.publish(SessionEvent.Created, {
      sessionID: other,
      projectID: Project.ID.global,
      location: { directory: AbsolutePath.make("/project") },
      slug: "other-consultation-source",
      version: "test",
    })
    const foreign = SessionMessage.ID.create()
    const inbox = yield* SessionInbox.Service
    yield* inbox.admit({
      id: foreign,
      sessionID: other,
      item: { type: "user", payload: { text: "foreign boundary" }, delivery: "steer" },
    })
    yield* s.bus.publish(SessionEvent.InboxDelivered, { sessionID: other, inboxID: foreign })
    expect(
      yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: sessionID,
        boundary: { type: "through", messageID: foreign },
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.InvalidConsultationError", field: "boundary" })
    const assistant = SessionMessage.ID.create()
    yield* s.db
      .insert(SessionMessageTable)
      .values({
        id: assistant,
        session_id: sessionID,
        type: "assistant",
        seq: 10_000,
        data: {
          agent: "source-agent",
          model: model.ref,
          content: [{ type: "text", text: "running response" }],
          time: { created: 0 },
        },
      })
      .run()
    const before = yield* SessionConsultationReference.freeze(s.db, {
      sourceSessionID: sessionID,
      boundary: { type: "before", messageID: assistant },
    })
    expect(before.sourceMessageIDs).toEqual([user])
    expect(
      yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: sessionID,
        boundary: { type: "through", messageID: assistant },
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.InvalidConsultationError", field: "boundary" })
    yield* s.db
      .update(SessionMessageTable)
      .set({
        data: {
          agent: "source-agent",
          model: model.ref,
          content: [
            {
              type: "tool",
              id: "running_tool",
              name: "read",
              time: { created: 0 },
              state: { status: "running", input: {}, metadata: {} },
            },
          ],
          time: { created: 0, completed: 1 },
        },
      })
      .where(eq(SessionMessageTable.id, assistant))
      .run()
    expect(
      yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: sessionID,
        boundary: { type: "through", messageID: assistant },
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.InvalidConsultationError", field: "boundary" })
    yield* s.db
      .update(SessionMessageTable)
      .set({
        data: {
          agent: "source-agent",
          model: model.ref,
          content: [{ type: "text", text: "completed response" }],
          time: { created: 0, completed: 1 },
        },
      })
      .where(eq(SessionMessageTable.id, assistant))
      .run()
    const compaction = SessionMessage.ID.create()
    yield* s.db
      .insert(SessionMessageTable)
      .values({
        id: compaction,
        session_id: sessionID,
        type: "compaction",
        seq: 20_000,
        data: { status: "running", reason: "manual", summary: "", recent: "", time: { created: 0 } },
      })
      .run()
    expect(
      yield* SessionConsultationReference.freeze(s.db, {
        sourceSessionID: sessionID,
        boundary: { type: "through", messageID: compaction },
      }).pipe(Effect.flip),
    ).toMatchObject({ _tag: "Session.InvalidConsultationError", field: "boundary" })
  }),
)

it.effect("SC04 rejects references by actual UTF-8 bytes at the existing attachment limit", () =>
  Effect.gen(function* () {
    const s = yield* setup
    const boundary = yield* s.prompt("界".repeat(Math.floor(SessionPrompt.MAX_ATTACHMENT_BYTES / 3) + 1))
    const error = yield* SessionConsultationReference.freeze(s.db, {
      sourceSessionID: sessionID,
      boundary: { type: "through", messageID: boundary },
    }).pipe(Effect.flip)
    expect(error).toMatchObject({ _tag: "Session.InvalidConsultationError", field: "reference" })
    expect(error.message).toContain(`${SessionPrompt.MAX_ATTACHMENT_BYTES} byte attachment limit`)
  }),
)
