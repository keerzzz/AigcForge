import { afterAll, afterEach, beforeEach, describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { PluginAssetApiGroup } from "../../src/server/routes/instance/httpapi/groups/plugin-asset"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(httpApiLayer))

// Minimal decode of the apply response: only the fields the delete flow needs.
// The full Info schema is too strict for the wire shape (optional fields arrive as null).
const AppliedInfo = Schema.Struct({ relativePath: Schema.String, revision: Schema.String })

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

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("plugin asset HttpApi", () => {
  it.instance(
    "lists assets",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const res = yield* requestInDirectory(PluginAssetApiGroup.PluginAssetPaths.list, t.directory)
        expect(res.status).toBe(200)
        const body = (yield* res.json) as unknown as { assets: { name: string; kind?: string }[]; invalid: unknown[]; bridged: unknown[] }
        expect(body.assets).toEqual([])
        expect(Array.isArray(body.bridged)).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "list includes invalid entries",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const plDir = path.join(t.directory, ".aigcfroge", "plugins")
        yield* Effect.promise(() => fs.mkdir(plDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(plDir, "broken.plugin.yaml"), "broken yaml [["))
        const res = yield* requestInDirectory(PluginAssetApiGroup.PluginAssetPaths.list, t.directory)
        expect(res.status).toBe(200)
        const body = (yield* res.json) as unknown as { assets: { name: string; kind?: string }[]; invalid: unknown[]; bridged: unknown[] }
        expect(body.invalid).toEqual([{ relativePath: "broken.plugin.yaml", errorTag: "parse_error" }])
      }),
    { git: true },
  )

  it.instance(
    "list returns valid plugin assets",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const plDir = path.join(t.directory, ".aigcfroge", "plugins")
        yield* Effect.promise(() => fs.mkdir(plDir, { recursive: true }))
        yield* Effect.promise(() =>
          fs.writeFile(
            path.join(plDir, "my-plugin.plugin.yaml"),
            'kind: plugin\nname: "my-plugin"\ndescription: "test"\nversion: "1.0.0"\nhooks: []',
          ),
        )
        const res = yield* requestInDirectory(PluginAssetApiGroup.PluginAssetPaths.list, t.directory)
        expect(res.status).toBe(200)
        const body = (yield* res.json) as unknown as { assets: { name: string; kind?: string }[]; invalid: unknown[]; bridged: unknown[] }
        expect(body.assets).toHaveLength(1)
        expect(body.assets[0].name).toBe("my-plugin")
        expect(body.assets[0].kind).toBe("plugin")
      }),
    { git: true },
  )

  it.instance(
    "apply creates a plugin asset",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "test-pl", description: "test", content: "kind: plugin\nname: test-pl\ndescription: test\nversion: 1.0.0\nhooks: []" }
        const route = PluginAssetApiGroup.PluginAssetPaths.apply.replace(":sessionID", "sess-1")

        const applyRes = yield* post(route, t.directory, { candidate, overwrite: true })
        expect(applyRes.status).toBe(200)
        const applied = (yield* applyRes.json) as unknown as { name: string; relativePath: string }
        expect(applied.name).toBe("test-pl")
        expect(applied.relativePath).toMatch(/\.plugin\.yaml$/)

        const listRes = yield* requestInDirectory(PluginAssetApiGroup.PluginAssetPaths.list, t.directory)
        const listBody = (yield* listRes.json) as unknown as { assets: { name: string }[] }
        expect(listBody.assets).toHaveLength(1)
        expect(listBody.assets[0].name).toBe("test-pl")
      }),
    { git: true },
  )

  it.instance(
    "apply returns 409 for existing asset without overwrite",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "pconflict", description: "test", content: "kind: plugin\nname: pconflict\ndescription: test\nversion: 1.0.0\nhooks: []" }
        const route = PluginAssetApiGroup.PluginAssetPaths.apply.replace(":sessionID", "sess-2")

        const res1 = yield* requestInDirectory(route, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate, overwrite: true }),
        })
        expect(res1.status).toBe(200)

        const res2 = yield* requestInDirectory(route, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate, overwrite: false }),
        })
        expect(res2.status).toBe(409)
      }),
    { git: true },
  )

  it.instance(
    "delete removes a plugin asset",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "del-pl", description: "test", content: "kind: plugin\nname: del-pl\ndescription: test\nversion: 1.0.0\nhooks: []" }
        const applyRoute = PluginAssetApiGroup.PluginAssetPaths.apply.replace(":sessionID", "sess-3")

        const applyRes = yield* requestInDirectory(applyRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate, overwrite: true }),
        })
        expect(applyRes.status).toBe(200)
        const asset = (yield* applyRes.json) as unknown as { relativePath: string }

        const delRoute = PluginAssetApiGroup.PluginAssetPaths.delete.replace(":sessionID", "sess-3")
        const delRes = yield* requestInDirectory(delRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ relativePath: asset.relativePath }),
        })
        expect(delRes.status).toBe(200)

        const listRes = yield* requestInDirectory(PluginAssetApiGroup.PluginAssetPaths.list, t.directory)
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
        const delRoute = PluginAssetApiGroup.PluginAssetPaths.delete.replace(":sessionID", "sess-4")
        const delRes = yield* requestInDirectory(delRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ relativePath: ".aigcfroge/plugins/nope.plugin.yaml" }),
        })
        expect(delRes.status).toBe(400)
      }),
    { git: true },
  )

  it.instance(
    "apply returns 409 for stale baseRevision",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "stale-pl", description: "test", content: "kind: plugin\nname: stale-pl\ndescription: test\nversion: 1.0.0\nhooks: []" }
        const route = PluginAssetApiGroup.PluginAssetPaths.apply.replace(":sessionID", "sess-s1")

        const res1 = yield* requestInDirectory(route, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate, overwrite: true }),
        })
        expect(res1.status).toBe(200)
        const res2 = yield* requestInDirectory(route, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate, overwrite: true, baseRevision: "ab".repeat(32) }),
        })
        expect(res2.status).toBe(409)
      }),
    { git: true },
  )

  it.instance(
    "delete succeeds with correct baseRevision and rejects stale one",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const candidate = { name: "rev-pl", description: "test", content: "kind: plugin\nname: rev-pl\ndescription: test\nversion: 1.0.0\nhooks: []" }
        const applyRoute = PluginAssetApiGroup.PluginAssetPaths.apply.replace(":sessionID", "sess-s2")
        const delRoute = PluginAssetApiGroup.PluginAssetPaths.delete.replace(":sessionID", "sess-s2")

        const applyRes = yield* requestInDirectory(applyRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate, overwrite: true }),
        })
        expect(applyRes.status).toBe(200)
        const applied = Schema.decodeUnknownSync(AppliedInfo)(yield* applyRes.json)

        const okRes = yield* requestInDirectory(delRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ relativePath: applied.relativePath, baseRevision: applied.revision }),
        })
        expect(okRes.status).toBe(200)

        const reapply = yield* requestInDirectory(applyRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidate, overwrite: true }),
        })
        expect(reapply.status).toBe(200)
        const reapplied = Schema.decodeUnknownSync(AppliedInfo)(yield* reapply.json)
        const staleRes = yield* requestInDirectory(delRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ relativePath: reapplied.relativePath, baseRevision: "ab".repeat(32) }),
        })
        expect(staleRes.status).toBe(409)
      }),
    { git: true },
  )

  it.instance(
    "delete rejects path traversal and absolute paths",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const delRoute = PluginAssetApiGroup.PluginAssetPaths.delete.replace(":sessionID", "sess-s3")
        for (const relativePath of ["../escape.plugin.yaml", "sub/../../escape.plugin.yaml", "/etc/escape.plugin.yaml"]) {
          const res = yield* requestInDirectory(delRoute, t.directory, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ relativePath }),
          })
          expect(res.status).toBe(400)
        }
      }),
    { git: true },
  )

  it.instance(
    "delete rejects a symlink escaping the plugins root",
    () =>
      Effect.gen(function* () {
        const t = yield* TestInstance
        const plDir = path.join(t.directory, ".aigcfroge", "plugins")
        yield* Effect.promise(() => fs.mkdir(plDir, { recursive: true }))
        const outside = path.join(t.directory, "outside-target.plugin.yaml")
        yield* Effect.promise(() => fs.writeFile(outside, "kind: plugin\nname: outside\ndescription: t\nversion: 1.0.0\nhooks: []"))
        yield* Effect.promise(() => fs.symlink(outside, path.join(plDir, "evil.plugin.yaml")))

        const delRoute = PluginAssetApiGroup.PluginAssetPaths.delete.replace(":sessionID", "sess-s4")
        // relativePath is relative to the plugins root; the symlink must be
        // rejected by canonical containment, not by a not-found fallback.
        const res = yield* requestInDirectory(delRoute, t.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ relativePath: "evil.plugin.yaml" }),
        })
        expect(res.status).toBe(400)
        const body = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.String }))(yield* res.json)
        expect(body.message).toContain("escapes")
      }),
    { git: true },
  )
})
