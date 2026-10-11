import { describe, expect } from "bun:test"
import { DateTime, Effect, Exit, Layer } from "effect"
import { asc, eq } from "drizzle-orm"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { EventTable } from "../src/event/sql"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { SessionV2 } from "../src/session"
import { SessionComposition } from "../src/session/composition"
import { SessionEvent } from "../src/session/event"
import { SessionHistory } from "../src/session/history"
import { SessionMessage } from "../src/session/message"
import { SessionProjector } from "../src/session/projector"
import { MessageTable, PartTable, SessionMessageTable, SessionTable } from "../src/session/sql"
import { ModelV2 } from "../src/model"
import { ProviderV2 } from "../src/provider"
import { MessageID, PartID, SessionV1 } from "../src/v1/session"
import { Model } from "@aigcfroge/llm"
import { route } from "@aigcfroge/llm/protocols/openai-chat"
import { toLLMMessages } from "../src/session/runner/to-llm-message"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionProjector.defaultLayer,
    SessionV2.defaultLayer,
  ).pipe(Layer.provide(SessionComposition.defaultLayer)),
)

const seed = Effect.fnUntraced(function* (name: string) {
  const db = (yield* Database.Service).db
  const sessionID = SessionV2.ID.make(`ses_legacy_${name}`)
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      mode: "assistant",
      slug: name,
      directory: AbsolutePath.make("/project"),
      title: name,
      version: "test",
      time_created: 1,
      time_updated: 3,
      agent: "assistant",
    })
    .run()
    .pipe(Effect.orDie)
  const user = MessageID.make(`msg_${name}_a`)
  const assistant = MessageID.make(`msg_${name}_b`)
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
            agent: "assistant",
            mode: "assistant",
            providerID: ProviderV2.ID.make("provider"),
            modelID: ModelV2.ID.make("model"),
            path: { cwd: "/project", root: "/project" },
            time: { created: 2, completed: 3 },
            cost: 2,
            tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
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
            agent: "assistant",
            model: { providerID: ProviderV2.ID.make("provider"), modelID: ModelV2.ID.make("model") },
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
        id: PartID.make(`prt_${name}_2`),
        message_id: assistant,
        session_id: sessionID,
        time_created: 2,
        time_updated: 3,
        data: {
          ...({ type: "text", text: "Old answer" } satisfies Omit<
            SessionV1.TextPart,
            "id" | "sessionID" | "messageID"
          >),
        },
      },
      {
        id: PartID.make(`prt_${name}_1`),
        message_id: user,
        session_id: sessionID,
        time_created: 1,
        time_updated: 1,
        data: {
          ...({ type: "text", text: "Old question" } satisfies Omit<
            SessionV1.TextPart,
            "id" | "sessionID" | "messageID"
          >),
        },
      },
    ])
    .run()
    .pipe(Effect.orDie)
  return { sessionID, user, assistant }
})

