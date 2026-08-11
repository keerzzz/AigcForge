export * as ScheduleService from "./schedule-service"

import { and, desc, eq, lt, or } from "drizzle-orm"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { Database } from "../database/database"
import { Schedule } from "@aigcfroge/schema/schedule"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { SessionSchema } from "./schema"
import { SchedulerCore } from "./schedule-core"
import { DeliveryTable, ScheduleTable } from "./schedule.sql"

/**
 * Assistant personal schedule (PRD §7.1/§7.2): a typed persistence boundary on
 * top of the Schedule/Delivery tables. Creation, query, cancel, claim, and
 * settle all go through this service — UI and models never touch the tables
 * directly. The delivery scan is an idempotent at-least-once claim keyed by
 * the schedule's stable `deliveryKey`; the user-visible result is exactly-once
 * because the delivery_key primary key rejects duplicates.
 *
 * Status flow: pending → running (claim) → completed | failed; cancelled is
 * terminal from any pre-terminal state. A failed delivery keeps the row
 * pending with a bounded backoff (`attempts`/`nextAttemptAt`); past the limit
 * the row settles failed.
 */

export const MAX_DELIVERY_ATTEMPTS = 5

const backoff = (attempt: number): number => {
  const minutes = Math.min(2 ** (attempt - 1), 60)
  return minutes * 60_000
}

const toInfo = (row: typeof ScheduleTable.$inferSelect): Schedule.Info =>
  new Schedule.Info({
    id: row.id,
    sessionID: row.session_id,
    kind: row.kind,
    content: row.content,
    dueAt: row.due_at,
    timezone: row.timezone,
    status: row.status,
    attempts: row.attempts,
    ...(row.next_attempt_at !== null && row.next_attempt_at !== undefined
      ? { nextAttemptAt: row.next_attempt_at }
      : {}),
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at !== null && row.lease_expires_at !== undefined
      ? { leaseExpiresAt: row.lease_expires_at }
      : {}),
    deliveryKey: row.delivery_key,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })

const toDelivery = (row: typeof DeliveryTable.$inferSelect): Schedule.Delivery =>
  new Schedule.Delivery({
    deliveryKey: row.delivery_key,
    scheduleID: row.schedule_id,
    sessionID: row.session_id,
    kind: row.kind,
    content: row.content,
    deliveredAt: row.delivered_at,
    caughtUp: row.caught_up,
    createdAt: row.time_created,
  })

export const Event = {
  Updated: EventV2.define({
    type: "schedule.updated",
    schema: {
      sessionID: SessionSchema.ID,
      schedules: Schema.Array(Schedule.Info),
    },
  }),
  Delivered: EventV2.define({
    type: "schedule.delivered",
    schema: {
      sessionID: SessionSchema.ID,
      delivery: Schedule.Delivery,
    },
  }),
}

