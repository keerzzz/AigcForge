import { afterAll, afterEach, beforeEach, describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { AgentAssetApiGroup } from "../../src/server/routes/instance/httpapi/groups/agent-asset"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(httpApiLayer))
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

function post(route: string, directory: string, body: Record<string, unknown>) {
  return requestInDirectory(route, directory, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("agent asset HttpApi", () => {
  it.instance(
    "returns apply warnings separately and keeps content response warning-free",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const route = AgentAssetApiGroup.AgentAssetPaths.apply.replace(":sessionID", "ses-agent-asset")
        const candidate = {
          name: "reviewer",
          description: "Code reviewer",
          config: 'permissions:\n  - action: "*"\n    resource: "*"\n    effect: allow',
          source: "Review carefully.",
          relativePath: "",
        }

        const applyResponse = yield* post(route, instance.directory, { candidate, overwrite: true })
        expect(applyResponse.status).toBe(200)
        const applied = Schema.decodeUnknownSync(
          Schema.Struct({
            asset: Schema.Struct({
              kind: Schema.String,
              name: Schema.String,
              config: Schema.String,
              source: Schema.String,
              relativePath: Schema.String,
            }),
            warnings: Schema.Array(
              Schema.Struct({ code: Schema.String, action: Schema.String, resource: Schema.String }),
            ),
          }),
        )(yield* applyResponse.json)
        expect(applied.asset).toMatchObject({
          kind: "agent",
          name: "reviewer",
          config: candidate.config,
          source: candidate.source,
        })
        expect(applied.warnings).toEqual([{ code: "wildcard_allow", action: "*", resource: "*" }])

        const contentResponse = yield* requestInDirectory(
          `${AgentAssetApiGroup.AgentAssetPaths.content}?path=${encodeURIComponent(applied.asset.relativePath)}`,
          instance.directory,
        )
        expect(contentResponse.status).toBe(200)
        const content = Schema.decodeUnknownSync(
          Schema.Struct({
            kind: Schema.String,
            name: Schema.String,
            description: Schema.String,
            config: Schema.String,
            source: Schema.String,
            relativePath: Schema.String,
            revision: Schema.String,
          }),
        )(yield* contentResponse.json)
        expect(content).toMatchObject({
          kind: "agent",
          name: "reviewer",
          config: candidate.config,
          source: candidate.source,
        })
        expect(Object.hasOwn(content, "warnings")).toBe(false)
      }),
    { git: true },
  )
})
