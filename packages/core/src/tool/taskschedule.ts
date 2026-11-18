export * as TaskScheduleTool from "./taskschedule.js"

import type { Context } from "@aigcfroge/plugin/effect/plugin"
import { ToolFailure } from "@aigcfroge/ai"
import { DateTime, Effect, Schema } from "effect"
import { TaskRecurrence } from "@aigcfroge/schema/session-task"
import { Permission } from "../permission.js"
import { nextRun } from "../session/schedule.js"
import { SessionTask } from "../session/task.js"

export const name = "task_schedule"

const ScheduleAction = Schema.Literals(["schedule", "pause", "resume", "remove"])

export const description =
  "Create, pause, resume, or remove scheduled tasks. A scheduled task runs its content on a child session when the trigger time arrives (recurring jobs repeat per the cron rule) and settles back to the owning task."

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
      recurrence: Schema.optional(TaskRecurrence).annotate({
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

const toModelContent = (tasks: ReadonlyArray<SessionTask.Info>) => JSON.stringify(tasks, null, 2)

export const Plugin = {
  id: "aigcfroge.tool.task_schedule",
  effect: Effect.fn("TaskScheduleTool.Plugin")(function* (ctx: Context) {
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
                  Effect.gen(function* () {
                    const resolved: SessionTask.Info[] = []
                    for (const entry of input.tasks) {
                      const action = entry.action ?? "schedule"
                      if (action !== "schedule") {
                        if (entry.id === undefined) {
                          return yield* Effect.fail(
                            new ToolFailure({
                              message: `task_schedule: ${action} requires the id of an existing task`,
                            }),
                          )
                        }
                        if (action === "remove") {
                          // Atomic single-task delete (differential-review HIGH-2): a
                          // read-modify-reconcile here would drop any task appended
                          // between the `get` snapshot and the `update` — core supports
                          // concurrent appends in the same provider turn, so the old
                          // window was reachable. removeTask touches only the named row.
                          const removed = yield* tasks.removeTask({
                            sessionID: context.sessionID,
                            id: entry.id,
                          })
                          if (removed) resolved.push(removed)
                          continue
                        }
                        const patched = yield* tasks.patch({
                          sessionID: context.sessionID,
                          id: entry.id,
                          status: action === "pause" ? "cancelled" : "scheduled",
                        })
                        if (patched) resolved.push(patched)
                        continue
                      }
                      const content = entry.content?.trim()
                      if (!content) {
                        return yield* Effect.fail(
                          new ToolFailure({
                            message: "task_schedule: schedule requires a non-empty content prompt",
                          }),
                        )
                      }
                      if (entry.scheduledAt === undefined && entry.recurrence === undefined) {
                        // Without a trigger the arm scan can never pick the row
                        // up — reject the dead job instead of persisting it.
                        return yield* Effect.fail(
                          new ToolFailure({
                            message:
                              "task_schedule: schedule requires scheduledAt (one-shot) or recurrence (cron); a job without a trigger can never run",
                          }),
                        )
                      }
                      if (
                        entry.recurrence !== undefined &&
                        !entry.recurrence.enabled &&
                        entry.scheduledAt === undefined
                      ) {
                        // A disabled recurrence is not a trigger, so the same
                        // dead-job rule applies when no one-shot fallback is set.
                        return yield* Effect.fail(
                          new ToolFailure({
                            message:
                              "task_schedule: recurrence is disabled and scheduledAt is unset; a job without a trigger can never run",
                          }),
                        )
                      }
                      // The arm scan prefers an enabled recurrence over scheduledAt,
                      // so a cron that yields no future run is a dead job even when
                      // scheduledAt is set. nextRun retains the existing dialect
                      // and AND day rule while Effect Cron bounds calendar search:
                      // impossible dates or invalid named timezones are rejected.
                      if (entry.recurrence?.enabled) {
                        const now = (yield* DateTime.nowAsDate).getTime()
                        if (nextRun(entry.recurrence.cron, now, entry.recurrence.timezone) === undefined) {
                          return yield* Effect.fail(
                            new ToolFailure({
                              message: `task_schedule: recurrence cron "${entry.recurrence.cron}" is invalid or has no future run; refusing to persist a dead job`,
                            }),
                          )
                        }
                      }
                      const created = yield* tasks.append({
                        sessionID: context.sessionID,
                        tasks: [
                          {
                            content,
                            status: "scheduled",
                            priority: "medium",
                            scheduledAt: entry.scheduledAt,
                            recurrence: entry.recurrence,
                            agentID: entry.agentID,
                          },
                        ],
                      })
                      // append resolves the FULL session list (see SessionTask.append),
                      // so spreading it here would duplicate the whole list per entry.
                      // The row this entry appended is always the last position.
                      const task = created.at(-1)
                      if (task) resolved.push(task)
                    }
                    return { output: { tasks: resolved }, content: toModelContent(resolved) }
                  }).pipe(
                    // Preserve the specific TaskWriteError message (foreign/duplicate
                    // id) instead of collapsing it into the generic fallback.
                    Effect.mapError((error) =>
                      error instanceof SessionTask.TaskWriteError ? new ToolFailure({ message: error.message }) : error,
                    ),
                  ),
                ),
              ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
