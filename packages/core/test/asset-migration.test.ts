import path from "path"
import { beforeAll, afterAll, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"

const FLAG_KEY = "AIGCFROGE_EXPERIMENTAL_CHAT_ASSET"
const _origFlag = process.env[FLAG_KEY]
beforeAll(() => {
  // Legacy asset migration is gated behind this flag in skill-asset/agent-asset.
  process.env[FLAG_KEY] = "true"
})
afterAll(() => {
  if (_origFlag === undefined) delete process.env[FLAG_KEY]
  else process.env[FLAG_KEY] = _origFlag
})
import { SkillAsset } from "@aigcfroge/core/skill-asset"
import { AgentAsset } from "@aigcfroge/core/agent-asset"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Location } from "@aigcfroge/core/location"
import { EventV2 } from "@aigcfroge/core/event"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { tmpdir } from "./fixture/tmpdir"
import { location } from "./fixture/location"
import fs from "fs/promises"

function locationLayer(dir: string) {
  return Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(dir) })),
  )
}

function skillLayer(dir: string) {
  return SkillAsset.locationLayer.pipe(
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(locationLayer(dir)),
    Layer.provide(FSUtil.defaultLayer),
  )
}

function agentLayer(dir: string) {
  return AgentAsset.locationLayer.pipe(
    Layer.provide(EventV2.defaultLayer),
    Layer.provide(locationLayer(dir)),
    Layer.provide(FSUtil.defaultLayer),
  )
}

function runNow<A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> {
  return (Effect as unknown as { runPromise: (e: Effect.Effect<A, unknown>) => Promise<A> }).runPromise(
    effect as unknown as Effect.Effect<A, unknown>,
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

async function writeLegacySkill(dir: string, root: ".claude/skills" | ".agents/skills", name: string, body: string) {
  const skillDir = path.join(dir, root, name)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, "SKILL.md"), body)
}

describe("AssetMigration", () => {
  test("imports project-local legacy skills on first boot", async () => {
    await withTmp(async (dir) => {
      await writeLegacySkill(
        dir,
        ".claude/skills",
        "my-skill",
        `---\nname: my-skill\ndescription: Does things\n---\n\nSkill body here.\n`,
      )
      await writeLegacySkill(dir, ".agents/skills", "other-skill", `---\nname: other-skill\n---\n\nOther body.\n`)

      const list = await runNow(
        Effect.gen(function* () {
          const reg = yield* SkillAsset.Service
          return yield* reg.list()
        }).pipe(Effect.provide(skillLayer(dir)), Effect.scoped),
      )

      expect(list.map((a) => a.name).toSorted()).toEqual(["my-skill", "other-skill"])
      const mine = list.find((a) => a.name === "my-skill")!
      expect(mine.slash).toBe(true)
      expect(mine.description).toBe("Does things")
      expect(mine.content).toContain("Skill body here.")
      const written = await fs.readFile(path.join(dir, ".aigcfroge/skills/my-skill.md"), "utf8")
      expect(written).toContain("slash: true")
    })
  })

  test("does not import when the owner directory already exists", async () => {
    await withTmp(async (dir) => {
      await writeLegacySkill(dir, ".claude/skills", "my-skill", `---\nname: my-skill\n---\n\nBody.\n`)
      await fs.mkdir(path.join(dir, ".aigcfroge/skills"), { recursive: true })

      const list = await runNow(
        Effect.gen(function* () {
          const reg = yield* SkillAsset.Service
          return yield* reg.list()
        }).pipe(Effect.provide(skillLayer(dir)), Effect.scoped),
      )

      expect(list).toEqual([])
      expect(await fs.readdir(path.join(dir, ".aigcfroge/skills"))).toEqual([])
    })
  })

  test(".claude wins over .agents on duplicate names", async () => {
    await withTmp(async (dir) => {
      await writeLegacySkill(dir, ".claude/skills", "dup", `---\nname: dup\ndescription: from claude\n---\n\nClaude body.\n`)
      await writeLegacySkill(dir, ".agents/skills", "dup", `---\nname: dup\ndescription: from agents\n---\n\nAgents body.\n`)

      const list = await runNow(
        Effect.gen(function* () {
          const reg = yield* SkillAsset.Service
          return yield* reg.list()
        }).pipe(Effect.provide(skillLayer(dir)), Effect.scoped),
      )

      expect(list.length).toBe(1)
      expect(list[0].description).toBe("from claude")
    })
  })

  test("skips unparseable files and invalid names without failing boot", async () => {
    await withTmp(async (dir) => {
      await writeLegacySkill(dir, ".claude/skills", "bad-name", `---\nname: "a/b"\n---\n\nBody.\n`)
      const valid = await runNow(
        Effect.gen(function* () {
          const reg = yield* SkillAsset.Service
          return yield* reg.list()
        }).pipe(Effect.provide(skillLayer(dir)), Effect.scoped),
      )
      expect(valid).toEqual([])
    })
  })

  test("imports legacy agents on first boot", async () => {
    await withTmp(async (dir) => {
      const agentsDir = path.join(dir, ".claude/agents")
      await fs.mkdir(agentsDir, { recursive: true })
      await fs.writeFile(
        path.join(agentsDir, "reviewer.agent.md"),
        `---\nname: reviewer\ndescription: Reviews code\ntools:\n  - read\n  - grep\n---\n\nYou review code.\n`,
      )

      const list = await runNow(
        Effect.gen(function* () {
          const reg = yield* AgentAsset.Service
          return yield* reg.list()
        }).pipe(Effect.provide(agentLayer(dir)), Effect.scoped),
      )

      expect(list.length).toBe(1)
      expect(list[0].kind).toBe("agent")
      expect(list[0].name).toBe("reviewer")
      expect(list[0].description).toBe("Reviews code")
      expect(list[0].source).toContain("You review code.")
      const written = await fs.readFile(path.join(dir, ".aigcfroge/agents/reviewer.md"), "utf8")
      expect(written).toContain("kind: agent")
    })
  })
})
