import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context, Schema } from "effect"
import { PromptAssetApiGroup } from "../../src/server/routes/instance/httpapi/groups/prompt-asset"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(route: string, directory: string) {
  return HttpApiApp.webHandler().handler(
    new Request(`http://localhost${route}`, {
      headers: {
        "x-aigcfroge-directory": encodeURIComponent(directory),
      },
    }),
    context,
  )
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("prompt asset HttpApi", () => {
  test("lists assets in the request instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(PromptAssetApiGroup.PromptAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ assets: [], invalid: [] })
  })

  test("list response includes invalid entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const promptsDir = path.join(tmp.path, ".aigcfroge", "prompts")
    await fs.mkdir(promptsDir, { recursive: true })
    await fs.writeFile(path.join(promptsDir, "broken.md"), "no frontmatter here")

    const response = await request(PromptAssetApiGroup.PromptAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets).toEqual([])
    expect(body.invalid).toEqual([{ relativePath: "broken.md", errorTag: "parse_error" }])
  })

  test("list response separates valid assets and invalid entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const promptsDir = path.join(tmp.path, ".aigcfroge", "prompts")
    await fs.mkdir(promptsDir, { recursive: true })
    await fs.writeFile(path.join(promptsDir, "good.md"), "---\nkind: prompt\nname: good\ndescription: ok\n---\nbody")
    await fs.writeFile(path.join(promptsDir, "badfm.md"), "---\ndescription: missing kind and name\n---\nbody")

    const response = await request(PromptAssetApiGroup.PromptAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets).toHaveLength(1)
    expect(body.assets[0].name).toBe("good")
    expect(body.invalid).toEqual([{ relativePath: "badfm.md", errorTag: "bad_frontmatter" }])
  })

  test("lists prompt assets when a legacy command has invalid frontmatter", async () => {
    await using tmp = await tmpdir({ git: true })
    const promptsDir = path.join(tmp.path, ".aigcfroge", "prompts")
    const commandsDir = path.join(tmp.path, ".aigcfroge", "commands")
    await fs.mkdir(promptsDir, { recursive: true })
    await fs.mkdir(commandsDir, { recursive: true })
    await fs.writeFile(path.join(promptsDir, "good.md"), "---\nkind: prompt\nname: good\ndescription: ok\n---\nbody")
    await fs.writeFile(
      path.join(commandsDir, "oversized.md"),
      `---\nname: oversized\ndescription: ${"x".repeat(301)}\n---\nbody`,
    )

    const response = await request(PromptAssetApiGroup.PromptAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets).toHaveLength(1)
    expect(body.assets[0].name).toBe("good")
  })

  test("accepts omitted baseRevision for a new asset", () => {
    const payload = Schema.decodeUnknownSync(PromptAssetApiGroup.ApplyPayload)({
      candidate: {
        name: "new-prompt",
        description: "description",
        template: "template",
        relativePath: "new-prompt.md",
      },
      overwrite: false,
    })

    expect(payload.baseRevision).toBeUndefined()
  })
})
