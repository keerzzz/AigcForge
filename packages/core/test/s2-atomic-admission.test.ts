import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "@aigcfroge/core/event/sql"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { AgentV2 } from "@aigcfroge/core/agent"
import { ModelV2 } from "@aigcfroge/core/model"
import { ProviderV2 } from "@aigcfroge/core/provider"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import { testEffect } from "./lib/effect"

// S2 RED: one request that carries selection AND an input must be all-or-nothing.
//
// Before the kernel, `SessionPrompt.admitCanonical` committed switchAgent, then
// switchModel, then the prompt — three independent commits with no rollback. A
// prompt the server then REJECTED still left the session on a different agent,
// and an abort between the writes left a selection combination nobody asked for.
// The user-visible contract is now: partial success becomes total failure.

const wakeCalls: SessionV2.ID[] = []
const execution = Layer.succeed(
  SessionExecution.Service,
  SessionExecution.Service.of({
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    isActive: () => Effect.succeed(false),
    wake: (sessionID) =>
      Effect.sync(() => {
        wakeCalls.push(sessionID)
      }),
  }),
)
const sessionComposition = SessionComposition.layer.pipe(Layer.provide(Database.defaultLayer))
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(execution),
)
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    sessionComposition,
    execution,
    sessions,
  ),
)

const seed = Effect.fn("seed")(function* (sessionID: SessionV2.ID) {
  wakeCalls.length = 0
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  const sessions = yield* SessionV2.Service
  return yield* sessions.create({
    id: sessionID,
    mode: "coding",
    agent: AgentV2.ID.make("plan"),
    location: { directory: AbsolutePath.make("/project") },
  })
})

// The event table stores `versionedType(type, version)` (event.ts:80), not the
// bare definition type. Filtering on the bare name matches nothing, which would
// make every "expect 0 events" assertion below pass vacuously — so resolve the
// stored name from the definition instead of hardcoding either form.
const storedType = (definition: { readonly type: string; readonly durable?: { readonly version: number } }) =>
  `${definition.type}.${definition.durable?.version ?? 1}`

const eventsOfType = Effect.fn("eventsOfType")(function* (sessionID: SessionV2.ID, type: string) {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select({ type: EventTable.type })
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .all()
    .pipe(Effect.orDie)
  return rows.filter((row) => row.type === type)
})

const inputRows = Effect.fn("inputRows")(function* (id: SessionMessage.ID) {
  const { db } = yield* Database.Service
  return yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).run().pipe(Effect.orDie)
})

const sessionRow = Effect.fn("sessionRow")(function* (sessionID: SessionV2.ID) {
  const { db } = yield* Database.Service
  return yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
})

const eventCount = Effect.fn("eventCount")(function* (sessionID: SessionV2.ID) {
  const { db } = yield* Database.Service
  const rows = yield* db
    .select({ type: EventTable.type })
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, sessionID))
    .all()
    .pipe(Effect.orDie)
  return rows.length
})

