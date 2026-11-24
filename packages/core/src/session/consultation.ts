export * as Consultation from "./consultation.js"

import { and, eq } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { createHash } from "node:crypto"
import type { FileAttachment } from "@omnixa/schema/prompt"
import { SessionConsultation } from "@omnixa/schema/session-consultation"
import { SessionInbox } from "@omnixa/schema/session-inbox"
import { Event } from "@omnixa/schema/event"
import { Database } from "../database/database.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionConsultationTable, SessionInboxTable, SessionMessageTable, TaskOperationTable } from "./sql.js"

type DatabaseService = Database.Interface["db"]
type Record = typeof SessionConsultationTable.$inferSelect

export type Operation = {
  readonly sourceSessionID: SessionSchema.ID
  readonly firstMessageID: SessionMessage.ID
}

export class ConsultationConflictError extends Schema.TaggedError<ConsultationConflictError>()(
  "Session.ConsultationConflictError",
  { sessionID: SessionSchema.ID, field: Schema.String, message: Schema.String },
) {}

export class InvalidConsultationError extends Schema.TaggedError<InvalidConsultationError>()(
  "Session.InvalidConsultationError",
  { sessionID: SessionSchema.ID, field: Schema.String, message: Schema.String },
) {}

export const get = Effect.fn("SessionConsultation.get")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select()
    .from(SessionConsultationTable)
    .where(eq(SessionConsultationTable.session_id, sessionID))
    .get()
    .pipe(Effect.orDie)
})

export const matchesIdentity = (record: Record, input: Operation) =>
  record.source_session_id === input.sourceSessionID && record.first_message_id === input.firstMessageID

export const reserve = Effect.fn("SessionConsultation.reserve")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  input: { firstMessageID: SessionMessage.ID; reference: SessionConsultation.Reference },
) {
  const first = yield* db
    .select()
    .from(SessionConsultationTable)
    .where(eq(SessionConsultationTable.first_message_id, input.firstMessageID))
    .get()
    .pipe(Effect.orDie)
  if (first)
    return yield* new ConsultationConflictError({
      sessionID,
      field: "prompt.id",
      message: "The first prompt ID is already reserved by a consultation",
    })
  const occupied =
    (yield* db
      .select({ id: TaskOperationTable.input_id })
      .from(TaskOperationTable)
      .where(eq(TaskOperationTable.input_id, input.firstMessageID))
      .get()
      .pipe(Effect.orDie)) ??
    (yield* db
      .select({ id: SessionInboxTable.id })
      .from(SessionInboxTable)
      .where(eq(SessionInboxTable.id, input.firstMessageID))
      .get()
      .pipe(Effect.orDie)) ??
    (yield* db
      .select({ id: SessionMessageTable.id })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, input.firstMessageID))
      .get()
      .pipe(Effect.orDie))
  if (occupied)
    return yield* new ConsultationConflictError({
      sessionID,
      field: "prompt.id",
      message: "The first prompt ID is already owned by an existing input",
    })
  yield* db
    .insert(SessionConsultationTable)
    .values({
      session_id: sessionID,
      source_session_id: input.reference.sourceSessionID,
      first_message_id: input.firstMessageID,
      boundary: input.reference.boundary,
      boundary_seq: input.reference.boundarySeq,
      source_message_ids: input.reference.sourceMessageIDs,
      digest: input.reference.digest,
      omissions: input.reference.omissions,
      phase: "reserved",
      reference_file: input.reference.file,
    })
    .run()
    .pipe(Effect.orDie)
})

