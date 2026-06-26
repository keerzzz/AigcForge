import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AgentV2 } from "@aigcfroge/core/agent"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { SkillPlugin } from "@aigcfroge/core/plugin/skill"
import { SkillV2 } from "@aigcfroge/core/skill"
import { SkillDiscovery } from "@aigcfroge/core/skill/discovery"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(
  SkillV2.layer.pipe(
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(SkillDiscovery.defaultLayer),
    Layer.provideMerge(AgentV2.locationLayer),
  ),
)

describe("SkillPlugin.Plugin", () => {
  it.effect("registers the built-in customize-aigcfroge skill", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* SkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      expect(yield* skill.list()).toContainEqual(
        expect.objectContaining({
          name: "customize-aigcfroge",
          description: expect.stringContaining("aigcfroge's own configuration"),
        }),
      )
    }),
  )
})
