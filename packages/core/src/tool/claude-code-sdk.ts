export * as ClaudeCodeSdkAdapter from "./claude-code-sdk"

import { Duration, Effect } from "effect"
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { CliExecutable } from "./cli-executable"
import { which } from "../util/which"
import type { CliAdapter, DelegationResult, SdkPermissionRequest } from "./cli-adapter"
import { DelegationParser } from "./delegation-parser"

export interface ClaudeQuery
  extends AsyncIterable<{
    type: string
    result?: string
    is_error?: boolean
    session_id?: string
  }> {
  close?: () => void
}

/**
 * The minimal Claude Agent SDK surface this adapter drives. Injected so unit
 * tests provide a fake and production passes the real
 * `@anthropic-ai/claude-agent-sdk` `query()` function.
 */
export interface ClaudeSdk {
  query(input: {
    prompt: string
    options?: {
      cwd?: string
      resume?: string
      persistSession?: boolean
      abortController?: AbortController
      canUseTool?: CanUseTool
    }
  }): ClaudeQuery
}

const toSdkPermissionResult = (decision: "allow" | "deny") =>
  decision === "allow"
    ? { behavior: "allow" as const }
    : { behavior: "deny" as const, message: "denied by AigcForge permission policy" }

export const makeClaudeCodeSdkAdapter = (
  sdk: ClaudeSdk | (() => Promise<ClaudeSdk>),
  name = "claude-code",
): CliAdapter & Required<Pick<CliAdapter, "execute">> => ({
  name,
  command: "claude",
  description: "Claude Code — Anthropic's official AI coding assistant (SDK transport)",
  transport: "sdk",
  detect: () => Effect.sync(() => which("claude") !== null),
  // Unused for the SDK transport; kept to satisfy the jsonl-shaped interface.
  buildArgs: () => Effect.succeed([]),
  parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
  execute: ({ prompt, cwd, resumeId, canUseTool, timeoutMs }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client =
          typeof sdk === "function"
            ? yield* Effect.tryPromise({ try: sdk, catch: (error) => new Error(errorMessage(error)) })
            : sdk
        const abortController = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (controller) => Effect.sync(() => controller.abort()),
        )
        const sdkPermission = canUseTool
          ? async (toolName: string, input: Record<string, unknown>) => {
              const request: SdkPermissionRequest = { toolName, input }
              return toSdkPermissionResult(await canUseTool(request))
            }
          : undefined
        const sdkQuery = yield* Effect.acquireRelease(
          Effect.try({
            try: () =>
              client.query({
                prompt,
                options: {
                  cwd,
                  resume: resumeId,
                  persistSession: true,
                  abortController,
                  canUseTool: sdkPermission,
                },
              }),
            catch: (error) => new Error(errorMessage(error)),
          }),
          (active) => Effect.sync(() => active.close?.()),
        )

        let observedSessionId = resumeId
        const collected = yield* Effect.tryPromise({
          try: async () => {
            let summary = ""
            let isError = false
            let sawResult = false
            let sessionId = resumeId
            for await (const message of sdkQuery) {
              if (message.session_id) {
                sessionId = message.session_id
                observedSessionId = message.session_id
              }
              if (message.type !== "result") continue
              sawResult = true
              isError = message.is_error === true
              if (message.result) summary = message.result
            }
            return { summary: summary.trim(), isError, sawResult, sessionId, timedOut: false as const }
          },
          catch: (error) => new Error(errorMessage(error)),
        }).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(timeoutMs ?? 300_000),
            orElse: () =>
              Effect.succeed({
                summary: "",
                isError: true,
                sawResult: false,
                sessionId: observedSessionId,
                timedOut: true as const,
              }),
          }),
          Effect.catch((error) =>
            Effect.succeed({
              summary: errorMessage(error),
              isError: true,
              sawResult: false,
              sessionId: observedSessionId,
              timedOut: false as const,
            }),
          ),
        )

        if (collected.timedOut) {
          return emptyResult(name, collected.sessionId, "execution Timed out", {
            errorCode: "timeout",
            recoveryRequired: true,
          })
        }

        if (collected.isError) {
          return {
            status: "failed" as const,
            summary: collected.summary || "Claude Code reported an error without details",
            sessionId: collected.sessionId,
            errorCode: "provider_error",
            recoveryRequired: true,
            errors: collected.summary ? [collected.summary] : ["Claude Code reported an error without details"],
          }
        }
        if (!collected.sawResult || !collected.summary) {
          return emptyResult(name, collected.sessionId, "completed without a final response")
        }
        if (!collected.sessionId) return emptyResult(name, undefined, "completed without a persistent session id")
        const parsed = DelegationParser.parseDelegationResult(collected.summary)
        return {
          status: "success" as const,
          summary: collected.summary,
          sessionId: collected.sessionId,
          review: parsed?.review,
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed<DelegationResult>({
            status: "failed",
            summary: `CLI "${name}" SDK execution failed: ${errorMessage(error)}`,
            ...(resumeId ? { sessionId: resumeId } : {}),
            errorCode: "provider_error",
            recoveryRequired: true,
            errors: [errorMessage(error)],
          }),
        ),
      ),
    ),
})

const emptyResult = (
  name: string,
  sessionId: string | undefined,
  reason: string,
  extra: { errorCode?: string; recoveryRequired?: boolean } = {},
): DelegationResult => ({
  status: "failed",
  summary: `CLI "${name}" ${reason}`,
  ...(sessionId ? { sessionId } : {}),
  ...extra,
  errors: [reason],
})

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// Explicitly use the user's installation instead of the CLI shipped with the SDK.
export const adapter: CliAdapter = makeClaudeCodeSdkAdapter(async () => {
  const pathToClaudeCodeExecutable = CliExecutable.resolve("claude")
  const { query } = await import("@anthropic-ai/claude-agent-sdk")
  return { query: (input) => query({ ...input, options: { ...input.options, pathToClaudeCodeExecutable } }) }
})
