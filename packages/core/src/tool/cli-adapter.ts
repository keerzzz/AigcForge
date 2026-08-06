export * as CliAdapter from "./cli-adapter"

import { Effect } from "effect"
import { Config } from "../config"
import { fromConfig } from "./cli-config-adapter"

export type DelegationStatus = "success" | "partial" | "failed"

export interface DelegationResult {
  status: DelegationStatus
  summary: string
  /** Raw stdout from the CLI process, preserved for parseResumeHint. */
  rawStdout?: string
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
  readonly cancel?: (cwd: string) => Effect.Effect<void>
  /**
   * Parse a session.resume_hint JSON frame from the CLI's stdout stream.
   * Return the external session ID if found, undefined otherwise.
   * Implementations should look for JSONL frames matching their CLI's output
   * format, e.g. for Claude Code: {"type":"session.resume_hint","sessionID":"<id>"}
   */
  readonly parseResumeHint?: (stdout: string) => string | undefined
}

// Module-level adapter registry cell — same seam pattern as TaskDriver.
// Composition roots call `registerCliAdapter` before `TaskDriver.install`.
const adapters = new Map<string, CliAdapter>()

export const registerCliAdapter = (name: string, adapter: CliAdapter): void => {
  adapters.set(name, adapter)
}

export const getCliAdapter = (name: string): CliAdapter | undefined => adapters.get(name)

export const listCliAdapters = (): CliAdapter[] => Array.from(adapters.values())

/**
 * Register config-defined `cli_agents` as adapters. Later entries win, so a
 * config entry sharing a built-in's name overrides it (config > built-in).
 */
export const registerConfigCliAdapters = (entries: readonly Config.Entry[]): void => {
  const cliAgents = Config.latest(entries, "cli_agents")
  if (!cliAgents) return
  for (const [name, info] of Object.entries(cliAgents)) {
    adapters.set(name, fromConfig(name, info))
  }
}
