import { Effect, Schema } from "effect"
import { Database } from "../database/database"
import { EventTable } from "../event/sql"
import { and, asc, eq, inArray } from "drizzle-orm"
import { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionV1 } from "../v1/session"
import { SessionSchema } from "./schema"

const ConfidenceLevel = Schema.Literals(["high", "estimated", "unavailable"])
type ConfidenceLevel = Schema.Schema.Type<typeof ConfidenceLevel>

export class StepCacheStats extends Schema.Class<StepCacheStats>("StepCacheStats")({
  assistantMessageID: Schema.String,
  hitRate: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
}) {}

export class CacheDiagnostics extends Schema.Class<CacheDiagnostics>("CacheDiagnostics")({
  sessionHitRate: Schema.Number,
  sessionCacheRead: Schema.Number,
  sessionCacheWrite: Schema.Number,
  sessionTotalInput: Schema.Number,
  confidence: ConfidenceLevel,
  perStep: Schema.Array(StepCacheStats),
  globalTotalCalls: Schema.optional(Schema.Number),
  globalHitRate: Schema.optional(Schema.Number),
  globalTotalTokens: Schema.optional(Schema.Number),
}) {}

type StepEndedData = {
  readonly assistantMessageID: string
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cache: { readonly read: number; readonly write: number }
  }
}

type V1PartUpdatedData = {
  readonly part: {
    readonly type: string
    readonly messageID: string
    readonly tokens?: {
      readonly input?: number
      readonly cache?: { readonly read?: number; readonly write?: number }
    }
  }
}

type StepTokenUsage = {
  assistantMessageID: string
  input: number
  cacheRead: number
  cacheWrite: number
}

const calcHitRate = (cacheRead: number, input: number) => {
  // `input` is nonCachedInputTokens; `cacheRead` is cacheReadInputTokens.
  // Total input seen by the model = nonCachedInputTokens + cacheReadInputTokens.
  const total = input + cacheRead
  return total > 0 ? (cacheRead / total) * 100 : 0
}

const classifyConfidence = (cacheRead: number, cacheWrite: number): ConfidenceLevel => {
  if (cacheRead > 0 && cacheWrite > 0) return "high"
  if (cacheRead > 0 || cacheWrite > 0) return "estimated"
  return "unavailable"
}

const v2StepEndedType = EventV2.versionedType(
  SessionEvent.Step.Ended.type,
  SessionEvent.Step.Ended.durable?.version ?? 2,
)

const v1PartUpdatedType = EventV2.versionedType(
  SessionV1.Event.PartUpdated.type,
  SessionV1.Event.PartUpdated.durable?.version ?? 1,
)

const cacheEventTypes = [v2StepEndedType, v1PartUpdatedType]

const extractUsage = (row: typeof EventTable.$inferSelect): StepTokenUsage | undefined => {
  if (row.type === v2StepEndedType) {
    const data = row.data as unknown as StepEndedData
    if (
      typeof data.tokens?.cache?.read !== "number" ||
      typeof data.tokens?.cache?.write !== "number" ||
      typeof data.tokens?.input !== "number"
    ) {
      return undefined
    }
    return {
      assistantMessageID: data.assistantMessageID,
      input: data.tokens.input,
      cacheRead: data.tokens.cache.read,
      cacheWrite: data.tokens.cache.write,
    }
  }

  if (row.type === v1PartUpdatedType) {
    const data = row.data as unknown as V1PartUpdatedData
    if (data.part?.type !== "step-finish") return undefined
    const tokens = data.part.tokens
    if (!tokens) return undefined
    return {
      assistantMessageID: data.part.messageID,
      input: typeof tokens.input === "number" ? tokens.input : 0,
      cacheRead: typeof tokens.cache?.read === "number" ? tokens.cache.read : 0,
      cacheWrite: typeof tokens.cache?.write === "number" ? tokens.cache.write : 0,
    }
  }

  return undefined
}

export const getCacheDiagnostics = Effect.fn("CacheDiagnostics.get")(
  function* (db: Database.Interface["db"], sessionID: SessionSchema.ID) {
    const rows = yield* db
      .select()
      .from(EventTable)
      .where(and(eq(EventTable.aggregate_id, sessionID), inArray(EventTable.type, cacheEventTypes)))
      .orderBy(asc(EventTable.seq))
      .all()

    let totalCacheRead = 0
    let totalCacheWrite = 0
    let totalInput = 0
    const perStep: StepCacheStats[] = []

    for (const row of rows) {
      const usage = extractUsage(row)
      if (!usage) continue
      totalCacheRead += usage.cacheRead
      totalCacheWrite += usage.cacheWrite
      totalInput += usage.input

      perStep.push(
        StepCacheStats.make({
          assistantMessageID: usage.assistantMessageID,
          hitRate: calcHitRate(usage.cacheRead, usage.input),
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
        }),
      )
    }

    const sessionHitRate = calcHitRate(totalCacheRead, totalInput)

    return CacheDiagnostics.make({
      sessionHitRate,
      sessionCacheRead: totalCacheRead,
      sessionCacheWrite: totalCacheWrite,
      sessionTotalInput: totalInput,
      confidence: classifyConfidence(totalCacheRead, totalCacheWrite),
      perStep,
    })
  },
)
