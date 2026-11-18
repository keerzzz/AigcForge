import { describe, expect } from "bun:test"
import { inArray } from "drizzle-orm"
import { Deferred, Effect, Fiber, Layer, Scope } from "effect"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { EventSequenceTable, EventTable } from "@aigcfroge/core/event/sql"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionInbox } from "@aigcfroge/core/session/inbox"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionStore } from "@aigcfroge/core/session/store"
import { TaskOperation } from "@aigcfroge/core/session/task-operation"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Consultation } from "@aigcfroge/core/session/consultation"
import { SessionTaskEvent } from "@aigcfroge/schema/session-task-event"
import { Agent } from "@aigcfroge/schema/agent"
import { Event } from "@aigcfroge/schema/event"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Location } from "@aigcfroge/schema/location"
import { SessionConsultation } from "@aigcfroge/schema/session-consultation"
import { SessionInboxTable, SessionMessageTable } from "@aigcfroge/core/session/sql"
import { Project } from "@aigcfroge/schema/project"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Session } from "@aigcfroge/schema/session"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionInbox.node,
      SessionProjector.node,
      SessionStore.node,
      SessionTask.node,
    ]),
    [Bus.node.replace(Bus.configured({ persist: true }))],
  ),
)

const setup = Effect.fnUntraced(function* () {
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const admission = yield* SessionInbox.Service
  const store = yield* SessionStore.Service
  const sessionID = Session.ID.make("ses_admission")
  const otherID = Session.ID.make("ses_admission_other")
  const id = SessionMessage.ID.make("msg_admission")
  const directory = AbsolutePath.make("/admission")
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: directory, sandboxes: [] })
    .run()
    .pipe(Effect.orDie)
  yield* Effect.forEach(
    [sessionID, otherID],
    (sessionID) =>
      bus.publish(SessionEvent.Created, {
        sessionID,
        projectID: Project.ID.global,
        location: { directory },
        slug: "admission",
        version: "test",
      }),
    { discard: true },
  )
  return { database, bus, admission, store, sessionID, otherID, id }
})

const item = (type: "user" | "synthetic", text: string, delivery: SessionInbox.Delivery = "steer") =>
  type === "user"
    ? {
        type: "user" as const,
        payload: SessionInbox.UserPayload.make({ text, metadata: { claim: text } }),
        delivery,
      }
    : {
        type: "synthetic" as const,
        payload: SessionInbox.SyntheticPayload.make({ text, description: text, metadata: { claim: text } }),
        delivery,
      }

const gatedAdmission = Effect.fnUntraced(function* (bus: Bus.Interface) {
  const entered = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  const publish: Bus.Interface["publish"] = (definition, data, options) => {
    if (definition.type !== SessionEvent.InboxEnqueued.type) return bus.publish(definition, data, options)
    return Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.andThen(bus.publish(definition, data, options)),
    )
  }
  const admission = yield* SessionInbox.make().pipe(
    Effect.provideService(Bus.Service, Bus.Service.of({ ...bus, publish })),
  )
  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
  return { admission, entered, release }
})

const state = Effect.fnUntraced(function* (sessionIDs: readonly Session.ID[]) {
  const database = yield* Database.Service
  return {
    pending: yield* database.db.select().from(SessionInboxTable).orderBy(SessionInboxTable.id).all().pipe(Effect.orDie),
    messages: yield* database.db
      .select()
      .from(SessionMessageTable)
      .orderBy(SessionMessageTable.id)
      .all()
      .pipe(Effect.orDie),
    events: yield* database.db
      .select()
      .from(EventTable)
      .where(inArray(EventTable.aggregate_id, [...sessionIDs]))
      .orderBy(EventTable.aggregate_id, EventTable.seq)
      .all()
      .pipe(Effect.orDie),
    sequences: yield* database.db
      .select()
      .from(EventSequenceTable)
      .where(inArray(EventSequenceTable.aggregate_id, [...sessionIDs]))
      .orderBy(EventSequenceTable.aggregate_id)
      .all()
      .pipe(Effect.orDie),
  }
})

const operationRequest = (sourceSessionID: Session.ID, targetSessionID: Session.ID, inputID: SessionMessage.ID) => ({
  sessionID: sourceSessionID,
  request: new SessionTask.OperationRequest({
    operationID: SessionTask.OperationID.make("top_admission_owner"),
    inputID,
    target: new SessionTask.OperationExistingRootTarget({ type: "existing_root", sessionID: targetSessionID }),
    prompt: "frozen operation input",
    delivery: "queue",
    resume: false,
  }),
  source: new SessionTask.OperationUserSource({
    type: "user_coordination",
    sessionID: sourceSessionID,
    agent: Agent.ID.make("meta"),
  }),
  selection: new SessionTask.OperationSelection({ agent: Agent.ID.make("meta"), seq: Event.Seq.make(0) }),
  sourceLocation: Location.Ref.make({ directory: AbsolutePath.make("/admission") }),
  sourceMode: ProductMode.ID.make("coding"),
})

