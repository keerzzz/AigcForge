export * as PromptAssetHandlers from "./prompt-asset"

import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { PromptAssetService } from "@aigcfroge/core/prompt-asset-service"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { PromptAsset as SchemaPromptAsset } from "@aigcfroge/schema/prompt-asset" // Schema namespace; local/core PromptAsset uses the unaliased name.
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"

function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof PromptAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof PromptAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof PromptAssetService.OverwriteRequiredError) {
    error = new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof PromptAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof PromptAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof PromptAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof PromptAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

function toDeleteError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof PromptAssetService.NotFoundError) {
    error = new InvalidRequestError({ message: `Not found: ${err.relativePath}` })
  } else if (err instanceof PromptAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof PromptAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof PromptAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof PromptAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof PromptAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof PromptAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

export const promptAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "prompt-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    const flags = yield* RuntimeFlags.Service

    const list = Effect.fn("PromptAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* PromptAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()
      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaPromptAsset.Summary)({
            kind: "prompt",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaPromptAsset.InvalidEntry)({
            relativePath: e.relativePath,
            errorTag: e.errorTag,
          }),
        ),
      }
    })

    const content = Effect.fn("PromptAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* PromptAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaPromptAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        template: info.template,
      })
    })

    const apply = Effect.fn("PromptAssetHttpApi.apply")(function* (ctx: {
      payload: { candidate: SchemaPromptAsset.Candidate; baseRevision?: string; overwrite: boolean }
    }) {
      if (!flags.experimentalChatAsset) {
        return yield* Effect.fail(new InvalidRequestError({ message: "Chat prompt asset creation is not enabled" }))
      }
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* PromptAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* service.apply({
        candidate: ctx.payload.candidate,
        baseRevision: ctx.payload.baseRevision ?? null,
        overwrite: ctx.payload.overwrite,
      }).pipe(Effect.catch(toApplyError))
      return Schema.decodeUnknownSync(SchemaPromptAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        template: info.template,
      })
    })

    const deleteAsset = Effect.fn("PromptAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* PromptAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      yield* service.delete({
        relativePath: ctx.payload.relativePath,
        baseRevision: ctx.payload.baseRevision ?? null,
      }).pipe(Effect.catch(toDeleteError))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
