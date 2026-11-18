export * as TaskReorderTool from "./task-reorder.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../permission.js"
import { SessionTask } from "../session/task.js"

export const name = "task_reorder"

export const description =
  "Reorder the session's task list by id. Provide the full id list in the new order. Use this instead of rewriting the full list with taskwrite when only the order changed."

export const Input = Schema.Struct({
  ids: Schema.Array(Schema.String).annotate({
    description:
      "The full task id list in the new order. Must be a permutation of the session's current task ids (every task, no omissions, no duplicates).",
  }),
  expectedRevision: Schema.optional(Schema.Number).annotate({
    description:
      "The max revision the caller observed across all tasks. If any task changed since, the reorder is rejected as stale.",
  }),
})

export const Output = Schema.Struct({
  tasks: Schema.Array(SessionTask.Info),
})

const toModelContent = (tasks: ReadonlyArray<SessionTask.Info>) => JSON.stringify(tasks, null, 2)

export const Plugin = {
  id: "aigcfroge.tool.task_reorder",
  effect: Effect.fn("TaskReorderTool.Plugin")(function* (ctx: Context) {
    const tasks = yield* SessionTask.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            permission
              .assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool" as const, messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: `Permission denied: ${name}` })),
                Effect.andThen(
                  tasks
                    .reorder(
                      {
                        sessionID: context.sessionID,
                        ids: input.ids,
                        expectedRevision: input.expectedRevision,
                      },
                      { management: { type: "tool", messageID: context.messageID, id: context.id } },
                    )
                    .pipe(
                      Effect.mapError((error) =>
                        error instanceof SessionTask.TaskWriteError
                          ? new ToolFailure({ message: error.message })
                          : new ToolFailure({ message: "Unable to reorder tasks" }),
                      ),
                      Effect.map((resolved) => ({
                        output: { tasks: resolved },
                        content: toModelContent(resolved),
                      })),
                    ),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
