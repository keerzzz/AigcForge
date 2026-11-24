import { AssetPlacement } from "@omnixa/core/asset-placement"
import { CommandAsset } from "@omnixa/core/command-asset"
import { CommandAssetService } from "@omnixa/core/command-asset-service"
import { Flag } from "@omnixa/core/flag/flag"
import { ConflictError, InvalidRequestError } from "@omnixa/protocol/errors"
import { Info, InvalidEntry, Summary } from "@omnixa/schema/command-asset"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { AssetLocation } from "./asset-location"

export const CommandAssetHandler = HttpApiBuilder.group(Api, "command-asset", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("Command")
    const decodeInfo = Schema.decodeUnknownSync(Info)

    return handlers
      .handle("command-asset.list", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* CommandAsset.Service
            const selected = query.scope === undefined ? undefined : yield* registry.select(query.scope)
            const view = selected ?? registry
            const search = query.search?.toLowerCase()
            return {
              assets: (yield* view.list())
                .filter(
                  (asset) =>
                    !search ||
                    asset.name.toLowerCase().includes(search) ||
                    asset.description.toLowerCase().includes(search),
                )
                .map((asset) => Schema.decodeUnknownSync(Summary)(asset)),
              invalid: (yield* view.listInvalid()).map((entry) => Schema.decodeUnknownSync(InvalidEntry)(entry)),
              ...(selected === undefined ? {} : { target: selected.target }),
            }
          }).pipe(Effect.mapError(commandAssetReadError)),
        ),
      )
      .handle("command-asset.content", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* CommandAsset.Service
            const view = query.scope === undefined ? registry : yield* registry.select(query.scope)
            return yield* view.getByPath(query.path)
          }).pipe(Effect.mapError(commandAssetReadError), Effect.map(decodeInfo)),
        ),
      )
      .handle("command-asset.inspect", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          CommandAssetService.Service.use((service) =>
            service.inspect(payload).pipe(Effect.mapError(commandAssetWriteError)),
          ),
        ),
      )
      .handle("command-asset.apply", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          Effect.gen(function* () {
            if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({
                message: "Command asset creation is not enabled",
                kind: "disabled",
              })
            const service = yield* CommandAssetService.Service
            return yield* service
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(commandAssetWriteError), Effect.map(decodeInfo))
          }),
        ),
      )
      .handle("command-asset.delete", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          CommandAssetService.Service.use((service) =>
            service
              .delete({
                relativePath: payload.relativePath,
                baseRevision: payload.baseRevision ?? null,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(commandAssetWriteError)),
          ),
        ),
      )
      .handle("command-asset.remove", ({ payload }) =>
        scope.atLocation(
          CommandAssetService.Service.use((service) =>
            service
              .delete({
                relativePath: payload.relativePath,
                baseRevision: payload.baseRevision ?? null,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(commandAssetWriteError)),
          ),
        ),
      )
  }),
)

function commandAssetReadError(error: CommandAsset.ReadError) {
  if (error instanceof CommandAsset.NotFoundError)
    return new InvalidRequestError({
      message: `Command asset not found: ${error.relativePath}`,
      field: "path",
      kind: "not_found",
    })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    field: "scope",
    kind: error instanceof AssetPlacement.PathError ? "invalid_target" : "read_failed",
  })
}

function commandAssetWriteError(
  error: CommandAssetService.InspectError | CommandAssetService.ApplyError | CommandAssetService.DeleteError,
) {
  if (error instanceof AssetPlacement.TargetMismatchError)
    return new InvalidRequestError({ message: error.message, field: "target", kind: "target_mismatch" })
  if (error instanceof AssetPlacement.PathError)
    return new InvalidRequestError({ message: error.message, field: "target", kind: "invalid_target" })
  if (error instanceof CommandAssetService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason, kind: "invalid_candidate" })
  if (
    error instanceof CommandAssetService.StaleRevisionError ||
    error instanceof CommandAssetService.OverwriteRequiredError ||
    error instanceof CommandAssetService.ConcurrentModificationError ||
    error instanceof CommandAssetService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    kind: "write_failed",
  })
}
