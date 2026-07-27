import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context } from "effect"
import { WorkflowAssetApiGroup } from "../../src/server/routes/instance/httpapi/groups/workflow-asset"
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

describe("workflow asset HttpApi", () => {
  test("lists assets in the request instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(WorkflowAssetApiGroup.WorkflowAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ assets: [], invalid: [] })
  })

  test("list response includes invalid entries", async () => {
    await using tmp = await tmpdir({ git: true })
    const workflowsDir = path.join(tmp.path, ".aigcfroge", "workflows")
    await fs.mkdir(workflowsDir, { recursive: true })
    await fs.writeFile(path.join(workflowsDir, "broken.yaml"), "broken yaml [[[")

    const response = await request(WorkflowAssetApiGroup.WorkflowAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets).toEqual([])
    expect(body.invalid).toEqual([{ relativePath: "broken.yaml", errorTag: "parse_error" }])
  })

  test("list returns valid workflow assets", async () => {
    await using tmp = await tmpdir({ git: true })
    const workflowsDir = path.join(tmp.path, ".aigcfroge", "workflows")
    await fs.mkdir(workflowsDir, { recursive: true })
    await fs.writeFile(
      path.join(workflowsDir, "review.yaml"),
      [
        "kind: workflow",
        'name: "code-review"',
        'description: "Automated review"',
        'version: "1.0.0"',
        "triggers: []",
        "steps:",
        "  - id: s1",
        '    name: "Check"',
        '    agent: "builtin"',
        "    input: {}",
      ].join("\n"),
    )

    const response = await request(WorkflowAssetApiGroup.WorkflowAssetPaths.list, tmp.path)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.assets).toHaveLength(1)
    expect(body.assets[0].name).toBe("code-review")
    expect(body.assets[0].kind).toBe("workflow")
  })

  test("content returns 404 for missing workflow", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await request(
      `${WorkflowAssetApiGroup.WorkflowAssetPaths.content}?path=nonexistent.yaml`,
      tmp.path,
    )

    expect(response.status).toBe(400)
  })
})
