import { expect } from "bun:test"
import { Effect, FileSystem, Layer, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { NodeFileSystem } from "@effect/platform-node"
import path from "node:path"
import { CrossSpawnSpawner } from "@omnixa/util/cross-spawn-spawner"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { testEffect } from "./lib/effect"

class ProbeResult extends Schema.Class<ProbeResult>("AssetYaml.ProbeResult")({
  runtime: Schema.Literals(["bun", "node"]),
  node: Schema.String,
  bun: Schema.NullOr(Schema.String),
  owners: Schema.Number,
}) {}
const it = testEffect(Layer.merge(NodeFileSystem.layer, LayerNode.compile(CrossSpawnSpawner.node)))

it.live(
  "runs real asset YAML owners with identical semantics in Bun and Node",
  () =>
    Effect.gen(function* () {
      const filesystem = yield* FileSystem.FileSystem
      // Keep external Effect packages resolvable from the bundle without
      // bundling a second Effect runtime alongside NodeFileSystem.
      const directory = yield* filesystem.makeTempDirectoryScoped({
        directory: path.join(import.meta.dir, "../node_modules"),
        prefix: ".asset-yaml-",
      })
      yield* Effect.forEach(["bun", "node"] as const, (runtime) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise(() =>
            Bun.build({
              entrypoints: [path.join(import.meta.dir, "fixture/asset-yaml-probe.ts")],
              target: runtime,
              conditions: [runtime],
              external: ["effect", "effect/*", "@effect/platform-node", "@effect/platform-node/*", "jsonc-parser"],
              throw: false,
            }),
          )
          expect(result.success).toBe(true)
          if (!result.success)
            return yield* Effect.fail(new AggregateError(result.logs, "Cannot bundle real asset owners"))
          const output = result.outputs[0]
          if (!output) return yield* Effect.fail(new Error("Asset YAML probe bundle is missing"))
          const bundle = path.join(directory, `${runtime}.mjs`)
          yield* filesystem.writeFileString(bundle, yield* Effect.tryPromise(() => output.text()))
          const handle = yield* ChildProcess.make(runtime === "bun" ? process.execPath : "node", [bundle])
          const [stdout, stderr, exit] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
              handle.exitCode,
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.timeout("20 seconds"))
          if (exit !== 0) return yield* Effect.fail(new Error(`${runtime} probe exited ${exit}: ${stderr}\n${stdout}`))
          const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProbeResult))(
            stdout.trim().split("\n").at(-1) ?? "",
          )
          expect(decoded.runtime).toBe(runtime)
          expect(decoded.bun !== null).toBe(runtime === "bun")
          expect(decoded.owners).toBe(7)
        }),
      )
    }),
  { timeout: 60_000 },
)
