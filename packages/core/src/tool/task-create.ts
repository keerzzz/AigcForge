export * as TaskCreateTool from "./task-create.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../permission.js"
import { SessionTask } from "../session/task.js"

export const name = "task_create"

export const description =
  "Append one or more tasks to the end of the current session's task list. Use this for incremental additions instead of rewriting the full list with taskwrite."

export const Input = Schema.Struct({
  tasks: Schema.Array(SessionTask.WriteInfo).annotate({
    description:
      "New tasks to append to the end of the session's list. Entries without an id are minted a stable tsk_ id.",
  }),
})

export const Output = Schema.Struct({
  tasks: Schema.Array(SessionTask.Info),
})

const toModelContent = (tasks: ReadonlyArray<SessionTask.Info>) => JSON.stringify(tasks, null, 2)

export const Plugin = {
  id: "omnixa.tool.task_create",
  effect: Effect.fn("TaskCreateTool.Plugin")(function* (ctx: Context) {
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
                  tasks.append({ sessionID: context.sessionID, tasks: input.tasks }).pipe(
                    Effect.mapError((error) =>
                      error instanceof SessionTask.TaskWriteError
                        ? new ToolFailure({ message: error.message })
                        : new ToolFailure({ message: "Unable to create tasks" }),
                    ),
                    Effect.map((resolved) => ({ output: { tasks: resolved }, content: toModelContent(resolved) })),
                  ),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
