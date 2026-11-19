export * as ScheduleRule from "./schedule-rule.js"

import { and, desc, eq, isNull, or, sql } from "drizzle-orm"
import { DateTime, Effect, Option, Schema, Semaphore } from "effect"
import { SqlError } from "effect/sql/SqlError"
import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { Schedule } from "@aigcfroge/schema/schedule"
import { SessionID } from "@aigcfroge/schema/session-id"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { Agent } from "@aigcfroge/schema/agent"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { DelegationFold } from "../delegation/fold.js"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { DeliveryTable, ScheduleOccurrenceTable, ScheduleTable } from "./schedule.sql.js"
import { nextRun } from "./schedule.js"
import { KVTable } from "../kv/sql.js"
import { CompositionDigest } from "../composition/digest.js"
import { Hash } from "@aigcfroge/util/hash"

type Row = typeof ScheduleTable.$inferSelect
type ReadDatabase = Database.Interface["db"]

export class ScheduleError extends Schema.TaggedError<ScheduleError>()("Schedule.Error", {
  scheduleID: Schema.optional(Schedule.ID),
  reason: Schema.Literals([
    "missing",
    "stale_revision",
    "invalid_trigger",
    "invalid_target",
    "invalid_timezone",
    "terminal",
    "overlap",
    "occurrence_missing",
    "conflicting_retry",
  ]),
  message: Schema.String,
}) {}

class ClaimConflict extends Schema.TaggedError<ClaimConflict>()("Schedule.ClaimConflict", {}) {}
class ReminderCancelled extends Schema.TaggedError<ReminderCancelled>()("Schedule.ReminderCancelled", {}) {}
class ToolCreate extends Schema.Class<ToolCreate>("Schedule.ToolCreate")({ id: Schedule.ID, digest: Schema.String }) {}

export const defaultPolicy = new Schedule.ExecutionPolicy({ delivery: "queue", missed: "catch_up" })

export const fromRow = (row: Row) =>
  new Schedule.Rule({
    id: row.id,
    sessionID: row.session_id,
    kind: row.kind,
    content: row.content,
    dueAt: row.due_at,
    timezone: row.timezone,
    recurrence: row.recurrence ?? undefined,
    target: row.target ? Schema.decodeUnknownSync(Schedule.Target)(row.target) : undefined,
    executionPolicy: row.execution_policy
      ? Schema.decodeUnknownSync(Schedule.ExecutionPolicy)(row.execution_policy)
      : defaultPolicy,
    sourceAgent: row.source_agent ?? undefined,
    taskID: row.task_id ?? undefined,
    revision: row.revision,
    status: row.status === "running" ? "pending" : row.status,
    nextDueAt:
      row.next_due_at ??
      ((row.status === "pending" || row.status === "running") && !row.active_occurrence_id
        ? (row.next_attempt_at ?? row.due_at)
        : undefined),
    activeOccurrenceID: row.active_occurrence_id ?? undefined,
    boundTargetSessionID: row.bound_target_session_id ?? undefined,
    error: row.last_error ? Schema.decodeUnknownSync(Schedule.ErrorInfo)(row.last_error) : undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })

const columns = (rule: Schedule.Rule) => ({
  id: rule.id,
  session_id: rule.sessionID,
  kind: rule.kind,
  content: rule.content,
  due_at: rule.dueAt,
  timezone: rule.timezone,
  status: rule.status,
  revision: rule.revision,
  recurrence: rule.recurrence ?? null,
  target: rule.target ? Schema.encodeSync(Schedule.Target)(rule.target) : null,
  execution_policy: Schema.encodeSync(Schedule.ExecutionPolicy)(rule.executionPolicy),
  source_agent: rule.sourceAgent ?? null,
  task_id: rule.taskID ?? null,
  next_due_at: rule.nextDueAt ?? null,
  active_occurrence_id: rule.activeOccurrenceID ?? null,
  bound_target_session_id: rule.boundTargetSessionID ?? null,
  last_error: rule.error ? Schema.encodeSync(Schedule.ErrorInfo)(rule.error) : null,
  delivery_key: `schedule:${rule.id}`,
  time_created: rule.createdAt,
  time_updated: rule.updatedAt,
})

