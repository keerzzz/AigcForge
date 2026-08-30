import { describe, expect } from "bun:test"
import { Duration, Effect, Layer, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Schedule } from "@aigcfroge/schema/schedule"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_schedule_service_test")

const it = testEffect(
  ScheduleService.layer.pipe(Layer.provideMerge(Database.defaultLayer), Layer.provideMerge(EventV2.defaultLayer)),
)

const deliveryIt = testEffect(
  ScheduleService.layer.pipe(
    Layer.provideMerge(ScheduleService.deliveryLayer),
    Layer.provideMerge(Database.defaultLayer),
    Layer.provideMerge(EventV2.defaultLayer),
  ),
)

const setup = Effect.gen(function* () {
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
    .onConflictDoNothing()
    .run()
    .pipe(Effect.orDie)
})

const makeInput = (overrides: Partial<Parameters<ScheduleService.Interface["create"]>[0]> = {}) => ({
  sessionID,
  kind: "reminder" as const,
  content: "follow up with customer",
  dueAt: Date.now() + 60_000,
  timezone: "Asia/Shanghai",
  deliveryKey: `reminder:${sessionID}:1`,
  ...overrides,
})

describe("ScheduleService", () => {
  it.effect("create persists a pending schedule; list/countPending reflect it", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create(makeInput())

      expect(created.status).toBe("pending")
      expect(created.content).toBe("follow up with customer")
      expect(created.deliveryKey).toBe(`reminder:${sessionID}:1`)

      const list = yield* schedules.list(sessionID)
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe(created.id)
      expect(yield* schedules.countPending()).toBe(1)
    }),
  )

  it.effect("cancel flips pending → cancelled (terminal); cancel is a no-op on terminal rows", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create(makeInput())

      const cancelled = yield* schedules.cancel(created.id)
      expect(cancelled?.status).toBe("cancelled")
      expect((yield* schedules.list(sessionID))[0]?.status).toBe("cancelled")
      // Terminal: a second cancel returns the row unchanged (no error).
      expect((yield* schedules.cancel(created.id))?.status).toBe("cancelled")
      expect(yield* schedules.countPending()).toBe(0)
    }),
  )

  it.effect("update regenerates delivery_key on content/dueAt change, freeing the original tuple", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const origDueAt = Date.now() + 120_000
      const created = yield* schedules.create(makeInput({ dueAt: origDueAt, deliveryKey: "reminder:orig:1" }))

      // Edit content + due time: the idempotency key must change, otherwise
      // re-creating the ORIGINAL tuple later collides on the unique index
      // (review MAJOR: reminder_update never regenerated delivery_key).
      const updated = yield* schedules.update({
        id: created.id,
        content: "edited",
        dueAt: Date.now() + 240_000,
        deliveryKey: "reminder:edited:1",
      })
      expect(updated?.deliveryKey).toBe("reminder:edited:1")

      const recreated = yield* schedules.create(
        makeInput({ dueAt: origDueAt, content: "follow up with customer", deliveryKey: "reminder:orig:1" }),
      )
      expect(recreated.id).toBeDefined()
      expect(yield* schedules.countPending()).toBe(2)
    }),
  )

  it.effect("claim is conditional: a pending row claims once, a second claim races", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create(makeInput())

      const claimed = yield* schedules.claim(created.id, "test-owner", Date.now())
      expect(claimed?.status).toBe("running")
      expect(claimed?.leaseOwner).toBe("test-owner")

      const raced = yield* schedules.claim(created.id, "other-owner", Date.now())
      expect(raced).toBeUndefined()
      expect(yield* schedules.countPending()).toBe(0)
    }),
  )

  it.effect("a cancelled row cannot be claimed", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create(makeInput())
      yield* schedules.cancel(created.id)
      expect(yield* schedules.claim(created.id, "test-owner", Date.now())).toBeUndefined()
    }),
  )

  it.effect("settle completes a running row and clears the lease", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create(makeInput())
      yield* schedules.claim(created.id, "test-owner", Date.now())

      const settled = yield* schedules.settle(created.id, "completed")
      expect(settled?.status).toBe("completed")
      expect(settled?.leaseOwner).toBeUndefined()
      expect(settled?.leaseExpiresAt).toBeUndefined()
    }),
  )

  it.effect("recoverClaim resets a stale running claim (crash recovery) to pending", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const created = yield* schedules.create(makeInput())
      yield* schedules.claim(created.id, "dead-scheduler", Date.now() - 60_000)

      const recovered = yield* schedules.recoverClaim(created.id)
      expect(recovered?.status).toBe("pending")
      expect(recovered?.leaseOwner).toBeUndefined()
      expect(yield* schedules.countPending()).toBe(1)
    }),
  )
})

