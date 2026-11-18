import type { AgentApi } from "@aigcfroge/client/effect/api"
import type { Agent } from "@aigcfroge/schema/agent"
import type { Session } from "@aigcfroge/schema/session"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface AgentEditor {
  list(): readonly Types.DeepMutable<Agent.Info>[]
  get(id: string): Types.DeepMutable<Agent.Info> | undefined
  default(id: string | undefined): void
  update(id: string, update: (agent: Types.DeepMutable<Agent.Info>) => void): void
  remove(id: string): void
}

export interface AgentDomain extends AgentApi<unknown> {
  /** Session-scoped lookups use its frozen Custom composition and placement. */
  readonly get: (
    input: Parameters<AgentApi<unknown>["get"]>[0] & { readonly sessionID?: Session.ID },
  ) => ReturnType<AgentApi<unknown>["get"]>
  readonly transform: Transform<AgentEditor>
  readonly reload: () => Effect.Effect<void>
}
