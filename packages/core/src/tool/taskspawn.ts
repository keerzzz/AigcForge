export * as TaskSpawnTool from "./taskspawn.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { Effect, Schema } from "effect"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { Permission } from "../permission.js"
import { SessionTask } from "../session/task.js"

export const name = "task_spawn"

export const description =
  "Record a derived task from the current delegation: the task captures the originating message (spawnedFrom), optional DAG predecessors (dependsOn), and the owning agent. This milestone only records the task — it does not spawn an agent or run the content. To trigger execution later, attach a schedule via task_schedule or PATCH."

export const Input = Schema.Struct({
  tasks: Schema.Array(
    Schema.Struct({
      content: Schema.String.annotate({
        description:
          "Content of the derived task. This milestone only RECORDS the task for the Agent Hub — it does not spawn an agent or execute the prompt. To trigger execution, attach a schedule (task_schedule or PATCH with scheduledAt/recurrence).",
      }),
      priority: Schema.optional(SessionTaskSchema.TaskPriority),
      dependsOn: Schema.optional(Schema.Array(Schema.String)).annotate({
        description: "Predecessor task ids; this task waits until they complete.",
      }),
      agentID: Schema.optional(Schema.String).annotate({
        description: "Owning agent for the spawned task.",
      }),
    }),
  ),
})

export const Output = Schema.Struct({
  tasks: Schema.Array(SessionTask.Info),
})

const toModelContent = (tasks: ReadonlyArray<SessionTask.Info>) => JSON.stringify(tasks, null, 2)

export const Plugin = {
  id: "aigcfroge.tool.task_spawn",
  effect: Effect.fn("TaskSpawnTool.Plugin")(function* (ctx: Context) {
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
                    .append({
                      sessionID: context.sessionID,
                      tasks: input.tasks.map((task) => ({
                        content: task.content,
                        status: "pending",
                        priority: task.priority ?? "medium",
                        spawnedFrom: context.messageID,
                        dependsOn: task.dependsOn,
                        agentID: task.agentID,
                      })),
                    })
                    .pipe(
                      Effect.mapError((error) =>
                        error instanceof SessionTask.TaskWriteError
                          ? new ToolFailure({ message: error.message })
                          : new ToolFailure({ message: "Unable to spawn tasks" }),
                      ),
                      Effect.map((spawned) => ({
                        output: { tasks: spawned },
                        content: toModelContent(spawned),
                      })),
                    ),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
