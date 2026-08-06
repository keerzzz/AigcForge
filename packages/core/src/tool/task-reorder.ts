export * as TaskReorderTool from "./task-reorder"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task_reorder"

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
            "Reorder the session's task list by id. Provide the full id list in the new order. Use this instead of rewriting the full list with taskwrite when only the order changed.",
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
                .reorder({
                  sessionID: context.sessionID,
                  ids: input.ids,
                  expectedRevision: input.expectedRevision,
                })
                .pipe(
                  Effect.mapError((error) =>
                    error instanceof SessionTask.TaskWriteError
                      ? new ToolFailure({ message: error.message })
                      : new ToolFailure({ message: "Unable to reorder tasks" }),
                  ),
                )
              return { tasks: resolved }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to reorder tasks" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
