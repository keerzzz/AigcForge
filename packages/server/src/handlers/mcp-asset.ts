import { MCPAsset } from "@omnixa/core/mcp-asset"
import { MCPAssetService } from "@omnixa/core/mcp-asset-service"
import { Flag } from "@omnixa/core/flag/flag"
import { ConflictError, InvalidRequestError } from "@omnixa/protocol/errors"
import { Info, InvalidEntry, Summary } from "@omnixa/schema/mcp-asset"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { AssetLocation } from "./asset-location"

export const McpAssetHandler = HttpApiBuilder.group(Api, "mcp-asset", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("MCP")

    return handlers
      .handle("mcp-asset.list", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* MCPAsset.Service
            const search = query.search?.toLowerCase()
            return {
              assets: (yield* registry.list())
                .filter(
                  (asset) =>
                    !search ||
                    asset.name.toLowerCase().includes(search) ||
                    asset.description.toLowerCase().includes(search),
                )
                .map((asset) => Schema.decodeUnknownSync(Summary)(asset)),
              invalid: (yield* registry.listInvalid()).map((entry) => Schema.decodeUnknownSync(InvalidEntry)(entry)),
            }
          }),
        ),
      )
      .handle("mcp-asset.content", ({ query }) =>
        scope.atLocation(
          MCPAsset.Service.use((registry) =>
            registry.getByPath(query.path).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequestError({
                    message: `MCP asset not found: ${error.relativePath}`,
                    field: "path",
                    kind: "not_found",
                  }),
              ),
              Effect.map(Schema.decodeUnknownSync(Info)),
            ),
          ),
        ),
      )
      .handle("mcp-asset.apply", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          Effect.gen(function* () {
            if (!Flag.OMNIXA_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({
                message: "MCP asset creation is not enabled",
                kind: "disabled",
              })
            const service = yield* MCPAssetService.Service
            return yield* service
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
              })
              .pipe(Effect.mapError(mcpAssetWriteError), Effect.map(Schema.decodeUnknownSync(Info)))
          }),
        ),
      )
      .handle("mcp-asset.delete", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          MCPAssetService.Service.use((service) =>
            service
              .delete({ relativePath: payload.relativePath, baseRevision: payload.baseRevision ?? null })
              .pipe(Effect.mapError(mcpAssetWriteError)),
          ),
        ),
      )
      .handle("mcp-asset.remove", ({ payload }) =>
        scope.atLocation(
          MCPAssetService.Service.use((service) =>
            service
              .delete({ relativePath: payload.relativePath, baseRevision: payload.baseRevision ?? null })
              .pipe(Effect.mapError(mcpAssetWriteError)),
          ),
        ),
      )
  }),
)

function mcpAssetWriteError(error: MCPAssetService.ApplyError | MCPAssetService.DeleteError) {
  if (error instanceof MCPAssetService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason, kind: "invalid_candidate" })
  if (
    error instanceof MCPAssetService.StaleRevisionError ||
    error instanceof MCPAssetService.OverwriteRequiredError ||
    error instanceof MCPAssetService.ConcurrentModificationError ||
    error instanceof MCPAssetService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    kind: "write_failed",
  })
}
