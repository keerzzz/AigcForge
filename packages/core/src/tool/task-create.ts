export * as TaskCreateTool from "./task-create"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task_create"

export const Input = Schema.Struct({
  tasks: Schema.Array(SessionTask.WriteInfo).annotate({
    description:
      "New tasks to append to the end of the session's list. Entries without an id are minted a stable tsk_ id.",
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
            "Append one or more tasks to the end of the current session's task list. Use this for incremental additions instead of rewriting the full list with taskwrite.",
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
                .append({ sessionID: context.sessionID, tasks: input.tasks })
                .pipe(
                  Effect.mapError((error) =>
                    error instanceof SessionTask.TaskWriteError
                      ? new ToolFailure({ message: error.message })
                      : new ToolFailure({ message: "Unable to create tasks" }),
                  ),
                )
              return { tasks: resolved }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to create tasks" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
