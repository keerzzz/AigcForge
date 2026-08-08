export * as TodoWriteTool from "./todowrite"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { SessionTodo } from "../session/todo"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "todowrite"

export const Input = Schema.Struct({
  todos: Schema.Array(SessionTodo.WriteItem).annotate({ description: "The updated todo list" }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) => JSON.stringify(output.todos, null, 2)

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const todos = yield* SessionTodo.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Create and maintain a structured task list for the current coding session. Use it to track progress during multi-step work and keep todo statuses current.",
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
              const updated = yield* todos.update({ sessionID: context.sessionID, todos: input.todos })
              return { todos: updated }
            }).pipe(
              Effect.catchTag("SessionTask.TaskWriteError", (error) =>
                Effect.gen(function* () {
                  // Option B: a stale write hands the model the server's current
                  // list so it can merge its changes and retry; every other
                  // reason already carries a readable message.
                  const message =
                    error.reason === "stale_revision"
                      ? `${error.message}\nCurrent server-side todo list:\n${JSON.stringify(yield* todos.get(context.sessionID), null, 2)}\nMerge your changes into this list and retry.`
                      : error.message
                  return yield* new ToolFailure({ message, error })
                }),
              ),
              // A permission denial keeps its own identity instead of
              // degrading to the generic fallback (TaggedErrorClass message is
              // empty here, so fall back to the tag); only an error with
              // neither degrades to it.
              Effect.mapError(
                (error) => new ToolFailure({ message: error.message || error._tag || "Unable to update todos", error }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
