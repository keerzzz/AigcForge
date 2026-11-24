import { Schema } from "effect"
import type { SessionInfo } from "@omnixa/client/promise"
import { MetaAgent } from "@omnixa/schema/meta-agent"

export class CollaborationDraft extends Schema.Class<CollaborationDraft>("SessionManagement.CollaborationDraft")({
  view: Schema.optional(Schema.Literal("advanced")),
  task: Schema.optional(
    Schema.Struct({
      serverID: Schema.String,
      sourceSessionID: Schema.String,
      taskID: Schema.optional(Schema.String),
      operationID: Schema.optional(Schema.String),
    }),
  ),
  source: Schema.optional(
    Schema.Struct({
      serverID: Schema.optional(Schema.String),
      sessionID: Schema.String,
      source: Schema.toEncoded(Schema.Union([MetaAgent.TaskControllerSource, MetaAgent.SubagentControllerSource])),
    }),
  ),
}) {}

export class MetaDraft extends Schema.Class<MetaDraft>("SessionManagement.MetaDraft")({
  target: Schema.optional(Schema.Struct({ serverID: Schema.String, sessionID: Schema.String })),
  communicationID: Schema.optional(Schema.String),
  taskID: Schema.optional(Schema.String),
  workerSessionID: Schema.optional(Schema.String),
  keyword: Schema.String,
  category: Schema.optional(Schema.Literals(["code_trap", "protocol", "api", "workflow"])),
}) {}

export class WorkflowDraft extends Schema.Class<WorkflowDraft>("SessionManagement.WorkflowDraft")({
  definitionPath: Schema.optional(Schema.String),
  source: Schema.optional(
    Schema.Struct({
      sessionID: Schema.String,
      runID: Schema.String,
      stepRunID: Schema.optional(Schema.String),
      inputID: Schema.optional(Schema.String),
    }),
  ),
}) {}

export class ArtifactDraft extends Schema.Class<ArtifactDraft>("SessionManagement.ArtifactDraft")({
  messageID: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  relativePath: Schema.optional(Schema.String),
}) {}

// Session placement is persisted by the Server; viewing a root read-only does not make it a child.
export function isChildSession(info: Pick<SessionInfo, "parentID" | "controller"> | undefined) {
  return !!info?.parentID || info?.controller?.kind === "child"
}