export const get = Effect.fn("ScheduleRule.get")(function* (db: ReadDatabase, id: Schedule.ID) {
  const row = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
  return row ? fromRow(row) : undefined
})

export const occurrence = Effect.fn("ScheduleRule.occurrence")(function* (db: ReadDatabase, id: Schedule.OccurrenceID) {
  const row = yield* db
    .select({ data: ScheduleOccurrenceTable.data })
    .from(ScheduleOccurrenceTable)
    .where(eq(ScheduleOccurrenceTable.id, id))
    .get()
    .pipe(Effect.orDie)
  return row ? Schema.decodeUnknownSync(Schedule.Occurrence)(row.data) : undefined
})

export const storeOccurrence = Effect.fn("ScheduleRule.storeOccurrence")(function* (
  db: ReadDatabase,
  run: Schedule.Occurrence,
) {
  yield* db
    .insert(ScheduleOccurrenceTable)
    .values({
      id: run.id,
      schedule_id: run.scheduleID,
      rule_revision: run.ruleRevision,
      scheduled_at: run.scheduledAt,
      status: run.status,
      target_session_id: run.targetSessionID ?? null,
      input_id: run.inputID,
      operation_id: run.operationID,
      data: Schema.encodeSync(Schedule.Occurrence)(run),
      time_created: run.createdAt,
      time_updated: run.updatedAt,
    })
    .onConflictDoUpdate({
      target: ScheduleOccurrenceTable.id,
      set: {
        status: run.status,
        target_session_id: run.targetSessionID ?? null,
        data: Schema.encodeSync(Schedule.Occurrence)(run),
        time_updated: run.updatedAt,
      },
    })
    .run()
    .pipe(Effect.orDie)
})

export const projectCreated = Effect.fn("ScheduleRule.projectCreated")(function* (
  db: ReadDatabase,
  data: typeof Schedule.RuleCreated.Type.data,
) {
  yield* db.insert(ScheduleTable).values(columns(data.rule)).onConflictDoNothing().run().pipe(Effect.orDie)
})

export const projectChanged = Effect.fn("ScheduleRule.projectChanged")(function* (
  db: ReadDatabase,
  data: typeof Schedule.RuleChanged.Type.data,
  updatedAt: number,
) {
  const rule = yield* get(db, data.scheduleID)
  if (!rule || rule.revision >= data.revision) return
  const change = data.change
  const updated = new Schedule.Rule({
    ...rule,
    ...change,
    recurrence: change.recurrence === null ? undefined : (change.recurrence ?? rule.recurrence),
    target: change.target === null ? undefined : (change.target ?? rule.target),
    taskID: change.taskID === null ? undefined : (change.taskID ?? rule.taskID),
    nextDueAt: change.nextDueAt === null ? undefined : (change.nextDueAt ?? rule.nextDueAt),
    activeOccurrenceID:
      change.activeOccurrenceID === null ? undefined : (change.activeOccurrenceID ?? rule.activeOccurrenceID),
    boundTargetSessionID:
      change.boundTargetSessionID === null ? undefined : (change.boundTargetSessionID ?? rule.boundTargetSessionID),
    error: change.error === null ? undefined : (change.error ?? rule.error),
    revision: data.revision,
    updatedAt,
  })
  yield* db.update(ScheduleTable).set(columns(updated)).where(eq(ScheduleTable.id, updated.id)).run().pipe(Effect.orDie)
})

