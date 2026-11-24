export * as TaskDeleteTool from "./task-delete.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../permission.js"
import { SessionTask } from "../session/task.js"

export const name = "task_delete"

export const description =
  "Delete a single task by id. Other tasks are untouched. Use this for incremental removals instead of rewriting the full list with taskwrite."

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "The task id to delete." }),
})

export const Output = Schema.Struct({
  tasks: Schema.Array(SessionTask.Info),
})

const toModelContent = (tasks: ReadonlyArray<SessionTask.Info>) => JSON.stringify(tasks, null, 2)

export const Plugin = {
  id: "omnixa.tool.task_delete",
  effect: Effect.fn("TaskDeleteTool.Plugin")(function* (ctx: Context) {
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
                  Effect.gen(function* () {
                    const deleted = yield* tasks
                      .removeTask(
                        { sessionID: context.sessionID, id: input.id },
                        { management: { type: "tool", messageID: context.messageID, id: context.id } },
                      )
                      .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                    if (!deleted) return yield* Effect.fail(new ToolFailure({ message: `Task ${input.id} not found` }))
                    const remaining = yield* tasks.get(context.sessionID)
                    return { output: { tasks: remaining }, content: toModelContent(remaining) }
                  }),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
