import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Exit } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { EventTable } from "../src/event/sql"
import { DelegationProjector } from "../src/delegation/projector"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { ID as SessionID } from "@aigcfroge/schema/session-id"
import { DelegationEvent } from "../src/delegation/event"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "../src/delegation/sql"
import { seedDelegationParentSession, testDelegationBaseLayer } from "./delegation-test-support"
import { testEffect } from "./lib/effect"

const it = testEffect(testDelegationBaseLayer)

const publishProjectedSequence = (delegationID: DelegationID.ID, parentSessionID: SessionID) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const participantID = ParticipantID.make(`par_${delegationID.slice(4)}_participant`)
    const turnID = TurnID.make(`trn_${delegationID.slice(4)}_turn`)
    const timestamp = 1700000000000

    yield* events.publish(DelegationEvent.Created, {
      delegationID,
      parentSessionID,
      title: "Projector test",
      status: "draft",
      timestamp,
    })
    yield* events.publish(DelegationEvent.ParticipantAdded, {
      delegationID,
      participantID,
      provider: "internal",
      target: "build",
      role: "implementer",
      context: "fresh",
      phase: "provisioning",
      timestamp: timestamp + 1,
    })
    yield* events.publish(DelegationEvent.TurnAdmitted, {
      delegationID,
      turnID,
      seq: 1,
      kind: "task",
      promptSummary: "bounded summary",
      participantIDs: [participantID],
      delivery: "steer",
      timestamp: timestamp + 2,
    })
    yield* events.publish(DelegationEvent.DeliveryAdmitted, {
      delegationID,
      turnID,
      participantID,
      deliveryOrigin: "build",
      senderParticipantID: participantID,
      attempt: 1,
      status: "admitted",
      timestamp: timestamp + 2,
    })
    yield* events.publish(DelegationEvent.DeliveryStarted, {
      delegationID,
      turnID,
      participantID,
      deliveryOrigin: "build",
      senderParticipantID: participantID,
      attempt: 1,
      timestamp: timestamp + 3,
    })
    yield* events.publish(DelegationEvent.DeliveryCompleted, {
      delegationID,
      turnID,
      participantID,
      deliveryOrigin: "build",
      senderParticipantID: participantID,
      attempt: 1,
      summary: "completed",
      timestamp: timestamp + 4,
    })

    return { participantID, turnID }
  })

describe("Delegation EventV2 projector", () => {
  it.effect("keeps projection status and turn status equal to folded durable state", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationID = DelegationID.ID.make("dlg_projector")
      const parentSessionID = SessionID.make("ses_projector")
      yield* seedDelegationParentSession(db, parentSessionID)
      const { participantID, turnID } = yield* publishProjectedSequence(delegationID, parentSessionID)

      const delegation = yield* db.select().from(DelegationTable).where(eq(DelegationTable.id, delegationID)).get()
      const participant = yield* db
        .select()
        .from(DelegationParticipantTable)
        .where(
          and(
            eq(DelegationParticipantTable.id, participantID),
            eq(DelegationParticipantTable.delegation_id, delegationID),
          ),
        )
        .get()
      const turn = yield* db.select().from(DelegationTurnTable).where(eq(DelegationTurnTable.id, turnID)).get()

      expect(delegation?.status).toBe("approved")
      expect(delegation?.last_activity_at).toBe(1700000000004)
      expect(participant?.phase).toBe("provisioning")
      expect(turn?.status).toBe("completed")
      expect(turn?.prompt_summary).toBe("bounded summary")
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegationID))).toHaveLength(6)
    }),
  )

  it.effect("rebuilds all three projections from EventV2 after projection loss", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const delegationID = DelegationID.ID.make("dlg_projector_rebuild")
      const parentSessionID = SessionID.make("ses_projector_rebuild")
      yield* seedDelegationParentSession(db, parentSessionID)
      const { participantID, turnID } = yield* publishProjectedSequence(delegationID, parentSessionID)

      yield* db
        .delete(DelegationParticipantTable)
        .where(eq(DelegationParticipantTable.delegation_id, delegationID))
        .run()
      yield* db.delete(DelegationTurnTable).where(eq(DelegationTurnTable.delegation_id, delegationID)).run()
      yield* db.delete(DelegationTable).where(eq(DelegationTable.id, delegationID)).run()
      expect(yield* db.select().from(DelegationTable).where(eq(DelegationTable.id, delegationID))).toEqual([])

      yield* DelegationProjector.rebuild(db, delegationID)

      expect(yield* db.select().from(DelegationTable).where(eq(DelegationTable.id, delegationID))).toHaveLength(1)
      expect(
        yield* db
          .select()
          .from(DelegationParticipantTable)
          .where(
            and(
              eq(DelegationParticipantTable.id, participantID),
              eq(DelegationParticipantTable.delegation_id, delegationID),
            ),
          ),
      ).toHaveLength(1)
      const turn = yield* db.select().from(DelegationTurnTable).where(eq(DelegationTurnTable.id, turnID)).get()
      expect(turn?.status).toBe("completed")
      expect(turn?.prompt_summary).toBe("bounded summary")
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegationID))).toHaveLength(6)
    }),
  )

  it.effect("rolls back a projector failure and does not notify listeners", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const delegationID = DelegationID.ID.make("dlg_projector_rollback")
      const participantID = ParticipantID.make("par_projector_rollback")
      const parentSessionID = SessionID.make("ses_projector_rollback")
      yield* seedDelegationParentSession(db, parentSessionID)
      yield* events.publish(DelegationEvent.Created, {
        delegationID,
        parentSessionID,
        title: "Rollback test",
        status: "draft",
        timestamp: 1700000000000,
      })
      let notifications = 0
      yield* events.listen(() =>
        Effect.sync(() => {
          notifications += 1
        }),
      )
      yield* events.project(DelegationEvent.ParticipantAdded, () => Effect.die("projector failed"))

      const result = yield* events
        .publish(DelegationEvent.ParticipantAdded, {
          delegationID,
          participantID,
          provider: "internal",
          target: "build",
          role: "implementer",
          context: "fresh",
          phase: "provisioning",
          timestamp: 1700000000001,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(result)).toBe(true)
      expect(notifications).toBe(0)
      expect(
        yield* db
          .select()
          .from(DelegationParticipantTable)
          .where(
            and(
              eq(DelegationParticipantTable.id, participantID),
              eq(DelegationParticipantTable.delegation_id, delegationID),
            ),
          ),
      ).toEqual([])
      expect(yield* db.select().from(DelegationTable).where(eq(DelegationTable.id, delegationID))).toHaveLength(1)
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegationID))).toHaveLength(1)
    }),
  )
})
