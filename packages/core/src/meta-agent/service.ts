export * as MetaAgentService from "./service"

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Result, Schema } from "effect"
import { Database } from "../database/database"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { Agent } from "../agent"
import { Model } from "../model"
import { ModelGroup } from "@aigcfroge/schema/model-group"
import { SessionSchema } from "../session/schema"
import { SessionIdentity } from "@aigcfroge/schema/session-identity"
import { MetaAgentTable, MetaAgentSessionTable, MetaAgentStepTable } from "./sql"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { SessionMessageTable, SessionTable, TaskTable } from "../session/sql.js"
import { fromRow } from "../session/info.js"
import { SessionMessage } from "../session/message.js"
import { SessionComposition } from "../session/composition.js"
import { CompositionDigest } from "../composition/digest.js"
import { WorkflowRunTable, WorkflowStepRunTable } from "../workflow/sql.js"
import { WorkflowRun } from "../workflow/workflow-run.js"
import { SessionEvent } from "../session/event.js"
import { ControllerConflictError, NotFoundError, bindingMatches, sameExecutor } from "../session/error.js"
import { DelegationParticipantTable, DelegationTable } from "../delegation/sql.js"
import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationFold } from "../delegation/fold.js"
import { DelegationProjector } from "../delegation/projector.js"
import { DelegationReceipt } from "../delegation/receipt.js"
import { KVTable } from "../kv/sql.js"
import { SessionInbox } from "../session/inbox.js"
import { Permission } from "@aigcfroge/schema/permission"
import { Event } from "@aigcfroge/schema/event"
import { EventTable } from "../event/sql"
import { ProductModePolicy } from "../product-mode-policy.js"

/** The admitted Workflow step owns this deterministic input identity. */
export const workflowInputID = (stepID: string) =>
  SessionMessage.ID.make(`msg_${CompositionDigest.computeDigest({ workflowStep: stepID }).slice(0, 32)}`)

/**
 * Input for creating a new meta agent configuration.
 */
export interface CreateInput {
  readonly id?: MetaAgent.ID
  readonly title: string
  readonly agent: string
  readonly model: typeof Model.Selection.Encoded
  readonly groupBehavior?: typeof ModelGroup.BehaviorSnapshot.Encoded
  readonly created?: number
}

/**
 * A session attached to a meta agent, with its role.
 */
export type AttachedSession = MetaAgent.AttachedSession

export interface CoordinationCapture {
  readonly agent?: Agent.ID
  readonly selection?: SessionIdentity.CoordinationSelection
  readonly tool?: string
}

