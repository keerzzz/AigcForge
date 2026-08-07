export * as CliAdapter from "./cli-adapter"

import { Effect } from "effect"
import { Config } from "../config"
import type { ToolCallProgress } from "../acp-client/update"
import { fromConfig } from "./cli-config-adapter"

export type DelegationStatus = "success" | "partial" | "failed"

export interface DelegationResult {
  status: DelegationStatus
  summary: string
  /** Raw stdout from the CLI process, preserved for parseResumeHint. */
  rawStdout?: string
  /**
   * External CLI session/thread id captured by SDK/ACP transports (jsonl
   * transports surface theirs through parseResumeHint instead). Persisted by
   * the task driver so the next same-parent delegation resumes it.
   */
  sessionId?: string
  files?: { created?: string[]; modified?: string[]; deleted?: string[] }
  errors?: string[]
}

export interface CliAdapter {
  readonly name: string
  readonly command: string
  readonly description: string
  readonly detect: () => Effect.Effect<boolean>
  readonly buildArgs: (input: { prompt: string; cwd: string; resumeId?: string }) => Effect.Effect<readonly string[]>
  readonly parseOutput: (stdout: string, stderr: string) => Effect.Effect<DelegationResult>
  /** Optional execution timeout in milliseconds; wins over the caller's default. */
  readonly timeout?: number
  /**
   * Execution transport. "jsonl" (default) spawns the CLI and parses its JSONL
   * stdout; "sdk" drives the official SDK; "acp" uses the Agent Client Protocol.
   * Unknown values fall back to "jsonl".
   */
  readonly transport?: "jsonl" | "sdk" | "acp"
  /**
   * SDK/ACP transports execute through this instead of buildArgs+parseOutput.
   * `canUseTool` is a plain async bridge (not Effect) so the SDK's permission
   * callback can drive it from its own runtime; the caller maps PermissionV2
   * decisions into it. `onProgress` receives live external-CLI tool calls as
   * they stream (ACP transports; SDK transports may omit it) so the caller can
   * surface them on the task card via `_meta.parentToolUseId`.
   */
  readonly execute?: (input: {
    prompt: string
    cwd: string
    resumeId?: string
    canUseTool?: SdkPermissionHandler
    onProgress?: (progress: ToolCallProgress) => void
  }) => Effect.Effect<DelegationResult>
  readonly cancel?: (cwd: string) => Effect.Effect<void>
  /**
   * Parse a session.resume_hint JSON frame from the CLI's stdout stream.
   * Return the external session ID if found, undefined otherwise.
   * Implementations should look for JSONL frames matching their CLI's output
   * format, e.g. for Claude Code: {"type":"session.resume_hint","sessionID":"<id>"}
   */
  readonly parseResumeHint?: (stdout: string) => string | undefined
}

/** A permission decision surfaced by an SDK transport's canUseTool callback. */
export type SdkPermissionRequest = { toolName: string; input: Record<string, unknown> }
export type SdkPermissionHandler = (request: SdkPermissionRequest) => Promise<"allow" | "deny">

// Module-level adapter registry cell — same seam pattern as TaskDriver.
// Composition roots call `registerCliAdapter` before `TaskDriver.install`.
const adapters = new Map<string, CliAdapter>()

export const registerCliAdapter = (name: string, adapter: CliAdapter): void => {
  adapters.set(name, adapter)
}

export const getCliAdapter = (name: string): CliAdapter | undefined => adapters.get(name)

export const listCliAdapters = (): CliAdapter[] => Array.from(adapters.values())

export type BuiltInCliTransports = Readonly<Record<string, Partial<Record<"sdk" | "acp", CliAdapter>>>>

/**
 * Register config-defined `cli_agents` as adapters. Later entries win, so a
 * config entry sharing a built-in's name overrides it (config > built-in).
 * SDK/ACP transports exist only for the built-in claude-code/codex adapters; a
 * config entry selecting one for another name cannot be honored and fails
 * loudly instead of silently downgrading to a jsonl adapter.
 */
export const registerConfigCliAdapters = (
  entries: readonly Config.Entry[],
  builtInTransports: BuiltInCliTransports = {},
): void => {
  const cliAgents = Config.latest(entries, "cli_agents")
  if (!cliAgents) return
  for (const [name, info] of Object.entries(cliAgents)) {
    if (info.transport === "sdk" || info.transport === "acp") {
      const selected = builtInTransports[name]?.[info.transport]
      if (!selected || selected.transport !== info.transport) {
        throw new Error(`cli_agents "${name}" transport "${info.transport}" is unavailable`)
      }
      adapters.set(name, selected)
      continue
    }
    adapters.set(name, fromConfig(name, info))
  }
}
