export * as TaskDeleteTool from "./task-delete"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task_delete"

export const Input = Schema.Struct({
  id: Schema.String.annotate({ description: "The task id to delete." }),
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
            "Delete a single task by id. Other tasks are untouched. Use this for incremental removals instead of rewriting the full list with taskwrite.",
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
              // removeTask has no typed error channel (only defects), so no
              // TaskWriteError mapError is needed; undefined means "not found".
              const deleted = yield* tasks.removeTask({ sessionID: context.sessionID, id: input.id })
              if (!deleted) return yield* new ToolFailure({ message: `Task ${input.id} not found` })
              const remaining = yield* tasks.get(context.sessionID)
              return { tasks: remaining }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to delete task" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
