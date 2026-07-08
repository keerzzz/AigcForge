export * as CliAdapter from "./cli-adapter"

import { Effect } from "effect"

export type DelegationStatus = "success" | "partial" | "failed"

export interface DelegationResult {
  status: DelegationStatus
  summary: string
  files?: { created?: string[]; modified?: string[]; deleted?: string[] }
  errors?: string[]
}

export interface CliAdapter {
  readonly name: string
  readonly command: string
  readonly description: string
  readonly detect: () => Effect.Effect<boolean>
  readonly buildArgs: (input: { prompt: string; cwd: string }) => Effect.Effect<readonly string[]>
  readonly parseOutput: (stdout: string, stderr: string) => Effect.Effect<DelegationResult>
  readonly cancel?: (cwd: string) => Effect.Effect<void>
}

// Module-level adapter registry cell — same seam pattern as TaskDriver.
// Composition roots call `registerCliAdapter` before `TaskDriver.install`.
const adapters = new Map<string, CliAdapter>()

export const registerCliAdapter = (name: string, adapter: CliAdapter): void => {
  adapters.set(name, adapter)
}

export const getCliAdapter = (name: string): CliAdapter | undefined => adapters.get(name)
