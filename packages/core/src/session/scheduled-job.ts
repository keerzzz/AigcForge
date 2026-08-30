export * as ScheduledJob from "./scheduled-job"

import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm"
import { Cause, Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { SchedulerCore } from "./schedule-core"
import { ScheduledJobExecutor } from "./scheduled-job-executor"
import { TaskTable } from "./sql"
import { SessionTask } from "./task"
import { nextRun } from "./schedule"
import { TaskDag } from "./dag"

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
export class ScheduledExecutor extends Context.Service<
  ScheduledExecutor,
  {
    readonly run: (input: {
      parentID: SessionSchema.ID
      agent?: string
      prompt: string
      taskID: string
    }) => Effect.Effect<ScheduledResult>
  }
>()("@aigcfroge/v2/ScheduledJobExecutor") {}

export interface Interface {
  /**
   * Rebuild the in-memory queue from the task table (startup re-arm). With
   * `recover: true` (startup only) a schedule-bearing `in_progress` row — a
   * stale claim left by a dead scheduler process — is reset to `pending` so the
   * job is re-queued instead of orphaned forever (differential-review HIGH-3).
   */
  readonly arm: (now: number, options?: { recover?: boolean }) => Effect.Effect<void>
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

    // The scan + claim + recovery loop is the shared SchedulerCore; this layer
    // only adapts it to TaskTable semantics (DAG gate, task.updated re-arm).
    const core = yield* SchedulerCore.make({
      scan: () =>
        db
          .select()
          .from(TaskTable)
          .where(or(isNotNull(TaskTable.scheduled_at), isNotNull(TaskTable.recurrence)))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.map((row) => ({ ...row, scheduledAt: row.scheduled_at }))),
          ),
      recover: (row) => tasks.patch({ sessionID: row.session_id, id: row.id, status: "pending" }).pipe(Effect.orDie),
      trigger: Effect.fn("ScheduledJob.trigger")(function* (taskID: string, now: number, rearm) {
        const row = yield* db.select().from(TaskTable).where(eq(TaskTable.id, taskID)).get().pipe(Effect.orDie)
        if (!row) return
        // Re-check status at trigger time: a task paused (or otherwise settled)
        // between arm and the due tick must not fire. Mirrors the arm filter.
        if (row.status !== "scheduled" && row.status !== "pending") return
        // DAG gate (M5 Step 3): a task with dependsOn may only fire once every
        // predecessor is terminal. A blocked task is left scheduled/pending (NOT
        // claimed) and re-evaluates when a task.updated re-arms the queue — a
        // deleted predecessor is released by blockedBy, so it cannot deadlock.
        const deps = row.depends_on ?? []
        const dagRows =
          deps.length === 0
            ? [row]
            : [row, ...(yield* db.select().from(TaskTable).where(inArray(TaskTable.id, deps)).all().pipe(Effect.orDie))]
        if (
          TaskDag.blockedBy(
            dagRows.map((item) => ({ id: item.id, status: item.status, dependsOn: item.depends_on ?? undefined })),
            taskID,
          ).length > 0
        ) {
          return
        }
        // Claim the task as in_progress BEFORE executing (B1 re-entry guard): the
        // daemon re-arms on any task.updated — including this very patch and the
        // child Session's own events — and would otherwise re-enqueue the
        // still-scheduled row and run the job twice concurrently. Once claimed,
        // both arm's filter and this guard skip it, and the settle below closes
        // the claim. The claim is conditional (expect) so a pause that lands
        // between the status re-check above and this patch aborts the run
        // instead of flipping a cancelled row back to in_progress.
        const claimed = yield* tasks
          .patch({ sessionID: row.session_id, id: row.id, status: "in_progress", expect: ["scheduled", "pending"] })
          .pipe(Effect.orDie)
        if (!claimed) return
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
            // Interrupt-only causes pass through untouched (mirroring the
            // executor seam's contract) so a draining runtime can still shut
            // down instead of persisting a spurious `failed` settle for the
            // in-flight job.
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) =>
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
        yield* tasks
          .patch({
            sessionID: row.session_id,
            id: row.id,
            status: result.outcome,
            outputDigest: digest,
          })
          .pipe(Effect.orDie)
        // Re-arm a successful recurring job to its next cron match.
        if (row.recurrence?.enabled && result.outcome === "completed") {
          const run = nextRun(row.recurrence.cron, now)
          if (run !== undefined) {
            rearm(run)
            // Re-arm via patch (not a raw db.update) so the task.updated event
            // payload matches the DB; omitting outputDigest preserves the digest
            // stored by the completed settle above. A vanished row is a no-op.
            yield* tasks
              .patch({
                sessionID: row.session_id,
                id: row.id,
                status: "scheduled",
              })
              .pipe(Effect.orDie)
          }
        }
      }),
    })

    return Service.of({ arm: core.arm, tick: core.tick })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(SessionTask.defaultLayer), Layer.provide(Database.defaultLayer))

/**
 * Production node: the runner rides the shared Database/EventV2/SessionTask
 * instances from the app graph (NOT `defaultLayer`, which embeds a private
 * EventV2 and would split `task.updated` onto a PubSub nobody else sees), plus
 * the TaskDriver-backed executor.
 */
export const node = LayerNode.make(layer, [Database.node, EventV2.node, SessionTask.node, ScheduledJobExecutor.node])

/**
 * Startup recovery for NON-scheduled rows: a process start means every
 * `in_progress` row without a schedule is a stale claim left by the dead
 * process (the single-process assumption of SessionTask's writeLock note). The
 * arm recover pass only rescans schedule-bearing rows, so these delegation/UI
 * claims would be orphaned forever; reset them to pending via patch (event +
 * revision bump) before the first arm.
 */
export const recoverStaleClaims = Effect.fn("ScheduledJob.recoverStaleClaims")(function* () {
  const { db } = yield* Database.Service
  const tasks = yield* SessionTask.Service
  const stale = yield* db
    .select()
    .from(TaskTable)
    .where(and(eq(TaskTable.status, "in_progress"), isNull(TaskTable.scheduled_at), isNull(TaskTable.recurrence)))
    .all()
    .pipe(Effect.orDie)
  for (const row of stale) {
    yield* tasks.patch({ sessionID: row.session_id, id: row.id, status: "pending" }).pipe(Effect.orDie)
  }
})

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
    yield* SchedulerCore.daemon({
      core: runner,
      startupSweep: recoverStaleClaims(),
      rearmSignals: events.subscribe(SessionTask.Event.Updated),
    })
  }),
)
export const daemonNode = LayerNode.make(daemonLayer, [node, Database.node, SessionTask.node, EventV2.node])
