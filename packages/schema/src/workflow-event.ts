import { Schema } from "effect"
import { Event } from "./event.js"
import { optional } from "./schema.js"
import { WorkflowAsset } from "./workflow-asset.js"

export const Updated = Event.durable({
  type: "workflow.run.updated",
  durable: { version: 1, aggregate: "runID" },
  schema: {
    runID: WorkflowAsset.WorkflowRunID,
    sessionID: Schema.String,
    status: WorkflowAsset.WorkflowRunStatus,
    revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    currentStepId: optional(Schema.String),
    errorCategory: optional(WorkflowAsset.ErrorCategory),
    timeUpdated: Schema.Finite,
  },
})

export const Definitions = Event.inventory(Updated)

export * as WorkflowEvent from "./workflow-event.js"
