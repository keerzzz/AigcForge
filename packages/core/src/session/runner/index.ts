export * as SessionRunner from "./index"

import type { LLMError } from "@aigcfroge/llm"
import { Context, Effect, Schema } from "effect"
import { SessionSchema } from "../schema"
import type { ContextSnapshotDecodeError, MessageDecodeError } from "../error"
import { SessionRunnerModel } from "./model"
import type { SystemContext } from "../../system-context/index"
import type { ToolOutputStore } from "../../tool-output-store"

/**
 * Custom Mode fail-closed guard. A provider turn for a custom Session requires a
 * readable Snapshot whose frozen tool catalog still matches the live registry;
 * a missing row, an undecodable row, or any fingerprint/catalog divergence fails
 * the turn with this typed error instead of widening the tool set (MEDIUM-3).
 */
export class SnapshotDriftError extends Schema.TaggedErrorClass<SnapshotDriftError>()(
  "SessionRunner.SnapshotDriftError",
  {
    sessionID: Schema.String,
    reason: Schema.String,
    details: Schema.optional(Schema.String),
  },
) {}

export type RunError =
  | LLMError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | ContextSnapshotDecodeError
  | SystemContext.InitializationBlocked
  | ToolOutputStore.Error
  | SnapshotDriftError

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work. Explicit runs perform one provider attempt even when no work is eligible. */
  readonly run: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
  }) => Effect.Effect<void, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionRunner") {}
