import { afterEach, describe, expect } from "bun:test"
import { CliDiscovery } from "@aigcfroge/core/tool/cli-discovery"
import { Location } from "@aigcfroge/core/location"
import { Effect, Schema } from "effect"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(httpApiLayer)
const AgentCliResponse = Location.response(Schema.Array(CliDiscovery.Info))

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("agent.cli HttpApi", () => {
  it.instance(
    "serves the registered CLI adapters through the real Location-wrapped route",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance

        const response = yield* requestInDirectory("/api/agent/cli", instance.directory)
        expect(response.status).toBe(200)

        const body = Schema.decodeUnknownSync(AgentCliResponse)(yield* response.json)
        expect(body.location).toMatchObject({ directory: instance.directory })
        expect(body.location.project.id).toBeTruthy()

        const names = body.data.map((entry) => entry.name)
        expect(names).toEqual(expect.arrayContaining(["claude-code", "codex", "gemini", "opencode"]))

        // Exercise the real route and registry rather than mocking the handler.
        const expected = yield* CliDiscovery.list()
        expect(body.data).toEqual(expected)
      }),
    { git: true },
  )
})
