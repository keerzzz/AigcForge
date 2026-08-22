import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import fs from "fs/promises"
import path from "path"
import { CustomProfile } from "../src/custom-profile"

function profileLayer(directory: string) {
  return CustomProfile.layer.pipe(
    Layer.provide(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
    ),
    Layer.provide(FSUtil.defaultLayer),
  )
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const tmp = await tmpdir()
  try {
    return await fn(tmp.path)
  } finally {
    await tmp[Symbol.asyncDispose]()
  }
}

const sampleYaml = `kind: custom-profile
name: Dev Profile
description: Developer profile for coding tasks
agents:
  - kind: agent
    relativePath: coder.md
    revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
bindings:
  agents/coder:
    prompts:
      - kind: prompt
        relativePath: system-prompt.md
        revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    skills:
      - kind: skill
        relativePath: git-tools/SKILL.md
        revision: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
presentation: native
requestedCapabilities:
  - workspace.read
`

describe("CustomProfile Registry", () => {
  test("empty location yields empty list", async () => {
    await withTmp(async (dir) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(0)
          const invalid = yield* service.listInvalid()
          expect(invalid).toHaveLength(0)
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })

  test("loads valid custom profile YAML file", async () => {
    await withTmp(async (dir) => {
      const profilesDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profilesDir, { recursive: true })
      await fs.writeFile(path.join(profilesDir, "dev.yaml"), sampleYaml)

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(1)
          expect(list[0].name).toBe("Dev Profile")
          expect(list[0].description).toBe("Developer profile for coding tasks")
          expect(list[0].relativePath).toBe("dev.yaml")
          expect(list[0].profile.agents).toHaveLength(1)
          expect(list[0].profile.agents[0].relativePath).toBe("coder.md")
          expect(list[0].revision).toHaveLength(64)

          const byPath = yield* service.getByPath("dev.yaml")
          expect(byPath.name).toBe("Dev Profile")

          const byName = yield* service.findByName("Dev Profile")
          expect(byName).toBeDefined()
          expect(byName?.relativePath).toBe("dev.yaml")

          const notFound = yield* service.getByPath("nonexistent.yaml").pipe(Effect.flip)
          expect(notFound._tag).toBe("CustomProfile.NotFound")
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })

  test("marks invalid YAML as parse_error and non-conforming schema as bad_yaml", async () => {
    await withTmp(async (dir) => {
      const profilesDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profilesDir, { recursive: true })
      await fs.writeFile(path.join(profilesDir, "corrupt.yaml"), ": bad : yaml :")
      const emptyAgentYaml = `kind: custom-profile
name: Empty Agent
description: Invalid because 0 agents
agents: []
bindings: {}
presentation: native
requestedCapabilities: []
`
      await fs.writeFile(path.join(profilesDir, "empty.yaml"), emptyAgentYaml)

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(0)

          const invalid = yield* service.listInvalid()
          expect(invalid).toHaveLength(2)
          const tags = new Map(invalid.map((i) => [i.relativePath, i.errorTag]))
          expect(tags.get("corrupt.yaml")).toBe("parse_error")
          expect(tags.get("empty.yaml")).toBe("bad_yaml")
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })

  test("marks duplicate names as name_conflict and excludes both from active list", async () => {
    await withTmp(async (dir) => {
      const profilesDir = path.join(dir, ".aigcfroge", "custom-profiles")
      await fs.mkdir(profilesDir, { recursive: true })
      await fs.writeFile(path.join(profilesDir, "first.yaml"), sampleYaml)
      await fs.writeFile(path.join(profilesDir, "second.yaml"), sampleYaml)

      await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* CustomProfile.Service
          yield* service.reload()
          const list = yield* service.list()
          expect(list).toHaveLength(0)

          const invalid = yield* service.listInvalid()
          expect(invalid).toHaveLength(2)
          expect(invalid.every((i) => i.errorTag === "name_conflict")).toBe(true)
        }).pipe(Effect.provide(profileLayer(dir)), Effect.scoped),
      )
    })
  })
})
