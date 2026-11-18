export * as CompositionConsumerView from "./consumer-view"

// The consumer-view algebra is schema-owned so the app composer can resolve the
// same frozen catalog for the slash popover without deep-importing core. This
// module is a pure re-export; behavior tests live in
// packages/core/test/composition-consumer-view.test.ts (protected baseline).
export {
  isScopedGraph,
  resolveScope,
  resolveScopeForAgent,
  isBindingSatisfied,
  getInstructions,
  getPrompts,
  getSkills,
  getCommands,
} from "@aigcfroge/schema/composition-consumer-view"
export type { Scope } from "@aigcfroge/schema/composition-consumer-view"
