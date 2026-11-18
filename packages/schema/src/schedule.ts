export * as Schedule from "./schedule.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Delegation } from "./delegation.js"
import { Event } from "./event.js"
import { descending } from "./identifier.js"
import { NonNegativeInt, optional, PositiveInt, statics } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"
import { SessionTask } from "./session-task.js"

/**
 * Assistant personal schedule contract (PRD §7.1/§7.2, Assistant M0).
 * One `Schedule` row is one user-confirmed personal item (M1: `reminder`)
 * with an absolute due time; a `Delivery` row is one idempotent inbox
 * delivery keyed by the schedule's stable `deliveryKey`.
 */

export const ID = Schema.String.check(Schema.isStartingWith("sch")).pipe(
  Schema.brand("ScheduleID"),
  Schema.annotate({ identifier: "Schedule.ID" }),
  statics((schema) => ({
    create: () => schema.make("sch_" + descending()),
    descending: (id?: string) => (id === undefined ? schema.make("sch_" + descending()) : schema.make(id)),
  })),
)
export type ID = typeof ID.Type

export const ScheduleKind = Schema.Literals(["reminder"]).annotate({ identifier: "ScheduleKind" })
export type ScheduleKind = typeof ScheduleKind.Type

/** pending → running → completed | failed; cancelled is terminal from any pre-terminal state. */
export const ScheduleStatus = Schema.Literals(["pending", "running", "completed", "cancelled", "failed"]).annotate({
  identifier: "ScheduleStatus",
})
export type ScheduleStatus = typeof ScheduleStatus.Type

