export * as PersonalMemory from "./personal-memory"

import { Schema } from "effect"
import { descending } from "./identifier"
import { withStatics } from "./schema"

/**
 * Personal memory contract (Assistant PRD §9, M2): user-level memory that
 * spans projects. Entries are ONLY proposed by the AI (`propose_memory`) and
 * confirmed by the user — no self-edit auto-injection. Derived entries stay
 * pending (never injected) until confirmed.
 */

export const ID = Schema.String.check(Schema.isStartsWith("pm_")).pipe(
  Schema.brand("PersonalMemoryID"),
  withStatics((schema) => ({
    create: () => schema.make("pm_" + descending()),
  })),
)
export type ID = typeof ID.Type

/** How the memory was produced: explicit user statements vs AI-derived. */
export const Source = Schema.Literals(["explicit", "derived"]).annotate({ identifier: "MemorySource" })
export type Source = typeof Source.Type

export const TrustLevel = Schema.Literals(["high", "medium", "low"]).annotate({ identifier: "MemoryTrustLevel" })
export type TrustLevel = typeof TrustLevel.Type

export const SensitivityLevel = Schema.Literals(["high", "medium", "low"]).annotate({
  identifier: "MemorySensitivityLevel",
})
export type SensitivityLevel = typeof SensitivityLevel.Type

/** pending → confirmed | rejected; deleted is terminal (audit keeps the row). */
export const Status = Schema.Literals(["pending", "confirmed", "rejected", "deleted"]).annotate({
  identifier: "MemoryStatus",
})
export type Status = typeof Status.Type

export class Info extends Schema.Class<Info>("PersonalMemory.Info")({
  id: ID,
  content: Schema.String.annotate({ description: "Memory content" }),
  source: Source,
  trustLevel: TrustLevel,
  sensitivityLevel: SensitivityLevel,
  status: Status,
  sourceSessionID: Schema.optional(Schema.String).annotate({ description: "Session that proposed the memory" }),
  sourceMessageID: Schema.optional(Schema.String),
  createdBy: Schema.optional(Schema.String).annotate({ description: "Who created the entry (agent id or user)" }),
  confirmedAt: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}