describe("Atomic admission kernel (S2)", () => {
  it.effect("a rejected input rolls back the selection that arrived with it", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_s2_conflict")
      const messageID = SessionMessage.ID.make("msg_s2_conflict")
      yield* seed(sessionID)
      const sessions = yield* SessionV2.Service

      // First admission wins the message ID.
      yield* sessions.admitWithSelection({
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "first" }),
        resume: false,
      })
      const before = yield* sessionRow(sessionID)

      // Same ID, different text, and a selection change riding along. The input
      // is a conflict, so the selection must not survive it.
      const exit = yield* sessions
        .admitWithSelection({
          sessionID,
          id: messageID,
          prompt: Prompt.make({ text: "second" }),
          agent: "build",
          model: { id: ModelV2.ID.make("test-model"), providerID: ProviderV2.ID.make("test") },
          resume: false,
        })
        .pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      const after = yield* sessionRow(sessionID)
      expect(after?.agent).toBe(before?.agent)
      expect(after?.model).toEqual(before?.model)
      expect(yield* eventsOfType(sessionID, storedType(SessionEvent.AgentSwitched))).toHaveLength(0)
      expect(yield* eventsOfType(sessionID, storedType(SessionEvent.ModelSwitched))).toHaveLength(0)
    }),
  )

  it.effect("a policy-rejected agent rolls back the model that arrived with it", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_s2_policy")
      const messageID = SessionMessage.ID.make("msg_s2_policy")
      yield* seed(sessionID)
      const sessions = yield* SessionV2.Service

      // Order-independence, not a historical defect: the pre-S2 adapter ran
      // switchAgent before switchModel, so a policy rejection happened to abort
      // before the model write. This pins the invariant so a future reordering
      // cannot make the model land on a request that was refused. Proven
      // load-bearing by hoisting the model publish above the agent validation,
      // which turns this case red.
      //
      // `chat-orchestrator` is a mode-bound orchestrator: never a valid primary
      // in coding mode (product-mode-agent-policy).
      const exit = yield* sessions
        .admitWithSelection({
          sessionID,
          id: messageID,
          prompt: Prompt.make({ text: "hello" }),
          agent: "chat-orchestrator",
          model: { id: ModelV2.ID.make("test-model"), providerID: ProviderV2.ID.make("test") },
          resume: false,
        })
        .pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      expect(yield* eventsOfType(sessionID, storedType(SessionEvent.ModelSwitched))).toHaveLength(0)
      expect(yield* eventsOfType(sessionID, storedType(SessionEvent.AgentSwitched))).toHaveLength(0)
      expect(yield* inputRows(messageID)).toHaveLength(0)
      expect(wakeCalls).toHaveLength(0)
    }),
  )

  it.effect("a successful batch commits selection and input together and wakes exactly once", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_s2_ok")
      const messageID = SessionMessage.ID.make("msg_s2_ok")
      yield* seed(sessionID)
      const sessions = yield* SessionV2.Service

      const admitted = yield* sessions.admitWithSelection({
        sessionID,
        id: messageID,
        prompt: Prompt.make({ text: "hello" }),
        agent: "build",
        model: {
          id: ModelV2.ID.make("test-model"),
          providerID: ProviderV2.ID.make("test"),
          variant: ModelV2.VariantID.make("high"),
        },
      })

      expect(admitted.kind).toBe("prompt")
      const row = yield* sessionRow(sessionID)
      expect(row?.agent).toBe("build")
      expect(row?.model?.id).toBe("test-model")
      expect(row?.model?.variant).toBe("high")
      expect(yield* inputRows(messageID)).toHaveLength(1)
      // One request, one wake — not one per committed part.
      expect(wakeCalls.filter((id) => id === sessionID)).toHaveLength(1)
    }),
  )

  it.effect("an exact retry re-admits nothing and wakes nothing", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_s2_retry")
      const messageID = SessionMessage.ID.make("msg_s2_retry")
      yield* seed(sessionID)
      const sessions = yield* SessionV2.Service
      const submit = () =>
        sessions.admitWithSelection({
          sessionID,
          id: messageID,
          prompt: Prompt.make({ text: "hello" }),
          agent: "build",
        })

      const first = yield* submit()
      const second = yield* submit()

      expect(second.admittedSeq).toBe(first.admittedSeq)
      expect(yield* inputRows(messageID)).toHaveLength(1)
      expect(wakeCalls.filter((id) => id === sessionID)).toHaveLength(1)
      // Selection is idempotent too: re-applying the same agent must not append
      // a second AgentSwitched event (the V1 path guarded this; the S4 adapter
      // dropped the guard and wrote one per request).
      expect(yield* eventsOfType(sessionID, storedType(SessionEvent.AgentSwitched))).toHaveLength(1)
    }),
  )

  it.effect("a batch that fails partway commits nothing and notifies nobody", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_s2_batch_fail")
      yield* seed(sessionID)
      const events = yield* EventV2.Service
      const seen: string[] = []
      yield* events.listen((event) =>
        Effect.sync(() => {
          seen.push(event.type)
        }),
      )
      const before = yield* eventCount(sessionID)
      const duplicated = "evt_s2_duplicate"
      const switched = (agent: string, id?: string) =>
        EventV2.batchEntry(
          SessionEvent.AgentSwitched,
          {
            sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: DateTime.makeUnsafe(Date.now()),
            agent: AgentV2.ID.make(agent),
          },
          id,
        )

      // The same event id twice: `commitDurableEvent` rejects the second one, and
      // that rejection has to take the first one down with it.
      const exit = yield* events
        .publishBatch([switched("build", duplicated), switched("plan", duplicated)])
        .pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      expect(yield* eventCount(sessionID)).toBe(before)
      // Nothing committed, so nothing may have been announced. A `publish` loop
      // would already have notified subscribers about the first event here.
      expect(seen).toHaveLength(0)
    }),
  )

  it.effect("a batch that succeeds announces every event, and only after the commit", () =>
    Effect.gen(function* () {
      const sessionID = SessionV2.ID.make("ses_s2_batch_ok")
      yield* seed(sessionID)
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const seenAgentRows: Array<number> = []
      yield* events.listen((event) =>
        Effect.gen(function* () {
          if (event.type !== SessionEvent.AgentSwitched.type) return
          // Read the projected row from inside the notification: if the batch
          // announced before committing, this read would not see the new agent.
          const row = yield* db
            .select({ agent: SessionTable.agent })
            .from(SessionTable)
            .where(eq(SessionTable.id, sessionID))
            .get()
            .pipe(Effect.orDie)
          seenAgentRows.push(row?.agent === "build" ? 1 : 0)
        }),
      )

      const committed = yield* events.publishBatch([
        EventV2.batchEntry(SessionEvent.AgentSwitched, {
          sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(Date.now()),
          agent: AgentV2.ID.make("build"),
        }),
        EventV2.batchEntry(SessionEvent.ModelSwitched, {
          sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(Date.now()),
          model: { id: ModelV2.ID.make("test-model"), providerID: ProviderV2.ID.make("test") },
        }),
      ])

      expect(committed).toHaveLength(2)
      // Contiguous sequences prove they shared one transaction: the second read
      // of the aggregate sequence saw the first insert.
      const seqs = committed.map((event) => event.durable?.seq)
      expect(seqs[1]).toBe((seqs[0] ?? 0) + 1)
      expect(seenAgentRows).toEqual([1])
    }),
  )
})