export class Info extends Schema.Class<Info>("Schedule.Info")({
  id: ID,
  sessionID: Schema.String,
  kind: ScheduleKind,
  content: Schema.String.annotate({ description: "User-confirmed reminder text" }),
  dueAt: Schema.Number.annotate({ description: "Normalized absolute due timestamp (ms)" }),
  timezone: Schema.String.annotate({ description: "User-confirmed IANA timezone" }),
  status: ScheduleStatus,
  attempts: Schema.Number,
  nextAttemptAt: optional(Schema.Number).annotate({ description: "Bounded retry state" }),
  leaseOwner: optional(Schema.String).annotate({ description: "Temporary claim, recoverable after crash" }),
  leaseExpiresAt: optional(Schema.Number),
  deliveryKey: Schema.String.annotate({ description: "Stable idempotency key across retries" }),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class Delivery extends Schema.Class<Delivery>("Schedule.Delivery")({
  deliveryKey: Schema.String,
  scheduleID: ID,
  sessionID: Schema.String,
  kind: ScheduleKind,
  content: Schema.String.annotate({ description: "Displayable content snapshot at delivery time" }),
  deliveredAt: Schema.Number,
  caughtUp: Schema.Boolean.annotate({ description: "True when delivered by offline catch-up after restart" }),
  createdAt: Schema.Number,
}) {}

export const OccurrenceID = Schema.String.check(Schema.isStartingWith("sco_")).pipe(
  Schema.brand("Schedule.OccurrenceID"),
  Schema.annotate({ identifier: "Schedule.OccurrenceID" }),
  statics((schema) => ({ create: () => schema.make("sco_" + descending()) })),
)
export type OccurrenceID = typeof OccurrenceID.Type

export const Kind = Schema.Literals(["reminder", "prompt", "goal", "task"]).annotate({ identifier: "Schedule.Kind" })
export type Kind = typeof Kind.Type

export const RuleStatus = Schema.Literals(["pending", "paused", "completed", "cancelled", "failed"]).annotate({
  identifier: "Schedule.RuleStatus",
})
export type RuleStatus = typeof RuleStatus.Type

export class ExistingTarget extends Schema.Class<ExistingTarget>("Schedule.ExistingTarget")({
  policy: Schema.Literal("existing"),
  sessionID: SessionID,
}) {}

export class NewOnceTarget extends Schema.Class<NewOnceTarget>("Schedule.NewOnceTarget")({
  policy: Schema.Literal("new_once"),
  template: SessionTask.OperationNewRootTarget,
}) {}

export class NewTarget extends Schema.Class<NewTarget>("Schedule.NewTarget")({
  policy: Schema.Literal("new"),
  template: SessionTask.OperationNewRootTarget,
}) {}

export class GoalResumeAuthorization extends Schema.Class<GoalResumeAuthorization>("Schedule.GoalResumeAuthorization")({
  goalRevision: PositiveInt,
  pauseVersion: NonNegativeInt,
}) {}

export class GoalTarget extends Schema.Class<GoalTarget>("Schedule.GoalTarget")({
  policy: Schema.Literal("goal"),
  goalID: Schema.String,
  resumeAuthorization: optional(GoalResumeAuthorization),
}) {}

/** Retained task_schedule rules keep their original same-mode child route. */
export class LegacyChildTarget extends Schema.Class<LegacyChildTarget>("Schedule.LegacyChildTarget")({
  policy: Schema.Literal("legacy_child"),
  agentID: optional(Agent.ID),
}) {}

export const PublicTarget = Schema.Union([ExistingTarget, NewOnceTarget, NewTarget, GoalTarget]).annotate({
  identifier: "Schedule.PublicTarget",
})
export type PublicTarget = typeof PublicTarget.Type

export const Target = Schema.Union([ExistingTarget, NewOnceTarget, NewTarget, GoalTarget, LegacyChildTarget]).annotate({
  identifier: "Schedule.Target",
})
export type Target = typeof Target.Type

export class ExecutionPolicy extends Schema.Class<ExecutionPolicy>("Schedule.ExecutionPolicy")({
  delivery: Schema.Literals(["queue", "steer"]),
  missed: Schema.Literals(["catch_up", "skip"]),
}) {}

export class ErrorInfo extends Schema.Class<ErrorInfo>("Schedule.ErrorInfo")({
  code: Schema.String,
  message: Schema.String,
}) {}

export class Rule extends Schema.Class<Rule>("Schedule.Rule")({
  id: ID,
  sessionID: SessionID,
  kind: Kind,
  content: Schema.String,
  dueAt: Schema.Number,
  recurrence: optional(SessionTask.TaskRecurrence),
  timezone: Schema.String,
  target: optional(Target),
  executionPolicy: ExecutionPolicy,
  sourceAgent: optional(Agent.ID),
  taskID: optional(Schema.String),
  revision: PositiveInt,
  status: RuleStatus,
  nextDueAt: optional(Schema.Number),
  activeOccurrenceID: optional(OccurrenceID),
  boundTargetSessionID: optional(SessionID),
  error: optional(ErrorInfo),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

/** Authenticated callers choose a target; source selection and claims remain service-owned. */
export class Create extends Schema.Class<Create>("Schedule.Create")({
  sessionID: SessionID,
  kind: Schema.Literals(["reminder", "prompt", "goal"]),
  content: Schema.String.check(Schema.isMinLength(1)),
  dueAt: optional(Schema.Number),
  recurrence: optional(SessionTask.TaskRecurrence),
  timezone: Schema.String,
  target: optional(PublicTarget),
  executionPolicy: optional(ExecutionPolicy),
}) {}

export class Edit extends Schema.Class<Edit>("Schedule.Edit")({
  expectedRevision: PositiveInt,
  content: optional(Schema.String.check(Schema.isMinLength(1))),
  dueAt: optional(Schema.Number),
  recurrence: optional(Schema.NullOr(SessionTask.TaskRecurrence)),
  timezone: optional(Schema.String),
  target: optional(PublicTarget),
  executionPolicy: optional(ExecutionPolicy),
}) {}

export class Mutation extends Schema.Class<Mutation>("Schedule.Mutation")({
  expectedRevision: PositiveInt,
}) {}

export const OccurrenceStatus = Schema.Literals([
  "claimed", "admitted", "running", "completed", "failed", "cancelled", "blocked", "skipped", "recovery_required",
]).annotate({ identifier: "Schedule.OccurrenceStatus" })
export type OccurrenceStatus = typeof OccurrenceStatus.Type

export class Admission extends Schema.Class<Admission>("Schedule.Admission")({
  targetSessionID: SessionID,
  inputID: SessionMessage.ID,
  operationID: SessionTask.OperationID,
  admittedAt: Schema.Number,
  taskID: optional(Schema.String),
  taskRevision: optional(PositiveInt),
}) {}

export class LegacyReminderClaim extends Schema.Class<LegacyReminderClaim>("Schedule.LegacyReminderClaim")({
  owner: optional(Schema.String),
  expiresAt: optional(Schema.Number),
  attempts: NonNegativeInt,
  nextAttemptAt: optional(Schema.Number),
}) {}

export class Occurrence extends Schema.Class<Occurrence>("Schedule.Occurrence")({
  id: OccurrenceID,
  scheduleID: ID,
  sessionID: SessionID,
  ruleRevision: PositiveInt,
  snapshot: Rule,
  scheduledAt: Schema.Number,
  claimedAt: Schema.Number,
  claimOwner: Schema.String,
  caughtUp: Schema.Boolean,
  missedUntil: optional(Schema.Number),
  status: OccurrenceStatus,
  cancelRequested: optional(Schema.Boolean),
  inputID: SessionMessage.ID,
  operationID: SessionTask.OperationID,
  targetSessionID: optional(SessionID),
  taskID: optional(Schema.String),
  taskRevision: optional(PositiveInt),
  admission: optional(Admission),
  actorAgent: optional(Agent.ID),
  receipt: optional(Delegation.Receipt),
  deliveryKey: optional(Schema.String),
  legacyDelivery: optional(Schema.Boolean),
  legacyClaim: optional(LegacyReminderClaim),
  goalID: optional(Schema.String),
  roundID: optional(Schema.String),
  goalInputID: optional(SessionMessage.ID),
  result: optional(SessionTask.OperationResultRef),
  output: optional(Schema.String),
  sourceSettlement: optional(Schema.Literals(["pending", "completed", "conflict", "cancelled", "unavailable"])),
  error: optional(ErrorInfo),
  completedAt: optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class RuleChange extends Schema.Class<RuleChange>("Schedule.RuleChange")({
  content: optional(Schema.String),
  dueAt: optional(Schema.Number),
  recurrence: optional(Schema.NullOr(SessionTask.TaskRecurrence)),
  timezone: optional(Schema.String),
  target: optional(Schema.NullOr(Target)),
  executionPolicy: optional(ExecutionPolicy),
  status: optional(RuleStatus),
  nextDueAt: optional(Schema.NullOr(Schema.Number)),
  activeOccurrenceID: optional(Schema.NullOr(OccurrenceID)),
  boundTargetSessionID: optional(Schema.NullOr(SessionID)),
  taskID: optional(Schema.NullOr(Schema.String)),
  error: optional(Schema.NullOr(ErrorInfo)),
}) {}

export class OccurrenceChange extends Schema.Class<OccurrenceChange>("Schedule.OccurrenceChange")({
  status: optional(OccurrenceStatus),
  cancelRequested: optional(Schema.Boolean),
  targetSessionID: optional(SessionID),
  taskID: optional(Schema.String),
  taskRevision: optional(PositiveInt),
  admission: optional(Admission),
  actorAgent: optional(Agent.ID),
  receipt: optional(Delegation.Receipt),
  goalID: optional(Schema.String),
  roundID: optional(Schema.String),
  goalInputID: optional(SessionMessage.ID),
  result: optional(SessionTask.OperationResultRef),
  output: optional(Schema.String),
  sourceSettlement: optional(Schema.Literals(["pending", "completed", "conflict", "cancelled", "unavailable"])),
  error: optional(Schema.NullOr(ErrorInfo)),
  completedAt: optional(Schema.Number),
}) {}

/** Retained reminder snapshots; the same canonical value is used by Core and clients. */
export const Updated = Event.ephemeral({
  type: "schedule.updated",
  schema: { sessionID: SessionID, schedules: Schema.Array(Info) },
})
export const Delivered = Event.ephemeral({
  type: "schedule.delivered",
  schema: { sessionID: SessionID, delivery: Delivery },
})
export const RuleUpdated = Event.ephemeral({
  type: "schedule.rule.updated",
  schema: { sessionID: SessionID, rule: Rule },
})
export const OccurrenceUpdated = Event.ephemeral({
  type: "schedule.occurrence.updated",
  schema: { sessionID: SessionID, occurrence: Occurrence },
})

export const RuleCreated = Event.durable({
  type: "schedule.rule.created",
  durable: { version: 1, aggregate: "sessionID" },
  schema: { sessionID: SessionID, rule: Rule },
})
export const RuleChanged = Event.durable({
  type: "schedule.rule.changed",
  durable: { version: 1, aggregate: "sessionID" },
  schema: { sessionID: SessionID, scheduleID: ID, revision: PositiveInt, change: RuleChange },
})
export const OccurrenceClaimed = Event.durable({
  type: "schedule.occurrence.claimed",
  durable: { version: 1, aggregate: "sessionID" },
  schema: { sessionID: SessionID, occurrence: Occurrence },
})
export const OccurrenceChanged = Event.durable({
  type: "schedule.occurrence.changed",
  durable: { version: 1, aggregate: "sessionID" },
  schema: { sessionID: SessionID, occurrenceID: OccurrenceID, change: OccurrenceChange },
})
export const DurableDefinitions = Event.inventory(RuleCreated, RuleChanged, OccurrenceClaimed, OccurrenceChanged)
export const Definitions = Event.inventory(Updated, Delivered, RuleUpdated, OccurrenceUpdated, ...DurableDefinitions)
