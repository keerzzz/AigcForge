import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { DateTime, Effect, Layer, Stream } from "effect"
import { TestClock } from "effect/testing"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { ScheduleService } from "@aigcfroge/core/session/schedule-service"
import { ScheduleTask } from "@aigcfroge/core/session/schedule-task"
import { SessionTable, TaskTable } from "@aigcfroge/core/session/sql"
import { DeliveryTable, ScheduleTable } from "@aigcfroge/core/session/schedule.sql"
import { Schedule } from "@aigcfroge/schema/schedule"
import { SessionID } from "@aigcfroge/schema/session-id"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { Agent } from "@aigcfroge/schema/agent"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { testEffect } from "./lib/effect"

const sessionID = SessionID.make("ses_schedule_rules")
const globalLayer = Layer.succeed(Global.Service, Global.Service.of(Global.make({
  data: "/data", config: "/config", tmp: "/tmp/aigcfroge",
})))
const databaseLayer = Database.layer().pipe(Layer.provide(globalLayer))
const busLayer = AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [Bus.node.replace(Bus.configured({ persist: true }))])
const it = testEffect(ScheduleService.layer.pipe(
  Layer.provideMerge(ScheduleService.deliveryLayer), Layer.provideMerge(databaseLayer), Layer.provideMerge(busLayer),
))
const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global,
    worktree: AbsolutePath.make("/project"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
  yield* database.db.insert(SessionTable).values({ id: sessionID, project_id: Project.ID.global,
    slug: "schedule", directory: "/project", title: "schedule", version: "test" }).onConflictDoNothing().run().pipe(Effect.orDie)
})

