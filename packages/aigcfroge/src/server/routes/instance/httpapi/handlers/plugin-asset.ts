export * as PluginAssetHandlers from "./plugin-asset"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { PluginBridge } from "@aigcfroge/core/plugin-asset/bridge"
import { PluginAsset as SchemaPluginAsset } from "@aigcfroge/schema/plugin-asset"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError } from "../errors"

export const pluginAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "plugin-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const list = Effect.fn("PluginAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()

      // System-level bridge scan
      const bridgeService = yield* PluginBridge.Service.pipe(Effect.provide(layer), Effect.orDie)
      const bridged = yield* bridgeService.scan().pipe(
        Effect.catch(() => Effect.succeed([] as readonly PluginBridge.BridgeEntry[])),
      )

      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.Summary)({
            kind: "plugin",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
            source: a.source?.type,
            toolCount: a.hooks.length,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.InvalidEntry)({
            relativePath: e.relativePath,
            errorTag: e.errorTag,
          }),
        ),
        bridged: bridged.map((b) =>
          Schema.decodeUnknownSync(SchemaPluginAsset.BridgeEntry)({
            name: b.name,
            description: b.description,
            source: b.source,
            category: b.category,
            originPath: b.originPath,
            format: b.format,
            bundled: b.bundled,
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
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        version: info.version,
        category: info.category,
        author: info.author,
        source: info.source,
        hooks: info.hooks,
      })
    })

    return handlers.handle("list", list).handle("content", content)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
