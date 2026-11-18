export * as SessionTask from "./session-task.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Composition } from "./composition.js"
import { Event } from "./event.js"
import { Location } from "./location.js"
import { MetaAgent } from "./meta-agent.js"
import { Model } from "./model.js"
import { ProductMode } from "./product-mode.js"
import { PromptInput } from "./prompt-input.js"
import { optional, PositiveInt } from "./schema.js"
import { SessionConsultation } from "./session-consultation.js"
import { SessionID } from "./session-id.js"
import { SessionInbox } from "./session-inbox.js"
import { SessionFork } from "./session-fork.js"
import { SessionMessage } from "./session-message.js"
import { OperationID, OperationReadonlyRef } from "./session-task-operation-id.js"
import { SessionGoalID } from "./session-goal-id.js"

export { OperationID, OperationReadonlyRef, TaskCoordination } from "./session-task-operation-id.js"

/**
 * Task/Todo unified contract. Phase strategy (see docs/plan/todo-task-system-upgrade.md §5.2):
 * - M0: id/content/status/priority/parentID/sessionID
 * - M1.5: outputDigest (Work ProgressLedger alignment)
 * - M3: agentID/scheduledAt/recurrence (+ derived nextRun)
 * - M5: spawnedFrom/dependsOn
 * Derived values (never stored): currentStepIndex = first non-completed step;
 * canResume = exists a failed|in_progress step.
 */
export const TaskStatus = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "scheduled",
  "failed",
]).annotate({ identifier: "TaskStatus" })
export type TaskStatus = typeof TaskStatus.Type

export const TaskPriority = Schema.Literals(["high", "medium", "low"]).annotate({
  identifier: "TaskPriority",
})
export type TaskPriority = typeof TaskPriority.Type

