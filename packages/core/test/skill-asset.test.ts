import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import os from "os"
import path from "path"
import { FSUtil } from "../src/fs-util"
import { Location } from "../src/location"
import { LocationMutation } from "../src/location-mutation"
import { Project } from "../src/project"
import { PromptAsset } from "../src/prompt-asset"
import { SkillAsset } from "../src/skill-asset"
import { AssetKind } from "../src/asset-kind"
import { AbsolutePath } from "../src/schema"
import { it } from "./lib/effect"

describe("SkillAsset", () => {
  it.live("loads skills and isolates from prompts with same filename", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const tmpDir = yield* fs.makeTempDirectory({ directory: os.tmpdir(), prefix: "aigcfroge-skill-test-" })
      const locationDir = AbsolutePath.make(tmpDir)

      const ref = { directory: locationDir }
      const projectLayer = Layer.succeed(
        Project.Service,
        Project.Service.of({
          directories: () => Effect.succeed([]),
          resolve: () =>
            Effect.succeed({
              id: Project.ID.make("project"),
              directory: locationDir,
              vcs: { type: "git", store: AbsolutePath.make(path.join(tmpDir, ".git")) },
            }),
          commit: () => Effect.void,
        }),
      )
      const locationLayer = Location.layer(ref).pipe(Layer.provide(projectLayer))

      const baseLayer = Layer.mergeAll(locationLayer, FSUtil.defaultLayer, AssetKind.layer)
      const testAppLayer = Layer.mergeAll(
        SkillAsset.layer,
        PromptAsset.layer,
        LocationMutation.layer,
      ).pipe(Layer.provide(baseLayer))

      return yield* Effect.gen(function* () {
        const skillService = yield* SkillAsset.Service
        const promptService = yield* PromptAsset.Service

        const skillDir = path.resolve(tmpDir, ".aigcfroge/skills")
        const promptDir = path.resolve(tmpDir, ".aigcfroge/prompts")

        yield* fs.makeDirectory(skillDir, { recursive: true })
        yield* fs.makeDirectory(promptDir, { recursive: true })

        const skillFile = path.join(skillDir, "my-tool.md")
        const promptFile = path.join(promptDir, "my-tool.md")

        yield* fs.writeFileString(
          skillFile,
          "---\nkind: skill\nname: \"my-tool\"\ndescription: \"skill desc\"\ntrigger: \"my-tool\"\nsource: \"echo hi\"\n---\n",
        )

        yield* fs.writeFileString(
          promptFile,
          "---\nkind: prompt\nname: \"my-tool\"\ndescription: \"prompt desc\"\n---\nHello Prompt",
        )

        yield* skillService.reload()
        yield* promptService.reload()

        const skills = yield* skillService.list()
        const prompts = yield* promptService.list()

        expect(skills.length).toBe(1)
        expect(skills[0].name).toBe("my-tool")
        expect(skills[0].kind).toBe("skill")

        expect(prompts.length).toBe(1)
        expect(prompts[0].name).toBe("my-tool")
        expect(prompts[0].kind).toBe("prompt")
      }).pipe(Effect.provide(testAppLayer))
    }).pipe(Effect.provide(FSUtil.defaultLayer)),
  )
})
