export * as TodoWriteTool from "./todowrite.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { Permission } from "../permission.js"
import { SessionTodo } from "../session/todo.js"

export const name = "todowrite"

export const description =
  "Create and maintain a structured task list for the current coding session. Use it to track progress during multi-step work and keep todo statuses current."

export const Input = Schema.Struct({
  todos: Schema.Array(SessionTodo.WriteItem).annotate({ description: "The updated todo list" }),
})

export const Output = Schema.Struct({
  todos: Schema.Array(SessionTodo.Info),
})

const toModelContent = (todos: ReadonlyArray<SessionTodo.Info>) => JSON.stringify(todos, null, 2)

export const Plugin = {
  id: "aigcfroge.tool.todowrite",
  effect: Effect.fn("TodoWriteTool.Plugin")(function* (ctx: Context) {
    const todos = yield* SessionTodo.Service
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
                    const updated = yield* todos.update(
                      { sessionID: context.sessionID, todos: input.todos },
                      { management: { type: "tool", messageID: context.messageID, id: context.id } },
                    )
                    return { output: { todos: updated }, content: toModelContent(updated) }
                  }).pipe(
                    // A stale write hands the model the server's current list so it can
                    // merge its changes and retry; every other reason already carries
                    // a readable message.
                    Effect.catchTag("SessionTask.TaskWriteError", (error) =>
                      error.reason === "stale_revision"
                        ? todos.get(context.sessionID).pipe(
                            Effect.flatMap((current) =>
                              Effect.fail(
                                new ToolFailure({
                                  message: `${error.message}\nCurrent server-side todo list:\n${JSON.stringify(current, null, 2)}\nMerge your changes into this list and retry.`,
                                }),
                              ),
                            ),
                          )
                        : Effect.fail(new ToolFailure({ message: error.message })),
                    ),
                  ),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
