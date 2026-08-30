export * as CustomProfileHandlers from "./custom-profile"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { CustomProfileService } from "@aigcfroge/core/custom-profile-service"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ConflictError, InvalidRequestError } from "../errors"
import { RuntimeFlags } from "@/effect/runtime-flags"

function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof CustomProfileService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CustomProfileService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CustomProfileService.OverwriteRequiredError) {
    error = new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CustomProfileService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CustomProfileService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CustomProfileService.ReadbackMismatchError) {
    error = new ConflictError({
      message: `Readback mismatch at ${err.relativePath} — possible name conflict with another profile`,
      resource: err.relativePath,
    })
  } else if (err instanceof CustomProfileService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

function toDeleteError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError> {
  let error: ConflictError | InvalidRequestError
  if (err instanceof CustomProfileService.NotFoundError) {
    error = new InvalidRequestError({ message: `Not found: ${err.relativePath}` })
  } else if (err instanceof CustomProfileService.InvalidCandidateError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CustomProfileService.StaleRevisionError) {
    error = new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CustomProfileService.WriteFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else if (err instanceof CustomProfileService.ConcurrentModificationError) {
    error = new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath })
  } else if (err instanceof CustomProfileService.ReadbackMismatchError) {
    error = new ConflictError({
      message: `Readback mismatch at ${err.relativePath} — possible name conflict with another profile`,
      resource: err.relativePath,
    })
  } else if (err instanceof CustomProfileService.RollbackFailedError) {
    error = new InvalidRequestError({ message: err.reason })
  } else {
    error = new InvalidRequestError({ message: String(err) })
  }
  return Effect.fail(error)
}

export const customProfileHandlers = HttpApiBuilder.group(InstanceHttpApi, "custom-profile", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    const flags = yield* RuntimeFlags.Service

    const list = Effect.fn("CustomProfileHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* CustomProfile.Service.pipe(Effect.provide(layer), Effect.orDie)
      const all = yield* registry.list()
      const filtered = ctx.query.search
        ? all.filter(
            (a) =>
              a.name.toLowerCase().includes(ctx.query.search!.toLowerCase()) ||
              a.description.toLowerCase().includes(ctx.query.search!.toLowerCase()),
          )
        : all
      const invalid = yield* registry.listInvalid()
      return {
        assets: filtered.map((a) =>
          Schema.decodeUnknownSync(SchemaCustomProfile.Summary)({
            kind: "custom-profile",
            name: a.name,
            description: a.description,
            relativePath: a.relativePath,
            revision: a.revision,
          }),
        ),
        invalid: invalid.map((e) =>
          Schema.decodeUnknownSync(SchemaCustomProfile.InvalidEntry)({
            relativePath: e.relativePath,
            errorTag: e.errorTag,
          }),
        ),
      }
    })

    const content = Effect.fn("CustomProfileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const registry = yield* CustomProfile.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* registry
        .getByPath(ctx.query.path)
        .pipe(Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Not found: ${ctx.query.path}` }))))
      return Schema.decodeUnknownSync(SchemaCustomProfile.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        profile: info.profile,
        rawYaml: info.rawYaml,
      })
    })

    const apply = Effect.fn("CustomProfileHttpApi.apply")(function* (ctx: {
      payload: { candidate: SchemaCustomProfile.Candidate; baseRevision?: string; overwrite: boolean }
    }) {
      if (!flags.experimentalChatAsset) {
        return yield* Effect.fail(
          new InvalidRequestError({
            message: "Custom profile creation is not enabled. Set AIGCFROGE_EXPERIMENTAL_CHAT_ASSET=true to enable.",
          }),
        )
      }
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* CustomProfileService.Service.pipe(Effect.provide(layer), Effect.orDie)
      const info = yield* service
        .apply({
          candidate: ctx.payload.candidate,
          baseRevision: ctx.payload.baseRevision ?? null,
          overwrite: ctx.payload.overwrite,
        })
        .pipe(Effect.catch(toApplyError))
      return Schema.decodeUnknownSync(SchemaCustomProfile.Info)({
        kind: info.kind,
        name: info.name,
        description: info.description,
        relativePath: info.relativePath,
        revision: info.revision,
        profile: info.profile,
        rawYaml: info.rawYaml,
      })
    })

    const deleteProfile = Effect.fn("CustomProfileHttpApi.delete")(function* (ctx: {
      payload: { relativePath: string; baseRevision?: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const service = yield* CustomProfileService.Service.pipe(Effect.provide(layer), Effect.orDie)
      const res = yield* service
        .delete({
          relativePath: ctx.payload.relativePath,
          baseRevision: ctx.payload.baseRevision ?? null,
        })
        .pipe(Effect.catch(toDeleteError))
      return Schema.decodeUnknownSync(SchemaCustomProfile.DeleteResult)(res)
    })

    return handlers
      .handle("list", list)
      .handle("content", content)
      .handle("apply", apply)
      .handle("delete", deleteProfile)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
