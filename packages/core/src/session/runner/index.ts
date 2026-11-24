export * as SessionRunner from "./index.js"

import type { FileSystem } from "../../filesystem.js"
import type { AIError } from "@omnixa/ai"
import { Context, Data, Effect } from "effect"
import { SessionSchema } from "../schema.js"
import type { Promotable } from "../inbox.js"
import type { AgentNotFoundError, MessageDecodeError, StepFailedError } from "../error.js"
import { SessionRunnerModel } from "./model.js"
import type { Instructions } from "../../instructions/index.js"
import type { SessionContext } from "../context.js"
import type { SessionMemoryAdmission } from "../memory-admission.js"
import type { CorrectionStore } from "../correction-store.js"

export type RunError =
  | AIError
  | SessionRunnerModel.Error
  | MessageDecodeError
  | AgentNotFoundError
  | SessionContext.Error
  | SessionMemoryAdmission.Error
  | CorrectionStore.InvalidEntryError
  | StepFailedError
  | Instructions.InitializationBlocked
  | FileSystem.DirectoryNotFoundError

export type Continuation = { readonly step: number }

export type DrainResult = Data.TaggedEnum<{
  Complete: {}
  Moved: { readonly continuation?: Continuation }
  Reloaded: { readonly force: boolean; readonly continuation?: Continuation }
}>
export const DrainResult = Data.taggedEnum<DrainResult>()

/** Runs one local continuation from already-recorded Session history. */
export interface Interface {
  /** Drains eligible durable work, returning transient state when execution must continue at a new Location. */
  readonly drain: (input: {
    readonly sessionID: SessionSchema.ID
    readonly force: boolean
    readonly continuation?: Continuation
    /** "steer" settles the active intent without promoting queued next-turn work. */
    readonly promotable?: Promotable
  }) => Effect.Effect<DrainResult, RunError>
}

export class Service extends Context.Service<Service, Interface>()("@omnixa/SessionRunner") {}
