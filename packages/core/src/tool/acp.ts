export * as AcpAdapter from "./acp.js"

import { Duration, Effect } from "effect"
import type * as Scope from "effect/Scope"
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type {
  AcpClientConnectionValue,
  PermissionHandler,
  ReadTextFileHandler,
  UpdateHandler,
} from "../acp-client/connection"
import { textChunk, toolCallProgress, updateOf } from "../acp-client/update"
import type { CliAdapterValue, DelegationResult, DelegationStatus, SdkPermissionHandler } from "./cli-adapter.js"

/**
 * Creates a client-side ACP connection for one delegation. The returned effect
 * runs inside the execute's acquireRelease scope, so the process/stream lives
 * only for the turn and is closed on success, failure, timeout, or interrupt.
 * `Scope.Scope` is required so the bridge process can be spawned scoped to the
 * turn; test factories return a plain `Effect<AcpClientConnectionValue>` (no scope).
 */
export interface AcpConnectionFactory {
  (input: {
    cwd: string
    resumeId?: string
    onUpdate: UpdateHandler
    requestPermission: PermissionHandler
    readTextFile?: ReadTextFileHandler
  }): Effect.Effect<AcpClientConnectionValue, unknown, Scope.Scope>
}

// Kind and raw input remain protocol observations; the owning Task decides
// whether they identify a supported resource. File reads use fs/read_text_file.
const permissionHandler =
  (canUseTool: SdkPermissionHandler | undefined, signal: AbortSignal): PermissionHandler =>
  async (request) => {
    if (!canUseTool) return rejectResponse(request)
    const decision = await canUseTool({
      toolName: request.toolCall.kind ?? "other",
      input: inputRecord(request.toolCall.rawInput),
      externalSessionID: request.sessionId,
      toolUseID: request.toolCall.toolCallId,
      signal,
    })
    return decision === "allow" ? allowResponse(request) : rejectResponse(request)
  }

// ACP tool-call raw input is opaque; the SDK-shaped permission bridge wants a
// plain record, so non-object inputs are collapsed to an empty object.
const inputRecord = (raw: unknown): Record<string, unknown> => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {}
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- opaque protocol input narrowed to the record the permission bridge expects
  return raw as Record<string, unknown>
}

const allowResponse = (request: RequestPermissionRequest): RequestPermissionResponse => {
  const option = request.options.find((o) => o.kind === "allow_once")
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : rejectResponse(request)
}

const rejectResponse = (request: RequestPermissionRequest): RequestPermissionResponse => {
  const option =
    request.options.find((o) => o.kind === "reject_once") ?? request.options.find((o) => o.kind === "reject_always")
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } }
}

const stopReasonToStatus = (stopReason: string): DelegationStatus => {
  if (stopReason === "end_turn") return "success"
  if (stopReason === "max_tokens" || stopReason === "max_turn_requests") return "partial"
  return "failed"
}

/**
 * Build a `transport: "acp"` adapter. Both claude-code-acp and codex-acp speak
 * the same Agent Client Protocol, so the adapter is parameterized by the bridge
 * command/detection and a connection factory; tests inject a mock factory and
 * production wires the real bridge process.
 */
export function makeAcpAdapter(input: {
  name: string
  command: string
  description: string
  detect: () => Effect.Effect<boolean>
  connectionFactory: AcpConnectionFactory
}): CliAdapterValue {
  return {
    name: input.name,
    command: input.command,
    description: input.description,
    transport: "acp",
    detect: input.detect,
    // Unused for the ACP transport; kept to satisfy the jsonl-shaped interface.
    buildArgs: () => Effect.succeed([]),
    parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
    execute: ({ prompt, cwd, resumeId, canUseTool, readTextFile, onProgress, timeoutMs }) =>
      // acquireRelease needs an enclosing scope; scoped() keeps the bridge
      // process alive for the turn and closes it on success/failure/interrupt.
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Effect.abortSignal
          const textParts: string[] = []
          const messageIDs = new Set<string | null>()
          let sessionId: string | undefined
          const onUpdate: UpdateHandler = (notification) => {
            const update = updateOf(notification)
            const chunk = textChunk(update)
            if (chunk !== undefined) {
              textParts.push(chunk)
              if (update.sessionUpdate === "agent_message_chunk" && update.messageId !== undefined)
                messageIDs.add(update.messageId)
            }
            const entry = toolCallProgress(update)
            if (entry) {
              // Surface the external CLI tool call live (task-card upgrade: the
              // entry's parentToolUseId links it to the parent's task card).
              onProgress?.(entry)
            }
          }
          const run = Effect.gen(function* () {
            const connection = yield* Effect.acquireRelease(
              input.connectionFactory({
                cwd,
                resumeId,
                onUpdate,
                requestPermission: permissionHandler(canUseTool, signal),
                ...(readTextFile ? { readTextFile: (request) => readTextFile({ ...request, signal }) } : {}),
              }),
              (conn) => Effect.promise(() => conn.close()).pipe(Effect.ignore),
            )
            yield* Effect.tryPromise({ try: () => connection.initialize(), catch: (error) => error })
            const activeSessionID = resumeId
              ? (yield* Effect.tryPromise({
                  try: () => connection.loadSession(cwd, resumeId),
                  catch: (error) => error,
                }),
                resumeId)
              : yield* Effect.tryPromise({ try: () => connection.newSession(cwd), catch: (error) => error })
            sessionId = activeSessionID
            const response = yield* Effect.tryPromise({
              try: () => connection.prompt(activeSessionID, prompt),
              catch: (error) => error,
            }).pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  void connection.cancel(activeSessionID).catch(() => {})
                }),
              ),
            )
            const summary = textParts.join("")
            const status = stopReasonToStatus(response.stopReason)
            const acpPrompt = {
              sessionID: response.sessionID,
              requestID: response.requestID,
              ...(response.userMessageID === undefined ? {} : { userMessageID: response.userMessageID }),
              ...(messageIDs.size === 0 ? {} : { agentMessageIDs: [...messageIDs] }),
            }
            if (status !== "failed" && !summary.trim()) {
              return {
                status: "failed" as const,
                summary: `CLI "${input.name}" completed without a final response`,
                sessionId,
                acpPrompt,
                errors: [`ACP stop reason: ${response.stopReason}`],
              }
            }
            return {
              status,
              summary: summary || `CLI "${input.name}" stopped with ${response.stopReason}`,
              sessionId,
              acpPrompt,
            }
          })
          // Execution failures (spawn, protocol, agent exit) surface as a failed
          // DelegationResult rather than a thrown error — the fill's caller treats
          // a settled "failed" the same way it does for the jsonl/SDK transports.
          return yield* run.pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(timeoutMs ?? 300_000),
              orElse: () =>
                Effect.succeed<DelegationResult>({
                  status: "failed",
                  summary: `CLI "${input.name}" execution Timed out`,
                  ...(sessionId ? { sessionId } : {}),
                  errorCode: "timeout",
                  recoveryRequired: true,
                  errors: ["Timed out"],
                }),
            }),
            Effect.catch((error) =>
              Effect.succeed<DelegationResult>({
                status: "failed",
                summary: `CLI "${input.name}" ACP execution failed: ${errorMessage(error)}`,
                ...(sessionId ? { sessionId } : {}),
                errorCode: "provider_error",
                recoveryRequired: true,
                errors: [errorMessage(error)],
              }),
            ),
          )
        }),
      ),
  }
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
