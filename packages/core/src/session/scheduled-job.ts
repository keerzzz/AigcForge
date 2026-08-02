export * as ScheduledJob from "./scheduled-job"

import { eq, isNotNull, or } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { SessionSchema } from "./schema"
import { TaskTable } from "./sql"
import { SessionTask } from "./task"
import { nextRun } from "./schedule"

/**
 * M3 single-process, in-memory, minute-level cron scheduler (plan §8 M3 + §10).
 * `arm` rescans the task table and rebuilds the next-run queue (startup re-arm
 * survives a process restart because the queue is always derived from the DB,
 * never carried in memory); `tick` triggers due jobs and settles each task.
 *
 * Every trigger path settles the owning task (completed / failed / cancelled) —
 * no orphan `in_progress`. Recurring jobs that complete are re-armed to their
 * next cron match and returned to `scheduled`.
 */

/** Terminal outcome of one scheduled job trigger. */
export type ScheduledOutcome = "completed" | "failed" | "cancelled"

export interface ScheduledResult {
  readonly outcome: ScheduledOutcome
  /** Child session id on success, used as the task's output digest. */
  readonly childSessionID?: SessionSchema.ID
}

/**
 * Delegation seam. The real executor (wired by the server layer, M3b) creates an
 * unattended child Session under the parent and drives the task's prompt through
 * it; tests install a stub. Mirrors the TaskDriver module seam so the scheduler
 * stays dependency-free at the trigger boundary.
 */
export class ScheduledExecutor extends Context.Service<ScheduledExecutor, {
  readonly run: (input: {
    parentID: SessionSchema.ID
    agent?: string
    prompt: string
    taskID: string
  }) => Effect.Effect<ScheduledResult>
}>()("@aigcfroge/v2/ScheduledJobExecutor") {}

export interface Interface {
  /** Rebuild the in-memory queue from the task table (startup re-arm). */
  readonly arm: (now: number) => Effect.Effect<void>
  /** Trigger every queued job whose next run has arrived; settle + re-arm. */
  readonly tick: (now: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ScheduledJobRunner") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const tasks = yield* SessionTask.Service
    const executor = yield* ScheduledExecutor

    let queue = new Map<string, number>()

    const arm = Effect.fn("ScheduledJob.arm")(function* (now: number) {
      const rows = yield* db
        .select()
        .from(TaskTable)
        .where(or(isNotNull(TaskTable.scheduled_at), isNotNull(TaskTable.recurrence)))
        .all()
        .pipe(Effect.orDie)
      const next = new Map<string, number>()
      for (const row of rows) {
        if (row.status !== "scheduled" && row.status !== "pending") continue
        const run = row.recurrence?.enabled ? nextRun(row.recurrence.cron, now) : row.scheduled_at
        if (run !== undefined && run !== null) next.set(row.id, run)
      }
      queue = next
    })

    const trigger = Effect.fn("ScheduledJob.trigger")(function* (taskID: string, now: number) {
      const row = yield* db.select().from(TaskTable).where(eq(TaskTable.id, taskID)).get().pipe(Effect.orDie)
      if (!row) return
      const result = yield* executor.run({
        parentID: row.session_id,
        agent: row.agent_id ?? undefined,
        prompt: row.content,
        taskID: row.id,
      })
      const digest =
        result.outcome === "completed"
          ? (result.childSessionID ?? "scheduled job completed")
          : result.outcome === "failed"
            ? "scheduled job failed"
            : "scheduled job cancelled"
      yield* tasks.patch({
        sessionID: row.session_id,
        id: row.id,
        status: result.outcome,
        outputDigest: digest,
      })
      // Re-arm a successful recurring job to its next cron match.
      if (row.recurrence?.enabled && result.outcome === "completed") {
        const run = nextRun(row.recurrence.cron, now)
        if (run !== undefined) {
          queue.set(row.id, run)
          yield* db
            .update(TaskTable)
            .set({ status: "scheduled", time_updated: now })
            .where(eq(TaskTable.id, row.id))
            .run()
            .pipe(Effect.orDie)
        }
      }
    })

    const tick = Effect.fn("ScheduledJob.tick")(function* (now: number) {
      const due = [...queue.entries()].filter(([, run]) => run <= now)
      for (const [taskID] of due) {
        queue.delete(taskID)
        yield* trigger(taskID, now)
      }
    })

    return Service.of({ arm, tick })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(SessionTask.defaultLayer),
  Layer.provide(Database.defaultLayer),
)
