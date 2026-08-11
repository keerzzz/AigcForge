export * as CorrectionExtractor from "./correction-extractor"

import { Context, Effect, Layer, Schema } from "effect"
import { CorrectionStore } from "./correction-store"
import { SessionSchema } from "./schema"

const MAX_VALUE_LENGTH = 200

// Correction signals: Chinese and English. The strong set also enables the L3
// raw-text fallback; the weak signal "no" only enables structured extraction.
const SIGNAL_PATTERNS: RegExp[] = [
  /不对/,
  /错了/,
  /应该是/,
  /\bno\b/,
  /\bwrong\b/,
  /\bshould be\b/,
  /不是/,
  /\bnot\b/,
]

const STRONG_SIGNAL_PATTERNS: RegExp[] = [
  /不对/,
  /错了/,
  /应该是/,
  /\bwrong\b/,
  /\bshould be\b/,
  /不是/,
  /\bnot\b/,
]

// Words to strip from each side before entity extraction so signal words do
// not shadow the actual corrected entity.
const STRIP_PATTERNS = /不对|错了|应该是|不是|\b(?:should be|wrong|not|no)\b/g

const SEPARATOR_PATTERN = /不是|\bnot\b/

// Extraction whitelist: only these technical shapes may be stored as
// structured corrections (DA9).
const WHITELIST_PATTERNS: RegExp[] = [
  /(?:\.{1,2}\/|[\w@.-]+\/)[\w@./_-]+/g,
  /[A-Z][\w]*(?:<[^<>]+>)/g,
  /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
  /\b(?:true|false|null|undefined)\b/g,
  /[A-Z][A-Z0-9_]{2,}/g,
  /\b[a-z_][a-zA-Z0-9_]*\b/g,
]

// Sensitive content blacklist (DA9): anything matching is never stored.
const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /Bearer\s+[a-zA-Z0-9._-]+/,
  /eyJ[a-zA-Z0-9._-]+\./,
  /password\s*[=:]/,
  /secret\s*[=:]/,
  /token\s*[=:]/,
  /api[_-]?key\s*[=:]/,
  /\.env/,
  /auth\.json/,
]

const hasSensitiveContent = (text: string) => SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))

export class ExtractionError extends Schema.TaggedErrorClass<ExtractionError>()(
  "CorrectionExtractor.ExtractionError",
  { reason: Schema.String },
) {
  override get message() {
    return `Correction extraction failed: ${this.reason}`
  }
}

export interface Interface {
  readonly extract: (
    sessionID: SessionSchema.ID,
    text: string,
  ) => Effect.Effect<ReadonlyArray<CorrectionStore.NewEntry>, CorrectionStore.InvalidEntryError | ExtractionError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/CorrectionExtractor") {}

// Entity extraction with containment dedupe: sort by position (longer first on
// ties) and drop any match that overlaps a previously kept one, so "./bar"
// wins over the bare identifier "bar" nested inside it.
const entitiesOf = (text: string): ReadonlyArray<string> => {
  const found: Array<{ value: string; index: number }> = []
  for (const pattern of WHITELIST_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      found.push({ value: match[0], index: match.index ?? 0 })
    }
  }
  found.sort((a, b) => a.index - b.index || b.value.length - a.value.length)
  const kept: Array<{ value: string; index: number }> = []
  for (const candidate of found) {
    const previous = kept.at(-1)
    if (previous && candidate.index < previous.index + previous.value.length) continue
    kept.push(candidate)
  }
  return kept.map((item) => item.value)
}

const stripSignals = (text: string) => text.replace(STRIP_PATTERNS, " ")

// Structured pair extraction: `<correct> 不是 <wrong>` / `<correct> not <wrong>`.
// correct = last whitelist entity before the separator, wrong = first after.
const extractPair = (text: string): { readonly correct: string; readonly wrong: string } | undefined => {
  const match = text.match(SEPARATOR_PATTERN)
  if (match === null || match.index === undefined) return undefined
  const separator = match[0]
  const left = stripSignals(text.slice(0, match.index))
  const right = stripSignals(text.slice(match.index + separator.length))
  const correct = entitiesOf(left).at(-1)
  const wrong = entitiesOf(right).at(0)
  if (correct === undefined || wrong === undefined || correct === wrong) return undefined
  if (correct.length > MAX_VALUE_LENGTH || wrong.length > MAX_VALUE_LENGTH) return undefined
  return { correct, wrong }
}

export const extractCorrections = (text: string): ReadonlyArray<CorrectionStore.NewEntry> => {
  if (text.length === 0) return []
  if (hasSensitiveContent(text)) return []
  const hasSignal = SIGNAL_PATTERNS.some((pattern) => pattern.test(text))
  if (!hasSignal) return []
  const pair = extractPair(text)
  if (pair !== undefined)
    return [{ key: `user:${pair.correct}`, correct: pair.correct, wrong: pair.wrong, source: "user-correction", extractLayer: 2 }]
  if (!STRONG_SIGNAL_PATTERNS.some((pattern) => pattern.test(text))) return []
  const trimmed = text.trim()
  if (trimmed.length > MAX_VALUE_LENGTH) return []
  return [{ key: `user:${trimmed}`, correct: trimmed, source: "user-correction", extractLayer: 3 }]
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const store = yield* CorrectionStore.Service
    return Service.of({
      extract: Effect.fn("CorrectionExtractor.extract")(function* (sessionID: SessionSchema.ID, text: string) {
        if (!store.enabled) return []
        const extracted = extractCorrections(text)
        if (extracted.length === 0) return []
        for (const entry of extracted) {
          if (entry.key.length === 0 || entry.correct.length === 0)
            return yield* new ExtractionError({ reason: "extracted an empty key or correct value" })
          yield* store.record({ sessionID, entry })
        }
        return extracted
      }),
    })
  }),
)
