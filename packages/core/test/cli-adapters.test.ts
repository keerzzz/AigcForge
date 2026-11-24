/**
 * CLI adapter contracts: legacy parser compatibility and the real Claude
 * JSONL adapter driven through the public ChildProcessSpawner stdio surface.
 *
 * @see packages/core/src/tool/claude-code.ts
 * @see packages/core/src/tool/gemini.ts
 * @see packages/core/src/tool/codex.ts
 * @see packages/core/src/tool/opencode.ts
 */

import { describe, expect, test } from "bun:test"
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  PlatformError,
  Queue,
  Schema,
  Sink,
  Stream,
} from "effect"
import { TestClock } from "effect/testing"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Config } from "@omnixa/schema/config"
import { CliAdapter } from "@omnixa/core/tool/cli-adapter"
import { ClaudeCodeAcpAdapter } from "@omnixa/core/tool/claude-code-acp"
import { ClaudeCodeSdkAdapter } from "@omnixa/core/tool/claude-code-sdk"
import { CodexAppServer } from "@omnixa/core/tool/codex-app-server"
import { AppProcess } from "@omnixa/core/process"
import { testEffect, awaitWithTimeout } from "./lib/effect"
import { ClaudeCodeAdapter } from "@omnixa/core/tool/claude-code"
import { adapter as gemini } from "@omnixa/core/tool/gemini"
import { adapter as codex } from "@omnixa/core/tool/codex"
import { adapter as opencode } from "@omnixa/core/tool/opencode"

testEffect(Layer.empty).live(
  "MC06 ACP formal resolve selects the configured transport and invocation command without replacing static descriptors",
  () =>
    Effect.gen(function* () {
      const previousClaude = CliAdapter.getCliAdapter("claude-code")
      const previousCodex = CliAdapter.getCliAdapter("codex")
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          CliAdapter.registerCliAdapter("claude-code", previousClaude ?? ClaudeCodeSdkAdapter.adapter)
          CliAdapter.registerCliAdapter("codex", previousCodex ?? CodexAppServer.adapter)
        }),
      )
      CliAdapter.registerCliAdapter("claude-code", ClaudeCodeSdkAdapter.adapter)
      CliAdapter.registerCliAdapter("codex", CodexAppServer.adapter)
      const transports: CliAdapter.BuiltInCliTransports = {
        "claude-code": {
          sdk: ClaudeCodeSdkAdapter.adapter,
          acp: ClaudeCodeAcpAdapter.adapter,
          jsonl: ClaudeCodeAdapter.adapter,
        },
        codex: { "app-server": CodexAppServer.adapter },
      }
      const first = new Config.Document({
        type: "document",
        info: {
          cli_agents: { "claude-code": { command: "/one/claude-code-acp", transport: "acp", timeout: 1234 } },
        },
      })
      const second = new Config.Document({
        type: "document",
        info: {
          cli_agents: { "claude-code": { command: "/two/claude-code-acp", transport: "acp", timeout: 5678 } },
        },
      })
      const one = yield* CliAdapter.resolve([first], "claude-code", transports)
      const two = yield* CliAdapter.resolve([first, second], "claude-code", transports)
      expect(one.transport).toBe("acp")
      expect(one.command).toBe("/one/claude-code-acp")
      expect(one.timeout).toBe(1234)
      expect(two.command).toBe("/two/claude-code-acp")
      expect(two.timeout).toBe(5678)
      expect(one.execute).not.toBe(two.execute)
      expect(CliAdapter.getCliAdapter("claude-code")).toBe(ClaudeCodeSdkAdapter.adapter)
      const sdk = yield* CliAdapter.resolve(
        [
          new Config.Document({
            type: "document",
            info: {
              cli_agents: { "claude-code": { command: "/configured/claude", transport: "sdk" } },
            },
          }),
        ],
        "claude-code",
        transports,
      )
      const native = yield* CliAdapter.resolve(
        [
          new Config.Document({
            type: "document",
            info: {
              cli_agents: { codex: { command: "/configured/codex", transport: "app-server" } },
            },
          }),
        ],
        "codex",
        transports,
      )
      expect(sdk.transport).toBe("sdk")
      expect(sdk.command).toBe("/configured/claude")
      expect(native.transport).toBe("app-server")
      expect(native.command).toBe("/configured/codex")
      const jsonl = yield* CliAdapter.resolve(
        [
          new Config.Document({
            type: "document",
            info: { cli_agents: { "claude-code": { command: "/configured/claude-jsonl", transport: "jsonl" } } },
          }),
        ],
        "claude-code",
        transports,
      )
      expect(jsonl.transport).toBe("jsonl")
      expect(jsonl.command).toBe("/configured/claude-jsonl")
      expect(jsonl.execute).not.toBe(ClaudeCodeAdapter.adapter.execute)
      expect(CliAdapter.getCliAdapter("claude-code")).toBe(ClaudeCodeSdkAdapter.adapter)
      const override = ClaudeCodeAcpAdapter.makeClaudeCodeAcpAdapter(() =>
        Effect.die(new Error("Resolve must not start a bridge")),
      )
      CliAdapter.registerCliAdapter("claude-code", override)
      const selected = yield* CliAdapter.resolve([first], "claude-code", transports)
      expect(selected.execute).not.toBe(ClaudeCodeAcpAdapter.adapter.execute)
      expect(selected.command).toBe("/one/claude-code-acp")
      expect(CliAdapter.getCliAdapter("claude-code")).toBe(override)
      const invalid = new Config.Document({
        type: "document",
        info: {
          cli_agents: { "claude-code": { command: "claude-code-acp", transport: "acp", args: ["{{prompt}}"] } },
        },
      })
      expect(yield* CliAdapter.resolve([invalid], "claude-code", transports).pipe(Effect.flip)).toBeInstanceOf(
        CliAdapter.UnavailableError,
      )
    }),
)