describe("Task operation input ownership", () => {
  it.live("keeps identical operation IDs from two sources separate in messages and permissions", () =>
    Effect.gen(function* () {
      const f = yield* setup()
      const tasks = yield* SessionTask.Service
      const a = yield* tasks.reserveOperation(operationRequest(f.sessionID, f.otherID, f.id))
      const b = yield* tasks.reserveOperation(
        operationRequest(f.otherID, f.sessionID, SessionMessage.ID.make("msg_other_operation")),
      )
      const aRef = { sessionID: a.operation.sourceSessionID, operationID: a.operation.operationID }
      const bRef = { sessionID: b.operation.sourceSessionID, operationID: b.operation.operationID }
      expect(TaskOperation.permissionID(aRef)).not.toBe(TaskOperation.permissionID(bRef))
      expect(TaskOperation.statusMessageID(aRef)).not.toBe(TaskOperation.statusMessageID(bRef))
      expect((yield* f.store.message(TaskOperation.statusMessageID(aRef)))?.sessionID).toBe(f.sessionID)
      expect((yield* f.store.message(TaskOperation.statusMessageID(bRef)))?.sessionID).toBe(f.otherID)
    }),
  )

  it.live("rejects ordinary admission that loses to a committed operation reservation", () =>
    Effect.gen(function* () {
      const f = yield* setup()
      const gate = yield* gatedAdmission(f.bus)
      const scope = yield* Scope.Scope
      const loser = yield* gate.admission
        .admit({ id: f.id, sessionID: f.otherID, item: item("user", "unrelated input") })
        .pipe(Effect.forkIn(scope))
      yield* awaitWithTimeout(Deferred.await(gate.entered), "Ordinary input did not reach the publication gate")
      const tasks = yield* SessionTask.Service
      const operation = yield* tasks.reserveOperation(operationRequest(f.sessionID, f.otherID, f.id))
      yield* Deferred.succeed(gate.release, undefined)
      expect(
        yield* awaitWithTimeout(
          Fiber.join(loser).pipe(Effect.flip),
          "Ordinary input did not lose its reservation race",
        ),
      ).toMatchObject({ _tag: "SessionInbox.LifecycleConflict" })
      expect(yield* SessionInbox.find(f.database.db, f.id)).toBeUndefined()
      expect(yield* tasks.operation({ sessionID: f.sessionID, operationID: operation.operation.operationID })).toEqual(
        operation.operation,
      )
    }),
  )

  it.live("rechecks a delayed reservation after ordinary admission commits", () =>
    Effect.gen(function* () {
      const f = yield* setup()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      const publish: Bus.Interface["publish"] = (definition, data, options) =>
        definition.type !== SessionTaskEvent.OperationReserved.type
          ? f.bus.publish(definition, data, options)
          : Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(f.bus.publish(definition, data, options)),
            )
      const tasks = yield* SessionTask.Service.pipe(
        Effect.provide(
          Layer.fresh(
            SessionTask.layer.pipe(Layer.provide(Layer.succeed(Bus.Service, Bus.Service.of({ ...f.bus, publish })))),
          ),
        ),
      )
      const scope = yield* Scope.Scope
      const loser = yield* tasks
        .reserveOperation(operationRequest(f.sessionID, f.otherID, f.id))
        .pipe(Effect.forkIn(scope))
      yield* awaitWithTimeout(Deferred.await(entered), "Operation reservation did not reach publication")
      yield* f.admission.admit({ id: f.id, sessionID: f.otherID, item: item("user", "ordinary winner") })
      yield* Deferred.succeed(release, undefined)
      expect(
        yield* awaitWithTimeout(
          Fiber.join(loser).pipe(Effect.flip),
          "Operation reservation did not lose the input race",
        ),
      ).toMatchObject({ reason: "input_owned" })
      expect(yield* tasks.operations({ sessionID: f.sessionID })).toEqual([])
      expect(yield* SessionInbox.find(f.database.db, f.id)).toMatchObject({ payload: { text: "ordinary winner" } })
    }),
  )

  for (const first of ["consultation", "task"] as const) {
    it.live(`keeps the first ${first} reservation as the sole input owner`, () =>
      Effect.gen(function* () {
        const f = yield* setup()
        const tasks = yield* SessionTask.Service
        const consultation = f.database.db
          .transaction(() =>
            Consultation.reserve(f.database.db, f.otherID, {
              firstMessageID: f.id,
              reference: SessionConsultation.Reference.make({
                sourceSessionID: f.sessionID,
                boundary: { type: "through", messageID: SessionMessage.ID.make("msg_reference") },
                boundarySeq: Event.Seq.make(0),
                sourceMessageIDs: [],
                digest: "frozen",
                omissions: [],
                file: { data: "", mime: "text/plain", source: { type: "inline" } },
              }),
            }),
          )
          .pipe(Effect.orDie)
        const reservation = tasks.reserveOperation(operationRequest(f.sessionID, f.otherID, f.id))
        yield* first === "consultation" ? consultation : reservation
        const failed = yield* (first === "consultation" ? reservation : consultation).pipe(Effect.exit)
        expect(failed._tag).toBe("Failure")
        expect((yield* tasks.operations({ sessionID: f.sessionID })).length).toBe(first === "task" ? 1 : 0)
        expect((yield* Consultation.get(f.database.db, f.otherID)) !== undefined).toBe(first === "consultation")
      }),
    )
  }

  it.live("reconciles only the frozen committed operation carrier before and after promotion", () =>
    Effect.gen(function* () {
      const f = yield* setup()
      const tasks = yield* SessionTask.Service
      const input = operationRequest(f.sessionID, f.otherID, f.id)
      yield* tasks.reserveOperation(input)
      const payload = SessionInbox.UserPayload.make({ text: input.request.prompt })
      const prepared = new SessionTask.OperationPrepared({
        payload,
        delivery: "queue",
        digest: TaskOperation.payloadDigest(payload, "queue"),
      })
      yield* tasks.advanceOperation({
        sessionID: f.sessionID,
        operationID: input.request.operationID,
        change: new SessionTask.OperationChange({ phase: "prepared", prepared }),
      })
      const operation = new SessionTask.OperationReadonlyRef({
        sourceSessionID: f.sessionID,
        operationID: input.request.operationID,
      })
      yield* f.admission.admit({
        id: f.id,
        sessionID: f.otherID,
        item: { type: "user", payload, delivery: "queue" },
        operation,
      })
      const lookup = { id: f.id, sessionID: f.otherID, type: "user" as const, delivery: "queue" as const, operation }
      expect(yield* f.admission.reconcile(lookup)).toMatchObject({ payload })
      expect(
        (yield* tasks.operation({ sessionID: f.sessionID, operationID: operation.operationID }))?.admission,
      ).toBeDefined()
      expect(yield* SessionInbox.promote(f.database.db, f.bus, f.otherID, "input")).toBe(1)
      expect(yield* f.admission.reconcile(lookup)).toMatchObject({ payload })
      expect(yield* f.admission.reconcile({ ...lookup, delivery: "steer" }).pipe(Effect.flip)).toMatchObject({
        _tag: "SessionInbox.LifecycleConflict",
      })
    }),
  )
})

