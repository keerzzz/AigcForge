export * as ClaudeCodeSdkAdapter from "./claude-code-sdk.js"

import { Duration, Effect, Option, Schema } from "effect"
import type { CanUseTool, HookCallback, Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk"
import { CliExecutable } from "./cli-executable.js"
import { which } from "../util/which"
import type { CliAdapterValue, DelegationResult, SdkPermissionRequest } from "./cli-adapter.js"
import { DelegationParser } from "./delegation-parser.js"
import { DelegationReceipt } from "../delegation/receipt.js"

export interface ClaudeQuery
  extends AsyncIterable<{
    type: string
    result?: string
    is_error?: boolean
    session_id?: string
    uuid?: string
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
    prompt: string | AsyncIterable<SDKUserMessage>
    options?: Pick<
      Options,
      | "cwd"
      | "resume"
      | "persistSession"
      | "abortController"
      | "canUseTool"
      | "tools"
      | "settingSources"
      | "strictMcpConfig"
      | "mcpServers"
      | "hooks"
    >
  }): ClaudeQuery
}

const toSdkPermissionResult = (decision: "allow" | "deny") =>
  decision === "allow"
    ? { behavior: "allow" as const }
    : { behavior: "deny" as const, message: "denied by AigcForge permission policy" }

export const makeClaudeCodeSdkAdapter = (
  sdk: ClaudeSdk | ((command: string) => Promise<ClaudeSdk>),
  name = "claude-code",
  command = "claude",
): CliAdapterValue & Required<Pick<CliAdapterValue, "execute">> => ({
  name,
  command,
  description: "Claude Code — Anthropic's official AI coding assistant (SDK transport)",
  transport: "sdk",
  detect: () => Effect.sync(() => which(command) !== null),
  forCommand: (configuredCommand) => makeClaudeCodeSdkAdapter(sdk, name, configuredCommand),
  // Unused for the SDK transport; kept to satisfy the jsonl-shaped interface.
  buildArgs: () => Effect.succeed([]),
  parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
  execute: ({ prompt, cwd, resumeId, readOnly, canUseTool, timeoutMs, sdkInput, onSdkObservation }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client =
          typeof sdk === "function"
            ? yield* Effect.tryPromise({ try: () => sdk(command), catch: (error) => new Error(errorMessage(error)) })
            : sdk
        const abortController = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (controller) => Effect.sync(() => controller.abort()),
        )
        let observedSessionId: string | undefined
        const readOnlyTools = ["Read", "Grep", "Glob"]
        const sdkHook: HookCallback = async (input, _toolUseID, options) => {
          if (input.hook_event_name !== "PreToolUse") return {}
          const record = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(input.tool_input)
          const decision =
            canUseTool && readOnlyTools.includes(input.tool_name) && Option.isSome(record)
              ? await canUseTool({
                  toolName: input.tool_name,
                  input: record.value,
                  externalSessionID: input.session_id,
                  toolUseID: input.tool_use_id,
                  signal: options.signal,
                })
              : "deny"
          return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision } }
        }
        const sdkPermission: CanUseTool | undefined =
          !readOnly && canUseTool
            ? async (toolName, input, options) => {
                const request: SdkPermissionRequest = {
                  toolName,
                  input,
                  ...(observedSessionId ? { externalSessionID: observedSessionId } : {}),
                  toolUseID: options.toolUseID,
                  requestId: options.requestId,
                  signal: options.signal,
                }
                return toSdkPermissionResult(await canUseTool(request))
              }
            : undefined
        const sdkQuery = yield* Effect.acquireRelease(
          Effect.try({
            try: () => {
              const active = client.query({
                prompt: sdkInput ?? prompt,
                options: {
                  cwd,
                  resume: resumeId,
                  persistSession: true,
                  abortController,
                  ...(readOnly
                    ? {
                        tools: readOnlyTools,
                        settingSources: [],
                        strictMcpConfig: true,
                        mcpServers: {},
                        hooks: { PreToolUse: [{ hooks: [sdkHook] }] },
                      }
                    : { canUseTool: sdkPermission }),
                },
              })
              return { active, iterator: active[Symbol.asyncIterator]() }
            },
            catch: (error) => new Error(errorMessage(error)),
          }),
          (query) =>
            sdkInput
              ? Effect.tryPromise({
                  try: async () => {
                    // Release a pending next/hook before awaiting the original iterator's cleanup.
                    abortController.abort()
                    query.active.close?.()
                    await query.iterator.return?.()
                  },
                  catch: (error) => new Error(errorMessage(error)),
                }).pipe(Effect.orDie)
              : Effect.sync(() => query.active.close?.()),
        )

        const observe = Effect.runPromiseWith(yield* Effect.context())

        const collected = yield* Effect.tryPromise({
          try: async () => {
            let summary = ""
            let isError = false
            let sawResult = false
            let sessionId: string | undefined
            let messageId: string | undefined
            for await (const message of { [Symbol.asyncIterator]: () => sdkQuery.iterator }) {
              if (message.session_id) {
                observedSessionId = message.session_id
              }
              const observation = Schema.decodeUnknownOption(DelegationReceipt.SdkObservation)(message)
              if (onSdkObservation && Option.isSome(observation))
                await observe(onSdkObservation(observation.value), { signal: abortController.signal })
              if (message.type !== "result") continue
              sawResult = true
              isError = message.is_error === true
              summary =
                message.result ||
                (isError &&
                Option.isSome(observation) &&
                observation.value instanceof DelegationReceipt.SdkResultObservation
                  ? (observation.value.errors?.join("\n") ?? "")
                  : "")
              sessionId = message.session_id
              messageId = message.uuid
            }
            return { summary, isError, sawResult, sessionId, messageId, timedOut: false as const }
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
                sessionId: observedSessionId ?? resumeId,
                messageId: undefined,
                timedOut: true as const,
              }),
          }),
          Effect.catch((error) =>
            Effect.succeed({
              summary: errorMessage(error),
              isError: true,
              sawResult: false,
              sessionId: observedSessionId ?? resumeId,
              messageId: undefined,
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
            ...(collected.sessionId && collected.messageId
              ? { sdkMessage: { sessionID: collected.sessionId, messageID: collected.messageId } }
              : {}),
            errorCode: "provider_error",
            recoveryRequired: true,
            errors: collected.summary ? [collected.summary] : ["Claude Code reported an error without details"],
          }
        }
        if (!collected.sawResult || !collected.summary.trim()) {
          return emptyResult(name, collected.sessionId, "completed without a final response")
        }
        if (!collected.sessionId) return emptyResult(name, undefined, "completed without a persistent session id")
        if (!collected.messageId)
          return emptyResult(name, collected.sessionId, "completed without a result message id", {
            errorCode: "malformed_output",
            recoveryRequired: true,
          })
        const parsed = DelegationParser.parseDelegationResult(collected.summary)
        return {
          status: "success" as const,
          summary: collected.summary,
          sessionId: collected.sessionId,
          sdkMessage: { sessionID: collected.sessionId, messageID: collected.messageId },
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
export const adapter: CliAdapterValue = makeClaudeCodeSdkAdapter(async (command) => {
  const pathToClaudeCodeExecutable = CliExecutable.resolve("claude", which(command))
  const { query } = await import("@anthropic-ai/claude-agent-sdk")
  return { query: (input) => query({ ...input, options: { ...input.options, pathToClaudeCodeExecutable } }) }
})