// Value record persisted as a JSON column and exchanged as a plain object over
// HTTP, so a Struct (not a Class) keeps encode/decode working without instance
// wrapping.
export const TaskRecurrence = Schema.Struct({
  cron: Schema.String,
  timezone: optional(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "TaskRecurrence" })
export type TaskRecurrence = typeof TaskRecurrence.Type

export class Info extends Schema.Class<Info>("SessionTask.Info")({
  id: Schema.String.annotate({ description: "Stable task ID (tsk_ prefixed, time-ordered)" }),
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: TaskStatus,
  priority: TaskPriority,
  sessionID: Schema.String.annotate({ description: "Owning session scope" }),
  parentID: optional(Schema.String).annotate({
    description: "Parent task ID for subtask support",
  }),
  // ── M2: TaskPanel reload-recovery persistence (folded from M1.5) ──
  outputDigest: optional(Schema.String).annotate({
    description: "Incremental step output digest (Work ProgressLedger)",
  }),
  // ── M3: scheduled jobs ──
  agentID: optional(Schema.String).annotate({ description: "Owning agent" }),
  scheduledAt: optional(Schema.Number).annotate({
    description: "Scheduled trigger timestamp (ms)",
  }),
  recurrence: optional(TaskRecurrence),
  nextRun: optional(Schema.Number).annotate({
    description:
      "Next trigger timestamp (ms) from the linked pending Schedule rule, including a terminal Task anchor; unlinked scheduled/pending tasks retain their derived trigger",
  }),
  // ── M5: spawning & DAG ──
  spawnedFrom: optional(Schema.String).annotate({
    description: "Message ID this task was spawned from",
  }),
  dependsOn: optional(Schema.Array(Schema.String)).annotate({
    description: "Predecessor task IDs (DAG dependencies)",
  }),
  operationRef: optional(OperationReadonlyRef),
  // P3-a: optimistic-concurrency revision. Server-managed (never client-supplied):
  // new tasks start at 1, every write increments, expectedRevision rejects stale writes.
  revision: Schema.Number.annotate({
    description: "Server-managed revision (increments on every write; expectedRevision rejects stale writes)",
  }),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export const OperationDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)).pipe(
  Schema.brand("SessionTask.OperationDigest"),
  Schema.annotate({ identifier: "SessionTask.OperationDigest" }),
)
export type OperationDigest = typeof OperationDigest.Type

export class OperationToolSource extends Schema.Class<OperationToolSource>("SessionTask.OperationToolSource")({
  type: Schema.Literal("model_tool"),
  sessionID: SessionID,
  agent: Agent.ID,
  messageID: SessionMessage.ID,
  id: Schema.String,
}) {}

export class OperationUserSource extends Schema.Class<OperationUserSource>("SessionTask.OperationUserSource")({
  type: Schema.Literal("user_coordination"),
  sessionID: SessionID,
  agent: Agent.ID,
}) {}

export class OperationGoalSource extends Schema.Class<OperationGoalSource>("SessionTask.OperationGoalSource")({
  type: Schema.Literal("goal_round"),
  sessionID: SessionID,
  agent: Agent.ID,
  goalID: Schema.String,
  roundID: Schema.String,
  revision: PositiveInt,
}) {}

export class OperationScheduleSource extends Schema.Class<OperationScheduleSource>(
  "SessionTask.OperationScheduleSource",
)({
  type: Schema.Literal("schedule_occurrence"),
  sessionID: SessionID,
  agent: Agent.ID,
  scheduleID: Schema.String,
  occurrenceID: Schema.String,
  revision: PositiveInt,
}) {}

export const OperationSource = Schema.Union([
  OperationToolSource,
  OperationUserSource,
  OperationGoalSource,
  OperationScheduleSource,
]).annotate({ identifier: "SessionTask.OperationSource" })
export type OperationSource = typeof OperationSource.Type

export class OperationSelection extends Schema.Class<OperationSelection>("SessionTask.OperationSelection")({
  agent: Agent.ID,
  eventID: optional(Event.ID),
  seq: Event.Seq,
  compositionDigest: optional(Composition.Digest),
}) {}

export class OperationNewRootTarget extends Schema.Class<OperationNewRootTarget>("SessionTask.OperationNewRootTarget")({
  type: Schema.Literal("new_root"),
  mode: ProductMode.ID,
  location: optional(Location.Ref),
  agent: optional(Agent.ID),
  model: optional(Model.Selection),
  executorPreference: optional(MetaAgent.ExecutorPreference),
  composition: optional(Composition.CompositionInput),
  expectedPlanDigest: optional(Composition.Digest),
  title: optional(Schema.String),
}) {}

export class OperationExistingRootTarget extends Schema.Class<OperationExistingRootTarget>(
  "SessionTask.OperationExistingRootTarget",
)({
  type: Schema.Literal("existing_root"),
  sessionID: SessionID,
}) {}

export const OperationTarget = Schema.Union([OperationNewRootTarget, OperationExistingRootTarget]).annotate({
  identifier: "SessionTask.OperationTarget",
})
export type OperationTarget = typeof OperationTarget.Type

export class OperationReference extends Schema.Class<OperationReference>("SessionTask.OperationReference")({
  sourceSessionID: SessionID,
  boundary: SessionFork.Boundary,
}) {}

/** Canonical request identity excludes service-owned provenance and later Task binding. */
export class OperationRequest extends Schema.Class<OperationRequest>("SessionTask.OperationRequest")({
  operationID: OperationID,
  inputID: SessionMessage.ID,
  replacesOperationID: optional(OperationID).annotate({
    description: "Operation from the same source Session to supersede if it is still unfinished.",
  }),
  taskID: optional(Schema.String),
  expectedRevision: optional(PositiveInt),
  target: OperationTarget,
  description: optional(Schema.String),
  prompt: Schema.String,
  files: PromptInput.Prompt.fields.files,
  reference: optional(OperationReference),
  delivery: SessionInbox.Delivery,
  resume: Schema.Boolean,
  background: optional(Schema.Boolean),
}) {}

export class OperationPrepared extends Schema.Class<OperationPrepared>("SessionTask.OperationPrepared")({
  payload: SessionInbox.UserPayload,
  delivery: SessionInbox.Delivery,
  digest: OperationDigest,
  reference: optional(SessionConsultation.Reference),
}) {}

export class OperationResultRef extends Schema.Class<OperationResultRef>("SessionTask.OperationResultRef")({
  sessionID: SessionID,
  inputID: SessionMessage.ID,
  messageIDs: optional(Schema.Array(SessionMessage.ID)),
  sharedInputs: optional(Schema.Array(SessionMessage.ID)),
  resultEventID: optional(Event.ID),
  text: optional(Schema.String),
  digest: optional(OperationDigest),
}) {}

/** Read-model evidence derived only from the target's committed Inbox event. */
export class OperationAdmission extends Schema.Class<OperationAdmission>("SessionTask.OperationAdmission")({
  eventID: Event.ID,
  seq: Event.Seq,
}) {}

/** A source model request containing the complete result, anchored to its original Step.Started event. */
export class OperationConsumer extends Schema.Class<OperationConsumer>("SessionTask.OperationConsumer")({
  consumerSessionID: SessionID,
  assistantMessageID: SessionMessage.ID,
  eventID: Event.ID,
  resultDigest: OperationDigest,
}) {}

export class OperationError extends Schema.Class<OperationError>("SessionTask.OperationError")({
  code: Schema.String.annotate({ description: "Stable producer-owned error or blocking reason code." }),
  message: Schema.String,
}) {}

export const OperationPhase = Schema.Literals([
  "waiting",
  "reserved",
  "permission_pending",
  "prepared",
  "created",
  "admitted",
  "running",
  "settled",
  "blocked",
  "failed",
  "cancelled",
  "recovery_required",
  "superseded",
]).annotate({ identifier: "SessionTask.OperationPhase" })
export type OperationPhase = typeof OperationPhase.Type

export class OperationInfo extends Schema.Class<OperationInfo>("SessionTask.OperationInfo")({
  sourceSessionID: SessionID,
  sourceLocation: Location.Ref,
  sourceMode: ProductMode.ID,
  operationID: OperationID,
  taskID: optional(Schema.String),
  taskRevision: optional(PositiveInt),
  inputID: SessionMessage.ID,
  targetSessionID: optional(SessionID),
  requestDigest: OperationDigest,
  request: OperationRequest,
  source: OperationSource,
  selection: OperationSelection,
  reservationSeq: optional(Event.Seq),
  goalRounds: optional(Schema.Array(SessionGoalID.RoundRef)),
  phase: OperationPhase,
  cancelIntent: Schema.Boolean,
  predecessorID: optional(OperationID),
  prepared: optional(OperationPrepared),
  admission: optional(OperationAdmission),
  result: optional(OperationResultRef),
  consumers: optional(Schema.Array(OperationConsumer)),
  sourceSettlement: optional(Schema.Literals(["pending", "settled", "conflict"])),
  error: optional(OperationError),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

/** A change cannot replace the immutable request, source, selection, or input identity. */
export class OperationChange extends Schema.Class<OperationChange>("SessionTask.OperationChange")({
  phase: optional(OperationPhase),
  taskID: optional(Schema.String),
  taskRevision: optional(PositiveInt),
  targetSessionID: optional(SessionID),
  prepared: optional(OperationPrepared),
  result: optional(OperationResultRef),
  consumers: optional(Schema.Array(OperationConsumer)),
  error: optional(Schema.NullOr(OperationError)),
  cancelIntent: optional(Schema.Boolean),
}) {}
