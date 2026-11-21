import { Flag } from "@aigcfroge/core/flag/flag"
import { AssetPlacement } from "@aigcfroge/core/asset-placement"
import { SkillAsset } from "@aigcfroge/core/skill-asset"
import { SkillAssetService } from "@aigcfroge/core/skill-asset-service"
import { ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Info, InvalidEntry, Summary } from "@aigcfroge/schema/skill-asset"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { AssetLocation } from "./asset-location"

export const SkillAssetHandler = HttpApiBuilder.group(Api, "skill-asset", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("Skill")
    const decodeInfo = Schema.decodeUnknownSync(Info)

    return handlers
      .handle("skill-asset.list", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* SkillAsset.Service
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
          }).pipe(Effect.mapError(skillAssetReadError)),
        ),
      )
      .handle("skill-asset.content", ({ query }) =>
        scope.atLocation(
          Effect.gen(function* () {
            const registry = yield* SkillAsset.Service
            const view = query.scope === undefined ? registry : yield* registry.select(query.scope)
            return yield* view.getByPath(query.path)
          }).pipe(Effect.mapError(skillAssetReadError), Effect.map(decodeInfo)),
        ),
      )
      .handle("skill-asset.inspect", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          SkillAssetService.Service.use((service) =>
            service.inspect(payload).pipe(Effect.mapError(skillAssetWriteError)),
          ),
        ),
      )
      .handle("skill-asset.apply", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          Effect.gen(function* () {
            if (!Flag.AIGCFROGE_EXPERIMENTAL_CHAT_ASSET)
              return yield* new InvalidRequestError({
                message: "Skill asset creation is not enabled",
                kind: "disabled",
              })
            if (payload.candidate.slash || payload.candidate.triggers.length > 0 || payload.candidate.tags.length > 0)
              return yield* new InvalidRequestError({
                message: "Only basic Skill assets with slash=false and empty triggers/tags are supported",
                field: "candidate",
                kind: "unsupported_candidate",
              })
            const service = yield* SkillAssetService.Service
            return yield* service
              .apply({
                candidate: payload.candidate,
                baseRevision: payload.baseRevision ?? null,
                overwrite: payload.overwrite,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(skillAssetWriteError), Effect.map(decodeInfo))
          }),
        ),
      )
      .handle("skill-asset.delete", ({ params, payload }) =>
        scope.atSessionLocation(
          params.sessionID,
          SkillAssetService.Service.use((service) =>
            service
              .delete({
                relativePath: payload.relativePath,
                baseRevision: payload.baseRevision ?? null,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(skillAssetWriteError)),
          ),
        ),
      )
      .handle("skill-asset.remove", ({ payload }) =>
        scope.atLocation(
          SkillAssetService.Service.use((service) =>
            service
              .delete({
                relativePath: payload.relativePath,
                baseRevision: payload.baseRevision ?? null,
                ...(payload.target === undefined ? {} : { target: payload.target }),
              })
              .pipe(Effect.mapError(skillAssetWriteError)),
          ),
        ),
      )
  }),
)

function skillAssetReadError(error: SkillAsset.ReadError) {
  if (error instanceof SkillAsset.NotFoundError)
    return new InvalidRequestError({
      message: `Skill asset not found: ${error.relativePath}`,
      field: "path",
      kind: "not_found",
    })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    field: "scope",
    kind: error instanceof AssetPlacement.PathError ? "invalid_target" : "read_failed",
  })
}

function skillAssetWriteError(
  error: SkillAssetService.InspectError | SkillAssetService.ApplyError | SkillAssetService.DeleteError,
) {
  if (error instanceof AssetPlacement.TargetMismatchError)
    return new InvalidRequestError({ message: error.message, field: "target", kind: "target_mismatch" })
  if (error instanceof AssetPlacement.PathError)
    return new InvalidRequestError({ message: error.message, field: "target", kind: "invalid_target" })
  if (error instanceof SkillAssetService.InvalidCandidateError)
    return new InvalidRequestError({ message: error.reason, kind: "invalid_candidate" })
  if (
    error instanceof SkillAssetService.StaleRevisionError ||
    error instanceof SkillAssetService.OverwriteRequiredError ||
    error instanceof SkillAssetService.ConcurrentModificationError ||
    error instanceof SkillAssetService.ReadbackMismatchError
  )
    return new ConflictError({ message: error.message, resource: error.relativePath })
  return new InvalidRequestError({
    message: error instanceof Error ? error.message : String(error),
    kind: "write_failed",
  })
}
