export * as TaskWriteTool from "./taskwrite"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "taskwrite"

export const Input = Schema.Struct({
  tasks: Schema.Array(SessionTask.WriteInfo).annotate({
    description:
      "The full task list. Entries without an id are created with a stable tsk_ id; entries with an id are reconciled in place. Omitted entries are removed.",
  }),
})

export const Output = Schema.Struct({
  tasks: Schema.Array(SessionTask.Info),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => JSON.stringify(output.tasks, null, 2)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const tasks = yield* SessionTask.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Create and maintain a structured task list for the current session. Use it to track progress during multi-step work, keep task statuses current, and build the todo list a task delegation can later link to with parent_task_id.",
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
              const resolved = yield* tasks
                .update({ sessionID: context.sessionID, tasks: input.tasks })
                .pipe(
                  Effect.mapError((error) =>
                    error instanceof SessionTask.TaskWriteError
                      ? new ToolFailure({ message: error.message })
                      : new ToolFailure({ message: "Unable to update tasks" }),
                  ),
                )
              return { tasks: resolved }
            }).pipe(
              // Preserve the specific TaskWriteError message mapped above; only
              // wrap non-tool failures (permission, infrastructure) generically.
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to update tasks" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