describe("DeliveryService", () => {
  deliveryIt.effect("deliver is idempotent: the same deliveryKey inserts once", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const deliveries = yield* ScheduleService.DeliveryService
      const created = yield* schedules.create(makeInput())
      const input = {
        deliveryKey: created.deliveryKey,
        scheduleID: created.id,
        sessionID,
        kind: "reminder" as const,
        content: "follow up",
        deliveredAt: Date.now(),
        caughtUp: false,
      }

      expect(yield* deliveries.deliver(input)).toBe(true)
      expect(yield* deliveries.deliver(input)).toBe(false)

      const inbox = yield* deliveries.listInbox(sessionID)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.deliveryKey).toBe(created.deliveryKey)
    }),
  )

  deliveryIt.effect("markRead + countUnread track inbox read state", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const deliveries = yield* ScheduleService.DeliveryService
      const first = yield* schedules.create(makeInput({ deliveryKey: "delivery:2" }))
      const second = yield* schedules.create(makeInput({ deliveryKey: "delivery:3" }))
      yield* deliveries.deliver({
        deliveryKey: first.deliveryKey,
        scheduleID: first.id,
        sessionID,
        kind: "reminder",
        content: "x",
        deliveredAt: Date.now(),
        caughtUp: true,
      })
      yield* deliveries.deliver({
        deliveryKey: second.deliveryKey,
        scheduleID: second.id,
        sessionID,
        kind: "reminder",
        content: "y",
        deliveredAt: Date.now() + 1,
        caughtUp: false,
      })

      expect(yield* deliveries.countUnread(sessionID)).toBe(2)
      yield* deliveries.markRead(first.deliveryKey)
      expect(yield* deliveries.countUnread(sessionID)).toBe(1)

      const inbox = yield* deliveries.listInbox(sessionID)
      expect(inbox.map((item) => item.deliveryKey)).toEqual([second.deliveryKey, first.deliveryKey])
      expect(inbox.find((item) => item.deliveryKey === first.deliveryKey)?.caughtUp).toBe(true)
    }),
  )
})

const daemonIt = testEffect(
  ScheduleService.daemonLayer.pipe(
    Layer.provideMerge(ScheduleService.layer),
    Layer.provideMerge(ScheduleService.deliveryLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(Database.defaultLayer),
  ),
)

describe("AssistantSchedulerDaemon", () => {
  daemonIt.effect("a due reminder is delivered to the inbox exactly once", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const deliveries = yield* ScheduleService.DeliveryService
      yield* schedules.create(makeInput({ dueAt: Date.now() - 60_000, deliveryKey: "reminder:due:1" }))

      // The daemon armed at startup (recover pass); tick once to fire the due row.
      for (let i = 0; i < 3; i++) {
        yield* Effect.yieldNow
        yield* TestClock.adjust(Duration.minutes(1))
        yield* Effect.yieldNow
      }

      const inbox = yield* deliveries.listInbox(sessionID)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.content).toBe("follow up with customer")
      expect(inbox[0]?.caughtUp).toBe(false)
      const settled = yield* schedules.list(sessionID)
      expect(settled[0]?.status).toBe("completed")

      // Idempotent: further ticks produce no duplicate delivery.
      for (let i = 0; i < 3; i++) {
        yield* Effect.yieldNow
        yield* TestClock.adjust(Duration.minutes(1))
        yield* Effect.yieldNow
      }
      expect(yield* deliveries.listInbox(sessionID)).toHaveLength(1)
    }),
  )
})

