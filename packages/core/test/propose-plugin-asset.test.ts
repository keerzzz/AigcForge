import path from "node:path"
import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Candidate } from "@omnixa/schema/plugin-asset"
import { Environment } from "@omnixa/core/environment/index"
import { FileMutation } from "@omnixa/core/file-mutation"
import { Location } from "@omnixa/core/location"
import { LocationMutation } from "@omnixa/core/location-mutation"
import { PluginAsset } from "@omnixa/core/plugin-asset"
import { PluginAssetService } from "@omnixa/core/plugin-asset-service"
import { ProposePluginAssetTool } from "@omnixa/core/tool/propose-plugin-asset"
import { FSUtil } from "@omnixa/util/fs-util"
import { Effect, Layer, Schema } from "effect"
import { systemError } from "effect/PlatformError"
import { hostEnvironmentLayer } from "./fixture/environment"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const dependencies = Layer.mergeAll(
  FSUtil.layer.pipe(Layer.provide(NodeFileSystem.layer)),
  tempLocationLayer,
  hostEnvironmentLayer,
)
const it = testEffect(
  PluginAssetService.layer.pipe(
    Layer.provideMerge(FileMutation.layer),
    Layer.provideMerge(LocationMutation.locationLayer),
    Layer.provideMerge(PluginAsset.layer),
    Layer.provideMerge(dependencies),
  ),
)
const content =
  '# Preserve this comment\nkind: plugin\nname: review\ndescription: Review changes\nversion: "1.0.0"\nsource:\n  type: mcp\n  mcp:\n    name: review-server\nhooks:\n  - event: PreToolUse\n    command: "node review.cjs"\nextra: preserved\n'
const candidate = (raw = content) =>
  Schema.decodeUnknownSync(Candidate)({ name: "review", description: "Review changes", content: raw })

it.live("uses the real registry short path and round-trips the original plugin declaration", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    const location = yield* Location.Service
    const fs = yield* FSUtil.Service
    const proposed = yield* service.propose(candidate())
    expect(proposed).toEqual({
      relativePath: "review.plugin.yaml",
      exists: false,
      revision: null,
      nameConflict: false,
      pathConflict: false,
    })
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    expect(saved.content).toBe(content)
    expect(saved.source).toEqual({ type: "mcp", mcp: { name: "review-server" } })
    expect(saved.hooks).toEqual([{ event: "PreToolUse", command: "node review.cjs" }])
    expect(yield* fs.readFileString(path.join(location.directory, ".omnixa/plugins/review.plugin.yaml"))).toBe(content)
    expect(yield* registry.getByPath("review.plugin.yaml")).toEqual(saved)
    expect(yield* service.propose(candidate())).toEqual({ ...proposed, exists: true, revision: saved.revision })
    expect(yield* ProposePluginAssetTool.propose(candidate(), service)).toEqual({
      ...proposed,
      exists: true,
      revision: saved.revision,
    })
  }),
)

it.live("rejects YAML identity drift and a different reviewed target before writing", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    for (const value of [
      candidate(content.replace("name: review\n", "name: another\n")),
      candidate(content.replace("description: Review changes", "description: Different")),
      Schema.decodeUnknownSync(Candidate)({ ...candidate(), relativePath: "another.plugin.yaml" }),
    ]) {
      expect(yield* service.propose(value).pipe(Effect.flip)).toBeInstanceOf(PluginAssetService.InvalidCandidateError)
      expect(
        yield* service.apply({ candidate: value, baseRevision: null, overwrite: false }).pipe(Effect.flip),
      ).toBeInstanceOf(PluginAssetService.InvalidCandidateError)
    }
    expect(yield* registry.list()).toEqual([])
  }),
)

it.live("requires the displayed revision for overwrite and rejects stale delete", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const first = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    expect(
      yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: true }).pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.StaleRevisionError)
    expect(
      yield* service
        .apply({ candidate: candidate(), baseRevision: first.revision, overwrite: false })
        .pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.OverwriteRequiredError)
    const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
    const next = yield* service.apply({ candidate: replacement, baseRevision: first.revision, overwrite: true })
    expect(next.content).toBe(replacement.content)
    expect(next.revision).not.toBe(first.revision)
    expect(
      yield* service.delete({ relativePath: next.relativePath, baseRevision: first.revision }).pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.StaleRevisionError)
    yield* service.delete({ relativePath: next.relativePath, baseRevision: next.revision })
    const registry = yield* PluginAsset.Service
    expect(yield* registry.list()).toEqual([])
  }),
)

