export * as ProductModeAgentPolicy from "./product-mode-agent-policy"

/**
 * Pure policy function for Product Mode × Agent enforcement.
 *
 * - `mode=chat` requires `chat-orchestrator` as the primary agent.
 * - `chat-orchestrator` is only valid in `chat` mode.
 * - `shell`/`command` prompts are denied in `chat` mode.
 */

import { Effect, Schema } from "effect"

export class AgentNotAllowedError extends Schema.TaggedErrorClass<AgentNotAllowedError>()(
  "AgentNotAllowedError",
  {
    mode: Schema.String,
    agent: Schema.optional(Schema.String),
    reason: Schema.String,
  },
) {
  override get message() {
    return `Agent "${this.agent ?? "default"}" is not allowed in mode "${this.mode}": ${this.reason}`
  }
}

export class CommandDeniedError extends Schema.TaggedErrorClass<CommandDeniedError>()(
  "CommandDeniedError",
  {
    mode: Schema.String,
    reason: Schema.String,
  },
) {
  override get message() {
    return `Command/shell is not allowed in mode "${this.mode}": ${this.reason}`
  }
}

export const CHAT_ORCHESTRATOR = "chat-orchestrator"

export function resolvePrimaryAgent(mode: string, agent?: string) {
  if (agent) return agent
  if (mode === "chat") return CHAT_ORCHESTRATOR
  return undefined
}

/**
 * Resolve + check + die on failure in one step. Returns the resolved agent
 * on success; dies with a typed error on any policy violation.
 * Use this at every session/turn entry-point instead of repeating the pattern.
 */
export const enforcePrimary = (mode: string, agent?: string) =>
  Effect.gen(function* () {
    const resolved = resolvePrimaryAgent(mode, agent)
    const verdict = checkPrimaryAgent(mode, resolved)
    if (!verdict.allowed) return yield* Effect.die(verdict.error)
    return resolved
  })

export type PolicyVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: AgentNotAllowedError | CommandDeniedError }

/**
 * Check whether the given agent is valid as a root/primary agent for the mode.
 * Returns `{ allowed: false }` with a typed error if the combination is invalid.
 */
export function checkPrimaryAgent(mode: string, agent?: string): PolicyVerdict {
  if (mode === "chat") {
    if (agent !== CHAT_ORCHESTRATOR) {
      return {
        allowed: false,
        error: new AgentNotAllowedError({ mode, agent, reason: "Only chat-orchestrator is allowed in chat mode" }),
      }
    }
    return { allowed: true }
  }

  // Other modes: chat-orchestrator is not allowed as primary
  if (agent === CHAT_ORCHESTRATOR) {
    return {
      allowed: false,
      error: new AgentNotAllowedError({ mode, agent, reason: "chat-orchestrator is only valid in chat mode" }),
    }
  }
  return { allowed: true }
}

/**
 * Check whether a command/shell prompt is allowed in the given mode.
 */
export function checkCommandAllowed(mode: string): PolicyVerdict {
  if (mode === "chat") {
    return {
      allowed: false,
      error: new CommandDeniedError({ mode, reason: "Shell/command prompts are denied in chat mode" }),
    }
  }
  return { allowed: true }
}
