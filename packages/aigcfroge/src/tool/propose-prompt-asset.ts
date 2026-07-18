import { Effect, Schema } from "effect"
import { PromptAsset as SchemaPromptAsset } from "@aigcfroge/schema/prompt-asset"
import { PromptAssetService } from "@aigcfroge/core/prompt-asset-service"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { define } from "./tool"

export const Parameters = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  template: Schema.String,
})

export const ProposePromptAssetV1 = define<typeof Parameters, Record<string, unknown>, LocationServiceMap>(
  "propose_prompt_asset",
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    return {
      description: `Propose a new prompt asset. Validates the candidate and checks for conflicts. Does not write to disk.`,
      parameters: Parameters,
      execute: (params) =>
        Effect.gen(function* () {
          // PromptAssetService is Location-scoped, so resolve it from the LayerMap
          // for the current instance directory at call time (same pattern as the
          // prompt-asset HTTP handler) instead of capturing it at registry build.
          const directory = yield* InstanceState.directory
          const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))
          const service = yield* PromptAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
          const candidate = yield* Schema.decodeUnknownEffect(SchemaPromptAsset.Candidate)({
            name: params.name,
            description: params.description,
            template: params.template,
            relativePath: "",
          })
          const result = yield* service.propose(candidate)
          const lines: string[] = []
          if (result.nameConflict) {
            lines.push("Name conflict: choose a different name.")
          }
          if (result.pathConflict) {
            lines.push("Path conflict: choose a different path.")
          }
          if (result.exists) {
            lines.push(`Target "${result.relativePath}" exists.`)
          }
          if (!result.exists && !result.nameConflict && !result.pathConflict) {
            lines.push(`Candidate "${params.name}" is valid.`)
          }
          return {
            title: "Propose prompt asset",
            metadata: {},
            output: lines.join("\n") || "Valid and ready for review.",
          }
        }).pipe(Effect.catch((err) =>
          Effect.succeed({
            title: "Propose failed",
            metadata: {},
            output: `Validation error: ${(err as Error).message}`,
          }),
        )),
    }
  }),
)