export interface Interface {
  readonly assertChildSource: (
    parent: SessionSchema.Info,
    childID: SessionSchema.ID,
    executor: SessionSchema.ExecutorBinding | undefined,
    source: SessionSchema.ControllerSource,
    metadata?: SessionSchema.Metadata,
    bound?: boolean,
  ) => Effect.Effect<SessionSchema.ChildController | undefined, ControllerConflictError>
  readonly assertOwner: (session: SessionSchema.Info) => Effect.Effect<void, ControllerConflictError>
  readonly coordination: (
    sessionID: SessionSchema.ID,
    capture?: CoordinationCapture,
  ) => Effect.Effect<SessionIdentity.Coordination, NotFoundError>
  readonly assertCoordination: (
    sessionID: SessionSchema.ID,
    capture?: CoordinationCapture,
  ) => Effect.Effect<SessionIdentity.Coordination, NotFoundError | ControllerConflictError>
  readonly assertCommunication: (
    sessionID: SessionSchema.ID,
    route: { readonly sourceSessionID: SessionSchema.ID; readonly targetSessionID: SessionSchema.ID },
    capture?: CoordinationCapture,
  ) => Effect.Effect<
    { readonly rootSessionID: SessionSchema.ID; readonly selection: SessionIdentity.CoordinationSelection },
    NotFoundError | ControllerConflictError
  >
  readonly materialize: (event: SessionEvent.DurableEvent) => Effect.Effect<void>
  readonly create: (input: CreateInput) => Effect.Effect<MetaAgent.Info>
  readonly setModel: (input: {
    readonly id: MetaAgent.ID
    readonly model: Model.Selection
    readonly groupBehavior?: ModelGroup.BehaviorSnapshot
    readonly updated?: number
  }) => Effect.Effect<void>
  readonly get: (id: MetaAgent.ID) => Effect.Effect<MetaAgent.Info | undefined>
  readonly list: () => Effect.Effect<MetaAgent.Info[]>
  readonly sessions: (metaID: MetaAgent.ID) => Effect.Effect<AttachedSession[]>
  readonly stats: (metaID: MetaAgent.ID) => Effect.Effect<MetaAgent.Stats>
  readonly attach: (input: {
    metaID: MetaAgent.ID
    sessionID: SessionSchema.ID
    role?: "orchestrator" | "worker" | "tool"
    effort?: string
    created?: number
  }) => Effect.Effect<void>
  readonly detach: (input: { metaID: MetaAgent.ID; sessionID: SessionSchema.ID }) => Effect.Effect<void>
  readonly remove: (id: MetaAgent.ID) => Effect.Effect<void>
  readonly findBySession: (
    sessionID: SessionSchema.ID,
  ) => Effect.Effect<{ metaID: MetaAgent.ID; sessionID: SessionSchema.ID; role: string } | undefined>
  readonly writeStep: (input: {
    metaAgentSessionID: string
    seq: number
    type: "subagent" | "external-cli" | "tool"
    engine: string
    prompt?: string
  }) => Effect.Effect<string>
  readonly updateStep: (input: {
    stepID: string
    status: "completed" | "failed"
    result?: string
    error?: string
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/MetaAgentService") {}

function rowToInfo(row: typeof MetaAgentTable.$inferSelect): MetaAgent.Info {
  return MetaAgent.Info.make({
    id: MetaAgent.ID.make(row.id),
    title: row.title,
    agent: Agent.ID.make(row.agent),
    model: Schema.decodeUnknownSync(Model.Selection)(row.model),
    groupBehavior:
      row.group_behavior === null
        ? undefined
        : Schema.decodeUnknownSync(ModelGroup.BehaviorSnapshot)(row.group_behavior),
    time: {
      created: DateTime.makeUnsafe(row.time_created),
      updated: DateTime.makeUnsafe(row.time_updated),
      archived: row.time_archived ? DateTime.makeUnsafe(row.time_archived) : undefined,
    },
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const compositions = yield* SessionComposition.Service

    const startedFor = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      assistantMessageID: SessionMessage.ID,
      before: number,
      ordinal?: number,
    ) {
      const attemptType = Event.versionedType(
        SessionEvent.Attempt.Started.type,
        SessionEvent.Attempt.Started.durable.version,
      )
      const row = yield* db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, sessionID),
            inArray(
              EventTable.type,
              ordinal === undefined
                ? [
                    attemptType,
                    Event.versionedType(SessionEvent.Step.Started.type, SessionEvent.Step.Started.durable.version),
                  ]
                : [attemptType],
            ),
            eq(sql<string>`json_extract(${EventTable.data}, '$.assistantMessageID')`, assistantMessageID),
            ordinal === undefined ? undefined : eq(sql<number>`json_extract(${EventTable.data}, '$.ordinal')`, ordinal),
            lt(EventTable.seq, before),
          ),
        )
        .orderBy(sql`case when ${EventTable.type} = ${attemptType} then 0 else 1 end`, desc(EventTable.seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      const data =
        row.type === attemptType
          ? Schema.decodeUnknownSync(SessionEvent.Attempt.Started.data)(row.data)
          : Schema.decodeUnknownSync(SessionEvent.Step.Started.data)(row.data)
      return { ...row, data }
    })

    const toolInputFor = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      assistantMessageID: SessionMessage.ID,
      toolCallID: string,
      before: number,
    ) {
      const row = yield* db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, sessionID),
            eq(
              EventTable.type,
              Event.versionedType(
                SessionEvent.Tool.Input.Started.type,
                SessionEvent.Tool.Input.Started.durable.version,
              ),
            ),
            eq(sql<string>`json_extract(${EventTable.data}, '$.assistantMessageID')`, assistantMessageID),
            eq(sql<string>`json_extract(${EventTable.data}, '$.id')`, toolCallID),
            lt(EventTable.seq, before),
          ),
        )
        .orderBy(desc(EventTable.seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      return row ? Schema.decodeUnknownSync(SessionEvent.Tool.Input.Started.data)(row.data) : undefined
    })

    const calledFor = Effect.fnUntraced(function* (
      sessionID: SessionSchema.ID,
      assistantMessageID: SessionMessage.ID,
      toolCallID: string,
      before = Number.MAX_SAFE_INTEGER,
    ) {
      const row = yield* db
        .select()
        .from(EventTable)
        .where(
          and(
            eq(EventTable.aggregate_id, sessionID),
            eq(
              EventTable.type,
              Event.versionedType(SessionEvent.Tool.Called.type, SessionEvent.Tool.Called.durable.version),
            ),
            eq(sql<string>`json_extract(${EventTable.data}, '$.assistantMessageID')`, assistantMessageID),
            eq(sql<string>`json_extract(${EventTable.data}, '$.id')`, toolCallID),
            lt(EventTable.seq, before),
          ),
        )
        .orderBy(desc(EventTable.seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (!row) return undefined
      const data = Schema.decodeUnknownSync(SessionEvent.Tool.Called.data)(row.data)
      return { ...row, data, name: (yield* toolInputFor(sessionID, assistantMessageID, toolCallID, row.seq))?.name }
    })

    const assertChildSource = Effect.fn("MetaAgentService.assertChildSource")(function* (
      parent: SessionSchema.Info,
      childID: SessionSchema.ID,
      executor: SessionSchema.ExecutorBinding | undefined,
      source: SessionSchema.ControllerSource,
      metadata?: SessionSchema.Metadata,
      bound = false,
    ) {
      const invalid = () =>
        new ControllerConflictError({
          sessionID: childID,
          field: "controller.source",
          kind: "meta_child_source_invalid",
          message: "Child source does not match its saved owner and binding",
        })
      const binding =
        parent.controller?.kind === "root" && executor
          ? new SessionSchema.ChildController({
              kind: "child",
              metaAgentID: parent.controller.metaAgentID,
              rootSessionID: parent.controller.rootSessionID,
              executor,
              source,
            })
          : undefined
      if (source.kind === "task") {
        const delegation = yield* db
          .select()
          .from(DelegationTable)
          .where(eq(DelegationTable.id, source.delegationID))
          .get()
          .pipe(Effect.orDie)
        const participant = yield* db
          .select()
          .from(DelegationParticipantTable)
          .where(
            and(
              eq(DelegationParticipantTable.id, source.participantID),
              eq(DelegationParticipantTable.delegation_id, source.delegationID),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (
          delegation?.parent_session_id !== parent.id ||
          participant?.provider !== "internal" ||
          (bound
            ? participant.child_session_id !== childID
            : participant.child_session_id !== null && participant.child_session_id !== childID)
        )
          return yield* invalid()
        if (!delegation.meta_agent_id) {
          if (executor || participant.executor) return yield* invalid()
          return undefined
        }
        if (
          !binding ||
          delegation.meta_agent_id !== binding.metaAgentID ||
          participant.target !== binding.executor.agent ||
          !participant.executor ||
          !sameExecutor(participant.executor, binding.executor)
        )
          return yield* invalid()
        return binding
      }
      if (source.kind === "subagent") {
        const called = yield* calledFor(parent.id, source.assistantMessageID, source.toolCallID)
        const started = called ? yield* startedFor(parent.id, source.assistantMessageID, called.seq) : undefined
        if (!started || called?.name !== "subagent" || typeof called.data.input.agent !== "string")
          return yield* invalid()
        if (started.data.agent !== "meta") {
          if (executor) return yield* invalid()
          return undefined
        }
        if (!binding) return yield* invalid()
        const target =
          parent.mode === "custom"
            ? (yield* compositions.selectAgent(parent.id, called.data.input.agent).pipe(Effect.mapError(invalid))).info
                .id
            : called.data.input.agent
        if (target !== binding.executor.agent) return yield* invalid()
        return binding
      }
      if (!binding) return yield* invalid()
      const run = yield* db
        .select()
        .from(WorkflowRunTable)
        .where(eq(WorkflowRunTable.id, source.runID))
        .get()
        .pipe(Effect.orDie)
      const step = yield* db
        .select()
        .from(WorkflowStepRunTable)
        .where(and(eq(WorkflowStepRunTable.id, source.stepRunID), eq(WorkflowStepRunTable.run_id, source.runID)))
        .get()
        .pipe(Effect.orDie)
      if (
        run?.session_id !== parent.id ||
        step?.child_session_id !== childID ||
        source.inputID !== workflowInputID(source.stepRunID) ||
        metadata?.workflowRootSessionID !== parent.id ||
        metadata.workflowRunID !== source.runID ||
        metadata.workflowStepRunID !== source.stepRunID ||
        metadata.workflowStepID !== step.step_id ||
        metadata.workflowInputID !== source.inputID
      )
        return yield* invalid()
      const admission = yield* WorkflowRun.decodeAdmission(run).pipe(Effect.mapError(invalid))
      if (parent.mode !== "custom" && (!admission.snapshot || !admission.taskBinding)) return yield* invalid()
      const selected = yield* compositions
        .selectAgent(parent.id, step.agent_id, admission.snapshot)
        .pipe(Effect.mapError(invalid))
      if (
        selected.info.id !== binding.executor.agent ||
        selected.snapshot.digest !== run.snapshot_digest ||
        selected.snapshot.data.workflow?.revision !== run.workflow_revision
      )
        return yield* invalid()
      return binding
    })

    const assertOwner = Effect.fn("MetaAgentService.assertOwner")(function* (session: SessionSchema.Info) {
      const controller = session.controller
      if (!controller) return
      const owner = yield* db
        .select()
        .from(MetaAgentSessionTable)
        .where(
          and(
            eq(MetaAgentSessionTable.meta_agent_id, controller.metaAgentID),
            eq(MetaAgentSessionTable.session_id, session.id),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      const root = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, controller.rootSessionID))
        .get()
        .pipe(Effect.orDie)
      const meta = yield* db
        .select()
        .from(MetaAgentTable)
        .where(eq(MetaAgentTable.id, controller.metaAgentID))
        .get()
        .pipe(Effect.orDie)
      if (
        !meta ||
        !owner ||
        owner.role !== (controller.kind === "root" ? "orchestrator" : "worker") ||
        root?.controller?.kind !== "root" ||
        root.controller.metaAgentID !== controller.metaAgentID ||
        root.controller.rootSessionID !== root.id ||
        (controller.kind === "root" && session.id !== controller.rootSessionID) ||
        (controller.kind === "child" && (session.parentID !== controller.rootSessionID || !bindingMatches(session)))
      )
        return yield* new ControllerConflictError({
          sessionID: session.id,
          field: "controller",
          kind: "meta_owner_invalid",
          message: "Meta ownership or first binding is missing or inconsistent",
        })
      if (controller.kind === "child" && root)
        yield* assertChildSource(
          fromRow(root),
          session.id,
          controller.executor,
          controller.source,
          session.metadata,
          true,
        )
    })

    const coordination = Effect.fn("MetaAgentService.coordination")(function* (
      sessionID: SessionSchema.ID,
      capture?: CoordinationCapture,
    ) {
      return yield* db
        .transaction(() =>
          Effect.gen(function* () {
            const row = yield* db
              .select()
              .from(SessionTable)
              .where(eq(SessionTable.id, sessionID))
              .get()
              .pipe(Effect.orDie)
            if (!row) return yield* new NotFoundError({ sessionID })
            const session = fromRow(row)
            const event = yield* db
              .select({ id: EventTable.id, seq: EventTable.seq })
              .from(EventTable)
              .where(
                and(
                  eq(EventTable.aggregate_id, sessionID),
                  inArray(
                    EventTable.type,
                    [SessionEvent.Created, SessionEvent.AgentSelected, SessionEvent.Forked].map((definition) =>
                      Event.versionedType(definition.type, definition.durable.version),
                    ),
                  ),
                ),
              )
              .orderBy(desc(EventTable.seq))
              .limit(1)
              .get()
              .pipe(Effect.orDie)
            const frozen =
              session.mode === "custom"
                ? yield* SessionComposition.selectSessionAgent(compositions, session).pipe(Effect.result)
                : undefined
            const selection: SessionIdentity.CoordinationSelection = {
              agent: session.agent,
              ...(event ? { event: { id: event.id, seq: Event.Seq.make(event.seq) } } : {}),
              ...(frozen && Result.isSuccess(frozen) ? { compositionDigest: frozen.success.snapshot.digest } : {}),
            }
            const unavailable = (
              code: SessionIdentity.ReasonCode,
              severity: SessionIdentity.ReasonSeverity = "info",
            ): SessionIdentity.Coordination => ({ available: false, reasons: [{ code, severity }], selection })
            if (frozen && Result.isFailure(frozen))
              return unavailable(SessionIdentity.ReasonCodes.coordinationSnapshotUnavailable, "warning")
            const agent = frozen && Result.isSuccess(frozen) ? frozen.success.info.id : session.agent
            if (agent !== "meta") return unavailable(SessionIdentity.ReasonCodes.metaNotSelected)
            if (capture?.agent !== undefined && capture.agent !== agent)
              return unavailable(SessionIdentity.ReasonCodes.metaExecutionMismatch)
            if (
              session.parentID !== undefined ||
              session.controller?.kind !== "root" ||
              session.controller.rootSessionID !== session.id
            )
              return unavailable(SessionIdentity.ReasonCodes.coordinationRootRequired)
            if (Result.isFailure(yield* assertOwner(session).pipe(Effect.result)))
              return unavailable(SessionIdentity.ReasonCodes.metaOwnerInvalid, "warning")
            if (session.mode === "custom" && !ProductModePolicy.isCustomModeEnabled())
              return unavailable(SessionIdentity.ReasonCodes.customModeDisabled, "warning")
            if (
              frozen &&
              Result.isSuccess(frozen) &&
              capture?.tool !== undefined &&
              !frozen.success.snapshot.data.tools.catalog.includes(capture.tool)
            )
              return unavailable(SessionIdentity.ReasonCodes.coordinationToolUnavailable)
            if (
              capture?.selection &&
              (capture.selection.agent !== selection.agent ||
                capture.selection.event?.id !== selection.event?.id ||
                capture.selection.event?.seq !== selection.event?.seq ||
                capture.selection.compositionDigest !== selection.compositionDigest)
            )
              return unavailable(SessionIdentity.ReasonCodes.coordinationAgentChanged)
            return { available: true, reasons: [], selection } satisfies SessionIdentity.Coordination
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const assertCoordination = Effect.fn("MetaAgentService.assertCoordination")(function* (
      sessionID: SessionSchema.ID,
      capture?: CoordinationCapture,
    ) {
      const capability = yield* coordination(sessionID, capture)
      if (!capability.available)
        return yield* new ControllerConflictError({
          sessionID,
          field: "coordination",
          kind: capability.reasons[0]?.code ?? "coordination-unavailable",
          message: "Active Meta coordination is unavailable for this Session and selection",
        })
      return capability
    })

    const assertCommunication = Effect.fn("MetaAgentService.assertCommunication")(function* (
      sessionID: SessionSchema.ID,
      route: { readonly sourceSessionID: SessionSchema.ID; readonly targetSessionID: SessionSchema.ID },
      capture?: CoordinationCapture,
    ) {
      const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ sessionID })
      const session = fromRow(row)
      const controller = session.controller
      if (controller?.kind !== "child") {
        const capability = yield* assertCoordination(sessionID, capture)
        return { rootSessionID: sessionID, selection: capability.selection }
      }
      yield* assertOwner(session)
      if (
        route.sourceSessionID !== session.id ||
        (capture?.agent !== undefined && capture.agent !== controller.executor.agent)
      )
        return yield* new ControllerConflictError({
          sessionID,
          field: "communication",
          kind: "child_communication_source_invalid",
          message: "A controlled child may send only its own content through its bound executor",
        })
      if (route.targetSessionID !== controller.rootSessionID) {
        const target = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, route.targetSessionID))
          .get()
          .pipe(Effect.orDie)
        if (
          target?.controller?.kind !== "child" ||
          target.controller.rootSessionID !== controller.rootSessionID ||
          target.controller.metaAgentID !== controller.metaAgentID
        )
          return yield* new ControllerConflictError({
            sessionID,
            field: "communication",
            kind: "child_communication_target_invalid",
            message:
              "A controlled child may communicate with its Meta parent or a child in the same saved Meta control tree",
          })
        yield* assertOwner(fromRow(target))
      }
      const capability = yield* assertCoordination(controller.rootSessionID, {
        selection: capture?.selection,
        tool: capture?.tool,
      })
      return { rootSessionID: controller.rootSessionID, selection: capability.selection }
    })

    const materialize = Effect.fn("MetaAgentService.materialize")(function* (event: SessionEvent.DurableEvent) {
      if (
        event.type !== SessionEvent.Step.Started.type &&
        event.type !== SessionEvent.Step.Ended.type &&
        event.type !== SessionEvent.Step.Failed.type &&
        event.type !== SessionEvent.Attempt.Started.type &&
        event.type !== SessionEvent.Attempt.Ended.type &&
        event.type !== SessionEvent.Tool.Called.type &&
        event.type !== SessionEvent.Tool.Success.type &&
        event.type !== SessionEvent.Tool.Failed.type &&
        event.type !== SessionEvent.RetryScheduled.type &&
        event.type !== SessionEvent.InboxDelivered.type
      )
        return
      const row = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, event.data.sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!row?.controller) return
      const session = fromRow(row)
      const controller = session.controller!
      const modelStarted =
        event.type === SessionEvent.Step.Started.type || event.type === SessionEvent.Attempt.Started.type
      if (modelStarted && controller.kind === "root" && event.data.agent !== "meta") return
      const notification = yield* Effect.gen(function* () {
        if (event.type !== SessionEvent.InboxDelivered.type) return
        const saved = yield* db
          .select()
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.id, event.data.inboxID), eq(SessionMessageTable.session_id, row.id)))
          .get()
          .pipe(Effect.orDie)
        if (!saved) return
        const message = Schema.decodeUnknownOption(SessionMessage.Synthetic)({
          ...saved.data,
          id: saved.id,
          type: saved.type,
        })
        if (Option.isNone(message) || message.value.metadata?.source !== "task") return
        const receipt = Schema.decodeUnknownOption(DelegationReceipt.Outcome)(message.value.metadata.externalReceipt)
        if (Option.isNone(receipt) || receipt.value.source.type !== "tool") return
        return { message: message.value, receipt: receipt.value, source: receipt.value.source }
      })
      if (event.type === SessionEvent.InboxDelivered.type && !notification) return
      const assistantMessageID =
        notification?.source.messageID ??
        (event.type === SessionEvent.InboxDelivered.type ? undefined : event.data.assistantMessageID)
      if (!assistantMessageID) return
      const previous = yield* db
        .select()
        .from(MetaAgentStepTable)
        .where(
          and(eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID), eq(MetaAgentStepTable.event_id, event.id)),
        )
        .get()
        .pipe(Effect.orDie)
      if (previous) return
      const started = modelStarted || event.type === SessionEvent.Tool.Called.type
      const toolCallID = notification?.source.id ?? ("id" in event.data ? event.data.id : undefined)
      const origin = modelStarted
        ? undefined
        : toolCallID && event.type !== SessionEvent.Tool.Called.type
          ? yield* calledFor(row.id, assistantMessageID, toolCallID, event.durable.seq)
          : yield* startedFor(
              row.id,
              assistantMessageID,
              event.durable.seq,
              event.type === SessionEvent.Attempt.Ended.type ? event.data.ordinal : undefined,
            )
      if (!modelStarted && !origin) return
      if (controller.kind === "root" && origin && "agent" in origin.data && origin.data.agent !== "meta") return
      const witness = origin
        ? yield* db
            .select()
            .from(MetaAgentStepTable)
            .where(
              and(
                eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID),
                eq(MetaAgentStepTable.meta_agent_session_id, row.id),
                eq(MetaAgentStepTable.assistant_message_id, assistantMessageID),
                eq(MetaAgentStepTable.event_id, origin.id),
              ),
            )
            .get()
            .pipe(Effect.orDie)
        : undefined
      // Every continuation belongs to its durable Started or Called occurrence.
      if (!modelStarted && !witness) return
      yield* assertOwner(session).pipe(Effect.orDie)
      const toolName =
        event.type === SessionEvent.Tool.Called.type && toolCallID
          ? (yield* toolInputFor(row.id, assistantMessageID, toolCallID, event.durable.seq))?.name
          : origin && "name" in origin
            ? origin.name
            : undefined
      const receipt =
        event.type === SessionEvent.Tool.Success.type && toolName === "task"
          ? Schema.decodeUnknownOption(Delegation.Receipt)(event.data.metadata?.receipt)
          : Option.none()
      const verifiedReceipt = yield* Effect.gen(function* () {
        if (Option.isNone(receipt)) return undefined
        const value = receipt.value
        if (value.inputID !== DelegationFold.inputID(value.delegationID, value)) return undefined
        const childRow = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, value.childSessionID))
          .get()
          .pipe(Effect.orDie)
        if (
          !childRow?.controller ||
          childRow.controller.kind !== "child" ||
          childRow.controller.metaAgentID !== controller.metaAgentID ||
          childRow.parent_id !== row.id ||
          childRow.controller.source.kind !== "task" ||
          childRow.controller.source.delegationID !== value.delegationID ||
          childRow.controller.source.participantID !== value.participantID
        )
          return undefined
        yield* assertOwner(fromRow(childRow)).pipe(Effect.orDie)
        const state = DelegationFold.foldDelegation(yield* DelegationProjector.readEvents(db, value.delegationID))
        const delivery = state?.deliveries.get(
          DelegationFold.deliveryKey(
            value.turnID,
            value.participantID,
            value.deliveryOrigin,
            value.senderParticipantID,
          ),
        )
        if (!delivery || delivery.attempt !== value.attempt || state?.delegation.parentSessionID !== row.id)
          return undefined
        const pending = yield* SessionInbox.find(db, value.inputID)
        const inputRow = yield* db
          .select()
          .from(SessionMessageTable)
          .where(
            and(eq(SessionMessageTable.id, value.inputID), eq(SessionMessageTable.session_id, value.childSessionID)),
          )
          .get()
          .pipe(Effect.orDie)
        const projected = inputRow
          ? Schema.decodeUnknownOption(SessionMessage.User)({ ...inputRow.data, id: inputRow.id, type: inputRow.type })
          : Option.none()
        const metadata =
          pending?.type === "user" && pending.sessionID === value.childSessionID
            ? pending.payload.metadata
            : Option.isSome(projected)
              ? projected.value.metadata
              : undefined
        const reference = metadata?.delegation
        const link = Schema.decodeUnknownOption(Schema.Struct({ source: Permission.Source }))(metadata?.task)
        if (
          !Schema.is(
            Schema.Struct({
              delegationID: Schema.String,
              turnID: Schema.String,
              participantID: Schema.String,
              deliveryOrigin: Schema.String,
              senderParticipantID: Schema.String,
              attempt: Schema.Int,
            }),
          )(reference) ||
          reference.delegationID !== value.delegationID ||
          reference.turnID !== value.turnID ||
          reference.participantID !== value.participantID ||
          reference.deliveryOrigin !== value.deliveryOrigin ||
          reference.senderParticipantID !== value.senderParticipantID ||
          reference.attempt !== value.attempt ||
          Option.isNone(link) ||
          link.value.source.type !== "tool" ||
          link.value.source.messageID !== assistantMessageID ||
          link.value.source.id !== toolCallID
        )
          return undefined
        return { ...value, source: link.value.source, executor: childRow.controller.executor }
      })
      const resultMetadata =
        event.type === SessionEvent.Tool.Success.type ? event.data.metadata : notification?.message.metadata
      const verifiedExternalReceipt = yield* Effect.gen(function* () {
        if (
          (event.type !== SessionEvent.Tool.Success.type && !notification) ||
          toolName !== "task" ||
          resultMetadata?.receipt !== undefined
        )
          return undefined
        const receipt = Schema.decodeUnknownOption(DelegationReceipt.Outcome)(resultMetadata?.externalReceipt)
        if (Option.isNone(receipt)) return undefined
        const value = receipt.value
        if (
          value.source.type !== "tool" ||
          value.parentSessionID !== row.id ||
          value.source.messageID !== assistantMessageID ||
          value.source.id !== toolCallID
        )
          return undefined
        const saved = yield* db
          .select({ value: KVTable.value })
          .from(KVTable)
          .where(eq(KVTable.key, DelegationReceipt.key(value)))
          .get()
          .pipe(Effect.orDie)
        const binding = Schema.decodeUnknownOption(DelegationReceipt.Binding)(saved?.value)
        if (Option.isNone(binding) || !DelegationReceipt.matches(binding.value, value)) return undefined
        const state = DelegationFold.foldDelegation(yield* DelegationProjector.readEvents(db, value.delegationID))
        const participant = state?.participants.get(value.participantID)
        const delivery = state?.deliveries.get(
          DelegationFold.deliveryKey(
            value.turnID,
            value.participantID,
            value.deliveryOrigin,
            value.senderParticipantID,
          ),
        )
        if (
          state?.delegation.parentSessionID !== row.id ||
          state.delegation.metaAgentID !== controller.metaAgentID ||
          (value instanceof DelegationReceipt.Jsonl
            ? participant?.provider !== value.target ||
              participant.target !== value.target ||
              participant.externalThreadID !== value.jsonlMessage.sessionID
            : value instanceof DelegationReceipt.Sdk
              ? participant?.provider !== "claude-code" ||
                participant.target !== "claude-code" ||
                participant.externalThreadID !== value.sdkMessage.sessionID
              : value instanceof DelegationReceipt.Acp
                ? participant?.provider !== value.target ||
                  participant.target !== value.target ||
                  participant.externalThreadID !== value.acpPrompt.sessionID
                : value instanceof DelegationReceipt.Pending &&
                    binding.value.target === "claude-code" &&
                    binding.value.transport === "sdk"
                  ? participant?.provider !== "claude-code" || participant.target !== "claude-code"
                  : participant?.provider !== "codex" || participant.externalThreadID !== value.externalThreadID) ||
          delivery?.attempt !== value.attempt ||
          !["completed", "failed", "cancelled", "recovery_required"].includes(delivery.status)
        )
          return undefined
        if (
          value instanceof DelegationReceipt.Pending &&
          (!notification ||
            (value.execution !== "admitted" && state.turns.get(value.turnID)?.delivery !== "queue") ||
            delivery.status === "completed")
        )
          return undefined
        if (
          delivery.status === "completed" &&
          !(
            value instanceof DelegationReceipt.Sdk ||
            value instanceof DelegationReceipt.Acp ||
            value instanceof DelegationReceipt.Jsonl
          ) &&
          delivery.externalTurnID !== value.externalTurnID
        )
          return undefined
        if (value instanceof DelegationReceipt.Acp || value instanceof DelegationReceipt.Jsonl) {
          if (event.type !== SessionEvent.Tool.Success.type || notification || delivery.status !== "completed")
            return undefined
          const output = DelegationReceipt.decodeOutput(
            event.data.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
          )
          const task = yield* db
            .select()
            .from(TaskTable)
            .where(and(eq(TaskTable.id, binding.value.parentTaskID), eq(TaskTable.session_id, row.id)))
            .get()
            .pipe(Effect.orDie)
          if (
            Option.isNone(output) ||
            output.value.status !== "completed" ||
            !DelegationReceipt.matchesOutput(binding.value, output.value) ||
            binding.value.settlement?.status !== "completed" ||
            binding.value.settlement.text !== output.value.output ||
            !task ||
            task.status !== "completed" ||
            task.revision !== binding.value.parentTaskRevision + 1 ||
            task.output_digest !== DelegationReceipt.outputDigest(output.value.output)
          )
            return undefined
        }
        if (notification) {
          if (
            binding.value.background !== true ||
            notification.message.id !==
              DelegationReceipt.notificationID(
                DelegationFold.inputID(value.delegationID, value),
                binding.value.parentTaskID,
              ) ||
            resultMetadata?.status !== delivery.status
          )
            return undefined
          const sourceRow = yield* db
            .select()
            .from(SessionMessageTable)
            .where(and(eq(SessionMessageTable.id, value.source.messageID), eq(SessionMessageTable.session_id, row.id)))
            .get()
            .pipe(Effect.orDie)
          const source = sourceRow
            ? Schema.decodeUnknownOption(SessionMessage.Assistant)({
                ...sourceRow.data,
                id: sourceRow.id,
                type: sourceRow.type,
              })
            : Option.none()
          if (Option.isNone(source) || source.value.agent !== binding.value.agent) return undefined
          const call = source.value.content.find(
            (part) => part.type === "tool" && part.id === value.source.id && part.name === "task",
          )
          if (call?.type !== "tool" || call.state.status !== "completed") return undefined
          const ack = DelegationReceipt.decodeOutput(
            call.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
          )
          if (Option.isNone(ack) || !DelegationReceipt.isBackgroundAck(binding.value, call, ack.value)) return undefined
          const output = DelegationReceipt.decodeOutput(notification.message.text)
          if (
            Option.isNone(output) ||
            output.value.status !== delivery.status ||
            !DelegationReceipt.matchesOutput(binding.value, output.value)
          )
            return undefined
          const task = yield* db
            .select()
            .from(TaskTable)
            .where(and(eq(TaskTable.id, binding.value.parentTaskID), eq(TaskTable.session_id, row.id)))
            .get()
            .pipe(Effect.orDie)
          if (
            !task ||
            task.revision !== binding.value.parentTaskRevision + 1 ||
            task.status !==
              (delivery.status === "completed"
                ? "completed"
                : delivery.status === "cancelled"
                  ? "cancelled"
                  : "failed") ||
            (delivery.status === "completed" &&
              task.output_digest !== DelegationReceipt.outputDigest(output.value.output))
          )
            return undefined
        }
        return value
      })
      if (notification && !verifiedExternalReceipt) return
      const max = yield* db
        .select({ value: sql<number>`COALESCE(MAX(${MetaAgentStepTable.seq}), 0)` })
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_id, controller.metaAgentID),
            eq(MetaAgentStepTable.meta_agent_session_id, row.id),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      yield* db
        .insert(MetaAgentStepTable)
        .values({
          id: `stp_${event.id}`,
          meta_agent_session_id: row.id,
          meta_agent_id: controller.metaAgentID,
          root_session_id: controller.rootSessionID,
          event_id: event.id,
          event_seq: event.durable.seq,
          event_type: event.type,
          assistant_message_id: assistantMessageID,
          tool_call_id: toolCallID,
          seq: (max?.value ?? 0) + 1,
          type:
            verifiedReceipt || verifiedExternalReceipt
              ? "receipt"
              : event.type === SessionEvent.RetryScheduled.type
                ? "retry"
                : toolCallID
                  ? "tool"
                  : "model",
          engine:
            toolName ??
            witness?.engine ??
            (modelStarted ? `${event.data.model.providerID}/${event.data.model.id}` : "unknown"),
          status:
            event.type === SessionEvent.Step.Failed.type ||
            (event.type === SessionEvent.Attempt.Ended.type && event.data.terminal.status !== "completed") ||
            event.type === SessionEvent.Tool.Failed.type ||
            (notification !== undefined && resultMetadata?.status !== "completed")
              ? "failed"
              : started
                ? "running"
                : "completed",
          provenance: {
            controller: Schema.encodeSync(SessionSchema.Controller)(controller),
            data: event.data,
            ...(verifiedReceipt ? { receipt: verifiedReceipt } : {}),
            ...(verifiedExternalReceipt ? { externalReceipt: verifiedExternalReceipt } : {}),
          },
          time_created: event.created,
          time_updated: event.created,
        })
        .onConflictDoNothing({ target: [MetaAgentStepTable.meta_agent_id, MetaAgentStepTable.event_id] })
        .pipe(Effect.orDie)
    })

    const create = Effect.fn("MetaAgentService.create")(function* (input: CreateInput) {
      const id = input.id ?? MetaAgent.ID.descending()
      const now = input.created === undefined ? yield* DateTime.now : DateTime.makeUnsafe(input.created)
      const info = MetaAgent.Info.make({
        id,
        title: input.title,
        agent: Agent.ID.make(input.agent),
        model: Schema.decodeUnknownSync(Model.Selection)(input.model),
        groupBehavior:
          input.groupBehavior === undefined
            ? undefined
            : Schema.decodeUnknownSync(ModelGroup.BehaviorSnapshot)(input.groupBehavior),
        time: { created: now, updated: now },
      })
      yield* db
        .insert(MetaAgentTable)
        .values({
          id,
          title: input.title,
          agent: input.agent,
          model: Schema.encodeSync(Model.Selection)(info.model),
          group_behavior:
            info.groupBehavior === undefined
              ? null
              : Schema.encodeSync(ModelGroup.BehaviorSnapshot)(info.groupBehavior),
          time_created: DateTime.toEpochMillis(now),
          time_updated: DateTime.toEpochMillis(now),
        })
        .pipe(Effect.orDie)
      return info
    })

    const setModel = Effect.fn("MetaAgentService.setModel")(function* (input: {
      readonly id: MetaAgent.ID
      readonly model: Model.Selection
      readonly groupBehavior?: ModelGroup.BehaviorSnapshot
      readonly updated?: number
    }) {
      const updated = input.updated ?? (yield* DateTime.nowAsDate).getTime()
      yield* db
        .update(MetaAgentTable)
        .set({
          model: Schema.encodeSync(Model.Selection)(input.model),
          group_behavior:
            input.groupBehavior === undefined
              ? null
              : Schema.encodeSync(ModelGroup.BehaviorSnapshot)(input.groupBehavior),
          time_updated: updated,
        })
        .where(eq(MetaAgentTable.id, input.id))
        .pipe(Effect.orDie)
    })

    const get = Effect.fn("MetaAgentService.get")(function* (id: MetaAgent.ID) {
      const row = yield* db.select().from(MetaAgentTable).where(eq(MetaAgentTable.id, id)).get().pipe(Effect.orDie)
      return row ? rowToInfo(row) : undefined
    })

    const list = Effect.fn("MetaAgentService.list")(function* () {
      const rows = yield* db.select().from(MetaAgentTable).orderBy(MetaAgentTable.time_created).all().pipe(Effect.orDie)
      return rows.map(rowToInfo)
    })

    const sessions = Effect.fn("MetaAgentService.sessions")(function* (metaID: MetaAgent.ID) {
      const rows = yield* db
        .select()
        .from(MetaAgentSessionTable)
        .where(eq(MetaAgentSessionTable.meta_agent_id, metaID))
        .all()
        .pipe(Effect.orDie)
      return rows.map(
        (r) =>
          new MetaAgent.AttachedSession({
            sessionID: SessionSchema.ID.make(r.session_id),
            role: r.role,
            effort: r.effort ?? undefined,
            tokensUsed: r.tokens_used ?? undefined,
            resultSummary: r.result_summary ?? undefined,
          }),
      )
    })

    const stats = Effect.fn("MetaAgentService.stats")(function* (metaID: MetaAgent.ID) {
      const sessionRows = yield* db
        .select()
        .from(MetaAgentSessionTable)
        .where(eq(MetaAgentSessionTable.meta_agent_id, metaID))
        .all()
        .pipe(Effect.orDie)
      const sessionIDs = sessionRows.map((r) => r.session_id)
      const logicalSteps = yield* db
        .select({ sessionID: MetaAgentStepTable.meta_agent_session_id })
        .from(MetaAgentStepTable)
        .where(
          and(
            eq(MetaAgentStepTable.meta_agent_id, metaID),
            inArray(MetaAgentStepTable.event_type, [SessionEvent.Step.Started.type, SessionEvent.Tool.Called.type]),
          ),
        )
        .groupBy(
          MetaAgentStepTable.meta_agent_id,
          MetaAgentStepTable.meta_agent_session_id,
          MetaAgentStepTable.root_session_id,
          MetaAgentStepTable.assistant_message_id,
          MetaAgentStepTable.tool_call_id,
          MetaAgentStepTable.event_type,
        )
        .all()
        .pipe(Effect.orDie)
      return new MetaAgent.Stats({
        totalSessions: sessionRows.length,
        totalTokens: sessionRows.every((row) => row.tokens_used !== null)
          ? sessionRows.reduce((sum, row) => sum + (row.tokens_used ?? 0), 0)
          : undefined,
        recordedTokens: sessionRows.reduce((sum, row) => sum + (row.tokens_used ?? 0), 0),
        unknownTokenSessionCount: sessionRows.filter((row) => row.tokens_used === null).length,
        stepCount: logicalSteps.length,
        recordedOnly: true as const,
        physicalAttemptCoverage: "unknown" as const,
        unknownStepCount:
          sessionIDs.length === 0
            ? 0
            : ((yield* db
                .select({ count: sql<number>`COUNT(*)` })
                .from(MetaAgentStepTable)
                .where(
                  and(
                    inArray(MetaAgentStepTable.meta_agent_session_id, sessionIDs),
                    sql`${MetaAgentStepTable.meta_agent_id} IS NULL`,
                  ),
                )
                .get()
                .pipe(Effect.orDie))?.count ?? 0),
      })
    })

    const attach = Effect.fn("MetaAgentService.attach")(function* (input: {
      metaID: MetaAgent.ID
      sessionID: SessionSchema.ID
      role?: "orchestrator" | "worker" | "tool"
      effort?: string
      created?: number
    }) {
      const now = input.created === undefined ? yield* DateTime.now : DateTime.makeUnsafe(input.created)
      yield* db
        .insert(MetaAgentSessionTable)
        .values({
          meta_agent_id: input.metaID,
          session_id: input.sessionID,
          role: input.role ?? "worker",
          effort: input.effort ?? null,
          time_created: DateTime.toEpochMillis(now),
          time_updated: DateTime.toEpochMillis(now),
        })
        .pipe(Effect.orDie)
    })

    const detach = Effect.fn("MetaAgentService.detach")(function* (input: {
      metaID: MetaAgent.ID
      sessionID: SessionSchema.ID
    }) {
      yield* db
        .delete(MetaAgentSessionTable)
        .where(
          and(
            eq(MetaAgentSessionTable.meta_agent_id, input.metaID),
            eq(MetaAgentSessionTable.session_id, input.sessionID),
          ),
        )
        .pipe(Effect.orDie)
    })

    const remove = Effect.fn("MetaAgentService.remove")(function* (id: MetaAgent.ID) {
      yield* db.delete(MetaAgentTable).where(eq(MetaAgentTable.id, id)).pipe(Effect.orDie)
    })

    const findBySession = Effect.fn("MetaAgentService.findBySession")(function* (sessionID: SessionSchema.ID) {
      const row = yield* db
        .select()
        .from(MetaAgentSessionTable)
        .where(eq(MetaAgentSessionTable.session_id, sessionID))
        .get()
        .pipe(Effect.orDie)
      return row
        ? {
            metaID: MetaAgent.ID.make(row.meta_agent_id),
            sessionID: SessionSchema.ID.make(row.session_id),
            role: row.role,
          }
        : undefined
    })

    const writeStep = Effect.fn("MetaAgentService.writeStep")(function* (input: {
      metaAgentSessionID: string
      seq: number
      type: "subagent" | "external-cli" | "tool"
      engine: string
      prompt?: string
    }) {
      // Derive the step counter from the table's MAX(seq)+1 instead of a module
      // counter, so IDs stay stable across process restarts and repeated test runs.
      const maxRow = yield* db
        .select({ max: sql<number>`COALESCE(MAX(${MetaAgentStepTable.seq}), 0)` })
        .from(MetaAgentStepTable)
        .get()
        .pipe(Effect.orDie)
      const counter = (maxRow?.max ?? 0) + 1
      const id = `stp_${counter.toString(36)}_${Date.now().toString(36)}`
      const now = yield* DateTime.now
      yield* db
        .insert(MetaAgentStepTable)
        .values({
          id,
          meta_agent_session_id: input.metaAgentSessionID,
          seq: input.seq,
          type: input.type,
          engine: input.engine,
          status: "running",
          prompt: input.prompt ?? null,
          time_created: DateTime.toEpochMillis(now),
          time_updated: DateTime.toEpochMillis(now),
        })
        .pipe(Effect.orDie)
      return id
    })

    const updateStep = Effect.fn("MetaAgentService.updateStep")(function* (input: {
      stepID: string
      status: "completed" | "failed"
      result?: string
      error?: string
    }) {
      const now = yield* DateTime.now
      yield* db
        .update(MetaAgentStepTable)
        .set({
          status: input.status,
          result: input.result ?? null,
          error: input.error ?? null,
          time_updated: DateTime.toEpochMillis(now),
        })
        .where(eq(MetaAgentStepTable.id, input.stepID))
        .pipe(Effect.orDie)
    })

    return Service.of({
      assertChildSource,
      assertOwner,
      coordination,
      assertCoordination,
      assertCommunication,
      materialize,
      create,
      setModel,
      get,
      list,
      sessions,
      stats,
      attach,
      detach,
      remove,
      findBySession,
      writeStep,
      updateStep,
    })
  }),
)

const defaultDatabase = Database.layer()
export const defaultLayer = layer.pipe(Layer.provide(SessionComposition.layer), Layer.provide(defaultDatabase))
export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, SessionComposition.node] })
