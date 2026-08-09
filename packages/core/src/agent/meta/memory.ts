export * as MetaAgentMemory from "./memory"

import { eq, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../../database/database"
import { MetaAgentService } from "../../meta-agent/service"
import { MetaAgentMemoryTable } from "../../meta-agent/sql"
import { ProjectV2 } from "../../project"
import { SessionSchema } from "../../session/schema"

export const FactCategory = Schema.Literals(["code_trap", "protocol", "api", "workflow"])
export type FactCategory = typeof FactCategory.Type

export class NotMetaSessionError extends Schema.TaggedErrorClass<NotMetaSessionError>()(
  "MetaAgentMemory.NotMetaSessionError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `Session ${this.sessionID} is not attached to a meta agent; memory_record requires a meta agent session`
  }
}

export interface RecordInput {
  readonly id?: string
  readonly sessionID: SessionSchema.ID
  readonly projectID: ProjectV2.ID
  readonly factCategory: FactCategory
  readonly content: string
  readonly sourceSessionID?: string
  readonly sourceStepID?: string
}

export interface QueryInput {
  readonly projectID: ProjectV2.ID
  readonly factCategory?: FactCategory
}

export interface SearchInput {
  readonly projectID: ProjectV2.ID
  readonly keyword: string
}

export interface MemoryRecord {
  readonly id: string
  readonly projectID: ProjectV2.ID
  readonly metaAgentID: string
  readonly factCategory: FactCategory
  readonly content: string
  readonly sourceSessionID?: string
  readonly sourceStepID?: string
  readonly timeCreated: number
  readonly timeUpdated: number
}

export interface Interface {
  readonly record: (input: RecordInput) => Effect.Effect<string, NotMetaSessionError>
  readonly query: (input: QueryInput) => Effect.Effect<ReadonlyArray<MemoryRecord>>
  readonly search: (input: SearchInput) => Effect.Effect<ReadonlyArray<MemoryRecord>>
  readonly remove: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/MetaAgentMemory") {}

function rowToRecord(row: typeof MetaAgentMemoryTable.$inferSelect): MemoryRecord {
  return {
    id: row.id,
    projectID: ProjectV2.ID.make(row.project_id),
    metaAgentID: row.meta_agent_id,
    factCategory: row.fact_category,
    content: row.content,
    sourceSessionID: row.source_session_id ?? undefined,
    sourceStepID: row.source_step_id ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

const escapeLike = (keyword: string) => keyword.replaceAll(/[%_\\]/g, (char) => `\\${char}`)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const metaAgent = yield* MetaAgentService.Service

    const record = Effect.fn("MetaAgentMemory.record")(function* (input: RecordInput) {
      const attached = yield* metaAgent.findBySession(input.sessionID)
      if (!attached) return yield* new NotMetaSessionError({ sessionID: input.sessionID })
      const id = input.id ?? `mem_${crypto.randomUUID().replaceAll("-", "")}`
      const now = yield* DateTime.now
      // onConflictDoNothing makes replay idempotent: a retried call with the
      // same id skips the insert and still reports success, so the caller's
      // recorded id remains valid without creating duplicates. The random id
      // path never conflicts.
      yield* db
        .insert(MetaAgentMemoryTable)
        .values({
          id,
          project_id: input.projectID,
          meta_agent_id: attached.metaID,
          fact_category: input.factCategory,
          content: input.content,
          source_session_id: input.sourceSessionID ?? null,
          source_step_id: input.sourceStepID ?? null,
          time_created: DateTime.toEpochMillis(now),
          time_updated: DateTime.toEpochMillis(now),
        })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
      return id
    })

    const query = Effect.fn("MetaAgentMemory.query")(function* (input: QueryInput) {
      const rows = yield* db
        .select()
        .from(MetaAgentMemoryTable)
        .where(
          input.factCategory === undefined
            ? eq(MetaAgentMemoryTable.project_id, input.projectID)
            : sql`${eq(MetaAgentMemoryTable.project_id, input.projectID)} AND ${eq(MetaAgentMemoryTable.fact_category, input.factCategory)}`,
        )
        .orderBy(MetaAgentMemoryTable.time_updated)
        .all()
        .pipe(Effect.orDie)
      return rows.map(rowToRecord)
    })

    const search = Effect.fn("MetaAgentMemory.search")(function* (input: SearchInput) {
      const pattern = `%${escapeLike(input.keyword)}%`
      // Leading-wildcard LIKE cannot use the project_id index, so search cost
      // grows with the number of facts per project. Each fact is a distilled
      // entry of at most 2000 chars (there is no per-project count cap), so
      // this stays cheap in practice; if it ever becomes a bottleneck, replace
      // with a SQLite FTS5 virtual table.
      const rows = yield* db
        .select()
        .from(MetaAgentMemoryTable)
        .where(
          sql`${eq(MetaAgentMemoryTable.project_id, input.projectID)} AND ${MetaAgentMemoryTable.content} LIKE ${pattern} ESCAPE '\\'`,
        )
        .orderBy(MetaAgentMemoryTable.time_updated)
        .all()
        .pipe(Effect.orDie)
      return rows.map(rowToRecord)
    })

    const remove = Effect.fn("MetaAgentMemory.remove")(function* (id: string) {
      yield* db.delete(MetaAgentMemoryTable).where(eq(MetaAgentMemoryTable.id, id)).run().pipe(Effect.orDie)
    })

    return Service.of({ record, query, search, remove })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(MetaAgentService.defaultLayer),
)
