export * as TaskSpawnTool from "./taskspawn"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { PermissionV2 } from "../permission"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task_spawn"

export const Input = Schema.Struct({
  tasks: Schema.Array(
    Schema.Struct({
      content: Schema.String.annotate({ description: "Prompt the spawned agent runs." }),
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
            "Spawn a derived task from the current delegation: the task records the originating message and optional DAG predecessors (dependsOn), and the owning agent.",
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
              const spawned = yield* tasks.append({
                sessionID: context.sessionID,
                tasks: input.tasks.map((task) => ({
                  content: task.content,
                  status: "pending",
                  priority: task.priority ?? "medium",
                  spawnedFrom: context.assistantMessageID,
                  dependsOn: task.dependsOn,
                  agentID: task.agentID,
                })),
              })
              return { tasks: spawned }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: error.message }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
