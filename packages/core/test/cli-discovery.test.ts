import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { CliDiscovery } from "@aigcfroge/core/tool/cli-discovery"
import { fromConfig } from "@aigcfroge/core/tool/cli-config-adapter"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const withTmp = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.flatMap((tmp) => use(tmp.path)))

async function writeExecutable(file: string, marker: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    process.platform === "win32"
      ? `@echo off\r\necho invoked> "${marker}"\r\n`
      : `#!/bin/sh\nprintf invoked > "${marker}"\n`,
  )
  await fs.chmod(file, 0o755)
}

describe("CliDiscovery", () => {
  it.live("reports a real user-installed CLI without executing it", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const executable = path.join(directory, "local-agent.cmd")
        const marker = path.join(directory, "executed")
        yield* Effect.promise(() => writeExecutable(executable, marker))

        const adapter = fromConfig("local-agent", {
          command: executable,
          description: "Local test agent",
        })
        const [info] = yield* CliDiscovery.list([adapter])

        expect(info).toMatchObject({
          name: "local-agent",
          command: executable,
          description: "Local test agent",
          available: true,
          path: executable,
        })
        expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      }),
    ),
  )

  it.live("does not invoke adapter probes while inspecting local executables", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const executable = path.join(directory, "local-agent.cmd")
        yield* Effect.promise(() => writeExecutable(executable, path.join(directory, "executed")))
        const adapter = {
          ...fromConfig("local-agent", { command: executable }),
          detect: () => Effect.die(new Error("discovery must not execute adapter probes")),
        }
        const [info] = yield* CliDiscovery.list([adapter])
        expect(info?.available).toBe(true)
        expect(info?.path).toBe(executable)
      }),
    ),
  )

  it.live("re-scans file creation and removal on every call", () =>
    withTmp((directory) =>
      Effect.gen(function* () {
        const executable = path.join(directory, "local-agent.cmd")
        const marker = path.join(directory, "executed")
        const adapter = fromConfig("local-agent", { command: executable })

        const missing = yield* CliDiscovery.list([adapter])
        expect(missing[0]?.available).toBe(false)
        expect(missing[0]?.path).toBeUndefined()
        const wire = Schema.encodeSync(Schema.toCodecJson(Schema.Array(CliDiscovery.Info)))(missing)
        if (!Array.isArray(wire)) throw new Error("CLI discovery must encode as a JSON array")
        expect(wire[0]).not.toHaveProperty("path")
        expect(Schema.decodeUnknownSync(Schema.Array(CliDiscovery.Info))(wire)).toEqual(missing)

        yield* Effect.promise(() => writeExecutable(executable, marker))
        const created = yield* CliDiscovery.list([adapter])
        expect(created[0]?.available).toBe(true)
        expect(created[0]?.path).toBe(executable)

        yield* Effect.promise(() => fs.rm(executable))
        const removed = yield* CliDiscovery.list([adapter])
        expect(removed[0]?.available).toBe(false)
        expect(removed[0]?.path).toBeUndefined()

        yield* Effect.promise(() => writeExecutable(executable, marker))
        const recreated = yield* CliDiscovery.list([adapter])
        expect(recreated[0]?.available).toBe(true)
        expect(recreated[0]?.path).toBe(executable)
      }),
    ),
  )
})
