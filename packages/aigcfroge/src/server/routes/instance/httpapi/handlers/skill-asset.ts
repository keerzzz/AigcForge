export * as SkillAssetHandlers from "./skill-asset"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { SkillAssetService } from "@aigcfroge/core/skill-asset-service"
import { SkillAsset } from "@aigcfroge/core/skill-asset"
import { SkillAsset as SchemaSkillAsset } from "@aigcfroge/schema/skill-asset"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"

function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError, never> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof SkillAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof SkillAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof SkillAssetService.OverwriteRequiredError) {
    error = new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof SkillAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof SkillAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof SkillAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof SkillAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

function toDeleteError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError, never> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof SkillAssetService.NotFoundError) {
    error = new InvalidRequestError({ message: `Not found: ${err.relativePath}` })
  } else if (err instanceof SkillAssetService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof SkillAssetService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof SkillAssetService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof SkillAssetService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof SkillAssetService.ReadbackMismatchError) {
    error = new ConflictError({ message: `Readback mismatch at ${err.relativePath} — possible name conflict with another asset`, resource: err.relativePath })
  } else if (err instanceof SkillAssetService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

export const skillAssetHandlers = HttpApiBuilder.group(InstanceHttpApi, "skill-asset", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const list = Effect.fn("SkillAssetHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* SkillAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter((a) => a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) || a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()))
        : all
      const invalid = yield* registry.listInvalid()
      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaSkillAsset.Summary)({
            kind: "skill",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaSkillAsset.InvalidEntry)({
            relativePath: e.relativePath,
            errorTag: e.errorTag,
          }),
        ),
      }
    })

    const content = Effect.fn("SkillAssetHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* SkillAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))),
      )
      return Schema.decodeUnknownSync(SchemaSkillAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        trigger: info.trigger,
        source: info.source,
      })
    })

    const apply = Effect.fn("SkillAssetHttpApi.apply")(function* (ctx: {
      payload: { candidate: SchemaSkillAsset.Candidate; baseRevision?: string; overwrite: boolean }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* SkillAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* service.apply({
        candidate: ctx.payload.candidate,
        baseRevision: ctx.payload.baseRevision ?? null,
        overwrite: ctx.payload.overwrite,
      }).pipe(Effect.catch(toApplyError))
      return Schema.decodeUnknownSync(SchemaSkillAsset.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        trigger: info.trigger,
        source: info.source,
      })
    })

    const deleteAsset = Effect.fn("SkillAssetHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* SkillAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
      yield* service.delete({
        relativePath: ctx.payload.relativePath,
        baseRevision: ctx.payload.baseRevision ?? null,
      }).pipe(Effect.catch(toDeleteError))
    })

    return handlers.handle("list", list).handle("content", content).handle("apply", apply).handle("delete", deleteAsset)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
