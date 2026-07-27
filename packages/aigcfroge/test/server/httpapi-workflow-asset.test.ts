import { afterAll, afterEach, beforeEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { WorkflowAssetApiGroup } from "../../src/server/routes/instance/httpapi/groups/workflow-asset"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(httpApiLayer))

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function post(route: string, directory: string, body: Record<string, unknown>) {
  return requestInDirectory(route, directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// The apply endpoint is gated on the experimental chat-asset flag; enable it for
// this file only. Assigning undefined to process.env stores the string
// "undefined", so restore must delete instead.
const FLAG_KEY = "AIGCFROGE_EXPERIMENTAL_CHAT_ASSET"
const savedFlag = process.env[FLAG_KEY]
beforeEach(() => {
  process.env[FLAG_KEY] = "true"
})
afterAll(() => {
  if (savedFlag === undefined) delete process.env[FLAG_KEY]
  else process.env[FLAG_KEY] = savedFlag
})

describe("workflow asset HttpApi", () => {
  it.instance(
    "lists assets",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const res = yield* requestInDirectory(WorkflowAssetApiGroup.WorkflowAssetPaths.list, t.directory)
        expect(res.status).toBe(200)
        const body = (yield* res.json) as unknown as { assets: { name: string }[]; invalid: { relativePath: string; errorTag?: string }[] }
        expect(body.assets).toEqual([])
      }),
    { git: true },
  )

  it.instance(
    "list includes invalid entries",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const wfDir = path.join(t.directory, ".aigcfroge", "workflows")
        yield* Effect.promise(() => fs.mkdir(wfDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(wfDir, "broken.yaml"), "broken yaml [["))
        const res = yield* requestInDirectory(WorkflowAssetApiGroup.WorkflowAssetPaths.list, t.directory)
        expect(res.status).toBe(200)
        const body = (yield* res.json) as unknown as { assets: { name: string }[]; invalid: { relativePath: string; errorTag?: string }[] }
        expect(body.invalid).toEqual([{ relativePath: "broken.yaml", errorTag: "parse_error" }])
      }),
    { git: true },
  )

  it.instance(
    "list returns valid workflow assets",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const wfDir = path.join(t.directory, ".aigcfroge", "workflows")
        yield* Effect.promise(() => fs.mkdir(wfDir, { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(path.join(wfDir, "review.yaml"), 'kind: workflow\nname: "code-review"\ndescription: "test"\nversion: "1.0.0"\ntriggers: []\nsteps:\n  - id: s1\n    name: "Check"\n    agent: "builtin"\n    input: {}'),
        )
        const res = yield* requestInDirectory(WorkflowAssetApiGroup.WorkflowAssetPaths.list, t.directory)
        expect(res.status).toBe(200)
        const body = (yield* res.json) as unknown as { assets: { name: string }[]; invalid: { relativePath: string; errorTag?: string }[] }
        expect(body.assets).toHaveLength(1)
        expect(body.assets[0].name).toBe("code-review")
      }),
    { git: true },
  )

  it.instance(
    "apply creates a workflow asset",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "test-wf", description: "test", content: "kind: workflow\nname: test-wf\ndescription: test\nversion: 1.0.0\ntriggers: []\nsteps:\n  - id: s1\n    name: S1\n    agent: builtin\n    input: {}" }
        const route = WorkflowAssetApiGroup.WorkflowAssetPaths.apply.replace(":sessionID", "sess-1")

        const applyRes = yield* post(route, t.directory, { candidate, overwrite: true })
        expect(applyRes.status).toBe(200)
        const applied = (yield* applyRes.json) as unknown as { name: string; relativePath: string }
        expect(applied.name).toBe("test-wf")
        expect(applied.relativePath).toMatch(/\.yaml$/)

        const listRes = yield* requestInDirectory(WorkflowAssetApiGroup.WorkflowAssetPaths.list, t.directory)
        const listBody = (yield* listRes.json) as { assets: { name: string }[] }
        expect(listBody.assets).toHaveLength(1)
        expect(listBody.assets[0].name).toBe("test-wf")
      }),
    { git: true },
  )

  it.instance(
    "apply returns 409 for existing asset without overwrite",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "conflict", description: "test", content: "kind: workflow\nname: conflict\ndescription: test\nversion: 1.0.0\ntriggers: []\nsteps:\n  - id: s1\n    name: S1\n    agent: builtin\n    input: {}" }
        const route = WorkflowAssetApiGroup.WorkflowAssetPaths.apply.replace(":sessionID", "sess-2")

        const res1 = yield* post(route, t.directory, { candidate, overwrite: true })
        expect(res1.status).toBe(200)

        const res2 = yield* post(route, t.directory, { candidate, overwrite: false })
        expect(res2.status).toBe(409)
      }),
    { git: true },
  )

  it.instance(
    "delete removes a workflow asset",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "delete-me", description: "test", content: "kind: workflow\nname: delete-me\ndescription: test\nversion: 1.0.0\ntriggers: []\nsteps:\n  - id: s1\n    name: S1\n    agent: builtin\n    input: {}" }
        const applyRoute = WorkflowAssetApiGroup.WorkflowAssetPaths.apply.replace(":sessionID", "sess-3")

        const applyRes = yield* post(applyRoute, t.directory, { candidate, overwrite: true })
        expect(applyRes.status).toBe(200)
        const asset = (yield* applyRes.json) as unknown as { relativePath: string }

        const delRoute = WorkflowAssetApiGroup.WorkflowAssetPaths.delete.replace(":sessionID", "sess-3")
        const delRes = yield* post(delRoute, t.directory, { relativePath: asset.relativePath })
        expect(delRes.status).toBe(200)

        const listRes = yield* requestInDirectory(WorkflowAssetApiGroup.WorkflowAssetPaths.list, t.directory)
        const listBody = (yield* listRes.json) as unknown as { assets: { name: string }[] }
        expect(listBody.assets).toHaveLength(0)
      }),
    { git: true },
  )

  it.instance(
    "delete returns 400 for non-existent asset",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const delRoute = WorkflowAssetApiGroup.WorkflowAssetPaths.delete.replace(":sessionID", "sess-4")
        const delRes = yield* post(delRoute, t.directory, { relativePath: ".aigcfroge/workflows/nope.yaml" })
        expect(delRes.status).toBe(400)
      }),
    { git: true },
  )
})