const coreIt = testEffect(
  ScheduleService.layer.pipe(
    Layer.provideMerge(ScheduleService.deliveryLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(Database.defaultLayer),
  ),
)

// A fresh core simulates a process restart: the catch-up pass marks overdue
// pending rows, arm(recover) resets stale running claims, and the first tick
// re-delivers them (PRD §6 step 7).
const restart = Effect.gen(function* () {
  const { db } = yield* Database.Service
  const schedules = yield* ScheduleService.Service
  const events = yield* EventV2.Service
  const recovered = yield* Ref.make(new Set<string>())
  yield* ScheduleService.markCatchUp({ db, recovered, now: Date.now() })
  const core = yield* ScheduleService.makeAssistantCore({ db, schedules, events, recovered })
  return { core, schedules }
})

describe("AssistantSchedulerDaemon (restart recovery)", () => {
  coreIt.effect("an overdue pending row is caught up after a restart (caught_up marker)", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const deliveries = yield* ScheduleService.DeliveryService
      yield* schedules.create(makeInput({ dueAt: Date.now() - 3600_000, deliveryKey: "reminder:stale:1" }))

      const { core } = yield* restart
      yield* core.arm(Date.now(), { recover: true })
      yield* core.tick(Date.now())

      const inbox = yield* deliveries.listInbox(sessionID)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.caughtUp).toBe(true)
      expect((yield* schedules.list(sessionID))[0]?.status).toBe("completed")
    }),
  )

  coreIt.effect("a running claim from a dead scheduler is recovered and the row re-delivers once", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const deliveries = yield* ScheduleService.DeliveryService
      const created = yield* schedules.create(
        makeInput({ dueAt: Date.now() - 60_000, deliveryKey: "reminder:crashed:1" }),
      )
      // Simulate a crash mid-delivery: the row is running (stale claim).
      yield* schedules.claim(created.id, "dead-scheduler", Date.now() - 3600_000)

      const { core } = yield* restart
      yield* core.arm(Date.now(), { recover: true })
      yield* core.tick(Date.now())

      const inbox = yield* deliveries.listInbox(sessionID)
      expect(inbox).toHaveLength(1)
      expect((yield* schedules.list(sessionID))[0]?.status).toBe("completed")
    }),
  )

  coreIt.effect("a cancelled reminder is never delivered", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const deliveries = yield* ScheduleService.DeliveryService
      const created = yield* schedules.create(
        makeInput({ dueAt: Date.now() - 60_000, deliveryKey: "reminder:cancelled:1" }),
      )
      yield* schedules.cancel(created.id)

      const { core } = yield* restart
      yield* core.arm(Date.now(), { recover: true })
      yield* core.tick(Date.now())

      expect(yield* deliveries.listInbox(sessionID)).toHaveLength(0)
      expect((yield* schedules.list(sessionID))[0]?.status).toBe("cancelled")
    }),
  )

  coreIt.effect("a restart after a completed delivery never duplicates the inbox row", () =>
    Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const deliveries = yield* ScheduleService.DeliveryService
      yield* schedules.create(makeInput({ dueAt: Date.now() - 60_000, deliveryKey: "reminder:dup:1" }))

      const first = yield* restart
      yield* first.core.arm(Date.now(), { recover: true })
      yield* first.core.tick(Date.now())
      expect(yield* deliveries.listInbox(sessionID)).toHaveLength(1)

      // A second "process" (fresh core) re-scans: the row is completed, so no
      // second delivery — the delivery_key unique constraint backs this up.
      const second = yield* restart
      yield* second.core.arm(Date.now(), { recover: true })
      yield* second.core.tick(Date.now())
      expect(yield* deliveries.listInbox(sessionID)).toHaveLength(1)
    }),
  )
})

// MAJOR #3 regression: the tool path (location-layer) publishes schedule
// updates on one EventV2 instance while the daemon subscribes on another
// (server app graph). The minute cycle re-derives the queue from the table,
// so a reminder created on the "other" EventV2 must still be delivered.
const splitEventIt = testEffect(
  ScheduleService.daemonLayer.pipe(
    Layer.provideMerge(ScheduleService.layer),
    Layer.provideMerge(ScheduleService.deliveryLayer),
    Layer.provideMerge(EventV2.defaultLayer),
    Layer.provideMerge(Database.defaultLayer),
  ),
)

describe("AssistantSchedulerDaemon (split EventV2 instances)", () => {
  splitEventIt.effect("delivers a reminder created through a different EventV2 instance", () =>
    Effect.gen(function* () {
      yield* setup
      const { db } = yield* Database.Service
      const deliveries = yield* ScheduleService.DeliveryService
      // Create through a *separate* EventV2 layer instance sharing the same
      // in-memory db: the daemon never sees its schedule.updated publish —
      // only the per-minute arm re-derives the row from the table. (The test
      // db is :memory:, so the split layer must reuse the outer db handle
      // rather than building its own Database.defaultLayer.)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const ctx = yield* ScheduleService.layer.pipe(
            Layer.provideMerge(EventV2.defaultLayer),
            Layer.provideMerge(Layer.succeed(Database.Service, { db })),
            Layer.build,
          )
          const split = yield* ScheduleService.Service.pipe(Effect.provide(ctx))
          yield* split.create(makeInput({ dueAt: Date.now() - 60_000, deliveryKey: "reminder:split:1" }))
        }),
      )

      for (let i = 0; i < 4; i++) {
        yield* Effect.yieldNow
        yield* TestClock.adjust(Duration.minutes(1))
        yield* Effect.yieldNow
      }

      const inbox = yield* deliveries.listInbox(sessionID)
      expect(inbox).toHaveLength(1)
      expect(inbox[0]?.deliveryKey).toBe("reminder:split:1")
    }),
  )
})
