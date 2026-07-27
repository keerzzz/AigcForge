export * as ProposePluginAsset from "./propose-plugin-asset"

import { Effect, Schema } from "effect"
import { PluginAsset } from "@aigcfroge/core/plugin-asset"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { define } from "./tool"
import { ProposePluginAssetTool } from "@aigcfroge/core/tool/propose-plugin-asset"

export const Parameters = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  content: Schema.String,
})

type Metadata = {
  relativePath: string
  exists: boolean
  revision?: string
  nameConflict: boolean
  pathConflict: boolean
}

export const ProposePluginAssetV1 = define<typeof Parameters, Metadata, LocationServiceMap>(
  "propose_plugin_asset",
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    return {
      description: `Propose a new plugin asset. Validates the candidate and checks for conflicts. Does not write to disk.`,
      parameters: Parameters,
      execute: (params) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))
          const pluginAsset = yield* PluginAsset.Service.pipe(Effect.provide(layer), Effect.orDie)
          const fs = yield* FSUtil.Service.pipe(Effect.provide(layer), Effect.orDie)
          const result = yield* ProposePluginAssetTool.propose(params, { pluginAsset, fs, directory })
          const lines: string[] = []
          if (result.nameConflict) lines.push("Name conflict: choose a different name.")
          if (result.pathConflict) lines.push("Path conflict: choose a different name.")
          if (result.exists) lines.push(`Target "${result.relativePath}" exists.`)
          if (!result.exists && !result.nameConflict && !result.pathConflict) lines.push(`Candidate "${params.name}" is valid.`)
          return {
            title: "Propose plugin asset",
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
