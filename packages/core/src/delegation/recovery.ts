export * as DelegationRecovery from "./recovery"

import { Context, Effect, Layer } from "effect"

import { Database } from "../database/database"
import { DelegationParticipantTable, DelegationTable } from "./sql"
import { ExternalCliSessionTable } from "../tool/cli-session.sql"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { DelegationID, ParticipantID } from "@aigcfroge/schema/delegation-id"
import { DelegationService } from "./service"
import type { ServiceError } from "./service"
import { Flag } from "../flag/flag"
import { LayerNode } from "../effect/layer-node"
import { EventTable } from "../event/sql"
import { DelegationProjector } from "./projector"
import { SessionTable } from "../session/sql"
import { EventV2 } from "../event"
import { DelegationEvent } from "./event"

export interface Interface {
  readonly scan: () => Effect.Effect<readonly string[], ServiceError>
  readonly backfillLegacyBindings: () => Effect.Effect<number, ServiceError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/DelegationRecovery") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const delegations = yield* DelegationService.Service
    const rebuildMissingProjections = Effect.fnUntraced(function* () {
      const [aggregates, projections] = yield* Effect.all([
        db
          .select({ id: EventTable.aggregate_id })
          .from(EventTable)
          .where(eq(EventTable.type, EventV2.versionedType(DelegationEvent.Created.type, 1)))
          .all()
          .pipe(Effect.orDie),
        db.select({ id: DelegationTable.id }).from(DelegationTable).all().pipe(Effect.orDie),
      ])
      const projected = new Set(projections.map((row) => row.id))
      yield* Effect.forEach(
        aggregates.map((row) => DelegationID.ID.make(row.id)).filter((delegationID) => !projected.has(delegationID)),
        (delegationID) => DelegationProjector.rebuild(db, delegationID),
        { discard: true },
      )
    })

    const scan = Effect.fn("DelegationRecovery.scan")(function* () {
      if (!Flag.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS) return []
      yield* rebuildMissingProjections()
      const rows = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(
          inArray(DelegationTable.status, [
            "running",
            "waiting_review",
            "changes_requested",
            "failed",
            "recovery_required",
          ]),
        )
        .all()
        .pipe(Effect.orDie)
      if (!Flag.AIGCFROGE_EXPERIMENTAL_DELEGATION_RECOVERY) return rows.map((row) => row.id)
      yield* Effect.forEach(
        rows,
        (row) =>
          Effect.gen(function* () {
            const state = yield* delegations.foldState(row.id)
            if (!state) return
            const childSessionIDs = [...state.participants.values()]
              .map((participant) => participant.childSessionID)
              .filter((sessionID) => sessionID !== undefined)
            const existingChildSessions =
              childSessionIDs.length === 0
                ? []
                : yield* db
                    .select({ id: SessionTable.id })
                    .from(SessionTable)
                    .where(inArray(SessionTable.id, childSessionIDs))
                    .all()
                    .pipe(Effect.orDie)
            const existingChildSessionIDs = new Set(existingChildSessions.map((session) => session.id))
            for (const delivery of state.deliveries.values()) {
              const participant = state.participants.get(delivery.participantID)
              const missingChildSession =
                participant?.childSessionID !== undefined && !existingChildSessionIDs.has(participant.childSessionID)
              if (!missingChildSession && delivery.status !== "running") continue
              if (!["admitted", "queued", "running"].includes(delivery.status)) continue
              yield* delegations.recordDelivery({
                delegationID: row.id,
                turnID: delivery.turnID,
                participantID: delivery.participantID,
                deliveryOrigin: delivery.deliveryOrigin,
                senderParticipantID: delivery.senderParticipantID,
                attempt: delivery.attempt,
                status: "recovery_required",
                errorCode: missingChildSession ? "missing_child_session" : "restart_unknown_side_effect",
                summary: missingChildSession
                  ? `Child Session ${participant.childSessionID} is missing and requires manual reconciliation`
                  : "Process restarted before provider side effects were confirmed",
              })
            }
          }),
        { discard: true },
      )
      return rows.map((row) => row.id)
    })

