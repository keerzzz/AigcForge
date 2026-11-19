export * as MetaAgentMemory from "./memory"

import { and, desc, eq, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Database } from "../../database/database"
import { MetaAgentService } from "../../meta-agent/service"
import { MetaAgent } from "@aigcfroge/schema/meta-agent"
import { MetaAgentMemoryTable, MetaAgentSessionTable, MetaAgentStepTable } from "../../meta-agent/sql"
import { Project } from "../../project"
import { SessionSchema } from "../../session/schema"
import { CorrectionExtractor } from "../../session/correction-extractor.js"
import { SessionComposition } from "../../session/composition"
import { ControllerConflictError, sameModel } from "../../session/error.js"
import { fromRow } from "../../session/info.js"
import { SessionMessageTable, SessionTable } from "../../session/sql.js"
import { SessionMessage } from "../../session/message.js"
import { SessionEvent } from "../../session/event.js"
import { EventTable } from "../../event/sql.js"
import { Event } from "@aigcfroge/schema/event"
import { Document, type Entry } from "@aigcfroge/schema/config"

export const FactCategory = MetaAgent.FactCategory
export type FactCategory = typeof FactCategory.Type

export const Content = MetaAgent.MemoryContent

export const settings = (documents: readonly Entry[]) =>
  documents
    .filter((entry): entry is Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.memory ? [entry.info.meta.memory] : []))
    .reduce<{ enabled: boolean; topN: number }>(
      (result, current) => ({ enabled: current.enabled ?? result.enabled, topN: current.top_n ?? result.topN }),
      { enabled: false, topN: 10 },
    )

export class InvalidFactError extends Schema.TaggedError<InvalidFactError>()("MetaAgentMemory.InvalidFactError", {
  id: Schema.String,
  reason: Schema.Literals(["credential", "content_length"]),
}) {
  override get message() {
    return `Project memory fact ${this.id} cannot be copied into model data (${this.reason}).`
  }
}

export class NotMetaSessionError extends Schema.TaggedError<NotMetaSessionError>()(
  "MetaAgentMemory.NotMetaSessionError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `Session ${this.sessionID} is not attached to a meta agent; memory_record requires a meta agent session`
  }
}

export class SensitiveContentError extends Schema.TaggedError<SensitiveContentError>()(
  "MetaAgentMemory.SensitiveContentError",
  {},
) {
  override get message() {
    return "Project memory facts cannot contain credential material."
  }
}

export class AmbiguousOwnerError extends Schema.TaggedError<AmbiguousOwnerError>()(
  "MetaAgentMemory.AmbiguousOwnerError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return "Project memory requires an explicit Meta owner for this Session."
  }
}

export class InvalidSourceError extends Schema.TaggedError<InvalidSourceError>()("MetaAgentMemory.InvalidSourceError", {
  reason: Schema.Literals([
    "session_missing",
    "project_mismatch",
    "step_missing",
    "step_session_mismatch",
    "step_unverified",
  ]),
}) {
  override get message() {
    return `Project memory source cannot be verified (${this.reason}).`
  }
}

const sourceDefinitions = [
  SessionEvent.Step.Started,
  SessionEvent.Attempt.Started,
  SessionEvent.Step.Ended,
  SessionEvent.Tool.Called,
  SessionEvent.Tool.Success,
  SessionEvent.RetryScheduled,
] as const
const SourceOccurrence = Schema.Union(sourceDefinitions)
const SourceProvenance = Schema.Struct({ controller: SessionSchema.Controller, data: Schema.Unknown })

export interface RecordInput {
  readonly id?: string
  readonly sessionID: SessionSchema.ID
  readonly projectID: Project.ID
  readonly factCategory: FactCategory
  readonly content: string
  readonly sourceSessionID?: string
  readonly sourceStepID?: string
}

export interface QueryInput {
  readonly projectID: Project.ID
  readonly factCategory?: FactCategory
}

export interface SearchInput {
  readonly projectID: Project.ID
  readonly keyword: string
}

export const MemoryRecord = MetaAgent.MemoryRecord
export type MemoryRecord = MetaAgent.MemoryRecord

