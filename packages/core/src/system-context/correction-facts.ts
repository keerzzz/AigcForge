export * as CorrectionFacts from "./correction-facts"

import { Schema } from "effect"
import { CorrectionStore } from "../session/correction-store"
import { SessionSchema } from "../session/schema"
import { SystemContext } from "./index"

const renderFacts = (facts: readonly CorrectionStore.Fact[]) =>
  facts.length === 0
    ? "No verified facts recorded."
    : ["Verified facts:", ...facts.map((fact) => `- ${fact.key} ${fact.correct}`)].join("\n")

/**
 * Per-session correction-facts SystemContext source.
 *
 * Composed per session by the runner (not registered in the Location-scoped
 * registry) because corrections are session-scoped: a registry source would
 * leak every session's corrections into every session's baseline. Returns
 * `undefined` when the store is disabled so the baseline (and therefore the
 * prompt-cache prefix hash) is byte-identical to the pre-feature state.
 */
export const source = (
  store: CorrectionStore.Interface,
  sessionID: SessionSchema.ID,
): SystemContext.SystemContext | undefined => {
  if (!store.enabled) return undefined
  return SystemContext.make({
    key: SystemContext.Key.make("core/correction-facts"),
    codec: Schema.toCodecJson(
      Schema.Array(
        Schema.Struct({
          key: Schema.String,
          correct: Schema.String,
        }),
      ),
    ),
    load: store.facts(sessionID),
    baseline: renderFacts,
    update: (_previous, current) => renderFacts(current),
  })
}
