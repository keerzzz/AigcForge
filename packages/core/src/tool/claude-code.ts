export * as ClaudeCodeAdapter from "./claude-code"

import { randomUUID } from "node:crypto"
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Option, Queue, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { AppProcess } from "../process"
import { which } from "../util/which"
import { DelegationParser } from "./delegation-parser"
import type { CliAdapterValue, DelegationResult } from "./cli-adapter"

const COMMAND = "claude"

export const makeClaudeCodeAdapter = (
  command = COMMAND,
): CliAdapterValue & Required<Pick<CliAdapterValue, "execute">> => ({
  name: "claude-code",
  command,
  description: "Claude Code CLI — Anthropic's official AI coding assistant",
  transport: "jsonl",
  forCommand: makeClaudeCodeAdapter,

  detect: () => Effect.sync(() => which(command) !== null),

  buildArgs,
  execute: (input) => execute(command, input),

  parseOutput: (stdout: string, stderr: string) =>
    Effect.gen(function* () {
      const lines = stdout.split("\n").filter(Boolean)
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          if (parsed.type !== "result" && parsed.type !== "completion") continue
          const text = typeof parsed.result === "string" ? parsed.result : (parsed.text ?? parsed.content ?? "")
          if (parsed.is_error === true) {
            return {
              status: "failed" as const,
              summary: text || stderr || "Claude Code reported an error",
              errors: [text || stderr],
            }
          }
          return yield* DelegationParser.parseDelegationOutput(text, stderr)
        } catch {
          continue
        }
      }
      return yield* DelegationParser.parseDelegationOutput(stdout, stderr)
    }),

  parseResumeHint: (stdout: string) => {
    for (const line of stdout.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        if (typeof parsed.session_id === "string") return parsed.session_id
        if (typeof parsed.sessionID === "string") return parsed.sessionID
      } catch {
        continue
      }
    }
    return undefined
  },
})

const buildArgs: CliAdapterValue["buildArgs"] = ({ resumeId }) =>
  Effect.succeed([
    "-p",
    "--no-chrome",
    "--output-format",
    "stream-json",
    "--verbose",
    "--input-format",
    "stream-json",
    ...(resumeId ? ["--resume", resumeId] : []),
  ])

class ProtocolError extends Schema.TaggedError<ProtocolError>()("ClaudeCodeAdapter.ProtocolError", {
  code: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason
  }
}

class JsonlFrame extends Schema.Class<JsonlFrame>("ClaudeCodeAdapter.JsonlFrame")({
  type: Schema.String,
  request_id: Schema.optionalKey(Schema.String),
  request: Schema.optionalKey(
    Schema.Struct({
      subtype: Schema.String,
      callback_id: Schema.optionalKey(Schema.String),
      input: Schema.optionalKey(Schema.Unknown),
      tool_use_id: Schema.optionalKey(Schema.String),
    }),
  ),
  response: Schema.optionalKey(
    Schema.Struct({
      subtype: Schema.String,
      request_id: Schema.String,
      error: Schema.optionalKey(Schema.String),
    }),
  ),
  subtype: Schema.optionalKey(Schema.String),
  is_error: Schema.optionalKey(Schema.Boolean),
  result: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(Schema.Array(Schema.String)),
  session_id: Schema.optionalKey(Schema.String),
  uuid: Schema.optionalKey(Schema.String),
  terminal_reason: Schema.optionalKey(Schema.String),
}) {}

class PreToolUse extends Schema.Class<PreToolUse>("ClaudeCodeAdapter.PreToolUse")({
  hook_event_name: Schema.Literal("PreToolUse"),
  tool_name: Schema.String,
  tool_input: Schema.Record(Schema.String, Schema.Unknown),
  tool_use_id: Schema.String,
  session_id: Schema.String,
}) {}

