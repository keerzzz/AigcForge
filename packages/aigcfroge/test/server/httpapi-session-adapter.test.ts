import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { ProjectV2 } from "@aigcfroge/core/project"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { WorkPreset } from "@aigcfroge/schema/work-preset"
import { v2InfoToV1 } from "../../src/server/routes/instance/httpapi/handlers/session-adapter"

function info(presetCategoryId?: WorkPreset.Category) {
  return SessionSchema.Info.make({
    id: SessionSchema.ID.make("ses_adapter"),
    slug: "adapter",
    version: "0.0.0",
    projectID: ProjectV2.ID.global,
    title: "test",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
    ...(presetCategoryId ? { presetCategoryId } : {}),
  })
}

describe("v2InfoToV1", () => {
  test("propagates presetCategoryId to the top level matching metadata", () => {
    const converted = v2InfoToV1(info("academic"))
    expect(converted.presetCategoryId).toBe("academic")
    expect(converted.metadata?.presetCategoryId).toBe("academic")
    expect(converted.presetCategoryId).toBe(converted.metadata?.presetCategoryId)
  })

  test("omits presetCategoryId and metadata when the source has none", () => {
    const converted = v2InfoToV1(info())
    expect(converted.presetCategoryId).toBeUndefined()
    expect(converted.metadata).toBeUndefined()
  })
})
