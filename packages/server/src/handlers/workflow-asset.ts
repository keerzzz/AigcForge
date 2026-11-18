import { WorkflowAsset } from "@aigcfroge/core/workflow-asset"
import { WorkflowAssetService } from "@aigcfroge/core/workflow-asset-service"
import { Flag } from "@aigcfroge/core/flag/flag"
import { ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Info, InvalidEntry, Summary } from "@aigcfroge/schema/workflow-asset"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { AssetLocation } from "./asset-location"

export const WorkflowAssetHandler = HttpApiBuilder.group(Api, "workflow-asset", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("Workflow")

    return handlers
      .handle("workflow-asset.list", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* WorkflowAsset.Service
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
      .handle("workflow-asset.content", ({ query }) =>
        scope.atLocation(
          WorkflowAsset.Service.use((registry) =>
            registry.getByPath(query.path).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequestError({
                    message: `Workflow asset not found: ${error.relativePath}`,
                    field: "path",
                    kind: "not_found",
                  }),
              ),
              Effect.map(Schema.decodeUnknownSync(Info)),
            ),
          ),
        ),
      )
      .handle("workflow-asset.apply", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          Effect.gen(function* () {
            if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({
                message: "Workflow asset creation is not enabled",
                kind: "disabled",
              })
            const service = yield* WorkflowAssetService.Service
            return yield* service
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
              })
              .pipe(Effect.mapError(workflowAssetWriteError), Effect.map(Schema.decodeUnknownSync(Info)))
          }),
        ),
      )
      .handle("workflow-asset.delete", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          WorkflowAssetService.Service.use((service) =>
            service
              .delete({ relativePath: payload.relativePath, baseRevision: payload.baseRevision ?? null })
              .pipe(Effect.mapError(workflowAssetWriteError)),
          ),
        ),
      )
  }),
)

function workflowAssetWriteError(error: WorkflowAssetService.ApplyError | WorkflowAssetService.DeleteError) {
  if (error instanceof WorkflowAssetService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason, kind: "invalid_candidate" })
  if (
    error instanceof WorkflowAssetService.StaleRevisionError ||
    error instanceof WorkflowAssetService.OverwriteRequiredError ||
    error instanceof WorkflowAssetService.ConcurrentModificationError ||
    error instanceof WorkflowAssetService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    kind: "write_failed",
  })
}
