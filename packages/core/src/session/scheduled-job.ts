export * as ScheduledJob from "./scheduled-job"

import { eq, isNotNull, or } from "drizzle-orm"
import { Context, Effect, Layer, Schedule, Stream } from "effect"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { ScheduledJobExecutor } from "./scheduled-job-executor"
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
      // Re-check status at trigger time: a task paused (or otherwise settled)
      // between arm and the due tick must not fire. Mirrors the arm filter.
      if (row.status !== "scheduled" && row.status !== "pending") return
      // Claim the task as in_progress BEFORE executing (B1 re-entry guard): the
      // daemon re-arms on any task.updated — including this very patch and the
      // child Session's own events — and would otherwise re-enqueue the
      // still-scheduled row and run the job twice concurrently. Once claimed,
      // both arm's filter and this guard skip it, and the settle below closes
      // the claim.
      yield* tasks.patch({ sessionID: row.session_id, id: row.id, status: "in_progress" })
      const result = yield* executor
        .run({
          parentID: row.session_id,
          agent: row.agent_id ?? undefined,
          prompt: row.content,
          taskID: row.id,
        })
        .pipe(
          // An executor failure/defect settles this task failed instead of
          // aborting the whole tick and skipping the remaining due jobs.
          Effect.catchCause((cause) =>
            Effect.logError("Scheduled job executor failed", cause).pipe(
              Effect.as({ outcome: "failed" } satisfies ScheduledResult),
            ),
          ),
        )
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
          // Re-arm via patch (not a raw db.update) so the task.updated event
          // payload matches the DB; omitting outputDigest preserves the digest
          // stored by the completed settle above. A vanished row is a no-op.
          yield* tasks.patch({
            sessionID: row.session_id,
            id: row.id,
            status: "scheduled",
          })
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

/**
 * Production node: the runner rides the shared Database/EventV2/SessionTask
 * instances from the app graph (NOT `defaultLayer`, which embeds a private
 * EventV2 and would split `task.updated` onto a PubSub nobody else sees), plus
 * the TaskDriver-backed executor.
 */
export const node = LayerNode.make(layer, [Database.node, EventV2.node, SessionTask.node, ScheduledJobExecutor.node])

/**
 * Production daemon (M3b): arms the runner from the task table at startup
 * (survives restarts — the queue is always re-derived from the DB), ticks every
 * minute, and re-arms on every `task.updated` so a new schedule, resume, or
 * pause takes effect immediately instead of at the next process start. A
 * failing tick or re-arm is contained per iteration so it cannot kill the
 * daemon fibers.
 */
export const daemonLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const runner = yield* Service
    const events = yield* EventV2.Service
    yield* runner.arm(Date.now())
    yield* Effect.forkScoped(
      runner.tick(Date.now()).pipe(Effect.ignore, Effect.repeat(Schedule.spaced("1 minute"))),
    )
    yield* events.subscribe(SessionTask.Event.Updated).pipe(
      Stream.runForEach(() => runner.arm(Date.now()).pipe(Effect.ignore)),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
)
export const daemonNode = LayerNode.make(daemonLayer, [node, EventV2.node])
