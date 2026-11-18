export * as DelegationProjector from "./projector"

import { asc, eq, inArray } from "drizzle-orm"
import { Effect, Layer, Option, Schema } from "effect"
import { Database } from "../database/database"
import { Bus, decodeSerializedEvent } from "../bus"
import { Event } from "@aigcfroge/schema/event"
import { EventTable } from "../event/sql"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { DelegationEvent } from "./event"
import { foldDelegation, type DelegationFoldState } from "./fold"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { DelegationCorruptedEventError } from "@aigcfroge/schema/delegation"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "./sql"

type DatabaseService = Database.Interface["db"]
/** The drizzle-effect transaction handle, derived from the database client's own signature. */
type Transaction = Parameters<Parameters<DatabaseService["transaction"]>[0]>[0]
type ProjectionStore = DatabaseService | Transaction

/**
 * Rebuilds the query projection from the durable event stream. The projection
 * is deliberately replaceable: retained Bus events remain the source of truth.
 */
export const rebuild = Effect.fn("DelegationProjector.rebuild")(function* (
  db: DatabaseService,
  delegationID: DelegationID.ID,
) {
  yield* db
    .transaction(
      (tx) =>
        Effect.gen(function* () {
          const events = yield* readEvents(tx, delegationID)
          const state = foldDelegation(events)
          if (state !== undefined && state.delegation.id !== delegationID) {
            throw new DelegationCorruptedEventError({
              delegationID,
              eventType: "delegation.rebuild",
              reason: `Fold returned aggregate ${state.delegation.id} for ${delegationID}`,
            })
          }
          yield* replaceProjection(tx, delegationID, state)
        }),
      { behavior: "immediate" },
    )
    .pipe(Effect.orDie)
})

function projectEvent(store: ProjectionStore, event: Event.Payload) {
  return Effect.gen(function* () {
    const delegationID = requireDelegationID(event)
    const previous = yield* readEvents(store, delegationID)
    const state = requireFoldState([...previous, event], delegationID, event.type)
    yield* replaceProjection(store, delegationID, state)
  })
}

function requireDelegationID(event: Event.Payload): DelegationID.ID {
  const aggregateID = event.durable?.aggregateID
  if (aggregateID === undefined) {
    throw new DelegationCorruptedEventError({
      eventType: event.type,
      reason: "Delegation projector received an event without a durable aggregate ID",
    })
  }
  const decoded = Schema.decodeUnknownOption(DelegationID.ID)(aggregateID)
  if (Option.isNone(decoded)) {
    throw new DelegationCorruptedEventError({
      eventType: event.type,
      reason: "Delegation projector received an invalid durable aggregate ID",
    })
  }
  return decoded.value
}

function requireFoldState(
  events: readonly Event.Payload[],
  delegationID: DelegationID.ID,
  eventType: string,
): DelegationFoldState {
  const state = foldDelegation(events)
  if (state === undefined) {
    throw new DelegationCorruptedEventError({
      delegationID,
      eventType,
      reason: "Delegation event stream has no creation event",
    })
  }
  return state
}

export function readEvents(db: ProjectionStore, delegationID: DelegationID.ID) {
  return db
    .select()
    .from(EventTable)
    .where(eq(EventTable.aggregate_id, delegationID))
    .orderBy(asc(EventTable.seq))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) =>
        rows.map((row) =>
          decodeSerializedEvent({
            id: row.id,
            type: row.type,
            aggregateID: row.aggregate_id,
            seq: row.seq,
            data: row.data,
          }),
        ),
      ),
    )
}

export function readEventsBatch(db: ProjectionStore, delegationIDs: readonly DelegationID.ID[]) {
  if (delegationIDs.length === 0) return Effect.succeed(new Map<string, Event.Payload[]>())
  return db
    .select()
    .from(EventTable)
    .where(inArray(EventTable.aggregate_id, delegationIDs))
    .orderBy(asc(EventTable.aggregate_id), asc(EventTable.seq))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => {
        const grouped = new Map<string, Event.Payload[]>()
        for (const row of rows) {
          const events = grouped.get(row.aggregate_id) ?? []
          events.push(
            decodeSerializedEvent({
              id: row.id,
              type: row.type,
              aggregateID: row.aggregate_id,
              seq: row.seq,
              data: row.data,
            }),
          )
          grouped.set(row.aggregate_id, events)
        }
        return grouped
      }),
    )
}

