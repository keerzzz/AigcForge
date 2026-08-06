export * as TaskUpdateTool from "./task-update"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
// Alias required: SessionTask (domain service) collides with SessionTask (schema).
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { PermissionV2 } from "../permission"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task_update"

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "The task id to update." }),
  content: Schema.optional(Schema.String).annotate({ description: "New content for the task." }),
  priority: Schema.optional(SessionTaskSchema.TaskPriority).annotate({ description: "New priority." }),
  status: Schema.optional(SessionTaskSchema.TaskStatus).annotate({
    description:
      "New status. Provide this to complete/reopen/start a task instead of rewriting the full list. When combined with content/priority, both update atomically.",
  }),
  expectedRevision: Schema.optional(Schema.Number).annotate({
    description:
      "The revision the caller last observed. If it changed, the update is rejected as stale - re-read and retry.",
  }),
})

export const Output = Schema.Struct({
  task: SessionTask.Info,
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => JSON.stringify(output.task, null, 2)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const tasks = yield* SessionTask.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Update a single task's content, priority, and/or status by id. Other tasks are untouched. Use this for incremental edits instead of rewriting the full list with taskwrite. Pass expectedRevision to reject stale writes.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const hasFields = input.content !== undefined || input.priority !== undefined
              if (!hasFields && input.status === undefined) {
                return yield* new ToolFailure({
                  message: "task_update requires at least one of content, priority, or status",
                })
              }
              // Field updates (content/priority) go through updateTask; status goes
              // through patch. When both are requested, updateTask runs first and its
              // returned revision guards the subsequent patch so the two writes apply
              // against a consistent revision.
              let result: typeof SessionTask.Info.Type | undefined
              if (hasFields) {
                result = yield* tasks
                  .updateTask({
                    sessionID: context.sessionID,
                    id: input.id,
                    content: input.content,
                    priority: input.priority,
                    expectedRevision: input.expectedRevision,
                  })
                  .pipe(
                    Effect.mapError((error) =>
                      error instanceof SessionTask.TaskWriteError
                        ? new ToolFailure({ message: error.message })
                        : new ToolFailure({ message: "Unable to update task" }),
                    ),
                  )
                if (!result) {
                  return yield* new ToolFailure({
                    message: `Task ${input.id} not found or revision is stale; re-read the task list and retry`,
                  })
                }
              }
              if (input.status !== undefined) {
                result = yield* tasks
                  .patch({
                    sessionID: context.sessionID,
                    id: input.id,
                    status: input.status,
                    expectedRevision: result?.revision ?? input.expectedRevision,
                  })
                  .pipe(
                    Effect.mapError((error) =>
                      error instanceof SessionTask.TaskWriteError
                        ? new ToolFailure({ message: error.message })
                        : new ToolFailure({ message: "Unable to update task" }),
                    ),
                  )
                if (!result) {
                  return yield* new ToolFailure({
                    message: `Task ${input.id} not found or revision is stale; re-read the task list and retry`,
                  })
                }
              }
              // The early guard ensures at least one branch ran; this final guard
              // satisfies the type checker that result is defined.
              if (!result) return yield* new ToolFailure({ message: "Unable to update task" })
              return { task: result }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to update task" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
