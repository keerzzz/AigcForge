export * as TaskScheduleTool from "./taskschedule"

import { ToolFailure } from "@aigcfroge/llm"
import { Effect, Layer, Schema } from "effect"
import { SessionTask as SessionTaskSchema } from "@aigcfroge/schema/session-task"
import { PermissionV2 } from "../permission"
import { SessionTask } from "../session/task"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "task_schedule"

const ScheduleAction = Schema.Literals(["schedule", "pause", "resume", "remove"])

export const Input = Schema.Struct({
  tasks: Schema.Array(
    Schema.Struct({
      id: Schema.optional(Schema.String).annotate({
        description: "Existing task id for pause/resume/remove; absent for schedule.",
      }),
      content: Schema.optional(Schema.String).annotate({
        description: "Prompt the scheduled job runs (required for schedule).",
      }),
      scheduledAt: Schema.optional(Schema.Number).annotate({
        description: "Next trigger timestamp (ms) for a one-shot schedule.",
      }),
      recurrence: Schema.optional(SessionTaskSchema.TaskRecurrence).annotate({
        description: "Repetition rule (cron) for a recurring schedule.",
      }),
      agentID: Schema.optional(Schema.String).annotate({
        description: "Owning agent whose permissions pre-authorize the job's tools.",
      }),
      action: Schema.optional(ScheduleAction).annotate({
        description: "schedule (create), pause (cancel), resume (re-schedule), or remove a scheduled task.",
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
            "Create, pause, resume, or remove scheduled tasks. A scheduled task runs its content on a child session when the trigger time arrives (recurring jobs repeat per the cron rule) and settles back to the owning task.",
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
              const resolved: SessionTask.Info[] = []
              for (const entry of input.tasks) {
                const action = entry.action ?? "schedule"
                if (action === "schedule") {
                  const created = yield* tasks.append({
                    sessionID: context.sessionID,
                    tasks: [
                      {
                        content: entry.content ?? "",
                        status: "scheduled",
                        priority: "medium",
                        scheduledAt: entry.scheduledAt,
                        recurrence: entry.recurrence,
                        agentID: entry.agentID,
                      },
                    ],
                  })
                  resolved.push(...created)
                } else if (entry.id !== undefined) {
                  if (action === "pause" || action === "resume") {
                    const patched = yield* tasks.patch({
                      sessionID: context.sessionID,
                      id: entry.id,
                      status: action === "pause" ? "cancelled" : "scheduled",
                    })
                    if (patched) resolved.push(patched)
                  } else if (action === "remove") {
                    const current = yield* tasks.get(context.sessionID)
                    const kept = current.filter((task) => task.id !== entry.id)
                    const reconciled = yield* tasks.update({
                      sessionID: context.sessionID,
                      tasks: kept.map((task) => ({
                        id: task.id,
                        content: task.content,
                        status: task.status,
                        priority: task.priority,
                      })),
                    })
                    resolved.push(...reconciled)
                  }
                }
              }
              return { tasks: resolved }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure ? error : new ToolFailure({ message: "Unable to schedule tasks" }),
              ),
            ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
