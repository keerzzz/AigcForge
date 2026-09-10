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

describe("DelegationService Phase 6 command surface", () => {
  it.effect("lists fifty delegations below the projection threshold", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_phase6_perf")
      yield* seedDelegationParentSession(db, parentSessionID)
      yield* Effect.forEach(
        Array.from({ length: 50 }, (_, index) => index),
        (index) => service.create({ parentSessionID, title: `Delegation ${index}` }),
        { discard: true },
      )
      const samples = yield* Effect.forEach(
        Array.from({ length: 20 }, (_, index) => index),
        () =>
          Effect.gen(function* () {
            const started = performance.now()
            const rows = yield* service.list({ parentSessionID })
            expect(rows).toHaveLength(50)
            return performance.now() - started
          }),
      )
      const p95 = [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1]
      expect(p95).toBeLessThan(200)
    }),
  )

  it.effect("lists by parent, retries only terminal attempts, and preserves the Turn identity", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_phase6_commands")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Phase 6 commands" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        promptSummary: "retry me",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "phase6", senderParticipantID: participant.id },
      })
      yield* service.recordDelivery({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        deliveryOrigin: "phase6",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "failed",
      })
      yield* service.retry({ delegationID: delegation.id, turnID: turn.id, participantID: participant.id })
      const state = yield* service.foldState(delegation.id)
      const delivery = [...state!.deliveries.values()].find((item) => item.turnID === turn.id)
      expect(delivery?.attempt).toBe(2)
      expect(delivery?.status).toBe("admitted")
      expect((yield* service.listTurns(delegation.id)).map((item) => item.id)).toEqual([turn.id])
      expect((yield* service.list({ parentSessionID })).map((item) => item.delegation.id)).toEqual([delegation.id])
      expect((yield* service.getParticipant({ delegationID: delegation.id, participantID: participant.id })).id).toBe(
        participant.id,
      )
    }),
  )

  it.effect("forks roster handles without reusing provider bindings", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_phase6_fork")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Original" })
      yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      const forked = yield* service.fork({ delegationID: delegation.id, reason: "alternate approach" })
      expect(forked.delegation.id).not.toBe(delegation.id)
      expect([...forked.participants.values()].map((item) => item.context)).toEqual(["fork"])
    }),
  )

  it.effect("participant admission is idempotent for the same roster key", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_participant_idempotency")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Idempotent roster" })
      const input = {
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer" as const,
        context: "fresh" as const,
      }
      const first = yield* service.addParticipant(input)
      const second = yield* service.addParticipant(input)
      expect(second.id).toBe(first.id)
      expect((yield* service.foldState(delegation.id))?.participants.size).toBe(1)
    }),
  )

  it.effect("soft-expired delegations are visible for audit but not reused as the current focus", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_soft_expired")
      yield* seedDelegationParentSession(db, parentSessionID)
      const old = yield* service.create({ parentSessionID, title: "Old delegation" })
      yield* db
        .update(DelegationTable)
        .set({ last_activity_at: -8 * 86_400_000 })
        .where(eq(DelegationTable.id, old.id))
        .run()
        .pipe(Effect.orDie)
      expect(
        (yield* service.list({ parentSessionID, includeArchived: true })).map((item) => item.delegation.id),
      ).toEqual([old.id])
      expect(yield* service.resolveActive(parentSessionID)).toBeUndefined()
      const current = yield* service.resolve({ parentSessionID, title: "New delegation" })
      expect(current.delegation.id).not.toBe(old.id)
    }),
  )
})
