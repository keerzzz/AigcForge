import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { AgentAsset as SchemaAgentAsset } from "@aigcfroge/schema/agent-asset"
import { AgentAssetService } from "@aigcfroge/core/agent-asset-service"
import { AgentAsset } from "@aigcfroge/core/agent-asset"
import { FileMutation } from "@aigcfroge/core/file-mutation"
import { LocationMutation } from "@aigcfroge/core/location-mutation"
import { ConfigMarkdown } from "@aigcfroge/core/config/markdown"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { tempLocationLayer } from "./fixture/location"
import { testEffect } from "./lib/effect"

const dependencies = Layer.mergeAll(FSUtil.defaultLayer, tempLocationLayer, EventV2.defaultLayer)
const serviceLayer = AgentAssetService.locationLayer.pipe(
  Layer.provide(FileMutation.locationLayer),
  Layer.provide(LocationMutation.locationLayer),
  Layer.provide(AgentAsset.locationLayer),
  Layer.provide(dependencies),
)
const it = testEffect(Layer.mergeAll(serviceLayer, dependencies))

function candidate(config: string) {
  return Schema.decodeUnknownSync(SchemaAgentAsset.Candidate)({
    name: "reviewer",
    description: "Code reviewer",
    config,
    source: "Review carefully.",
    relativePath: "",
  })
}

describe("AgentAssetService permission warnings", () => {
  it.effect("warns for broad and dangerous allows but not for a narrow readonly allow", () =>
    Effect.gen(function* () {
      const service = yield* AgentAssetService.Service
      const wildcard = yield* service.propose(
        candidate("permissions:\n  - action: \"*\"\n    resource: \"*\"\n    effect: allow"),
      )
      expect(wildcard.warnings.map((warning) => warning.code)).toEqual(["wildcard_allow"])

      const dangerous = yield* service.propose(
        candidate("permissions:\n  - action: bash\n    resource: \"*\"\n    effect: allow"),
      )
      expect(dangerous.warnings.map((warning) => warning.code)).toEqual(["dangerous_allow"])

      const readonlyWildcard = yield* service.propose(
        candidate("permissions:\n  - action: read\n    resource: \"*\"\n    effect: allow"),
      )
      expect(readonlyWildcard.warnings.map((warning) => warning.code)).toEqual(["wildcard_allow"])

      const readonlyNarrow = yield* service.propose(
        candidate("permissions:\n  - action: read\n    resource: src/**\n    effect: allow"),
      )
      expect(readonlyNarrow.warnings).toEqual([])
    }),
  )

  it.effect("warns without rejecting apply or rewriting the asset", () =>
    Effect.gen(function* () {
      const service = yield* AgentAssetService.Service
      const value = candidate(
        "permissions:\n  - action: \"*\"\n    resource: \"*\"\n    effect: allow\n  - action: bash\n    resource: \"*\"\n    effect: allow",
      )
      const proposed = yield* service.propose(value)
      const applied = yield* service.apply({ candidate: value, baseRevision: null, overwrite: false })
      expect(applied.warnings).toEqual(proposed.warnings)
      expect(applied.asset.config).toBe(value.config)
      expect(applied.asset.source).toBe(value.source)

      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const persisted = yield* fs.readFileString(path.join(location.directory, ".aigcfroge", "agents", "reviewer.md"))
      const decoded = ConfigMarkdown.parseOption(persisted)
      expect(decoded?.data.config).toBe(value.config)
      expect(decoded?.content).toBe(value.source)
    }),
  )
})
