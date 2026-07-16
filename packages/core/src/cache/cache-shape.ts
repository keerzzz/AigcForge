import { createHash } from "crypto"
import { Schema } from "effect"

// ── Data types ──────────────────────────────────────────────────────

/**
 * PrefixShape captures the portions of the request prefix that influence
 * provider-side prompt-cache reuse. Comparing snapshots across turns
 * lets us explain *why* a cache hit-rate change happened.
 */
export class PrefixShape extends Schema.Class<PrefixShape>("Cache.PrefixShape")({
  systemHash: Schema.String,
  toolsHash: Schema.String,
  prefixHash: Schema.String,
  rewriteVersion: Schema.Number,
  toolSchemaTokens: Schema.Number,
}) {}

/**
 * Cache diagnostics for one provider turn. Carries the prefix comparison
 * result alongside the actual cache-hit/miss token counts so a frontend
 * can attribute churn to a specific cause.
 */
export class CacheDiagnostics extends Schema.Class<CacheDiagnostics>("Cache.CacheDiagnostics")({
  prefixHash: Schema.String,
  prefixChanged: Schema.Boolean,
  prefixChangeReasons: Schema.Array(Schema.String),
  systemHash: Schema.String,
  toolsHash: Schema.String,
  rewriteVersion: Schema.Number,
  toolSchemaTokens: Schema.Number,
  cacheReadInputTokens: Schema.Number,
  nonCachedInputTokens: Schema.Number,
}) {}

// ── Helpers ──────────────────────────────────────────────────────────

const shortHash = (value: unknown): string => {
  const json = JSON.stringify(value)
  return createHash("sha256").update(json).digest("hex").slice(0, 16)
}

/** Normalize tool schemas by sorting so insertion order doesn't perturb the hash. */
const normalizeToolSchemas = (schemas: readonly { name: string; description?: string; parameters?: unknown }[]) =>
  [...schemas].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    const descA = a.description ?? ""
    const descB = b.description ?? ""
    if (descA !== descB) return descA < descB ? -1 : 1
    return 0
  })

/** Rough token estimate from byte length (~4 chars per token for code-heavy JSON). */
const estimateTokens = (s: string): number => Math.ceil(s.length / 4)

// ── Public API ───────────────────────────────────────────────────────

/**
 * Take a snapshot of the current prefix state.
 * @param system system prompt text
 * @param tools tool schemas
 * @param rewriteVersion incremented on each compaction / history rewrite
 */
export const capture = (
  system: string,
  tools: readonly { name: string; description?: string; parameters?: unknown }[],
  rewriteVersion: number,
): PrefixShape => {
  const normalized = normalizeToolSchemas(tools)
  const toolsJSON = JSON.stringify(normalized)
  return new PrefixShape({
    systemHash: shortHash(system),
    toolsHash: shortHash(toolsJSON),
    prefixHash: shortHash({ system, tools: toolsJSON }),
    rewriteVersion,
    toolSchemaTokens: estimateTokens(toolsJSON),
  })
}

/**
 * Compare two prefix shapes and produce diagnostics.
 * When prev is undefined (first turn) prefixChanged is false.
 */
export const compare = (
  prev: PrefixShape | undefined,
  cur: PrefixShape,
  cacheReadInputTokens: number,
  nonCachedInputTokens: number,
): CacheDiagnostics => {
  const reasons: string[] = []
  if (prev && prev.systemHash !== cur.systemHash) reasons.push("system")
  if (prev && prev.toolsHash !== cur.toolsHash) reasons.push("tools")
  if (prev && prev.rewriteVersion !== cur.rewriteVersion) reasons.push("log_rewrite")
  return new CacheDiagnostics({
    prefixHash: cur.prefixHash,
    prefixChanged: reasons.length > 0,
    prefixChangeReasons: reasons,
    systemHash: cur.systemHash,
    toolsHash: cur.toolsHash,
    rewriteVersion: cur.rewriteVersion,
    toolSchemaTokens: cur.toolSchemaTokens,
    cacheReadInputTokens,
    nonCachedInputTokens,
  })
}

export * as CacheShape from "./cache-shape"
