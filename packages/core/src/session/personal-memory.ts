export * as PersonalMemory from "./personal-memory"

import { and, desc, eq, or } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { PersonalMemory as PersonalMemorySchema } from "@aigcfroge/schema/personal-memory"
import { Database } from "../database/database"
import { LayerNode } from "../effect/layer-node"
import { EventV2 } from "../event"
import { PersonalMemoryTable } from "./personal-memory.sql"

// Telemetry (plan §3.8.4): lifecycle markers WITHOUT content.
export const Event = {
  Proposed: EventV2.define({
    type: "assistant_memory_proposed",
    schema: { memoryID: PersonalMemorySchema.ID },
  }),
  Confirmed: EventV2.define({
    type: "assistant_memory_confirmed",
    schema: { memoryID: PersonalMemorySchema.ID },
  }),
  Rejected: EventV2.define({
    type: "assistant_memory_rejected",
    schema: { memoryID: PersonalMemorySchema.ID },
  }),
}

/**
 * User-level personal memory (PRD §9, M2): confirm-first model. The AI only
 * proposes (`propose`); derived entries stay pending and are NEVER injected
 * until the user confirms. Audit: writes leave the row (rejected/deleted are
 * terminal statuses, not row removals).
 */

const toInfo = (row: typeof PersonalMemoryTable.$inferSelect): PersonalMemorySchema.Info =>
  new PersonalMemorySchema.Info({
    id: row.id,
    content: row.content,
    source: row.source,
    trustLevel: row.trust_level,
    sensitivityLevel: row.sensitivity_level,
    status: row.status,
    ...(row.source_session_id ? { sourceSessionID: row.source_session_id } : {}),
    ...(row.source_message_id ? { sourceMessageID: row.source_message_id } : {}),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    ...(row.confirmed_at !== null && row.confirmed_at !== undefined ? { confirmedAt: row.confirmed_at } : {}),
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })

export interface Interface {
  /** AI proposal entry point. Returns the pending candidate for user review. */
  readonly propose: (input: {
    readonly content: string
    readonly source: PersonalMemorySchema.Source
    readonly trustLevel: PersonalMemorySchema.TrustLevel
    readonly sensitivityLevel: PersonalMemorySchema.SensitivityLevel
    readonly sourceSessionID?: string
    readonly sourceMessageID?: string
    readonly createdBy?: string
  }) => Effect.Effect<PersonalMemorySchema.Info>
  /** All entries, newest first (Memory Inspector). */
  readonly list: () => Effect.Effect<ReadonlyArray<PersonalMemorySchema.Info>>
  /** Pending proposals awaiting user review. */
  readonly listPending: () => Effect.Effect<ReadonlyArray<PersonalMemorySchema.Info>>
  /** Confirmed entries only — the injectable set. */
  readonly listConfirmed: () => Effect.Effect<ReadonlyArray<PersonalMemorySchema.Info>>
  /** User confirmation: pending → confirmed (stamps confirmedAt). */
  readonly confirm: (id: PersonalMemorySchema.ID) => Effect.Effect<PersonalMemorySchema.Info | undefined>
  /** User rejection: pending → rejected (terminal). */
  readonly reject: (id: PersonalMemorySchema.ID) => Effect.Effect<PersonalMemorySchema.Info | undefined>
  /** User edit: content/trust/sensitivity on pending or confirmed entries. */
  readonly edit: (input: {
    readonly id: PersonalMemorySchema.ID
    readonly content?: string
    readonly trustLevel?: PersonalMemorySchema.TrustLevel
    readonly sensitivityLevel?: PersonalMemorySchema.SensitivityLevel
  }) => Effect.Effect<PersonalMemorySchema.Info | undefined>
  /** User deletion: status → deleted (audit keeps the row). */
  readonly remove: (id: PersonalMemorySchema.ID) => Effect.Effect<PersonalMemorySchema.Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/PersonalMemory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const propose = Effect.fn("PersonalMemory.propose")(
      (input: {
        readonly content: string
        readonly source: PersonalMemorySchema.Source
        readonly trustLevel: PersonalMemorySchema.TrustLevel
        readonly sensitivityLevel: PersonalMemorySchema.SensitivityLevel
        readonly sourceSessionID?: string
        readonly sourceMessageID?: string
        readonly createdBy?: string
      }) =>
        Effect.gen(function* () {
          const id = PersonalMemorySchema.ID.create()
          const now = Date.now()
          yield* db
            .insert(PersonalMemoryTable)
            .values({
              id,
              content: input.content,
              source: input.source,
              trust_level: input.trustLevel,
              sensitivity_level: input.sensitivityLevel,
              // Confirm-first (PRD §9): proposals are always pending.
              status: "pending",
              ...(input.sourceSessionID ? { source_session_id: input.sourceSessionID } : {}),
              ...(input.sourceMessageID ? { source_message_id: input.sourceMessageID } : {}),
              ...(input.createdBy ? { created_by: input.createdBy } : {}),
              time_created: now,
              time_updated: now,
            })
            .run()
            .pipe(Effect.orDie)
          yield* events.publish(Event.Proposed, { memoryID: id })
          const row = yield* db
            .select()
            .from(PersonalMemoryTable)
            .where(eq(PersonalMemoryTable.id, id))
            .get()
            .pipe(Effect.orDie)
          if (!row) return yield* Effect.die(new Error("created memory row vanished"))
          return toInfo(row)
        }),
    )

