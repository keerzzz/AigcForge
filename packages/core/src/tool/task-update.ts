export * as TaskUpdateTool from "./task-update.js"

import type { Context } from "@omnixa/plugin/effect/plugin"
import { ToolFailure } from "@omnixa/ai"
import { Effect, Schema } from "effect"
// Alias required: SessionTask (domain service) collides with SessionTask (schema).
import { SessionTask as SessionTaskSchema } from "@omnixa/schema/session-task"
import { Permission } from "../permission.js"
import { SessionTask } from "../session/task.js"

export const name = "task_update"

export const description =
  "Update a single task's content, priority, and/or status by id. Other tasks are untouched. Use this for incremental edits instead of rewriting the full list with taskwrite. Pass expectedRevision to reject stale writes."

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "The task id to update." }),
  content: Schema.optional(Schema.String).annotate({ description: "New content for the task." }),
  priority: Schema.optional(SessionTaskSchema.TaskPriority).annotate({ description: "New priority." }),
  status: Schema.optional(SessionTaskSchema.TaskStatus).annotate({
    description:
      "New status. Provide this to complete/reopen/start a task instead of rewriting the full list. When combined with content/priority, both update atomically.",
  }),
  outputDigest: Schema.optional(Schema.String).annotate({
    description:
      "Incremental step output summary (Work ProgressLedger). Written when a step completes so an interrupted run can resume from its digest.",
  }),
  expectedRevision: Schema.optional(Schema.Number).annotate({
    description:
      "The revision the caller last observed. If it changed, the update is rejected as stale - re-read and retry.",
  }),
})

export const Output = Schema.Struct({
  task: SessionTask.Info,
})

const toModelContent = (task: SessionTask.Info) => JSON.stringify(task, null, 2)

export const Plugin = {
  id: "omnixa.tool.task_update",
  effect: Effect.fn("TaskUpdateTool.Plugin")(function* (ctx: Context) {
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
                    const hasFields =
                      input.content !== undefined || input.priority !== undefined || input.outputDigest !== undefined
                    if (!hasFields && input.status === undefined) {
                      return yield* Effect.fail(
                        new ToolFailure({
                          message: "task_update requires at least one of content, priority, outputDigest, or status",
                        }),
                      )
                    }
                    const result = yield* tasks
                      .updateTask(
                        {
                          sessionID: context.sessionID,
                          id: input.id,
                          status: input.status,
                          content: input.content,
                          priority: input.priority,
                          outputDigest: input.outputDigest,
                          expectedRevision: input.expectedRevision,
                        },
                        { management: { type: "tool", messageID: context.messageID, id: context.id } },
                      )
                      .pipe(Effect.mapError((error) => new ToolFailure({ message: error.message })))
                    if (!result)
                      return yield* new ToolFailure({
                        message: `Task ${input.id} not found or revision is stale; re-read the task list and retry`,
                      })
                    return { output: { task: result }, content: toModelContent(result) }
                  }),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