function replaceProjection(db: ProjectionStore, delegationID: DelegationID.ID, state: DelegationFoldState | undefined) {
  return Effect.gen(function* () {
    yield* db
      .delete(DelegationParticipantTable)
      .where(eq(DelegationParticipantTable.delegation_id, delegationID))
      .run()
      .pipe(Effect.orDie)
    yield* db
      .delete(DelegationTurnTable)
      .where(eq(DelegationTurnTable.delegation_id, delegationID))
      .run()
      .pipe(Effect.orDie)
    yield* db.delete(DelegationTable).where(eq(DelegationTable.id, delegationID)).run().pipe(Effect.orDie)

    if (state === undefined) return

    const delegation = state.delegation
    yield* db
      .insert(DelegationTable)
      .values({
        id: delegation.id,
        parent_session_id: delegation.parentSessionID,
        meta_agent_id: delegation.metaAgentID,
        title: delegation.title,
        status: delegation.status,
        latest_revision_digest: delegation.latestRevisionDigest,
        rejection_blocked: delegation.rejectionBlocked ? 1 : 0,
        rejection_reason: delegation.rejectionReason,
        rejection_participant_id: delegation.rejectionParticipantID,
        last_activity_at: delegation.lastActivityAt,
        time_completed: delegation.completedAt,
        time_closed: delegation.closedAt,
        time_archived: delegation.archivedAt,
        time_created: delegation.createdAt,
        time_updated: delegation.updatedAt,
      })
      .run()
      .pipe(Effect.orDie)

    const participants = [...state.participants.values()].map((participant) => ({
      id: participant.id,
      delegation_id: participant.delegationID,
      provider: participant.provider,
      target: participant.target,
      role: participant.role,
      context: participant.context,
      phase: participant.phase,
      executor: participant.executor,
      child_session_id: participant.childSessionID,
      external_thread_id: participant.externalThreadID,
      last_activity_at: participant.lastActivityAt,
      time_closed: participant.closedAt,
      time_created: participant.createdAt,
      time_updated: participant.updatedAt,
    }))
    if (participants.length > 0) {
      yield* db.insert(DelegationParticipantTable).values(participants).run().pipe(Effect.orDie)
    }

    const turns = [...state.turns.values()]
      .sort((left, right) => left.seq - right.seq)
      .map((turn) => ({
        id: turn.id,
        delegation_id: turn.delegationID,
        seq: turn.seq,
        kind: turn.kind,
        status: turn.status,
        prompt_summary: turn.promptSummary,
        evidence_digest: turn.evidenceDigest,
        revision_digest: turn.revisionDigest,
        participant_ids: [...turn.participantIDs],
        delivery: turn.delivery,
        time_created: turn.createdAt,
        time_updated: turn.updatedAt,
      }))
    if (turns.length > 0) {
      yield* db.insert(DelegationTurnTable).values(turns).run().pipe(Effect.orDie)
    }
  })
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const events = yield* Bus.Service
    const database = yield* Database.Service

    yield* events.project(DelegationEvent.Created, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.ParticipantAdded, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.ParticipantBound, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.ParticipantInterrupted, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.ParticipantClosed, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.TurnAdmitted, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.TurnAppended, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.DeliveryAdmitted, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.DeliveryStarted, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.DeliveryCompleted, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.DeliveryFailed, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.DeliveryCancelled, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.DeliveryRecoveryRequired, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.RevisionRecorded, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.ReviewApproved, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.ReviewChangesRequested, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.ReviewRejected, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.RejectionRetracted, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.Closing, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.Completed, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.Cancelled, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.Archived, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.Unarchived, (event) => projectEvent(database.db, event))
    yield* events.project(DelegationEvent.Forked, (event) => projectEvent(database.db, event))
  }),
)

export const node = makeGlobalNode({ name: "delegation-projector", layer, deps: [Bus.node, Database.node] })
