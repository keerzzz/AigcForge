export * as PluginAssetHandlers from "./plugin-asset"

import path from "path"
import { Effect, Layer, Option, Schema } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { PluginAssetPath } from "@aigcfroge/core/plugin-asset/path"
import { ProposePluginAssetTool } from "@aigcfroge/core/tool/propose-plugin-asset"
import { PluginBridge } from "@aigcfroge/core/plugin-asset/bridge"
import { PluginAsset as SchemaPluginAsset } from "@aigcfroge/schema/plugin-asset"
import { Location } from "@aigcfroge/core/location"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Hash } from "@aigcfroge/core/util/hash"
import { KeyedMutex } from "@aigcfroge/core/effect/keyed-mutex"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"

function toHandlerError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  if (err instanceof ConflictError || err instanceof InvalidRequestError) {
    return Effect.fail(err)
  }
  return Effect.fail(new InvalidRequestError({ message: err instanceof Error ? err.message : String(err) }))
}

const locks = KeyedMutex.makeUnsafe<string>()

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
      const locationMutation = yield* LocationMutation.Service.pipe(Effect.provide(layer), Effect.orDie)
      const fileMutation = yield* FileMutation.Service.pipe(Effect.provide(layer), Effect.orDie)
      const fs = yield* FSUtil.Service.pipe(Effect.provide(layer), Effect.orDie)

      let relativePath: string
      try { relativePath = PluginAssetPath.nameToRelativePath(ctx.payload.candidate.name) }
      catch (e) { return yield* Effect.fail(new InvalidRequestError({ message: `Invalid plugin name: ${e instanceof Error ? e.message : String(e)}` })) }

      const registryPath = path.basename(relativePath)
      const target = yield* PluginAssetPath.resolveSafeTarget(registryPath, locationMutation).pipe(
        Effect.provide(layer),
        Effect.catch((err) => Effect.fail(new InvalidRequestError({ message: err.message }))),
      )

      return yield* locks.withLock(registryPath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const fileExists = yield* fs.exists(target.canonical).pipe(Effect.provide(layer), Effect.catch(() => Effect.succeed(false)))
            const currentBytes: Uint8Array | null = fileExists
              ? yield* fs.readFile(target.canonical).pipe(
                  Effect.provide(layer),
                  Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
                  Effect.catch(() => Effect.succeed(null)),
                )
              : null
            const currentRevision = currentBytes ? Hash.sha256(Buffer.from(currentBytes)) : null

            const isNew = ctx.payload.baseRevision === undefined || ctx.payload.baseRevision === null
            if (isNew && fileExists && !ctx.payload.overwrite) {
              return yield* Effect.fail(new ConflictError({ message: `Already exists at "${registryPath}". Set overwrite=true.`, resource: registryPath }))
            }
            if (ctx.payload.baseRevision && currentRevision !== ctx.payload.baseRevision) {
              return yield* Effect.fail(new ConflictError({ message: `Stale revision for "${registryPath}". Refresh and retry.`, resource: registryPath }))
            }
            if (fileExists && !ctx.payload.overwrite) {
              return yield* Effect.fail(new ConflictError({ message: `Already exists at "${registryPath}". Set overwrite=true.`, resource: registryPath }))
            }

            yield* fileMutation.writeAtomic({ target, content: ctx.payload.candidate.content }).pipe(
              Effect.provide(layer),
              Effect.catch((err) => Effect.fail(new InvalidRequestError({ message: `Failed to write at "${registryPath}": ${err.message}` }))),
            )

            const writtenBytes = yield* fs.readFile(target.canonical).pipe(
              Effect.provide(layer),
              Effect.catch((err) => Effect.fail(new InvalidRequestError({ message: `Readback failed for "${registryPath}": ${err.message}` }))),
            )
            const writtenRevision = Hash.sha256(Buffer.from(writtenBytes))

            const rollback = Effect.fnUntraced(function* () {
              if (currentBytes !== null) {
                yield* fileMutation.writeAtomic({ target, content: currentBytes }).pipe(
                  Effect.provide(layer),
                  Effect.catch(() => Effect.void),
                )
              } else {
                yield* fs.remove(target.canonical).pipe(
                  Effect.provide(layer),
                  Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
                  Effect.catch(() => Effect.void),
                )
              }
              yield* registry.reload().pipe(Effect.provide(layer), Effect.catch(() => Effect.void))
            })

            yield* registry.reload().pipe(
              Effect.provide(layer),
              Effect.catch((err) =>
                Effect.gen(function* () {
                  yield* rollback()
                  return yield* Effect.fail(new InvalidRequestError({ message: `Registry reload failed: ${err.message}` }))
                }),
              ),
            )

            const readback = yield* registry.getByPath(registryPath).pipe(
              Effect.provide(layer),
              Effect.option,
            )
            if (Option.isNone(readback) || readback.value.revision !== writtenRevision) {
              yield* rollback()
              return yield* Effect.fail(new InvalidRequestError({ message: `Readback mismatch for "${registryPath}"` }))
            }

            const info = readback.value
            return Schema.decodeUnknownSync(SchemaPluginAsset.Info)({
              kind: info.kind, name: info.name, description: info.description,
              relativePath: info.relativePath, revision: info.revision,
              version: info.version, category: info.category,
              author: info.author, source: info.source, hooks: info.hooks,
            })
          }),
        ),
      ).pipe(Effect.catch(toHandlerError))
    })

    const deleteAsset = Effect.fn("PluginAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const ref = Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) })
      const layer = locations.get(ref)
      const registry = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const locationMutation = yield* LocationMutation.Service.pipe(Effect.provide(layer), Effect.orDie)
      const fileMutation = yield* FileMutation.Service.pipe(Effect.provide(layer), Effect.orDie)
      const fs = yield* FSUtil.Service.pipe(Effect.provide(layer), Effect.orDie)

      let relativePath: string
      try { relativePath = PluginAssetPath.validateRelativePath(ctx.payload.relativePath) }
      catch (e) { return yield* Effect.fail(new InvalidRequestError({ message: `Invalid path: ${e instanceof Error ? e.message : String(e)}` })) }

      const target = yield* PluginAssetPath.resolveSafeTarget(relativePath, locationMutation).pipe(
        Effect.provide(layer),
        Effect.catch((err) => Effect.fail(new InvalidRequestError({ message: err.message }))),
      )

      // The registry keys by short relative path; apply bridges via basename, so
      // delete must use the same key or the target lock and the registry readback
      // would operate in two different key spaces.
      const registryPath = path.basename(relativePath)

      return yield* locks.withLock(registryPath)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const fileExists = yield* fs.exists(target.canonical).pipe(Effect.provide(layer), Effect.catch(() => Effect.succeed(false)))
            if (!fileExists) {
              return yield* Effect.fail(new InvalidRequestError({ message: `Not found: ${relativePath}` }))
            }

            const currentBytes = yield* fs.readFile(target.canonical).pipe(
              Effect.provide(layer),
              Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
              Effect.catch((err) => Effect.fail(new InvalidRequestError({ message: `Read before delete failed: ${err.message}` }))),
            )
            if (currentBytes === null) {
              return yield* Effect.fail(new InvalidRequestError({ message: `Not found: ${relativePath}` }))
            }

            const currentRevision = Hash.sha256(Buffer.from(currentBytes))
            if (ctx.payload.baseRevision && currentRevision !== ctx.payload.baseRevision) {
              yield* Effect.fail(new ConflictError({ message: `Stale revision for "${relativePath}". Refresh and retry.`, resource: relativePath }))
            }

            yield* fileMutation.remove({ target }).pipe(
              Effect.provide(layer),
              Effect.catch((err) => Effect.fail(new InvalidRequestError({ message: `Failed to delete at "${relativePath}": ${err.message}` }))),
            )

            const rollbackDelete = () =>
              fileMutation.writeAtomic({ target, content: currentBytes }).pipe(
                Effect.provide(layer),
                Effect.catch(() => Effect.void),
              )

            yield* registry.reload().pipe(
              Effect.provide(layer),
              Effect.catch((err) =>
                Effect.gen(function* () {
                  yield* rollbackDelete()
                  return yield* Effect.fail(new InvalidRequestError({ message: `Registry reload after delete failed: ${err.message}` }))
                }),
              ),
            )

            // PRD §8.3.1: delete confirms absence by readback — a reload that still
            // resolves the entry means the file survived, so restore and report.
            const stillPresent = yield* registry.getByPath(registryPath).pipe(
              Effect.provide(layer),
              Effect.option,
              Effect.catch(() => Effect.succeed(Option.none())),
            )
            if (Option.isSome(stillPresent)) {
              yield* rollbackDelete()
              return yield* Effect.fail(
                new InvalidRequestError({ message: `Readback after delete still resolves "${relativePath}"` }),
              )
            }

            return undefined
          }),
        ),
      ).pipe(Effect.catch(toHandlerError))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))

