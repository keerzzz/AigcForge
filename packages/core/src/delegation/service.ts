export * as DelegationService from "./service"

import { Context, DateTime, Effect, Layer } from "effect"
import { and, desc, eq, gte, inArray } from "drizzle-orm"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { LayerNode } from "../effect/layer-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import {
  Delegation,
  type ChangeKind,
  type ParticipantContext,
  type ParticipantRole,
  type ReviewFinding,
  type ReviewVerdict,
} from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID, TurnID, type ID as DelegationIDType } from "@aigcfroge/schema/delegation-id"
import type { ID as SessionIDType } from "@aigcfroge/schema/session-id"
import { DelegationEvent } from "./event"
import { DelegationProjector } from "./projector"
import { foldDelegation, type DelegationFoldState } from "./fold"
import { assertTransition, canAdvancePhase } from "./state"
import { SessionTable } from "../session/sql"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "./sql"
import { EventSequenceTable, EventTable } from "../event/sql"
import { getCliAdapter } from "../tool/cli-adapter"
import { canComplete } from "./review"
import { softExpiryMs } from "./presentation"

export interface CreateInput {
  readonly parentSessionID: SessionIDType
  readonly metaAgentID?: string
  readonly title: string
  readonly delegationID?: DelegationIDType
}

export interface ResolveInput {
  readonly parentSessionID: SessionIDType
  readonly title: string
  readonly delegationID?: DelegationIDType
  readonly newDelegation?: boolean
}

export interface AddParticipantInput {
  readonly delegationID: DelegationIDType
  readonly provider: string
  readonly target: string
  readonly role: ParticipantRole
  readonly context: ParticipantContext
  readonly childSessionID?: SessionIDType
  readonly externalThreadID?: string
}

export interface AppendTurnInput {
  readonly delegationID: DelegationIDType
  readonly kind: "task" | "evidence" | "review" | "repair" | "close"
  readonly promptSummary?: string
  readonly evidenceDigest?: string
  readonly revisionDigest?: Delegation.RevisionDigest
  readonly participantIDs: readonly ParticipantID[]
  readonly delivery: "steer" | "queue"
  readonly origin: {
    readonly deliveryOrigin: string
    readonly senderParticipantID: ParticipantID
  }
}

export interface RecordDeliveryInput {
  readonly delegationID: DelegationIDType
  readonly turnID: TurnID
  readonly participantID: ParticipantID
  readonly deliveryOrigin: string
  readonly senderParticipantID: ParticipantID
  readonly attempt: number
  readonly status: "started" | "completed" | "failed" | "cancelled" | "recovery_required"
  readonly externalTurnID?: string
  readonly summary?: string
  readonly errorCode?: string
}

export interface RecordRevisionInput {
  readonly delegationID: DelegationIDType
  readonly turnID: TurnID
  readonly participantID: ParticipantID
  readonly commitSha: string
  readonly revisionDigest: Delegation.RevisionDigest
  readonly changeKind: ChangeKind
  readonly diffSummary?: string
}

export interface RecordReviewInput {
  readonly delegationID: DelegationIDType
  readonly turnID: TurnID
  readonly participantID: ParticipantID
  readonly reviewedRevisionDigest: Delegation.RevisionDigest
  readonly verdict: ReviewVerdict
  readonly findings: readonly ReviewFinding[]
  readonly summary?: string
}

