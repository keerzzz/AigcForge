export * as MetaAgent from "./meta-agent.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Model } from "./model.js"
import { ModelGroup } from "./model-group.js"
import { DateTimeUtcFromMillis, optional } from "./schema.js"
import { MetaAgentID } from "./meta-agent-id.js"
import { SessionID } from "./session-id.js"
import { SessionMessage } from "./session-message.js"
import { DelegationID, ParticipantID } from "./delegation-id.js"
import { WorkflowAsset } from "./workflow-asset.js"
import { Project } from "./project.js"

export const ID = MetaAgentID.ID
export type ID = MetaAgentID.ID

// Session and its event inventory share these values without a Session/Event initialization cycle.
export class ExecutorPreference extends Schema.Class<ExecutorPreference>("Session.ExecutorPreference")(
  Schema.Struct({ agent: Agent.ID, model: Model.Selection.pipe(optional) }).annotate({
    identifier: "Session.ExecutorPreference",
  }),
) {}

export class ExecutorBinding extends Schema.Class<ExecutorBinding>("Session.ExecutorBinding")(
  Schema.Struct({
    agent: Agent.ID,
    model: Model.Selection,
    groupBehavior: ModelGroup.BehaviorSnapshot.pipe(optional),
    source: Schema.Literals(["tool", "preference", "agent", "session"]),
  }).annotate({ identifier: "Session.ExecutorBinding" }),
) {}

export class TaskControllerSource extends Schema.Class<TaskControllerSource>("Session.ControllerSource.Task")(
  Schema.Struct({ kind: Schema.Literal("task"), delegationID: DelegationID.ID, participantID: ParticipantID }).annotate(
    {
      identifier: "Session.ControllerSource.Task",
    },
  ),
) {}

export class SubagentControllerSource extends Schema.Class<SubagentControllerSource>(
  "Session.ControllerSource.Subagent",
)(
  Schema.Struct({
    kind: Schema.Literal("subagent"),
    assistantMessageID: SessionMessage.ID,
    toolCallID: Schema.String,
  }).annotate({
    identifier: "Session.ControllerSource.Subagent",
  }),
) {}

export class WorkflowControllerSource extends Schema.Class<WorkflowControllerSource>(
  "Session.ControllerSource.Workflow",
)(
  Schema.Struct({
    kind: Schema.Literal("workflow"),
    runID: WorkflowAsset.WorkflowRunID,
    stepRunID: WorkflowAsset.StepRunID,
    inputID: SessionMessage.ID,
  }).annotate({ identifier: "Session.ControllerSource.Workflow" }),
) {}

export const ControllerSource = Schema.Union([TaskControllerSource, SubagentControllerSource, WorkflowControllerSource])
  .pipe(Schema.toTaggedUnion("kind"))
  .annotate({ identifier: "Session.ControllerSource" })
export type ControllerSource = typeof ControllerSource.Type

export class RootController extends Schema.Class<RootController>("Session.Controller.Root")(
  Schema.Struct({ kind: Schema.Literal("root"), metaAgentID: ID, rootSessionID: SessionID }).annotate({
    identifier: "Session.Controller.Root",
  }),
) {}

export class ChildController extends Schema.Class<ChildController>("Session.Controller.Child")(
  Schema.Struct({
    kind: Schema.Literal("child"),
    metaAgentID: ID,
    rootSessionID: SessionID,
    executor: ExecutorBinding,
    source: ControllerSource,
  }).annotate({ identifier: "Session.Controller.Child" }),
) {}

export const Controller = Schema.Union([RootController, ChildController])
  .pipe(Schema.toTaggedUnion("kind"))
  .annotate({ identifier: "Session.Controller" })
export type Controller = typeof Controller.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  title: Schema.String,
  agent: Agent.ID,
  model: Model.Selection,
  groupBehavior: ModelGroup.BehaviorSnapshot.pipe(optional),
  time: Schema.Struct({
    created: DateTimeUtcFromMillis,
    updated: DateTimeUtcFromMillis,
    archived: DateTimeUtcFromMillis.pipe(Schema.optional),
  }),
}).annotate({ identifier: "MetaAgent.Info" })

export class AttachedSession extends Schema.Class<AttachedSession>("MetaAgent.AttachedSession")({
  sessionID: SessionID,
  role: Schema.Literals(["orchestrator", "worker", "tool"]),
  effort: optional(Schema.String),
  tokensUsed: optional(Schema.Number),
  resultSummary: optional(Schema.String),
}) {}

export class Stats extends Schema.Class<Stats>("MetaAgent.Stats")({
  totalSessions: Schema.Finite,
  totalTokens: optional(Schema.Finite),
  recordedTokens: Schema.Finite,
  unknownTokenSessionCount: Schema.Finite,
  stepCount: Schema.Finite,
  recordedOnly: Schema.Literal(true),
  unknownStepCount: Schema.Finite,
  physicalAttemptCoverage: Schema.Literal("unknown"),
}) {}

export class Read extends Schema.Class<Read>("MetaAgent.Read")({
  owner: optional(Info),
  controller: optional(Controller),
  sessions: Schema.Array(AttachedSession),
  stats: optional(Stats),
}) {}

export const FactCategory = Schema.Literals(["code_trap", "protocol", "api", "workflow"]).annotate({
  identifier: "MetaAgent.FactCategory",
})
export type FactCategory = typeof FactCategory.Type
export const MemoryContent = Schema.String.check(
  Schema.isMaxLength(2000, {
    message: "Memory fact content must be at most 2000 characters - store a distilled fact, not raw tool output",
  }),
).annotate({ identifier: "MetaAgent.MemoryContent" })

export class MemoryRecord extends Schema.Class<MemoryRecord>("MetaAgent.MemoryRecord")({
  id: Schema.String,
  projectID: Project.ID,
  metaAgentID: Schema.String,
  factCategory: FactCategory,
  content: Schema.String,
  sourceSessionID: optional(Schema.String),
  sourceStepID: optional(Schema.String),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}) {}
