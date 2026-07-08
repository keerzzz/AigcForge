export * as CliTimeout from "./cli-timeout"

import { collectStream } from "../process"
import { Duration, Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { CliAdapter, DelegationResult } from "./cli-adapter"

export function executeWithTimeout(
  spawner: ChildProcessSpawner["Service"],
  adapter: CliAdapter,
  input: { prompt: string; cwd: string; resumeId?: string },
  timeoutMs: number = 300_000,
): Effect.Effect<DelegationResult> {
  return Effect.gen(function* () {
    const available = yield* adapter.detect()
    if (!available) {
      return { status: "failed" as const, summary: `CLI "${adapter.name}" not available`, errors: ["CLI not found on system"] }
    }

    const args = yield* adapter.buildArgs({ prompt: input.prompt, cwd: input.cwd, resumeId: input.resumeId })
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(adapter.command, [...args], {
            cwd: input.cwd,
            extendEnv: true,
            stdin: "ignore",
            forceKillAfter: "3 seconds",
          }),
        )
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectStream(handle.stdout, 10 * 1024 * 1024),
            collectStream(handle.stderr, 10 * 1024 * 1024),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        )
        return {
          stdout: stdout.buffer,
          stderr: exitCode === 0 || stderr.buffer.length ? stderr.buffer : Buffer.from(`Process exited with code ${exitCode}`),
        }
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () => Effect.fail(new Error("Timed out")),
      }),
      Effect.catch((error) =>
        Effect.succeed({
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(error.message),
        }),
      ),
    )

    return yield* adapter.parseOutput(result.stdout.toString("utf8"), result.stderr.toString("utf8"))
  })
}
