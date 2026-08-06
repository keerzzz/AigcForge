export * as ClaudeCodeSdkAdapter from "./claude-code-sdk"

import { Effect } from "effect"
import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk"
import { which } from "../util/which"
import type { CliAdapter, DelegationResult, SdkPermissionRequest } from "./cli-adapter"

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

export const makeClaudeCodeSdkAdapter = (sdk: ClaudeSdk, name = "claude-code"): CliAdapter => ({
  name,
  command: "claude",
  description: "Claude Code — Anthropic's official AI coding assistant (SDK transport)",
  transport: "sdk",
  detect: () => Effect.sync(() => which("claude") !== null),
  // Unused for the SDK transport; kept to satisfy the jsonl-shaped interface.
  buildArgs: () => Effect.succeed([]),
  parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
  execute: ({ prompt, cwd, resumeId, canUseTool }) =>
    Effect.scoped(
      Effect.gen(function* () {
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
              sdk.query({
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

        const collected = yield* Effect.tryPromise({
          try: async () => {
            let summary = ""
            let isError = false
            let sawResult = false
            let sessionId: string | undefined
            for await (const message of sdkQuery) {
              if (message.session_id) sessionId = message.session_id
              if (message.type !== "result") continue
              sawResult = true
              isError = message.is_error === true
              if (message.result) summary = message.result
            }
            return { summary: summary.trim(), isError, sawResult, sessionId }
          },
          catch: (error) => new Error(errorMessage(error)),
        })

        if (collected.isError) {
          return {
            status: "failed" as const,
            summary: collected.summary || "Claude Code reported an error without details",
            sessionId: collected.sessionId,
            errors: collected.summary ? [collected.summary] : ["Claude Code reported an error without details"],
          }
        }
        if (!collected.sawResult || !collected.summary) {
          return emptyResult(name, collected.sessionId, "completed without a final response")
        }
        if (!collected.sessionId) return emptyResult(name, undefined, "completed without a persistent session id")
        return { status: "success" as const, summary: collected.summary, sessionId: collected.sessionId }
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed<DelegationResult>({
            status: "failed",
            summary: `CLI "${name}" SDK execution failed: ${errorMessage(error)}`,
            errors: [errorMessage(error)],
          }),
        ),
      ),
    ),
})

const emptyResult = (name: string, sessionId: string | undefined, reason: string): DelegationResult => ({
  status: "failed",
  summary: `CLI "${name}" ${reason}`,
  ...(sessionId ? { sessionId } : {}),
  errors: [reason],
})

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const adapter: CliAdapter = makeClaudeCodeSdkAdapter({ query: (input) => query(input) })