it.live("rolls back a new file that would duplicate another registry name", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const original = path.join(location.directory, ".omnixa/plugins/original.plugin.yaml")
    yield* fs.writeWithDirs(original, content)
    yield* registry.reload()
    expect((yield* service.propose(candidate())).nameConflict).toBe(true)
    expect(
      yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false }).pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.ReadbackMismatchError)
    expect(yield* fs.exists(path.join(location.directory, ".omnixa/plugins/review.plugin.yaml"))).toBe(false)
    expect(yield* fs.readFileString(original)).toBe(content)
    expect(yield* registry.listInvalid()).toEqual([])
    expect((yield* registry.list()).map((asset) => asset.relativePath)).toEqual(["original.plugin.yaml"])
  }),
)

it.live("propagates a proposal read failure without inventing new-file facts", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".omnixa/plugins/review.plugin.yaml")
    const failure = systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readFile",
      pathOrDescriptor: target,
    })
    const calls = { reads: 0 }
    const injected = yield* faultService({
      readFile: (file) =>
        Effect.gen(function* () {
          if (file !== target) return yield* fs.readFile(file)
          calls.reads++
          return yield* Effect.fail(failure)
        }),
    })

    expect(yield* injected.propose(candidate()).pipe(Effect.flip)).toBe(failure)
    expect(calls.reads).toBe(1)
    expect(yield* fs.readFileString(target)).toBe(content)
    expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
  }),
)

for (const existing of [false, true]) {
  it.live(
    existing
      ? "restores the previous plugin bytes when the first read after overwrite fails"
      : "removes a new plugin file when its first written-content read fails",
    () =>
      Effect.gen(function* () {
        const service = yield* PluginAssetService.Service
        const registry = yield* PluginAsset.Service
        const fs = yield* FSUtil.Service
        const files = yield* FileMutation.Service
        const location = yield* Location.Service
        const target = path.join(location.directory, ".omnixa/plugins/review.plugin.yaml")
        const saved = existing
          ? yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
          : undefined
        const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
        const calls = { writes: 0, failures: 0 }
        const injected = yield* faultService({
          writeAtomic: (input) =>
            files.writeAtomic(input).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  calls.writes++
                }),
              ),
            ),
          readFile: (file) =>
            Effect.gen(function* () {
              if (file === target && calls.writes > 0 && calls.failures === 0) {
                calls.failures++
                return yield* Effect.fail(
                  systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "readFile",
                    pathOrDescriptor: target,
                  }),
                )
              }
              return yield* fs.readFile(file)
            }),
        })

        expect(
          yield* injected
            .apply({ candidate: replacement, baseRevision: saved?.revision ?? null, overwrite: existing })
            .pipe(Effect.flip),
        ).toBeInstanceOf(PluginAssetService.WriteFailedError)
        expect(calls.failures).toBe(1)
        expect(calls.writes).toBe(existing ? 2 : 1)
        expect(yield* registry.listInvalid()).toEqual([])
        if (!saved) {
          expect(yield* fs.exists(target)).toBe(false)
          expect(yield* registry.list()).toEqual([])
          return
        }
        expect(yield* fs.readFile(target)).toEqual(new TextEncoder().encode(content))
        expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
      }),
  )
}

it.live("reports a rollback write failure and leaves the unconfirmed replacement observable", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    const fs = yield* FSUtil.Service
    const files = yield* FileMutation.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".omnixa/plugins/review.plugin.yaml")
    const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
    const calls = { writes: 0, reloads: 0 }
    const injected = yield* faultService({
      writeAtomic: (input) =>
        Effect.gen(function* () {
          calls.writes++
          if (calls.writes === 2)
            return yield* new Environment.Failed({
              path: input.target.absolute,
              cause: new Error("Injected rollback write failure"),
            })
          return yield* files.writeAtomic(input)
        }),
      reload: () =>
        Effect.gen(function* () {
          calls.reloads++
          if (calls.reloads === 1)
            return yield* new FSUtil.FileSystemError({ method: "reload", cause: new Error("Injected reload failure") })
          yield* registry.reload()
        }),
    })

    expect(
      yield* injected
        .apply({ candidate: replacement, baseRevision: saved.revision, overwrite: true })
        .pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.RollbackFailedError)
    expect(calls).toEqual({ writes: 2, reloads: 1 })
    expect(yield* fs.readFileString(target)).toBe(replacement.content)
    yield* registry.reload()
    expect((yield* registry.getByPath(saved.relativePath)).content).toBe(replacement.content)
  }),
)

it.live("preserves an external overwrite that arrives before the first written-content read", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    const fs = yield* FSUtil.Service
    const files = yield* FileMutation.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".omnixa/plugins/review.plugin.yaml")
    const replacement = candidate(content.replace('"1.0.0"', '"2.0.0"'))
    const external = content.replace('"1.0.0"', '"3.0.0"')
    const calls = { writes: 0 }
    const injected = yield* faultService({
      writeAtomic: (input) =>
        Effect.gen(function* () {
          const result = yield* files.writeAtomic(input)
          calls.writes++
          // Bypass the cooperating FileMutation lock to model another process replacing the target.
          if (calls.writes === 1) yield* fs.writeFileString(target, external).pipe(Effect.orDie)
          return result
        }),
    })

    expect(
      yield* injected
        .apply({ candidate: replacement, baseRevision: saved.revision, overwrite: true })
        .pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.ConcurrentModificationError)
    expect(calls.writes).toBe(1)
    expect(yield* fs.readFileString(target)).toBe(external)
    yield* registry.reload()
    expect((yield* registry.getByPath(saved.relativePath)).content).toBe(external)
  }),
)