export interface Interface {
  readonly create: (input: {
    readonly sessionID: SessionSchema.ID
    readonly kind: Schedule.ScheduleKind
    readonly content: string
    readonly dueAt: number
    readonly timezone: string
    readonly deliveryKey: string
  }) => Effect.Effect<Schedule.Info>
  /** All schedules of a session, pending first then by due time. */
  readonly list: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Schedule.Info>>
  /** All non-terminal schedules process-wide (daemon scan + dashboard). */
  readonly listPending: () => Effect.Effect<ReadonlyArray<Schedule.Info>>
  readonly countPending: () => Effect.Effect<number>
  /**
   * Cancel a pending/running schedule; a terminal row resolves `undefined`.
   * Conditional on the current status so a cancel racing a claim never flips a
   * running delivery back to cancelled-after-delivery.
   */
  readonly cancel: (id: Schedule.ID) => Effect.Effect<Schedule.Info | undefined>
  /** Claim a pending row into running with a lease (conditional; undefined when raced). */
  readonly claim: (id: Schedule.ID, owner: string, now: number) => Effect.Effect<Schedule.Info | undefined>
  /** Settle a running row into completed/failed. */
  readonly settle: (id: Schedule.ID, status: "completed" | "failed") => Effect.Effect<Schedule.Info | undefined>
  /** Startup recovery: reset a stale running claim (dead scheduler) to pending. */
  readonly recoverClaim: (id: Schedule.ID) => Effect.Effect<Schedule.Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/ScheduleService") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const create = Effect.fn("ScheduleService.create")((input: {
      readonly sessionID: SessionSchema.ID
      readonly kind: Schedule.ScheduleKind
      readonly content: string
      readonly dueAt: number
      readonly timezone: string
      readonly deliveryKey: string
    }) =>
      Effect.gen(function* () {
        const id = Schedule.ID.create()
        const now = Date.now()
        yield* db
          .insert(ScheduleTable)
          .values({
            id,
            session_id: input.sessionID,
            kind: input.kind,
            content: input.content,
            due_at: input.dueAt,
            timezone: input.timezone,
            status: "pending",
            attempts: 0,
            delivery_key: input.deliveryKey,
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
        yield* publishSchedules({ db, events, sessionID: input.sessionID })
        const row = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return yield* Effect.die(new Error("created schedule row vanished"))
        return toInfo(row)
      }),
    )

    const list = Effect.fn("ScheduleService.list")((sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(ScheduleTable)
          .where(eq(ScheduleTable.session_id, sessionID))
          .orderBy(ScheduleTable.due_at)
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
    )

    const listPending = Effect.fn("ScheduleService.listPending")(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(ScheduleTable)
          .where(or(eq(ScheduleTable.status, "pending"), eq(ScheduleTable.status, "running")))
          .orderBy(ScheduleTable.due_at)
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
    )

    const countPending = Effect.fn("ScheduleService.countPending")(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: ScheduleTable.id })
          .from(ScheduleTable)
          .where(eq(ScheduleTable.status, "pending"))
          .all()
          .pipe(Effect.orDie)
        return rows.length
      }),
    )

    const cancel = Effect.fn("ScheduleService.cancel")((id: Schedule.ID) =>
      Effect.gen(function* () {
        const row = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
        if (!row) return undefined
        if (row.status !== "pending" && row.status !== "running") return toInfo(row)
        const updated = yield* db
          .update(ScheduleTable)
          .set({ status: "cancelled", time_updated: Date.now() })
          .where(
            and(
              eq(ScheduleTable.id, id),
              or(eq(ScheduleTable.status, "pending"), eq(ScheduleTable.status, "running")),
            ),
          )
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!updated) return toInfo(row)
        yield* publishSchedules({ db, events, sessionID: row.session_id })
        return toInfo(updated)
      }),
    )

    const claim = Effect.fn("ScheduleService.claim")((id: Schedule.ID, owner: string, now: number) =>
      Effect.gen(function* () {
        const row = yield* db
          .update(ScheduleTable)
          .set({ status: "running", lease_owner: owner, lease_expires_at: now + 5 * 60_000, time_updated: now })
          .where(and(eq(ScheduleTable.id, id), eq(ScheduleTable.status, "pending")))
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        yield* publishSchedules({ db, events, sessionID: row.session_id })
        return toInfo(row)
      }),
    )

    const settle = Effect.fn("ScheduleService.settle")((id: Schedule.ID, status: "completed" | "failed") =>
      Effect.gen(function* () {
        const row = yield* db
          .update(ScheduleTable)
          .set({ status, lease_owner: null, lease_expires_at: null, time_updated: Date.now() })
          .where(and(eq(ScheduleTable.id, id), eq(ScheduleTable.status, "running")))
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        yield* publishSchedules({ db, events, sessionID: row.session_id })
        return toInfo(row)
      }),
    )

    const recoverClaim = Effect.fn("ScheduleService.recoverClaim")((id: Schedule.ID) =>
      Effect.gen(function* () {
        const row = yield* db
          .update(ScheduleTable)
          .set({ status: "pending", lease_owner: null, lease_expires_at: null, time_updated: Date.now() })
          .where(eq(ScheduleTable.id, id))
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        yield* publishSchedules({ db, events, sessionID: row.session_id })
        return toInfo(row)
      }),
    )

    return Service.of({ create, list, listPending, countPending, cancel, claim, settle, recoverClaim })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(EventV2.defaultLayer))
