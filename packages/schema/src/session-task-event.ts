import { Schema } from "effect"
import { Event } from "./event.js"
import { optional } from "./schema.js"
import { SessionID } from "./session-id.js"
import { SessionTask } from "./session-task.js"
import { Location } from "./location.js"
import { ProductMode } from "./product-mode.js"
import { SessionGoalID } from "./session-goal-id.js"

export class TodoProjection extends Schema.Class<TodoProjection>("SessionTask.TodoProjection")({
  content: Schema.String,
  status: Schema.String,
  priority: Schema.String,
}) {}

export const TaskExecutionPhase = Schema.Literals(["thinking", "streaming", "tool", "waiting"]).annotate({
  identifier: "SessionTask.TaskExecutionPhase",
})
export type TaskExecutionPhase = typeof TaskExecutionPhase.Type

/** Current Task snapshots are notifications; the persisted Task rows own recovery. */
export const Updated = Event.ephemeral({
  type: "task.updated",
  schema: {
    sessionID: SessionID,
    tasks: Schema.Array(SessionTask.Info),
  },
})

/** Shared transitional projection for the existing App/TUI todo consumers. */
export const TodoUpdated = Event.ephemeral({
  type: "todo.updated",
  schema: {
    sessionID: SessionID,
    todos: Schema.Array(TodoProjection),
  },
})

/** Runtime progress is ephemeral and is never persisted on a Task row. */
export const Progress = Event.ephemeral({
  type: "task.progress",
  schema: {
    sessionID: SessionID,
    taskID: Schema.String,
    phase: TaskExecutionPhase,
    progress: optional(Schema.Number),
    current: optional(Schema.Number),
    total: optional(Schema.Number),
    updatedAt: Schema.Number,
  },
})

/** The reservation records the immutable request and captured source before permission can park. */
export const OperationReserved = Event.durable({
  type: "task.operation.reserved",
  durable: { version: 1, aggregate: "sessionID" },
  schema: {
    sessionID: SessionID,
    request: SessionTask.OperationRequest,
    source: SessionTask.OperationSource,
    selection: SessionTask.OperationSelection,
    sourceLocation: Location.Ref,
    sourceMode: ProductMode.ID,
    targetSessionID: SessionID,
    taskRevision: optional(Schema.Int),
    predecessorID: optional(SessionTask.OperationID),
    goalRounds: optional(Schema.Array(SessionGoalID.RoundRef)),
  },
})

/** Mutable facts are deltas; the request, source and input identity cannot be overwritten. */
export const OperationChanged = Event.durable({
  type: "task.operation.changed",
  durable: { version: 1, aggregate: "sessionID" },
  schema: {
    sessionID: SessionID,
    operationID: SessionTask.OperationID,
    change: SessionTask.OperationChange,
  },
})

export const DurableDefinitions = Event.inventory(OperationReserved, OperationChanged)
export const Durable = Schema.Union(DurableDefinitions, { mode: "oneOf" })
export type DurableEvent = typeof Durable.Type
export const Definitions = Event.inventory(Updated, TodoUpdated, Progress, ...DurableDefinitions)

export * as SessionTaskEvent from "./session-task-event.js"
