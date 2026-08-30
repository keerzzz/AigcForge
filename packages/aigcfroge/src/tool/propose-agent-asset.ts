export * as ProposeAgentAsset from "./propose-agent-asset"

import { Effect, Schema } from "effect"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { AgentAssetService } from "@aigcfroge/core/agent-asset-service"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { InstanceState } from "@/effect/instance-state"
import { define } from "./tool"

export const Parameters = Schema.Struct({
  name: AgentAsset.Name,
  description: AgentAsset.Description,
  config: AgentAsset.Config,
  source: AgentAsset.Source,
})

type Metadata = {
  relativePath: string
  exists: boolean
  revision?: string
  nameConflict: boolean
  pathConflict: boolean
  warnings: ReadonlyArray<{ code: "wildcard_allow" | "dangerous_allow"; action: string; resource: string }>
}

export const ProposeAgentAssetV1 = define<typeof Parameters, Metadata, LocationServiceMap>(
  "propose_agent_asset",
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return {
      description: `Propose a new agent asset. Validates the candidate and checks for conflicts. Does not write to disk. Parameters: name, description, config, source.`,
      parameters: Parameters,
      execute: (params) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory) }))
          const service = yield* AgentAssetService.Service.pipe(Effect.provide(layer), Effect.orDie)
          const candidate = AgentAsset.Candidate.make({ ...params, relativePath: "" })
          const result = yield* service.propose(candidate)
          const lines: string[] = []
          if (result.nameConflict) lines.push("Name conflict: choose a different name.")
          if (result.pathConflict) lines.push("Path conflict: choose a different path.")
          if (result.exists) lines.push(`Target "${result.relativePath}" exists.`)
          if (!result.exists && !result.nameConflict && !result.pathConflict)
            lines.push(`Candidate "${params.name}" is valid.`)
          return {
            title: "Propose agent asset",
            metadata: {
              relativePath: result.relativePath,
              exists: result.exists,
              revision: result.revision ?? undefined,
              nameConflict: result.nameConflict,
              pathConflict: result.pathConflict,
              warnings: result.warnings,
            },
            output: lines.join("\n") || "Valid and ready for review.",
          }
        }).pipe(Effect.orDie),
    }
  }),
)
