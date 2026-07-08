/**
 * Re-exported from core for V1 backward compatibility.
 * V2 uses core directly.
 */
export {
  type EngineDispatchEntry,
  ENGINE_DISPATCH,
  type SelectEngineInput,
  selectEngine,
} from "@aigcfroge/core/agent/meta/engine-selector"

export * as MetaEngine from "@aigcfroge/core/agent/meta/engine-selector"