describe("CLI adapters — buildArgs", () => {
  const prompt = "do the thing"
  const resumeId = "ses_ext_resume_123"

  test("claude-code fresh session takes its User through stream-json stdin", () =>
    expect(Effect.runSync(ClaudeCodeAdapter.adapter.buildArgs({ prompt, cwd: "/p" }))).toEqual([
      "-p",
      "--no-chrome",
      "--output-format",
      "stream-json",
      "--verbose",
      "--input-format",
      "stream-json",
    ]))

  test("claude-code resumed session passes --resume", () =>
    expect(Effect.runSync(ClaudeCodeAdapter.adapter.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "-p",
      "--no-chrome",
      "--output-format",
      "stream-json",
      "--verbose",
      "--input-format",
      "stream-json",
      "--resume",
      resumeId,
    ]))

  test("gemini fresh session keeps prompt inline", () =>
    expect(Effect.runSync(gemini.buildArgs({ prompt, cwd: "/p" }))).toEqual(["-p", prompt]))

  test("gemini resumed session passes --resume", () =>
    expect(Effect.runSync(gemini.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "-p",
      prompt,
      "--resume",
      resumeId,
    ]))

  test("codex fresh session keeps prompt inline", () =>
    expect(Effect.runSync(codex.buildArgs({ prompt, cwd: "/p" }))).toEqual(["exec", "--json", prompt]))

  test("codex resumed session passes --resume", () =>
    expect(Effect.runSync(codex.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "exec",
      "resume",
      "--json",
      resumeId,
      prompt,
    ]))

  test("opencode fresh session keeps prompt inline", () =>
    expect(Effect.runSync(opencode.buildArgs({ prompt, cwd: "/p" }))).toEqual(["run", prompt]))

  test("opencode resumed session passes --resume", () =>
    expect(Effect.runSync(opencode.buildArgs({ prompt, cwd: "/p", resumeId }))).toEqual([
      "run",
      "--session",
      resumeId,
      prompt,
    ]))
})