export const projectClaimed = Effect.fn("ScheduleRule.projectClaimed")(function* (
  db: ReadDatabase,
  data: typeof Schedule.OccurrenceClaimed.Type.data,
) {
  const run = data.occurrence
  if (yield* occurrence(db, run.id)) return
  yield* storeOccurrence(db, run)
  const following = run.snapshot.recurrence?.enabled
    ? nextRun(
        run.snapshot.recurrence.cron,
        Math.max(run.scheduledAt, run.claimedAt),
        run.snapshot.recurrence.timezone ?? run.snapshot.timezone,
      )
    : undefined
  yield* db
    .update(ScheduleTable)
    .set({ active_occurrence_id: run.id, next_due_at: following ?? null, time_updated: run.claimedAt })
    .where(
      and(
        eq(ScheduleTable.id, run.scheduleID),
        eq(ScheduleTable.revision, run.ruleRevision),
        isNull(ScheduleTable.active_occurrence_id),
      ),
    )
    .run()
    .pipe(Effect.orDie)
})

const terminal = (status: Schedule.OccurrenceStatus) =>
  status === "completed" ||
  status === "failed" ||
  status === "cancelled" ||
  status === "blocked" ||
  status === "skipped"

export const projectOccurrenceChanged = Effect.fn("ScheduleRule.projectOccurrenceChanged")(function* (
  db: ReadDatabase,
  data: typeof Schedule.OccurrenceChanged.Type.data,
  updatedAt: number,
) {
  const run = yield* occurrence(db, data.occurrenceID)
  if (!run) return
  const updated = new Schedule.Occurrence({
    ...run,
    ...data.change,
    error: data.change.error === null ? undefined : (data.change.error ?? run.error),
    updatedAt,
  })
  yield* storeOccurrence(db, updated)
  if (!terminal(updated.status)) return
  const rule = yield* get(db, run.scheduleID)
  if (!rule || rule.activeOccurrenceID !== run.id) return
  const oneShot = !rule.recurrence?.enabled
  const status =
    rule.status === "pending" && oneShot && (rule.revision === run.ruleRevision || rule.nextDueAt === undefined)
      ? updated.status === "completed" || updated.status === "skipped"
        ? "completed"
        : updated.status === "cancelled"
          ? "cancelled"
          : "failed"
      : rule.status
  yield* db
    .update(ScheduleTable)
    .set({
      active_occurrence_id: null,
      status,
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at: null,
      ...(status !== "pending" ? { next_due_at: null } : {}),
      time_updated: updatedAt,
    })
    .where(and(eq(ScheduleTable.id, rule.id), eq(ScheduleTable.active_occurrence_id, run.id)))
    .run()
    .pipe(Effect.orDie)
})

export interface Interface {
  readonly create: (
    input: Schedule.Create,
    sourceAgent?: Agent.ID,
    source?: { readonly messageID: SessionMessage.ID; readonly id: string },
  ) => Effect.Effect<Schedule.Rule, ScheduleError>
  readonly get: (id: Schedule.ID) => Effect.Effect<Schedule.Rule | undefined>
  readonly list: (sessionID?: SessionID, pending?: boolean) => Effect.Effect<readonly Schedule.Rule[]>
  readonly edit: (id: Schedule.ID, input: Schedule.Edit) => Effect.Effect<Schedule.Rule, ScheduleError>
  readonly pause: (id: Schedule.ID, expectedRevision: number) => Effect.Effect<Schedule.Rule, ScheduleError>
  readonly resume: (id: Schedule.ID, expectedRevision: number) => Effect.Effect<Schedule.Rule, ScheduleError>
  readonly cancel: (id: Schedule.ID, expectedRevision: number) => Effect.Effect<Schedule.Rule, ScheduleError>
  readonly claim: (
    id: Schedule.ID,
    now: number,
    owner: string,
    manual?: boolean,
    caughtUp?: boolean,
  ) => Effect.Effect<Schedule.Occurrence | undefined>
  readonly occurrence: (id: Schedule.OccurrenceID) => Effect.Effect<Schedule.Occurrence | undefined>
  readonly runs: (id: Schedule.ID) => Effect.Effect<readonly Schedule.Occurrence[]>
  readonly unsettled: () => Effect.Effect<readonly Schedule.Occurrence[]>
  readonly advance: (
    id: Schedule.OccurrenceID,
    change: Schedule.OccurrenceChange,
  ) => Effect.Effect<Schedule.Occurrence, ScheduleError>
  readonly bindTask: (id: Schedule.ID, taskID: string) => Effect.Effect<void, ScheduleError>
  readonly deliver: (
    id: Schedule.OccurrenceID,
    now: number,
    caughtUp?: boolean,
  ) => Effect.Effect<Schedule.Occurrence, ScheduleError>
}