it.live("restores deleted plugin bytes and reloads the registry after a transient reload failure", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".omnixa/plugins/review.plugin.yaml")
    const calls = { reloads: 0 }
    const injected = yield* faultService({
      reload: () =>
        Effect.gen(function* () {
          calls.reloads++
          if (calls.reloads === 1)
            return yield* new FSUtil.FileSystemError({
              method: "reload",
              cause: new Error("Injected delete reload failure"),
            })
          yield* registry.reload()
        }),
    })

    expect(
      yield* injected.delete({ relativePath: saved.relativePath, baseRevision: saved.revision }).pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.WriteFailedError)
    expect(calls.reloads).toBe(2)
    expect(yield* fs.readFile(target)).toEqual(new TextEncoder().encode(content))
    expect(yield* registry.getByPath(saved.relativePath)).toEqual(saved)
    expect(yield* registry.listInvalid()).toEqual([])
  }),
)

it.live("preserves a file recreated by an external writer before deletion rollback", () =>
  Effect.gen(function* () {
    const service = yield* PluginAssetService.Service
    const registry = yield* PluginAsset.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const saved = yield* service.apply({ candidate: candidate(), baseRevision: null, overwrite: false })
    const target = path.join(location.directory, ".omnixa/plugins/review.plugin.yaml")
    const external = content.replace('"1.0.0"', '"3.0.0"')
    const calls = { reloads: 0 }
    const injected = yield* faultService({
      reload: () =>
        Effect.gen(function* () {
          calls.reloads++
          expect(yield* fs.exists(target)).toBe(false)
          yield* fs.writeFileString(target, external)
          return yield* new FSUtil.FileSystemError({
            method: "reload",
            cause: new Error("Injected external recreation"),
          })
        }),
    })

    expect(
      yield* injected.delete({ relativePath: saved.relativePath, baseRevision: saved.revision }).pipe(Effect.flip),
    ).toBeInstanceOf(PluginAssetService.ConcurrentModificationError)
    expect(calls.reloads).toBe(1)
    expect(yield* fs.readFileString(target)).toBe(external)
    yield* registry.reload()
    expect((yield* registry.getByPath(saved.relativePath)).content).toBe(external)
  }),
)

const faultService = Effect.fnUntraced(function* (input: {
  readonly readFile?: FSUtil.Interface["readFile"]
  readonly writeAtomic?: FileMutation.Interface["writeAtomic"]
  readonly reload?: PluginAsset.Interface["reload"]
}) {
  const fs = yield* FSUtil.Service
  const files = yield* FileMutation.Service
  const registry = yield* PluginAsset.Service
  // A fresh service captures these wrappers instead of reusing the test's memoized normal instance.
  // All other operations, registry state and transaction locks remain real.
  return yield* PluginAssetService.Service.pipe(
    Effect.provide(Layer.fresh(PluginAssetService.layer)),
    Effect.provideService(FSUtil.Service, FSUtil.Service.of({ ...fs, readFile: input.readFile ?? fs.readFile })),
    Effect.provideService(
      FileMutation.Service,
      FileMutation.Service.of({ ...files, writeAtomic: input.writeAtomic ?? files.writeAtomic }),
    ),
    Effect.provideService(
      PluginAsset.Service,
      PluginAsset.Service.of({ ...registry, reload: input.reload ?? registry.reload }),
    ),
  )
})

for (const scenario of [
  { name: "leading UTF-8 BOM", raw: "\uFEFF" + content },
  {
    name: "existing non-finite timeout schema",
    raw: content.replace('    command: "node review.cjs"', '    command: "node review.cjs"\n    timeout: .nan'),
  },
]) {
  it.live("round-trips " + scenario.name + " without changing the accepted YAML", () =>
    Effect.gen(function* () {
      const service = yield* PluginAssetService.Service
      const registry = yield* PluginAsset.Service
      const location = yield* Location.Service
      const fs = yield* FSUtil.Service
      const value = candidate(scenario.raw)
      const saved = yield* service.apply({ candidate: value, baseRevision: null, overwrite: false })
      expect(saved.content).toBe(scenario.raw)
      expect(yield* fs.readFile(path.join(location.directory, ".omnixa/plugins", saved.relativePath))).toEqual(
        new TextEncoder().encode(scenario.raw),
      )
      expect((yield* registry.getByPath(saved.relativePath)).content).toBe(scenario.raw)
    }),
  )
}