describe("CLI adapters — parseResumeHint", () => {
  test("extracts sessionID from a valid resume_hint frame", () => {
    const stdout = JSON.stringify({ type: "session.resume_hint", sessionID: "abc123" })
    expect(ClaudeCodeAdapter.adapter.parseResumeHint?.(stdout)).toBe("abc123")
  })

  test("returns undefined for noise frames", () => {
    const stdout = [
      JSON.stringify({ type: "text", text: "working" }),
      JSON.stringify({ type: "result", content: "done" }),
    ].join("\n")
    expect(ClaudeCodeAdapter.adapter.parseResumeHint?.(stdout)).toBeUndefined()
  })

  test("returns undefined for malformed JSON", () => {
    expect(ClaudeCodeAdapter.adapter.parseResumeHint?.("not json at all\n{broken")).toBeUndefined()
  })
})

describe("CLI adapters — parseOutput", () => {
  test("claude type:result frame yields a DelegationResult", () => {
    const stdout = JSON.stringify({
      type: "result",
      content: "<task_result>\nInvestigated the thing.\n</task_result>",
    })
    const result = Effect.runSync(ClaudeCodeAdapter.adapter.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Investigated the thing")
  })

  test("codex text.delta frame yields a DelegationResult", () => {
    const stdout = JSON.stringify({ type: "text.delta", text: "<task_result>\nDelta result\n</task_result>" })
    const result = Effect.runSync(codex.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Delta result")
  })

  test("codex item.completed frame yields a DelegationResult", () => {
    const stdout = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "<task_result>\nItem result\n</task_result>" },
    })
    const result = Effect.runSync(codex.parseOutput(stdout, ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Item result")
  })

  test("codex falls back to tagged output parsing", () => {
    const result = Effect.runSync(codex.parseOutput("<task_result>\nFallback result\n</task_result>", ""))
    expect(result.status).toBe("success")
    expect(result.summary).toContain("Fallback result")
  })

  test("codex marks a stderr-only run as failed", () => {
    const result = Effect.runSync(codex.parseOutput("", "command not found"))
    expect(result.status).toBe("failed")
  })
})

const InitializeFrame = Schema.Struct({
  type: Schema.Literal("control_request"),
  request_id: Schema.String,
  request: Schema.Struct({
    subtype: Schema.Literal("initialize"),
    hooks: Schema.Struct({
      PreToolUse: Schema.Array(Schema.Struct({ hookCallbackIds: Schema.Array(Schema.String) })),
    }),
  }),
})

const makeJsonlPeer = (command = "/configured/claude") =>
  Effect.gen(function* () {
    const output = yield* Queue.make<Uint8Array, PlatformError.PlatformError | Cause.Done>()
    const errors = yield* Queue.make<Uint8Array, PlatformError.PlatformError | Cause.Done>()
    const input = yield* Queue.make<Record<string, unknown>, Cause.Done>()
    const exit = yield* Deferred.make<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>()
    const inputEnded = yield* Deferred.make<void>()
    const outputEnded = yield* Deferred.make<void>()
    const commands: ChildProcess.StandardCommand[] = []
    const state: {
      spawned: number
      released: number
      stdinEnds: number
      writes: Record<string, unknown>[]
      failWrites?: boolean
    } = { spawned: 0, released: 0, stdinEnds: 0, writes: [] }
    const spawner = ChildProcessSpawner.make((value) =>
      Effect.gen(function* () {
        if (!ChildProcess.isStandardCommand(value)) return yield* Effect.die(new Error("The peer requires one command"))
        state.spawned += 1
        commands.push(value)
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            state.released += 1
          }),
        )
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(0),
          exitCode: Deferred.await(exit),
          isRunning: Deferred.isDone(exit).pipe(Effect.map((ended) => !ended)),
          kill: () => Effect.void,
          stdin: Sink.forEach((chunk: Uint8Array) =>
            Effect.gen(function* () {
              if (state.failWrites)
                return yield* PlatformError.systemError({
                  _tag: "Unknown",
                  module: "ChildProcess",
                  method: "stdin",
                  description: "peer stdin disconnected",
                })
              const frame = Schema.decodeUnknownSync(
                Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
              )(new TextDecoder().decode(chunk).trim())
              state.writes.push(frame)
              yield* Queue.offer(input, frame)
            }),
          ).pipe(
            Sink.onExit((ended) =>
              Effect.gen(function* () {
                state.stdinEnds += 1
                if (Exit.isSuccess(ended)) yield* Deferred.succeed(inputEnded, undefined)
              }),
            ),
          ),
          stdout: Stream.fromQueue(output).pipe(Stream.ensuring(Deferred.succeed(outputEnded, undefined))),
          stderr: Stream.fromQueue(errors),
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        })
      }),
    )
    const emit = (frame: unknown) => Queue.offer(output, new TextEncoder().encode(JSON.stringify(frame) + "\n"))
    return {
      state,
      commands,
      input,
      inputEnded,
      outputEnded,
      exit,
      emit,
      bytes: (bytes: Uint8Array) => Queue.offer(output, bytes),
      stderr: (text: string) => Queue.offer(errors, new TextEncoder().encode(text)),
      failStdout: Queue.fail(
        output,
        PlatformError.systemError({
          _tag: "Unknown",
          module: "ChildProcess",
          method: "stdout",
          description: "peer stdout disconnected",
        }),
      ),
      closeOutput: Effect.all([Queue.end(output), Queue.end(errors)], { discard: true }),
      finish: (code = 0) =>
        Effect.all([Queue.end(output), Queue.end(errors), Deferred.succeed(exit, ChildProcessSpawner.ExitCode(code))], {
          discard: true,
        }),
      initialize: Effect.gen(function* () {
        const frame = Schema.decodeUnknownSync(InitializeFrame)(yield* Queue.take(input))
        expect(frame.request.hooks.PreToolUse).toHaveLength(1)
        expect(frame.request.hooks.PreToolUse[0]?.hookCallbackIds).toHaveLength(1)
        const callbackID = frame.request.hooks.PreToolUse[0]?.hookCallbackIds[0]
        if (callbackID === undefined) return yield* Effect.die(new Error("No registered PreToolUse callback"))
        return { requestID: frame.request_id, callbackID }
      }),
      ack: (requestID: string) =>
        emit({ type: "control_response", response: { subtype: "success", request_id: requestID, response: {} } }),
      execute: (request: Parameters<NonNullable<CliAdapter.CliAdapterValue["execute"]>>[0]) =>
        ClaudeCodeAdapter.makeClaudeCodeAdapter(command)
          .execute(request)
          .pipe(
            Effect.provide(
              AppProcess.layer.pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner))),
            ),
          ),
    }
  })