/** The Inbox boundary owns reserved first IDs and cancelled first-ID terminality. */
export const assertAdmission = Effect.fn("SessionConsultation.assertAdmission")(function* (
  db: DatabaseService,
  input: { sessionID: SessionSchema.ID; id: SessionMessage.ID; type: SessionInbox.Item["type"]; operation?: Operation },
) {
  const record = yield* db
    .select()
    .from(SessionConsultationTable)
    .where(eq(SessionConsultationTable.first_message_id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (!record) return
  if (record.session_id !== input.sessionID || input.type !== "user" || record.phase === "cancelled")
    return yield* new ConsultationConflictError({
      sessionID: input.sessionID,
      field: "prompt.id",
      message: "The first consultation prompt ID cannot be reused",
    })
  if (input.operation && !matchesIdentity(record, input.operation))
    return yield* new ConsultationConflictError({
      sessionID: input.sessionID,
      field: "id",
      message: "The target belongs to a different consultation source or first prompt",
    })
  if (record.phase === "reserved" && !input.operation)
    return yield* new ConsultationConflictError({
      sessionID: input.sessionID,
      field: "prompt.id",
      message: "The reserved first prompt must be admitted by its consultation operation",
    })
  if (record.phase === "reserved") {
    const occupied =
      (yield* db
        .select({ id: SessionInboxTable.id })
        .from(SessionInboxTable)
        .where(eq(SessionInboxTable.id, input.id))
        .get()
        .pipe(Effect.orDie)) ??
      (yield* db
        .select({ id: SessionMessageTable.id })
        .from(SessionMessageTable)
        .where(eq(SessionMessageTable.id, input.id))
        .get()
        .pipe(Effect.orDie))
    if (occupied)
      return yield* new ConsultationConflictError({
        sessionID: input.sessionID,
        field: "prompt.id",
        message: "The reserved first prompt ID is occupied by an unrelated input",
      })
  }
})

const matchingFile = (record: Record, files: readonly FileAttachment[] | undefined) =>
  files?.find(
    (file) =>
      file.mime === "text/plain" &&
      file.source.type === "inline" &&
      createHash("sha256").update(Buffer.from(file.data, "base64")).digest("hex") === record.digest,
  )

const carrier = Effect.fnUntraced(function* (db: DatabaseService, record: Record) {
  if (!record.reference_carrier_id) return undefined
  const message = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.id, record.reference_carrier_id),
        eq(SessionMessageTable.session_id, record.session_id),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  if (message) {
    const user = Schema.decodeUnknownSync(SessionMessage.User)({ ...message.data, id: message.id, type: message.type })
    return { promoted: true, seq: message.seq, file: matchingFile(record, user.files) }
  }
  const pending = yield* db
    .select()
    .from(SessionInboxTable)
    .where(
      and(eq(SessionInboxTable.id, record.reference_carrier_id), eq(SessionInboxTable.session_id, record.session_id)),
    )
    .get()
    .pipe(Effect.orDie)
  if (pending?.type !== "user") return undefined
  return {
    promoted: false,
    seq: pending.enqueued_seq,
    file: matchingFile(record, Schema.decodeUnknownSync(SessionInbox.UserPayload)(pending.payload).files),
  }
})

export const reference = Effect.fn("SessionConsultation.reference")(function* (db: DatabaseService, record: Record) {
  const file = record.reference_file ?? (yield* carrier(db, record))?.file
  if (!file || !matchingFile(record, [file]))
    return yield* new ConsultationConflictError({
      sessionID: record.session_id,
      field: "reference",
      message: "The consultation reference carrier is missing or inconsistent",
    })
  return SessionConsultation.Reference.make({
    sourceSessionID: record.source_session_id,
    boundary: record.boundary,
    boundarySeq: Event.Seq.make(record.boundary_seq),
    sourceMessageIDs: record.source_message_ids,
    digest: record.digest,
    omissions: record.omissions,
    file,
  })
})

/** Until one carrier is promoted, every newly admitted User must bring the frozen reference. */
export const attach = Effect.fn("SessionConsultation.attach")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  payload: SessionInbox.UserPayload,
) {
  const record = yield* get(db, sessionID)
  if (!record || record.reference_promoted) return payload
  const source = yield* reference(db, record)
  return SessionInbox.UserPayload.make({
    ...payload,
    files: [...(payload.files ?? []).filter((file) => !matchingFile(record, [file])), source.file],
    metadata: { ...payload.metadata, consultation: { sourceSessionID: source.sourceSessionID, digest: source.digest } },
  })
})

