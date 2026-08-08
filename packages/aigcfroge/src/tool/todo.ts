/**
 * @deprecated Todo/Task 升级：V1 todowrite tool 已由 `taskwrite`/`task_schedule`/
 * `task_spawn`（`@aigcfroge/core/tool`）取代。本文件保留以向后兼容（V1 runtime 的
 * 写入经 V1 Todo.Service 收敛到 TaskTable），不新增功能。自 M3b-2 起标记 deprecated
 * （提前标记决策），物理删除仍在 M5 之后的下个大版本（Phase 5 V1 退役的独立决策）。
 */
import { Effect, Schema } from "effect"
import { SessionTodo } from "@aigcfroge/core/session/todo"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

// Reuse the core strict write contract: only the four model-facing statuses and
// three priorities are accepted, so an invalid value is rejected by schema
// validation (the model can self-correct) instead of being silently persisted.
export const Parameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(SessionTodo.WriteItem)).annotate({ description: "The updated todo list" }),
})

type Metadata = {
  todos: ReadonlyArray<Todo.Info>
}

export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          // Tool execute defects surface to the model as the tool-error message
          // (see SessionProcessor.failToolCall), so map each failure to a
          // readable, self-correcting instruction instead of swallowing it.
          const updated = yield* todo
            .update({
              sessionID: ctx.sessionID,
              todos: params.todos,
            })
            .pipe(
              Effect.catchTag("SessionTask.TaskWriteError", (error) => {
                if (error.reason !== "stale_revision") return Effect.die(new Error(error.message))
                // Mirror core todowrite: hand the model the server's current
                // list so it can merge its changes and retry.
                return todo.get(ctx.sessionID).pipe(
                  Effect.flatMap((current) =>
                    Effect.die(
                      new Error(
                        `${error.message}\nCurrent server-side todo list:\n${JSON.stringify(current, null, 2)}\nMerge your changes into this list and retry.`,
                      ),
                    ),
                  ),
                )
              }),
              Effect.catchTag("SchemaError", () =>
                Effect.die(
                  new Error(
                    "Invalid todo status or priority: status must be one of pending, in_progress, completed, cancelled; priority must be one of high, medium, low.",
                  ),
                ),
              ),
            )

          return {
            title: `${updated.filter((x) => x.status !== "completed").length} todos`,
            output: JSON.stringify(updated, null, 2),
            metadata: {
              todos: updated,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
