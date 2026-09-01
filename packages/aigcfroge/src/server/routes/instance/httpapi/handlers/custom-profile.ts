export * as CustomProfileHandlers from "./custom-profile"

import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { CustomProfileService } from "@aigcfroge/core/custom-profile-service"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { CustomProfile as SchemaCustomProfile } from "@aigcfroge/schema/custom-profile"
import { Effect, Layer, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { ApiNotFoundError, ConflictError, InvalidRequestError, UnknownError, notFound } from "../errors"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { locationRefForRoute, WorkspaceRouteContext } from "../middleware/workspace-routing"

// S7: unknown defects must not be disguised as 4xx. Only the documented
// CustomProfileService failures are mapped below; anything else (including
// FSUtil.Error I/O failures) is re-raised as a defect and becomes a typed 500
// at the error boundary. Status codes follow the plan's custom-profile
// contract: invalid candidate 400, CAS/conflict 409, missing 404,
// I/O/rollback typed 500.
function toApplyError(err: unknown): Effect.Effect<never, ConflictError | InvalidRequestError | UnknownError> {
  if (err instanceof CustomProfileService.InvalidCandidateError) {
    return Effect.fail(new InvalidRequestError({ message: err.reason }))
  }
  if (err instanceof CustomProfileService.StaleRevisionError) {
    return Effect.fail(
      new ConflictError({ message: `Stale revision: ${err.relativePath}`, resource: err.relativePath }),
    )
  }
  if (err instanceof CustomProfileService.OverwriteRequiredError) {
    return Effect.fail(
      new ConflictError({ message: `Overwrite required: ${err.relativePath}`, resource: err.relativePath }),
    )
  }
  if (err instanceof CustomProfileService.WriteFailedError) {
    return Effect.fail(new UnknownError({ message: `Profile write failed for ${err.relativePath}: ${err.reason}` }))
  }
  if (err instanceof CustomProfileService.ConcurrentModificationError) {
    return Effect.fail(
      new ConflictError({ message: `Concurrent modification: ${err.relativePath}`, resource: err.relativePath }),
    )
  }
  if (err instanceof CustomProfileService.ReadbackMismatchError) {
    return Effect.fail(
      new ConflictError({
        message: `Readback mismatch at ${err.relativePath} — possible name conflict with another profile`,
        resource: err.relativePath,
      }),
    )
  }
  if (err instanceof CustomProfileService.RollbackFailedError) {
    return Effect.fail(new UnknownError({ message: `Profile rollback failed for ${err.relativePath}: ${err.reason}` }))
  }
  return Effect.die(err instanceof Error ? err : new Error(String(err)))
}

function toDeleteError(
  err: unknown,
): Effect.Effect<never, ConflictError | InvalidRequestError | ApiNotFoundError | UnknownError> {
  if (err instanceof CustomProfileService.NotFoundError) {
    return Effect.fail(notFound(`Profile not found: ${err.relativePath}`))
  }
  return toApplyError(err)
}

export const customProfileHandlers = HttpApiBuilder.group(InstanceHttpApi, "custom-profile", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    const flags = yield* RuntimeFlags.Service

    const list = Effect.fn("CustomProfileHttpApi.list")(function* (ctx: { query: { search?: string } }) {
      const route = yield* WorkspaceRouteContext
      const layer = locations.get(locationRefForRoute(route))
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
      const route = yield* WorkspaceRouteContext
      const layer = locations.get(locationRefForRoute(route))
      const registry = yield* CustomProfile.Service.pipe(Effect.provide(layer), Effect.orDie)
      // S7: only the documented not-found failure is mapped; any other failure
      // escapes as a defect and becomes a typed 500, never a disguised 4xx.
      const info = yield* registry
        .getByPath(ctx.query.path)
        .pipe(
          Effect.catchTag("CustomProfile.NotFound", () =>
            Effect.fail(notFound(`Profile not found: ${ctx.query.path}`)),
          ),
        )
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
      const route = yield* WorkspaceRouteContext
      const layer = locations.get(locationRefForRoute(route))
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
      const route = yield* WorkspaceRouteContext
      const layer = locations.get(locationRefForRoute(route))
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
