/**
 * `executeWithTimeout` contract tests — a mocked `ChildProcessSpawner` steers
 * the four terminal outcomes without spawning a real process:
 *
 * - CLI unavailable (detect false) → `failed`, never throws
 * - timeout (TestClock advance) → `failed` with a timeout message
 * - non-zero exit → `failed` with raw stdout preserved
 * - normal output → `adapter.parseOutput` result passed through
 *
 * The spawner is an explicit parameter of `executeWithTimeout`, so no layer is
 * required beyond the TestClock environment from `test/lib/effect.ts`.
 *
 * @see packages/core/src/tool/cli-timeout.ts
 */

import { describe, expect } from "bun:test"
import { Duration, Effect, Fiber, Sink, Stream } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { executeWithTimeout } from "../src/tool/cli-timeout"
import type { CliAdapter } from "../src/tool/cli-adapter"
import { it } from "./lib/effect"

const encoder = new TextEncoder()

/** A fake adapter whose parseOutput reflects a non-empty stderr as `failed`. */
const makeAdapter = (overrides: Partial<CliAdapter> = {}): CliAdapter => ({
  name: "test-cli",
  command: "test-cli",
  description: "test CLI adapter",
  detect: () => Effect.succeed(true),
  buildArgs: () => Effect.succeed([]),
  parseOutput: (stdout, stderr) =>
    Effect.succeed(
      stderr
        ? { status: "failed" as const, summary: stderr, errors: [stderr] }
        : { status: "success" as const, summary: stdout.trim() },
    ),
  ...overrides,
})

const sinkStub = Sink.drain

type SpawnResult = string | { code: number; stdout?: string; stderr?: string }

function mockSpawner(handler: (cmd: string, args: readonly string[]) => SpawnResult) {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const result = handler(std?.command ?? "", std?.args ?? [])
    const output = typeof result === "string" ? { code: 0, stdout: result, stderr: "" } : result
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(output.code)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: sinkStub,
        stdout: output.stdout ? Stream.make(encoder.encode(output.stdout)) : Stream.empty,
        stderr: output.stderr ? Stream.make(encoder.encode(output.stderr)) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => sinkStub,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return spawner
}

/** A spawner whose child never exits — drives the timeout branch. */
const hangingSpawner = ChildProcessSpawner.make(() =>
  Effect.succeed(
    ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(0),
      exitCode: Effect.never,
      isRunning: Effect.succeed(true),
      kill: () => Effect.void,
      stdin: sinkStub,
      stdout: Stream.empty,
      stderr: Stream.empty,
      all: Stream.empty,
      getInputFd: () => sinkStub,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    }),
  ),
)

describe("executeWithTimeout", () => {
  it.effect("CLI not found returns failed and does not throw", () =>
    Effect.gen(function* () {
      const spawner = mockSpawner(() => ({ code: 0, stdout: "", stderr: "" }))
      const result = yield* executeWithTimeout(spawner, makeAdapter({ detect: () => Effect.succeed(false) }), {
        prompt: "x",
        cwd: "/p",
      })
      expect(result.status).toBe("failed")
      expect(result.errors).toContain("CLI not found on system")
    }),
  )

  it.effect("timeout returns failed with a timeout message", () =>
    Effect.gen(function* () {
      const fiber = yield* executeWithTimeout(hangingSpawner, makeAdapter(), { prompt: "x", cwd: "/p" }, 300_000).pipe(
        Effect.forkIn(yield* Effect.scope),
      )
      yield* TestClock.adjust(Duration.minutes(5))
      const result = yield* Fiber.join(fiber)
      expect(result.status).toBe("failed")
      expect(result.errors?.join(" ")).toContain("Timed out")
    }),
  )

  it.effect("non-zero exit returns failed and preserves raw stdout", () =>
    Effect.gen(function* () {
      const stdout = JSON.stringify({ type: "result", content: "boom" })
      const spawner = mockSpawner(() => ({ code: 1, stdout, stderr: "nope" }))
      const result = yield* executeWithTimeout(spawner, makeAdapter(), { prompt: "x", cwd: "/p" })
      expect(result.status).toBe("failed")
      expect(result.rawStdout).toContain('"type":"result"')
    }),
  )

  it.effect("normal output passes through adapter.parseOutput", () =>
    Effect.gen(function* () {
      const spawner = mockSpawner(() => ({ code: 0, stdout: "all good", stderr: "" }))
      const result = yield* executeWithTimeout(spawner, makeAdapter(), { prompt: "x", cwd: "/p" })
      expect(result.status).toBe("success")
      expect(result.summary).toBe("all good")
    }),
  )
})
