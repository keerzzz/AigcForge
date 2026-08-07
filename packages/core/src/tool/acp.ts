export * as AcpAdapter from "./acp"

import { Effect } from "effect"
import type * as Scope from "effect/Scope"
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import type { AcpClientConnection, PermissionHandler, UpdateHandler } from "../acp-client/connection"
import { textChunk, toolCallProgress, updateOf } from "../acp-client/update"
import type { CliAdapter, DelegationResult, DelegationStatus, SdkPermissionHandler } from "./cli-adapter"

/**
 * Creates a client-side ACP connection for one delegation. The returned effect
 * runs inside the execute's acquireRelease scope, so the process/stream lives
 * only for the turn and is closed on success, failure, timeout, or interrupt.
 * `Scope.Scope` is required so the bridge process can be spawned scoped to the
 * turn; test factories return a plain `Effect<AcpClientConnection>` (no scope).
 */
export interface AcpConnectionFactory {
  (input: {
    cwd: string
    resumeId?: string
    onUpdate: UpdateHandler
    requestPermission: PermissionHandler
  }): Effect.Effect<AcpClientConnection, unknown, Scope.Scope>
}

// An ACP permission request carries the tool call's category/kind and raw input
// (the protocol does not expose the tool name). The category is used as the
// PermissionV2 action so the shared bridge decides allow/deny uniformly with the
// SDK adapters' canUseTool.
const permissionHandler =
  (canUseTool: SdkPermissionHandler | undefined): PermissionHandler =>
  async (request) => {
    if (!canUseTool) return rejectResponse(request)
    const decision = await canUseTool({
      toolName: request.toolCall.kind ?? "other",
      input: inputRecord(request.toolCall.rawInput),
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
  const option = request.options.find((o) => o.kind === "allow_once") ?? request.options[0]
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
}): CliAdapter {
  return {
    name: input.name,
    command: input.command,
    description: input.description,
    transport: "acp",
    detect: input.detect,
    // Unused for the ACP transport; kept to satisfy the jsonl-shaped interface.
    buildArgs: () => Effect.succeed([]),
    parseOutput: (stdout) => Effect.succeed({ status: "success" as const, summary: stdout }),
    execute: ({ prompt, cwd, resumeId, canUseTool, onProgress }) =>
      // acquireRelease needs an enclosing scope; scoped() keeps the bridge
      // process alive for the turn and closes it on success/failure/interrupt.
      Effect.scoped(
        Effect.gen(function* () {
          const textParts: string[] = []
          const progress: Array<ReturnType<typeof toolCallProgress>> = []
          const onUpdate: UpdateHandler = (notification) => {
            const update = updateOf(notification)
            const chunk = textChunk(update)
            if (chunk) textParts.push(chunk)
            const entry = toolCallProgress(update)
            if (entry) {
              progress.push(entry)
              // Surface the external CLI tool call live (task-card upgrade: the
              // entry's parentToolUseId links it to the parent's task card).
              onProgress?.(entry)
            }
          }
          const run = Effect.gen(function* () {
            const connection = yield* Effect.acquireRelease(
              input.connectionFactory({ cwd, resumeId, onUpdate, requestPermission: permissionHandler(canUseTool) }),
              (conn) => Effect.promise(() => conn.close()).pipe(Effect.ignore),
            )
            yield* Effect.promise(() => connection.initialize())
            const sessionId = resumeId
              ? (yield* Effect.promise(() => connection.loadSession(cwd, resumeId)), resumeId)
              : yield* Effect.promise(() => connection.newSession(cwd))
            const { stopReason } = yield* Effect.promise(() => connection.prompt(sessionId, prompt))
            const summary = textParts.join("").trim()
            const status = stopReasonToStatus(stopReason)
            if (status !== "failed" && !summary) {
              return {
                status: "failed" as const,
                summary: `CLI "${input.name}" completed without a final response`,
                sessionId,
                errors: [`ACP stop reason: ${stopReason}`],
              }
            }
            return {
              status,
              summary: summary || `CLI "${input.name}" stopped with ${stopReason}`,
              sessionId,
            }
          })
          // Execution failures (spawn, protocol, agent exit) surface as a failed
          // DelegationResult rather than a thrown error — the fill's caller treats
          // a settled "failed" the same way it does for the jsonl/SDK transports.
          return yield* run.pipe(
            Effect.catch((error) =>
              Effect.succeed<DelegationResult>({
                status: "failed",
                summary: `CLI "${input.name}" ACP execution failed: ${errorMessage(error)}`,
                errors: [errorMessage(error)],
              }),
            ),
          )
        }),
      ),
  }
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
