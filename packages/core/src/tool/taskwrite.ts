export * as TaskWriteTool from "./taskwrite.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../permission.js"
import { SessionTask } from "../session/task.js"

export const name = "taskwrite"

export const description =
  "Create and maintain a structured task list for the current session. Use it to track progress during multi-step work, keep task statuses current, and build the todo list a task delegation can later link to with parent_task_id."

export const Input = Schema.Struct({
  tasks: Schema.Array(SessionTask.WriteInfo).annotate({
    description:
      "The full task list. Entries without an id are created with a stable tsk_ id; entries with an id are reconciled in place. Omitted entries are removed.",
  }),
  expectedRevision: Schema.optional(Schema.Number).annotate({
    description:
      "The max revision the caller observed across all tasks. If any task changed since, the replace is rejected as stale. Omit only for an unconditional replace; prefer task_create/task_update/task_delete/task_reorder for single-task edits.",
  }),
})

export const Output = Schema.Struct({
  tasks: Schema.Array(SessionTask.Info),
})

const toModelContent = (tasks: ReadonlyArray<SessionTask.Info>) => JSON.stringify(tasks, null, 2)

export const Plugin = {
  id: "aigcfroge.tool.taskwrite",
  effect: Effect.fn("TaskWriteTool.Plugin")(function* (ctx: Context) {
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
                    .update(
                      {
                        sessionID: context.sessionID,
                        tasks: input.tasks,
                        expectedRevision: input.expectedRevision,
                      },
                      { management: { type: "tool", messageID: context.messageID, id: context.id } },
                    )
                    .pipe(
                      Effect.mapError((error) =>
                        error instanceof SessionTask.TaskWriteError
                          ? new ToolFailure({ message: error.message })
                          : new ToolFailure({ message: "Unable to update tasks" }),
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
