export * as TaskOperation from "./task-operation.js"

import { and, asc, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { SessionTaskEvent } from "@aigcfroge/schema/session-task-event"
import { SessionInbox } from "@aigcfroge/schema/session-inbox"
import { Permission } from "@aigcfroge/schema/permission"
import { Event } from "@aigcfroge/schema/event"
import type { SessionEvent } from "@aigcfroge/schema/session-event"
import { Database } from "../database/database.js"
import { SessionSchema } from "./schema.js"
import { SessionConsultationTable, SessionInboxTable, SessionMessageTable, TaskOperationTable } from "./sql.js"

export class OperationConflictError extends Schema.TaggedError<OperationConflictError>()(
  "SessionTask.OperationConflictError",
  {
    sessionID: SessionSchema.ID,
    operationID: SessionTask.OperationID,
    reason: Schema.Literals([
      "request_changed",
      "source_changed",
      "input_owned",
      "phase_changed",
      "task_missing",
      "operation_missing",
    ]),
  },
) {}

type DatabaseService = Database.Interface["db"]
export type Ref = { readonly sessionID: SessionSchema.ID; readonly operationID: SessionTask.OperationID }

/** An unknown external outcome retains its input without admitting another automatic attempt. */
export const inputDeferred = eq(TaskOperationTable.phase, "recovery_required")

/** Operation IDs are unique within their source Session, while message and permission IDs are process-wide. */
const identityDigest = (input: Ref) =>
  createHash("sha256")
    .update(JSON.stringify([input.sessionID, input.operationID]))
    .digest("hex")

export const statusMessageID = (input: Ref) => SessionMessage.ID.make(`msg_task_${identityDigest(input)}`)
export const permissionID = (input: Ref) => Permission.ID.make(`per_task_${identityDigest(input)}`)
export const notificationID = (input: Ref) => SessionMessage.ID.make(`msg_task_result_${identityDigest(input)}`)

/** Canonical request encoding keeps object key order out of exact-retry identity. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
      .map((entry) => `${JSON.stringify(entry[0])}:${canonical(entry[1])}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}

export const requestDigest = (request: SessionTask.OperationRequest) =>
  SessionTask.OperationDigest.make(
    createHash("sha256")
      .update(canonical(Schema.encodeSync(SessionTask.OperationRequest)(request)))
      .digest("hex"),
  )

export const permissionSource = (operation: SessionTask.OperationInfo) =>
  operation.source.type === "model_tool"
    ? { type: "tool" as const, messageID: operation.source.messageID, id: operation.source.id }
    : new Permission.OperationSource({
        type: "operation",
        sessionID: operation.sourceSessionID,
        operationID: operation.operationID,
      })

export const payloadDigest = (payload: SessionInbox.UserPayload, delivery: SessionInbox.Delivery) =>
  SessionTask.OperationDigest.make(
    createHash("sha256")
      .update(canonical({ payload: Schema.encodeSync(SessionInbox.UserPayload)(payload), delivery }))
      .digest("hex"),
  )

export const sameOrigin = (left: SessionTask.OperationSource, right: SessionTask.OperationSource) => {
  if (left.type !== right.type || left.sessionID !== right.sessionID) return false
  if (left.type === "user_coordination" && right.type === "user_coordination") return true
  if (left.agent !== right.agent) return false
  if (left.type === "model_tool" && right.type === "model_tool")
    return left.messageID === right.messageID && left.id === right.id
  if (left.type === "goal_round" && right.type === "goal_round")
    return left.goalID === right.goalID && left.roundID === right.roundID && left.revision === right.revision
  if (left.type === "schedule_occurrence" && right.type === "schedule_occurrence")
    return (
      left.scheduleID === right.scheduleID &&
      left.occurrenceID === right.occurrenceID &&
      left.revision === right.revision
    )
  return false
}

export const get = Effect.fn("TaskOperation.get")(function* (db: DatabaseService, input: Ref) {
  const row = yield* db
    .select()
    .from(TaskOperationTable)
    .where(
      and(
        eq(TaskOperationTable.source_session_id, input.sessionID),
        eq(TaskOperationTable.operation_id, input.operationID),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? undefined : Schema.decodeUnknownSync(SessionTask.OperationInfo)(row.data)
})

export const list = Effect.fn("TaskOperation.list")(function* (
  db: DatabaseService,
  input: { readonly sessionID: SessionSchema.ID; readonly taskID?: string },
) {
  const rows = yield* db
    .select({ data: TaskOperationTable.data })
    .from(TaskOperationTable)
    .where(
      input.taskID === undefined
        ? eq(TaskOperationTable.source_session_id, input.sessionID)
        : and(eq(TaskOperationTable.source_session_id, input.sessionID), eq(TaskOperationTable.task_id, input.taskID)),
    )
    .orderBy(asc(TaskOperationTable.time_created), asc(TaskOperationTable.operation_id))
    .all()
    .pipe(Effect.orDie)
  return rows
    .map((row) => Schema.decodeUnknownSync(SessionTask.OperationInfo)(row.data))
    .sort((left, right) =>
      left.reservationSeq !== undefined && right.reservationSeq !== undefined
        ? left.reservationSeq - right.reservationSeq
        : left.createdAt - right.createdAt,
    )
})

export const assertFreeInput = Effect.fn("TaskOperation.assertFreeInput")(function* (
  db: DatabaseService,
  input: Ref & { readonly inputID: SessionMessage.ID; readonly projected?: boolean },
) {
  const reserved = yield* db
    .select({ sourceSessionID: TaskOperationTable.source_session_id, operationID: TaskOperationTable.operation_id })
    .from(TaskOperationTable)
    .where(eq(TaskOperationTable.input_id, input.inputID))
    .get()
    .pipe(Effect.orDie)
  const occupied =
    (reserved &&
    !(input.projected && reserved.sourceSessionID === input.sessionID && reserved.operationID === input.operationID)
      ? reserved
      : undefined) ??
    (yield* db
      .select({ inputID: SessionConsultationTable.first_message_id })
      .from(SessionConsultationTable)
      .where(eq(SessionConsultationTable.first_message_id, input.inputID))
      .get()
      .pipe(Effect.orDie)) ??
    (yield* db
      .select({ inputID: SessionInboxTable.id })
      .from(SessionInboxTable)
      .where(eq(SessionInboxTable.id, input.inputID))
      .get()
      .pipe(Effect.orDie)) ??
    (yield* db
      .select({ inputID: SessionMessageTable.id })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, input.inputID))
      .get()
      .pipe(Effect.orDie))
  if (occupied)
    return yield* new OperationConflictError({
      sessionID: input.sessionID,
      operationID: input.operationID,
      reason: "input_owned",
    })
})

export const store = Effect.fn("TaskOperation.store")(function* (
  db: DatabaseService,
  operation: SessionTask.OperationInfo,
  eventSeq?: number,
) {
  const data = Schema.encodeSync(SessionTask.OperationInfo)(operation)
  yield* db
    .insert(TaskOperationTable)
    .values({
      source_session_id: operation.sourceSessionID,
      operation_id: operation.operationID,
      task_id: operation.taskID,
      input_id: operation.inputID,
      target_session_id: operation.targetSessionID,
      phase: operation.phase,
      data,
      ...(eventSeq !== undefined ? { event_seq: eventSeq } : {}),
      time_created: operation.createdAt,
      time_updated: operation.updatedAt,
    })
    .onConflictDoUpdate({
      target: [TaskOperationTable.source_session_id, TaskOperationTable.operation_id],
      set: {
        task_id: operation.taskID ?? null,
        target_session_id: operation.targetSessionID ?? null,
        phase: operation.phase,
        data,
        ...(eventSeq !== undefined ? { event_seq: eventSeq } : {}),
        time_updated: operation.updatedAt,
      },
    })
    .run()
    .pipe(Effect.orDie)
})

export const projectReserved = Effect.fn("TaskOperation.projectReserved")(function* (
  db: DatabaseService,
  data: typeof SessionTaskEvent.OperationReserved.Type.data,
  createdAt: number,
  eventSeq: number,
) {
  const existing = yield* get(db, { sessionID: data.sessionID, operationID: data.request.operationID })
  if (existing) return
  yield* store(
    db,
    new SessionTask.OperationInfo({
      sourceSessionID: data.sessionID,
      sourceLocation: data.sourceLocation,
      sourceMode: data.sourceMode,
      operationID: data.request.operationID,
      taskID: data.request.taskID,
      taskRevision: data.taskRevision,
      inputID: data.request.inputID,
      targetSessionID: data.targetSessionID,
      requestDigest: requestDigest(data.request),
      request: data.request,
      source: data.source,
      selection: data.selection,
      reservationSeq: Event.Seq.make(eventSeq),
      goalRounds: data.goalRounds,
      phase: data.predecessorID === undefined ? "reserved" : "waiting",
      predecessorID: data.predecessorID,
      cancelIntent: false,
      createdAt,
      updatedAt: createdAt,
    }),
    eventSeq,
  )
})

export const projectChanged = Effect.fn("TaskOperation.projectChanged")(function* (
  db: DatabaseService,
  data: typeof SessionTaskEvent.OperationChanged.Type.data,
  updatedAt: number,
  eventSeq: number,
) {
  const row = yield* db
    .select()
    .from(TaskOperationTable)
    .where(
      and(
        eq(TaskOperationTable.source_session_id, data.sessionID),
        eq(TaskOperationTable.operation_id, data.operationID),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  if (!row) return yield* Effect.die(new Error(`Task operation reservation is missing: ${data.operationID}`))
  if (row.event_seq >= eventSeq) return
  const current = Schema.decodeUnknownSync(SessionTask.OperationInfo)(row.data)
  yield* store(db, applyChange(current, data.change, updatedAt), eventSeq)
})

const applyChange = (current: SessionTask.OperationInfo, change: SessionTask.OperationChange, updatedAt: number) =>
  new SessionTask.OperationInfo({
    sourceSessionID: current.sourceSessionID,
    sourceLocation: current.sourceLocation,
    sourceMode: current.sourceMode,
    operationID: current.operationID,
    taskID: change.taskID ?? current.taskID,
    taskRevision: change.taskRevision ?? current.taskRevision,
    inputID: current.inputID,
    targetSessionID: change.targetSessionID ?? current.targetSessionID,
    requestDigest: current.requestDigest,
    request: current.request,
    source: current.source,
    selection: current.selection,
    reservationSeq: current.reservationSeq,
    goalRounds: current.goalRounds,
    phase: change.phase ?? current.phase,
    cancelIntent: change.cancelIntent ?? current.cancelIntent,
    predecessorID: current.predecessorID,
    prepared: change.prepared ?? current.prepared,
    admission: current.admission,
    result: change.result ?? current.result,
    consumers:
      change.consumers === undefined
        ? current.consumers
        : [...(current.consumers ?? []), ...change.consumers].filter(
            (consumer, index, consumers) =>
              consumers.findIndex(
                (old) =>
                  old.consumerSessionID === consumer.consumerSessionID &&
                  old.assistantMessageID === consumer.assistantMessageID &&
                  old.eventID === consumer.eventID &&
                  old.resultDigest === consumer.resultDigest,
              ) === index,
          ),
    sourceSettlement: current.sourceSettlement,
    error: change.error === null ? undefined : (change.error ?? current.error),
    createdAt: current.createdAt,
    updatedAt,
  })

export const assertAdmission = Effect.fn("TaskOperation.assertAdmission")(function* (
  db: DatabaseService,
  input: {
    readonly sessionID: SessionSchema.ID
    readonly id: SessionMessage.ID
    readonly type: SessionInbox.Item["type"]
    readonly operation?: SessionTask.OperationReadonlyRef
    readonly item?: SessionInbox.Item
    readonly reconciled?: boolean
  },
) {
  const row = yield* db
    .select()
    .from(TaskOperationTable)
    .where(eq(TaskOperationTable.input_id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (!row) {
    if (input.operation)
      return yield* new OperationConflictError({
        sessionID: input.operation.sourceSessionID,
        operationID: input.operation.operationID,
        reason: "operation_missing",
      })
    return
  }
  const operation = Schema.decodeUnknownSync(SessionTask.OperationInfo)(row.data)
  if (
    input.operation === undefined ||
    input.operation.sourceSessionID !== operation.sourceSessionID ||
    input.operation.operationID !== operation.operationID ||
    input.sessionID !== operation.targetSessionID ||
    input.type !== "user"
  )
    return yield* new OperationConflictError({
      sessionID: operation.sourceSessionID,
      operationID: operation.operationID,
      reason: "input_owned",
    })
  if (
    !input.reconciled &&
    (operation.cancelIntent ||
      ["cancelled", "blocked", "failed", "superseded", "settled"].includes(operation.phase) ||
      !operation.prepared)
  )
    return yield* new OperationConflictError({
      sessionID: operation.sourceSessionID,
      operationID: operation.operationID,
      reason: "phase_changed",
    })
  if (
    input.item &&
    (!operation.prepared ||
      input.item.type !== "user" ||
      payloadDigest(input.item.payload, input.item.delivery) !== operation.prepared.digest)
  )
    return yield* new OperationConflictError({
      sessionID: operation.sourceSessionID,
      operationID: operation.operationID,
      reason: "request_changed",
    })
  if (input.reconciled) {
    const pending = yield* db
      .select({ seq: SessionInboxTable.enqueued_seq })
      .from(SessionInboxTable)
      .where(eq(SessionInboxTable.id, input.id))
      .get()
      .pipe(Effect.orDie)
    if (!operation.admission || (pending && pending.seq !== operation.admission.seq) || !operation.prepared)
      return yield* new OperationConflictError({
        sessionID: operation.sourceSessionID,
        operationID: operation.operationID,
        reason: "input_owned",
      })
  }
  return operation
})

/** The target Inbox transaction admits the fixed input and updates its operation together. */
export const projectAdmission = Effect.fn("TaskOperation.projectAdmission")(function* (
  db: DatabaseService,
  event: typeof SessionEvent.InboxEnqueued.Type,
) {
  if (!event.data.operation) return
  const row = yield* db
    .select()
    .from(TaskOperationTable)
    .where(eq(TaskOperationTable.input_id, event.data.inboxID))
    .get()
    .pipe(Effect.orDie)
  // Cross-aggregate replay may restore the target before its source reservation.
  if (!row) return
  const operation = Schema.decodeUnknownSync(SessionTask.OperationInfo)(row.data)
  // Admission was checked by the original commit boundary. Replay only projects matching committed provenance.
  if (
    operation.sourceSessionID !== event.data.operation.sourceSessionID ||
    operation.operationID !== event.data.operation.operationID ||
    operation.targetSessionID !== event.data.sessionID
  )
    return
  if (!operation.prepared) return
  yield* store(
    db,
    new SessionTask.OperationInfo({
      ...applyChange(
        operation,
        new SessionTask.OperationChange({
          phase: ["settled", "failed", "cancelled", "blocked", "superseded"].includes(operation.phase)
            ? operation.phase
            : "admitted",
        }),
        event.created,
      ),
      admission: new SessionTask.OperationAdmission({ eventID: event.id, seq: event.durable.seq }),
    }),
  )
})
