import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SchedulerCore } from "@aigcfroge/core/session/schedule-core"
import { testEffect } from "./lib/effect"

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

type FakeRow = {
  id: string
  status: string
  scheduledAt: number | null
  recurrence: { enabled: boolean; cron: string } | null
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
      yield* core.tick(at(2026, 8, 2, 9, 10))
      expect(store.triggered).toHaveLength(2)
    }),
  )

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
