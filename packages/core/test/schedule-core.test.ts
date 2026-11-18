import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { SchedulerCore } from "@aigcfroge/core/session/schedule-core"
import { awaitWithTimeout, testEffect } from "./lib/effect"

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

type FakeRow = {
  id: string
  status: string
  scheduledAt: number | null
  recurrence: { enabled: boolean; cron: string; timezone?: string } | null
}

const makeStore = (initial: FakeRow[]) => {
  const rows: FakeRow[] = [...initial]
  const recovered: string[] = []
  const triggered: Array<{ id: string; now: number }> = []
  const rearmed: Array<{ id: string; run: number }> = []
  return {
    rows,
    recovered,
    triggered,
    rearmed,
    row: (id: string) => rows.find((row) => row.id === id),
  }
}

const it = testEffect(Layer.empty)

const makeCore = (store: ReturnType<typeof makeStore>) =>
  SchedulerCore.make({
    scan: () => Effect.sync(() => [...store.rows]),
    recover: (row) =>
      Effect.sync(() => {
        store.recovered.push(row.id)
        const found = store.rows.find((item) => item.id === row.id)
        if (found) found.status = "pending"
      }),
    trigger: (id, now, rearm) =>
      Effect.sync(() => {
        store.triggered.push({ id, now })
        const row = store.rows.find((item) => item.id === id)
        if (row?.recurrence?.enabled) {
          const run = at(2026, 8, 2, 9, 10)
          store.rearmed.push({ id, run })
          rearm(run)
        }
      }),
  })

