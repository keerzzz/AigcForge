export * as ProductModeAgentPolicy from "./product-mode-agent-policy"

/**
 * Pure policy function for Product Mode × Agent enforcement.
 *
 * - `mode=chat` defaults to `meta` (delegates to `chat-orchestrator` / subagents; direct shell/writes denied; ADR-13 Amendment-2).
 * - `chat-orchestrator` is only valid in `chat` mode.
 * - `shell`/`command` prompts are denied in `chat` and `work` modes.
 */

import { Effect, Schema } from "effect"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"

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

export const META = "meta"
export const CHAT_ORCHESTRATOR = "chat-orchestrator"
export const WORK_ORCHESTRATOR = "work-orchestrator"
export const ASSISTANT_ORCHESTRATOR = "assistant-orchestrator"

/**
 * 2026-08-11 决策（元智能体调度架构讨论总结 §3.4）: chat/work 的默认 agent 是
 * meta（chat/work orchestrator 保留为 meta 的 task 委派目标）；assistant 模式
 * 默认 assistant-orchestrator —— 个人事项的 fail-closed 执行者（计划 §3.3：
 * 提醒/记忆/知识库/笔记经 assistant 会话直接执行，不做宽权限继承）。
 */
export function resolvePrimaryAgent(mode: string, agent?: string) {
  if (agent) return agent
  if (mode === "assistant") return ASSISTANT_ORCHESTRATOR
  return META
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
 *
 * chat/work: meta is the default primary; the mode orchestrator remains a valid
 * primary choice (and a task delegation target for meta).
 */
export function checkPrimaryAgent(mode: string, agent?: string): PolicyVerdict {
  if (mode === "chat") {
    if (agent !== META && agent !== CHAT_ORCHESTRATOR) {
      return {
        allowed: false,
        error: new AgentNotAllowedError({ mode, agent, reason: "Only meta or chat-orchestrator is allowed in chat mode" }),
      }
    }
    return { allowed: true }
  }

  if (mode === "work") {
    if (agent !== META && agent !== WORK_ORCHESTRATOR) {
      return {
        allowed: false,
        error: new AgentNotAllowedError({ mode, agent, reason: "Only meta or work-orchestrator is allowed in work mode" }),
      }
    }
    return { allowed: true }
  }

  if (mode === "assistant") {
    if (agent !== META && agent !== ASSISTANT_ORCHESTRATOR) {
      return {
        allowed: false,
        error: new AgentNotAllowedError({ mode, agent, reason: "Only meta or assistant-orchestrator is allowed in assistant mode" }),
      }
    }
    return { allowed: true }
  }

  // Other modes: mode-bound orchestrators are not allowed as primary
  if (agent === CHAT_ORCHESTRATOR) {
    return {
      allowed: false,
      error: new AgentNotAllowedError({ mode, agent, reason: "chat-orchestrator is only valid in chat mode" }),
    }
  }
  if (agent === WORK_ORCHESTRATOR) {
    return {
      allowed: false,
      error: new AgentNotAllowedError({ mode, agent, reason: "work-orchestrator is only valid in work mode" }),
    }
  }
  if (agent === ASSISTANT_ORCHESTRATOR) {
    return {
      allowed: false,
      error: new AgentNotAllowedError({ mode, agent, reason: "assistant-orchestrator is only valid in assistant mode" }),
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
  if (mode === "work") {
    return {
      allowed: false,
      error: new CommandDeniedError({ mode, reason: "Shell/command prompts are denied in work mode" }),
    }
  }
  return { allowed: true }
}

/**
 * Check whether delegating to an external CLI engine is allowed in the mode.
 *
 * External-CLI delegation does NOT create a child Session, so it never reaches
 * `enforcePrimary` and therefore escapes the mode-bound agent allowlist that
 * blocks write-capable subagents in chat mode. Without this check, chat mode's
 * propose-first invariant (ADR-13 Amendment-2 §1b) would have an open channel:
 * the external CLI writes the workspace under its own permissions.
 *
 * Only chat is gated by default (work/assistant open at `full` tier only):
 * chat is the sole pure-propose mode; work/coding are execution modes where
 * external CLI delegation is an explicit user action (ADR-13 Amendment-2 §1b.3).
 * Unknown modes fail safe (deny) — plan §2.4.
 */
export function checkCliDelegationAllowed(
  mode: string,
  tier: PermissionTier.ID = PermissionTier.Default,
): PolicyVerdict {
  if (mode === "chat") {
    return {
      allowed: false,
      error: new CommandDeniedError({
        mode,
        reason: "External CLI delegation is denied in chat mode; asset changes must go through propose_*_asset",
      }),
    }
  }
  if (mode === "work" || mode === "assistant") {
    if (tier === "full") return { allowed: true }
    return {
      allowed: false,
      error: new CommandDeniedError({
        mode,
        reason: "External CLI delegation in this mode requires the full session permission tier",
      }),
    }
  }
  if (mode === "coding") return { allowed: true }
  return {
    allowed: false,
    error: new CommandDeniedError({
      mode,
      reason: "External CLI delegation is denied for unknown modes",
    }),
  }
}
