export * as AcpProcessConnection from "./process"

import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ndJsonStream } from "@agentclientprotocol/sdk"
import type { AcpConnectionFactory } from "../tool/acp"
import { makeClientConnection } from "./connection"

/**
 * Spawn a long-lived ACP bridge process (`claude-code-acp`/`codex-acp`) over
 * stdio and wrap it as a client connection.
 *
 * The returned effect requires `Scope.Scope`: the adapter's `Effect.acquireRelease`
 * provides it, so the bridge process lives exactly as long as the turn and is
 * killed when the scope closes (success, failure, timeout, or interrupt).
 */
export function makeBridgeConnectionFactory(input: { command: string; args: readonly string[] }): AcpConnectionFactory {
  return ({ cwd, onUpdate, requestPermission }) =>
    Effect.gen(function* () {
      const spawner = yield* Effect.serviceOption(ChildProcessSpawner)
      if (spawner._tag === "None") {
        return yield* Effect.fail(new Error(`ACP bridge "${input.command}" unavailable (no process spawner)`))
      }
      const handle = yield* spawner.value.spawn(
        ChildProcess.make(input.command, [...input.args], {
          cwd,
          extendEnv: true,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "ignore",
          forceKillAfter: "3 seconds",
        }),
      )
      // Bridge the effect-native stdio to the Web Streams the ACP SDK expects:
      // writable side feeds the child's stdin (a Sink), readable side subscribes
      // to the child's stdout (a Stream).
      const output = new WritableStream<Uint8Array>({
        write(chunk) {
          // Stream.run feeds one chunk into the stdin sink; a rejection surfaces
          // through the WritableStream's error path.
          return Effect.runPromise(Stream.fromIterable([chunk]).pipe(Stream.run(handle.stdin)))
        },
      })
      const inputStream = new ReadableStream<Uint8Array>({
        start(controller) {
          void Effect.runPromise(
            Stream.runForEach(handle.stdout, (chunk) => Effect.sync(() => controller.enqueue(chunk))).pipe(
              Effect.match({
                onSuccess: () => controller.close(),
                onFailure: () => controller.error(new Error("ACP bridge stdout closed")),
              }),
            ),
          )
        },
      })
      return makeClientConnection(ndJsonStream(output, inputStream), { onUpdate, requestPermission })
    })
}