export const node = LayerNode.make(layer, [Database.node, EventV2.node])

export interface DeliveryInterface {
  /**
   * Idempotent delivery: inserts the inbox record keyed by the schedule's
   * deliveryKey. A duplicate key (already delivered, offline catch-up after a
   * crash) resolves `false` without touching any row — the user-visible result
   * stays exactly-once.
   */
  readonly deliver: (input: {
    readonly deliveryKey: string
    readonly scheduleID: Schedule.ID
    readonly sessionID: SessionSchema.ID
    readonly kind: Schedule.ScheduleKind
    readonly content: string
    readonly deliveredAt: number
    readonly caughtUp: boolean
  }) => Effect.Effect<boolean>
  /** Inbox records of a session, newest first. */
  readonly listInbox: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Schedule.Delivery>>
  readonly markRead: (deliveryKey: string) => Effect.Effect<void>
  readonly countUnread: (sessionID: SessionSchema.ID) => Effect.Effect<number>
}

export class DeliveryService extends Context.Service<DeliveryService, DeliveryInterface>()(
  "@aigcfroge/v2/DeliveryService",
) {}

export const deliveryLayer = Layer.effect(
  DeliveryService,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const deliver = Effect.fn("DeliveryService.deliver")((input: {
      readonly deliveryKey: string
      readonly scheduleID: Schedule.ID
      readonly sessionID: SessionSchema.ID
      readonly kind: Schedule.ScheduleKind
      readonly content: string
      readonly deliveredAt: number
      readonly caughtUp: boolean
    }) =>
      Effect.gen(function* () {
        const result = yield* db
          .insert(DeliveryTable)
          .values({
            delivery_key: input.deliveryKey,
            schedule_id: input.scheduleID,
            session_id: input.sessionID,
            kind: input.kind,
            content: input.content,
            delivered_at: input.deliveredAt,
            caught_up: input.caughtUp,
            time_created: input.deliveredAt,
          })
          .onConflictDoNothing()
          .returning({ delivery_key: DeliveryTable.delivery_key })
          .all()
          .pipe(Effect.orDie)
        return result.length > 0
      }),
    )

    const listInbox = Effect.fn("DeliveryService.listInbox")((sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(DeliveryTable)
          .where(eq(DeliveryTable.session_id, sessionID))
          .orderBy(desc(DeliveryTable.delivered_at))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toDelivery)
      }),
    )

    const markRead = Effect.fn("DeliveryService.markRead")((deliveryKey: string) =>
      Effect.gen(function* () {
        yield* db
          .update(DeliveryTable)
          .set({ is_read: true })
          .where(eq(DeliveryTable.delivery_key, deliveryKey))
          .run()
          .pipe(Effect.orDie)
      }),
    )

    const countUnread = Effect.fn("DeliveryService.countUnread")((sessionID: SessionSchema.ID) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ delivery_key: DeliveryTable.delivery_key })
          .from(DeliveryTable)
          .where(and(eq(DeliveryTable.session_id, sessionID), eq(DeliveryTable.is_read, false)))
          .all()
          .pipe(Effect.orDie)
        return rows.length
      }),
    )

    return DeliveryService.of({ deliver, listInbox, markRead, countUnread })
  }),
)

export const deliveryDefaultLayer = deliveryLayer.pipe(Layer.provide(Database.defaultLayer))
export const deliveryNode = LayerNode.make(deliveryLayer, [Database.node])

