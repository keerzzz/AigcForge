export * as ProductModeAgentPolicy from "./product-mode-agent-policy"

/**
 * Pure policy function for Product Mode × Agent enforcement.
 *
 * - `mode=chat` requires `chat-orchestrator` as the primary agent.
 * - `chat-orchestrator` is only valid in `chat` mode.
 * - `shell`/`command` prompts are denied in `chat` mode.
 */

export class AgentNotAllowedError extends Error {
  readonly _tag = "AgentNotAllowedError"
  constructor(readonly mode: string, readonly agent: string, readonly reason: string) {
    super(`Agent "${agent}" is not allowed in mode "${mode}": ${reason}`)
  }
}

export class CommandDeniedError extends Error {
  readonly _tag = "CommandDeniedError"
  constructor(readonly mode: string, readonly reason: string) {
    super(`Command/shell is not allowed in mode "${mode}": ${reason}`)
  }
}

export const CHAT_ORCHESTRATOR = "chat-orchestrator"

export type PolicyVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: AgentNotAllowedError | CommandDeniedError }

/**
 * Check whether the given agent is valid as a root/primary agent for the mode.
 * Returns `{ allowed: false }` with a typed error if the combination is invalid.
 */
export function checkPrimaryAgent(mode: string, agent: string): PolicyVerdict {
  if (mode === "chat") {
    if (agent !== CHAT_ORCHESTRATOR) {
      return {
        allowed: false,
        error: new AgentNotAllowedError(mode, agent, "Only chat-orchestrator is allowed in chat mode"),
      }
    }
    return { allowed: true }
  }

  // Other modes: chat-orchestrator is not allowed as primary
  if (agent === CHAT_ORCHESTRATOR) {
    return {
      allowed: false,
      error: new AgentNotAllowedError(mode, agent, "chat-orchestrator is only valid in chat mode"),
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
      error: new CommandDeniedError(mode, "Shell/command prompts are denied in chat mode"),
    }
  }
  return { allowed: true }
}
