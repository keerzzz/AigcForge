import { AgentAsset } from "@aigcfroge/core/agent-asset"
import { AgentAssetService } from "@aigcfroge/core/agent-asset-service"
import { AgentAssetBridge } from "@aigcfroge/core/agent/asset-bridge"
import { Flag } from "@aigcfroge/core/flag/flag"
import { ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { ApplyResult, Info, InvalidEntry, Summary } from "@aigcfroge/schema/agent-asset"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { AssetLocation } from "./asset-location"

export const AgentAssetHandler = HttpApiBuilder.group(Api, "agent-asset", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("Agent")

    return handlers
      .handle("agent-asset.list", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* AgentAsset.Service
            const search = query.search?.toLowerCase()
            return {
              assets: (yield* registry.list())
                .filter(
                  (asset) =>
                    !search ||
                    asset.name.toLowerCase().includes(search) ||
                    asset.description.toLowerCase().includes(search),
                )
                .map((asset) => {
                  const agent = AgentAssetBridge.agentAssetToAgentInfo(asset)
                  return Schema.decodeUnknownSync(Summary)({
                    ...asset,
                    mode: agent?.mode,
                    hidden: agent?.hidden,
                    disabled:
                      agent === undefined || AgentAssetBridge.parseAgentAssetConfig(asset.config)?.disabled === true,
                  })
                }),
              invalid: (yield* registry.listInvalid()).map((entry) => Schema.decodeUnknownSync(InvalidEntry)(entry)),
            }
          }),
        ),
      )
      .handle("agent-asset.content", ({ query }) =>
        scope.atLocation(
          AgentAsset.Service.use((registry) =>
            registry.getByPath(query.path).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequestError({
                    message: `Agent asset not found: ${error.relativePath}`,
                    field: "path",
                    kind: "not_found",
                  }),
              ),
              Effect.map(Schema.decodeUnknownSync(Info)),
            ),
          ),
        ),
      )
      .handle("agent-asset.apply", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          Effect.gen(function* () {
            if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({
                message: "Agent asset creation is not enabled",
                kind: "disabled",
              })
            const service = yield* AgentAssetService.Service
            return yield* service
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
              })
              .pipe(Effect.mapError(agentAssetWriteError), Effect.map(Schema.decodeUnknownSync(ApplyResult)))
          }),
        ),
      )
      .handle("agent-asset.delete", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          AgentAssetService.Service.use((service) =>
            service
              .delete({ relativePath: payload.relativePath, baseRevision: payload.baseRevision ?? null })
              .pipe(Effect.mapError(agentAssetWriteError)),
          ),
        ),
      )
  }),
)

function agentAssetWriteError(error: AgentAssetService.ApplyError | AgentAssetService.DeleteError) {
  if (error instanceof AgentAssetService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason, kind: "invalid_candidate" })
  if (
    error instanceof AgentAssetService.StaleRevisionError ||
    error instanceof AgentAssetService.OverwriteRequiredError ||
    error instanceof AgentAssetService.ConcurrentModificationError ||
    error instanceof AgentAssetService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    kind: "write_failed",
  })
}
