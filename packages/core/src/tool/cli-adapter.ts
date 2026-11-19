export * as CliAdapter from "./cli-adapter"

import { Effect, Schema } from "effect"
import { Config } from "../config"
import type { Entry } from "@aigcfroge/schema/config"
import type { ToolCallProgress } from "../acp-client/update"
import { fromConfig } from "./cli-config-adapter"
import type { ReviewEnvelope } from "@aigcfroge/schema/delegation"
import type { ReadTextFileRequest, ReadTextFileResponse } from "@agentclientprotocol/sdk"
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import type { DelegationReceipt } from "../delegation/receipt"

export type DelegationStatus = "success" | "partial" | "failed"

export type DelegationReview =
  | {
      readonly status: "valid"
      readonly envelope: ReviewEnvelope
    }
  | {
      readonly status: "invalid"
      readonly reason: "missing" | "malformed"
    }

export interface DelegationResult {
  status: DelegationStatus
  summary: string
  /** Raw stdout from the CLI process, preserved for parseResumeHint. */
  rawStdout?: string
  /**
   * External CLI session/thread id captured by an execution transport.
   * Persisted by the task driver so the next same-parent delegation resumes it.
   */
  sessionId?: string
  /** Identity of the native SDK result message, captured from one result frame. */
  sdkMessage?: { sessionID: string; messageID: string }
  /** Claude stream-json terminal identity, captured from one accepted result frame. */
  jsonlMessage?: { sessionID: string; messageID: string }
  /** ACP association is scoped to one connection's session/prompt request and response. */
  acpPrompt?: {
    sessionID: string
    requestID: string | number
    userMessageID?: string | null
    agentMessageIDs?: readonly (string | null)[]
  }
  /** Active app-server turn identifier. Never substitute the thread/session id. */
  turnId?: string
  review?: DelegationReview
  /** Stable error classification for delivery events and recovery decisions. */
  errorCode?: string
  /** A failure that requires an operator/reconciliation path before retry. */
  recoveryRequired?: boolean
  files?: { created?: string[]; modified?: string[]; deleted?: string[] }
  errors?: string[]
}

export interface CliAdapterValue<E = never> {
  readonly name: string
  readonly command: string
  readonly description: string
  readonly detect: () => Effect.Effect<boolean>
  readonly buildArgs: (input: { prompt: string; cwd: string; resumeId?: string }) => Effect.Effect<readonly string[]>
  readonly parseOutput: (stdout: string, stderr: string) => Effect.Effect<DelegationResult>
  /** Optional execution timeout in milliseconds; wins over the caller's default. */
  readonly timeout?: number
  /** Build invocation-owned state from a static descriptor. */
  readonly forCommand?: (command: string) => CliAdapterValue<E>
  /**
   * Execution transport. "jsonl" (default) spawns the CLI and parses its JSONL
   * stdout; "sdk" drives the official SDK; "acp" uses the Agent Client Protocol;
   * "app-server" uses the Codex app-server protocol.
   * Unknown values fall back to "jsonl".
   */
  readonly transport?: "jsonl" | "sdk" | "acp" | "app-server"
  /**
   * Formal transports execute through this instead of buildArgs+parseOutput.
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
    timeoutMs?: number
    readOnly?: boolean
    canUseTool?: SdkPermissionHandler
    sdkInput?: AsyncIterable<SDKUserMessage>
    onSdkObservation?: (observation: DelegationReceipt.SdkObservation) => Effect.Effect<void, Error>
    readTextFile?: AcpReadTextFileHandler
    onProgress?: (progress: ToolCallProgress) => void
    onPermission?: (request: PermissionRequest) => Effect.Effect<"allow" | "deny", Error>
    onThread?: (binding: ThreadBinding) => Effect.Effect<void, Error>
    onTurn?: (turnID: string) => Effect.Effect<void, Error>
    onText?: (text: string) => Effect.Effect<void, Error>
  }) => Effect.Effect<DelegationResult, E>
  readonly cancel?: (cwd: string, sessionId?: string) => Effect.Effect<void>
  /** Read an already completed external result without resuming or executing a turn. */
  readonly readResult?: (input: {
    cwd: string
    threadID: string
    turnID: string
    modelProvider: string
    cliVersion: string
  }) => Effect.Effect<DelegationResult, E>
  /**
   * Parse a session.resume_hint JSON frame from the CLI's stdout stream.
   * Return the external session ID if found, undefined otherwise.
   * Implementations should look for JSONL frames matching their CLI's output
   * format, e.g. for Claude Code: {"type":"session.resume_hint","sessionID":"<id>"}
   */
  readonly parseResumeHint?: (stdout: string) => string | undefined

