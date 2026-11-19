export * as DelegationService from "./service"

import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import path from "path"
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm"
import { Database } from "../database/database"
import { Bus } from "../bus"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import {
  Delegation,
  type ChangeKind,
  type ParticipantContext,
  type ParticipantRole,
  type ReviewFinding,
  type ReviewVerdict,
} from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { Session } from "@aigcfroge/schema/session"
import { DelegationEvent } from "./event"
import { DelegationProjector } from "./projector"
import { foldDelegation, type DelegationFoldState } from "./fold"
import { assertTransition, canAdvancePhase } from "./state"
import { SessionMessageTable, SessionTable, TaskTable } from "../session/sql"
import { SessionInputResult } from "../session/input-result"
import { Permission } from "@aigcfroge/schema/permission"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { DelegationFold } from "./fold"
import { DelegationReceipt } from "./receipt"
import { KV } from "../kv"
import { DelegationParticipantTable, DelegationTable, DelegationTurnTable } from "./sql"
import { EventSequenceTable, EventTable } from "../event/sql"
import { CliAdapter } from "../tool/cli-adapter"
import { canComplete } from "./review"
import { softExpiryMs } from "./presentation"
import { sameExecutor } from "../session/error"
import { MetaAgentService } from "../meta-agent/service"
import { fromRow } from "../session/info"
import { Schedule } from "@aigcfroge/schema/schedule"
import { Agent } from "@aigcfroge/schema/agent"
import { ScheduleOccurrenceTable } from "../session/schedule.sql"

export const ArtifactEvidence = DelegationReceipt.ArtifactEvidence
export type ArtifactEvidence = DelegationReceipt.ArtifactEvidence
export const RevisionReference = DelegationReceipt.RevisionReference
export type RevisionReference = DelegationReceipt.RevisionReference
export const Governance = DelegationReceipt.Governance
export type Governance = DelegationReceipt.Governance

export interface CreateInput {
  readonly parentSessionID: Session.ID
  readonly agent?: Session.Info["agent"]
  readonly metaAgentID?: string
  readonly title: string
  readonly delegationID?: DelegationID.ID
}

export interface ResolveInput {
  readonly parentSessionID: Session.ID
  readonly agent?: Session.Info["agent"]
  readonly title: string
  readonly delegationID?: DelegationID.ID
  readonly newDelegation?: boolean
}

export interface AddParticipantInput {
  readonly delegationID: DelegationID.ID
  readonly provider: string
  readonly target: string
  readonly role: ParticipantRole
  readonly context: ParticipantContext
  readonly childSessionID?: Session.ID
  readonly executor?: Session.ExecutorBinding
  readonly externalThreadID?: string
}

export interface AppendTurnInput {
  readonly delegationID: DelegationID.ID
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
  readonly delegationID: DelegationID.ID
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
  readonly delegationID: DelegationID.ID
  readonly turnID: TurnID
  readonly participantID: ParticipantID
  readonly commitSha: string
  readonly revisionDigest: Delegation.RevisionDigest
  readonly changeKind: ChangeKind
  readonly diffSummary?: string
  readonly receipt?: Delegation.Receipt
  readonly source?: Permission.Source
}

export interface RecordReviewInput {
  readonly delegationID: DelegationID.ID
  readonly turnID: TurnID
  readonly participantID: ParticipantID
  readonly reviewedRevisionDigest: Delegation.RevisionDigest
  readonly verdict: ReviewVerdict
  readonly findings: readonly ReviewFinding[]
  readonly summary?: string
  readonly receipt?: DelegationReceipt.ReviewReceipt
  readonly source?: Permission.Source
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
  /** Host-only route for an already claimed retained task_schedule occurrence. */
  readonly internalParticipant: (input: {
    readonly occurrenceID: Schedule.OccurrenceID
    readonly agent: Agent.ID
    readonly actor: Agent.ID
    readonly executor?: Session.ExecutorBinding
  }) => Effect.Effect<
    {
      readonly delegationID: DelegationID.ID
      readonly participantID: ParticipantID
      readonly turnID: TurnID
    },
    ServiceError
  >
  readonly create: (input: CreateInput) => Effect.Effect<Delegation.Info, ServiceError>
  readonly resolve: (input: ResolveInput) => Effect.Effect<DelegationFoldState, ServiceError>
  readonly addParticipant: (input: AddParticipantInput) => Effect.Effect<Delegation.ParticipantInfo, ServiceError>
  readonly bindParticipant: (input: {
    readonly delegationID: DelegationID.ID
    readonly participantID: ParticipantID
    readonly childSessionID?: Session.ID
    readonly externalThreadID?: string
  }) => Effect.Effect<void, ServiceError>
  readonly appendTurn: (input: AppendTurnInput) => Effect.Effect<Delegation.TurnInfo, ServiceError>
  readonly recordDelivery: (input: RecordDeliveryInput) => Effect.Effect<void, ServiceError>
  readonly recordRevision: (input: RecordRevisionInput) => Effect.Effect<"recorded" | "reused", ServiceError>
  readonly recordReview: (input: RecordReviewInput) => Effect.Effect<"recorded" | "reused", ServiceError>
  readonly revision: (input: {
    readonly delegationID: DelegationID.ID
    readonly revisionDigest: Delegation.RevisionDigest
  }) => Effect.Effect<RevisionReference, ServiceError>
  readonly foldState: (delegationID: DelegationID.ID) => Effect.Effect<DelegationFoldState | undefined, ServiceError>
  readonly resolveActive: (
    parentSessionID: Session.ID,
    agent?: Session.Info["agent"],
  ) => Effect.Effect<DelegationFoldState | undefined, ServiceError>
  readonly get: (delegationID: DelegationID.ID) => Effect.Effect<Delegation.Info | undefined, ServiceError>
  readonly list: (input?: {
    readonly parentSessionID?: Session.ID
    readonly includeArchived?: boolean
  }) => Effect.Effect<readonly DelegationFoldState[], ServiceError>
  readonly getParticipant: (input: {
    readonly delegationID: DelegationID.ID
    readonly participantID: ParticipantID
  }) => Effect.Effect<Delegation.ParticipantInfo, ServiceError>
  readonly listTurns: (delegationID: DelegationID.ID) => Effect.Effect<readonly Delegation.TurnInfo[], ServiceError>
  readonly retractRejection: (input: {
    readonly delegationID: DelegationID.ID
    readonly participantID?: ParticipantID
    readonly reason: string
  }) => Effect.Effect<void, ServiceError>
  readonly retry: (input: {
    readonly delegationID: DelegationID.ID
    readonly turnID: TurnID
    readonly participantID: ParticipantID
  }) => Effect.Effect<void, ServiceError>
  readonly close: (input: {
    readonly delegationID: DelegationID.ID
    readonly reason?: string
    readonly requireComplete?: boolean
  }) => Effect.Effect<void, ServiceError>
  readonly complete: (input: {
    readonly delegationID: DelegationID.ID
    readonly summary?: string
    readonly source?: Permission.Source
  }) => Effect.Effect<void, ServiceError>
  readonly archive: (input: {
    readonly delegationID: DelegationID.ID
    readonly source?: Permission.Source
  }) => Effect.Effect<void, ServiceError>
  readonly unarchive: (input: { readonly delegationID: DelegationID.ID }) => Effect.Effect<void, ServiceError>
  readonly fork: (input: {
    readonly delegationID: DelegationID.ID
    readonly title?: string
    readonly reason?: string
  }) => Effect.Effect<DelegationFoldState, ServiceError>
  readonly delete: (input: {
    readonly delegationID: DelegationID.ID
    readonly purge?: boolean
  }) => Effect.Effect<void, ServiceError>
  readonly reconcile: (input: { readonly delegationID: DelegationID.ID }) => Effect.Effect<void, ServiceError>
  readonly reconcileResume: (input: { readonly delegationID: DelegationID.ID }) => Effect.Effect<number, ServiceError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/DelegationService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const events = yield* Bus.Service
    const metas = yield* MetaAgentService.Service
    const kv = yield* KV.Service
    const mutationLocks = KeyedMutex.makeUnsafe<DelegationID.ID>()
    const resolutionLocks = KeyedMutex.makeUnsafe<Session.ID>()