describe("SessionInbox admission promotion race", () => {
  for (const type of ["user", "synthetic"] as const) {
    it.live(`reconciles a losing ${type} admission after the winner becomes visible`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        const gate = yield* gatedAdmission(fixture.bus)
        const scope = yield* Scope.Scope
        const loser = yield* gate.admission
          .admit({ id: fixture.id, sessionID: fixture.sessionID, item: item(type, "Late retry", "queue") })
          .pipe(Effect.forkIn(scope))
        yield* awaitWithTimeout(Deferred.await(gate.entered), "Losing admission did not finish its missing preflight")
        expect(yield* SessionInbox.find(fixture.database.db, fixture.id)).toBeUndefined()
        expect(yield* fixture.store.message(fixture.id)).toBeUndefined()

        const winner = yield* fixture.admission.admit({
          id: fixture.id,
          sessionID: fixture.sessionID,
          item: item(type, "First payload"),
        })
        expect(yield* SessionInbox.promote(fixture.database.db, fixture.bus, fixture.sessionID, "steer")).toBe(1)
        const committed = yield* state([fixture.sessionID, fixture.otherID])
        expect(committed.pending).toEqual([])
        expect(committed.messages).toHaveLength(1)
        expect(committed.messages.at(0)).toMatchObject({ id: fixture.id, session_id: fixture.sessionID, type })
        expect(yield* fixture.store.message(fixture.id)).toMatchObject({
          sessionID: fixture.sessionID,
          message: { id: fixture.id, type, text: "First payload", metadata: { claim: "First payload" } },
        })
        const enqueued = committed.events.filter(
          (event) => event.type === Bus.versionedType(SessionEvent.InboxEnqueued.type, 1),
        )
        expect(enqueued).toHaveLength(1)
        expect(enqueued.at(0)?.data).toMatchObject({
          inboxID: fixture.id,
          sessionID: fixture.sessionID,
          item: { type, payload: winner.payload, delivery: "steer" },
        })
        expect(
          committed.events.filter((event) => event.type === Bus.versionedType(SessionEvent.InboxDelivered.type, 1)),
        ).toHaveLength(1)

        yield* Deferred.succeed(gate.release, undefined)
        expect(yield* awaitWithTimeout(Fiber.join(loser), "Promoted duplicate admission did not finish")).toMatchObject(
          {
            id: fixture.id,
            sessionID: fixture.sessionID,
            type,
            payload: winner.payload,
          },
        )
        expect(yield* state([fixture.sessionID, fixture.otherID])).toEqual(committed)
        expect(
          yield* fixture.admission.admit({
            id: fixture.id,
            sessionID: fixture.sessionID,
            item: item(type, "Another retry"),
          }),
        ).toMatchObject({ id: fixture.id, sessionID: fixture.sessionID, type, payload: winner.payload })
        expect(yield* state([fixture.sessionID, fixture.otherID])).toEqual(committed)
      }),
    )
  }

  for (const conflict of ["session", "type"] as const) {
    it.live(`rejects a conflicting ${conflict} after a competing user admission is promoted`, () =>
      Effect.gen(function* () {
        const fixture = yield* setup()
        const gate = yield* gatedAdmission(fixture.bus)
        const scope = yield* Scope.Scope
        const loser = yield* gate.admission
          .admit({
            id: fixture.id,
            sessionID: conflict === "session" ? fixture.otherID : fixture.sessionID,
            item: item(conflict === "type" ? "synthetic" : "user", "Conflicting payload"),
          })
          .pipe(Effect.forkIn(scope))
        yield* awaitWithTimeout(Deferred.await(gate.entered), "Conflicting admission did not reach its publish gate")
        yield* fixture.admission.admit({
          id: fixture.id,
          sessionID: fixture.sessionID,
          item: item("user", "First payload"),
        })
        expect(yield* SessionInbox.promote(fixture.database.db, fixture.bus, fixture.sessionID, "steer")).toBe(1)
        const committed = yield* state([fixture.sessionID, fixture.otherID])
        yield* Deferred.succeed(gate.release, undefined)
        expect(
          yield* awaitWithTimeout(Fiber.join(loser).pipe(Effect.flip), "Conflicting admission was not rejected"),
        ).toMatchObject({ _tag: "SessionInbox.LifecycleConflict", id: fixture.id })
        expect(yield* state([fixture.sessionID, fixture.otherID])).toEqual(committed)
        expect(committed.pending).toEqual([])
        expect(committed.messages).toHaveLength(1)
        expect(yield* fixture.store.message(fixture.id)).toMatchObject({
          sessionID: fixture.sessionID,
          message: { type: "user", text: "First payload" },
        })
      }),
    )
  }

  it.live("retains the generic compaction conflict while its dedicated admission coalesces", () =>
    Effect.gen(function* () {
      const fixture = yield* setup()
      const gate = yield* gatedAdmission(fixture.bus)
      const scope = yield* Scope.Scope
      const loser = yield* gate.admission
        .admit({
          id: fixture.id,
          sessionID: fixture.sessionID,
          item: { type: "compaction", payload: {}, delivery: "steer" },
        })
        .pipe(Effect.forkIn(scope))
      yield* awaitWithTimeout(Deferred.await(gate.entered), "Compaction admission did not reach its publish gate")
      const winner = yield* fixture.admission.admitCompaction({
        id: fixture.id,
        sessionID: fixture.sessionID,
        delivery: "steer",
      })
      const committed = yield* state([fixture.sessionID, fixture.otherID])
      yield* Deferred.succeed(gate.release, undefined)
      expect(
        yield* awaitWithTimeout(Fiber.join(loser).pipe(Effect.flip), "Generic compaction retry was not rejected"),
      ).toMatchObject({ _tag: "SessionInbox.LifecycleConflict", id: fixture.id })
      expect(yield* state([fixture.sessionID, fixture.otherID])).toEqual(committed)
      expect(
        yield* fixture.admission.admitCompaction({
          id: fixture.id,
          sessionID: fixture.sessionID,
          delivery: "queue",
        }),
      ).toEqual(winner)
      expect(
        yield* fixture.admission.admitCompaction({
          id: SessionMessage.ID.make("msg_compaction_other"),
          sessionID: fixture.sessionID,
          delivery: "queue",
        }),
      ).toEqual(winner)
      expect(yield* SessionInbox.promote(fixture.database.db, fixture.bus, fixture.sessionID, "input")).toBeUndefined()
      expect(yield* state([fixture.sessionID, fixture.otherID])).toEqual(committed)
      expect(committed.pending).toHaveLength(1)
      expect(committed.messages).toEqual([])
      expect(
        committed.events.filter((event) => event.type === Bus.versionedType(SessionEvent.InboxEnqueued.type, 1)),
      ).toHaveLength(1)
    }),
  )
})