const dueAfter = (
  input: { dueAt?: number; recurrence?: SessionTask.TaskRecurrence | null; timezone: string },
  now: number,
) =>
  input.recurrence?.enabled
    ? nextRun(input.recurrence.cron, now, input.recurrence.timezone ?? input.timezone)
    : input.dueAt

const validate = (
  input: {
    kind: Schedule.Kind
    target?: Schedule.Target
    dueAt?: number
    recurrence?: SessionTask.TaskRecurrence | null
    timezone: string
  },
  now: number,
) => {
  if (Option.isNone(DateTime.zoneMakeNamed(input.timezone)))
    return new ScheduleError({ reason: "invalid_timezone", message: "A named IANA timezone is required" })
  if (
    (input.kind === "reminder" && input.target) ||
    (input.kind === "goal" && input.target?.policy !== "goal") ||
    ((input.kind === "prompt" || input.kind === "task") && (!input.target || input.target.policy === "goal"))
  )
    return new ScheduleError({
      reason: "invalid_target",
      message: "The rule kind requires a matching execution target",
    })
  const due = dueAfter(input, now)
  if (due === undefined || !Number.isSafeInteger(due) || due <= 0)
    return new ScheduleError({
      reason: "invalid_trigger",
      message: "The rule requires an absolute due time or a valid enabled recurrence",
    })
  return due
}

