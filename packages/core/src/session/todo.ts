export * as SessionTodo from "./todo"

import { Context, Effect, Layer, Schema } from "effect"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { SessionTask } from "./task"

/**
 * Legacy three-field todo shape. Kept for backward-compatible reads: every
 * task write publishes a `todo.updated` projection from the task source (see
 * {@link SessionTask.Event.TodoUpdated}), so this adapter simply forwards to
 * {@link SessionTask} — TaskTable is the single source of truth.
 *
 * @deprecated Use SessionTask directly.
 */
export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
}).annotate({ identifier: "SessionTodo.Info" })
export type Info = typeof Info.Type

export const Event = {
  Updated: EventV2.define({
    type: "todo.updated",
    schema: {
      sessionID: SessionSchema.ID,
      todos: Schema.Array(Info),
    },
  }),
}

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<Info>
  }) => Effect.Effect<void>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionTodo") {}

const STATUS_MAP: Record<string, SessionTaskSchema.TaskStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
  scheduled: "scheduled",
  failed: "failed",
}
const PRIORITY_MAP: Record<string, SessionTaskSchema.TaskPriority> = {
  high: "high",
  medium: "medium",
  low: "low",
}

const toTask = (todo: Info): SessionTask.WriteInfo => ({
  content: todo.content,
  status: STATUS_MAP[todo.status] ?? "pending",
  priority: PRIORITY_MAP[todo.priority] ?? "medium",
})

const toTodo = (task: SessionTask.Info): Info => ({
  content: task.content,
  status: task.status,
  priority: task.priority,
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const tasks = yield* SessionTask.Service

    const update = Effect.fn("SessionTodo.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly todos: ReadonlyArray<Info>
    }) {
      yield* tasks.update({ sessionID: input.sessionID, tasks: input.todos.map(toTask) })
    })

    const get = Effect.fn("SessionTodo.get")(function* (sessionID: SessionSchema.ID) {
      const tasksList = yield* tasks.get(sessionID)
      return tasksList.map(toTodo)
    })

    return Service.of({ update, get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionTask.defaultLayer))
export const node = LayerNode.make(layer, [SessionTask.node])
