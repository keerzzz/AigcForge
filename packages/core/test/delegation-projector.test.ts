import { describe, expect } from "bun:test"
import { asc, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Bus } from "@omnixa/core/bus"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { DelegationEvent } from "@omnixa/core/delegation/event"
import { foldDelegation } from "@omnixa/core/delegation/fold"
import { DelegationProjector } from "@omnixa/core/delegation/projector"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "@omnixa/core/delegation/sql"
import { EventSequenceTable, EventTable } from "@omnixa/core/event/sql"
import { Project } from "@omnixa/core/project"
import { ProjectTable } from "@omnixa/core/project/sql"
import { AbsolutePath } from "@omnixa/core/schema"
import { SessionTable } from "@omnixa/core/session/sql"
import { DelegationID, ParticipantID, TurnID } from "@omnixa/schema/delegation-id"
import { Event } from "@omnixa/schema/event"
import { Session } from "@omnixa/schema/session"
import { SessionEvent } from "@omnixa/schema/session-event"
import { SessionID } from "@omnixa/schema/session-id"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, DelegationProjector.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)
const itWithoutPersistence = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, DelegationProjector.node])),
)

const seedDelegation = Effect.gen(function* () {
  const bus = yield* Bus.Service
  const database = yield* Database.Service
  const delegationID = DelegationID.ID.create()
  const parentSessionID = SessionID.create()
  const implementerID = ParticipantID.create()
  const reviewerID = ParticipantID.create()
  yield* database.db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .run()
  yield* database.db
    .insert(SessionTable)
    .values({
      id: parentSessionID,
      project_id: Project.ID.global,
      slug: "test",
      directory: "/project",
      title: "Delegation owner",
      version: "test",
    })
    .run()
  yield* bus.publish(DelegationEvent.Created, {
    delegationID,
    parentSessionID,
    title: "Build and review",
    status: "draft",
    timestamp: 0,
  })
  yield* bus.publish(DelegationEvent.ParticipantAdded, {
    delegationID,
    participantID: implementerID,
    provider: "internal",
    target: "build",
    role: "implementer",
    context: "fresh",
    phase: "provisioning",
    timestamp: 1,
  })
  yield* bus.publish(DelegationEvent.ParticipantAdded, {
    delegationID,
    participantID: reviewerID,
    provider: "codex",
    target: "codex",
    role: "reviewer",
    context: "fresh",
    phase: "provisioning",
    timestamp: 2,
  })
  return { bus, database, delegationID, implementerID, reviewerID }
})