describe("Schedule rule and occurrence ownership", () => {
  it.effect("preserves the first rule and target identity for an exact Schedule Tool invocation retry", () => Effect.gen(function* () {
    yield* setup
    const schedules = yield* ScheduleService.Service
    const bus = yield* Bus.Service
    const source = { messageID: SessionMessage.ID.make("msg_schedule_tool"), id: "schedule-create" }
    const input = new Schedule.Create({ sessionID, kind: "prompt", content: "Frozen schedule create",
      dueAt: 30_000, timezone: "UTC", recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
      target: new Schedule.NewOnceTarget({ policy: "new_once", template: new SessionTask.OperationNewRootTarget({ type: "new_root", mode: "chat" }) }) })
    const first = yield* schedules.createRule(input, Agent.ID.make("meta"), source)
    expect(first.dueAt).toBe(30_000)
    expect(first.nextDueAt).toBe(60_000)
    const before = yield* bus.log({ aggregateID: sessionID }).pipe(Stream.runCollect)
    yield* TestClock.setTime(180_000)
    expect(yield* schedules.createRule(input, Agent.ID.make("meta"), source)).toEqual(first)
    expect(yield* bus.log({ aggregateID: sessionID }).pipe(Stream.runCollect)).toEqual(before)
    expect(yield* schedules.listRules(sessionID)).toHaveLength(1)
    expect(yield* schedules.createRule(new Schedule.Create({ ...input, content: "Changed retry" }), Agent.ID.make("meta"), source).pipe(Effect.flip))
      .toMatchObject({ reason: "conflicting_retry", scheduleID: first.id })
    expect(yield* schedules.createRule(new Schedule.Create({ ...input, dueAt: 60_000 }), Agent.ID.make("meta"), source).pipe(Effect.flip))
      .toMatchObject({ reason: "conflicting_retry", scheduleID: first.id })
    const separate = yield* schedules.createRule(input, Agent.ID.make("meta"), { ...source, id: "other-create" })
    expect(separate.nextDueAt).toBe(240_000)
    expect(separate.id).not.toBe(first.id)
    expect(separate.boundTargetSessionID).not.toBe(first.boundTargetSessionID)
  }))

  it.effect("unchanged recovery reconciliation preserves timestamps and publishes no additional events", () => Effect.gen(function* () {
    yield* setup
    const schedules = yield* ScheduleService.Service
    const bus = yield* Bus.Service
    const rule = yield* schedules.createRule(new Schedule.Create({ sessionID, kind: "prompt", content: "unverified work",
      dueAt: 60_000, timezone: "UTC", target: new Schedule.ExistingTarget({ policy: "existing", sessionID }),
    }))
    const run = yield* schedules.claimOccurrence(rule.id, 60_000, "first")
    if (!run) return yield* Effect.die(new Error("Expected one occurrence"))
    const change = new Schedule.OccurrenceChange({ status: "recovery_required",
      error: new Schedule.ErrorInfo({ code: "session_input_unverified", message: "The admitted input has no verified terminal receipt" }) })
    const current = yield* schedules.advanceOccurrence(run.id, change)
    const events = yield* bus.log({ aggregateID: sessionID }).pipe(Stream.runCollect)
    yield* TestClock.setTime(120_000)
    expect(yield* schedules.advanceOccurrence(run.id, change)).toEqual(current)
    expect(yield* bus.log({ aggregateID: sessionID }).pipe(Stream.runCollect)).toEqual(events)
    const cleared = yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ error: null }))
    const clearedEvents = yield* bus.log({ aggregateID: sessionID }).pipe(Stream.runCollect)
    yield* TestClock.setTime(180_000)
    expect(yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ error: null }))).toEqual(cleared)
    expect(yield* bus.log({ aggregateID: sessionID }).pipe(Stream.runCollect)).toEqual(clearedEvents)
  }))

  it.effect("AC19 claims one stable occurrence and preserves its immutable snapshot through edits", () => Effect.gen(function* () {
    yield* setup
    const schedules = yield* ScheduleService.Service
    const rule = yield* schedules.createRule(new Schedule.Create({ sessionID, kind: "prompt", content: "first payload",
      dueAt: 60_000, timezone: "UTC", target: new Schedule.ExistingTarget({ policy: "existing", sessionID }),
    }))
    const claims = yield* Effect.all([schedules.claimOccurrence(rule.id, 60_000, "first"),
      schedules.claimOccurrence(rule.id, 60_000, "second")], { concurrency: "unbounded" })
    const run = claims.find((claim) => claim !== undefined)
    if (!run) return yield* Effect.die(new Error("Expected one occurrence"))
    expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1)
    expect(run.operationID.startsWith("top_schedule_")).toBe(true)
    const edited = yield* schedules.editRule(rule.id, new Schedule.Edit({ expectedRevision: rule.revision,
      content: "next payload", dueAt: 120_000 }))
    expect(edited.revision).toBe(rule.revision + 1)
    expect((yield* schedules.occurrence(run.id))?.snapshot.content).toBe("first payload")
    expect((yield* schedules.occurrence(run.id))?.inputID).toBe(run.inputID)
    expect((yield* schedules.occurrence(run.id))?.operationID).toBe(run.operationID)
    expect(yield* schedules.runs(rule.id)).toHaveLength(1)
    yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ status: "completed", sourceSettlement: "conflict" }))
    expect((yield* schedules.getRule(rule.id))?.status).toBe("pending")
    expect((yield* schedules.getRule(rule.id))?.nextDueAt).toBe(120_000)
    expect((yield* schedules.getRule(rule.id))?.activeOccurrenceID).toBeUndefined()
  }))

  for (const policy of ["new_once", "new"] as const) {
    it.effect(`AC19 ${policy} assigns the intended Session identity across two occurrences`, () => Effect.gen(function* () {
      yield* setup
      const schedules = yield* ScheduleService.Service
      const template = new SessionTask.OperationNewRootTarget({ type: "new_root", mode: "chat" })
      const rule = yield* schedules.createRule(new Schedule.Create({ sessionID, kind: "prompt", content: "periodic work",
        dueAt: 300_000, recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" }, timezone: "UTC",
        target: policy === "new_once" ? new Schedule.NewOnceTarget({ policy, template }) : new Schedule.NewTarget({ policy, template }),
      }))
      expect(rule.nextDueAt).toBe(60_000)
      expect(yield* schedules.claimOccurrence(rule.id, 59_999, "early")).toBeUndefined()
      const first = yield* schedules.claimOccurrence(rule.id, 60_000, "first")
      if (!first) return yield* Effect.die(new Error("Expected the first occurrence"))
      expect(first.scheduledAt).toBe(60_000)
      yield* schedules.advanceOccurrence(first.id, new Schedule.OccurrenceChange({ status: "completed" }))
      const following = yield* schedules.getRule(rule.id)
      expect(following?.nextDueAt).toBe(120_000)
      const second = yield* schedules.claimOccurrence(rule.id, 120_000, "second")
      if (!second) return yield* Effect.die(new Error("Expected the second occurrence"))
      expect(second.scheduledAt).toBe(120_000)
      expect(first.id).not.toBe(second.id)
      expect(first.inputID).not.toBe(second.inputID)
      expect(first.operationID).not.toBe(second.operationID)
      expect(first.targetSessionID === second.targetSessionID).toBe(policy === "new_once")
      yield* schedules.advanceOccurrence(second.id, new Schedule.OccurrenceChange({ status: "completed" }))
      yield* TestClock.setTime(180_000)
      const edited = yield* schedules.editRule(rule.id, new Schedule.Edit({ expectedRevision: rule.revision, dueAt: 360_000 }))
      expect(edited.dueAt).toBe(360_000)
      expect(edited.nextDueAt).toBe(240_000)
      const oneShot = yield* schedules.editRule(rule.id, new Schedule.Edit({ expectedRevision: edited.revision,
        recurrence: policy === "new_once" ? null : { cron: "* * * * *", enabled: false, timezone: "UTC" },
      }))
      expect(oneShot.nextDueAt).toBe(360_000)
      expect(yield* schedules.claimOccurrence(rule.id, 359_999, "early one-shot")).toBeUndefined()
      const final = yield* schedules.claimOccurrence(rule.id, 360_000, "one-shot")
      if (!final) return yield* Effect.die(new Error("Expected the one-shot occurrence"))
      expect(final.scheduledAt).toBe(360_000)
      yield* schedules.advanceOccurrence(final.id, new Schedule.OccurrenceChange({ status: "completed" }))
      expect((yield* schedules.getRule(rule.id))?.status).toBe("completed")
      expect((yield* schedules.getRule(rule.id))?.nextDueAt).toBeUndefined()
    }))
  }

  it.effect("AC21 unresolved execution keeps its slot through pause, resume and a revision change", () => Effect.gen(function* () {
    yield* setup
    const schedules = yield* ScheduleService.Service
    const rule = yield* schedules.createRule(new Schedule.Create({ sessionID, kind: "prompt", content: "periodic work",
      dueAt: 300_000, recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" }, timezone: "UTC",
      target: new Schedule.ExistingTarget({ policy: "existing", sessionID }),
    }))
    const run = yield* schedules.claimOccurrence(rule.id, rule.nextDueAt ?? 0, "first")
    if (!run) return yield* Effect.die(new Error("Expected one occurrence"))
    yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ status: "recovery_required" }))
    const paused = yield* schedules.pauseRule(rule.id, rule.revision)
    yield* TestClock.setTime(180_000)
    const resumed = yield* schedules.resumeRule(rule.id, paused.revision)
    expect(resumed.nextDueAt).toBe(240_000)
    expect(resumed.activeOccurrenceID).toBe(run.id)
    expect(yield* schedules.claimOccurrence(rule.id, 240_000, "second")).toBeUndefined()
    yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ status: "completed", sourceSettlement: "conflict" }))
    expect((yield* schedules.getRule(rule.id))?.activeOccurrenceID).toBeUndefined()
    expect((yield* schedules.getRule(rule.id))?.revision).toBe(resumed.revision)
    expect((yield* schedules.getRule(rule.id))?.nextDueAt).toBe(resumed.nextDueAt)
  }))

  it.effect("AC23 legacy reminder claim and stable Delivery identity survive occurrence recovery", () => Effect.gen(function* () {
    yield* setup
    const schedules = yield* ScheduleService.Service
    const deliveries = yield* ScheduleService.DeliveryService
    const reminder = yield* schedules.create({ sessionID, kind: "reminder", content: "saved reminder",
      dueAt: 60_000, timezone: "UTC", deliveryKey: "legacy:stable:key" })
    yield* schedules.claim(reminder.id, "dead-owner", 60_000)
    const run = yield* schedules.claimOccurrence(reminder.id, 120_000, "new-owner")
    if (!run) return yield* Effect.die(new Error("Expected the legacy occurrence"))
    expect(run.legacyClaim?.owner).toBe("dead-owner")
    expect(run.deliveryKey).toBe("legacy:stable:key")
    yield* schedules.deliverOccurrence(run.id, 120_000, true)
    yield* schedules.deliverOccurrence(run.id, 180_000, true)
    const inbox = yield* deliveries.listInbox(sessionID)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.deliveryKey).toBe("legacy:stable:key")
    expect(inbox[0]?.caughtUp).toBe(true)
    expect((yield* schedules.list(sessionID))[0]?.status).toBe("completed")
    expect((yield* schedules.occurrence(run.id))?.legacyClaim?.owner).toBe("dead-owner")
  }))

  it.effect("AC23 recovers a migrated raw running reminder with its original Delivery and read state", () => Effect.gen(function* () {
    yield* setup
    const database = yield* Database.Service
    const schedules = yield* ScheduleService.Service
    const deliveries = yield* ScheduleService.DeliveryService
    const id = Schedule.ID.make("sch_raw_legacy")
    yield* database.db.insert(ScheduleTable).values({ id, session_id: sessionID, kind: "reminder", content: "Raw legacy reminder",
      due_at: 60_000, timezone: "UTC", status: "running", attempts: 3, next_attempt_at: 90_000,
      lease_owner: "original-owner", lease_expires_at: 120_000, delivery_key: "legacy:original-delivery",
      time_created: 10, time_updated: 80_000, next_due_at: null, execution_policy: null,
    }).run().pipe(Effect.orDie)
    yield* database.db.insert(DeliveryTable).values({ delivery_key: "legacy:original-delivery", schedule_id: id,
      session_id: sessionID, kind: "reminder", content: "Original visible delivery", delivered_at: 75_000,
      is_read: true, caught_up: true, time_created: 75_000,
    }).run().pipe(Effect.orDie)
    const original = yield* database.db.select().from(DeliveryTable).get().pipe(Effect.orDie)
    expect((yield* schedules.getRule(id))?.nextDueAt).toBe(90_000)
    const run = yield* schedules.claimOccurrence(id, 180_000, "recovery-owner")
    if (!run) return yield* Effect.die(new Error("The migrated running reminder was not admitted"))
    expect(run.legacyClaim).toMatchObject({ owner: "original-owner", expiresAt: 120_000, attempts: 3, nextAttemptAt: 90_000 })
    expect(run.deliveryKey).toBe("legacy:original-delivery")
    yield* schedules.deliverOccurrence(run.id, 180_000, true)
    expect(yield* database.db.select().from(DeliveryTable).get().pipe(Effect.orDie)).toEqual(original)
    expect(yield* deliveries.countUnread(sessionID)).toBe(0)
    expect((yield* schedules.getRule(id))?.status).toBe("completed")
    expect(yield* schedules.claimOccurrence(id, 240_000, "retry-owner")).toBeUndefined()
    expect(yield* schedules.runs(id)).toHaveLength(1)
  }))

  it.effect("a saved cancellation intent prevents reminder Delivery in its owning transaction", () => Effect.gen(function* () {
    yield* setup
    const schedules = yield* ScheduleService.Service
    const deliveries = yield* ScheduleService.DeliveryService
    const rule = yield* schedules.createRule(new Schedule.Create({ sessionID, kind: "reminder", content: "Cancel before delivery",
      dueAt: 60_000, timezone: "UTC" }))
    const run = yield* schedules.claimOccurrence(rule.id, 60_000, "first")
    if (!run) return yield* Effect.die(new Error("Expected one reminder occurrence"))
    yield* schedules.advanceOccurrence(run.id, new Schedule.OccurrenceChange({ cancelRequested: true }))
    expect(yield* schedules.deliverOccurrence(run.id, 60_000)).toMatchObject({ status: "cancelled", cancelRequested: true })
    expect(yield* deliveries.listInbox(sessionID)).toHaveLength(0)
    expect((yield* schedules.getRule(rule.id))?.activeOccurrenceID).toBeUndefined()
  }))

  it.effect("AC20 recurring reminders keep independent idempotent Delivery receipts", () => Effect.gen(function* () {
    yield* setup
    const schedules = yield* ScheduleService.Service
    const deliveries = yield* ScheduleService.DeliveryService
    const rule = yield* schedules.createRule(new Schedule.Create({ sessionID, kind: "reminder", content: "periodic reminder",
      recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" }, timezone: "UTC" }))
    const first = yield* schedules.claimOccurrence(rule.id, rule.nextDueAt ?? 0, "first")
    if (!first) return yield* Effect.die(new Error("Expected the first reminder occurrence"))
    yield* schedules.deliverOccurrence(first.id, first.scheduledAt)
    const following = yield* schedules.getRule(rule.id)
    const second = yield* schedules.claimOccurrence(rule.id, following?.nextDueAt ?? 0, "second")
    if (!second) return yield* Effect.die(new Error("Expected the second reminder occurrence"))
    yield* schedules.deliverOccurrence(second.id, second.scheduledAt)
    expect(first.deliveryKey).not.toBe(second.deliveryKey)
    expect(yield* deliveries.listInbox(sessionID)).toHaveLength(2)
  }))

  it.effect("AC22 Task execution settlement preserves recurrence; an explicit pause disables future admission", () => Effect.gen(function* () {
    yield* setup
    const database = yield* Database.Service
    const time = (yield* DateTime.nowAsDate).getTime()
    yield* database.db.insert(TaskTable).values({ id: "task-scheduled", session_id: sessionID, content: "task payload",
      status: "scheduled", priority: "medium", position: 0, recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" },
      revision: 1, time_created: time, time_updated: time }).run().pipe(Effect.orDie)
    yield* ScheduleTask.sync(database.db, { sessionID, now: time })
    const prior = yield* database.db.select().from(TaskTable).where(eq(TaskTable.session_id, sessionID)).all().pipe(Effect.orDie)
    yield* database.db.update(TaskTable).set({ status: "cancelled" }).where(eq(TaskTable.id, "task-scheduled")).run().pipe(Effect.orDie)
    yield* ScheduleTask.sync(database.db, { sessionID, now: time, previous: prior, execution: true })
    expect((yield* database.db.select().from(ScheduleTable).get().pipe(Effect.orDie))?.status).toBe("pending")
    yield* database.db.update(TaskTable).set({ status: "scheduled" }).where(eq(TaskTable.id, "task-scheduled")).run().pipe(Effect.orDie)
    const managementPrior = yield* database.db.select().from(TaskTable).all().pipe(Effect.orDie)
    yield* database.db.update(TaskTable).set({ status: "cancelled" }).where(eq(TaskTable.id, "task-scheduled")).run().pipe(Effect.orDie)
    yield* ScheduleTask.sync(database.db, { sessionID, now: time, previous: managementPrior })
    expect((yield* database.db.select().from(ScheduleTable).get().pipe(Effect.orDie))?.status).toBe("paused")
  }))

  it.effect("AC23 backfills old scheduled Tasks once and leaves in-progress legacy execution under its original owner", () => Effect.gen(function* () {
    yield* setup
    const database = yield* Database.Service
    const schedules = yield* ScheduleService.Service
    yield* database.db.insert(TaskTable).values([
      { id: "old-one-shot", session_id: sessionID, content: "Existing due input", status: "scheduled", priority: "medium",
        scheduled_at: 60_000, position: 0, revision: 4, time_created: 10, time_updated: 20 },
      { id: "old-running", session_id: sessionID, content: "Keep original execution", status: "in_progress", priority: "high",
        recurrence: { cron: "* * * * *", enabled: true, timezone: "UTC" }, position: 1, revision: 7, time_created: 11, time_updated: 21 },
      { id: "ordinary", session_id: sessionID, content: "No schedule", status: "pending", priority: "medium",
        position: 2, revision: 1, time_created: 12, time_updated: 22 },
    ]).run().pipe(Effect.orDie)
    yield* database.db.transaction((tx) => ScheduleTask.sync(tx, { sessionID, now: 180_000 }).pipe(Effect.orDie)).pipe(Effect.orDie)
    const rules = yield* schedules.listRules(sessionID)
    expect(rules).toHaveLength(2)
    const due = rules.find((rule) => rule.taskID === "old-one-shot")
    const running = rules.find((rule) => rule.taskID === "old-running")
    if (!due || !running) return yield* Effect.die(new Error("Legacy Task backfill missing"))
    expect(due).toMatchObject({ status: "pending", nextDueAt: 60_000, target: { policy: "legacy_child" } })
    expect(running).toMatchObject({ status: "paused", error: { code: "legacy_execution_unresolved" } })
    expect(yield* schedules.claimOccurrence(running.id, 180_000, "new-owner")).toBeUndefined()
    const rows = yield* database.db.select().from(ScheduleTable).all().pipe(Effect.orDie)
    yield* database.db.transaction((tx) => ScheduleTask.sync(tx, { sessionID, now: 240_000 }).pipe(Effect.orDie)).pipe(Effect.orDie)
    expect(yield* database.db.select().from(ScheduleTable).all().pipe(Effect.orDie)).toEqual(rows)
    const previous = yield* database.db.select().from(TaskTable).where(eq(TaskTable.session_id, sessionID)).all().pipe(Effect.orDie)
    yield* database.db.update(TaskTable).set({ status: "completed" }).where(eq(TaskTable.id, "old-running")).run().pipe(Effect.orDie)
    yield* database.db.transaction((tx) => ScheduleTask.sync(tx, { sessionID, now: 240_000, previous, execution: true }).pipe(Effect.orDie)).pipe(Effect.orDie)
    expect((yield* schedules.getRule(running.id))?.status).toBe("pending")
    expect((yield* schedules.getRule(running.id))?.error).toBeUndefined()
    expect(yield* schedules.runs(running.id)).toHaveLength(0)
  }))
})
