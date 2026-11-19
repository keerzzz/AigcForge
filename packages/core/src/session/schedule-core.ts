export * as SchedulerCore from "./schedule-core"

import { DateTime, Effect, Schedule, Stream } from "effect"
import type { Scope } from "effect"
import { nextRun } from "./schedule"

/**
 * The shared scan, deadline and tick mechanism. Schedule owns rules and
 * occurrences; adapters own durable claims, admission and settlement.
 *
 * `arm` rescans eligible rows and retains the deadline of an unchanged schedule.
 * A fresh process derives its queue from the table; `tick` triggers every queued row whose run
 * has arrived. The row shape and the claim/settle mechanics stay with the
 * owning table through the adapters.
 */

/** The minimal row view the core needs to build the next-run queue. */
export interface ScheduleRowLike {
  readonly id: string
  readonly status: string
  readonly scheduledAt?: number | null
  readonly recurrence?: { enabled: boolean; cron: string; timezone?: string } | null
  /** Authoritative persisted due time; recurrence search is only a legacy fallback. */
  readonly nextDueAt?: number | null
}

export interface Adapters<Row extends ScheduleRowLike> {
  /** Scan schedule-bearing rows (normalized to the core row view). */
  readonly scan: () => Effect.Effect<readonly Row[]>
  /**
   * Startup recovery for a stale `in_progress` claim (arm recover pass only):
   * a process start means any schedule-bearing in_progress row is a stale
   * claim from a dead scheduler. Only the startup arm calls this; the plain
   * re-arm must not touch a live claim of a running job (that would
   * re-enqueue and double-run).
   */
  readonly recover: (row: Row) => Effect.Effect<void>
  /**
   * Trigger one due row (fresh status re-check, claim, execute, settle).
   * `rearm(run)` re-queues the row in-memory for its next run (recurring
   * jobs); the adapter computes the next run itself. The id keeps the
   * owning table's brand (`Row["id"]`) so adapters never re-assert it.
   */
  readonly trigger: (id: Row["id"], now: number, rearm: (run: number) => void) => Effect.Effect<void>
}

export interface Interface {
  /** Rebuild the in-memory queue from the table (startup re-arm). */
  readonly arm: (now: number, options?: { recover?: boolean }) => Effect.Effect<void>
  /** Trigger every queued row whose run has arrived. */
  readonly tick: (now: number) => Effect.Effect<void>
}

export const make = <Row extends ScheduleRowLike>(adapters: Adapters<Row>): Effect.Effect<Interface> =>
  Effect.gen(function* () {
    let queue = new Map<Row["id"], { run: number; schedule: string }>()

    const arm = Effect.fn("SchedulerCore.arm")((now: number, options?: { recover?: boolean }) =>
      Effect.gen(function* () {
        const rows = yield* adapters.scan()
        const next = new Map<Row["id"], { run: number; schedule: string }>()
        for (const row of rows) {
          let status = row.status
          if (options?.recover && status === "in_progress") {
            yield* adapters.recover(row)
            status = "pending"
          }
          if (status !== "scheduled" && status !== "pending") continue
          const schedule = JSON.stringify(
            row.recurrence?.enabled
              ? ["recurrence", row.recurrence.cron, row.recurrence.timezone, row.nextDueAt]
              : ["once", row.scheduledAt, row.nextDueAt],
          )
          const previous = queue.get(row.id)

          // A scan must not move an unchanged due job into its following recurrence.
          if (previous?.schedule === schedule) {
            next.set(row.id, previous)
            continue
          }

          const run =
            row.nextDueAt ??
            (row.recurrence?.enabled
              ? nextRun(row.recurrence.cron, now, row.recurrence.timezone)
              : (row.scheduledAt ?? undefined))
          if (run !== undefined && run !== null) next.set(row.id, { run, schedule })
        }
        queue = next
      }),
    )

    const tick = Effect.fn("SchedulerCore.tick")((now: number) =>
      Effect.gen(function* () {
        const due = [...queue.entries()].filter(([, entry]) => entry.run <= now)
        for (const [id, entry] of due) {
          if (queue.get(id) !== entry) continue

          queue.delete(id)
          yield* adapters.trigger(id, now, (run) => {
            queue.set(id, { run, schedule: entry.schedule })
          })
        }
      }),
    )

    return { arm, tick }
  })

/**
 * The host daemon arms the core from persisted rules at startup, ticks every
 * minute, and re-arms on every rearm signal so a new schedule takes effect
 * immediately instead of at the next process start. A failing tick or re-arm
 * is contained per iteration so it cannot kill the daemon fibers.
 */
export const daemon = <R = never>(input: {
  readonly core: Interface
  /** Stream of re-arm signals (e.g. the table's update event). */
  readonly rearmSignals: Stream.Stream<unknown>
  /** Optional startup sweep that must run before the first arm (uncontained). */
  readonly startupSweep?: Effect.Effect<void, never, R>
}): Effect.Effect<void, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    if (input.startupSweep) yield* input.startupSweep
    yield* input.core.arm((yield* DateTime.nowAsDate).getTime(), { recover: true }).pipe(Effect.ignore)
    // Each minute cycle re-derives the queue from the table (arm) BEFORE
    // triggering (tick), so a due row can never be stranded by a missed
    // re-arm event — e.g. tool-path writes publishing on a different EventV2
    // instance than this daemon subscribes to (review MAJOR #3). The event
    // re-arm below stays as a fast-path optimization, never as the only path.
    const scope = yield* Effect.scope
    yield* Effect.forkIn(scope)(
      Effect.gen(function* () {
        yield* input.core.arm((yield* DateTime.nowAsDate).getTime()).pipe(
          // Defect-containment (review MAJOR): arm/tick have error channel
          // `never`, so Effect.ignore would swallow the whole cause INCLUDING
          // defects. catchDefect is kept so a fault is logged (contained), not
          // silently swallowed — a defect would otherwise abort the repeat and
          // permanently kill the tick fiber.
          Effect.catchDefect((defect) => Effect.logError("Scheduler arm defect contained", defect)),
        )
        yield* input.core
          .tick((yield* DateTime.nowAsDate).getTime())
          .pipe(Effect.catchDefect((defect) => Effect.logError("Scheduler tick defect contained", defect)))
      }).pipe(Effect.repeat(Schedule.spaced("1 minute"))),
    )
    yield* input.rearmSignals.pipe(
      Stream.runForEach(() =>
        Effect.gen(function* () {
          yield* input.core
            .arm((yield* DateTime.nowAsDate).getTime())
            .pipe(Effect.catchDefect((defect) => Effect.logError("Scheduler re-arm defect contained", defect)))
        }),
      ),
      Effect.forkIn(scope, { startImmediately: true }),
    )
  })
