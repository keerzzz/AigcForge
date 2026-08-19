export * as SessionStore from "./store"

import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Database } from "../database/database"
import { SessionHistory } from "./history"
import { MessageDecodeError } from "./error"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { SessionMessageTable, SessionTable } from "./sql"
import { fromRow } from "./info"

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info | undefined>
  readonly context: (sessionID: SessionSchema.ID) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
  readonly runnerContext: (
    sessionID: SessionSchema.ID,
    baselineSeq: number,
  ) => Effect.Effect<SessionMessage.Message[], MessageDecodeError>
  readonly message: (
    messageID: SessionMessage.ID,
  ) => Effect.Effect<{ readonly sessionID: SessionSchema.ID; readonly message: SessionMessage.Message } | undefined>
  readonly children: (parentID: SessionSchema.ID) => Effect.Effect<SessionSchema.Info[]>
  readonly setRevert: (input: {
    sessionID: SessionSchema.ID
    revert: {
      messageID: string
      snapshot?: string
      diff?: string
    }
    summary: SessionSchema.Summary
  }) => Effect.Effect<void>
  readonly clearRevert: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly setSummary: (input: {
    sessionID: SessionSchema.ID
    summary: SessionSchema.Summary
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const decodeMessage = Schema.decodeUnknownEffect(SessionMessage.Message)

    return Service.of({
      get: Effect.fn("SessionStore.get")(function* (sessionID) {
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      context: Effect.fn("SessionStore.context")(function* (sessionID) {
        return yield* SessionHistory.load(db, sessionID)
      }),
      runnerContext: Effect.fn("SessionStore.runnerContext")(function* (sessionID, baselineSeq) {
        return yield* SessionHistory.loadForRunner(db, sessionID, baselineSeq)
      }),
      message: Effect.fn("SessionStore.message")(function* (messageID) {
        const row = yield* db
          .select()
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, messageID))
          .get()
          .pipe(Effect.orDie)
        return row
          ? {
              sessionID: SessionSchema.ID.make(row.session_id),
              message: yield* decodeMessage({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie),
            }
          : undefined
      }),
      children: Effect.fn("SessionStore.children")(function* (parentID) {
        const rows = yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.parent_id, parentID))
          .all()
          .pipe(Effect.orDie)
        return rows.map(fromRow)
      }),
      setRevert: Effect.fn("SessionStore.setRevert")(function* (input) {
        yield* db
          .update(SessionTable)
          .set({
            revert: { messageID: input.revert.messageID, snapshot: input.revert.snapshot ?? null, diff: input.revert.diff ?? null } as any,
            summary_additions: input.summary.additions,
            summary_deletions: input.summary.deletions,
            summary_files: input.summary.files,
          })
          .where(eq(SessionTable.id, input.sessionID))
          .pipe(Effect.orDie)
      }),
      clearRevert: Effect.fn("SessionStore.clearRevert")(function* (sessionID) {
        yield* db
          .update(SessionTable)
          .set({ revert: null as any, summary_additions: null, summary_deletions: null, summary_files: null })
          .where(eq(SessionTable.id, sessionID))
          .pipe(Effect.orDie)
      }),
      setSummary: Effect.fn("SessionStore.setSummary")(function* (input) {
        yield* db
          .update(SessionTable)
          .set({
            summary_additions: input.summary.additions,
            summary_deletions: input.summary.deletions,
            summary_files: input.summary.files,
          })
          .where(eq(SessionTable.id, input.sessionID))
          .pipe(Effect.orDie)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

/**
 * Returns the complete persisted session mode map for one SSE connection.
 * Unknown session IDs must remain distinguishable from ordinary sessions so
 * event filtering can fail closed.
 */
export const sessionModes = Effect.fn("SessionStore.sessionModes")(function* () {
  const database = yield* Effect.serviceOption(Database.Service)
  if (Option.isNone(database)) return new Map<string, string>()
  const rows = yield* database.value.db
    .select({ id: SessionTable.id, mode: SessionTable.mode })
    .from(SessionTable)
    .all()
    .pipe(Effect.orDie)
  return new Map(rows.map((row) => [String(row.id), String(row.mode)]))
})

export const node = LayerNode.make(layer, [Database.node])
