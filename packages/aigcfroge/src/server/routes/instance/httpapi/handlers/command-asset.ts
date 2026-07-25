export * as CommandAssetHandlers from "./command-asset"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { CommandAssetService } from "@aigcfroge/core/command-asset-service"
import { CommandAsset } from "@aigcfroge/core/command-asset"
import { CommandAsset as SchemaCommandAsset } from "@aigcfroge/schema/command-asset"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"
import { RuntimeFlags } from "@/effect/runtime-flags"

function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError, never> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof CommandAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CommandAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CommandAssetService.OverwriteRequiredError) {
    error = new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CommandAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CommandAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CommandAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof CommandAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

function toDeleteError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError, never> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof CommandAssetService.NotFoundError) {
    error = new InvalidRequestError({ message: `Not found: ${err.relativePath}` })
  } else if (err instanceof CommandAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CommandAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CommandAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CommandAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CommandAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof CommandAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

export const commandAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "command-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const list = Effect.fn("CommandAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* CommandAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()
      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaCommandAsset.Summary)({
            kind: "command",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaCommandAsset.InvalidEntry)({
            relativePath: e.relativePath,
            errorTag: e.errorTag,
          }),
        ),
      }
    })

    const content = Effect.fn("CommandAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* CommandAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaCommandAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        invocation: info.invocation,
        args: info.args,
        source: info.source,
      })
    })

    const apply = Effect.fn("CommandAssetHttpApi.apply")(function* (ctx: {
      payload: { candidate: SchemaCommandAsset.Candidate; baseRevision?: string; overwrite: boolean }
    }) {
      const flags = yield* RuntimeFlags.Service
      if (!flags.experimentalChatAsset) return yield* Effect.fail(new InvalidRequestError({ message: "Command asset creation is not enabled. Set AIGCFROGE_EXPERIMENTAL_CHAT_ASSET=true to enable." }))
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* CommandAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* service.apply({
        candidate: ctx.payload.candidate,
        baseRevision: ctx.payload.baseRevision ?? null,
        overwrite: ctx.payload.overwrite,
      }).pipe(Effect.catch(toApplyError))
      return Schema.decodeUnknownSync(SchemaCommandAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        invocation: info.invocation,
        args: info.args,
        source: info.source,
      })
    })

    const deleteAsset = Effect.fn("CommandAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const flags = yield* RuntimeFlags.Service
      if (!flags.experimentalChatAsset) return yield* Effect.fail(new InvalidRequestError({ message: "Command asset deletion is not enabled." }))
      const service = yield* CommandAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      yield* service.delete({
        relativePath: ctx.payload.relativePath,
        baseRevision: ctx.payload.baseRevision ?? null,
      }).pipe(Effect.catch(toDeleteError))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