    // Public mutations serialize the state check and publication together.
    // Internal composed commands use their caller's lock rather than acquiring it again.
    const serialized =
      <Input extends { readonly delegationID: DelegationID.ID }, A, E>(
        operation: (input: Input) => Effect.Effect<A, E>,
      ) =>
      (input: Input) =>
        mutationLocks.withLock(input.delegationID)(operation(input))

    const now = DateTime.nowAsDate.pipe(Effect.map((date) => date.getTime()))

    const foldState = Effect.fn("DelegationService.foldState")(function* (delegationID: DelegationID.ID) {
      if (!events.retainsEvents)
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID,
          currentStatus: "unavailable",
          attemptedTransition: "read",
          reason: "Persistent delegations require retained Bus events",
        })
      return foldDelegation(yield* DelegationProjector.readEvents(db, delegationID))
    })

    const requireState = Effect.fn("DelegationService.requireState")(function* (delegationID: DelegationID.ID) {
      const state = yield* foldState(delegationID)
      if (state === undefined) return yield* new Delegation.DelegationNotFoundError({ delegationID })
      return state
    })

    const requireTurn = (state: DelegationFoldState, delegationID: DelegationID.ID, turnID: TurnID) => {
      const turn = state.turns.get(turnID)
      if (turn === undefined) return Effect.fail(new Delegation.DelegationTurnNotFoundError({ delegationID, turnID }))
      return Effect.succeed(turn)
    }

    const requireParticipant = (
      state: DelegationFoldState,
      delegationID: DelegationID.ID,
      participantID: ParticipantID,
    ) => {
      const participant = state.participants.get(participantID)
      if (participant === undefined)
        return Effect.fail(new Delegation.DelegationParticipantNotFoundError({ delegationID, participantID }))
      return Effect.succeed(participant)
    }

    const proofFor = Effect.fn("DelegationService.proofFor")(function* (
      state: DelegationFoldState,
      turnID: TurnID,
      participantID: ParticipantID,
      revisionDigest: Delegation.RevisionDigest,
      inputID?: SessionMessage.ID,
    ) {
      const participant = yield* requireParticipant(state, state.delegation.id, participantID)
      if (
        (participant.provider === "codex" || participant.provider === "claude-code") &&
        participant.externalThreadID
      ) {
        const delivery = [...state.deliveries.values()].find(
          (value) => value.turnID === turnID && value.participantID === participantID,
        )
        if (!delivery || delivery.status !== "completed") return
        const key = DelegationReceipt.key({ delegationID: state.delegation.id, ...delivery })
        const decoded = Schema.decodeUnknownOption(DelegationReceipt.Binding)(yield* kv.get(key))
        if (Option.isNone(decoded)) return
        const binding = decoded.value
        const governance = binding.settlement?.governance
        if (
          participant.target !== participant.provider ||
          participant.role !== "reviewer" ||
          binding.parentSessionID !== state.delegation.parentSessionID ||
          DelegationReceipt.key(binding) !== key ||
          binding.attempt !== delivery.attempt ||
          binding.externalThreadID !== participant.externalThreadID ||
          binding.externalTurnID !== delivery.externalTurnID ||
          binding.review?.revisionDigest !== revisionDigest ||
          binding.settlement?.status !== "completed" ||
          governance?.kind !== "review" ||
          governance.status !== "valid" ||
          governance.reviewedRevisionDigest !== revisionDigest ||
          !(
            governance.receipt instanceof DelegationReceipt.External ||
            governance.receipt instanceof DelegationReceipt.Sdk
          ) ||
          !DelegationReceipt.matches(binding, governance.receipt) ||
          !isDeepStrictEqual(governance.source, binding.source)
        )
          return
        const [row, task, parentRow] = yield* Effect.all([
          db
            .select()
            .from(SessionMessageTable)
            .where(
              and(
                eq(SessionMessageTable.session_id, binding.parentSessionID),
                eq(SessionMessageTable.id, binding.source.messageID),
              ),
            )
            .get()
            .pipe(Effect.orDie),
          db
            .select()
            .from(TaskTable)
            .where(and(eq(TaskTable.session_id, binding.parentSessionID), eq(TaskTable.id, binding.parentTaskID)))
            .get()
            .pipe(Effect.orDie),
          db.select().from(SessionTable).where(eq(SessionTable.id, binding.parentSessionID)).get().pipe(Effect.orDie),
        ])
        if (!row || !parentRow) return
        const message = Schema.decodeUnknownOption(SessionMessage.Assistant)({
          ...row.data,
          id: row.id,
          type: row.type,
        })
        const call =
          Option.isSome(message) && message.value.agent === binding.agent
            ? message.value.content.find(
                (part) => part.type === "tool" && part.id === binding.source.id && part.name === "task",
              )
            : undefined
        const parent = fromRow(parentRow)
        if (
          call?.type !== "tool" ||
          (call.state.status !== "running" && call.state.status !== "completed") ||
          call.state.input.execution_type !== "external-cli" ||
          call.state.input.intent !== "review" ||
          call.state.input.revision_digest !== revisionDigest ||
          call.state.input.delegation_id !== state.delegation.id ||
          call.state.input.attended !== false ||
          parent.location.directory !== binding.location.directory ||
          parent.location.workspaceID !== binding.location.workspaceID ||
          (state.delegation.metaAgentID &&
            (parent.controller?.kind !== "root" || parent.controller.metaAgentID !== state.delegation.metaAgentID)) ||
          task?.status !== "completed" ||
          task.revision !== binding.parentTaskRevision + 1 ||
          task.output_digest !== DelegationReceipt.outputDigest(binding.settlement.text)
        )
          return
        return {
          governance,
          link: { parentTaskID: binding.parentTaskID, source: binding.source, artifact: undefined },
          settlementStatus: "completed" as const,
          binding,
          externalReceipt: governance.receipt,
        }
      }
      if (participant.provider !== "internal" || !participant.childSessionID) return
      const childSessionID = participant.childSessionID
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, childSessionID), eq(SessionMessageTable.type, "user")))
        .orderBy(SessionMessageTable.seq)
        .all()
        .pipe(Effect.orDie)
      const proofs = yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          if (inputID && row.id !== inputID) return
          const user = Schema.decodeUnknownOption(SessionMessage.User)({ ...row.data, id: row.id, type: row.type })
          if (Option.isNone(user)) return
          const link = Schema.decodeUnknownOption(
            Schema.Struct({
              parentTaskID: Schema.String,
              source: Permission.ToolSource,
              artifact: Schema.optionalKey(Schema.Struct({ previous: Schema.optionalKey(RevisionReference) })),
            }),
          )(user.value.metadata?.task)
          const reference = Schema.decodeUnknownOption(
            Schema.Struct({
              delegationID: DelegationID.ID,
              turnID: TurnID,
              participantID: ParticipantID,
              deliveryOrigin: Schema.String,
              senderParticipantID: ParticipantID,
              attempt: Schema.Int,
            }),
          )(user.value.metadata?.delegation)
          if (Option.isNone(reference)) return
          const receipt = Schema.decodeUnknownOption(Delegation.Receipt)({
            ...reference.value,
            childSessionID,
            inputID: row.id,
          })
          if (Option.isNone(link) || Option.isNone(receipt)) return
          if (
            receipt.value.delegationID !== state.delegation.id ||
            receipt.value.turnID !== turnID ||
            receipt.value.participantID !== participantID ||
            DelegationFold.inputID(state.delegation.id, receipt.value) !== row.id
          )
            return
          const saved = yield* kv.get(
            `delegation:task-settlement:${DelegationReceipt.notificationID(row.id, link.value.parentTaskID)}`,
          )
          const decoded = Schema.decodeUnknownOption(
            Schema.Struct({
              governance: Governance,
              status: Schema.optionalKey(Schema.Literals(["completed", "failed", "cancelled", "recovery_required"])),
              revision: Schema.optionalKey(Schema.Int),
            }),
          )(saved)
          if (Option.isNone(decoded)) return
          const governance = decoded.value.governance
          if (
            !isDeepStrictEqual(governance.receipt, receipt.value) ||
            !isDeepStrictEqual(governance.source, link.value.source) ||
            ("status" in governance && governance.status === "invalid") ||
            (governance.kind === "revision" &&
              "artifact" in governance &&
              governance.artifact.revisionDigest !== revisionDigest) ||
            (governance.kind === "review" &&
              "reviewedRevisionDigest" in governance &&
              governance.reviewedRevisionDigest !== revisionDigest)
          )
            return
          const result = yield* SessionInputResult.read(db, { sessionID: childSessionID, inputID: row.id }).pipe(
            Effect.orDie,
          )
          if (result.status !== "completed") return
          return {
            governance,
            link: link.value,
            settlementStatus: decoded.value.revision === undefined ? undefined : decoded.value.status,
            binding: undefined,
            externalReceipt: undefined,
          }
        }),
      )
      return proofs.find((proof) => proof !== undefined)
    })

    const requireExternalReviews = Effect.fn("DelegationService.requireExternalReviews")(function* (
      state: DelegationFoldState,
      operation: "complete" | "archive",
    ) {
      const participants = [...state.participants.values()].filter(
        (participant) =>
          (participant.provider === "codex" ||
            (participant.provider === "claude-code" && participant.role === "reviewer")) &&
          participant.externalThreadID,
      )
      if (!participants.length) return []
      const records = (yield* DelegationProjector.readEvents(db, state.delegation.id)).flatMap((event) =>
        event.type === DelegationEvent.ReviewApproved.type ||
        event.type === DelegationEvent.ReviewRejected.type ||
        event.type === DelegationEvent.ReviewChangesRequested.type
          ? [
              {
                data: Schema.decodeUnknownSync(DelegationEvent.ReviewApprovedData)(event.data),
                verdict:
                  event.type === DelegationEvent.ReviewApproved.type
                    ? "approved"
                    : event.type === DelegationEvent.ReviewRejected.type
                      ? "rejected"
                      : "changes_requested",
              },
            ]
          : [],
      )
      return yield* Effect.forEach(participants, (participant) =>
        Effect.gen(function* () {
          const record = records.findLast((value) => value.data.participantID === participant.id)
          const proof = record
            ? yield* proofFor(state, record.data.turnID, participant.id, record.data.reviewedRevisionDigest)
            : undefined
          if (
            !proof?.externalReceipt ||
            proof.governance.kind !== "review" ||
            proof.governance.status !== "valid" ||
            proof.governance.envelope.verdict !== record?.verdict ||
            !isDeepStrictEqual(proof.governance.envelope.findings, record.data.findings) ||
            proof.governance.envelope.summary !== record.data.summary
          )
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: state.delegation.id,
              currentStatus: state.delegation.status,
              attemptedTransition: operation,
              reason: "External governance requires the matching completed foreground review proof",
            })
          return { binding: proof.binding, receipt: proof.externalReceipt }
        }),
      )
    })

    const revision = Effect.fn("DelegationService.revision")(function* (input: {
      readonly delegationID: DelegationID.ID
      readonly revisionDigest: Delegation.RevisionDigest
    }) {
      const state = yield* requireState(input.delegationID)
      const record = (yield* DelegationProjector.readEvents(db, input.delegationID))
        .flatMap((event) =>
          event.type === DelegationEvent.RevisionRecorded.type
            ? [Schema.decodeUnknownSync(DelegationEvent.RevisionRecordedData)(event.data)]
            : [],
        )
        .find((data) => data.revisionDigest === input.revisionDigest)
      const proof = record
        ? yield* proofFor(state, record.turnID, record.participantID, input.revisionDigest)
        : undefined
      if (!record || !proof || proof.governance.kind !== "revision" || !("artifact" in proof.governance))
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "review",
          reason: "Review requires a verified internal revision produced by a completed Task input",
        })
      return new RevisionReference({
        receipt: proof.governance.receipt,
        source: proof.governance.source,
        path: path.join(proof.governance.artifact.repository, proof.governance.artifact.path),
        revisionDigest: input.revisionDigest,
        artifact: proof.governance.artifact,
      })
    })

    const requireParent = Effect.fn("DelegationService.requireParent")(function* (
      parentSessionID: Session.ID,
      delegationID: DelegationID.ID,
      operation: string,
    ) {
      const row = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, parentSessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row) return yield* new Delegation.DelegationParentSessionNotFoundError({ parentSessionID })
      const parent = fromRow(row)
      if (parent.controller?.kind === "child")
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID,
          currentStatus: "meta_child",
          attemptedTransition: operation,
          reason: "Meta children cannot create or extend delegations",
        })
      yield* metas.assertOwner(parent).pipe(
        Effect.mapError(
          (error) =>
            new Delegation.DelegationInvalidStateError({
              delegationID,
              currentStatus: "invalid_owner",
              attemptedTransition: operation,
              reason: error.message,
            }),
        ),
      )
      return parent
    })

    const requireBinding = Effect.fn("DelegationService.requireBinding")(function* (
      state: DelegationFoldState,
      input: { readonly childSessionID?: Session.ID; readonly externalThreadID?: string },
      participantID: ParticipantID | undefined,
      operation: "addParticipant" | "bindParticipant",
    ) {
      if (input.childSessionID !== undefined) {
        const [childSession, parentSession, bindings] = yield* Effect.all([
          db.select().from(SessionTable).where(eq(SessionTable.id, input.childSessionID)).get().pipe(Effect.orDie),
          db
            .select()
            .from(SessionTable)
            .where(eq(SessionTable.id, state.delegation.parentSessionID))
            .get()
            .pipe(Effect.orDie),
          db
            .select({ id: DelegationParticipantTable.id, delegation_id: DelegationParticipantTable.delegation_id })
            .from(DelegationParticipantTable)
            .where(eq(DelegationParticipantTable.child_session_id, input.childSessionID))
            .all()
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
          bindings.some((binding) => binding.delegation_id !== state.delegation.id || binding.id !== participantID)
        )
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: state.delegation.id,
            currentStatus: state.delegation.status,
            attemptedTransition: operation,
            reason: `Child session ${input.childSessionID} does not belong to parent session ${state.delegation.parentSessionID} or is already bound`,
          })
        if (state.delegation.metaAgentID) {
          const participant = participantID ? state.participants.get(participantID) : undefined
          if (
            parentSession.controller?.kind !== "root" ||
            parentSession.controller.metaAgentID !== state.delegation.metaAgentID ||
            childSession.controller?.kind !== "child" ||
            !participant?.executor ||
            !sameExecutor(participant.executor, childSession.controller.executor) ||
            childSession.controller.metaAgentID !== parentSession.controller.metaAgentID ||
            childSession.controller.rootSessionID !== parentSession.id ||
            childSession.controller.source.kind !== "task" ||
            childSession.controller.source.delegationID !== state.delegation.id ||
            childSession.controller.source.participantID !== participantID
          )
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: state.delegation.id,
              currentStatus: state.delegation.status,
              attemptedTransition: operation,
              reason: "Meta participant and child owner/binding disagree",
            })
        }
        if (!state.delegation.metaAgentID && childSession.controller)
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: state.delegation.id,
            currentStatus: state.delegation.status,
            attemptedTransition: operation,
            reason: "Ordinary delegation cannot adopt a Meta child",
          })
      }
      const conflictingParticipant = [...state.participants.values()].find(
        (candidate) =>
          candidate.id !== participantID &&
          input.externalThreadID !== undefined &&
          candidate.externalThreadID === input.externalThreadID,
      )
      if (conflictingParticipant)
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: state.delegation.id,
          currentStatus: state.delegation.status,
          attemptedTransition: operation,
          reason: `External thread ${input.externalThreadID} is already bound to participant ${conflictingParticipant.id}`,
        })
      if (input.externalThreadID !== undefined) {
        const bindings = yield* db
          .select()
          .from(DelegationParticipantTable)
          .where(eq(DelegationParticipantTable.external_thread_id, input.externalThreadID))
          .all()
          .pipe(Effect.orDie)
        if (bindings.some((binding) => binding.delegation_id !== state.delegation.id || binding.id !== participantID))
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: state.delegation.id,
            currentStatus: state.delegation.status,
            attemptedTransition: operation,
            reason: "External thread already belongs to another participant or parent",
          })
      }
    })

    const metaOwnerFor = (parent: Session.Info, agent?: Session.Info["agent"]) =>
      (agent ?? parent.agent) === "meta" ? parent.controller?.metaAgentID : undefined

    const create = Effect.fn("DelegationService.create")(function* (input: CreateInput, source?: Delegation.Info) {
      const id = input.delegationID ?? DelegationID.ID.create()
      const parent = yield* requireParent(input.parentSessionID, id, "create")
      const metaAgentID = source ? source.metaAgentID : (metaOwnerFor(parent, input.agent) ?? input.metaAgentID)
      if (parent.controller && metaAgentID !== undefined && metaAgentID !== parent.controller.metaAgentID)
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: id,
          currentStatus: "invalid_owner",
          attemptedTransition: "create",
          reason: "Delegation cannot mint a different Meta owner",
        })
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
        metaAgentID,
        title: input.title,
        status: "draft",
        timestamp,
      })
      return new Delegation.Info({
        id,
        parentSessionID: input.parentSessionID,
        metaAgentID,
        title: input.title,
        status: "draft",
        rejectionBlocked: false,
        lastActivityAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    })

    const participantExecutorError = (
      parent: Session.Info,
      state: DelegationFoldState,
      input: AddParticipantInput,
      operation: "addParticipant" | "fork",
    ) => {
      if (
        state.delegation.metaAgentID &&
        (parent.controller?.kind !== "root" ||
          (input.provider === "internal"
            ? !input.executor || input.executor.agent !== input.target
            : !(
                (input.provider === "codex" || input.provider === "claude-code") &&
                input.target === input.provider &&
                (input.role === "implementer" || input.role === "reviewer")
              ) ||
              input.context !== "fresh" ||
              input.executor !== undefined) ||
          state.delegation.metaAgentID !== parent.controller.metaAgentID)
      )
        return new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: operation,
          reason: "Meta participant requires its first internal executor binding",
        })
      if (!state.delegation.metaAgentID && input.executor)
        return new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: operation,
          reason: "Ordinary participant cannot adopt a Meta executor binding",
        })
    }

    // Callers validate before this shared durable creation boundary; Meta fork creates each source slot.
    const createParticipant = Effect.fnUntraced(function* (input: AddParticipantInput, id = ParticipantID.create()) {
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
        executor: input.executor,
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
        executor: input.executor,
        externalThreadID: input.externalThreadID,
        lastActivityAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    })

    const addParticipant = Effect.fn("DelegationService.addParticipant")(function* (input: AddParticipantInput) {
      const state = yield* requireState(input.delegationID)
      const parent = yield* requireParent(state.delegation.parentSessionID, input.delegationID, "addParticipant")
      const invalidExecutor = participantExecutorError(parent, state, input, "addParticipant")
      if (invalidExecutor) return yield* invalidExecutor
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
        if (input.executor && (!existing.executor || !sameExecutor(existing.executor, input.executor)))
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: existing.phase,
            attemptedTransition: "addParticipant",
            reason: "Participant executor binding changed; create a new participant",
          })
        return existing
      }
      yield* requireBinding(state, input, undefined, "addParticipant")
      return yield* createParticipant(input)
    })

    const bindParticipant = Effect.fn("DelegationService.bindParticipant")(function* (input: {
      readonly delegationID: DelegationID.ID
      readonly participantID: ParticipantID
      readonly childSessionID?: Session.ID
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
      yield* requireBinding(state, input, input.participantID, "bindParticipant")
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

    const appendTurn = Effect.fn("DelegationService.appendTurn")(function* (input: AppendTurnInput, turnID?: TurnID) {
      return yield* mutationLocks.withLock(input.delegationID)(
        Effect.gen(function* () {
          const state = yield* foldState(input.delegationID)
          if (state === undefined) {
            return yield* new Delegation.DelegationNotFoundError({ delegationID: input.delegationID })
          }
          yield* requireParent(state.delegation.parentSessionID, input.delegationID, "appendTurn")
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
          if (input.kind === "review") {
            if (!input.revisionDigest || state.delegation.latestRevisionDigest !== input.revisionDigest)
              return yield* new Delegation.DelegationInvalidStateError({
                delegationID: input.delegationID,
                currentStatus: state.delegation.status,
                attemptedTransition: "appendTurn",
                reason: "Review must bind the current recorded revision",
              })
            yield* revision({ delegationID: input.delegationID, revisionDigest: input.revisionDigest })
            if (participantIDs.some((id) => !["reviewer", "approver"].includes(state.participants.get(id)?.role ?? "")))
              return yield* new Delegation.DelegationInvalidStateError({
                delegationID: input.delegationID,
                currentStatus: state.delegation.status,
                attemptedTransition: "appendTurn",
                reason: "Review must target an admitted reviewer or approver",
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
          const id = turnID ?? TurnID.create()
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
          yield* events.publishAll([
            [DelegationEvent.TurnAdmitted, turnData],
            ...participantIDs.map(
              (participantID) =>
                [
                  DelegationEvent.DeliveryAdmitted,
                  {
                    delegationID: input.delegationID,
                    turnID: id,
                    participantID,
                    deliveryOrigin: input.origin.deliveryOrigin,
                    senderParticipantID: input.origin.senderParticipantID,
                    attempt: 1,
                    status: input.delivery === "queue" ? "queued" : "admitted",
                    timestamp,
                  },
                ] as const,
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
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "recordRevision",
          reason: "Only an admitted implementer can record a revision",
        })
      }
      const proof = input.receipt
        ? yield* proofFor(state, input.turnID, input.participantID, input.revisionDigest, input.receipt.inputID)
        : undefined
      const governance = proof?.governance
      if (
        input.receipt &&
        (!governance ||
          governance.kind !== "revision" ||
          !("artifact" in governance) ||
          !isDeepStrictEqual(governance.receipt, input.receipt) ||
          !isDeepStrictEqual(governance.source, input.source) ||
          governance.artifact.commitSha !== input.commitSha ||
          governance.artifact.changeKind !== input.changeKind)
      )
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "recordRevision",
          reason: "Revision has no matching completed input evidence",
        })
      const records = (yield* DelegationProjector.readEvents(db, input.delegationID)).flatMap((event) =>
        event.type === DelegationEvent.RevisionRecorded.type
          ? [Schema.decodeUnknownSync(DelegationEvent.RevisionRecordedData)(event.data)]
          : [],
      )
      const previous = records.find((data) => data.revisionDigest === input.revisionDigest)
      const admission = proof?.link.artifact?.previous
      const originalRecord = previous ?? records.find((data) => data.revisionDigest === admission?.revisionDigest)
      const original =
        originalRecord && input.receipt
          ? yield* proofFor(state, originalRecord.turnID, originalRecord.participantID, originalRecord.revisionDigest)
          : undefined
      if (
        previous &&
        previous.turnID === input.turnID &&
        previous.participantID === input.participantID &&
        previous.commitSha === input.commitSha &&
        input.receipt &&
        original &&
        isDeepStrictEqual(original.governance.receipt, input.receipt) &&
        isDeepStrictEqual(original.governance.source, input.source)
      )
        return "reused" as const
      if (previous && !admission)
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "recordRevision",
          reason: "Revision digest belongs to a different producing input",
        })
      if (admission) {
        const producer = original?.governance
        if (
          !proof ||
          !governance ||
          !("artifact" in governance) ||
          !producer ||
          !("artifact" in producer) ||
          admission.receipt.participantID !== input.participantID ||
          admission.receipt.childSessionID !== governance.receipt.childSessionID ||
          !isDeepStrictEqual(
            admission,
            new RevisionReference({
              receipt: producer.receipt,
              source: producer.source,
              path: path.join(producer.artifact.repository, producer.artifact.path),
              revisionDigest: producer.artifact.revisionDigest,
              artifact: producer.artifact,
            }),
          ) ||
          !isDeepStrictEqual(governance.artifact.location, producer.artifact.location) ||
          governance.artifact.repository !== producer.artifact.repository ||
          governance.artifact.path !== producer.artifact.path ||
          (governance.artifact.commitSha !== producer.artifact.commitSha &&
            (previous !== undefined || governance.artifact.changeKind !== "no_code_change")) ||
          governance.artifact.baseSha256 !== producer.artifact.baseSha256
        )
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "recordRevision",
            reason: "Artifact baseline has no matching original producer lineage",
          })
        if (previous) {
          const reference = new RevisionReference({
            receipt: producer.receipt,
            source: producer.source,
            path: admission.path,
            revisionDigest: admission.revisionDigest,
          })
          if (
            input.changeKind !== "no_change" ||
            !isDeepStrictEqual(
              governance.artifact,
              new ArtifactEvidence({ ...producer.artifact, changeKind: "no_change" }),
            ) ||
            (governance.producer && !isDeepStrictEqual(governance.producer, reference))
          )
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: input.delegationID,
              currentStatus: state.delegation.status,
              attemptedTransition: "recordRevision",
              reason: "Revision digest belongs to a different producing input",
            })
          const delivery = state.deliveries.get(
            DelegationFold.deliveryKey(
              input.turnID,
              input.participantID,
              governance.receipt.deliveryOrigin,
              governance.receipt.senderParticipantID,
            ),
          )
          // A completed copy is replayed from its own settlement even after a newer revision exists.
          if (
            delivery?.status === "completed" &&
            delivery.attempt === governance.receipt.attempt &&
            proof.settlementStatus === "completed" &&
            isDeepStrictEqual(governance.producer, reference)
          )
            return "reused" as const
        }
        if (state.delegation.latestRevisionDigest !== admission.revisionDigest)
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "recordRevision",
            reason: "Artifact baseline is no longer the latest revision",
          })
        if (previous) return "reused" as const
      }
      yield* events.publish(DelegationEvent.RevisionRecorded, { ...input, timestamp: yield* now })
      return "recorded" as const
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
      if (input.receipt) {
        const proof = yield* proofFor(
          state,
          input.turnID,
          input.participantID,
          input.reviewedRevisionDigest,
          "inputID" in input.receipt ? input.receipt.inputID : undefined,
        )
        if (
          turn.kind !== "review" ||
          turn.revisionDigest !== input.reviewedRevisionDigest ||
          !proof ||
          proof.governance.kind !== "review" ||
          !("envelope" in proof.governance) ||
          !isDeepStrictEqual(proof.governance.receipt, input.receipt) ||
          !isDeepStrictEqual(proof.governance.source, input.source) ||
          proof.governance.envelope.verdict !== input.verdict ||
          !isDeepStrictEqual(proof.governance.envelope.findings, input.findings) ||
          proof.governance.envelope.summary !== input.summary
        )
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "recordReview",
            reason: "Review has no matching completed input envelope",
          })
        const previous = (yield* DelegationProjector.readEvents(db, input.delegationID))
          .flatMap((event) =>
            event.type === DelegationEvent.ReviewApproved.type ||
            event.type === DelegationEvent.ReviewChangesRequested.type ||
            event.type === DelegationEvent.ReviewRejected.type
              ? [Schema.decodeUnknownSync(DelegationEvent.ReviewApprovedData)(event.data)]
              : [],
          )
          .find((data) => data.turnID === input.turnID && data.participantID === input.participantID)
        if (previous) {
          const original = yield* proofFor(state, input.turnID, input.participantID, input.reviewedRevisionDigest)
          if (
            !original ||
            !isDeepStrictEqual(original.governance.receipt, input.receipt) ||
            !isDeepStrictEqual(original.governance.source, input.source)
          )
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID: input.delegationID,
              currentStatus: state.delegation.status,
              attemptedTransition: "recordReview",
              reason: "Review belongs to a different producing input",
            })
          return "reused" as const
        }
      }
      const { verdict, ...review } = input
      const data = { ...review, timestamp: yield* now }
      if (verdict === "approved") {
        yield* events.publish(DelegationEvent.ReviewApproved, data)
        return "recorded" as const
      }
      if (verdict === "changes_requested") {
        yield* events.publish(DelegationEvent.ReviewChangesRequested, data)
        return "recorded" as const
      }
      yield* events.publish(DelegationEvent.ReviewRejected, data)
      return "recorded" as const
    })

    const get = Effect.fn("DelegationService.get")(function* (delegationID: DelegationID.ID) {
      return (yield* foldState(delegationID))?.delegation
    })

    const list = Effect.fn("DelegationService.list")(function* (
      input: { readonly parentSessionID?: Session.ID; readonly includeArchived?: boolean } = {},
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
      readonly delegationID: DelegationID.ID
      readonly participantID: ParticipantID
    }) {
      return yield* requireParticipant(yield* requireState(input.delegationID), input.delegationID, input.participantID)
    })

    const listTurns = Effect.fn("DelegationService.listTurns")(function* (delegationID: DelegationID.ID) {
      return [...(yield* requireState(delegationID)).turns.values()].sort((left, right) => left.seq - right.seq)
    })

    const retractRejection = Effect.fn("DelegationService.retractRejection")(function* (input: {
      readonly delegationID: DelegationID.ID
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
      readonly delegationID: DelegationID.ID
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

    const readMetaOwner = Effect.fnUntraced(function* (parentSessionID: Session.ID, agent?: Session.Info["agent"]) {
      const parent = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, parentSessionID))
        .get()
        .pipe(Effect.orDie)
      if (!parent) return yield* new Delegation.DelegationParentSessionNotFoundError({ parentSessionID })
      return metaOwnerFor(fromRow(parent), agent)
    })

    const resolveActive = Effect.fn("DelegationService.resolveActive")(function* (
      parentSessionID: Session.ID,
      agent?: Session.Info["agent"],
    ) {
      const metaAgentID = yield* readMetaOwner(parentSessionID, agent)
      const row = yield* db
        .select({ id: DelegationTable.id })
        .from(DelegationTable)
        .where(
          and(
            eq(DelegationTable.parent_session_id, parentSessionID),
            metaAgentID ? eq(DelegationTable.meta_agent_id, metaAgentID) : isNull(DelegationTable.meta_agent_id),
            // Soft expiry is a derived visibility/admission policy, not a
            // domain status. Expired rows remain auditable but are no longer
            // selected as the current interactive delegation.
            gt(DelegationTable.last_activity_at, (yield* now) - softExpiryMs()),
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
            const state = yield* requireState(input.delegationID)
            if (state.delegation.metaAgentID !== (yield* readMetaOwner(input.parentSessionID, input.agent)))
              return yield* new Delegation.DelegationInvalidStateError({
                delegationID: input.delegationID,
                currentStatus: state.delegation.status,
                attemptedTransition: "resolve",
                reason: "Delegation does not belong to the captured Agent's owner",
              })
            return state
          }
          if (!input.newDelegation) {
            const active = yield* resolveActive(input.parentSessionID, input.agent)
            if (active) return active
          }
          const created = yield* create({
            parentSessionID: input.parentSessionID,
            agent: input.agent,
            title: input.title,
          })
          return yield* requireState(created.id)
        }),
      )
    })

    const close = Effect.fn("DelegationService.close")(function* (input: {
      readonly delegationID: DelegationID.ID
      readonly reason?: string
      readonly requireComplete?: boolean
    }) {
      const state = yield* requireState(input.delegationID)
      if (input.requireComplete) {
        if (
          state.delegation.status === "cancelled" ||
          (state.delegation.status === "archived" && state.archivedFrom !== "completed")
        )
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "complete",
            reason: "Completion requires a completed terminal origin",
          })
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
        )
          return yield* new Delegation.DelegationBarrierNotMetError({
            delegationID: input.delegationID,
            missingRoles: [],
            reason: "Delegation completion barrier is not satisfied",
          })
        yield* requireExternalReviews(state, "complete")
      }
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

    const archive = Effect.fn("DelegationService.archive")(function* (
      input: {
        readonly delegationID: DelegationID.ID
        readonly source?: Permission.Source
      },
      proofs?: readonly {
        readonly binding: DelegationReceipt.Binding
        readonly receipt: DelegationReceipt.External | DelegationReceipt.Sdk
      }[],
    ) {
      const state = yield* requireState(input.delegationID)
      const bindings = proofs ?? (yield* requireExternalReviews(state, "archive"))
      if (state.delegation.status === "archived") return
      yield* assertTransition(input.delegationID, state.delegation.status, "archived")
      for (const proof of bindings) {
        const binding = proof.binding
        // SDK queries close at settlement; SDK history stays with the existing local archive.
        if (proof.receipt instanceof DelegationReceipt.Sdk) continue
        if (binding.archiveReceipts?.some((receipt) => receipt.status === "completed")) continue
        const descriptor = CliAdapter.getCliAdapter(binding.target)
        const adapter = descriptor?.forCommand?.(binding.command)
        if (descriptor?.transport !== "app-server" || !adapter?.archiveThread)
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "archive",
            reason: "The bound app-server archive transport is unavailable",
          })
        const result = yield* adapter
          .archiveThread(proof.receipt.externalThreadID, { workingDirectory: binding.location.directory })
          .pipe(
            Effect.match({
              onSuccess: () => ({ status: "completed" as const }),
              onFailure: (error) => ({ status: "failed" as const, error: String(error) }),
            }),
          )
        yield* kv.set(
          DelegationReceipt.key(binding),
          Schema.encodeSync(Schema.toCodecJson(DelegationReceipt.Binding))(
            new DelegationReceipt.Binding({
              ...binding,
              archiveReceipts: [
                ...(binding.archiveReceipts ?? []),
                { ...result, timestamp: yield* now, ...(input.source ? { source: input.source } : {}) },
              ],
            }),
          ),
        )
        if (result.status === "failed")
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "archive",
            reason: `Native thread archive failed: ${result.error}`,
          })
      }
      for (const participant of state.participants.values()) {
        if (participant.provider === "codex") continue
        if (participant.externalThreadID) {
          const adapter = CliAdapter.getCliAdapter(participant.target) ?? CliAdapter.getCliAdapter(participant.provider)
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
      readonly delegationID: DelegationID.ID
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
      if (state.archivedFrom === undefined) {
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID: input.delegationID,
          currentStatus: state.delegation.status,
          attemptedTransition: "unarchive",
          reason: "Archived delegation has no original terminal status",
        })
      }
      if (
        state.archivedFrom === "completed" &&
        !canComplete({
          participants: [...state.participants.values()],
          reviews: state.reviews,
          latestRevisionDigest: state.delegation.latestRevisionDigest,
          revisions: state.revisions,
          rejectionBlocked: state.delegation.rejectionBlocked,
          deliveries: [...state.deliveries.values()],
          turns: [...state.turns.values()],
        })
      )
        return yield* new Delegation.DelegationBarrierNotMetError({
          delegationID: input.delegationID,
          missingRoles: [],
          reason: "Delegation completion barrier is not satisfied",
        })
      yield* events.publish(DelegationEvent.Unarchived, {
        delegationID: input.delegationID,
        timestamp: yield* now,
      })
    })

    const fork = Effect.fn("DelegationService.fork")(function* (input: {
      readonly delegationID: DelegationID.ID
      readonly title?: string
      readonly reason?: string
    }) {
      const state = yield* requireState(input.delegationID)
      const parent = yield* requireParent(state.delegation.parentSessionID, input.delegationID, "fork")
      const delegationID = DelegationID.ID.create()
      const roster = [...state.participants.values()].map((participant) => ({
        delegationID,
        provider: participant.provider,
        target: participant.target,
        role: participant.role,
        context: "fork" as const,
        executor: state.delegation.metaAgentID ? participant.executor : undefined,
      }))
      const invalidExecutor = roster
        .map((participant) => participantExecutorError(parent, state, participant, "fork"))
        .find((error) => error !== undefined)
      if (invalidExecutor) return yield* invalidExecutor
      const created = yield* create(
        {
          delegationID,
          parentSessionID: state.delegation.parentSessionID,
          metaAgentID: state.delegation.metaAgentID,
          title: input.title ?? `${state.delegation.title} (fork)`,
        },
        state.delegation,
      )
      yield* events.publish(DelegationEvent.Forked, {
        delegationID: input.delegationID,
        forkedDelegationID: created.id,
        reason: input.reason,
        timestamp: yield* now,
      })
      yield* Effect.forEach(
        roster,
        (participant) => (state.delegation.metaAgentID ? createParticipant(participant) : addParticipant(participant)),
        { discard: true },
      )
      return yield* requireState(created.id)
    })

    const complete = Effect.fn("DelegationService.complete")(function* (input: {
      readonly delegationID: DelegationID.ID
      readonly summary?: string
      readonly source?: Permission.Source
    }) {
      const state = yield* requireState(input.delegationID)
      if (state.delegation.status === "archived") {
        yield* requireExternalReviews(state, "complete")
        return
      }
      if (state.delegation.status === "completed") {
        yield* archive({ delegationID: input.delegationID, source: input.source })
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
      const bindings = yield* requireExternalReviews(state, "complete")
      yield* events.publish(DelegationEvent.Completed, {
        delegationID: input.delegationID,
        summary: input.summary,
        timestamp: yield* now,
      })
      yield* archive({ delegationID: input.delegationID, source: input.source }, bindings)
    })

    const deleteDelegation = Effect.fn("DelegationService.delete")(function* (input: {
      readonly delegationID: DelegationID.ID
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
        if (
          [...state.participants.values()].some(
            (participant) => participant.provider === "codex" && participant.externalThreadID,
          )
        )
          return yield* new Delegation.DelegationInvalidStateError({
            delegationID: input.delegationID,
            currentStatus: state.delegation.status,
            attemptedTransition: "delete",
            reason: "External purge is not supported by this execution slice",
          })
        for (const participant of state.participants.values()) {
          if (participant.externalThreadID) {
            const adapter =
              CliAdapter.getCliAdapter(participant.target) ?? CliAdapter.getCliAdapter(participant.provider)
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
            }
            if (!adapter?.deleteThread && adapter?.archiveThread) {
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
      readonly delegationID: DelegationID.ID
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

    // Thread continuation is not proof that a lost attempt's external effects are safe to repeat.
    // Keep receipts unchanged until an adapter can reconcile that exact attempt durably (plan §16.11).
    const reconcileResume = Effect.fn("DelegationService.reconcileResume")(function* (input: {
      readonly delegationID: DelegationID.ID
    }) {
      yield* requireState(input.delegationID)
      return 0
    })

    const internalParticipant = Effect.fn("DelegationService.internalParticipant")(function* (
      input: Parameters<Interface["internalParticipant"]>[0],
    ) {
      const row = yield* db
        .select({ data: ScheduleOccurrenceTable.data })
        .from(ScheduleOccurrenceTable)
        .where(eq(ScheduleOccurrenceTable.id, input.occurrenceID))
        .get()
        .pipe(Effect.orDie)
      const run = row ? Schema.decodeUnknownSync(Schedule.Occurrence)(row.data) : undefined
      const hash = input.occurrenceID.slice("sco_".length)
      const delegationID = DelegationID.ID.make(`dlg_schedule_${hash}`)
      const participantID = ParticipantID.make(`par_schedule_${hash}`)
      const turnID = TurnID.make(`trn_schedule_${hash}`)
      if (!run || run.snapshot.target?.policy !== "legacy_child" || run.snapshot.kind !== "task")
        return yield* new Delegation.DelegationInvalidStateError({
          delegationID,
          currentStatus: run?.status ?? "missing",
          attemptedTransition: "internalParticipant",
          reason: "Internal scheduled execution requires a persisted retained child occurrence",
        })
      yield* mutationLocks.withLock(delegationID)(
        Effect.gen(function* () {
          const saved = yield* foldState(delegationID)
          if (!saved)
            yield* create({
              parentSessionID: run.sessionID,
              agent: input.actor,
              delegationID,
              title: run.snapshot.content,
            })
          const state = yield* requireState(delegationID)
          if (state.delegation.parentSessionID !== run.sessionID)
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID,
              currentStatus: state.delegation.status,
              attemptedTransition: "internalParticipant",
              reason: "Schedule delegation belongs to a different source Session",
            })
          const participant = state.participants.get(participantID)
          if (participant) {
            if (
              participant.provider === "internal" &&
              participant.target === input.agent &&
              participant.role === "implementer"
            )
              return undefined
            return yield* new Delegation.DelegationInvalidStateError({
              delegationID,
              currentStatus: participant.phase,
              attemptedTransition: "internalParticipant",
              reason: "The frozen scheduled executor changed",
            })
          }
          const parent = yield* requireParent(run.sessionID, delegationID, "internalParticipant")
          const candidate: AddParticipantInput = {
            delegationID,
            provider: "internal",
            target: input.agent,
            role: "implementer",
            context: "fresh",
            executor: input.executor,
          }
          const error = participantExecutorError(parent, state, candidate, "addParticipant")
          if (error) return yield* error
          yield* createParticipant(candidate, participantID)
          return undefined
        }),
      )
      yield* appendTurn(
        {
          delegationID,
          kind: "task",
          promptSummary: run.snapshot.content,
          evidenceDigest: run.id,
          participantIDs: [participantID],
          delivery: run.snapshot.executionPolicy.delivery,
          origin: { deliveryOrigin: `schedule:${run.id}`, senderParticipantID: participantID },
        },
        turnID,
      )
      return { delegationID, participantID, turnID }
    })

    return Service.of({
      internalParticipant,
      create: (input) => {
        const delegationID = input.delegationID ?? DelegationID.ID.create()
        return mutationLocks.withLock(delegationID)(create({ ...input, delegationID }))
      },
      resolve,
      addParticipant: serialized(addParticipant),
      bindParticipant: serialized(bindParticipant),
      appendTurn,
      recordDelivery: serialized(recordDelivery),
      recordRevision: serialized(recordRevision),
      recordReview: serialized(recordReview),
      revision,
      foldState,
      resolveActive,
      get,
      list,
      getParticipant,
      listTurns,
      retractRejection: serialized(retractRejection),
      retry: serialized(retry),
      close: serialized(close),
      complete: serialized(complete),
      archive: serialized(archive),
      unarchive: serialized(unarchive),
      fork: serialized(fork),
      delete: serialized(deleteDelegation),
      reconcile: serialized(reconcile),
      reconcileResume: serialized(reconcileResume),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [DelegationProjector.node, Bus.node, Database.node, MetaAgentService.node, KV.node],
})