  // App-server and ACP control plane methods (optional, only present on supporting transports)
  readonly startThread?: (options?: {
    workingDirectory?: string
    approvalPolicy?: string
    model?: string
  }) => Effect.Effect<{ threadId: string }, unknown>
  readonly resumeThread?: (
    threadId: string,
    options?: { workingDirectory?: string; model?: string },
  ) => Effect.Effect<{ threadId: string }, unknown>
  readonly forkThread?: (
    threadId: string,
    options?: { lastTurnId?: string | null; workingDirectory?: string; model?: string },
  ) => Effect.Effect<{ threadId: string }, unknown>
  readonly archiveThread?: (threadId: string, options?: { workingDirectory?: string }) => Effect.Effect<void, unknown>
  readonly deleteThread?: (threadId: string) => Effect.Effect<void, unknown>
  readonly startTurn?: (options: {
    threadId: string
    input: readonly { type: "text"; text: string }[]
    cwd?: string
  }) => Effect.Effect<{ turnId: string }, unknown>
  readonly steerTurn?: (options: {
    threadId: string
    expectedTurnId: string
    input: readonly { type: "text"; text: string }[]
  }) => Effect.Effect<{ turnId: string }, unknown>
  readonly interruptTurn?: (options: { threadId: string; turnId: string }) => Effect.Effect<void, unknown>
}

/** Parent permission facts surfaced by an SDK or JSONL tool callback. */
export type SdkPermissionRequest = {
  toolName: string
  input: Record<string, unknown>
  externalSessionID?: string
  toolUseID?: string
  requestId?: string
  signal?: AbortSignal
}
export type SdkPermissionHandler = (request: SdkPermissionRequest) => Promise<"allow" | "deny">

export type AcpReadTextFileHandler = (
  request: ReadTextFileRequest & { readonly signal: AbortSignal },
) => Promise<ReadTextFileResponse>

export type ThreadBinding = {
  threadID: string
  cwd: string
  model: string
  modelProvider: string
  cliVersion: string
}

export type PermissionRequest = {
  threadID: string
  turnID: string
  itemID: string
  requestID: string | number
} & ({ kind: "command"; command: string; cwd: string } | { kind: "file"; paths: readonly string[] })

export class UnavailableError extends Schema.TaggedError<UnavailableError>()("CliAdapter.Unavailable", {
  target: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `CLI ${this.target} is unavailable: ${this.reason}`
  }
}

// Static descriptors only. Location configuration and live callbacks never enter this cell.
const adapters = new Map<string, CliAdapterValue<Error>>()

export const registerCliAdapter = (name: string, adapter: CliAdapterValue<Error>): void => {
  adapters.set(name, adapter)
}

export const getCliAdapter = (name: string): CliAdapterValue<Error> | undefined => adapters.get(name)

export const listCliAdapters = (): CliAdapterValue<Error>[] => Array.from(adapters.values())

/** Resolve one configured transport without installing Location state globally. */
export const resolve = (entries: readonly Entry[], target: string, builtInTransports: BuiltInCliTransports = {}) =>
  Effect.gen(function* () {
    const info = Config.latest(entries, "cli_agents")?.[target]
    if (
      !info ||
      !(
        (target === "codex" && info.transport === "app-server") ||
        (target === "claude-code" &&
          (info.transport === "sdk" || info.transport === "acp" || info.transport === "jsonl"))
      )
    )
      return yield* new UnavailableError({
        target,
        reason:
          target === "claude-code"
            ? "this slice requires configured claude-code/sdk, claude-code/acp or claude-code/jsonl"
            : "this slice requires configured codex/app-server",
      })
    const registered = adapters.get(target)
    const descriptor =
      registered?.transport === info.transport ? registered : builtInTransports[target]?.[info.transport]
    if (!descriptor || descriptor.transport !== info.transport)
      return yield* new UnavailableError({ target, reason: `configured ${info.transport} transport is unavailable` })
    if (info.args?.length)
      return yield* new UnavailableError({
        target,
        reason: `${info.transport} does not accept JSONL argv templates`,
      })
    if (!descriptor.forCommand)
      return yield* new UnavailableError({ target, reason: "an invocation-scoped transport factory is required" })
    const adapter = descriptor.forCommand(info.command)
    if (!adapter.execute) return yield* new UnavailableError({ target, reason: "execute is unavailable" })
    return { ...adapter, timeout: info.timeout ?? adapter.timeout }
  })

export type BuiltInCliTransports = Readonly<
  Record<string, Partial<Record<"sdk" | "acp" | "jsonl" | "app-server", CliAdapterValue<Error>>>>
>

/**
 * Register config-defined `cli_agents` as adapters. Later entries win, so a
 * config entry sharing a built-in's name overrides it (config > built-in).
 * SDK/ACP/app-server transports exist only for built-in adapters; a
 * config entry selecting one for another name cannot be honored and fails
 * loudly instead of silently downgrading to a jsonl adapter.
 */
export const registerConfigCliAdapters = (
  entries: readonly Entry[],
  builtInTransports: BuiltInCliTransports = {},
): void => {
  const cliAgents = Config.latest(entries, "cli_agents")
  if (!cliAgents) return
  for (const [name, info] of Object.entries(cliAgents)) {
    if (info.transport === "sdk" || info.transport === "acp" || info.transport === "app-server") {
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
