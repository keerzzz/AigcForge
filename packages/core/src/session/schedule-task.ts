export * as ScheduleTask from "./schedule-task.js"

import { and, eq } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { Agent } from "@aigcfroge/schema/agent"
import { Schedule } from "@aigcfroge/schema/schedule"
import type { Database } from "../database/database.js"
import type { SessionSchema } from "./schema.js"
import { TaskTable } from "./sql.js"
import { ScheduleTable } from "./schedule.sql.js"
import { nextRun } from "./schedule.js"

type WriteDatabase = Pick<Database.Interface["db"], "select" | "insert" | "update">
type TaskRow = typeof TaskTable.$inferSelect

export const idFor = (taskID: string) =>
  Schedule.ID.make(`sch_task_${createHash("sha256").update(taskID).digest("hex")}`)

/** Runs inside the original Task write transaction and never acquires the Task lock. */
export const sync = Effect.fn("ScheduleTask.sync")(function* (
  db: WriteDatabase,
  input: { readonly sessionID: SessionSchema.ID; readonly now: number; readonly previous?: readonly TaskRow[]; readonly execution?: boolean },
) {
  const tasks = yield* db.select().from(TaskTable).where(eq(TaskTable.session_id, input.sessionID)).all().pipe(Effect.orDie)
  const rules = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.session_id, input.sessionID)).all().pipe(Effect.orDie)
  const previous = new Map(input.previous?.map((task) => [task.id, task]))
  const byTask = new Map(rules.flatMap((rule) => rule.task_id ? [[rule.task_id, rule] as const] : []))
  const retained = new Set(tasks.map((task) => task.id))

  for (const rule of rules) {
    if (!rule.task_id || retained.has(rule.task_id) || rule.status === "cancelled") continue
    yield* db.update(ScheduleTable).set({ status: "cancelled", revision: rule.revision + 1, next_due_at: null, time_updated: input.now })
      .where(eq(ScheduleTable.id, rule.id)).run().pipe(Effect.orDie)
  }

  for (const task of tasks) {
    const rule = byTask.get(task.id)
    const prior = previous.get(task.id)
    if (!rule) {
      if (task.scheduled_at === null && task.recurrence === null) continue
      const due = task.recurrence?.enabled
        ? nextRun(task.recurrence.cron, input.now, task.recurrence.timezone)
        : task.scheduled_at ?? undefined
      const status = task.status === "in_progress" ? "paused" as const
        : task.status === "cancelled" ? "paused" as const
        : !task.recurrence?.enabled && (task.status === "completed" || task.status === "failed") ? task.status
        : "pending" as const
      yield* db.insert(ScheduleTable).values({
        id: idFor(task.id), session_id: input.sessionID, kind: "task", content: task.content,
        due_at: task.scheduled_at ?? due ?? input.now,
        timezone: task.recurrence?.timezone ?? DateTime.zoneMakeLocal().id,
        status, revision: 1, recurrence: task.recurrence,
        target: Schema.encodeSync(Schedule.LegacyChildTarget)(new Schedule.LegacyChildTarget({
          policy: "legacy_child", agentID: task.agent_id ? Agent.ID.make(task.agent_id) : undefined,
        })),
        execution_policy: { delivery: "queue", missed: "catch_up" },
        task_id: task.id,
        last_error: task.status === "in_progress"
          ? { code: "legacy_execution_unresolved", message: "The original Task execution must be reconciled before scheduling" } : null,
        next_due_at: status === "pending" ? due ?? null : null,
        delivery_key: `task:${input.sessionID}:${task.id}`,
        time_created: task.time_created, time_updated: input.now,
      }).onConflictDoNothing().run().pipe(Effect.orDie)
      continue
    }
    if (!prior) continue
    const contentChanged = task.content !== prior.content
    const triggerChanged = task.scheduled_at !== prior.scheduled_at ||
      task.recurrence?.cron !== prior.recurrence?.cron || task.recurrence?.enabled !== prior.recurrence?.enabled ||
      task.recurrence?.timezone !== prior.recurrence?.timezone
    const executorChanged = task.agent_id !== prior.agent_id && rule.target?.policy === "legacy_child"
    const statusChanged = task.status !== prior.status
    if (!contentChanged && !triggerChanged && !executorChanged && !statusChanged) continue
    const recurrence = triggerChanged ? task.recurrence : rule.recurrence
    const recoveredLegacy = input.execution && rule.last_error?.code === "legacy_execution_unresolved" &&
      statusChanged && task.status !== "in_progress"
    const explicitPause = !input.execution && statusChanged && task.status === "cancelled"
    const explicitResume = !input.execution && statusChanged && task.status === "scheduled"
    const status = recoveredLegacy ? recurrence?.enabled ? "pending"
      : task.status === "completed" || task.status === "failed" ? task.status : "cancelled"
      : explicitPause ? rule.status === "cancelled" ? "cancelled" : "paused"
      : explicitResume ? "pending"
      : rule.status === "paused" || rule.status === "cancelled" ? rule.status
      : !input.execution && !recurrence?.enabled && statusChanged && (task.status === "completed" || task.status === "failed") ? task.status
      : rule.status === "running" ? "pending" : rule.status
    const revised = contentChanged || triggerChanged || executorChanged || explicitPause || explicitResume
    const due = triggerChanged || explicitResume || recoveredLegacy
      ? recurrence?.enabled ? nextRun(recurrence.cron, input.now, recurrence.timezone) : task.scheduled_at ?? undefined
      : rule.next_due_at ?? undefined
    yield* db.update(ScheduleTable).set({
      ...(contentChanged ? { content: task.content } : {}),
      ...(triggerChanged ? { due_at: task.scheduled_at ?? due ?? rule.due_at, recurrence, timezone: recurrence?.timezone ?? rule.timezone } : {}),
      ...(executorChanged ? { target: Schema.encodeSync(Schedule.LegacyChildTarget)(new Schedule.LegacyChildTarget({
        policy: "legacy_child", agentID: task.agent_id ? Agent.ID.make(task.agent_id) : undefined,
      })) } : {}),
      status, revision: rule.revision + (revised ? 1 : 0),
      ...(recoveredLegacy ? { last_error: null } : {}),
      next_due_at: status === "pending" ? due ?? null : null,
      time_updated: input.now,
    }).where(and(eq(ScheduleTable.id, rule.id), eq(ScheduleTable.revision, rule.revision))).run().pipe(Effect.orDie)
  }
})

/** Schedule owns nextDue even while the anchor shows the latest completed run. */
export const nextRuns = Effect.fn("ScheduleTask.nextRuns")(function* (db: WriteDatabase, sessionID: SessionSchema.ID) {
  const rules = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.session_id, sessionID)).all().pipe(Effect.orDie)
  return new Map(rules.flatMap((rule) => rule.task_id
    ? [[rule.task_id, { scheduleID: rule.id, nextRun: rule.status === "pending" ? rule.next_due_at ?? undefined : undefined }] as const]
    : []))
})