const publishSchedules = Effect.fn("ScheduleService.publishSchedules")((input: {
  db: Database.Interface["db"]
  events: EventV2.Interface
  sessionID: SessionSchema.ID
}) =>
  Effect.gen(function* () {
    const rows = yield* input.db
      .select()
      .from(ScheduleTable)
      .where(eq(ScheduleTable.session_id, input.sessionID))
      .all()
      .pipe(Effect.orDie)
    yield* input.events.publish(Event.Updated, { sessionID: input.sessionID, schedules: rows.map(toInfo) })
  }),
)

/**
 * Build the SchedulerCore adapters over the Schedule/Delivery tables. Shared
 * by the production daemon and tests (which drive arm/tick directly to
 * simulate process restarts and crash recovery).
 */
export const makeAssistantCore = (input: {
  db: Database.Interface["db"]
  schedules: Interface
  events: EventV2.Interface
  recovered: Ref.Ref<Set<string>>
}) =>
  SchedulerCore.make({
    scan: () =>
      input.db
        .select()
        .from(ScheduleTable)
        .where(or(eq(ScheduleTable.status, "pending"), eq(ScheduleTable.status, "running")))
        .all()
        .pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((row) => ({
              id: row.id,
              // The Schedule vocabulary uses pending/running; the core only
              // distinguishes scheduled|pending (queued) from in_progress
              // (claimed) — translate running to in_progress so the startup
              // recover pass can reset stale claims.
              status: row.status === "running" ? "in_progress" : "pending",
              scheduledAt: row.next_attempt_at ?? row.due_at,
              recurrence: null,
            })),
          ),
        ),
    recover: (row) =>
      Effect.gen(function* () {
        yield* input.schedules.recoverClaim(row.id)
        yield* Ref.update(input.recovered, (set) => new Set(set).add(row.id))
      }),
    trigger: Effect.fn("AssistantScheduler.trigger")((id: string, now: number) =>
      Effect.gen(function* () {
        const outcome = yield* input.db
          .transaction((tx) =>
            Effect.gen(function* () {
              const row = yield* tx
                .select()
                .from(ScheduleTable)
                .where(eq(ScheduleTable.id, id as Schedule.ID))
                .get()
                .pipe(Effect.orDie)
              if (!row) return { skipped: true as const, sessionID: "" }
              if (row.status !== "pending") return { skipped: true as const, sessionID: "" }
              yield* tx
                .update(ScheduleTable)
                .set({
                  status: "running",
                  lease_owner: "assistant-scheduler",
                  lease_expires_at: now + 5 * 60_000,
                  time_updated: now,
                })
                .where(and(eq(ScheduleTable.id, id as Schedule.ID), eq(ScheduleTable.status, "pending")))
                .run()
              // Startup-recovery deliveries carry the caught-up marker so the
              // inbox can distinguish offline catch-up from normal delivery.
              const wasRecovered = yield* Ref.modify(input.recovered, (set) => {
                const had = set.has(id)
                const next = new Set(set)
                next.delete(id)
                return [had, next]
              })
              const inserted = yield* tx
                .insert(DeliveryTable)
                .values({
                  delivery_key: row.delivery_key,
                  schedule_id: row.id,
                  session_id: row.session_id,
                  kind: row.kind,
                  content: row.content,
                  delivered_at: now,
                  caught_up: wasRecovered,
                  time_created: now,
                })
                .onConflictDoNothing()
                .returning({ delivery_key: DeliveryTable.delivery_key })
                .all()
              const delivered = inserted.length > 0
              yield* tx
                .update(ScheduleTable)
                .set({ status: "completed", lease_owner: null, lease_expires_at: null, time_updated: now })
                .where(eq(ScheduleTable.id, id as Schedule.ID))
                .run()
              return {
                skipped: false as const,
                delivered,
                wasRecovered,
                sessionID: row.session_id,
                kind: row.kind,
                content: row.content,
                deliveryKey: row.delivery_key,
              }
            }),
          )
          .pipe(
            // A failed transaction (infrastructure fault) rolls the claim
            // back: the row stays pending and retries with bounded backoff
            // (PRD §7.2); past the limit the row settles failed.
            Effect.catch((error) =>
              Effect.gen(function* () {
                yield* Effect.logError("Assistant schedule delivery transaction failed", error)
                const row = yield* input.db
                  .select()
                  .from(ScheduleTable)
                  .where(eq(ScheduleTable.id, id as Schedule.ID))
                  .get()
                  .pipe(Effect.orDie)
                if (!row) return { skipped: true as const, sessionID: "" }
                const attempts = row.attempts + 1
                if (attempts >= MAX_DELIVERY_ATTEMPTS) {
                  yield* input.schedules.settle(row.id, "failed")
                } else {
                  yield* input.db
                    .update(ScheduleTable)
                    .set({ attempts, next_attempt_at: now + backoff(attempts), time_updated: now })
                    .where(eq(ScheduleTable.id, id as Schedule.ID))
                    .run()
                    .pipe(Effect.orDie)
                  yield* publishSchedules({ db: input.db, events: input.events, sessionID: row.session_id })
                }
                return { skipped: true as const, sessionID: "" }
              }),
            ),
            Effect.orDie,
          )
        if (outcome.skipped) return
        if (outcome.delivered) {
          yield* input.events.publish(Event.Delivered, {
            sessionID: outcome.sessionID,
            delivery: {
              deliveryKey: outcome.deliveryKey,
              scheduleID: id as Schedule.ID,
              sessionID: outcome.sessionID,
              kind: outcome.kind,
              content: outcome.content,
              deliveredAt: now,
              caughtUp: outcome.wasRecovered,
              createdAt: now,
            },
          })
        }
        yield* publishSchedules({ db: input.db, events: input.events, sessionID: outcome.sessionID })
      }),
    ),
  })