const hookFrame = (callbackID: string, requestID: string, toolUseID: string) => ({
  type: "control_request",
  request_id: requestID,
  request: {
    subtype: "hook_callback",
    callback_id: callbackID,
    tool_use_id: toolUseID,
    input: {
      hook_event_name: "PreToolUse",
      session_id: "jsonl-session",
      cwd: "/scope",
      transcript_path: "/scope/claude-transcript.jsonl",
      tool_name: "Read",
      tool_input: { file_path: "/scope/notes.txt" },
      tool_use_id: toolUseID,
    },
  },
})

const resultFrame = (body: string, uuid = "jsonl-result") => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: body,
  session_id: "jsonl-session",
  uuid,
})

const jsonlTest = testEffect(Layer.empty)

describe("Claude JSONL process protocol", () => {
  jsonlTest.effect(
    "uses one initialized stdin stream and preserves the complete last result across UTF-8 and EOF",
    () =>
      Effect.gen(function* () {
        const peer = yield* makeJsonlPeer()
        const completed = yield* Deferred.make<void>()
        const requests: CliAdapter.SdkPermissionRequest[] = []
        const execution = yield* peer
          .execute({
            prompt: "Read the notes",
            cwd: "/scope",
            readOnly: true,
            resumeId: "jsonl-session",
            canUseTool: async (request) => {
              requests.push(request)
              return "allow"
            },
          })
          .pipe(
            Effect.tap(() => Deferred.succeed(completed, undefined)),
            Effect.forkIn(yield* Effect.scope),
          )
        const initialize = yield* peer.initialize
        expect(peer.state.writes).toHaveLength(1)
        expect(yield* Deferred.isDone(peer.inputEnded)).toBe(false)
        yield* peer.ack(initialize.requestID)
        const user = yield* Queue.take(peer.input)
        expect(user).toEqual({
          type: "user",
          session_id: "",
          message: { role: "user", content: [{ type: "text", text: "Read the notes" }] },
          parent_tool_use_id: null,
        })
        expect(peer.commands[0]?.command).toBe("/configured/claude")
        expect(peer.commands[0]?.options.cwd).toBe("/scope")
        expect(peer.commands[0]?.args).toEqual([
          ...(yield* ClaudeCodeAdapter.adapter.buildArgs({
            prompt: "Read the notes",
            cwd: "/scope",
            resumeId: "jsonl-session",
          })),
          "--tools",
          "Read,Grep,Glob",
          "--setting-sources=",
          "--strict-mcp-config",
        ])
        yield* peer.emit(hookFrame(initialize.callbackID, "parent-request-17", "tool-use-61"))
        expect(yield* Queue.take(peer.input)).toEqual({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: "parent-request-17",
            response: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } },
          },
        })
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({
          toolName: "Read",
          input: { file_path: "/scope/notes.txt" },
          externalSessionID: "jsonl-session",
          toolUseID: "tool-use-61",
          requestId: "parent-request-17",
        })
        expect(yield* Deferred.isDone(peer.inputEnded)).toBe(false)
        yield* peer.emit({ ...resultFrame("First result", "first-result"), terminal_reason: "completed" })
        yield* awaitWithTimeout(Deferred.await(peer.inputEnded), "The first result did not close stdin")
        expect(yield* Deferred.isDone(completed)).toBe(false)
        yield* peer.emit({
          type: "prompt_suggestion",
          suggestion: "next",
          uuid: "suggestion-id",
          session_id: "suggestion-session",
        })
        const body = "Water 水 and emoji 🐋. ".repeat(40) + "The complete final sentence."
        const bytes = new TextEncoder().encode(JSON.stringify(resultFrame(body, "last-result")))
        const split = bytes.findIndex((byte) => byte === 0xe6) + 1
        expect(split).toBeGreaterThan(0)
        yield* peer.bytes(bytes.slice(0, split))
        yield* peer.bytes(bytes.slice(split))
        yield* peer.stderr("diagnostic output is not a failure")
        yield* peer.finish()
        const result = yield* Fiber.join(execution)
        expect(result.status).toBe("success")
        expect(result.summary).toBe(body)
        expect(result.sessionId).toBe("jsonl-session")
        expect(result.jsonlMessage).toEqual({ sessionID: "jsonl-session", messageID: "last-result" })
        expect(result.sdkMessage).toBeUndefined()
        expect(result.turnId).toBeUndefined()
        expect(result.rawStdout).toContain("suggestion-id")
        expect(peer.state).toMatchObject({ spawned: 1, released: 1, stdinEnds: 1 })
      }),
  )

  jsonlTest.effect("waits for the actual exit code after stdout EOF", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const completed = yield* Deferred.make<void>()
      const execution = yield* peer
        .execute({ prompt: "one", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(
          Effect.tap(() => Deferred.succeed(completed, undefined)),
          Effect.forkIn(yield* Effect.scope),
        )
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(resultFrame("complete"))
      yield* awaitWithTimeout(Deferred.await(peer.inputEnded), "Result did not finish the input stream")
      yield* peer.closeOutput
      yield* awaitWithTimeout(Deferred.await(peer.outputEnded), "The reader did not observe stdout EOF")
      expect(yield* Deferred.isDone(completed)).toBe(false)
      expect(yield* Deferred.isDone(peer.exit)).toBe(false)
      yield* peer.finish()
      expect((yield* Fiber.join(execution)).status).toBe("success")
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("does not send a User for an unmatched initialize response followed by EOF", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "must not send", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID + "-other")
      yield* peer.finish()
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errorCode).toBe("incomplete_result")
      expect(peer.state.writes).toHaveLength(1)
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("reports an initialize error without sending a User", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "must not send", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.emit({
        type: "control_response",
        response: { subtype: "error", request_id: initialize.requestID, error: "initialize refused" },
      })
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errors?.join(" ")).toContain("initialize refused")
      expect(peer.state.writes).toHaveLength(1)
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("reports natural stdout EOF without a result instead of parsing the control frames as text", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "one", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit({ type: "system", subtype: "init", session_id: "init-session" })
      yield* peer.finish()
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errorCode).toBe("incomplete_result")
      expect(result.jsonlMessage).toBeUndefined()
      expect(result.sessionId).toBeUndefined()
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("preserves a parent deny and sends a control error for a rejected callback", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({
          prompt: "read",
          cwd: "/scope",
          readOnly: true,
          canUseTool: async (request) => {
            if (request.toolUseID === "denied-tool") return "deny"
            throw new Error("parent permission declined without feedback")
          },
        })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(hookFrame(initialize.callbackID, "deny-request", "denied-tool"))
      expect(yield* Queue.take(peer.input)).toEqual({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: "deny-request",
          response: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } },
        },
      })
      yield* peer.emit(hookFrame(initialize.callbackID, "reject-request", "rejected-tool"))
      expect(yield* Queue.take(peer.input)).toEqual({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: "reject-request",
          error: "parent permission declined without feedback",
        },
      })
      yield* peer.emit({ ...resultFrame("Tool call was not executed"), terminal_reason: "hook_stopped" })
      yield* peer.finish()
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errors?.join(" ")).toContain("parent permission declined without feedback")
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("handles an active request once and reads cancellation while its parent callback is pending", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const entered = Promise.withResolvers<void>()
      const cancelled = Promise.withResolvers<void>()
      const release = Promise.withResolvers<"allow" | "deny">()
      const requests: CliAdapter.SdkPermissionRequest[] = []
      const execution = yield* peer
        .execute({
          prompt: "read",
          cwd: "/scope",
          readOnly: true,
          canUseTool: async (request) => {
            requests.push(request)
            request.signal?.addEventListener("abort", () => cancelled.resolve(), { once: true })
            entered.resolve()
            return release.promise
          },
        })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(hookFrame(initialize.callbackID, "cancel-request", "pending-tool"))
      yield* awaitWithTimeout(
        Effect.promise(() => entered.promise),
        "The parent callback did not start",
      )
      yield* peer.emit(hookFrame(initialize.callbackID, "cancel-request", "pending-tool"))
      yield* peer.emit({ type: "control_cancel_request", request_id: "cancel-request" })
      yield* awaitWithTimeout(
        Effect.promise(() => cancelled.promise),
        "The stdout reader did not deliver cancellation",
      )
      expect(requests).toHaveLength(1)
      expect(requests[0]?.signal?.aborted).toBe(true)
      release.resolve("allow")
      yield* peer.emit({ ...resultFrame("cancelled"), terminal_reason: "aborted_tools" })
      yield* peer.finish()
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(peer.state.writes.filter((frame) => frame.type === "control_response")).toHaveLength(0)
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("takes a later error result as one tuple instead of delivering the first success", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "one", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(resultFrame("First successful text", "first-result"))
      yield* peer.emit({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["native tail failure"],
        session_id: "error-session",
        uuid: "error-result",
      })
      yield* peer.finish()
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.summary).toBe("native tail failure")
      expect(result.jsonlMessage).toEqual({ sessionID: "error-session", messageID: "error-result" })
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("does not borrow a missing last-result SID from init or an earlier result", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "one", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit({ type: "system", subtype: "init", session_id: "unrelated-init-session" })
      yield* peer.emit(resultFrame("Earlier successful text", "earlier-result"))
      yield* peer.emit({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Last text",
        uuid: "last-result-without-SID",
      })
      yield* peer.finish()
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errorCode).toBe("malformed_output")
      expect(result.jsonlMessage).toBeUndefined()
      expect(result.sessionId).toBeUndefined()
      expect(result.summary).toBe("Last text")
    }),
  )

  jsonlTest.effect("does not accept a valid success result after a nonzero exit", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "one", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(resultFrame("Native text retained on failure"))
      yield* peer.finish(7)
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errors?.join(" ")).toContain("exited with code 7")
      expect(result.summary).toBe("Native text retained on failure")
      expect(result.jsonlMessage).toEqual({ sessionID: "jsonl-session", messageID: "jsonl-result" })
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("preserves an observed result when its stdout tail fails", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "one", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(resultFrame("Full native text before a tail error"))
      yield* awaitWithTimeout(Deferred.await(peer.inputEnded), "Result did not close stdin")
      yield* peer.failStdout
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errors?.join(" ")).toContain("peer stdout disconnected")
      expect(result.summary).toBe("Full native text before a tail error")
      expect(result.jsonlMessage).toEqual({ sessionID: "jsonl-session", messageID: "jsonl-result" })
      expect(yield* Deferred.isDone(peer.exit)).toBe(false)
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("reports a stdin write failure without waiting for the initialize timeout", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      peer.state.failWrites = true
      const result = yield* peer.execute({
        prompt: "one",
        cwd: "/scope",
        readOnly: true,
        canUseTool: async () => "allow",
      })
      expect(result.status).toBe("failed")
      expect(result.errorCode).toBe("provider_error")
      expect(result.errors?.join(" ")).toContain("peer stdin disconnected")
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("aborts the parent callback and releases the invocation on its original overall timeout", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const entered = Promise.withResolvers<void>()
      const state = { aborted: false }
      const execution = yield* peer
        .execute({
          prompt: "read",
          cwd: "/scope",
          readOnly: true,
          timeoutMs: 1000,
          canUseTool: (request) =>
            new Promise<"allow" | "deny">((_resolve, reject) => {
              request.signal?.addEventListener(
                "abort",
                () => {
                  state.aborted = true
                  reject(new Error("parent waiter cancelled"))
                },
                { once: true },
              )
              entered.resolve()
            }),
        })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(hookFrame(initialize.callbackID, "timeout-request", "timeout-tool"))
      yield* awaitWithTimeout(
        Effect.promise(() => entered.promise),
        "The permission callback did not become ready",
      )
      yield* TestClock.adjust(Duration.seconds(1))
      const result = yield* Fiber.join(execution)
      expect(result.status).toBe("failed")
      expect(result.errorCode).toBe("timeout")
      expect(state.aborted).toBe(true)
      expect(peer.state.writes.filter((frame) => frame.type === "control_response")).toHaveLength(0)
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("preserves owning Effect interruption after a result instead of returning success", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const execution = yield* peer
        .execute({ prompt: "one", cwd: "/scope", readOnly: true, canUseTool: async () => "allow" })
        .pipe(Effect.forkIn(yield* Effect.scope))
      const initialize = yield* peer.initialize
      yield* peer.ack(initialize.requestID)
      yield* Queue.take(peer.input)
      yield* peer.emit(resultFrame("observed before user cancellation"))
      yield* awaitWithTimeout(Deferred.await(peer.inputEnded), "The result did not close input")
      yield* Fiber.interrupt(execution)
      const interrupted = yield* Fiber.join(execution).pipe(Effect.exit)
      expect(Exit.isFailure(interrupted)).toBe(true)
      if (Exit.isFailure(interrupted)) expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true)
      expect(peer.state.released).toBe(1)
    }),
  )

  jsonlTest.effect("does not start a process without the supported readonly parent capability", () =>
    Effect.gen(function* () {
      const peer = yield* makeJsonlPeer()
      const result = yield* peer.execute({
        prompt: "write",
        cwd: "/scope",
        readOnly: false,
        canUseTool: async () => "allow",
      })
      expect(result.status).toBe("failed")
      expect(result.errorCode).toBe("cli_unavailable")
      expect(peer.state.spawned).toBe(0)
      expect(peer.state.writes).toHaveLength(0)
    }),
  )
})