describe("SchedulerCore", () => {
  it.effect("changing only the fixed timezone replaces the queued deadline", () =>
    Effect.gen(function* () {
      const store = makeStore([
        {
          id: "daily",
          status: "scheduled",
          scheduledAt: null,
          recurrence: { enabled: true, cron: "0 9 * * *", timezone: "Asia/Tokyo" },
        },
      ])
      const core = yield* makeCore(store)
      yield* core.arm(Date.parse("2026-08-01T23:59:00.000Z"))

      const row = store.row("daily")
      if (!row?.recurrence) throw new Error("Expected the recurring fixture row")
      row.recurrence.timezone = "Europe/London"
      yield* core.arm(Date.parse("2026-08-02T00:00:00.000Z"))
      yield* core.tick(Date.parse("2026-08-02T00:00:00.000Z"))
      expect(store.triggered).toHaveLength(0)

      yield* core.tick(Date.parse("2026-08-02T08:00:00.000Z"))
      expect(store.triggered).toEqual([{ id: "daily", now: Date.parse("2026-08-02T08:00:00.000Z") }])
    }),
  )

  it.effect("arm before tick preserves an unchanged recurrence that is already due", () =>
    Effect.gen(function* () {
      const store = makeStore([
        { id: "daily", status: "scheduled", scheduledAt: null, recurrence: { enabled: true, cron: "0 9 * * *" } },
      ])
      const core = yield* makeCore(store)

      yield* core.arm(at(2026, 8, 2, 8, 59))
      yield* core.arm(at(2026, 8, 2, 9, 0))
      yield* core.tick(at(2026, 8, 2, 9, 0))

      expect(store.triggered).toEqual([{ id: "daily", now: at(2026, 8, 2, 9, 0) }])
    }),
  )

  it.effect("arm queues only scheduled/pending rows; tick triggers only due ones", () =>
    Effect.gen(function* () {
      const store = makeStore([
        { id: "due", status: "scheduled", scheduledAt: at(2026, 8, 2, 9, 0), recurrence: null },
        { id: "future", status: "scheduled", scheduledAt: at(2026, 8, 2, 10, 0), recurrence: null },
        { id: "settled", status: "completed", scheduledAt: at(2026, 8, 2, 9, 0), recurrence: null },
      ])
      const core = yield* makeCore(store)

      yield* core.arm(at(2026, 8, 2, 8, 59))
      yield* core.tick(at(2026, 8, 2, 8, 59))
      expect(store.triggered).toHaveLength(0)

      yield* core.tick(at(2026, 8, 2, 9, 0))
      expect(store.triggered.map((call) => call.id)).toEqual(["due"])
      expect(store.recovered).toHaveLength(0)
    }),
  )

  it.effect("arm with recover resets a stale in_progress claim and re-queues the row", () =>
    Effect.gen(function* () {
      const store = makeStore([
        { id: "stale", status: "in_progress", scheduledAt: at(2026, 8, 2, 9, 0), recurrence: null },
      ])
      const core = yield* makeCore(store)

      // A plain re-arm must not touch a live claim.
      yield* core.arm(at(2026, 8, 2, 8, 59))
      yield* core.tick(at(2026, 8, 2, 9, 0))
      expect(store.triggered).toHaveLength(0)
      expect(store.recovered).toHaveLength(0)
      expect(store.row("stale")?.status).toBe("in_progress")

      // Startup recovery resets the stale claim and the row fires.
      yield* core.arm(at(2026, 8, 2, 8, 59), { recover: true })
      expect(store.recovered).toEqual(["stale"])
      expect(store.row("stale")?.status).toBe("pending")
      yield* core.tick(at(2026, 8, 2, 9, 0))
      expect(store.triggered.map((call) => call.id)).toEqual(["stale"])
    }),
  )

  it.effect("rearm re-queues a recurring row for its next run", () =>
    Effect.gen(function* () {
      const store = makeStore([
        { id: "daily", status: "scheduled", scheduledAt: null, recurrence: { enabled: true, cron: "0 9 * * *" } },
      ])
      const core = yield* makeCore(store)

      yield* core.arm(at(2026, 8, 2, 8, 59))
      yield* core.tick(at(2026, 8, 2, 9, 0))
      expect(store.triggered.map((call) => call.id)).toEqual(["daily"])
      expect(store.rearmed).toEqual([{ id: "daily", run: at(2026, 8, 2, 9, 10) }])

      // The re-armed queue fires again at the next run.
      yield* core.arm(at(2026, 8, 2, 9, 1))
      yield* core.tick(at(2026, 8, 2, 9, 10))
      expect(store.triggered).toHaveLength(2)
    }),
  )

  for (const change of ["rescheduled", "cancelled", "removed"] as const) {
    it.effect(`arm withdraws the old due deadline when a recurrence is ${change}`, () =>
      Effect.gen(function* () {
        const store = makeStore([
          { id: "daily", status: "scheduled", scheduledAt: null, recurrence: { enabled: true, cron: "0 9 * * *" } },
        ])
        const core = yield* makeCore(store)

        yield* core.arm(at(2026, 8, 2, 8, 59))

        const row = store.row("daily")
        if (!row) throw new Error("Expected the scheduled fixture row")
        if (change === "rescheduled") row.recurrence = { enabled: true, cron: "0 10 * * *" }
        if (change === "cancelled") row.status = "cancelled"
        if (change === "removed") store.rows.splice(0, 1)

        yield* core.arm(at(2026, 8, 2, 9, 0))
        yield* core.tick(at(2026, 8, 2, 9, 0))

        expect(store.triggered).toHaveLength(0)

        yield* core.tick(at(2026, 8, 2, 10, 0))

        expect(store.triggered.map((call) => call.id)).toEqual(change === "rescheduled" ? ["daily"] : [])
      }),
    )
  }

  for (const change of ["rescheduled", "cancelled", "removed"] as const) {
    it.effect(`tick discards a due candidate ${change} while another trigger is running`, () =>
      Effect.gen(function* () {
        const store = makeStore([
          { id: "first", status: "scheduled", scheduledAt: at(2026, 8, 2, 9, 0), recurrence: null },
          { id: "second", status: "scheduled", scheduledAt: at(2026, 8, 2, 9, 0), recurrence: null },
        ])
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const core = yield* SchedulerCore.make({
          scan: () => Effect.sync(() => [...store.rows]),
          recover: () => Effect.void,
          trigger: (id, now) =>
            Effect.gen(function* () {
              store.triggered.push({ id, now })
              const row = store.row(id)
              if (!row) throw new Error("Expected the scheduled fixture row")
              row.status = "completed"
              if (id !== "first") return

              yield* Deferred.succeed(entered, void 0)
              yield* Deferred.await(release)
            }),
        })

        yield* core.arm(at(2026, 8, 2, 8, 59))
        const scope = yield* Effect.scope
        const tick = yield* Effect.forkIn(scope)(core.tick(at(2026, 8, 2, 9, 0)))
        yield* awaitWithTimeout(Deferred.await(entered), "The first trigger must enter before changing the second")

        const row = store.row("second")
        if (!row) throw new Error("Expected the second scheduled fixture row")
        if (change === "rescheduled") row.scheduledAt = at(2026, 8, 2, 10, 0)
        if (change === "cancelled") row.status = "cancelled"
        if (change === "removed") store.rows.splice(1, 1)

        yield* core.arm(at(2026, 8, 2, 9, 0))
        yield* Deferred.succeed(release, void 0)
        yield* awaitWithTimeout(Fiber.join(tick), "The tick must finish after releasing the first trigger")

        expect(store.triggered.map((call) => call.id)).toEqual(["first"])

        yield* core.tick(at(2026, 8, 2, 10, 0))

        expect(store.triggered.map((call) => call.id)).toEqual(
          change === "rescheduled" ? ["first", "second"] : ["first"],
        )
      }),
    )
  }

  it.effect("arm rebuilds the queue from the scan on every call (restart re-arm)", () =>
    Effect.gen(function* () {
      const store = makeStore([
        { id: "job", status: "scheduled", scheduledAt: at(2026, 8, 2, 10, 0), recurrence: null },
      ])
      const core = yield* makeCore(store)

      yield* core.arm(at(2026, 8, 2, 9, 0))
      yield* core.tick(at(2026, 8, 2, 9, 30))
      expect(store.triggered).toHaveLength(0)

      // A fresh arm (what a new process runs at startup) re-scans and fires.
      yield* core.arm(at(2026, 8, 2, 9, 0))
      yield* core.tick(at(2026, 8, 2, 10, 0))
      expect(store.triggered.map((call) => call.id)).toEqual(["job"])
    }),
  )
})