export const make = Effect.fn("ScheduleRule.make")(function* (db: ReadDatabase, events: Bus.Interface) {
  const lock = yield* Semaphore.make(1)
  yield* events.project(Schedule.RuleCreated, (event) => projectCreated(db, event.data))
  yield* events.project(Schedule.RuleChanged, (event) => projectChanged(db, event.data, event.created))
  yield* events.project(Schedule.OccurrenceClaimed, (event) => projectClaimed(db, event.data))
  yield* events.project(Schedule.OccurrenceChanged, (event) => projectOccurrenceChanged(db, event.data, event.created))

  const publishRule = Effect.fnUntraced(function* (id: Schedule.ID) {
    const rule = yield* get(db, id)
    if (rule) yield* events.publish(Schedule.RuleUpdated, { sessionID: rule.sessionID, rule })
    return rule
  })
  const mutate = Effect.fnUntraced(function* (id: Schedule.ID, expectedRevision: number, change: Schedule.RuleChange) {
    const rule = yield* get(db, id)
    if (!rule) return yield* new ScheduleError({ scheduleID: id, reason: "missing", message: "Schedule not found" })
    if (rule.revision !== expectedRevision)
      return yield* new ScheduleError({
        scheduleID: id,
        reason: "stale_revision",
        message: "The rule changed; reload its current revision",
      })
    yield* events.publish(Schedule.RuleChanged, {
      sessionID: rule.sessionID,
      scheduleID: id,
      revision: rule.revision + 1,
      change,
    })
    return (yield* publishRule(id)) ?? rule
  })
  const setStatus = (id: Schedule.ID, expectedRevision: number, status: "paused" | "pending" | "cancelled") =>
    lock.withPermit(
      Effect.gen(function* () {
        const rule = yield* get(db, id)
        if (!rule) return yield* new ScheduleError({ scheduleID: id, reason: "missing", message: "Schedule not found" })
        if (
          status !== "cancelled" &&
          (rule.status === "cancelled" || (rule.status === "completed" && !rule.recurrence?.enabled))
        )
          return yield* new ScheduleError({
            scheduleID: id,
            reason: "terminal",
            message: "This terminal rule cannot be resumed",
          })
        const now = (yield* DateTime.nowAsDate).getTime()
        const due = status === "pending" ? dueAfter(rule, now) : undefined
        if (status === "pending" && due === undefined)
          return yield* new ScheduleError({
            scheduleID: id,
            reason: "invalid_trigger",
            message: "The recurrence has no future occurrence",
          })
        return yield* mutate(id, expectedRevision, new Schedule.RuleChange({ status, nextDueAt: due ?? null }))
      }),
    )

  const api: Interface = {
    get: (id) => get(db, id),
    occurrence: (id) => occurrence(db, id),
    list: Effect.fn("ScheduleRule.list")(function* (sessionID, pending) {
      const rows = yield* db
        .select()
        .from(ScheduleTable)
        .where(
          and(
            sessionID ? eq(ScheduleTable.session_id, sessionID) : undefined,
            pending ? or(eq(ScheduleTable.status, "pending"), eq(ScheduleTable.status, "running")) : undefined,
          ),
        )
        .orderBy(ScheduleTable.due_at)
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    }),
    create: (input, sourceAgent, source) =>
      lock.withPermit(
        Effect.gen(function* () {
          const key = source
            ? `schedule:create:${Hash.sha256(JSON.stringify([input.sessionID, source.messageID, source.id]))}`
            : undefined
          const digest = CompositionDigest.computeDigest({
            input: Schema.encodeSync(Schedule.Create)(input),
            sourceAgent,
          })
          if (key) {
            const saved = yield* db
              .select({ value: KVTable.value })
              .from(KVTable)
              .where(eq(KVTable.key, key))
              .get()
              .pipe(Effect.orDie)
            if (saved) {
              const intent = Schema.decodeUnknownSync(ToolCreate)(saved.value)
              if (intent.digest !== digest)
                return yield* new ScheduleError({
                  scheduleID: intent.id,
                  reason: "conflicting_retry",
                  message: "The original schedule Tool invocation has a different saved request",
                })
              const rule = yield* get(db, intent.id)
              if (!rule)
                return yield* new ScheduleError({
                  scheduleID: intent.id,
                  reason: "missing",
                  message: "The saved schedule was removed",
                })
              return rule
            }
          }
          const now = (yield* DateTime.nowAsDate).getTime()
          const due = validate(input, now)
          if (due instanceof ScheduleError) return yield* due
          const rule = new Schedule.Rule({
            ...input,
            id: key ? Schedule.ID.make(`sch_tool_${Hash.sha256(key)}`) : Schedule.ID.create(),
            dueAt: input.dueAt ?? due,
            executionPolicy: input.executionPolicy ?? defaultPolicy,
            sourceAgent,
            revision: 1,
            status: "pending",
            nextDueAt: due,
            boundTargetSessionID: input.target?.policy === "new_once" ? SessionID.create() : undefined,
            createdAt: now,
            updatedAt: now,
          })
          yield* events.publish(
            Schedule.RuleCreated,
            { sessionID: input.sessionID, rule },
            key
              ? {
                  commit: () =>
                    db
                      .insert(KVTable)
                      .values({ key, value: Schema.encodeSync(ToolCreate)(new ToolCreate({ id: rule.id, digest })) })
                      .run()
                      .pipe(Effect.asVoid, Effect.orDie),
                }
              : undefined,
          )
          yield* publishRule(rule.id)
          return rule
        }),
      ),
    edit: (id, input) =>
      lock.withPermit(
        Effect.gen(function* () {
          const rule = yield* get(db, id)
          if (!rule)
            return yield* new ScheduleError({ scheduleID: id, reason: "missing", message: "Schedule not found" })
          const now = (yield* DateTime.nowAsDate).getTime()
          const recurrence = input.recurrence === null ? undefined : (input.recurrence ?? rule.recurrence)
          const merged = { ...rule, ...input, recurrence }
          const due = validate(merged, now)
          if (due instanceof ScheduleError) return yield* due
          const targetChanged =
            input.target &&
            !isDeepStrictEqual(
              Schema.encodeSync(Schedule.Target)(input.target),
              rule.target ? Schema.encodeSync(Schedule.Target)(rule.target) : undefined,
            )
          return yield* mutate(
            id,
            input.expectedRevision,
            new Schedule.RuleChange({
              ...input,
              nextDueAt: rule.status === "pending" ? due : null,
              ...(targetChanged
                ? { boundTargetSessionID: input.target?.policy === "new_once" ? SessionID.create() : null }
                : {}),
            }),
          )
        }),
      ),
    pause: (id, revision) => setStatus(id, revision, "paused"),
    resume: (id, revision) => setStatus(id, revision, "pending"),
    cancel: (id, revision) => setStatus(id, revision, "cancelled"),
    claim: (id, now, owner, manual, caughtUp) =>
      lock
        .withPermit(
          Effect.gen(function* () {
            const row = yield* db.select().from(ScheduleTable).where(eq(ScheduleTable.id, id)).get().pipe(Effect.orDie)
            const rule = row ? fromRow(row) : undefined
            if (!rule || rule.status !== "pending" || rule.activeOccurrenceID) return
            const due = manual ? now : rule.nextDueAt
            if (due === undefined || due > now) return
            const hash = createHash("sha256")
              .update(JSON.stringify([id, rule.revision, due]))
              .digest("hex")
            const runID = Schedule.OccurrenceID.make(`sco_${hash}`)
            const existing = yield* occurrence(db, runID)
            if (existing) return existing
            const targetID =
              rule.target?.policy === "existing"
                ? rule.target.sessionID
                : rule.target?.policy === "new_once"
                  ? rule.boundTargetSessionID
                  : rule.target?.policy === "new"
                    ? SessionID.make(`ses_schedule_${hash}`)
                    : rule.target?.policy === "legacy_child"
                      ? SessionID.make(`ses_delegation_par_schedule_${hash}`)
                      : undefined
            const participantID = ParticipantID.make(`par_schedule_${hash}`)
            const inputID =
              rule.target?.policy === "legacy_child"
                ? DelegationFold.inputID(DelegationID.ID.make(`dlg_schedule_${hash}`), {
                    turnID: TurnID.make(`trn_schedule_${hash}`),
                    participantID,
                    deliveryOrigin: `schedule:${runID}`,
                    senderParticipantID: participantID,
                    attempt: 1,
                  })
                : SessionMessage.ID.make(`msg_schedule_${hash}`)
            const run = new Schedule.Occurrence({
              id: runID,
              scheduleID: id,
              sessionID: rule.sessionID,
              ruleRevision: rule.revision,
              snapshot: rule,
              scheduledAt: due,
              claimedAt: now,
              claimOwner: owner,
              caughtUp: caughtUp ?? due < now,
              missedUntil: (caughtUp ?? due < now) ? now : undefined,
              status: "claimed",
              inputID,
              operationID: SessionTask.OperationID.make(`top_schedule_${hash}`),
              targetSessionID: targetID,
              taskID: rule.taskID,
              sourceSettlement: rule.kind === "reminder" || rule.kind === "goal" ? undefined : "pending",
              deliveryKey:
                rule.kind === "reminder"
                  ? rule.recurrence?.enabled
                    ? `schedule:${id}:${rule.revision}:${due}`
                    : row?.delivery_key
                  : undefined,
              legacyDelivery: rule.kind === "reminder" && row?.execution_policy === null ? true : undefined,
              legacyClaim:
                row?.status === "running"
                  ? new Schedule.LegacyReminderClaim({
                      owner: row.lease_owner ?? undefined,
                      expiresAt: row.lease_expires_at ?? undefined,
                      attempts: row.attempts,
                      nextAttemptAt: row.next_attempt_at ?? undefined,
                    })
                  : undefined,
              createdAt: now,
              updatedAt: now,
            })
            yield* events.publish(
              Schedule.OccurrenceClaimed,
              { sessionID: rule.sessionID, occurrence: run },
              {
                commit: () =>
                  Effect.gen(function* () {
                    const claimed = yield* get(db, id)
                    const saved = yield* occurrence(db, runID)
                    if (claimed?.activeOccurrenceID !== runID || saved?.claimOwner !== owner)
                      return yield* Effect.die(new ClaimConflict())
                  }),
              },
            )
            yield* events.publish(Schedule.OccurrenceUpdated, { sessionID: run.sessionID, occurrence: run })
            yield* publishRule(id)
            return run
          }),
        )
        .pipe(
          Effect.catchDefect((defect) =>
            defect instanceof ClaimConflict ? Effect.succeed(undefined) : Effect.die(defect),
          ),
        ),
    runs: Effect.fn("ScheduleRule.runs")(function* (id) {
      const rows = yield* db
        .select({ data: ScheduleOccurrenceTable.data })
        .from(ScheduleOccurrenceTable)
        .where(eq(ScheduleOccurrenceTable.schedule_id, id))
        .orderBy(desc(ScheduleOccurrenceTable.time_created), desc(ScheduleOccurrenceTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => Schema.decodeUnknownSync(Schedule.Occurrence)(row.data))
    }),
    unsettled: Effect.fn("ScheduleRule.unsettled")(function* () {
      const rows = yield* db
        .select({ data: ScheduleOccurrenceTable.data })
        .from(ScheduleOccurrenceTable)
        .where(
          or(
            eq(ScheduleOccurrenceTable.status, "claimed"),
            eq(ScheduleOccurrenceTable.status, "admitted"),
            eq(ScheduleOccurrenceTable.status, "running"),
            eq(ScheduleOccurrenceTable.status, "recovery_required"),
            sql`json_extract(${ScheduleOccurrenceTable.data}, '$.sourceSettlement') = 'pending'`,
          ),
        )
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => Schema.decodeUnknownSync(Schedule.Occurrence)(row.data))
    }),
    advance: (id, change) =>
      lock.withPermit(
        Effect.gen(function* () {
          const run = yield* occurrence(db, id)
          if (!run)
            return yield* new ScheduleError({ reason: "occurrence_missing", message: "Schedule occurrence not found" })
          if (terminal(run.status) && change.status !== undefined && change.status !== run.status) return run
          const current = new Map(Object.entries(Schema.encodeSync(Schedule.Occurrence)(run)))
          if (
            Object.entries(Schema.encodeSync(Schedule.OccurrenceChange)(change)).every(([key, value]) =>
              isDeepStrictEqual(key === "error" && value === null ? undefined : value, current.get(key)),
            )
          )
            return run
          yield* events.publish(Schedule.OccurrenceChanged, { sessionID: run.sessionID, occurrenceID: id, change })
          const updated = (yield* occurrence(db, id)) ?? run
          yield* events.publish(Schedule.OccurrenceUpdated, { sessionID: run.sessionID, occurrence: updated })
          yield* publishRule(run.scheduleID)
          return updated
        }),
      ),
    bindTask: (id, taskID) =>
      lock.withPermit(
        Effect.gen(function* () {
          const rule = yield* get(db, id)
          if (!rule)
            return yield* new ScheduleError({ scheduleID: id, reason: "missing", message: "Schedule not found" })
          if (rule.taskID === taskID) return
          if (rule.taskID)
            return yield* new ScheduleError({
              scheduleID: id,
              reason: "invalid_target",
              message: "Schedule already belongs to a different Task",
            })
          yield* mutate(id, rule.revision, new Schedule.RuleChange({ taskID }))
        }),
      ),
    deliver: (id, now, caughtUp) =>
      lock.withPermit(
        Effect.gen(function* () {
          const run = yield* occurrence(db, id)
          if (!run)
            return yield* new ScheduleError({ reason: "occurrence_missing", message: "Schedule occurrence not found" })
          if (terminal(run.status)) return run
          const deliveryKey = run.deliveryKey
          if (run.snapshot.kind !== "reminder" || !deliveryKey)
            return yield* new ScheduleError({
              scheduleID: run.scheduleID,
              reason: "invalid_target",
              message: "Delivery requires a reminder occurrence",
            })
          const delivery = new Schedule.Delivery({
            deliveryKey,
            scheduleID: run.scheduleID,
            sessionID: run.sessionID,
            kind: "reminder",
            content: run.snapshot.content,
            deliveredAt: now,
            caughtUp: caughtUp ?? run.caughtUp,
            createdAt: now,
          })
          const inserted: string[] = []
          yield* events
            .publish(
              Schedule.OccurrenceChanged,
              {
                sessionID: run.sessionID,
                occurrenceID: id,
                change: new Schedule.OccurrenceChange({ status: "completed", completedAt: now, error: null }),
              },
              {
                commit: () =>
                  Effect.gen(function* () {
                    const rule = yield* get(db, run.scheduleID)
                    const current = yield* occurrence(db, run.id)
                    if (current?.cancelRequested || (rule?.status === "cancelled" && run.legacyDelivery))
                      return yield* Effect.die(new ReminderCancelled())
                    const rows = yield* db
                      .insert(DeliveryTable)
                      .values({
                        delivery_key: deliveryKey,
                        schedule_id: delivery.scheduleID,
                        session_id: run.sessionID,
                        kind: "reminder",
                        content: delivery.content,
                        delivered_at: now,
                        caught_up: delivery.caughtUp,
                        time_created: now,
                      })
                      .onConflictDoNothing()
                      .returning({ key: DeliveryTable.delivery_key })
                      .all()
                      .pipe(Effect.orDie)
                    inserted.push(...rows.map((row) => row.key))
                  }),
              },
            )
            .pipe(
              Effect.catchDefect((error) => {
                if (error instanceof ReminderCancelled)
                  return events
                    .publish(Schedule.OccurrenceChanged, {
                      sessionID: run.sessionID,
                      occurrenceID: id,
                      change: new Schedule.OccurrenceChange({ status: "cancelled", completedAt: now }),
                    })
                    .pipe(Effect.asVoid)
                if (!(error instanceof SqlError)) return Effect.die(error)
                return Effect.gen(function* () {
                  const row = yield* db
                    .select()
                    .from(ScheduleTable)
                    .where(eq(ScheduleTable.id, run.scheduleID))
                    .get()
                    .pipe(Effect.orDie)
                  const attempts = (row?.attempts ?? 0) + 1
                  const failed = attempts >= 5
                  yield* db
                    .update(ScheduleTable)
                    .set({
                      attempts,
                      next_attempt_at: failed ? null : now + Math.min(2 ** (attempts - 1), 60) * 60_000,
                      time_updated: now,
                    })
                    .where(eq(ScheduleTable.id, run.scheduleID))
                    .run()
                    .pipe(Effect.orDie)
                  yield* events.publish(Schedule.OccurrenceChanged, {
                    sessionID: run.sessionID,
                    occurrenceID: id,
                    change: new Schedule.OccurrenceChange({
                      status: failed ? "failed" : "claimed",
                      error: new Schedule.ErrorInfo({ code: "delivery_sql_error", message: error.message }),
                      ...(failed ? { completedAt: now } : {}),
                    }),
                  })
                })
              }),
            )
          if (inserted.length) yield* events.publish(Schedule.Delivered, { sessionID: run.sessionID, delivery })
          const updated = (yield* occurrence(db, id)) ?? run
          yield* events.publish(Schedule.OccurrenceUpdated, { sessionID: run.sessionID, occurrence: updated })
          yield* publishRule(run.scheduleID)
          return updated
        }),
      ),
  }
  return api
})
