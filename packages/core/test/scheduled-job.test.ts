import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { ScheduledJob } from "@aigcfroge/core/session/scheduled-job"
import { SessionTask } from "@aigcfroge/core/session/task"
import { testEffect } from "./lib/effect"

const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

const sessionID = SessionV2.ID.make("ses_schedule_test")

type Call = { parentID: string; agent?: string; prompt: string; taskID: string }
const holder: { calls: Call[]; result: ScheduledJob.ScheduledResult; dieFor?: string } = {
  calls: [],
  result: { outcome: "completed", childSessionID: SessionV2.ID.make("ses_child") },
}
const stubExecutor = Layer.succeed(
  ScheduledJob.ScheduledExecutor,
  ScheduledJob.ScheduledExecutor.of({
    run: (input) =>
      // `dieFor` makes the executor raise a defect for the matching prompt so
      // tests can exercise the tick-level failure containment.
      holder.dieFor === input.prompt
        ? Effect.die("executor defect")
        : Effect.sync(() => {
            holder.calls.push(input)
            return holder.result
          }),
  }),
)

const it = testEffect(
  ScheduledJob.layer.pipe(
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(SessionTask.defaultLayer),
    Layer.provideMerge(stubExecutor),
  ),
)

const setup = Effect.gen(function* () {
  holder.calls = []
  holder.result = { outcome: "completed", childSessionID: SessionV2.ID.make("ses_child") }
  holder.dieFor = undefined
  const { db } = yield* Database.Service
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: "schedule",
      directory: "/project",
      title: "schedule",
      version: "test",
    })
    .run()
    .pipe(Effect.orDie)
})

const registerScheduled = Effect.gen(function* () {
  const tasks = yield* SessionTask.Service
  return yield* tasks.append({
    sessionID,
    tasks: [{ content: "daily audit", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 9, 0) }],
  })
})

describe("ScheduledJobRunner", () => {
  it.effect("a due one-shot task triggers the executor and settles completed with the child digest", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const runner = yield* ScheduledJob.Service
      const [task] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 9, 0) }],
      })

      yield* runner.arm(at(2026, 8, 2, 8, 59))
      // Not yet due.
      yield* runner.tick(at(2026, 8, 2, 8, 59))
      expect(holder.calls).toHaveLength(0)

      // Due at 09:00.
      yield* runner.tick(at(2026, 8, 2, 9, 0))
      expect(holder.calls).toHaveLength(1)
      expect(holder.calls[0]).toMatchObject({ parentID: sessionID, prompt: "audit", taskID: task.id })

      const settled = yield* tasks.get(sessionID)
      expect(settled[0]?.status).toBe("completed")
      expect(settled[0]?.outputDigest).toBe("ses_child")
    }),
  )

  it.effect("a failed trigger settles the task failed with a fixed digest", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const runner = yield* ScheduledJob.Service
      yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 9, 0) }],
      })
      holder.result = { outcome: "failed" }

      yield* runner.arm(at(2026, 8, 2, 8, 59))
      yield* runner.tick(at(2026, 8, 2, 9, 0))

      const settled = yield* tasks.get(sessionID)
      expect(settled[0]?.status).toBe("failed")
      expect(settled[0]?.outputDigest).toBe("scheduled job failed")
    }),
  )

  it.effect("a recurring task re-arms to its next cron match after completing", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const runner = yield* ScheduledJob.Service
      const events = yield* EventV2.Service
      const published = new Array<EventV2.Payload>()
      const unsubscribe = yield* events.listen((event) =>
        Effect.sync(() => {
          if (event.type === SessionTask.Event.Updated.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      yield* tasks.append({
        sessionID,
        tasks: [
          {
            content: "tick",
            status: "scheduled",
            priority: "low",
            recurrence: { cron: "*/5 * * * *", enabled: true },
          },
        ],
      })

      yield* runner.arm(at(2026, 8, 2, 9, 1))
      // Next cron match after 09:01 is 09:05.
      yield* runner.tick(at(2026, 8, 2, 9, 5))
      expect(holder.calls).toHaveLength(1)

      const after = yield* tasks.get(sessionID)
      // Recurring job returns to scheduled, waiting for the next run.
      expect(after[0]?.status).toBe("scheduled")

      // The re-arm goes through SessionTask.patch, so the last task.updated
      // payload agrees with the DB (scheduled) and keeps the completed digest.
      const last = published.at(-1)
      expect(last).toBeDefined()
      const data = Schema.decodeUnknownSync(SessionTask.Event.Updated.data)(last!.data)
      expect(data.tasks[0]?.status).toBe("scheduled")
      expect(data.tasks[0]?.status).toBe(after[0]?.status)
      expect(data.tasks[0]?.outputDigest).toBe("ses_child")
      expect(after[0]?.outputDigest).toBe("ses_child")

      // The re-armed queue fires again at 09:10 (strictly after 09:05).
      yield* runner.tick(at(2026, 8, 2, 9, 10))
      expect(holder.calls).toHaveLength(2)
    }),
  )

  it.effect("a task paused after arming does not trigger the executor", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const runner = yield* ScheduledJob.Service
      const [task] = yield* registerScheduled

      yield* runner.arm(at(2026, 8, 2, 8, 59))
      // Pause lands between arm and the due tick.
      yield* tasks.patch({ sessionID, id: task.id, status: "cancelled" })

      yield* runner.tick(at(2026, 8, 2, 9, 0))
      expect(holder.calls).toHaveLength(0)

      const settled = yield* tasks.get(sessionID)
      expect(settled[0]?.status).toBe("cancelled")
    }),
  )

  it.effect("an executor defect settles the task failed and does not skip later due jobs", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const runner = yield* ScheduledJob.Service
      const [bad] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "bad", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 9, 0) }],
      })
      // append returns the full table, so the new row is the last entry.
      const good = (yield* tasks.append({
        sessionID,
        tasks: [{ content: "good", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 9, 0) }],
      })).at(-1)!
      holder.dieFor = "bad"

      yield* runner.arm(at(2026, 8, 2, 8, 59))
      // The tick itself succeeds even though the first due job's executor dies.
      yield* runner.tick(at(2026, 8, 2, 9, 0))

      const settled = yield* tasks.get(sessionID)
      expect(settled.find((task) => task.id === bad.id)?.status).toBe("failed")
      expect(settled.find((task) => task.id === bad.id)?.outputDigest).toBe("scheduled job failed")
      // The second due job in the same tick still triggers and settles.
      expect(holder.calls).toHaveLength(1)
      expect(holder.calls[0]).toMatchObject({ prompt: "good", taskID: good.id })
      expect(settled.find((task) => task.id === good.id)?.status).toBe("completed")
    }),
  )

  it.effect("arm rebuilds the queue from the task table on every call (restart re-arm)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      // Both yields resolve to the same memoized instance; the restart re-arm
      // guarantee comes from arm() re-scanning the whole task table rather
      // than from constructing a second runner (the queue is never carried
      // across arm calls).
      const first = yield* ScheduledJob.Service
      yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 10, 0) }],
      })

      // Arm but do not fire (10:00 is in the future).
      yield* first.arm(at(2026, 8, 2, 9, 0))
      yield* first.tick(at(2026, 8, 2, 9, 30))
      expect(holder.calls).toHaveLength(0)

      // "Restart": a fresh arm() (what a new process runs at startup) re-scans
      // the DB and fires the still-pending job at its scheduled time.
      const second = yield* ScheduledJob.Service
      yield* second.arm(at(2026, 8, 2, 9, 0))
      yield* second.tick(at(2026, 8, 2, 10, 0))
      expect(holder.calls).toHaveLength(1)
      expect(holder.calls[0]?.taskID).toBeDefined()
    }),
  )
})

