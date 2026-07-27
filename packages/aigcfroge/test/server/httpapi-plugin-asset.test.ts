import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context } from "effect"
import { PluginAssetApiGroup } from "../../src/server/routes/instance/httpapi/groups/plugin-asset"
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

describe("plugin asset HttpApi", () => {
  test("lists assets in the request instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(PluginAssetApiGroup.PluginAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets).toEqual([])
    expect(body.invalid).toEqual([])
    expect(Array.isArray(body.bridged)).toBe(true)
  })

  test("list response includes invalid entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const pluginsDir = path.join(tmp.path, ".aigcfroge", "plugins")
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.writeFile(path.join(pluginsDir, "broken.plugin.yaml"), "broken yaml [[[")

    const response = await request(PluginAssetApiGroup.PluginAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets).toEqual([])
    expect(body.invalid).toEqual([{ relativePath: "broken.plugin.yaml", errorTag: "parse_error" }])
  })

  test("list returns valid plugin assets", async () => {
    await using tmp = await tmpdir({ git: true })
    const pluginsDir = path.join(tmp.path, ".aigcfroge", "plugins")
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, "my-plugin.plugin.yaml"),
      [
        "kind: plugin",
        'name: "my-plugin"',
        'description: "Test plugin"',
        'version: "1.0.0"',
      ].join("\n"),
    )

    const response = await request(PluginAssetApiGroup.PluginAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets.length).toBe(1)
    expect(body.assets[0].name).toBe("my-plugin")
    expect(body.assets[0].kind).toBe("plugin")
    expect(body.assets[0].relativePath).toBe("my-plugin.plugin.yaml")
    expect(typeof body.assets[0].revision).toBe("string")
    expect(body.assets[0].revision.length).toBe(64)
  })

  test("content returns plugin info", async () => {
    await using tmp = await tmpdir({ git: true })
    const pluginsDir = path.join(tmp.path, ".aigcfroge", "plugins")
    await fs.mkdir(pluginsDir, { recursive: true })
    await fs.writeFile(
      path.join(pluginsDir, "detail.plugin.yaml"),
      [
        "kind: plugin",
        'name: "detail"',
        'description: "Detailed plugin"',
        'version: "2.0.0"',
        'category: "development"',
      ].join("\n"),
    )

    const response = await request(
      `${PluginAssetApiGroup.PluginAssetPaths.content}?path=detail.plugin.yaml`,
      tmp.path,
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.kind).toBe("plugin")
    expect(body.name).toBe("detail")
    expect(body.description).toBe("Detailed plugin")
    expect(body.version).toBe("2.0.0")
    expect(body.category).toBe("development")
  })

  test("content returns 400 for nonexistent path", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(
      `${PluginAssetApiGroup.PluginAssetPaths.content}?path=nonexistent.plugin.yaml`,
      tmp.path,
    )

    expect(response.status).toBe(400)
  })
})
