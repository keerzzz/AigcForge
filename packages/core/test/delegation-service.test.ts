import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { DelegationService } from "../src/delegation/service"
import { DelegationEvent } from "../src/delegation/event"
import { DelegationTable, DelegationParticipantTable, DelegationTurnTable } from "../src/delegation/sql"
import { DelegationID, ParticipantID } from "@aigcfroge/schema/delegation-id"
import { RevisionDigest } from "@aigcfroge/schema/delegation"
import { ID as SessionID } from "@aigcfroge/schema/session-id"
import { testEffect } from "./lib/effect"
import { seedDelegationParentSession } from "./delegation-test-support"
import { EventTable } from "../src/event/sql"

const it = testEffect(Layer.mergeAll(DelegationService.defaultLayer, EventV2.defaultLayer, Database.defaultLayer))

const parentSessionID = SessionID.make("ses_service")

describe("DelegationService canonical EventV2 owner", () => {
  it.effect("writes through EventV2, projects facts, and folds stored events", () =>
    Effect.gen(function* () {
      const service = yield* DelegationService.Service
      const { db } = yield* Database.Service
      const delegationID = DelegationID.ID.make("dlg_service")
      const revisionDigest = RevisionDigest.make(`rev_${"a".repeat(64)}`)
      yield* seedDelegationParentSession(db, parentSessionID)

      const delegation = yield* service.create({
        delegationID,
        parentSessionID,
        title: "Service-owned delegation",
      })
      const implementer = yield* service.addParticipant({
        delegationID,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      const reviewer = yield* service.addParticipant({
        delegationID,
        provider: "codex",
        target: "review",
        role: "reviewer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID,
        kind: "task",
        promptSummary: "safe summary",
        participantIDs: [implementer.id, reviewer.id],
        delivery: "steer",
        origin: {
          deliveryOrigin: "meta",
          senderParticipantID: implementer.id,
        },
      })
      const admitted = yield* service.foldState(delegationID)
      expect(admitted?.deliveries.size).toBe(2)
      expect([...admitted!.deliveries.values()].every((delivery) => delivery.status === "admitted")).toBe(true)
      yield* service.recordDelivery({
        delegationID,
        turnID: turn.id,
        participantID: implementer.id,
        deliveryOrigin: "meta",
        senderParticipantID: implementer.id,
        attempt: 1,
        status: "completed",
        summary: "done",
      })
      yield* service.recordDelivery({
        delegationID,
        turnID: turn.id,
        participantID: reviewer.id,
        deliveryOrigin: "meta",
        senderParticipantID: implementer.id,
        attempt: 1,
        status: "completed",
      })
      yield* service.recordRevision({
        delegationID,
        turnID: turn.id,
        participantID: implementer.id,
        commitSha: "sha_service",
        revisionDigest,
        changeKind: "rework",
      })
      yield* service.recordReview({
        delegationID,
        turnID: turn.id,
        participantID: reviewer.id,
        reviewedRevisionDigest: revisionDigest,
        verdict: "approved",
        findings: [],
        summary: "approved",
      })

      const folded = yield* service.foldState(delegationID)
      expect(delegation.id).toBe(delegationID)
      expect(folded?.delegation.id).toBe(delegationID)
      expect(folded?.turns.get(turn.id)?.promptSummary).toBe("safe summary")
      expect(folded?.deliveries.size).toBe(2)
      expect([...folded!.deliveries.values()].every((delivery) => delivery.status === "completed")).toBe(true)
      const projectedDelegation = yield* db
        .select()
        .from(DelegationTable)
        .where(eq(DelegationTable.id, delegationID))
        .get()
      const projectedTurn = yield* db
        .select()
        .from(DelegationTurnTable)
        .where(eq(DelegationTurnTable.id, turn.id))
        .get()
      expect(projectedDelegation?.status).toBe(folded?.delegation.status)
      expect(projectedDelegation?.latest_revision_digest).toBe(revisionDigest)
      expect(projectedDelegation?.rejection_blocked).toBe(0)
      expect(projectedTurn?.status).toBe(folded?.turns.get(turn.id)?.status)
      expect(projectedTurn?.prompt_summary).toBe("safe summary")
      expect((yield* db.select().from(DelegationParticipantTable)).length).toBe(2)
      expect((yield* db.select().from(DelegationTurnTable)).length).toBe(1)
    }),
  )

  it.effect("serializes concurrent turn admission per delegation", () =>
    Effect.gen(function* () {
      const service = yield* DelegationService.Service
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const delegationID = DelegationID.ID.make("dlg_service_concurrent")
      const parentSessionID = SessionID.make("ses_service_concurrent")
      yield* seedDelegationParentSession(db, parentSessionID)
      yield* service.create({ delegationID, parentSessionID, title: "Concurrent admission" })
      const implementer = yield* service.addParticipant({
        delegationID,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })

      const firstStarted = yield* Deferred.make<void>()
      const releaseFirst = yield* Deferred.make<void>()
      let admitted = 0
      yield* events.project(DelegationEvent.TurnAdmitted, () =>
        Effect.gen(function* () {
          admitted += 1
          if (admitted === 1) {
            yield* Deferred.succeed(firstStarted, undefined)
            yield* Deferred.await(releaseFirst)
          }
        }),
      )

      const input = {
        delegationID,
        kind: "task" as const,
        participantIDs: [implementer.id],
        delivery: "steer" as const,
        origin: {
          deliveryOrigin: "meta",
          senderParticipantID: implementer.id,
        },
      }
      const first = yield* service.appendTurn(input).pipe(Effect.forkChild)
      yield* Deferred.await(firstStarted)
      const second = yield* service.appendTurn(input).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(admitted).toBe(1)

      yield* Deferred.succeed(releaseFirst, undefined)
      const turns = [yield* Fiber.join(first), yield* Fiber.join(second)]
      expect(turns.map((turn) => turn.seq).sort((left, right) => left - right)).toEqual([1, 2])
      expect((yield* service.foldState(delegationID))?.turns.size).toBe(2)
    }),
  )

  it.effect("fails closed on a missing parent session and unknown turn participant", () =>
    Effect.gen(function* () {
      const service = yield* DelegationService.Service
      const { db } = yield* Database.Service
      const missingParentDelegationID = DelegationID.ID.make("dlg_missing_parent")
      const missingParent = yield* service
        .create({
          delegationID: missingParentDelegationID,
          parentSessionID: SessionID.make("ses_missing_parent"),
          title: "Missing parent",
        })
        .pipe(Effect.flip)
      expect(missingParent._tag).toBe("Delegation.DelegationParentSessionNotFoundError")
      expect(yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, missingParentDelegationID))).toEqual(
        [],
      )

      const delegationID = DelegationID.ID.make("dlg_unknown_participant")
      const parentSessionID = SessionID.make("ses_unknown_participant")
      yield* seedDelegationParentSession(db, parentSessionID)
      yield* service.create({ delegationID, parentSessionID, title: "Unknown participant" })
      const participant = yield* service.addParticipant({
        delegationID,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      const before = (yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegationID))).length
      const unknownParticipant = yield* service
        .appendTurn({
          delegationID,
          kind: "task",
          participantIDs: [ParticipantID.make("par_missing")],
          delivery: "steer",
          origin: {
            deliveryOrigin: "meta",
            senderParticipantID: participant.id,
          },
        })
        .pipe(Effect.flip)
      expect(unknownParticipant._tag).toBe("Delegation.DelegationParticipantNotFoundError")
      expect((yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegationID))).length).toBe(before)
    }),
  )
})
