import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { which } from "../src/util/which"
import { testEffect } from "./lib/effect"

const it = testEffect(NodeServices.layer)

describe("packaged CLI SDK startup", () => {
  it.live("imports both production adapters without CLI binaries or installed npm packages", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "aigcfroge-cli-startup-" })
      const entry = path.join(directory, "entry.ts")
      yield* fs.writeFileString(
        entry,
        [
          `import { CodexSdkAdapter } from ${JSON.stringify(fileURLToPath(new URL("../src/tool/codex-sdk.ts", import.meta.url)))}`,
          `import { ClaudeCodeSdkAdapter } from ${JSON.stringify(fileURLToPath(new URL("../src/tool/claude-code-sdk.ts", import.meta.url)))}`,
          `console.log(JSON.stringify([CodexSdkAdapter.adapter.name, ClaudeCodeSdkAdapter.adapter.name]))`,
        ].join("\n"),
      )
      const build = yield* Effect.tryPromise(() =>
        Bun.build({ entrypoints: [entry], target: "node", format: "esm", outdir: directory, naming: "probe.mjs" }),
      )
      expect(build.logs.filter((log) => log.level === "error")).toEqual([])
      expect(build.success).toBe(true)

      const node = which("node")
      if (!node) throw new Error("Node.js is required to verify the packaged SDK startup")
      const child = yield* spawner.spawn(
        ChildProcess.make(node, [path.join(directory, "probe.mjs")], {
          cwd: directory,
          extendEnv: false,
          env: {
            PATH: "",
            HOME: directory,
            USERPROFILE: directory,
            SystemRoot: process.env.SystemRoot,
            XDG_DATA_HOME: directory,
            XDG_CACHE_HOME: directory,
            XDG_CONFIG_HOME: directory,
            XDG_STATE_HOME: directory,
          },
        }),
      )
      const result = yield* Effect.all(
        {
          exitCode: child.exitCode,
          stdout: Stream.mkString(Stream.decodeText(child.stdout)),
          stderr: Stream.mkString(Stream.decodeText(child.stderr)),
        },
        { concurrency: "unbounded" },
      ).pipe(Effect.timeout("10 seconds"))
      expect(result.stderr).toBe("")
      expect(result.exitCode).toBe(ChildProcessSpawner.ExitCode(0))
      expect(result.stdout.trim()).toBe('["codex","claude-code"]')
    }),
  )
})
