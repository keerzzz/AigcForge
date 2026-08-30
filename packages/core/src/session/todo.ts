export * as SessionTodo from "./todo"

import { Context, Effect, Layer, Schema } from "effect"
import { LayerNode } from "../effect/layer-node"
import { SessionSchema } from "./schema"
import { SessionTask } from "./task"

/**
 * Legacy three-field todo shape. Kept for backward-compatible reads: every
 * task write publishes a `todo.updated` projection from the task source (see
 * {@link SessionTask.Event.TodoUpdated}), so this adapter simply forwards to
 * {@link SessionTask} — TaskTable is the single source of truth. The status /
 * priority stay loose Strings: this is also the GET /todo response schema, and
 * the task projection passes `scheduled` / `failed` straight through.
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

/**
 * Strict write-side input for {@link Interface.update} (the todowrite tool
 * contract). Unlike {@link Info}, only the four model-facing statuses and
 * three priorities are accepted — an invalid value is rejected by schema
 * validation so the caller can self-correct, instead of being silently
 * downgraded or persisted as a dead scheduled job.
 */
export const WriteItem = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.Literals(["pending", "in_progress", "completed", "cancelled"]).annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.Literals(["high", "medium", "low"]).annotate({
    description: "Priority level of the task: high, medium, low",
  }),
}).annotate({ identifier: "SessionTodo.WriteItem" })
export type WriteItem = typeof WriteItem.Type

export interface Interface {
  readonly update: (input: {
    readonly sessionID: SessionSchema.ID
    readonly todos: ReadonlyArray<WriteItem>
  }) => Effect.Effect<ReadonlyArray<Info>, SessionTask.TaskWriteError>
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionTodo") {}

const toTask = (todo: WriteItem): typeof SessionTask.WriteInfo.Type => ({
  content: todo.content,
  status: todo.status,
  priority: todo.priority,
})

const toTodo = (task: SessionTask.Info): Info => ({
  content: task.content,
  status: task.status,
  priority: task.priority,
})

// Optimistic-concurrency baseline for legacy full-list writes (option B):
// sessionID → fingerprint of the list the caller's write is based on. Module
// scope gives it the same single-process lifetime as SessionTask's writeLock —
// the guard must hold across separately-built service instances; a process
// restart clears it, so the first todowrite after boot passes and rebuilds it.
const writeBaseline = new Map<string, string>()

// A bare maxRevision compare cannot see an out-of-band append (the new row
// starts at revision 1, leaving the max unchanged), so the baseline is a
// fingerprint of every id + revision: any append/patch/delete/reorder by
// another write path changes it.
const fingerprint = (tasks: ReadonlyArray<{ readonly id: string; readonly revision: number }>) =>
  tasks
    .map((task) => `${task.id}:${task.revision}`)
    .sort()
    .join(",")

const maxRevision = (tasks: ReadonlyArray<{ readonly revision: number }>) =>
  tasks.reduce((max, task) => Math.max(max, task.revision), 0)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const tasks = yield* SessionTask.Service

    const update = Effect.fn("SessionTodo.update")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly todos: ReadonlyArray<WriteItem>
    }) {
      const current = yield* tasks.get(input.sessionID)
      const seen = fingerprint(current)
      const baseline = writeBaseline.get(input.sessionID)
      if (baseline !== undefined && baseline !== seen) {
        // Another write path (taskspawn/taskschedule/HTTP/patch) landed since
        // the caller's last full-list write. Rebase the caller: the tool layer
        // returns the current list with this error, so the merged retry is
        // based on `seen` and passes the guard.
        writeBaseline.set(input.sessionID, seen)
        return yield* new SessionTask.TaskWriteError({ sessionID: input.sessionID, reason: "stale_revision" })
      }
      // Bridge to the Task source by position: existing ids are reused so a
      // delegation writeback to a linked task survives this full-list replace.
      const resolved = yield* tasks.replaceLegacy({
        sessionID: input.sessionID,
        tasks: input.todos.map(toTask),
        expectedRevision: maxRevision(current),
      })
      writeBaseline.set(input.sessionID, fingerprint(resolved))
      return resolved.map(toTodo)
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