describe("DelegationProjector durable batches", () => {
  it.effect("exposes only earlier batch events to each historical projector", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const sessionID = Session.ID.create()
      const observed = new Array<number[]>()
      expect(bus.retainsEvents).toBe(true)
      yield* bus.project(SessionEvent.Renamed, (event) =>
        database.db
          .select({ seq: EventTable.seq })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, event.data.sessionID))
          .orderBy(asc(EventTable.seq))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => observed.push(rows.map((row) => row.seq))),
            Effect.asVoid,
          ),
      )
      yield* bus.publish(SessionEvent.Renamed, { sessionID, title: "before batch" })
      yield* bus.publishAll([
        [SessionEvent.Renamed, { sessionID, title: "first" }],
        [SessionEvent.Renamed, { sessionID, title: "second" }],
      ])

      expect(observed).toEqual([[], [0], [0, 1]])
    }),
  )

  itWithoutPersistence.effect("requires event retention before projecting later delegation facts", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const delegationID = DelegationID.ID.create()
      const parentSessionID = SessionID.create()
      expect(bus.retainsEvents).toBe(false)
      yield* database.db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
        .run()
      yield* database.db
        .insert(SessionTable)
        .values({
          id: parentSessionID,
          project_id: Project.ID.global,
          slug: "test",
          directory: "/project",
          title: "Delegation owner",
          version: "test",
        })
        .run()
      yield* bus.publish(DelegationEvent.Created, {
        delegationID,
        parentSessionID,
        title: "Requires retained history",
        status: "draft",
        timestamp: 0,
      })
      const exit = yield* bus
        .publish(DelegationEvent.ParticipantAdded, {
          delegationID,
          participantID: ParticipantID.create(),
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          phase: "provisioning",
          timestamp: 1,
        })
        .pipe(Effect.exit)

      expect(String(exit)).toContain("Delegation.DelegationSequenceError")
      expect(
        yield* database.db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegationID)).all(),
      ).toEqual([])
      expect(
        yield* database.db
          .select({ status: DelegationTable.status })
          .from(DelegationTable)
          .where(eq(DelegationTable.id, delegationID))
          .get(),
      ).toEqual({ status: "draft" })
    }),
  )

  it.effect("preserves aggregate sequence rows initialized by the first batch projector", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const sessionID = Session.ID.create()
      yield* bus.project(SessionEvent.Renamed, (event) =>
        Bus.reserveSequence(database.db, event.data.sessionID, event.durable.seq),
      )

      yield* bus.publishAll([
        [SessionEvent.Renamed, { sessionID, title: "first" }],
        [SessionEvent.Renamed, { sessionID, title: "second" }],
      ])

      expect(
        yield* database.db
          .select({ seq: EventTable.seq })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, sessionID))
          .orderBy(asc(EventTable.seq))
          .all(),
      ).toEqual([{ seq: 0 }, { seq: 1 }])
      expect(
        yield* database.db
          .select({ seq: EventSequenceTable.seq })
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, sessionID))
          .get(),
      ).toEqual({ seq: 1 })
    }),
  )

  it.effect("projects a turn and every target delivery before notifying observers", () =>
    Effect.gen(function* () {
      const seed = yield* seedDelegation
      const turnID = TurnID.create()
      const observed = new Array<number>()
      yield* seed.bus.listen((event) => {
        if (event.durable?.aggregateID !== seed.delegationID) return Effect.void
        return seed.database.db
          .select({ seq: EventTable.seq })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, seed.delegationID))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => observed.push(rows.length)),
            Effect.asVoid,
          )
      })

      const published = yield* seed.bus.publishAll([
        [
          DelegationEvent.TurnAdmitted,
          {
            delegationID: seed.delegationID,
            turnID,
            seq: 1,
            kind: "task",
            participantIDs: [seed.implementerID, seed.reviewerID],
            delivery: "steer",
            timestamp: 3,
          },
        ],
        [
          DelegationEvent.DeliveryAdmitted,
          {
            delegationID: seed.delegationID,
            turnID,
            participantID: seed.implementerID,
            deliveryOrigin: "parent-task",
            senderParticipantID: seed.implementerID,
            attempt: 1,
            status: "admitted",
            timestamp: 3,
          },
        ],
        [
          DelegationEvent.DeliveryAdmitted,
          {
            delegationID: seed.delegationID,
            turnID,
            participantID: seed.reviewerID,
            deliveryOrigin: "parent-task",
            senderParticipantID: seed.implementerID,
            attempt: 1,
            status: "admitted",
            timestamp: 3,
          },
        ],
      ])

      const state = foldDelegation(yield* DelegationProjector.readEvents(seed.database.db, seed.delegationID))
      expect(state?.turns.get(turnID)?.participantIDs).toEqual([seed.implementerID, seed.reviewerID])
      expect(state?.deliveries.size).toBe(2)
      expect(published.map((event) => event.durable.seq)).toEqual([
        Event.Seq.make(3),
        Event.Seq.make(4),
        Event.Seq.make(5),
      ])
      expect(observed).toEqual([6, 6, 6])
      expect(
        yield* seed.database.db
          .select({ id: DelegationTurnTable.id, status: DelegationTurnTable.status })
          .from(DelegationTurnTable)
          .where(eq(DelegationTurnTable.delegation_id, seed.delegationID))
          .all(),
      ).toEqual([{ id: turnID, status: "admitted" }])
    }),
  )

  it.effect("rolls back an earlier projected prefix when a later delivery is invalid", () =>
    Effect.gen(function* () {
      const seed = yield* seedDelegation
      const turnID = TurnID.create()
      const observed = new Array<string>()
      yield* seed.bus.listen((event) =>
        Effect.sync(() => {
          observed.push(event.type)
        }),
      )
      const exit = yield* seed.bus
        .publishAll([
          [
            DelegationEvent.TurnAdmitted,
            {
              delegationID: seed.delegationID,
              turnID,
              seq: 1,
              kind: "task",
              participantIDs: [seed.implementerID],
              delivery: "steer",
              timestamp: 3,
            },
          ],
          [
            DelegationEvent.DeliveryAdmitted,
            {
              delegationID: seed.delegationID,
              turnID,
              participantID: seed.reviewerID,
              deliveryOrigin: "parent-task",
              senderParticipantID: seed.implementerID,
              attempt: 1,
              status: "admitted",
              timestamp: 3,
            },
          ],
        ])
        .pipe(Effect.exit)

      expect(String(exit)).toContain(`Participant ${seed.reviewerID} is not admitted for turn ${turnID}`)
      expect(
        yield* seed.database.db
          .select({ seq: EventTable.seq })
          .from(EventTable)
          .where(eq(EventTable.aggregate_id, seed.delegationID))
          .orderBy(asc(EventTable.seq))
          .all(),
      ).toEqual([{ seq: 0 }, { seq: 1 }, { seq: 2 }])
      expect(
        yield* seed.database.db
          .select({ seq: EventSequenceTable.seq })
          .from(EventSequenceTable)
          .where(eq(EventSequenceTable.aggregate_id, seed.delegationID))
          .get(),
      ).toEqual({ seq: 2 })
      expect(
        yield* seed.database.db
          .select({ id: DelegationTurnTable.id })
          .from(DelegationTurnTable)
          .where(eq(DelegationTurnTable.delegation_id, seed.delegationID))
          .all(),
      ).toEqual([])
      expect(
        yield* seed.database.db
          .select({ status: DelegationTable.status })
          .from(DelegationTable)
          .where(eq(DelegationTable.id, seed.delegationID))
          .get(),
      ).toEqual({ status: "draft" })
      expect(
        (yield* seed.database.db
          .select({ id: DelegationParticipantTable.id })
          .from(DelegationParticipantTable)
          .where(eq(DelegationParticipantTable.delegation_id, seed.delegationID))
          .all()).length,
      ).toBe(2)
      expect(observed).toEqual([])
    }),
  )
})