    const list = Effect.fn("PersonalMemory.list")(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalMemoryTable)
          .orderBy(desc(PersonalMemoryTable.time_created))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
    )

    const listPending = Effect.fn("PersonalMemory.listPending")(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalMemoryTable)
          .where(eq(PersonalMemoryTable.status, "pending"))
          .orderBy(desc(PersonalMemoryTable.time_created))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
    )

    const listConfirmed = Effect.fn("PersonalMemory.listConfirmed")(() =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalMemoryTable)
          .where(eq(PersonalMemoryTable.status, "confirmed"))
          .orderBy(desc(PersonalMemoryTable.time_created))
          .all()
          .pipe(Effect.orDie)
        return rows.map(toInfo)
      }),
    )

    const setStatus = Effect.fn("PersonalMemory.setStatus")(
      (id: PersonalMemorySchema.ID, status: PersonalMemorySchema.Status) =>
        Effect.gen(function* () {
          const row = yield* db
            .update(PersonalMemoryTable)
            .set({
              status,
              ...(status === "confirmed" ? { confirmed_at: Date.now() } : {}),
              time_updated: Date.now(),
            })
            .where(and(eq(PersonalMemoryTable.id, id), eq(PersonalMemoryTable.status, "pending")))
            .returning()
            .get()
            .pipe(Effect.orDie)
          if (!row) return undefined
          yield* events.publish(row.status === "confirmed" ? Event.Confirmed : Event.Rejected, { memoryID: id })
          return toInfo(row)
        }),
    )

    const confirm = Effect.fn("PersonalMemory.confirm")((id: PersonalMemorySchema.ID) => setStatus(id, "confirmed"))

    const reject = Effect.fn("PersonalMemory.reject")((id: PersonalMemorySchema.ID) => setStatus(id, "rejected"))

    const edit = Effect.fn("PersonalMemory.edit")(
      (input: {
        readonly id: PersonalMemorySchema.ID
        readonly content?: string
        readonly trustLevel?: PersonalMemorySchema.TrustLevel
        readonly sensitivityLevel?: PersonalMemorySchema.SensitivityLevel
      }) =>
        Effect.gen(function* () {
          const row = yield* db
            .update(PersonalMemoryTable)
            .set({
              ...(input.content !== undefined ? { content: input.content } : {}),
              ...(input.trustLevel !== undefined ? { trust_level: input.trustLevel } : {}),
              ...(input.sensitivityLevel !== undefined ? { sensitivity_level: input.sensitivityLevel } : {}),
              time_updated: Date.now(),
            })
            .where(
              and(
                eq(PersonalMemoryTable.id, input.id),
                or(eq(PersonalMemoryTable.status, "pending"), eq(PersonalMemoryTable.status, "confirmed")),
              ),
            )
            .returning()
            .get()
            .pipe(Effect.orDie)
          if (!row) return undefined
          return toInfo(row)
        }),
    )

    const remove = Effect.fn("PersonalMemory.remove")((id: PersonalMemorySchema.ID) =>
      Effect.gen(function* () {
        const row = yield* db
          .update(PersonalMemoryTable)
          .set({ status: "deleted", time_updated: Date.now() })
          .where(and(eq(PersonalMemoryTable.id, id), eq(PersonalMemoryTable.status, "confirmed")))
          .returning()
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        return toInfo(row)
      }),
    )

    return Service.of({ propose, list, listPending, listConfirmed, confirm, reject, edit, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node, EventV2.node])
