export * as Tools from "./tools"

import { Context, Effect, Scope } from "effect"
import { SessionSchema } from "../session/schema"
import { Tool } from "./tool"

export interface Interface {
  readonly register: (
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  /** Registers tools visible only to one Session (ADR-19 §2.2 placement). */
  readonly registerSession: (
    sessionID: SessionSchema.ID,
    tools: Readonly<Record<string, Tool.AnyTool>>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}

/** Narrow registration-only Location capability. */
export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/Tools") {}
