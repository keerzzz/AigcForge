import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
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
const holder: { calls: Call[]; result: ScheduledJob.ScheduledResult } = {
  calls: [],
  result: { outcome: "completed", childSessionID: SessionV2.ID.make("ses_child") },
}
const stubExecutor = Layer.succeed(
  ScheduledJob.ScheduledExecutor,
  ScheduledJob.ScheduledExecutor.of({
    run: (input) =>
      Effect.sync(() => {
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

      // The re-armed queue fires again at 09:10 (strictly after 09:05).
      yield* runner.tick(at(2026, 8, 2, 9, 10))
      expect(holder.calls).toHaveLength(2)
    }),
  )

  it.effect("a fresh runner instance re-arms from the task table (restart re-arm)", () =>
    Effect.gen(function* () {
      yield* setup
      const tasks = yield* SessionTask.Service
      const first = yield* ScheduledJob.Service
      yield* tasks.append({
        sessionID,
        tasks: [{ content: "audit", status: "scheduled", priority: "medium", scheduledAt: at(2026, 8, 2, 10, 0) }],
      })

      // Instance A arms but does not fire (10:00 is in the future).
      yield* first.arm(at(2026, 8, 2, 9, 0))
      yield* first.tick(at(2026, 8, 2, 9, 30))
      expect(holder.calls).toHaveLength(0)

      // "Restart": a brand-new service instance (fresh in-memory queue) re-arms
      // from the DB and fires the still-pending job at its scheduled time.
      const second = yield* ScheduledJob.Service
      yield* second.arm(at(2026, 8, 2, 9, 0))
      yield* second.tick(at(2026, 8, 2, 10, 0))
      expect(holder.calls).toHaveLength(1)
      expect(holder.calls[0]?.taskID).toBeDefined()
    }),
  )
})
