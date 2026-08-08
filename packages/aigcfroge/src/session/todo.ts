/**
 * @deprecated Todo/Task 升级：V1 Todo 已由 SessionTask（`@aigcfroge/core/session/task`）
 * 取代。实现已收敛到 SessionTask（TaskTable 是唯一数据源，TodoTable 不再被写入），
 * 本文件仅保留 V1 服务/工具外壳以向后兼容，不新增功能。自 M3b-2 起标记 deprecated
 * （提前标记决策），物理删除仍在 M5 之后的下个大版本（Phase 5 V1 退役的独立决策）。
 */
import { LayerNode } from "@aigcfroge/core/effect/layer-node"
import { SessionID } from "./schema"
import { Effect, Layer, Context, Schema } from "effect"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { InstanceRef, WorkspaceRef } from "@/effect/instance-ref"

export const Info = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
}).annotate({ identifier: "Todo" })
export type Info = Schema.Schema.Type<typeof Info>

export interface Interface {
  readonly update: (input: {
    sessionID: SessionID
    todos: Info[]
  }) => Effect.Effect<ReadonlyArray<Info>, Schema.SchemaError | SessionTask.TaskWriteError>
  readonly get: (sessionID: SessionID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/SessionTodo") {}

// Core's EventV2.publish stamps an event's location only from an ambient
// Location.Service (core/src/event.ts). V1 prompt-loop fibers carry InstanceRef
// instead, so without this bridge task.updated/todo.updated would go out
// location-less and the SSE /event location filter would drop them.
const withInstanceLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const ctx = yield* InstanceRef
    if (!ctx) return yield* effect
    const workspaceID = yield* WorkspaceRef
    return yield* effect.pipe(
      Effect.provideService(
        Location.Service,
        Location.Service.of({
          directory: AbsolutePath.make(ctx.directory),
          ...(workspaceID ? { workspaceID } : {}),
          project: { id: Project.ID.make(ctx.project.id), directory: AbsolutePath.make(ctx.worktree) },
        }),
      ),
    )
  })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const todos = yield* SessionTodo.Service

    const update = Effect.fn("Todo.update")(function* (input: { sessionID: SessionID; todos: Info[] }) {
      // Narrow the loose three-field shape into the strict write contract: an
      // invalid status/priority is rejected (SchemaError) for the caller to
      // surface, instead of being persisted into TaskTable.
      const items = yield* Schema.decodeUnknownEffect(Schema.Array(SessionTodo.WriteItem))(input.todos)
      // SessionTask.publishBoth emits task.updated + todo.updated; do not
      // publish a separate event here.
      return yield* withInstanceLocation(todos.update({ sessionID: input.sessionID, todos: items }))
    })

    const get = Effect.fn("Todo.get")(function* (sessionID: SessionID) {
      return yield* todos.get(sessionID)
    })

    return Service.of({ update, get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionTodo.defaultLayer))

export const node = LayerNode.make(layer, [SessionTodo.node])

export * as Todo from "./todo"
