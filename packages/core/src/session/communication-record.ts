import { Effect, Schema } from "effect"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { Hash } from "@aigcfroge/util/hash"
import { CompositionDigest } from "../composition/digest.js"
import type { Database } from "../database/database.js"
import { KVTable } from "../kv/sql.js"
import type { KV } from "../kv.js"
import type { SessionInbox } from "./inbox.js"
import type { SessionMessage } from "./message.js"
import type { SessionSchema } from "./schema.js"
import { eq } from "drizzle-orm"

type Store = Pick<Database.Interface["db"], "select" | "insert">

export class Stored extends Schema.Class<Stored>("SessionCommunication.Stored")({
  record: SessionCommunication.Record,
  text: Schema.String,
}) {}

const decode = Schema.decodeUnknownSync(Stored)
const encode = Schema.encodeSync(Stored)
const recordKey = (id: SessionCommunication.ID) => `session_share:communication:record:${id}`
export const indexPrefix = (sessionID: SessionSchema.ID) => `session_share:communication:session:${sessionID}:`
export const systemID = (inputID: SessionMessage.ID) =>
  SessionCommunication.ID.make(`com_system_${Hash.sha256(inputID)}`)

/** Owning callbacks pass their real provenance through the original synthetic admission. */
export const prepareSystem = Effect.fn("CommunicationRecord.prepareSystem")(function* (
  db: Store,
  input: {
    readonly inputID: SessionMessage.ID
    readonly targetSessionID: SessionSchema.ID
    readonly text: string
    readonly actor: SessionCommunication.SystemActor
    readonly contentSource: SessionCommunication.ContentSource
    readonly delivery: "queue" | "steer"
    readonly trigger: boolean
    readonly createdAt: number
    readonly replyTo?: SessionCommunication.ID
  },
) {
  const id = systemID(input.inputID)
  const requestDigest = SessionCommunication.Digest.make(
    CompositionDigest.computeDigest({
      actor: Schema.encodeSync(SessionCommunication.Actor)(input.actor),
      contentSource: Schema.encodeSync(SessionCommunication.ContentSource)(input.contentSource),
      targetSessionID: input.targetSessionID,
      inputID: input.inputID,
      replyTo: input.replyTo,
      delivery: input.delivery,
      trigger: input.trigger,
    }),
  )
  const saved = yield* get(db, id)
  if (saved) {
    if (saved.record.requestDigest !== requestDigest)
      return yield* new SessionCommunication.Error({
        sessionID: input.actor.sessionID,
        communicationID: id,
        reason: "conflicting_retry",
        message: "The system return carrier belongs to another saved origin",
      })
    return saved
  }
  return new Stored({
    text: input.text,
    record: new SessionCommunication.Record({
      id,
      actor: input.actor,
      contentSource: input.contentSource,
      targetSessionID: input.targetSessionID,
      replyTo: input.replyTo,
      body: new SessionCommunication.BodyRef({
        sessionID: input.targetSessionID,
        inputID: input.inputID,
        digest: SessionCommunication.Digest.make(Hash.sha256(input.text)),
      }),
      requestDigest,
      delivery: input.delivery,
      trigger: input.trigger,
      createdAt: input.createdAt,
    }),
  })
})

export const get = Effect.fn("CommunicationRecord.get")(function* (db: Store, id: SessionCommunication.ID) {
  const row = yield* db
    .select({ value: KVTable.value })
    .from(KVTable)
    .where(eq(KVTable.key, recordKey(id)))
    .get()
    .pipe(Effect.orDie)
  return row ? decode(row.value) : undefined
})

export const page = Effect.fn("CommunicationRecord.page")(function* (
  kv: KV.Interface,
  sessionID: SessionSchema.ID,
  input: SessionCommunication.ListInput,
) {
  const prefix = indexPrefix(sessionID)
  if (input.cursor && !input.cursor.startsWith(prefix))
    return yield* new SessionCommunication.Error({
      sessionID,
      reason: "not_participant",
      message: "The communication cursor belongs to another Session",
    })
  return yield* kv.scan({ prefix, after: input.cursor, limit: Math.min(input.limit ?? 50, 100) })
})

