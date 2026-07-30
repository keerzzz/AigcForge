import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("scanAssets", () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "assets-test-"))
    // Create a realistic .aigcfroge structure
    const aigcfroge = join(tmpDir, ".aigcfroge")

    // prompts (subdirectories)
    mkdirSync(join(aigcfroge, "prompts", "code-review"), { recursive: true })
    mkdirSync(join(aigcfroge, "prompts", "commit-msg"), { recursive: true })
    writeFileSync(join(aigcfroge, "prompts", "code-review", "source.md"), "content")
    writeFileSync(join(aigcfroge, "prompts", "commit-msg", "source.md"), "content")

    // skills (subdirectories)
    mkdirSync(join(aigcfroge, "skills", "deploy"), { recursive: true })
    writeFileSync(join(aigcfroge, "skills", "deploy", "SKILL.md"), "content")

    // mcps (.json files)
    mkdirSync(join(aigcfroge, "mcps"), { recursive: true })
    writeFileSync(join(aigcfroge, "mcps", "github.json"), "{}")
    writeFileSync(join(aigcfroge, "mcps", "filesystem.json"), "{}")
    writeFileSync(join(aigcfroge, "mcps", "README.md"), "docs") // should be ignored

    // commands (.md files)
    mkdirSync(join(aigcfroge, "commands"), { recursive: true })
    writeFileSync(join(aigcfroge, "commands", "build.md"), "")
    writeFileSync(join(aigcfroge, "commands", "test.md"), "")

    // agents (.agent.md files)
    mkdirSync(join(aigcfroge, "agents"), { recursive: true })
    writeFileSync(join(aigcfroge, "agents", "reviewer.agent.md"), "")
    writeFileSync(join(aigcfroge, "agents", "planner.agent.md"), "")

    // workflows (.yaml files)
    mkdirSync(join(aigcfroge, "workflows"), { recursive: true })
    writeFileSync(join(aigcfroge, "workflows", "release.yaml"), "")
    writeFileSync(join(aigcfroge, "workflows", "build.yaml"), "")
    writeFileSync(join(aigcfroge, "workflows", "notes.txt"), "") // should be ignored

    // plugins (subdirectories)
    mkdirSync(join(aigcfroge, "plugins", "eslint"), { recursive: true })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("discovers all assets by kind", async () => {
    const { scanAssets } = await import("@/agent/meta/assets-loader")
    const assets = await scanAssets(tmpDir)
    expect(assets.length).toBe(12)

    const byKind = groupBy(assets, "kind")
    expect(byKind.get("prompt")?.map((a) => a.name).sort()).toEqual(["code-review", "commit-msg"])
    expect(byKind.get("skill")?.map((a) => a.name)).toEqual(["deploy"])
    expect(byKind.get("mcp")?.map((a) => a.name).sort()).toEqual(["filesystem", "github"])
    expect(byKind.get("command")?.map((a) => a.name).sort()).toEqual(["build", "test"])
    expect(byKind.get("agent")?.map((a) => a.name).sort()).toEqual(["planner", "reviewer"])
    expect(byKind.get("workflow")?.map((a) => a.name).sort()).toEqual(["build", "release"])
    expect(byKind.get("plugin")?.map((a) => a.name)).toEqual(["eslint"])
  })

  it("returns empty array for empty project", async () => {
    const { scanAssets } = await import("@/agent/meta/assets-loader")
    const emptyDir = join(tmpDir, "empty-project")
    mkdirSync(emptyDir, { recursive: true })
    const assets = await scanAssets(emptyDir)
    expect(assets).toEqual([])
    rmSync(emptyDir, { recursive: true, force: true })
  })

  it("skips hidden entries (starting with dot)", async () => {
    const { scanAssets } = await import("@/agent/meta/assets-loader")
    const assets = await scanAssets(tmpDir)
    const prompts = assets.filter((a) => a.kind === "prompt")
    expect(prompts.every((p) => !p.name.startsWith("."))).toBe(true)
  })
})

function groupBy<T extends Record<string, any>>(items: T[], key: keyof T): Map<T[keyof T], T[]> {
  const map = new Map<T[keyof T], T[]>()
  for (const item of items) {
    const k = item[key]
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return map
}
