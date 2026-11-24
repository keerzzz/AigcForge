import { PluginAsset } from "@omnixa/core/plugin-asset"
import { PluginAssetService } from "@omnixa/core/plugin-asset-service"
import { Flag } from "@omnixa/core/flag/flag"
import { ConflictError, InvalidRequestError } from "@omnixa/protocol/errors"
import { Info, InvalidEntry, Summary } from "@omnixa/schema/plugin-asset"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { AssetLocation } from "./asset-location"

export const PluginAssetHandler = HttpApiBuilder.group(Api, "plugin-asset", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("Plugin")

    return handlers
      .handle("plugin-asset.list", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* PluginAsset.Service
            const search = query.search?.toLowerCase()
            return {
              assets: (yield* registry.list())
                .filter(
                  (asset) =>
                    !search ||
                    asset.name.toLowerCase().includes(search) ||
                    asset.description.toLowerCase().includes(search),
                )
                .map((asset) =>
                  Schema.decodeUnknownSync(Summary)({
                    kind: asset.kind,
                    name: asset.name,
                    description: asset.description,
                    relativePath: asset.relativePath,
                    revision: asset.revision,
                    ...(asset.source ? { source: asset.source.type } : {}),
                    toolCount: 0,
                  }),
                ),
              invalid: (yield* registry.listInvalid()).map((entry) => Schema.decodeUnknownSync(InvalidEntry)(entry)),
              bridged: [],
            }
          }),
        ),
      )
      .handle("plugin-asset.content", ({ query }) =>
        scope.atLocation(
          PluginAsset.Service.use((registry) =>
            registry.getByPath(query.path).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequestError({
                    message: `Plugin asset not found: ${error.relativePath}`,
                    field: "path",
                    kind: "not_found",
                  }),
              ),
              Effect.map(Schema.decodeUnknownSync(Info)),
            ),
          ),
        ),
      )
      .handle("plugin-asset.apply", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          Effect.gen(function* () {
            if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({
                message: "Plugin asset creation is not enabled",
                kind: "disabled",
              })
            const service = yield* PluginAssetService.Service
            return yield* service
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
              })
              .pipe(Effect.mapError(pluginAssetWriteError), Effect.map(Schema.decodeUnknownSync(Info)))
          }),
        ),
      )
      .handle("plugin-asset.delete", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          PluginAssetService.Service.use((service) =>
            service
              .delete({ relativePath: payload.relativePath, baseRevision: payload.baseRevision ?? null })
              .pipe(Effect.mapError(pluginAssetWriteError)),
          ),
        ),
      )
      .handle("plugin-asset.remove", ({ payload }) =>
        scope.atLocation(
          PluginAssetService.Service.use((service) =>
            service
              .delete({ relativePath: payload.relativePath, baseRevision: payload.baseRevision ?? null })
              .pipe(Effect.mapError(pluginAssetWriteError)),
          ),
        ),
      )
  }),
)

function pluginAssetWriteError(error: PluginAssetService.ApplyError | PluginAssetService.DeleteError) {
  if (error instanceof PluginAssetService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason, kind: "invalid_candidate" })
  if (
    error instanceof PluginAssetService.StaleRevisionError ||
    error instanceof PluginAssetService.OverwriteRequiredError ||
    error instanceof PluginAssetService.ConcurrentModificationError ||
    error instanceof PluginAssetService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    kind: "write_failed",
  })
}