    const markBindingRecovery = Effect.fnUntraced(function* (
      candidates: readonly { readonly id: ParticipantID; readonly delegation_id: DelegationID.ID }[],
      errorCode: string,
      summary: string,
    ) {
      yield* Effect.forEach(
        candidates,
        (candidate) =>
          Effect.gen(function* () {
            const state = yield* delegations.foldState(candidate.delegation_id)
            if (!state) return
            const delivery = [...state.deliveries.values()]
              .filter(
                (item) =>
                  item.participantID === candidate.id && ["admitted", "queued", "running"].includes(item.status),
              )
              .sort((left, right) => right.attempt - left.attempt || right.updatedAt - left.updatedAt)[0]
            if (!delivery) {
              yield* Effect.logWarning("Legacy CLI binding requires manual reconciliation", {
                delegationID: candidate.delegation_id,
                participantID: candidate.id,
                errorCode,
              })
              return
            }
            yield* delegations.recordDelivery({
              delegationID: candidate.delegation_id,
              turnID: delivery.turnID,
              participantID: delivery.participantID,
              deliveryOrigin: delivery.deliveryOrigin,
              senderParticipantID: delivery.senderParticipantID,
              attempt: delivery.attempt,
              status: "recovery_required",
              errorCode,
              summary,
            })
          }),
        { discard: true },
      )
    })

    const backfillLegacyBindings = Effect.fn("DelegationRecovery.backfillLegacyBindings")(function* () {
      if (!Flag.AIGCFROGE_EXPERIMENTAL_PERSISTENT_DELEGATIONS) return 0
      const rows = yield* db
        .select()
        .from(ExternalCliSessionTable)
        .where(isNull(ExternalCliSessionTable.participant_id))
        .all()
        .pipe(Effect.orDie)
      const groups = Map.groupBy(rows, (row) => `${row.session_id}\0${row.cli_target}`)
      let changed = 0
      for (const group of groups.values()) {
        const row = group[0]
        if (!row) continue
        const exactCandidates = yield* db
          .select({ id: DelegationParticipantTable.id, delegation_id: DelegationParticipantTable.delegation_id })
          .from(DelegationParticipantTable)
          .innerJoin(DelegationTable, eq(DelegationTable.id, DelegationParticipantTable.delegation_id))
          .where(
            and(
              eq(DelegationTable.parent_session_id, row.session_id),
              eq(DelegationParticipantTable.target, row.cli_target),
              isNull(DelegationParticipantTable.external_thread_id),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        if (group.length > 1 || exactCandidates.length > 1) {
          yield* markBindingRecovery(
            exactCandidates,
            "ambiguous_legacy_binding",
            "Multiple legacy external CLI bindings require manual reconciliation",
          )
          continue
        }
        if (exactCandidates.length === 1) {
          const participantID = ParticipantID.make(exactCandidates[0].id)
          yield* delegations.bindParticipant({
            delegationID: exactCandidates[0].delegation_id,
            participantID,
            externalThreadID: row.external_session_id,
          })
          yield* db
            .update(ExternalCliSessionTable)
            .set({ participant_id: participantID })
            .where(eq(ExternalCliSessionTable.id, row.id))
            .run()
            .pipe(Effect.orDie)
          changed += 1
          continue
        }
        const mismatchedCandidates = yield* db
          .select({ id: DelegationParticipantTable.id, delegation_id: DelegationParticipantTable.delegation_id })
          .from(DelegationParticipantTable)
          .innerJoin(DelegationTable, eq(DelegationTable.id, DelegationParticipantTable.delegation_id))
          .where(
            and(
              eq(DelegationTable.parent_session_id, row.session_id),
              isNull(DelegationParticipantTable.external_thread_id),
            ),
          )
          .all()
          .pipe(Effect.orDie)
        yield* markBindingRecovery(
          mismatchedCandidates,
          "legacy_binding_target_mismatch",
          `Legacy external CLI target ${row.cli_target} does not match an unbound participant`,
        )
      }
      return changed
    })
    return Service.of({ scan, backfillLegacyBindings })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(DelegationService.defaultLayer),
  Layer.provide(Database.defaultLayer),
)
export const startupLayer = Layer.effectDiscard(
  Service.use((service) =>
    Effect.gen(function* () {
      yield* service.backfillLegacyBindings()
      yield* service.scan()
    }).pipe(Effect.orDie),
  ),
)
export const node = LayerNode.make(layer, [DelegationService.node, Database.node])
export const startupNode = LayerNode.make(startupLayer, [node])