/**
 * Startup catch-up pass: mark every overdue pending row as a recovery
 * delivery (PRD §6 step 7: process restart scans overdue pending rows and
 * re-delivers with the same idempotency key). The marked rows carry the
 * `caught_up` inbox flag so the UI can distinguish offline catch-up.
 */
export const markCatchUp = Effect.fn("AssistantScheduler.markCatchUp")((input: {
  db: Database.Interface["db"]
  recovered: Ref.Ref<Set<string>>
  now: number
}) =>
  Effect.gen(function* () {
    const rows = yield* input.db
      .select({ id: ScheduleTable.id })
      .from(ScheduleTable)
      .where(
        and(
          eq(ScheduleTable.status, "pending"),
          or(lt(ScheduleTable.due_at, input.now), lt(ScheduleTable.next_attempt_at, input.now)),
        ),
      )
      .all()
      .pipe(Effect.orDie)
    yield* Ref.update(input.recovered, (set) => new Set([...set, ...rows.map((row) => row.id)]))
  }),
)

/**
 * Production daemon: rides SchedulerCore over the Schedule table. Startup
 * recovery resets stale `running` claims (dead scheduler) to pending and marks
 * those rows' deliveries `caught_up`; ticks every minute; re-arms on every
 * `schedule.updated`. Claim + deliver + settle are one transaction (PRD §7.1:
 * cancel-vs-delivery concurrency locked by transaction): a cancel either lands
 * before this transaction (status no longer pending → no delivery) or after it
 * (settle completed → cancel's conditional update is a no-op), so a cancelled
 * schedule can never deliver.
 */
export const daemonLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const schedules = yield* Service
    const events = yield* EventV2.Service
    const recovered = yield* Ref.make(new Set<string>())

    const core = yield* makeAssistantCore({ db, schedules, events, recovered })

    yield* SchedulerCore.daemon({
      core,
      startupSweep: markCatchUp({ db, recovered, now: Date.now() }),
      rearmSignals: events.subscribe(Event.Updated),
    })
  }),
)

export const daemonNode = LayerNode.make(daemonLayer, [node, deliveryNode, Database.node, EventV2.node])
