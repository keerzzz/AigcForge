import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "../src/database/database"
import { EventSequenceTable, EventTable } from "../src/event/sql"
import { DelegationRecovery } from "../src/delegation/recovery"
import { DelegationService } from "../src/delegation/service"
import { ID as SessionID } from "@aigcfroge/schema/session-id"
import { seedDelegationParentSession } from "./delegation-test-support"
import { ExternalCliSessionTable } from "../src/tool/cli-session.sql"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "../src/delegation/sql"
import { SessionTable } from "../src/session/sql"
import { ProjectV2 } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Layer.mergeAll(DelegationRecovery.defaultLayer, DelegationService.defaultLayer, Database.defaultLayer),
)

describe("Delegation restart recovery", () => {
  it.effect("flag off scans nothing and never restarts provider work", () =>
    Effect.gen(function* () {
      const previous = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "0"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => (process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = previous)),
      )
      expect(yield* (yield* DelegationRecovery.Service).scan()).toEqual([])
    }),
  )

  it.effect("recovery flag off reports durable candidates without executing them", () =>
    Effect.gen(function* () {
      const previousPersistent = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      const previousRecovery = process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "1"
      process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY = "0"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = previousPersistent
          process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY = previousRecovery
        }),
      )
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_recovery_scan")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Recover me" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "restart", senderParticipantID: participant.id },
      })
      expect(yield* (yield* DelegationRecovery.Service).scan()).toEqual([delegation.id])
      expect((yield* service.foldState(delegation.id))?.deliveries.values().next().value?.status).toBe("admitted")
    }),
  )

  it.effect("legacy external binding backfill is idempotent and refuses ambiguity", () =>
    Effect.gen(function* () {
      const previous = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => (process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = previous)),
      )
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const recovery = yield* DelegationRecovery.Service
      const parentSessionID = SessionID.make("ses_legacy_backfill")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Legacy binding" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })
      yield* db
        .insert(ExternalCliSessionTable)
        .values({
          id: "ecs_legacy_backfill",
          session_id: parentSessionID,
          cli_target: "codex",
          external_session_id: "thread_legacy",
          status: "active",
          time_created: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)
      expect(yield* recovery.backfillLegacyBindings()).toBe(1)
      const eventCount = (yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegation.id)).all())
        .length
      expect((yield* service.foldState(delegation.id))?.participants.get(participant.id)?.externalThreadID).toBe(
        "thread_legacy",
      )
      expect(yield* recovery.backfillLegacyBindings()).toBe(0)
      expect((yield* db.select().from(EventTable).where(eq(EventTable.aggregate_id, delegation.id)).all()).length).toBe(
        eventCount,
      )
      expect(
        (yield* db
          .select()
          .from(ExternalCliSessionTable)
          .where(eq(ExternalCliSessionTable.id, "ecs_legacy_backfill"))
          .get())?.participant_id,
      ).toBe(participant.id)
    }),
  )

  it.effect("ambiguous legacy rows enter recovery_required instead of guessing a binding", () =>
    Effect.gen(function* () {
      const previous = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => (process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = previous)),
      )
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_legacy_ambiguous")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Ambiguous legacy binding" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "legacy", senderParticipantID: participant.id },
      })
      yield* db
        .insert(ExternalCliSessionTable)
        .values(
          ["thread_legacy_a", "thread_legacy_b"].map((externalSessionID, index) => ({
            id: `ecs_legacy_ambiguous_${index}`,
            session_id: parentSessionID,
            cli_target: "codex",
            external_session_id: externalSessionID,
            status: "active" as const,
            time_created: index + 1,
            time_updated: index + 1,
          })),
        )
        .run()
        .pipe(Effect.orDie)

      expect(yield* (yield* DelegationRecovery.Service).backfillLegacyBindings()).toBe(0)
      const delivery = [...(yield* service.foldState(delegation.id))!.deliveries.values()].find(
        (item) => item.turnID === turn.id,
      )
      expect(delivery?.status).toBe("recovery_required")
      expect(delivery?.errorCode).toBe("ambiguous_legacy_binding")
      expect(
        (yield* db
          .select()
          .from(ExternalCliSessionTable)
          .where(eq(ExternalCliSessionTable.session_id, parentSessionID))
          .all()).every((row) => row.participant_id === null),
      ).toBe(true)
    }),
  )

  it.effect("legacy target mismatch enters recovery_required without overwriting the participant", () =>
    Effect.gen(function* () {
      const previous = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => (process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = previous)),
      )
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_legacy_target_mismatch")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Mismatched legacy binding" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "legacy", senderParticipantID: participant.id },
      })
      yield* db
        .insert(ExternalCliSessionTable)
        .values({
          id: "ecs_legacy_target_mismatch",
          session_id: parentSessionID,
          cli_target: "gemini",
          external_session_id: "thread_wrong_target",
          status: "active",
          time_created: 1,
          time_updated: 1,
        })
        .run()
        .pipe(Effect.orDie)

      expect(yield* (yield* DelegationRecovery.Service).backfillLegacyBindings()).toBe(0)
      const state = (yield* service.foldState(delegation.id))!
      const delivery = [...state.deliveries.values()].find((item) => item.turnID === turn.id)
      expect(delivery?.status).toBe("recovery_required")
      expect(delivery?.errorCode).toBe("legacy_binding_target_mismatch")
      expect(state.participants.get(participant.id)?.externalThreadID).toBeUndefined()
      expect(
        (yield* db
          .select()
          .from(ExternalCliSessionTable)
          .where(eq(ExternalCliSessionTable.id, "ecs_legacy_target_mismatch"))
          .get())?.participant_id,
      ).toBeNull()
    }),
  )

  it.effect("rebuilds a missing projection from EventV2 before scanning", () =>
    Effect.gen(function* () {
      const previous = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => (process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = previous)),
      )
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_projection_rebuild")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Rebuild projection" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
      })
      yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "restart", senderParticipantID: participant.id },
      })
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .delete(DelegationParticipantTable)
              .where(eq(DelegationParticipantTable.delegation_id, delegation.id))
              .run()
            yield* tx.delete(DelegationTurnTable).where(eq(DelegationTurnTable.delegation_id, delegation.id)).run()
            yield* tx.delete(DelegationTable).where(eq(DelegationTable.id, delegation.id)).run()
          }),
        )
        .pipe(Effect.orDie)

      expect(yield* (yield* DelegationRecovery.Service).scan()).toContain(delegation.id)
      expect(yield* db.select().from(DelegationTable).where(eq(DelegationTable.id, delegation.id)).get()).toBeDefined()
      expect((yield* service.foldState(delegation.id))?.participants.has(participant.id)).toBe(true)
      expect(
        yield* db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, delegation.id)).get(),
      ).toBeDefined()
    }),
  )

  it.effect("missing child Session enters recovery_required for manual takeover", () =>
    Effect.gen(function* () {
      const oldPersistent = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      const oldRecovery = process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "1"
      process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = oldPersistent
          process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY = oldRecovery
        }),
      )
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_missing_child")
      const childSessionID = SessionID.make("ses_missing_child_participant")
      yield* seedDelegationParentSession(db, parentSessionID)
      yield* db
        .insert(SessionTable)
        .values({
          id: childSessionID,
          project_id: ProjectV2.ID.global,
          parent_id: parentSessionID,
          slug: childSessionID,
          directory: AbsolutePath.make("/project"),
          title: "Missing child",
          version: "test",
          mode: "coding",
          agent: "build",
        })
        .run()
        .pipe(Effect.orDie)
      const delegation = yield* service.create({ parentSessionID, title: "Missing child recovery" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "internal",
        target: "build",
        role: "implementer",
        context: "fresh",
        childSessionID,
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "task",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "restart", senderParticipantID: participant.id },
      })
      yield* db.delete(SessionTable).where(eq(SessionTable.id, childSessionID)).run().pipe(Effect.orDie)

      yield* (yield* DelegationRecovery.Service).scan()
      const delivery = [...(yield* service.foldState(delegation.id))!.deliveries.values()].find(
        (item) => item.turnID === turn.id,
      )
      expect(delivery?.status).toBe("recovery_required")
      expect(delivery?.errorCode).toBe("missing_child_session")
    }),
  )

  it.effect("recovery marks in-flight side effects recovery_required instead of replaying", () =>
    Effect.gen(function* () {
      const oldPersistent = process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS
      const oldRecovery = process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY
      process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = "1"
      process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY = "1"
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          process.env.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS = oldPersistent
          process.env.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY = oldRecovery
        }),
      )
      const { db } = yield* Database.Service
      const service = yield* DelegationService.Service
      const parentSessionID = SessionID.make("ses_restart_unknown")
      yield* seedDelegationParentSession(db, parentSessionID)
      const delegation = yield* service.create({ parentSessionID, title: "Unknown side effect" })
      const participant = yield* service.addParticipant({
        delegationID: delegation.id,
        provider: "external",
        target: "codex",
        role: "reviewer",
        context: "fresh",
      })
      const turn = yield* service.appendTurn({
        delegationID: delegation.id,
        kind: "review",
        participantIDs: [participant.id],
        delivery: "steer",
        origin: { deliveryOrigin: "restart", senderParticipantID: participant.id },
      })
      yield* service.recordDelivery({
        delegationID: delegation.id,
        turnID: turn.id,
        participantID: participant.id,
        deliveryOrigin: "restart",
        senderParticipantID: participant.id,
        attempt: 1,
        status: "started",
      })
      yield* (yield* DelegationRecovery.Service).scan()
      expect((yield* service.foldState(delegation.id))?.deliveries.values().next().value?.status).toBe(
        "recovery_required",
      )
    }),
  )
})
