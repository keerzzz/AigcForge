import { describe, expect } from "bun:test"
import { Database } from "@aigcfroge/core/database/database"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Hash } from "@aigcfroge/core/util/hash"
import { Composition } from "@aigcfroge/schema/composition"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { Session } from "@/session/session"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer, httpApiLayer))
const capableHeaders = { [ProductModePolicy.CAPABILITIES_HEADER]: ProductModePolicy.CAPABILITY_CUSTOM_V1 }
const StartResponseJson = Schema.toCodecJson(Composition.StartResponse)
const PlanJson = Schema.toCodecJson(Composition.Plan)

const CODER_AGENT = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
const REVIEWER_AGENT = `---\nkind: agent\nname: reviewer\ndescription: Reviewer agent\n---\nYou review code.\n`

const enableCustomMode = Effect.gen(function* () {
  const saved = process.env["AIGCFROGE_CUSTOM_MODE"]
  process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (saved === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
      else process.env["AIGCFROGE_CUSTOM_MODE"] = saved
    }),
  )
})

function post(path: string, directory: string, body: unknown, capable = true) {
  return requestInDirectory(path, directory, {
    method: "POST",
    headers: { "content-type": "application/json", ...(capable ? capableHeaders : {}) },
    body: JSON.stringify(body),
  })
}

function composition(relativePath: string, revision: string) {
  return {
    source: "temporary",
    agents: [{ kind: "agent", relativePath, revision }],
    bindings: {},
    presentation: "native",
    requestedCapabilities: [],
  }
}

const revision = (content: string) => Hash.sha256(Buffer.from(content))

const writeAgentAssets = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(`${directory}/.aigcfroge/agents`, { recursive: true })
  yield* fs.writeFileString(`${directory}/.aigcfroge/agents/coder.md`, CODER_AGENT)
  yield* fs.writeFileString(`${directory}/.aigcfroge/agents/reviewer.md`, REVIEWER_AGENT)
})

describe("Custom Composition 50-Round Stability & Determinism Matrix", () => {
  it.instance("runs 50 rounds of plan digest resolution with deterministic consistency", () =>
    Effect.gen(function* () {
      yield* enableCustomMode
      const test = yield* TestInstance
      yield* writeAgentAssets(test.directory)

      const comp = composition("coder.md", revision(CODER_AGENT))
      let firstDigest: string | undefined

      const memStart = process.memoryUsage()

      for (let i = 0; i < 50; i++) {
        const res = yield* post("/custom-composition/plan", test.directory, comp)
        expect(res.status).toBe(200)
        const plan = yield* Schema.decodeUnknownEffect(PlanJson)(yield* res.json)
        expect(plan.valid).toBe(true)
        expect(plan.digest).toBeDefined()

        if (firstDigest === undefined) {
          firstDigest = String(plan.digest)
        } else {
          expect(String(plan.digest)).toBe(firstDigest)
        }
      }

      if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
        Bun.gc(true)
      }
      const memEnd = process.memoryUsage()
      const heapGrowthMb = (memEnd.heapUsed - memStart.heapUsed) / (1024 * 1024)
      // Memory growth across 50 plan rounds should remain strictly bounded (< 250MB)
      expect(heapGrowthMb).toBeLessThan(250)
      expect(firstDigest).toBeDefined()
    }),
  )

  it.instance("runs 50 rounds of start and upgrade transitions with 100% success and bounded memory", () =>
    Effect.gen(function* () {
      yield* enableCustomMode
      const test = yield* TestInstance
      yield* writeAgentAssets(test.directory)

      if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
        Bun.gc(true)
      }
      const memStart = process.memoryUsage()

      const startRes = yield* post("/custom-composition/start", test.directory, {
        composition: composition("coder.md", revision(CODER_AGENT)),
      })
      expect(startRes.status).toBe(200)
      const started = yield* Schema.decodeUnknownEffect(StartResponseJson)(yield* startRes.json)
      let currentSessionID = started.session.id

      for (let round = 1; round <= 50; round++) {
        const isCoder = round % 2 === 1
        const agentFile = isCoder ? "reviewer.md" : "coder.md"
        const agentContent = isCoder ? REVIEWER_AGENT : CODER_AGENT

        const upgradeRes = yield* post("/custom-composition/upgrade", test.directory, {
          sessionID: currentSessionID,
          composition: composition(agentFile, revision(agentContent)),
        })
        expect(upgradeRes.status).toBe(200)
        const upgraded = yield* Schema.decodeUnknownEffect(StartResponseJson)(yield* upgradeRes.json)
        expect(upgraded.session.id).toBeDefined()
        expect(upgraded.session.id).not.toBe(currentSessionID)
        currentSessionID = upgraded.session.id
      }

      if (typeof Bun !== "undefined" && typeof Bun.gc === "function") {
        Bun.gc(true)
      }
      const memEnd = process.memoryUsage()
      const heapGrowthMb = (memEnd.heapUsed - memStart.heapUsed) / (1024 * 1024)
      // Memory growth across 50 start/upgrade transitions should remain strictly bounded (< 250MB)
      expect(heapGrowthMb).toBeLessThan(250)
    }),
  )
})