const execute = Effect.fn("ClaudeCodeAdapter.execute")(function* (
  command: string,
  input: Parameters<NonNullable<CliAdapterValue["execute"]>>[0],
) {
  const canUseTool = input.canUseTool
  if (input.readOnly !== true || !canUseTool)
    return {
      status: "failed" as const,
      summary: "Claude JSONL execution requires its read-only parent permission callback",
      errorCode: "cli_unavailable",
      recoveryRequired: true,
    }

  const collected: {
    result?: JsonlFrame
    stdout: Uint8Array[]
    stderr: Uint8Array[]
    controlError?: string
  } = { stdout: [], stderr: [] }
  const outcome = yield* Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* Effect.serviceOption(AppProcess.Service)
      if (Option.isNone(spawner))
        return yield* new ProtocolError({ code: "cli_unavailable", reason: "No AppProcess service for Claude JSONL" })
      const scope = yield* Effect.scope
      const args = yield* buildArgs(input)
      const handle = yield* spawner.value.spawn(
        ChildProcess.make(
          command,
          [...args, "--tools", "Read,Grep,Glob", "--setting-sources=", "--strict-mcp-config"],
          {
            cwd: input.cwd,
            extendEnv: true,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            forceKillAfter: "3 seconds",
          },
        ),
      )
      const outbox = yield* Queue.make<Uint8Array, Cause.Done>()
      const initialized = yield* Deferred.make<void, ProtocolError>()
      const broken = yield* Deferred.make<never, ProtocolError>()
      const requests = new Map<string, AbortController>()
      const initializeID = randomUUID()
      const callbackID = "hook_0"
      yield* Effect.addFinalizer(() => Queue.shutdown(outbox).pipe(Effect.asVoid))
      yield* Effect.addFinalizer(() => Effect.sync(() => requests.forEach((controller) => controller.abort())))

      const send = (value: unknown) =>
        Queue.offer(outbox, new TextEncoder().encode(JSON.stringify(value) + "\n")).pipe(
          Effect.flatMap((accepted) =>
            accepted
              ? Effect.void
              : new ProtocolError({ code: "provider_error", reason: "Claude JSONL stdin is closed" }),
          ),
        )
      const failed = (exit: Exit.Exit<unknown, ProtocolError>) =>
        Exit.isFailure(exit)
          ? Effect.all([Deferred.failCause(initialized, exit.cause), Deferred.failCause(broken, exit.cause)], {
              discard: true,
            })
          : Effect.void
      const writer = yield* Stream.fromQueue(outbox).pipe(
        Stream.run(handle.stdin),
        Effect.mapError((error) => new ProtocolError({ code: "provider_error", reason: error.message })),
        Effect.onExit(failed),
        Effect.forkIn(scope),
      )
      const stderr = yield* handle.stderr.pipe(
        Stream.runForEach((chunk) => Effect.sync(() => collected.stderr.push(chunk))),
        Effect.mapError((error) => new ProtocolError({ code: "provider_error", reason: error.message })),
        Effect.onExit(failed),
        Effect.forkIn(scope),
      )
      const reader = yield* handle.stdout.pipe(
        Stream.tap((chunk) => Effect.sync(() => collected.stdout.push(chunk))),
        Stream.decodeText(),
        Stream.splitLines,
        Stream.runForEach((line) =>
          Effect.gen(function* () {
            if (!line.trim()) return
            const frame = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(JsonlFrame))(line).pipe(
              Effect.mapError((error) => new ProtocolError({ code: "malformed_output", reason: String(error) })),
            )
            if (frame.type === "control_response") {
              if (frame.response?.request_id !== initializeID) return
              if (frame.response.subtype === "success") {
                yield* Deferred.succeed(initialized, undefined)
                return
              }
              return yield* new ProtocolError({
                code: "provider_error",
                reason: frame.response.error ?? "Claude JSONL initialize failed",
              })
            }
            if (frame.type === "control_cancel_request") {
              if (frame.request_id === undefined)
                return yield* new ProtocolError({ code: "malformed_output", reason: "Control cancellation has no ID" })
              requests.get(frame.request_id)?.abort()
              requests.delete(frame.request_id)
              return
            }
            if (frame.type === "result") {
              // Closing the single User input does not settle the result or stop stdout consumption.
              collected.result = frame
              yield* Queue.end(outbox)
              return
            }
            if (frame.type !== "control_request") return
            const requestID = frame.request_id
            const request = frame.request
            if (requestID === undefined || !request)
              return yield* new ProtocolError({
                code: "malformed_output",
                reason: "Control request has no ID or payload",
              })
            if (requests.has(requestID)) return
            const controller = new AbortController()
            requests.set(requestID, controller)
            yield* Effect.gen(function* () {
              if (request.subtype !== "hook_callback" || request.callback_id !== callbackID)
                return yield* new ProtocolError({
                  code: "provider_error",
                  reason: `Unsupported Claude control request: ${request.subtype}`,
                })
              const hook = yield* Schema.decodeUnknownEffect(PreToolUse)(request.input).pipe(
                Effect.mapError((error) => new ProtocolError({ code: "malformed_output", reason: String(error) })),
              )
              const decision = yield* Effect.tryPromise({
                try: () =>
                  canUseTool({
                    toolName: hook.tool_name,
                    input: hook.tool_input,
                    externalSessionID: hook.session_id,
                    toolUseID: hook.tool_use_id,
                    requestId: requestID,
                    signal: controller.signal,
                  }),
                catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
              }).pipe(Effect.raceFirst(AppProcess.waitForAbort(controller.signal)))
              if (controller.signal.aborted || requests.get(requestID) !== controller) return
              yield* send({
                type: "control_response",
                response: {
                  subtype: "success",
                  request_id: requestID,
                  response: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision } },
                },
              })
            }).pipe(
              Effect.catch((error) => {
                if (controller.signal.aborted || requests.get(requestID) !== controller) return Effect.void
                collected.controlError ??= error.message
                return send({
                  type: "control_response",
                  response: { subtype: "error", request_id: requestID, error: error.message },
                })
              }),
              Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
              Effect.ensuring(
                Effect.sync(() => {
                  if (requests.get(requestID) === controller) requests.delete(requestID)
                }),
              ),
              Effect.onExit(failed),
              Effect.forkIn(scope),
            )
          }),
        ),
        Effect.mapError((error) =>
          error instanceof ProtocolError ? error : new ProtocolError({ code: "provider_error", reason: error.message }),
        ),
        Effect.onExit(failed),
        Effect.ensuring(
          Effect.all(
            [
              Queue.end(outbox),
              Deferred.fail(
                initialized,
                new ProtocolError({ code: "incomplete_result", reason: "Claude stdout closed before initialize" }),
              ),
            ],
            { discard: true },
          ),
        ),
        Effect.forkIn(scope),
      )
      yield* send({
        type: "control_request",
        request_id: initializeID,
        request: { subtype: "initialize", hooks: { PreToolUse: [{ hookCallbackIds: [callbackID] }] } },
      })
      yield* Deferred.await(initialized).pipe(Effect.raceFirst(Deferred.await(broken)))
      yield* send({
        type: "user",
        session_id: "",
        message: { role: "user", content: [{ type: "text", text: input.prompt }] },
        parent_tool_use_id: null,
      })
      const ended = yield* Effect.all([Fiber.join(writer), Fiber.join(reader), Fiber.join(stderr), handle.exitCode], {
        concurrency: "unbounded",
      }).pipe(Effect.raceFirst(Deferred.await(broken)))
      return ended[3]
    }),
  ).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(input.timeoutMs ?? 300_000),
      orElse: () => Effect.succeed(new ProtocolError({ code: "timeout", reason: "Claude JSONL execution Timed out" })),
    }),
    Effect.catch((error) => Effect.succeed(error)),
  )

  const result = collected.result
  const identity =
    result?.session_id && result.uuid
      ? { sessionId: result.session_id, jsonlMessage: { sessionID: result.session_id, messageID: result.uuid } }
      : {}
  const rawStdout = Buffer.concat(collected.stdout).toString("utf8")
  const failure = (reason: string, code: string): DelegationResult => ({
    status: "failed",
    summary: result?.result || result?.errors?.join("\n") || reason,
    ...identity,
    rawStdout,
    errorCode: code,
    recoveryRequired: true,
    errors: [reason, ...(result?.errors ?? [])],
  })
  if (typeof outcome !== "number")
    return failure(outcome.message, outcome instanceof ProtocolError ? outcome.code : "provider_error")
  if (outcome !== 0)
    return failure(
      `Claude Code exited with code ${outcome}${collected.stderr.length ? `: ${Buffer.concat(collected.stderr).toString("utf8")}` : ""}`,
      "provider_error",
    )
  if (collected.controlError) return failure(collected.controlError, "provider_error")
  if (!result) return failure("Claude Code completed without a result frame", "incomplete_result")
  if (!result.session_id || !result.uuid)
    return failure("Claude result has no persistent session or message ID", "malformed_output")
  if (result.subtype !== "success" || result.is_error !== false)
    return failure(
      result.errors?.join("\n") || result.result || "Claude Code reported an error result",
      "provider_error",
    )
  if (result.terminal_reason !== undefined && result.terminal_reason !== "completed")
    return failure(`Claude result ended with ${result.terminal_reason}`, "incomplete_result")
  if (!result.result?.trim()) return failure("Claude Code completed without a final response", "incomplete_result")
  return {
    status: "success" as const,
    summary: result.result,
    ...identity,
    rawStdout,
    review: DelegationParser.parseDelegationResult(result.result)?.review,
  }
})

export const adapter = makeClaudeCodeAdapter()