// Daemon wiring (M3b): bare SessionTask.layer over a SHARED EventV2 (never
// SessionTask.defaultLayer, whose private EventV2 would split task.updated away
// from the daemon's subscriber), plus the production daemonLayer.
const daemonIt = testEffect(
  ScheduledJob.daemonLayer.pipe(
    Layer.provideMerge(ScheduledJob.layer),
    Layer.provideMerge(SessionTask.layer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(stubExecutor),
  ),
)

describe("ScheduledJob daemon", () => {
  daemonIt.effect("a task appended after startup is re-armed via task.updated and fires on a minute tick", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      // Due in the (real-clock) past: the daemon arms/ticks on Date.now(), so
      // any tick once the task is queued fires it.
      yield* tasks.append({
        sessionID,
        tasks: [{ content: "daemon audit", status: "scheduled", priority: "medium", scheduledAt: Date.now() - 60_000 }],
      })
      // The append publishes task.updated; the daemon subscriber re-arms
      // asynchronously. Advance the TestClock minute-by-minute (bounded) until
      // the tick fiber picks the task up — readiness via the stub recording,
      // never Effect.sleep.
      for (let i = 0; i < 5 && holder.calls.length === 0; i++) {
        yield* Effect.yieldNow
        yield* TestClock.adjust(Duration.minutes(1))
        yield* Effect.yieldNow
      }
      expect(holder.calls).toHaveLength(1)
      expect(holder.calls[0]).toMatchObject({ parentID: sessionID, prompt: "daemon audit" })

      yield* Effect.yieldNow
      const settled = yield* tasks.get(sessionID)
      expect(settled[0]?.status).toBe("completed")
    }),
  )

  daemonIt.effect("a task paused after arming is not fired by later ticks", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const runner = yield* ScheduledJob.Service
      const [task] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "daemon audit", status: "scheduled", priority: "medium", scheduledAt: Date.now() - 60_000 }],
      })
      // Queue it deterministically, then pause before the tick: the trigger-time
      // status re-check (and the task.updated re-arm) must keep it from firing.
      yield* runner.arm(Date.now())
      yield* tasks.patch({ sessionID, id: task.id, status: "cancelled" })

      yield* TestClock.adjust(Duration.minutes(1))
      yield* Effect.yieldNow
      yield* TestClock.adjust(Duration.minutes(1))
      yield* Effect.yieldNow

      expect(holder.calls).toHaveLength(0)
      const settled = yield* tasks.get(sessionID)
      expect(settled[0]?.status).toBe("cancelled")
    }),
  )

  it.effect("a claimed in_progress task is not re-armed or re-triggered (B1 re-entry guard)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const runner = yield* ScheduledJob.Service
      const [task] = yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 9, 0) }],
      })

      // Claim the task as the runner now does before executing (trigger sets
      // in_progress). While the child Session runs (potentially minutes), the
      // daemon re-arms on any task.updated and ticks again.
      yield* tasks.patch({ sessionID, id: task.id, status: "in_progress" })

      // Re-arm + a due tick must NOT re-enqueue or re-run the in-flight task.
      yield* runner.arm(at(2026, 8, 2, 8, 59))
      yield* runner.tick(at(2026, 8, 2, 9, 0))
      expect(holder.calls).toHaveLength(0)
      expect((yield* tasks.get(sessionID))[0]?.status).toBe("in_progress")

      // Settle closes the claim; only then can a future schedule pick it up.
      yield* tasks.patch({ sessionID, id: task.id, status: "completed" })
    }),
  )
})
