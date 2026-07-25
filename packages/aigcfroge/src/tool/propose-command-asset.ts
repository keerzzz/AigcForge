export * as ProposeCommandAsset from "./propose-command-asset"

import { Effect, Schema } from "effect"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { CommandAssetService } from "@aigcfroge/core/command-asset-service"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { define } from "./tool"

export const Parameters = Schema.Struct({
  name: CommandAsset.Name,
  description: CommandAsset.Description,
  invocation: CommandAsset.Invocation,
  source: CommandAsset.Source,
})

type Metadata = {
  relativePath: string
  exists: boolean
  revision?: string
  nameConflict: boolean
  pathConflict: boolean
}

export const ProposeCommandAssetV1 = define<typeof Parameters, Metadata, LocationServiceMap>(
  "propose_command_asset",
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return {
      description: `Propose a new command asset. Validates the candidate and checks for conflicts. Does not write to disk. Parameters: name, description, invocation, source.`,
      parameters: Parameters,
      execute: (params) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))
          const service = yield* CommandAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
          const candidate = CommandAsset.Candidate.make({ ...params, relativePath: "" })
          const result = yield* service.propose(candidate)
          const lines: string[] = []
          if (result.nameConflict) lines.push("Name conflict: choose a different name.")
          if (result.pathConflict) lines.push("Path conflict: choose a different path.")
          if (result.exists) lines.push(`Target "${result.relativePath}" exists.`)
          if (!result.exists && !result.nameConflict && !result.pathConflict) lines.push(`Candidate "${params.name}" is valid.`)
          return {
            title: "Propose command asset",
            metadata: {
              relativePath: result.relativePath,
              exists: result.exists,
              revision: result.revision ?? undefined,
              nameConflict: result.nameConflict,
              pathConflict: result.pathConflict,
            },
            output: lines.join("\n") || "Valid and ready for review.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