export const projectAdmitted = Effect.fn("SessionConsultation.projectAdmitted")(function* (
  db: DatabaseService,
  input: { sessionID: SessionSchema.ID; id: SessionMessage.ID; item: SessionInbox.Item; operation?: Operation },
) {
  yield* assertAdmission(db, { ...input, type: input.item.type })
  const record = yield* get(db, input.sessionID)
  if (!record || input.item.type !== "user") return
  const file = matchingFile(record, input.item.payload.files)
  if (!record.reference_promoted && record.reference_file && !file)
    return yield* new ConsultationConflictError({
      sessionID: input.sessionID,
      field: "reference",
      message: "The admitted consultation prompt is missing its frozen reference",
    })
  yield* db
    .update(SessionConsultationTable)
    .set({
      phase: input.id === record.first_message_id ? "admitted" : record.phase,
      reference_carrier_id:
        !record.reference_promoted && record.reference_file && file ? input.id : record.reference_carrier_id,
      reference_file: !record.reference_promoted && record.reference_file && file ? null : record.reference_file,
    })
    .where(eq(SessionConsultationTable.session_id, input.sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const projectDelivered = Effect.fn("SessionConsultation.projectDelivered")(function* (
  db: DatabaseService,
  input: SessionInbox.User,
) {
  const record = yield* get(db, input.sessionID)
  if (!record || record.reference_promoted || !matchingFile(record, input.payload.files)) return
  yield* db
    .update(SessionConsultationTable)
    .set({ reference_promoted: true, reference_carrier_id: input.id, reference_file: null })
    .where(eq(SessionConsultationTable.session_id, input.sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const projectCancelled = Effect.fn("SessionConsultation.projectCancelled")(function* (
  db: DatabaseService,
  input: SessionInbox.User,
) {
  const record = yield* get(db, input.sessionID)
  if (!record) return
  const file = record.reference_carrier_id === input.id ? matchingFile(record, input.payload.files) : undefined
  if (record.reference_carrier_id === input.id && !file)
    return yield* new ConsultationConflictError({
      sessionID: input.sessionID,
      field: "reference",
      message: "Cancelling the reference carrier requires its frozen bytes",
    })
  yield* db
    .update(SessionConsultationTable)
    .set({
      phase: record.first_message_id === input.id ? "cancelled" : record.phase,
      reference_carrier_id: file ? null : record.reference_carrier_id,
      reference_file: file ?? record.reference_file,
    })
    .where(eq(SessionConsultationTable.session_id, input.sessionID))
    .run()
    .pipe(Effect.orDie)
})

/** Preserve bytes before the normal revert cut removes their carrier. */
export const projectReverted = Effect.fn("SessionConsultation.projectReverted")(function* (
  db: DatabaseService,
  input: { sessionID: SessionSchema.ID; boundarySeq: number },
) {
  const record = yield* get(db, input.sessionID)
  if (!record || !record.reference_carrier_id) return
  const current = yield* carrier(db, record)
  if (current && current.seq < input.boundarySeq) return
  if (!current?.file)
    return yield* new ConsultationConflictError({
      sessionID: input.sessionID,
      field: "reference",
      message: "Reverting the reference carrier requires its frozen bytes",
    })
  yield* db
    .update(SessionConsultationTable)
    .set({
      reference_promoted: record.reference_promoted || current.promoted,
      reference_carrier_id: null,
      reference_file: current.file,
    })
    .where(eq(SessionConsultationTable.session_id, input.sessionID))
    .run()
    .pipe(Effect.orDie)
})

export const admission = Effect.fn("SessionConsultation.admission")(function* (db: DatabaseService, record: Record) {
  if (record.phase === "cancelled")
    return SessionConsultation.Admission.make({ state: "cancelled", id: record.first_message_id })
  const row = yield* db
    .select()
    .from(SessionInboxTable)
    .where(eq(SessionInboxTable.id, record.first_message_id))
    .get()
    .pipe(Effect.orDie)
  if (row?.session_id === record.session_id && row.type === "user" && record.phase === "admitted")
    return SessionConsultation.Admission.make({
      state: "pending",
      input: SessionInbox.User.make({
        id: row.id,
        sessionID: row.session_id,
        type: "user",
        time: { created: DateTime.makeUnsafe(row.time_created) },
        payload: Schema.decodeUnknownSync(SessionInbox.UserPayload)(row.payload),
        delivery: row.delivery,
      }),
    })
  const message = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, record.first_message_id))
    .get()
    .pipe(Effect.orDie)
  if (message?.session_id === record.session_id && message.type === "user" && record.phase === "admitted")
    return SessionConsultation.Admission.make({
      state: "promoted",
      input: Schema.decodeUnknownSync(SessionMessage.User)({ ...message.data, id: message.id, type: message.type }),
    })
  return yield* new ConsultationConflictError({
    sessionID: record.session_id,
    field: "admission",
    message: "The consultation phase does not match its first input",
  })
})