export type ServiceError =
  | Delegation.DelegationNotFoundError
  | Delegation.DelegationParentSessionNotFoundError
  | Delegation.DelegationInvalidStateError
  | Delegation.DelegationParticipantNotFoundError
  | Delegation.DelegationTurnNotFoundError
  | Delegation.DelegationRejectionBlockedError
  | Delegation.DelegationBarrierNotMetError
  | Delegation.DelegationRecoveryRequiredError

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Delegation.Info, ServiceError>
  readonly resolve: (input: ResolveInput) => Effect.Effect<DelegationFoldState, ServiceError>
  readonly addParticipant: (input: AddParticipantInput) => Effect.Effect<Delegation.ParticipantInfo, ServiceError>
  readonly bindParticipant: (input: {
    readonly delegationID: DelegationIDType
    readonly participantID: ParticipantID
    readonly childSessionID?: SessionIDType
    readonly externalThreadID?: string
  }) => Effect.Effect<void, ServiceError>
  readonly appendTurn: (input: AppendTurnInput) => Effect.Effect<Delegation.TurnInfo, ServiceError>
  readonly recordDelivery: (input: RecordDeliveryInput) => Effect.Effect<void, ServiceError>
  readonly recordRevision: (input: RecordRevisionInput) => Effect.Effect<void, ServiceError>
  readonly recordReview: (input: RecordReviewInput) => Effect.Effect<void, ServiceError>
  readonly foldState: (delegationID: DelegationIDType) => Effect.Effect<DelegationFoldState | undefined, ServiceError>
  readonly resolveActive: (
    parentSessionID: SessionIDType,
  ) => Effect.Effect<DelegationFoldState | undefined, ServiceError>
  readonly get: (delegationID: DelegationIDType) => Effect.Effect<Delegation.Info | undefined, ServiceError>
  readonly list: (input?: {
    readonly parentSessionID?: SessionIDType
    readonly includeArchived?: boolean
  }) => Effect.Effect<readonly DelegationFoldState[], ServiceError>
  readonly getParticipant: (input: {
    readonly delegationID: DelegationIDType
    readonly participantID: ParticipantID
  }) => Effect.Effect<Delegation.ParticipantInfo, ServiceError>
  readonly listTurns: (delegationID: DelegationIDType) => Effect.Effect<readonly Delegation.TurnInfo[], ServiceError>
  readonly retractRejection: (input: {
    readonly delegationID: DelegationIDType
    readonly participantID?: ParticipantID
    readonly reason: string
  }) => Effect.Effect<void, ServiceError>
  readonly retry: (input: {
    readonly delegationID: DelegationIDType
    readonly turnID: TurnID
    readonly participantID: ParticipantID
  }) => Effect.Effect<void, ServiceError>
  readonly close: (input: {
    readonly delegationID: DelegationIDType
    readonly reason?: string
  }) => Effect.Effect<void, ServiceError>
  readonly complete: (input: {
    readonly delegationID: DelegationIDType
    readonly summary?: string
  }) => Effect.Effect<void, ServiceError>
  readonly archive: (input: { readonly delegationID: DelegationIDType }) => Effect.Effect<void, ServiceError>
  readonly unarchive: (input: { readonly delegationID: DelegationIDType }) => Effect.Effect<void, ServiceError>
  readonly fork: (input: {
    readonly delegationID: DelegationIDType
    readonly title?: string
    readonly reason?: string
  }) => Effect.Effect<DelegationFoldState, ServiceError>
  readonly delete: (input: {
    readonly delegationID: DelegationIDType
    readonly purge?: boolean
  }) => Effect.Effect<void, ServiceError>
  readonly reconcile: (input: { readonly delegationID: DelegationIDType }) => Effect.Effect<void, ServiceError>
  readonly reconcileResume: (input: { readonly delegationID: DelegationIDType }) => Effect.Effect<number, ServiceError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/DelegationService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const turnAdmissionLocks = KeyedMutex.makeUnsafe<DelegationIDType>()
    const resolutionLocks = KeyedMutex.makeUnsafe<SessionIDType>()

    const now = DateTime.nowAsDate.pipe(Effect.map((date) => date.getTime()))

    const foldState = Effect.fn("DelegationService.foldState")(function* (delegationID: DelegationIDType) {
      return foldDelegation(yield* DelegationProjector.readEvents(db, delegationID))
    })

    const requireState = Effect.fn("DelegationService.requireState")(function* (delegationID: DelegationIDType) {
      const state = yield* foldState(delegationID)
      if (state === undefined) return yield* new Delegation.DelegationNotFoundError({ delegationID })
      return state
    })

    const requireTurn = (state: DelegationFoldState, delegationID: DelegationIDType, turnID: TurnID) => {
      const turn = state.turns.get(turnID)
      if (turn === undefined) return Effect.fail(new Delegation.DelegationTurnNotFoundError({ delegationID, turnID }))
      return Effect.succeed(turn)
    }

    const requireParticipant = (
      state: DelegationFoldState,
      delegationID: DelegationIDType,
      participantID: ParticipantID,
    ) => {
      const participant = state.participants.get(participantID)
      if (participant === undefined)
        return Effect.fail(new Delegation.DelegationParticipantNotFoundError({ delegationID, participantID }))
      return Effect.succeed(participant)
    }

    const create = Effect.fn("DelegationService.create")(function* (input: CreateInput) {
      const id = input.delegationID ?? DelegationID.ID.create()
      const parentSession = yield* db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.parentSessionID))
        .get()
        .pipe(Effect.orDie)
      if (parentSession === undefined) {
        return yield* new Delegation.DelegationParentSessionNotFoundError({
          parentSessionID: input.parentSessionID,
        })
      }
      if ((yield* foldState(id)) !== undefined) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: id,
          currentStatus: "existing",
          attemptedTransition: "create",
          reason: `Delegation already exists: ${id}`,
        })
      }
      const timestamp = yield* now
      yield* events.publish(DelegationEvent.Created, {
        delegationID: id,
        parentSessionID: input.parentSessionID,
        metaAgentID: input.metaAgentID,
        title: input.title,
        status: "draft",
        timestamp,
      })
      return new Delegation.Info({
        id,
        parentSessionID: input.parentSessionID,
        metaAgentID: input.metaAgentID,
        title: input.title,
        status: "draft",
        rejectionBlocked: false,
        lastActivityAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    })

    const addParticipant = Effect.fn("DelegationService.addParticipant")(function* (input: AddParticipantInput) {
      const state = yield* requireState(input.delegationID)
      if (["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "addParticipant",
          reason: `Cannot add a participant while delegation is ${state.delegation.status}`,
        })
      }
      const existing = [...state.participants.values()].find(
        (participant) =>
          participant.provider === input.provider &&
          participant.target === input.target &&
          participant.role === input.role &&
          participant.context === input.context &&
          participant.childSessionID === input.childSessionID &&
          participant.externalThreadID === input.externalThreadID,
      )
      if (existing) {
        return existing
      }
      if (input.childSessionID !== undefined) {
        const [childSession, parentSession, existingBinding] = yield* Effect.all([
          db
            .select({
              id: SessionTable.id,
              parent_id: SessionTable.parent_id,
              project_id: SessionTable.project_id,
              workspace_id: SessionTable.workspace_id,
              directory: SessionTable.directory,
              mode: SessionTable.mode,
            })
            .from(SessionTable)
            .where(eq(SessionTable.id, input.childSessionID))
            .get()
            .pipe(Effect.orDie),
          db
            .select({
              id: SessionTable.id,
              project_id: SessionTable.project_id,
              workspace_id: SessionTable.workspace_id,
              directory: SessionTable.directory,
              mode: SessionTable.mode,
            })
            .from(SessionTable)
            .where(eq(SessionTable.id, state.delegation.parentSessionID))
            .get()
            .pipe(Effect.orDie),
          db
            .select({ delegation_id: DelegationParticipantTable.delegation_id })
            .from(DelegationParticipantTable)
            .where(eq(DelegationParticipantTable.child_session_id, input.childSessionID))
            .get()
            .pipe(Effect.orDie),
        ])
        if (
          childSession === undefined ||
          parentSession === undefined ||
          childSession.parent_id !== state.delegation.parentSessionID ||
          childSession.project_id !== parentSession.project_id ||
          childSession.workspace_id !== parentSession.workspace_id ||
          childSession.directory !== parentSession.directory ||
          childSession.mode !== parentSession.mode ||
          (existingBinding !== undefined && existingBinding.delegation_id !== input.delegationID)
        ) {
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "addParticipant",
            reason: `Child session ${input.childSessionID} does not belong to parent session ${state.delegation.parentSessionID}`,
          })
        }
      }
      const id = ParticipantID.create()
      const timestamp = yield* now
      yield* events.publish(DelegationEvent.ParticipantAdded, {
        delegationID: input.delegationID,
        participantID: id,
        provider: input.provider,
        target: input.target,
        role: input.role,
        context: input.context,
        phase: "provisioning",
        childSessionID: input.childSessionID,
        externalThreadID: input.externalThreadID,
        timestamp,
      })
      return new Delegation.ParticipantInfo({
        id,
        delegationID: input.delegationID,
        provider: input.provider,
        target: input.target,
        role: input.role,
        context: input.context,
        phase: "provisioning",
        childSessionID: input.childSessionID,
        externalThreadID: input.externalThreadID,
        lastActivityAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    })

    const bindParticipant = Effect.fn("DelegationService.bindParticipant")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly participantID: ParticipantID
      readonly childSessionID?: SessionIDType
      readonly externalThreadID?: string
    }) {
      if (input.childSessionID === undefined && input.externalThreadID === undefined) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: "unknown",
          attemptedTransition: "bindParticipant",
          reason: "Participant binding requires a child session or external thread",
        })
      }
      const state = yield* requireState(input.delegationID)
      const participant = yield* requireParticipant(state, input.delegationID, input.participantID)
      if (input.childSessionID !== undefined) {
        const childSession = yield* db
          .select({
            id: SessionTable.id,
            parent_id: SessionTable.parent_id,
          })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.childSessionID))
          .get()
          .pipe(Effect.orDie)
        const existingBinding = yield* db
          .select({
            participant_id: DelegationParticipantTable.id,
            delegation_id: DelegationParticipantTable.delegation_id,
          })
          .from(DelegationParticipantTable)
          .where(eq(DelegationParticipantTable.child_session_id, input.childSessionID))
          .get()
          .pipe(Effect.orDie)
        if (
          childSession === undefined ||
          childSession.parent_id !== state.delegation.parentSessionID ||
          (existingBinding !== undefined &&
            (existingBinding.delegation_id !== input.delegationID ||
              existingBinding.participant_id !== input.participantID))
        ) {
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "bindParticipant",
            reason: `Child session ${input.childSessionID} does not belong to participant ${input.participantID}`,
          })
        }
      }
      if (
        input.childSessionID !== undefined &&
        participant.childSessionID !== undefined &&
        participant.childSessionID !== input.childSessionID
      ) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "bindParticipant",
          reason: "Participant child session binding cannot be changed",
        })
      }
      if (
        input.externalThreadID !== undefined &&
        participant.externalThreadID !== undefined &&
        participant.externalThreadID !== input.externalThreadID
      ) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "bindParticipant",
          reason: "Participant external thread binding cannot be changed",
        })
      }
      const conflictingParticipant = [...state.participants.values()].find(
        (candidate) =>
          candidate.id !== input.participantID &&
          input.externalThreadID !== undefined &&
          candidate.externalThreadID === input.externalThreadID,
      )
      if (conflictingParticipant !== undefined) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "bindParticipant",
          reason: `External thread ${input.externalThreadID} is already bound to participant ${conflictingParticipant.id}`,
        })
      }
      if (
        (input.childSessionID === undefined || input.childSessionID === participant.childSessionID) &&
        (input.externalThreadID === undefined || input.externalThreadID === participant.externalThreadID)
      ) {
        return yield* Effect.void
      }
      return yield* events
        .publish(DelegationEvent.ParticipantBound, {
          delegationID: input.delegationID,
          participantID: input.participantID,
          childSessionID: input.childSessionID,
          externalThreadID: input.externalThreadID,
          timestamp: yield* now,
        })
        .pipe(Effect.asVoid)
    })

    const appendTurn = Effect.fn("DelegationService.appendTurn")(function* (input: AppendTurnInput) {
      return yield* turnAdmissionLocks.withLock(input.delegationID)(
        Effect.gen(function* () {
          const state = yield* foldState(input.delegationID)
          if (state === undefined) {
            return yield* new Delegation.DelegationNotFoundError({ delegationID: input.delegationID })
          }
          if (["closing", "completed", "cancelled", "archived"].includes(state.delegation.status)) {
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: input.delegationID,
              currentStatus: state.delegation.status,
              attemptedTransition: "appendTurn",
              reason: `Cannot append a turn while delegation is ${state.delegation.status}`,
            })
          }
          const participantIDs = [...new Set(input.participantIDs)]
          if (participantIDs.length !== input.participantIDs.length || participantIDs.length === 0) {
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: input.delegationID,
              currentStatus: state.delegation.status,
              attemptedTransition: "appendTurn",
              reason: "A turn must target at least one unique participant",
            })
          }
          for (const participantID of participantIDs) {
            if (!state.participants.has(participantID)) {
              return yield* new Delegation.DelegationParticipantNotFoundError({
                delegationID: input.delegationID,
                participantID,
              })
            }
          }
          if (!state.participants.has(input.origin.senderParticipantID)) {
            return yield* new Delegation.DelegationParticipantNotFoundError({
              delegationID: input.delegationID,
              participantID: input.origin.senderParticipantID,
            })
          }
          if (input.evidenceDigest !== undefined) {
            const existingTurn = [...state.turns.values()].find((turn) => {
              if (turn.evidenceDigest !== input.evidenceDigest) return false
              if (turn.kind !== input.kind) return false
              if (turn.delivery !== input.delivery) return false
              if (
                turn.participantIDs.length !== participantIDs.length ||
                !turn.participantIDs.every((id) => participantIDs.includes(id))
              ) {
                return false
              }
              const matchingDeliveries = [...state.deliveries.values()].filter((d) => d.turnID === turn.id)
              if (matchingDeliveries.length !== participantIDs.length) return false
              const matchingParticipantSet = new Set(matchingDeliveries.map((d) => d.participantID))
              if (
                matchingParticipantSet.size !== participantIDs.length ||
                !participantIDs.every((id) => matchingParticipantSet.has(id))
              ) {
                return false
              }
              return matchingDeliveries.every(
                (d) =>
                  d.deliveryOrigin === input.origin.deliveryOrigin &&
                  d.senderParticipantID === input.origin.senderParticipantID,
              )
            })
            if (existingTurn) {
              return existingTurn
            }
          }
          const seq = Math.max(0, ...(state ? [...state.turns.values()].map((turn) => turn.seq) : [])) + 1
          const id = TurnID.create()
          const timestamp = yield* now
          const turnData = {
            delegationID: input.delegationID,
            turnID: id,
            seq,
            kind: input.kind,
            promptSummary: input.promptSummary,
            evidenceDigest: input.evidenceDigest,
            revisionDigest: input.revisionDigest,
            participantIDs,
            delivery: input.delivery,
            timestamp,
          }
          yield* events.publishBatch([
            EventV2.batchEntry(DelegationEvent.TurnAdmitted, turnData),
            ...participantIDs.map((participantID) =>
              EventV2.batchEntry(DelegationEvent.DeliveryAdmitted, {
                delegationID: input.delegationID,
                turnID: id,
                participantID,
                deliveryOrigin: input.origin.deliveryOrigin,
                senderParticipantID: input.origin.senderParticipantID,
                attempt: 1,
                status: input.delivery === "queue" ? "queued" : "admitted",
                timestamp,
              }),
            ),
          ])
          return new Delegation.TurnInfo({
            id,
            delegationID: input.delegationID,
            seq,
            kind: input.kind,
            status: input.delivery === "queue" ? "queued" : "admitted",
            promptSummary: input.promptSummary,
            evidenceDigest: input.evidenceDigest,
            revisionDigest: input.revisionDigest,
            participantIDs,
            delivery: input.delivery,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }),
      )
    })

    const recordDelivery = Effect.fn("DelegationService.recordDelivery")(function* (input: RecordDeliveryInput) {
      const state = yield* requireState(input.delegationID)
      const turn = yield* requireTurn(state, input.delegationID, input.turnID)
      if (!turn.participantIDs.includes(input.participantID)) {
        yield* new Delegation.DelegationParticipantNotFoundError({
          delegationID: input.delegationID,
          participantID: input.participantID,
        })
        return
      }
      yield* requireParticipant(state, input.delegationID, input.participantID)
      yield* requireParticipant(state, input.delegationID, input.senderParticipantID)
      const timestamp = yield* now
      if (input.status === "started") {
        yield* events
          .publish(DelegationEvent.DeliveryStarted, {
            delegationID: input.delegationID,
            turnID: input.turnID,
            participantID: input.participantID,
            deliveryOrigin: input.deliveryOrigin,
            senderParticipantID: input.senderParticipantID,
            attempt: input.attempt,
            timestamp,
          })
          .pipe(Effect.asVoid)
        return
      }
      if (input.status === "completed") {
        yield* events
          .publish(DelegationEvent.DeliveryCompleted, {
            delegationID: input.delegationID,
            turnID: input.turnID,
            participantID: input.participantID,
            deliveryOrigin: input.deliveryOrigin,
            senderParticipantID: input.senderParticipantID,
            attempt: input.attempt,
            externalTurnID: input.externalTurnID,
            summary: input.summary,
            timestamp,
          })
          .pipe(Effect.asVoid)
        return
      }
      if (input.status === "failed") {
        yield* events
          .publish(DelegationEvent.DeliveryFailed, {
            delegationID: input.delegationID,
            turnID: input.turnID,
            participantID: input.participantID,
            deliveryOrigin: input.deliveryOrigin,
            senderParticipantID: input.senderParticipantID,
            attempt: input.attempt,
            errorCode: input.errorCode,
            summary: input.summary,
            timestamp,
          })
          .pipe(Effect.asVoid)
        return
      }
      if (input.status === "cancelled") {
        yield* events
          .publish(DelegationEvent.DeliveryCancelled, {
            delegationID: input.delegationID,
            turnID: input.turnID,
            participantID: input.participantID,
            deliveryOrigin: input.deliveryOrigin,
            senderParticipantID: input.senderParticipantID,
            attempt: input.attempt,
            summary: input.summary,
            timestamp,
          })
          .pipe(Effect.asVoid)
        return
      }
      yield* events
        .publish(DelegationEvent.DeliveryRecoveryRequired, {
          delegationID: input.delegationID,
          turnID: input.turnID,
          participantID: input.participantID,
          deliveryOrigin: input.deliveryOrigin,
          senderParticipantID: input.senderParticipantID,
          attempt: input.attempt,
          errorCode: input.errorCode,
          summary: input.summary,
          timestamp,
        })
        .pipe(Effect.asVoid)
    })

    const recordRevision = Effect.fn("DelegationService.recordRevision")(function* (input: RecordRevisionInput) {
      const state = yield* requireState(input.delegationID)
      const turn = yield* requireTurn(state, input.delegationID, input.turnID)
      const participant = yield* requireParticipant(state, input.delegationID, input.participantID)
      if (!turn.participantIDs.includes(input.participantID) || participant.role !== "implementer") {
        yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "recordRevision",
          reason: "Only an admitted implementer can record a revision",
        })
        return
        return
      }
      yield* events.publish(DelegationEvent.RevisionRecorded, { ...input, timestamp: yield* now }).pipe(Effect.asVoid)
    })

    const recordReview = Effect.fn("DelegationService.recordReview")(function* (input: RecordReviewInput) {
      const state = yield* requireState(input.delegationID)
      const turn = yield* requireTurn(state, input.delegationID, input.turnID)
      const participant = yield* requireParticipant(state, input.delegationID, input.participantID)
      if (
        !turn.participantIDs.includes(input.participantID) ||
        (participant.role !== "reviewer" && participant.role !== "approver")
      ) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "recordReview",
          reason: "Only an admitted reviewer or approver can record a review",
        })
      }
      const { verdict, ...review } = input
      const data = { ...review, timestamp: yield* now }
      if (verdict === "approved") {
        return yield* events.publish(DelegationEvent.ReviewApproved, data).pipe(Effect.asVoid)
      }
      if (verdict === "changes_requested") {
        return yield* events.publish(DelegationEvent.ReviewChangesRequested, data).pipe(Effect.asVoid)
      }
      return yield* events.publish(DelegationEvent.ReviewRejected, data).pipe(Effect.asVoid)
    })

    const get = Effect.fn("DelegationService.get")(function* (delegationID: DelegationIDType) {
      return (yield* foldState(delegationID))?.delegation
    })

    const list = Effect.fn("DelegationService.list")(function* (
      input: { readonly parentSessionID?: SessionIDType; readonly includeArchived?: boolean } = {},
    ) {
      const predicates = [
        input.parentSessionID ? eq(DelegationTable.parent_session_id, input.parentSessionID) : undefined,
        input.includeArchived
          ? undefined
          : inArray(DelegationTable.status, [
              "draft",
              "running",
              "waiting_review",
              "changes_requested",
              "approved",
              "failed",
              "recovery_required",
              "closing",
              "completed",
              "cancelled",
            ]),
      ].filter((predicate) => predicate !== undefined)
      const rows = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(predicates.length === 0 ? undefined : and(...predicates))
        .orderBy(desc(DelegationTable.last_activity_at))
        .all()
        .pipe(Effect.orDie)
      const groupedEvents = yield* DelegationProjector.readEventsBatch(
        db,
        rows.map((row) => row.id),
      )
      return rows.map((row) => foldDelegation(groupedEvents.get(row.id) ?? [])).filter((state) => state !== undefined)
    })

    const getParticipant = Effect.fn("DelegationService.getParticipant")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly participantID: ParticipantID
    }) {
      return yield* requireParticipant(yield* requireState(input.delegationID), input.delegationID, input.participantID)
    })

    const listTurns = Effect.fn("DelegationService.listTurns")(function* (delegationID: DelegationIDType) {
      return [...(yield* requireState(delegationID)).turns.values()].sort((left, right) => left.seq - right.seq)
    })

    const retractRejection = Effect.fn("DelegationService.retractRejection")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly participantID?: ParticipantID
      readonly reason: string
    }) {
      const state = yield* requireState(input.delegationID)
      if (
        input.participantID !== undefined &&
        state.delegation.rejectionParticipantID !== undefined &&
        input.participantID !== state.delegation.rejectionParticipantID
      ) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "retractRejection",
          reason: "Rejection retraction participant does not match the active blocker",
        })
      }
      return yield* events
        .publish(DelegationEvent.RejectionRetracted, { ...input, timestamp: yield* now })
        .pipe(Effect.asVoid)
    })

    const retry = Effect.fn("DelegationService.retry")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly turnID: TurnID
      readonly participantID: ParticipantID
    }) {
      const state = yield* requireState(input.delegationID)
      const turn = yield* requireTurn(state, input.delegationID, input.turnID)
      if (!turn.participantIDs.includes(input.participantID)) {
        yield* new Delegation.DelegationParticipantNotFoundError({
          delegationID: input.delegationID,
          participantID: input.participantID,
        })
        return
      }
      const deliveries = [...state.deliveries.values()]
        .filter((delivery) => delivery.turnID === input.turnID && delivery.participantID === input.participantID)
        .sort((left, right) => right.attempt - left.attempt || right.updatedAt - left.updatedAt)
      const latest = deliveries[0]
      if (!latest || !["failed", "cancelled", "recovery_required"].includes(latest.status)) {
        yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: latest?.status ?? "missing",
          attemptedTransition: "retry",
          reason:
            latest?.status === "completed" ? "Completed delivery requires a new Turn" : "Delivery is not retryable",
        })
        return
      }
      yield* events.publish(DelegationEvent.DeliveryAdmitted, {
        delegationID: input.delegationID,
        turnID: input.turnID,
        participantID: input.participantID,
        deliveryOrigin: latest.deliveryOrigin,
        senderParticipantID: latest.senderParticipantID,
        attempt: latest.attempt + 1,
        status: turn.delivery === "queue" ? "queued" : "admitted",
        timestamp: yield* now,
      })
    })

    const resolveActive = Effect.fn("DelegationService.resolveActive")(function* (parentSessionID: SessionIDType) {
      const row = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(
          and(
            eq(DelegationTable.parent_session_id, parentSessionID),
            // Soft expiry is a derived visibility/admission policy, not a
            // domain status. Expired rows remain auditable but are no longer
            // selected as the current interactive delegation.
            gte(DelegationTable.last_activity_at, (yield* now) - softExpiryMs()),
            inArray(DelegationTable.status, ["draft", "running", "waiting_review", "changes_requested", "approved"]),
          ),
        )
        .orderBy(desc(DelegationTable.last_activity_at))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      return yield* foldState(row.id)
    })

    const resolve = Effect.fn("DelegationService.resolve")(function* (input: ResolveInput) {
      return yield* resolutionLocks.withLock(input.parentSessionID)(
        Effect.gen(function* () {
          if (input.delegationID) {
            const row = yield* db
              .select({ id: DelegationTable.id })
              .from(DelegationTable)
              .where(
                and(
                  eq(DelegationTable.id, input.delegationID),
                  eq(DelegationTable.parent_session_id, input.parentSessionID),
                ),
              )
              .get()
              .pipe(Effect.orDie)
            if (!row) {
              return yield* new Delegation.DelegationInvalidStateError({
                delegationID: input.delegationID,
                currentStatus: "unknown",
                attemptedTransition: "resolve",
                reason: `Delegation ${input.delegationID} does not belong to parent session ${input.parentSessionID}`,
              })
            }
            return yield* requireState(input.delegationID)
          }
          if (!input.newDelegation) {
            const active = yield* resolveActive(input.parentSessionID)
            if (active) return active
          }
          const created = yield* create({ parentSessionID: input.parentSessionID, title: input.title })
          return yield* requireState(created.id)
        }),
      )
    })

    const close = Effect.fn("DelegationService.close")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly reason?: string
    }) {
      const state = yield* requireState(input.delegationID)
      if (state.delegation.status === "closing") return
      if (["completed", "cancelled", "archived"].includes(state.delegation.status)) return

      yield* assertTransition(input.delegationID, state.delegation.status, "closing")

      // Closing is the durable admission fence. Execution cleanup is owned by
      // DelegationExecution and happens only after this event is committed.
      yield* events.publish(DelegationEvent.Closing, {
        delegationID: input.delegationID,
        reason: input.reason,
        timestamp: yield* now,
      })

      // Close active participants: children before parents
      for (const participant of state.participants.values()) {
        if (canAdvancePhase(participant.phase, "closed")) {
          yield* events.publish(DelegationEvent.ParticipantClosed, {
            delegationID: input.delegationID,
            participantID: participant.id,
            reason: input.reason,
            timestamp: yield* now,
          })
        }
      }
    })

    const archive = Effect.fn("DelegationService.archive")(function* (input: {
      readonly delegationID: DelegationIDType
    }) {
      const state = yield* requireState(input.delegationID)
      if (state.delegation.status === "archived") return
      yield* assertTransition(input.delegationID, state.delegation.status, "archived")
      for (const participant of state.participants.values()) {
        if (participant.externalThreadID) {
          const adapter = getCliAdapter(participant.target) ?? getCliAdapter(participant.provider)
          if (adapter?.archiveThread) {
            yield* adapter.archiveThread(participant.externalThreadID).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Delegation external thread archive failed", {
                  delegationID: input.delegationID,
                  participantID: participant.id,
                  error: String(error),
                }),
              ),
            )
          }
        }
      }
      yield* events.publish(DelegationEvent.Archived, {
        delegationID: input.delegationID,
        timestamp: yield* now,
      })
    })

    const unarchive = Effect.fn("DelegationService.unarchive")(function* (input: {
      readonly delegationID: DelegationIDType
    }) {
      const state = yield* requireState(input.delegationID)
      if (state.delegation.status !== "archived") {
        yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "unarchive",
          reason: "Only an archived delegation can be unarchived",
        })
        return
      }
      yield* events.publish(DelegationEvent.Completed, {
        delegationID: input.delegationID,
        summary: "Delegation unarchived",
        timestamp: yield* now,
      })
    })

    const fork = Effect.fn("DelegationService.fork")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly title?: string
      readonly reason?: string
    }) {
      const state = yield* requireState(input.delegationID)
      const created = yield* create({
        parentSessionID: state.delegation.parentSessionID,
        metaAgentID: state.delegation.metaAgentID,
        title: input.title ?? `${state.delegation.title} (fork)`,
      })
      yield* events.publish(DelegationEvent.Forked, {
        delegationID: input.delegationID,
        forkedDelegationID: created.id,
        reason: input.reason,
        timestamp: yield* now,
      })
      for (const participant of state.participants.values()) {
        yield* addParticipant({
          delegationID: created.id,
          provider: participant.provider,
          target: participant.target,
          role: participant.role,
          context: "fork",
        })
      }
      return yield* requireState(created.id)
    })

    const complete = Effect.fn("DelegationService.complete")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly summary?: string
    }) {
      const state = yield* requireState(input.delegationID)
      if (state.delegation.status === "archived") return
      if (state.delegation.status === "completed") {
        yield* archive({ delegationID: input.delegationID })
        return
      }
      yield* assertTransition(input.delegationID, state.delegation.status, "completed")
      if (
        !canComplete({
          participants: [...state.participants.values()],
          reviews: state.reviews,
          latestRevisionDigest: state.delegation.latestRevisionDigest,
          revisions: state.revisions,
          rejectionBlocked: state.delegation.rejectionBlocked,
          deliveries: [...state.deliveries.values()],
          turns: [...state.turns.values()],
        })
      ) {
        yield* new Delegation.DelegationBarrierNotMetError({
          delegationID: input.delegationID,
          missingRoles: [],
          reason: "Delegation completion barrier is not satisfied",
        })
        return
      }
      yield* events.publish(DelegationEvent.Completed, {
        delegationID: input.delegationID,
        summary: input.summary,
        timestamp: yield* now,
      })
      yield* archive({ delegationID: input.delegationID })
    })

    const deleteDelegation = Effect.fn("DelegationService.delete")(function* (input: {
      readonly delegationID: DelegationIDType
      readonly purge?: boolean
    }) {
      if (!input.purge) {
        yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: "unknown",
          attemptedTransition: "delete",
          reason: "Explicit purge is required to delete delegation",
        })
        return
      }
      const state = yield* foldState(input.delegationID).pipe(Effect.orDie)
      if (state) {
        for (const participant of state.participants.values()) {
          if (participant.externalThreadID) {
            const adapter = getCliAdapter(participant.target) ?? getCliAdapter(participant.provider)
            if (adapter?.deleteThread) {
              yield* adapter.deleteThread(participant.externalThreadID).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Delegation external thread delete failed", {
                    delegationID: input.delegationID,
                    participantID: participant.id,
                    error: String(error),
                  }),
                ),
              )
            } else if (adapter?.archiveThread) {
              yield* adapter.archiveThread(participant.externalThreadID).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Delegation external thread archive failed", {
                    delegationID: input.delegationID,
                    participantID: participant.id,
                    error: String(error),
                  }),
                ),
              )
            }
          }
        }
      }
      yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .delete(DelegationParticipantTable)
              .where(eq(DelegationParticipantTable.delegation_id, input.delegationID))
              .run()
            yield* tx.delete(DelegationTurnTable).where(eq(DelegationTurnTable.delegation_id, input.delegationID)).run()
            yield* tx.delete(DelegationTable).where(eq(DelegationTable.id, input.delegationID)).run()
            yield* tx.delete(EventTable).where(eq(EventTable.aggregate_id, input.delegationID)).run()
            yield* tx.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, input.delegationID)).run()
          }),
        )
        .pipe(Effect.orDie)
    })

    const reconcile = Effect.fn("DelegationService.reconcile")(function* (input: {
      readonly delegationID: DelegationIDType
    }) {
      const state = yield* requireState(input.delegationID)
      for (const delivery of state.deliveries.values()) {
        if (delivery.status === "recovery_required") {
          yield* events.publish(DelegationEvent.DeliveryFailed, {
            delegationID: input.delegationID,
            turnID: delivery.turnID,
            participantID: delivery.participantID,
            deliveryOrigin: delivery.deliveryOrigin,
            senderParticipantID: delivery.senderParticipantID,
            attempt: delivery.attempt,
            errorCode: "reconciled_after_disruption",
            summary: "Delivery reconciled after recovery required",
            timestamp: yield* now,
          })
        }
      }
    })

    // Safe-resume reconciliation: only re-admit deliveries whose participant has
    // a provable idempotent-resume contract (adapter.resumeThread + bound
    // externalThreadID). Everything else stays recovery_required for manual
    // handling — never blindly replay unknown side effects (plan §16.11).
    const reconcileResume = Effect.fn("DelegationService.reconcileResume")(function* (input: {
      readonly delegationID: DelegationIDType
    }) {
      const state = yield* requireState(input.delegationID)
      let resumed = 0
      for (const delivery of state.deliveries.values()) {
        if (delivery.status !== "recovery_required") continue
        const participant = state.participants.get(delivery.participantID)
        const adapter = participant
          ? (getCliAdapter(participant.target) ?? getCliAdapter(participant.provider))
          : undefined
        if (adapter?.resumeThread === undefined || participant?.externalThreadID === undefined) continue
        yield* retry({
          delegationID: input.delegationID,
          turnID: delivery.turnID,
          participantID: delivery.participantID,
        })
        resumed += 1
      }
      return resumed
    })

    return Service.of({
      create,
      resolve,
      addParticipant,
      bindParticipant,
      appendTurn,
      recordDelivery,
      recordRevision,
      recordReview,
      foldState,
      resolveActive,
      get,
      list,
      getParticipant,
      listTurns,
      retractRejection,
      retry,
      close,
      complete,
      archive,
      unarchive,
      fork,
      delete: deleteDelegation,
      reconcile,
      reconcileResume,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(DelegationProjector.layer),
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
)
export const node = LayerNode.make(layer, [DelegationProjector.node, EventV2.node, Database.node])