export interface Interface {
  readonly record: (
    input: RecordInput,
  ) => Effect.Effect<
    string,
    NotMetaSessionError | SensitiveContentError | ControllerConflictError | AmbiguousOwnerError | InvalidSourceError
  >
  readonly latest: (input: {
    readonly projectID: Project.ID
    readonly topN: number
  }) => Effect.Effect<ReadonlyArray<MemoryRecord>, InvalidFactError>
  readonly query: (input: QueryInput) => Effect.Effect<ReadonlyArray<MemoryRecord>>
  readonly search: (input: SearchInput) => Effect.Effect<ReadonlyArray<MemoryRecord>>
  readonly remove: (id: string, projectID?: Project.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/MetaAgentMemory") {}

export function invalidForModel(record: { readonly id: string; readonly content: string }) {
  if (CorrectionExtractor.hasCredentialContent(record.content))
    return new InvalidFactError({ id: record.id, reason: "credential" })
  if (!Schema.is(Content)(record.content)) return new InvalidFactError({ id: record.id, reason: "content_length" })
}

function rowToRecord(row: typeof MetaAgentMemoryTable.$inferSelect): MemoryRecord {
  return new MemoryRecord({
    id: row.id,
    projectID: Project.ID.make(row.project_id),
    metaAgentID: row.meta_agent_id,
    factCategory: row.fact_category,
    content: row.content,
    sourceSessionID: row.source_session_id ?? undefined,
    sourceStepID: row.source_step_id ?? undefined,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  })
}

const escapeLike = (keyword: string) => keyword.replaceAll(/[%_\\]/g, (char) => `\\${char}`)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const metaAgent = yield* MetaAgentService.Service

    const validateSource = Effect.fnUntraced(function* (input: RecordInput) {
      if (input.sourceSessionID === undefined && input.sourceStepID === undefined) return undefined
      const step =
        input.sourceStepID === undefined
          ? undefined
          : yield* db
              .select()
              .from(MetaAgentStepTable)
              .where(eq(MetaAgentStepTable.id, input.sourceStepID))
              .get()
              .pipe(Effect.orDie)
      if (input.sourceStepID !== undefined && !step) return yield* new InvalidSourceError({ reason: "step_missing" })
      if (step && input.sourceSessionID !== undefined && step.meta_agent_session_id !== input.sourceSessionID)
        return yield* new InvalidSourceError({ reason: "step_session_mismatch" })
      const source = yield* db
        .select()
        .from(SessionTable)
        .where(sql`${SessionTable.id} = ${input.sourceSessionID ?? step?.meta_agent_session_id}`)
        .get()
        .pipe(Effect.orDie)
      if (!source) return yield* new InvalidSourceError({ reason: "session_missing" })
      if (source.project_id !== input.projectID) return yield* new InvalidSourceError({ reason: "project_mismatch" })
      if (!step) return undefined
      const definition = sourceDefinitions.find((definition) => definition.type === step.event_type)
      const provenance = Schema.decodeUnknownOption(SourceProvenance)(step.provenance)
      if (
        !definition ||
        Option.isNone(provenance) ||
        !step.event_id ||
        step.event_seq === null ||
        step.id !== `stp_${step.event_id}`
      )
        return yield* new InvalidSourceError({ reason: "step_unverified" })
      const controller = provenance.value.controller
      if (
        controller.metaAgentID !== step.meta_agent_id ||
        controller.rootSessionID !== step.root_session_id ||
        (controller.kind === "root"
          ? source.id !== controller.rootSessionID
          : source.parent_id !== controller.rootSessionID)
      )
        return yield* new InvalidSourceError({ reason: "step_unverified" })
      const owner = yield* db
        .select()
        .from(MetaAgentSessionTable)
        .where(
          and(
            eq(MetaAgentSessionTable.meta_agent_id, controller.metaAgentID),
            eq(MetaAgentSessionTable.session_id, source.id),
          ),
        )
        .get()
        .pipe(Effect.orDie)
      const root = yield* db
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, controller.rootSessionID))
        .get()
        .pipe(Effect.orDie)
      if (
        owner?.role !== (controller.kind === "root" ? "orchestrator" : "worker") ||
        root?.project_id !== input.projectID
      )
        return yield* new InvalidSourceError({ reason: "step_unverified" })
      const retained = yield* db
        .select()
        .from(EventTable)
        .where(sql`${EventTable.id} = ${step.event_id}`)
        .get()
        .pipe(Effect.orDie)
      if (
        retained &&
        (retained.aggregate_id !== source.id ||
          retained.seq !== step.event_seq ||
          retained.type !== Event.versionedType(definition.type, definition.durable.version))
      )
        return yield* new InvalidSourceError({ reason: "step_unverified" })
      const occurrence = Schema.decodeUnknownOption(SourceOccurrence)({
        id: step.event_id,
        type: definition.type,
        created: retained?.created ?? step.time_created,
        data: retained?.data ?? provenance.value.data,
        durable: { aggregateID: source.id, seq: step.event_seq, version: definition.durable.version },
      })
      if (Option.isNone(occurrence)) return yield* new InvalidSourceError({ reason: "step_unverified" })
      const event = occurrence.value
      const modelStarted =
        event.type === SessionEvent.Step.Started.type || event.type === SessionEvent.Attempt.Started.type
      if (
        event.data.sessionID !== source.id ||
        event.data.assistantMessageID !== step.assistant_message_id ||
        ("id" in event.data ? event.data.id : null) !== step.tool_call_id ||
        step.status !== (modelStarted || event.type === SessionEvent.Tool.Called.type ? "running" : "completed")
      )
        return yield* new InvalidSourceError({ reason: "step_unverified" })
      if (modelStarted && controller.kind === "root" && event.data.agent !== "meta")
        return yield* new InvalidSourceError({ reason: "step_unverified" })
      if (retained) return undefined
      // Without event retention, only an exact producer projection verifies this occurrence.
      if (!modelStarted) return yield* new InvalidSourceError({ reason: "step_unverified" })
      const row = yield* db
        .select()
        .from(SessionMessageTable)
        .where(
          and(eq(SessionMessageTable.id, event.data.assistantMessageID), eq(SessionMessageTable.session_id, source.id)),
        )
        .get()
        .pipe(Effect.orDie)
      const assistant = Schema.decodeUnknownOption(SessionMessage.Assistant)(
        row ? { ...row.data, id: row.id, type: row.type } : undefined,
      )
      if (Option.isNone(assistant)) return yield* new InvalidSourceError({ reason: "step_unverified" })
      const origin = assistant.value.origin
      if (
        origin?.kind !== "step" ||
        origin.sessionID !== source.id ||
        origin.id !== event.id ||
        origin.seq !== event.durable.seq ||
        assistant.value.agent !== event.data.agent ||
        !sameModel(assistant.value.model, event.data.model)
      )
        return yield* new InvalidSourceError({ reason: "step_unverified" })
      return undefined
    })

    const record = Effect.fn("MetaAgentMemory.record")(function* (input: RecordInput) {
      return yield* db
        .transaction(() =>
          Effect.gen(function* () {
            const row = yield* db
              .select()
              .from(SessionTable)
              .where(eq(SessionTable.id, input.sessionID))
              .get()
              .pipe(Effect.orDie)
            const current = row?.controller ? fromRow(row) : undefined
            if (current) yield* metaAgent.assertOwner(current)
            // Historical associations do not choose a controlled Session's current owner.
            const owners = current
              ? []
              : yield* db
                  .select()
                  .from(MetaAgentSessionTable)
                  .where(eq(MetaAgentSessionTable.session_id, input.sessionID))
                  .all()
                  .pipe(Effect.orDie)
            if (owners.length > 1) return yield* new AmbiguousOwnerError({ sessionID: input.sessionID })
            const metaID = current ? current.controller?.metaAgentID : owners[0]?.meta_agent_id
            if (!metaID) return yield* new NotMetaSessionError({ sessionID: input.sessionID })
            if (CorrectionExtractor.hasCredentialContent(input.content)) return yield* new SensitiveContentError({})
            yield* validateSource(input)
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
                meta_agent_id: metaID,
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
          }),
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const latest = Effect.fn("MetaAgentMemory.latest")(function* (input: {
      readonly projectID: Project.ID
      readonly topN: number
    }) {
      const rows = yield* db
        .select()
        .from(MetaAgentMemoryTable)
        .where(eq(MetaAgentMemoryTable.project_id, input.projectID))
        .orderBy(desc(MetaAgentMemoryTable.time_updated), desc(MetaAgentMemoryTable.id))
        .limit(input.topN)
        .all()
        .pipe(Effect.orDie)
      return yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const invalid = invalidForModel(row)
          if (invalid) return yield* invalid
          return rowToRecord(row)
        }),
      )
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

    const remove = Effect.fn("MetaAgentMemory.remove")(function* (id: string, projectID?: Project.ID) {
      yield* db
        .delete(MetaAgentMemoryTable)
        .where(
          projectID === undefined
            ? eq(MetaAgentMemoryTable.id, id)
            : sql`${eq(MetaAgentMemoryTable.id, id)} AND ${eq(MetaAgentMemoryTable.project_id, projectID)}`,
        )
        .run()
        .pipe(Effect.orDie)
    })

    return Service.of({ record, latest, query, search, remove })
  }),
)

const defaultDatabase = Database.layer()
export const defaultLayer = layer.pipe(
  Layer.provide(MetaAgentService.layer.pipe(Layer.provide(SessionComposition.layer))),
  Layer.provide(defaultDatabase),
)

export const node = LayerNode.make({
  name: "MetaAgentMemory",
  layer,
  deps: [Database.node, MetaAgentService.node],
})
