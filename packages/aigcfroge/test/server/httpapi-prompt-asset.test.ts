import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { PromptAssetPaths } from "../../src/server/routes/instance/httpapi/groups/prompt-asset"
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

    const response = await request(PromptAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})
