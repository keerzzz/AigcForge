export * as PluginAssetHandlers from "./plugin-asset"

import path from "path"
import fs from "fs/promises"
import { Effect, Layer, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { PluginAssetPath } from "@aigcfroge/core/plugin-asset/path"
import { ProposePluginAssetTool } from "@aigcfroge/core/tool/propose-plugin-asset"
import { PluginBridge } from "@aigcfroge/core/plugin-asset/bridge"
import { PluginAsset as SchemaPluginAsset } from "@aigcfroge/schema/plugin-asset"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Hash } from "@aigcfroge/core/util/hash"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"
import { PLUGINS_DIR } from "@aigcfroge/core/constants"

export const pluginAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "plugin-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    const flags = yield* RuntimeFlags.Service

    const list = Effect.fn("PluginAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()

      const bridgeService = yield* PluginBridge.Service.pipe(Effect.provide(layer), Effect.orDie)
      const bridged = yield* bridgeService.scan().pipe(Effect.catch(() => Effect.succeed([] as readonly PluginBridge.BridgeEntry[])))

      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.Summary)({
            kind: "plugin", name: a.name, description: a.description,
            relativePath: a.relativePath, revision: a.revision,
            source: a.source?.type, toolCount: a.hooks.length,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.InvalidEntry)({
            relativePath: e.relativePath, errorTag: e.errorTag,
          }),
        ),
        bridged: bridged.map((b) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.BridgeEntry)({
            name: b.name, description: b.description, source: b.source,
            category: b.category, originPath: b.originPath, format: b.format, bundled: b.bundled,
          }),
        ),
      }
    })

    const content = Effect.fn("PluginAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaPluginAsset.Info)({
        kind: info.kind, name: info.name, description: info.description,
        relativePath: info.relativePath, revision: info.revision,
        version: info.version, category: info.category,
        author: info.author, source: info.source, hooks: info.hooks,
      })
    })

    const apply = Effect.fn("PluginAssetHttpApi.apply")(function* (ctx: {
      payload: { candidate: { name: string; description: string; content: string }; baseRevision?: string; overwrite: boolean }
    }) {
      if (!flags.experimentalChatAsset) {
        return yield* Effect.fail(new InvalidRequestError({ message: "Plugin asset creation is not enabled" }))
      }
      // Validate content against the Frontmatter contract BEFORE writing — a write that
      // the registry would reject on reload must fail here, not after persisting.
      const invalidContent = ProposePluginAssetTool.validateContent(ctx.payload.candidate.content)
      if (invalidContent) {
        return yield* Effect.fail(new InvalidRequestError({ message: invalidContent }))
      }
      const ctx2 = yield* InstanceState.context
      const ref = Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) })
      const layer = locations.get(ref)
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)

      let relativePath: string
      try { relativePath = PluginAssetPath.nameToRelativePath(ctx.payload.candidate.name) }
      catch { return yield* Effect.fail(new InvalidRequestError({ message: `Invalid plugin name: ${ctx.payload.candidate.name}` })) }

      const targetPath = path.resolve(ctx2.directory, relativePath)
      const fileExists = yield* Effect.tryPromise(() => fs.stat(targetPath).then(() => true)).pipe(
        Effect.catch(() => Effect.succeed(false)),
      )
      if (fileExists && !ctx.payload.overwrite) {
        return yield* Effect.fail(new ConflictError({ message: `Already exists at "${relativePath}". Set overwrite=true.`, resource: relativePath }))
      }
      if (fileExists && ctx.payload.baseRevision) {
        const currentBytes = yield* Effect.tryPromise(() => fs.readFile(targetPath)).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        )
        if (currentBytes) {
          const currentRevision = Hash.sha256(Buffer.from(currentBytes))
          if (currentRevision !== ctx.payload.baseRevision) {
            return yield* Effect.fail(new ConflictError({ message: `Stale revision for "${relativePath}". Refresh and retry.`, resource: relativePath }))
          }
        }
      }

      yield* Effect.tryPromise(() => fs.mkdir(path.resolve(ctx2.directory, PLUGINS_DIR), { recursive: true })).pipe(Effect.ignore)
      yield* Effect.tryPromise(() => fs.writeFile(targetPath, ctx.payload.candidate.content)).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Failed to write at "${relativePath}".` }))),
      )

      yield* registry.reload().pipe(Effect.provide(layer), Effect.catch(() => Effect.void))

      const registryPath = path.basename(relativePath)
      const info = yield* registry.getByPath(registryPath).pipe(
        Effect.provide(layer),
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Failed to read back "${relativePath}".` }))),
      )
      return Schema.decodeUnknownSync(SchemaPluginAsset.Info)({
        kind: info.kind, name: info.name, description: info.description,
        relativePath: info.relativePath, revision: info.revision,
        version: info.version, category: info.category,
        author: info.author, source: info.source, hooks: info.hooks,
      })
    })

    const deleteAsset = Effect.fn("PluginAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const ref = Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) })
      const layer = locations.get(ref)
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)

      // Payload path is the registry key (relative to the plugins root); validate
      // segments before resolving so nested keys work and traversal is rejected.
      let relativePath: string
      try { relativePath = PluginAssetPath.validateRelativePath(ctx.payload.relativePath) }
      catch { return yield* Effect.fail(new InvalidRequestError({ message: `Invalid path: ${ctx.payload.relativePath}` })) }

      const info = yield* registry.getByPath(relativePath).pipe(
        Effect.provide(layer),
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${relativePath}` }))),
      )

      if (ctx.payload.baseRevision && info.revision !== ctx.payload.baseRevision) {
        return yield* Effect.fail(new ConflictError({ message: `Stale revision for "${relativePath}". Refresh and retry.`, resource: relativePath }))
      }

      yield* Effect.tryPromise(() => fs.rm(path.resolve(ctx2.directory, PLUGINS_DIR, relativePath))).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Failed to delete at "${relativePath}".` }))),
      )
      return yield* registry.reload().pipe(Effect.provide(layer), Effect.catch(() => Effect.void))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
