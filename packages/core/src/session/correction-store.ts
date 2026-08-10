export * as CorrectionStore from "./correction-store"

import { Context, Effect, Layer, Ref, Schema } from "effect"
import { Config } from "../config"
import { SessionSchema } from "./schema"

const DEFAULT_ENABLED = true
const DEFAULT_MAX_ENTRIES = 20

// TTL for interception: L1 detector corrections stop being advertised after
// this many turns. User corrections (extractLayer 2) never expire, and raw
// fallback entries (extractLayer 3) carry no `wrong` value so they never
// intercept at all.
const DETECTOR_TTL_TURNS = 10
const RAW_TTL_TURNS = 5

export const Source = Schema.Literals(["user-correction", "reference-checker", "verifier"])
export type Source = typeof Source.Type

export const ExtractLayer = Schema.Union([Schema.Literal(1), Schema.Literal(2), Schema.Literal(3)])
export type ExtractLayer = typeof ExtractLayer.Type

export class CorrectionEntry extends Schema.Class<CorrectionEntry>("CorrectionStore.CorrectionEntry")({
  key: Schema.String,
  correct: Schema.String,
  wrong: Schema.String.pipe(Schema.optional),
  source: Source,
  extractLayer: ExtractLayer,
  turnCreated: Schema.Int,
}) {}

export type NewEntry = {
  readonly key: string
  readonly correct: string
  readonly wrong?: string
  readonly source: Source
  readonly extractLayer: ExtractLayer
}

/** The injected shape: only the correct direction, never the wrong value. */
export interface Fact {
  readonly key: string
  readonly correct: string
}

type Settings = {
  readonly enabled: boolean
  readonly maxEntries: number
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.meta?.correction_store ? [entry.info.meta.correction_store] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      enabled: current.enabled ?? result.enabled,
      maxEntries: current.max_entries ?? result.maxEntries,
    }),
    { enabled: DEFAULT_ENABLED, maxEntries: DEFAULT_MAX_ENTRIES },
  )
}

export class InvalidEntryError extends Schema.TaggedErrorClass<InvalidEntryError>()(
  "CorrectionStore.InvalidEntryError",
  { reason: Schema.String },
) {
  override get message() {
    return `Invalid correction entry: ${this.reason}`
  }
}

export interface Interface {
  readonly record: (input: {
    readonly sessionID: SessionSchema.ID
    readonly entry: NewEntry
  }) => Effect.Effect<void, InvalidEntryError>
  readonly check: (input: {
    readonly sessionID: SessionSchema.ID
    readonly toolName: string
    readonly toolInput: unknown
  }) => Effect.Effect<string>
  readonly facts: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Fact>>
  /** Captured at layer construction; mirrors the DoomLoop settings contract. */
  readonly enabled: boolean
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CorrectionStore") {}

const ADVISORY_WARNING = (correct: string) =>
  `ℹ️ [纠正提醒] 此路径已纠正，正确值是 ${correct}。如确需使用旧值请忽略此提醒。`

// TTL windows per DA8: L1 detector corrections intercept for 10 turns, L3 raw
// fallback participates in injection for 5 turns, L2 user corrections never
// expire. The turn counter is bumped by every `check` call (one per settled
// tool in a turn), which makes it a close proxy for the turn number.
// Interception and injection expire independently: L1/L2 injection lasts
// until FIFO eviction, only L3 injection is bounded by its 5-turn window.
const expiresForInterception = (entry: CorrectionEntry, currentTurn: number) =>
  entry.extractLayer !== 2 && currentTurn - entry.turnCreated > DETECTOR_TTL_TURNS

const expiresForInjection = (entry: CorrectionEntry, currentTurn: number) =>
  entry.extractLayer === 3 && currentTurn - entry.turnCreated > RAW_TTL_TURNS

const toFact = (entry: CorrectionEntry): Fact => ({ key: entry.key, correct: entry.correct })

// FIFO ring buffer: keep the newest `maxEntries` entries, dropping the oldest.
const evictOldest = (entries: readonly CorrectionEntry[], maxEntries: number) =>
  entries.length >= maxEntries ? entries.slice(entries.length - maxEntries + 1) : entries

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const configured = settings(yield* config.entries())
    const buffer = yield* Ref.make(new Map<SessionSchema.ID, CorrectionEntry[]>())
    const turns = yield* Ref.make(new Map<SessionSchema.ID, number>())

    const record = Effect.fn("CorrectionStore.record")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly entry: NewEntry
    }) {
      if (!configured.enabled) return
      if (input.entry.key.length === 0)
        yield* Effect.fail(new InvalidEntryError({ reason: "key must not be empty" }))
      if (input.entry.correct.length === 0)
        yield* Effect.fail(new InvalidEntryError({ reason: "correct must not be empty" }))
      const turn = (yield* Ref.get(turns)).get(input.sessionID) ?? 0
      const entry = new CorrectionEntry({ ...input.entry, turnCreated: turn })
      yield* Ref.update(buffer, (map) => {
        const current = map.get(input.sessionID) ?? []
        // Same key + same correct: the correction is already recorded (the
        // extractor re-runs every turn on the same user message). Same key
        // with a different correct supersedes the earlier entry in place.
        const existingIndex = current.findIndex((item) => item.key === entry.key)
        if (existingIndex >= 0) {
          const existing = current[existingIndex]
          if (existing.correct === entry.correct) return map
          const next = [...current]
          next[existingIndex] = entry
          return map.set(input.sessionID, next)
        }
        return map.set(input.sessionID, [...evictOldest(current, configured.maxEntries), entry])
      })
    })

    const check = Effect.fn("CorrectionStore.check")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly toolName: string
      readonly toolInput: unknown
    }) {
      if (!configured.enabled) return ""
      const turn = yield* Ref.modify(turns, (map) => {
        const next = (map.get(input.sessionID) ?? 0) + 1
        return [next, map.set(input.sessionID, next)]
      })
      const serialized = JSON.stringify(input.toolInput) ?? ""
      const entries = (yield* Ref.get(buffer)).get(input.sessionID) ?? []
      const matched = entries.find((entry) => {
        if (entry.wrong === undefined || entry.wrong.length === 0) return false
        if (expiresForInterception(entry, turn)) return false
        return serialized.includes(entry.wrong)
      })
      if (matched === undefined) return ""
      return ADVISORY_WARNING(matched.correct)
    })

    const facts = Effect.fn("CorrectionStore.facts")(function* (sessionID: SessionSchema.ID) {
      const turn = (yield* Ref.get(turns)).get(sessionID) ?? 0
      const entries = (yield* Ref.get(buffer)).get(sessionID) ?? []
      return entries.filter((entry) => !expiresForInjection(entry, turn)).map(toFact)
    })

    return Service.of({ record, check, facts, enabled: configured.enabled })
  }),
)
