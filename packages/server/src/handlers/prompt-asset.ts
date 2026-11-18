import { AssetPlacement } from "@aigcfroge/core/asset-placement"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { PromptAssetService } from "@aigcfroge/core/prompt-asset-service"
import { Flag } from "@aigcfroge/core/flag/flag"
import { ApiNotFoundError, ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Info, InvalidEntry, Summary } from "@aigcfroge/schema/prompt-asset"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { AssetLocation } from "./asset-location"

export const PromptAssetHandler = HttpApiBuilder.group(Api, "prompt-asset", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("Prompt")
    const decodeInfo = Schema.decodeUnknownSync(Info)

    return handlers
      .handle("prompt-asset.list", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* PromptAsset.Service
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
          }).pipe(Effect.mapError(promptAssetReadError)),
        ),
      )
      .handle("prompt-asset.content", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* PromptAsset.Service
            const view = query.scope === undefined ? registry : yield* registry.select(query.scope)
            return yield* view.getByPath(query.path)
          }).pipe(Effect.mapError(promptAssetReadError), Effect.map(decodeInfo)),
        ),
      )
      .handle("prompt-asset.inspect", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          PromptAssetService.Service.use((service) =>
            service.inspect(payload).pipe(Effect.mapError(promptAssetWriteError)),
          ),
        ),
      )
      .handle("prompt-asset.apply", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          Effect.gen(function* () {
            if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({
                message: "Prompt asset creation is not enabled",
                kind: "disabled",
              })
            const service = yield* PromptAssetService.Service
            return yield* service
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(promptAssetWriteError), Effect.map(decodeInfo))
          }),
        ),
      )
      .handle("prompt-asset.delete", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          PromptAssetService.Service.use((service) =>
            service
              .delete({
                relativePath: payload.relativePath,
                baseRevision: payload.baseRevision ?? null,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(promptAssetWriteError)),
          ),
        ),
      )
  }),
)

function promptAssetReadError(error: PromptAsset.ReadError) {
  if (error instanceof PromptAsset.NotFoundError)
    return new ApiNotFoundError({
      name: "NotFoundError",
      data: { message: `Prompt asset not found: ${error.relativePath}` },
    })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    field: "scope",
    kind: error instanceof AssetPlacement.PathError ? "invalid_target" : "read_failed",
  })
}

function promptAssetWriteError(
  error: PromptAssetService.InspectError | PromptAssetService.ApplyError | PromptAssetService.DeleteError,
) {
  if (error instanceof AssetPlacement.TargetMismatchError)
    return new InvalidRequestError({ message: error.message, field: "target", kind: "target_mismatch" })
  if (error instanceof AssetPlacement.PathError)
    return new InvalidRequestError({ message: error.message, field: "target", kind: "invalid_target" })
  if (error instanceof PromptAssetService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason, kind: "invalid_candidate" })
  if (
    error instanceof PromptAssetService.StaleRevisionError ||
    error instanceof PromptAssetService.OverwriteRequiredError ||
    error instanceof PromptAssetService.ConcurrentModificationError ||
    error instanceof PromptAssetService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    kind: "write_failed",
  })
}