describe("Assistant legacy history adoption", () => {
  it.effect("imports before canonical reads and admission, preserving order and message IDs", () =>
    Effect.gen(function* () {
      const seeded = yield* seed("ordered")
      const sessions = yield* SessionV2.Service
      const messages = yield* sessions.messages({ sessionID: seeded.sessionID, order: "asc" })
      expect(messages.map((message) => message.id)).toEqual([
        SessionMessage.ID.make(seeded.user),
        SessionMessage.ID.make(seeded.assistant),
      ])
      expect(messages[0]).toMatchObject({ type: "user", text: "Old question" })
      expect(messages[1]).toMatchObject({ type: "assistant", content: [{ type: "text", text: "Old answer" }], cost: 2 })
      yield* sessions.prompt({ sessionID: seeded.sessionID, prompt: { text: "Continue" }, resume: false })
      const db = (yield* Database.Service).db
      expect((yield* SessionHistory.loadForRunner(db, seeded.sessionID, 0)).map((message) => message.id)).toEqual(
        messages.map((message) => message.id),
      )
      const before = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, seeded.sessionID))
        .all()
        .pipe(Effect.orDie)
      yield* Effect.all([sessions.get(seeded.sessionID), sessions.messages({ sessionID: seeded.sessionID })], {
        concurrency: "unbounded",
      })
      const after = yield* db
        .select()
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, seeded.sessionID))
        .all()
        .pipe(Effect.orDie)
      expect(after.length).toBe(before.length)
    }),
  )

  it.effect("rolls back the whole import when a later projection fails", () =>
    Effect.gen(function* () {
      const seeded = yield* seed("rollback")
      const events = yield* EventV2.Service
      yield* events.project(SessionEvent.HistoryImported, (event) =>
        event.data.message.id === String(seeded.assistant) ? Effect.die("test projection failure") : Effect.void,
      )
      const result = yield* (yield* SessionV2.Service).get(seeded.sessionID).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      const db = (yield* Database.Service).db
      expect(
        yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, seeded.sessionID))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([])
      expect(
        yield* db
          .select()
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, seeded.sessionID))
          .all()
          .pipe(Effect.orDie),
      ).toEqual([])
    }),
  )

  it.effect("adopts after legacy selection events and supplies tool results and media to provider lowering", () =>
    Effect.gen(function* () {
      const seeded = yield* seed("selection")
      const events = yield* EventV2.Service
      yield* events.publish(SessionEvent.AgentSwitched, {
        sessionID: seeded.sessionID,
        messageID: SessionMessage.ID.make("msg_selection_agent"),
        agent: "assistant",
        timestamp: DateTime.makeUnsafe(0),
      })
      yield* events.publish(SessionEvent.ModelSwitched, {
        sessionID: seeded.sessionID,
        messageID: SessionMessage.ID.make("msg_selection_model"),
        model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
        timestamp: DateTime.makeUnsafe(0),
      })
      const db = (yield* Database.Service).db
      yield* db
        .insert(PartTable)
        .values([
          {
            id: PartID.make("prt_selection_3"),
            message_id: seeded.user,
            session_id: seeded.sessionID,
            time_created: 1,
            time_updated: 1,
            data: {
              ...({
                type: "file",
                mime: "image/png",
                url: "data:image/png;base64,aGVsbG8=",
                filename: "example.png",
              } satisfies Omit<SessionV1.FilePart, "id" | "sessionID" | "messageID">),
            },
          },
          {
            id: PartID.make("prt_selection_4"),
            message_id: seeded.assistant,
            session_id: seeded.sessionID,
            time_created: 2,
            time_updated: 3,
            data: {
              ...({
                type: "tool",
                callID: "legacy-call",
                tool: "read",
                state: {
                  status: "completed",
                  input: { filePath: "/project/example" },
                  output: "Old file content",
                  title: "Read file",
                  metadata: { title: "not provider output" },
                  time: { start: 2, end: 3 },
                },
              } satisfies Omit<SessionV1.ToolPart, "id" | "sessionID" | "messageID">),
            },
          },
          {
            id: PartID.make("prt_selection_5"),
            message_id: seeded.assistant,
            session_id: seeded.sessionID,
            time_created: 2,
            time_updated: 3,
            data: {
              ...({
                type: "tool",
                callID: "interrupted-call",
                tool: "read",
                state: { status: "pending", input: {}, raw: "{}" },
              } satisfies Omit<SessionV1.ToolPart, "id" | "sessionID" | "messageID">),
            },
          },
        ])
        .run()
        .pipe(Effect.orDie)
      const sessions = yield* SessionV2.Service
      const adopted = yield* sessions.get(seeded.sessionID)
      expect(adopted.model?.id).toBe(ModelV2.ID.make("model"))
      const context = yield* SessionHistory.loadForRunner(db, seeded.sessionID, 0)
      const lowered = toLLMMessages(context, Model.make({ id: "model", provider: "provider", route }))
      expect(lowered.map((message) => message.role)).toEqual(["user", "assistant", "tool", "tool"])
      expect(JSON.stringify(lowered)).toContain("Old question")
      expect(JSON.stringify(lowered)).toContain("Old answer")
      expect(JSON.stringify(lowered)).toContain("Old file content")
      expect(JSON.stringify(lowered)).toContain("data:image/png;base64,aGVsbG8=")
      expect(JSON.stringify(lowered)).toContain("[Tool execution was interrupted]")
      expect(JSON.stringify(lowered)).not.toContain("not provider output")
      expect(adopted.cost).toBe(0)
    }),
  )

  it.effect("concurrent first readers commit one ordered import", () =>
    Effect.gen(function* () {
      const seeded = yield* seed("concurrent")
      const sessions = yield* SessionV2.Service
      yield* Effect.all([sessions.get(seeded.sessionID), sessions.get(seeded.sessionID)], { concurrency: "unbounded" })
      const db = (yield* Database.Service).db
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.session_id, seeded.sessionID))
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      expect(rows.map((row) => row.id)).toEqual([
        SessionMessage.ID.make(seeded.user),
        SessionMessage.ID.make(seeded.assistant),
      ])
    }),
  )

  it.effect("refuses to append older legacy messages behind existing canonical history", () =>
    Effect.gen(function* () {
      const seeded = yield* seed("mixed")
      yield* (yield* EventV2.Service).publish(SessionEvent.Synthetic, {
        sessionID: seeded.sessionID,
        messageID: SessionMessage.ID.make("msg_mixed_new"),
        text: "New canonical history",
        timestamp: DateTime.makeUnsafe(4),
      })
      expect(Exit.isFailure(yield* (yield* SessionV2.Service).get(seeded.sessionID).pipe(Effect.exit))).toBe(true)
      const db = (yield* Database.Service).db
      expect(
        (yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.session_id, seeded.sessionID))
          .all()
          .pipe(Effect.orDie)).length,
      ).toBe(1)
    }),
  )

  it.effect("only completed summaries establish a canonical compaction boundary", () =>
    Effect.gen(function* () {
      yield* Effect.forEach([true, false], (completed) =>
        Effect.gen(function* () {
          const seeded = yield* seed(completed ? "summary_done" : "summary_incomplete")
          const db = (yield* Database.Service).db
          const assistant = yield* db
            .select()
            .from(MessageTable)
            .where(eq(MessageTable.id, seeded.assistant))
            .get()
            .pipe(Effect.orDie)
          if (!assistant) throw new Error("missing fixture assistant")
          yield* db
            .update(MessageTable)
            .set({ data: { ...assistant.data, ...{ summary: true, finish: completed ? "stop" : undefined } } })
            .where(eq(MessageTable.id, seeded.assistant))
            .run()
            .pipe(Effect.orDie)
          yield* db
            .insert(PartTable)
            .values({
              id: PartID.make(`prt_${seeded.sessionID}_compaction`),
              message_id: seeded.user,
              session_id: seeded.sessionID,
              time_created: 1,
              time_updated: 1,
              data: {
                ...({ type: "compaction", auto: false } satisfies Omit<
                  SessionV1.CompactionPart,
                  "id" | "sessionID" | "messageID"
                >),
              },
            })
            .run()
            .pipe(Effect.orDie)
          const context = yield* (yield* SessionV2.Service).context(seeded.sessionID)
          expect(context.map((message) => message.type)).toEqual(completed ? ["compaction"] : ["user", "assistant"])
          if (completed) expect(context[0]).toMatchObject({ summary: "Old answer", reason: "manual" })
        }),
      )
    }),
  )

  it.effect(
    "fails before importing unsupported system, remote media, or retained-tail history and permits deletion",
    () =>
      Effect.gen(function* () {
        yield* Effect.forEach(["system", "media", "tail"], (kind) =>
          Effect.gen(function* () {
            const seeded = yield* seed(kind)
            const db = (yield* Database.Service).db
            const user = yield* db
              .select()
              .from(MessageTable)
              .where(eq(MessageTable.id, seeded.user))
              .get()
              .pipe(Effect.orDie)
            const assistant = yield* db
              .select()
              .from(MessageTable)
              .where(eq(MessageTable.id, seeded.assistant))
              .get()
              .pipe(Effect.orDie)
            if (!user || !assistant) throw new Error("missing fixture message")
            if (kind === "system")
              yield* db
                .update(MessageTable)
                .set({ data: { ...user.data, ...{ system: "Legacy system instruction" } } })
                .where(eq(MessageTable.id, seeded.user))
                .run()
                .pipe(Effect.orDie)
            if (kind === "media")
              yield* db
                .insert(PartTable)
                .values({
                  id: PartID.make("prt_media_remote"),
                  message_id: seeded.user,
                  session_id: seeded.sessionID,
                  time_created: 1,
                  time_updated: 1,
                  data: {
                    ...({ type: "file", mime: "image/png", url: "https://example.test/old.png" } satisfies Omit<
                      SessionV1.FilePart,
                      "id" | "sessionID" | "messageID"
                    >),
                  },
                })
                .run()
                .pipe(Effect.orDie)
            if (kind === "tail") {
              yield* db
                .update(MessageTable)
                .set({ data: { ...assistant.data, ...{ summary: true } } })
                .where(eq(MessageTable.id, seeded.assistant))
                .run()
                .pipe(Effect.orDie)
              yield* db
                .insert(PartTable)
                .values({
                  id: PartID.make("prt_tail_compaction"),
                  message_id: seeded.user,
                  session_id: seeded.sessionID,
                  time_created: 1,
                  time_updated: 1,
                  data: {
                    ...({ type: "compaction", auto: true, tail_start_id: seeded.user } satisfies Omit<
                      SessionV1.CompactionPart,
                      "id" | "sessionID" | "messageID"
                    >),
                  },
                })
                .run()
                .pipe(Effect.orDie)
            }
            const sessions = yield* SessionV2.Service
            expect(Exit.isFailure(yield* sessions.get(seeded.sessionID).pipe(Effect.exit))).toBe(true)
            expect(
              yield* db
                .select()
                .from(SessionMessageTable)
                .where(eq(SessionMessageTable.session_id, seeded.sessionID))
                .all()
                .pipe(Effect.orDie),
            ).toEqual([])
            yield* sessions.remove(seeded.sessionID)
            expect(
              yield* db
                .select()
                .from(SessionTable)
                .where(eq(SessionTable.id, seeded.sessionID))
                .get()
                .pipe(Effect.orDie),
            ).toBeUndefined()
          }),
        )
      }),
  )
})