/** Inbox first-wins remains valid only for the same immutable communication intent. */
export const assertAdmission = Effect.fn("CommunicationRecord.assertAdmission")(function* (
  db: Store,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly communication?: SessionCommunication.Record
    readonly existing?: SessionInbox.Info
  },
) {
  const record = input.communication
  if (!record) return
  if (
    record.targetSessionID !== input.sessionID ||
    record.body.sessionID !== input.sessionID ||
    record.body.inputID !== input.id
  )
    return yield* new SessionCommunication.Error({
      sessionID: input.sessionID,
      communicationID: record.id,
      reason: "invalid_carrier",
      message: "The communication does not belong to this Inbox carrier",
    })
  const saved = yield* get(db, record.id)
  if (!saved && input.existing)
    return yield* new SessionCommunication.Error({
      sessionID: input.sessionID,
      communicationID: record.id,
      reason: "invalid_carrier",
      message: "An unrelated retained input cannot be adopted as a communication",
    })
  if (
    saved &&
    (saved.record.requestDigest !== record.requestDigest ||
      saved.record.body.inputID !== input.id ||
      saved.record.targetSessionID !== input.sessionID ||
      saved.record.body.digest !== record.body.digest ||
      CompositionDigest.computeDigest(Schema.encodeSync(SessionCommunication.Actor)(saved.record.actor)) !==
        CompositionDigest.computeDigest(Schema.encodeSync(SessionCommunication.Actor)(record.actor)))
  )
    return yield* new SessionCommunication.Error({
      sessionID: input.sessionID,
      communicationID: record.id,
      reason: "conflicting_retry",
      message: "The communication ID belongs to a different saved request",
    })
})

/** Called by the original InboxEnqueued projector, inside the original Bus transaction. */
export const project = Effect.fn("CommunicationRecord.project")(function* (
  db: Store,
  input: {
    readonly record: SessionCommunication.Record
    readonly text: string
    readonly inputID: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
  },
) {
  const record = input.record
  yield* assertAdmission(db, { id: input.inputID, sessionID: input.sessionID, communication: record })
  if (record.body.digest !== Hash.sha256(input.text))
    return yield* new SessionCommunication.Error({
      sessionID: input.sessionID,
      communicationID: record.id,
      reason: "invalid_content",
      message: "The immutable communication body does not match its digest",
    })
  const stored = new Stored({ record, text: input.text })
  yield* db
    .insert(KVTable)
    .values({
      key: recordKey(record.id),
      value: encode(stored),
      time_created: record.createdAt,
      time_updated: record.createdAt,
    })
    .onConflictDoNothing({ target: KVTable.key })
    .run()
    .pipe(Effect.orDie)
  const saved = yield* get(db, record.id)
  if (!saved || JSON.stringify(encode(saved)) !== JSON.stringify(encode(stored)))
    return yield* new SessionCommunication.Error({
      sessionID: record.actor.sessionID,
      communicationID: record.id,
      reason: "conflicting_retry",
      message: "The first communication body and provenance are immutable",
    })
  yield* Effect.forEach(
    [...new Set([record.actor.sessionID, record.targetSessionID])],
    (sessionID) =>
      db
        .insert(KVTable)
        .values({
          key: `${indexPrefix(sessionID)}${String(record.createdAt).padStart(16, "0")}:${record.id}`,
          value: record.id,
          time_created: record.createdAt,
          time_updated: record.createdAt,
        })
        .onConflictDoNothing({ target: KVTable.key })
        .run()
        .pipe(Effect.orDie),
    { discard: true },
  )
})

export * as CommunicationRecord from "./communication-record.js"
