import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { CustomProfileService } from "@aigcfroge/core/custom-profile-service"
import { Flag } from "@aigcfroge/core/flag/flag"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { ApiNotFoundError, ConflictError, InvalidRequestError, UnknownError } from "@aigcfroge/protocol/errors"
import { WorkspaceRouteContext } from "@aigcfroge/protocol/middleware/workspace-routing"
import { Info, InvalidEntry, Summary } from "@aigcfroge/schema/custom-profile"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { locationRefForRoute } from "../middleware/workspace-routing"

export const CustomProfileHandler = HttpApiBuilder.group(Api, "custom-profile", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const atLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const route = yield* WorkspaceRouteContext
        const context = yield* locations
          .contextEffect(locationRefForRoute(route))
          .pipe(Effect.mapError((error) => notFound(`Location not found: ${error.directory}`)))
        return yield* effect.pipe(Effect.provideContext(context))
      })

    return handlers
      .handle("custom-profile.list", ({ query }) =>
        atLocation(
          Effect.gen(function* () {
            const profiles = yield* CustomProfile.Service
            const search = query.search?.toLowerCase()
            const assets = (yield* profiles.list()).filter(
              (asset) =>
                !search ||
                asset.name.toLowerCase().includes(search) ||
                asset.description.toLowerCase().includes(search),
            )
            return {
              assets: assets.map(
                (asset) =>
                  new Summary({
                    kind: asset.kind,
                    name: asset.name,
                    description: asset.description,
                    relativePath: asset.relativePath,
                    revision: asset.revision,
                  }),
              ),
              invalid: (yield* profiles.listInvalid()).map((entry) => new InvalidEntry(entry)),
            }
          }),
        ),
      )
      .handle("custom-profile.content", ({ query }) =>
        atLocation(
          Effect.gen(function* () {
            const profiles = yield* CustomProfile.Service
            return yield* profiles.getByPath(query.path).pipe(
              Effect.mapError((error) => notFound(`Profile not found: ${error.relativePath}`)),
              Effect.map((asset) => new Info(asset)),
            )
          }),
        ),
      )
      .handle("custom-profile.apply", ({ payload }) =>
        atLocation(
          Effect.gen(function* () {
            if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({ message: "Custom profile creation is not enabled" })
            const profiles = yield* CustomProfileService.Service
            return yield* profiles
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
              })
              .pipe(
                Effect.mapError(applyError),
                Effect.map((asset) => new Info(asset)),
              )
          }),
        ),
      )
      .handle("custom-profile.delete", ({ payload }) =>
        atLocation(
          Effect.gen(function* () {
            const profiles = yield* CustomProfileService.Service
            return yield* profiles
              .delete({
                relativePath: payload.relativePath,
                baseRevision: payload.baseRevision ?? null,
              })
              .pipe(
                Effect.mapError((error) =>
                  error instanceof CustomProfileService.NotFoundError
                    ? notFound(`Profile not found: ${error.relativePath}`)
                    : applyError(error),
                ),
              )
          }),
        ),
      )
      .handle("custom-profile.remove", ({ payload }) =>
        atLocation(
          Effect.gen(function* () {
            const profiles = yield* CustomProfileService.Service
            return yield* profiles
              .delete({
                relativePath: payload.relativePath,
                baseRevision: payload.baseRevision ?? null,
              })
              .pipe(
                Effect.mapError((error) =>
                  error instanceof CustomProfileService.NotFoundError
                    ? notFound(`Profile not found: ${error.relativePath}`)
                    : applyError(error),
                ),
              )
          }),
        ),
      )
  }),
)

function notFound(message: string) {
  return new ApiNotFoundError({ name: "NotFoundError", data: { message } })
}

function applyError(error: CustomProfileService.ApplyError) {
  if (error instanceof CustomProfileService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason })
  if (
    error instanceof CustomProfileService.StaleRevisionError ||
    error instanceof CustomProfileService.OverwriteRequiredError ||
    error instanceof CustomProfileService.ConcurrentModificationError ||
    error instanceof CustomProfileService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  if (
    error instanceof CustomProfileService.WriteFailedError ||
    error instanceof CustomProfileService.RollbackFailedError
  )
    return new UnknownError({ message: error.message })
  return new UnknownError({ message: "Custom profile storage operation failed" })
}
