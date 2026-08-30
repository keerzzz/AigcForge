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
import { MCPAsset } from "../src/mcp-asset"
import { CommandAsset } from "../src/command-asset"
import { AssetKind } from "../src/asset-kind"
import { AbsolutePath } from "../src/schema"
import { it } from "./lib/effect"

describe("CommandAsset", () => {
  it.live("loads command assets and isolates from mcp, skill, prompt with same filename", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const tmpDir = yield* fs.makeTempDirectory({ directory: os.tmpdir(), prefix: "aigcfroge-cmd-test-" })
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
        CommandAsset.layer,
        MCPAsset.layer,
        SkillAsset.layer,
        PromptAsset.layer,
        LocationMutation.layer,
      ).pipe(Layer.provide(baseLayer))

      return yield* Effect.gen(function* () {
        const cmdService = yield* CommandAsset.Service
        const mcpService = yield* MCPAsset.Service
        const skillService = yield* SkillAsset.Service
        const promptService = yield* PromptAsset.Service

        const cmdDir = path.resolve(tmpDir, ".aigcfroge/commands")
        const mcpDir = path.resolve(tmpDir, ".aigcfroge/mcps")
        const skillDir = path.resolve(tmpDir, ".aigcfroge/skills")
        const promptDir = path.resolve(tmpDir, ".aigcfroge/prompts")

        yield* fs.makeDirectory(cmdDir, { recursive: true })
        yield* fs.makeDirectory(mcpDir, { recursive: true })
        yield* fs.makeDirectory(skillDir, { recursive: true })
        yield* fs.makeDirectory(promptDir, { recursive: true })

        const cmdFile = path.join(cmdDir, "my-tool.md")
        const mcpFile = path.join(mcpDir, "my-tool.md")
        const skillFile = path.join(skillDir, "my-tool.md")
        const promptFile = path.join(promptDir, "my-tool.md")

        yield* fs.writeFileString(
          cmdFile,
          '---\nkind: command\nname: "my-tool"\ndescription: "cmd desc"\ninvocation: "/my-tool"\n---\necho cmd',
        )

        yield* fs.writeFileString(
          mcpFile,
          '---\nkind: mcp\nname: "my-tool"\ndescription: "mcp desc"\ncommand: "node"\nargs: ["server.js"]\n---\n{}',
        )

        yield* fs.writeFileString(
          skillFile,
          '---\nkind: skill\nname: "my-tool"\ndescription: "skill desc"\ntrigger: "my-tool"\nsource: "echo hi"\n---\n',
        )

        yield* fs.writeFileString(
          promptFile,
          '---\nkind: prompt\nname: "my-tool"\ndescription: "prompt desc"\n---\nHello Prompt',
        )

        yield* cmdService.reload()
        yield* mcpService.reload()
        yield* skillService.reload()
        yield* promptService.reload()

        const cmds = yield* cmdService.list()
        const mcps = yield* mcpService.list()
        const skills = yield* skillService.list()
        const prompts = yield* promptService.list()

        expect(cmds.length).toBe(1)
        expect(cmds[0].name).toBe("my-tool")
        expect(cmds[0].kind).toBe("command")

        expect(mcps.length).toBe(1)
        expect(mcps[0].name).toBe("my-tool")
        expect(mcps[0].kind).toBe("mcp")

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
