import { describe, expect } from "bun:test"
import { Database } from "@aigcfroge/core/database/database"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { SessionExecution } from "@aigcfroge/core/session/execution"
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

const CODER_AGENT = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
const REVIEWER_AGENT = `---\nkind: agent\nname: reviewer\ndescription: Reviewer agent\n---\nYou review code.\n`

// Assigning undefined to process.env stores the string "undefined"; restore must delete instead.
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

function get(path: string, directory: string) {
  return requestInDirectory(path, directory, { headers: capableHeaders })
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

// AgentAsset caches the asset map when the location layer is built and only
// reloads on file-watcher events, so every agent file a test references must
// exist before the first request for the directory.
const writeAgentAssets = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(`${directory}/.aigcfroge/agents`, { recursive: true })
  yield* fs.writeFileString(`${directory}/.aigcfroge/agents/coder.md`, CODER_AGENT)
  yield* fs.writeFileString(`${directory}/.aigcfroge/agents/reviewer.md`, REVIEWER_AGENT)
})

const startCustom = Effect.fnUntraced(function* (directory: string) {
  const response = yield* post("/custom-composition/start", directory, {
    composition: composition("coder.md", revision(CODER_AGENT)),
  })
  if (response.status !== 200) throw new Error(`custom start failed: ${response.status} ${yield* response.text}`)
  return yield* Schema.decodeUnknownEffect(StartResponseJson)(yield* response.json)
})

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("Custom Composition Upgrade HttpApi", () => {
  it.instance(
    "upgrades an idle custom session into a new session and snapshot without mutating the source",
    () =>
      Effect.gen(function* () {
        yield* enableCustomMode
        const test = yield* TestInstance
        yield* writeAgentAssets(test.directory)
        const started = yield* startCustom(test.directory)

        const upgraded = yield* post("/custom-composition/upgrade", test.directory, {
          sessionID: started.session.id,
          composition: composition("reviewer.md", revision(REVIEWER_AGENT)),
          title: "Upgraded",
        })
        if (upgraded.status !== 200) throw new Error(`upgrade failed: ${upgraded.status} ${yield* upgraded.text}`)
        const body = yield* Schema.decodeUnknownEffect(StartResponseJson)(yield* upgraded.json)
        expect(body.session.id).not.toBe(started.session.id)
        expect(body.session.mode).toBe("custom")
        expect(body.session.title).toBe("Upgraded")
        expect(body.snapshot.digest).not.toBe(started.snapshot.digest)

        // The source session stays readable and untouched. Snapshot-row
        // immutability is covered at the domain level in
        // packages/core/test/custom-mode-upgrade.test.ts.
        const source = yield* get(`/api/session/${started.session.id}`, test.directory)
        expect(yield* source.json).toMatchObject({
          data: { mode: "custom", title: started.session.title },
        })
      }),
    { git: true },
  )

  it.instance("rejects upgrade without the custom capability header", () =>
    Effect.gen(function* () {
      yield* enableCustomMode
      const test = yield* TestInstance
      yield* writeAgentAssets(test.directory)
      const started = yield* startCustom(test.directory)

      const response = yield* post(
        "/custom-composition/upgrade",
        test.directory,
        { sessionID: started.session.id, composition: composition("coder.md", revision(CODER_AGENT)) },
        false,
      )
      expect(response.status).toBe(400)
      expect(yield* response.json).toMatchObject({
        _tag: "InvalidRequestError",
        message: expect.stringContaining(ProductModePolicy.CAPABILITY_CUSTOM_V1),
      })
    }),
  )

  it.instance("rejects upgrade for a non-custom source session", () =>
    Effect.gen(function* () {
      yield* enableCustomMode
      const test = yield* TestInstance
      yield* writeAgentAssets(test.directory)
      const chat = yield* Session.use.create({ title: "chat source", mode: "chat" })

      const response = yield* post("/custom-composition/upgrade", test.directory, {
        sessionID: chat.id,
        composition: composition("coder.md", revision(CODER_AGENT)),
      })
      expect(response.status).toBe(400)
      expect(yield* response.json).toMatchObject({
        _tag: "InvalidRequestError",
        message: expect.stringContaining('"chat"'),
      })
    }),
  )

  it.instance("rejects upgrade while the source session is busy", () =>
    Effect.gen(function* () {
      yield* enableCustomMode
      const test = yield* TestInstance
      yield* writeAgentAssets(test.directory)
      const started = yield* startCustom(test.directory)

      SessionExecution.setBusySeamForTesting((id) => id === started.session.id)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          SessionExecution.setBusySeamForTesting(undefined)
        }),
      )

      const response = yield* post("/custom-composition/upgrade", test.directory, {
        sessionID: started.session.id,
        composition: composition("coder.md", revision(CODER_AGENT)),
      })
      expect(response.status).toBe(409)
      expect(yield* response.json).toMatchObject({ _tag: "SessionBusyError", sessionID: started.session.id })
    }),
  )
})
