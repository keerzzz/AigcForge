import { describe, expect } from "bun:test"
import { Database } from "@aigcfroge/core/database/database"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionCompositionSnapshotTable, SessionTable } from "@aigcfroge/core/session/sql"
import { Hash } from "@aigcfroge/core/util/hash"
import { Composition } from "@aigcfroge/schema/composition"
import { eq } from "drizzle-orm"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { Session } from "@/session/session"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer, httpApiLayer))
const capableHeaders = { [ProductModePolicy.CAPABILITIES_HEADER]: ProductModePolicy.CAPABILITY_CUSTOM_V1 }
const CustomCreateResponse = Schema.toCodecJson(
  Schema.Struct({
    data: SessionV2.Info,
    snapshot: Composition.Snapshot,
  }),
)
const ForkResponse = Schema.Struct({ sessionID: SessionV2.ID })

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

const disableCustomMode = Effect.gen(function* () {
  const saved = process.env["AIGCFROGE_CUSTOM_MODE"]
  delete process.env["AIGCFROGE_CUSTOM_MODE"]
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (saved === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
      else process.env["AIGCFROGE_CUSTOM_MODE"] = saved
    }),
  )
})

const endpoints = [
  { name: "session.get", method: "GET", path: (id: string) => `/api/session/${id}`, kind: "read" },
  { name: "session.children", method: "GET", path: (id: string) => `/api/session/${id}/children`, kind: "read" },
  { name: "session.context", method: "GET", path: (id: string) => `/api/session/${id}/context`, kind: "read" },
  {
    name: "session.prompt",
    method: "POST",
    path: (id: string) => `/api/session/${id}/prompt`,
    body: () => ({ prompt: { text: "hello" }, resume: false }),
    kind: "admission",
  },
  {
    name: "session.shell",
    method: "POST",
    path: (id: string) => `/api/session/${id}/shell`,
    body: () => ({ command: "echo hi", resume: false }),
    kind: "admission",
  },
  {
    name: "session.skill",
    method: "POST",
    path: (id: string) => `/api/session/${id}/skill`,
    body: () => ({ skill: "review", resume: false }),
    kind: "admission",
  },
  {
    name: "session.switchAgent",
    method: "POST",
    path: (id: string) => `/api/session/${id}/agent`,
    body: () => ({ agent: "build" }),
    kind: "control",
  },
  {
    name: "session.switchModel",
    method: "POST",
    path: (id: string) => `/api/session/${id}/model`,
    body: () => ({ model: { id: "test-model", providerID: "test" } }),
    kind: "control",
  },
  { name: "session.compact", method: "POST", path: (id: string) => `/api/session/${id}/compact`, body: () => ({}), kind: "control" },
  { name: "session.wait", method: "POST", path: (id: string) => `/api/session/${id}/wait`, body: () => ({}), kind: "control" },
  { name: "session.interrupt", method: "POST", path: (id: string) => `/api/session/${id}/interrupt`, body: () => ({}), kind: "control" },
  {
    name: "session.share",
    method: "POST",
    path: (id: string) => `/api/session/${id}/share`,
    body: (targetID: string) => ({ targetSessionID: targetID, scope: "reference" }),
    kind: "control",
  },
  { name: "session.fork", method: "POST", path: (id: string) => `/api/session/${id}/fork`, body: () => ({}), kind: "fork" },
] as const

function callEndpoint(
  endpoint: (typeof endpoints)[number],
  input: { sessionID: string; targetSessionID: string; directory: string; capable: boolean },
) {
  const body = "body" in endpoint ? endpoint.body(input.targetSessionID) : undefined
  return requestInDirectory(endpoint.path(input.sessionID), input.directory, {
    method: endpoint.method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.capable ? capableHeaders : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function post(path: string, directory: string, body: unknown, capable = true) {
  return requestInDirectory(path, directory, {
    method: "POST",
    headers: { "content-type": "application/json", ...(capable ? capableHeaders : {}) },
    body: JSON.stringify(body),
  })
}

function markCustom(sessionID: Session.Info["id"]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, sessionID))
  })
}

const createRealCustom = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const assetDirectory = `${directory}/.aigcfroge/agents`
  yield* fs.makeDirectory(assetDirectory, { recursive: true })
  const asset = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
  yield* fs.writeFileString(`${assetDirectory}/coder.md`, asset)

  const response = yield* post(`/api/session/custom`, directory, {
    composition: {
      source: "temporary",
      agents: [{ kind: "agent", relativePath: "coder.md", revision: Hash.sha256(Buffer.from(asset)) }],
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
    },
    location: { directory },
    title: "capability matrix custom",
  })
  expect(response.status).toBe(200)
  return yield* Schema.decodeUnknownEffect(CustomCreateResponse)(yield* response.json)
})

describe("V2 Session Capability Matrix", () => {
  it.instance(
    "hides every custom-session endpoint from clients without the custom capability",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const target = yield* Session.use.create({ title: "share target" })
        const custom = yield* Session.use.create({ title: "legacy custom" })
        yield* markCustom(custom.id)

        yield* Effect.forEach(endpoints, (endpoint) => Effect.gen(function* () {
          const response = yield* callEndpoint(endpoint, {
            sessionID: custom.id,
            targetSessionID: target.id,
            directory: test.directory,
            capable: false,
          })
          expect({ endpoint: endpoint.name, status: response.status, body: yield* response.json }).toMatchObject({
            endpoint: endpoint.name,
            status: 404,
            body: { _tag: "SessionNotFoundError", sessionID: custom.id },
          })
        }))
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves orphan custom reads but fails closed for admissions, controls, and fork",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const target = yield* Session.use.create({ title: "share target" })
        const custom = yield* Session.use.create({ title: "legacy custom" })
        yield* markCustom(custom.id)

        yield* Effect.forEach(endpoints, (endpoint) => Effect.gen(function* () {
          const response = yield* callEndpoint(endpoint, {
            sessionID: custom.id,
            targetSessionID: target.id,
            directory: test.directory,
            capable: true,
          })
          const body = yield* response.json

          if (endpoint.kind === "read") {
            expect({ endpoint: endpoint.name, status: response.status }).toEqual({ endpoint: endpoint.name, status: 200 })
            if (endpoint.name === "session.get") expect(body).toMatchObject({ data: { id: custom.id, mode: "custom" } })
            if (endpoint.name !== "session.get") expect(body).toEqual({ data: [] })
            return
          }
          if (endpoint.kind === "admission") {
            expect({ endpoint: endpoint.name, status: response.status, body }).toMatchObject({
              endpoint: endpoint.name,
              status: 404,
              body: { _tag: "SessionNotFoundError", sessionID: custom.id },
            })
            return
          }
          if (endpoint.kind === "control") {
            expect({ endpoint: endpoint.name, status: response.status, body }).toMatchObject({
              endpoint: endpoint.name,
              status: 400,
              body: { _tag: "UnsupportedProductModeError", mode: "custom" },
            })
            return
          }
          expect({ endpoint: endpoint.name, status: response.status, body }).toMatchObject({
            endpoint: endpoint.name,
            status: 400,
            body: { _tag: "InvalidRequestError" },
          })
        }))
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "creates real custom sessions only for capable clients and preserves snapshots across fork",
    () =>
      Effect.gen(function* () {
        yield* enableCustomMode
        const test = yield* TestInstance
        const fs = yield* FileSystem.FileSystem
        const assetDirectory = `${test.directory}/.aigcfroge/agents`
        yield* fs.makeDirectory(assetDirectory, { recursive: true })
        const asset = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
        yield* fs.writeFileString(`${assetDirectory}/coder.md`, asset)
        const payload = {
          composition: {
            source: "temporary",
            agents: [{ kind: "agent", relativePath: "coder.md", revision: Hash.sha256(Buffer.from(asset)) }],
            bindings: {},
            presentation: "native",
            requestedCapabilities: [],
          },
          location: { directory: test.directory },
        }

        const rejected = yield* post("/api/session/custom", test.directory, payload, false)
        expect(rejected.status).toBe(400)
        expect(yield* rejected.json).toMatchObject({ _tag: "InvalidRequestError", message: expect.stringContaining(ProductModePolicy.CAPABILITY_CUSTOM_V1) })

        const created = yield* createRealCustom(test.directory)
        expect(created.data).toMatchObject({ mode: "custom", agent: "meta" })

        const children = yield* requestInDirectory(`/api/session/${created.data.id}/children`, test.directory, { headers: capableHeaders })
        expect(children.status).toBe(200)
        expect(yield* children.json).toEqual({ data: [] })

        const context = yield* requestInDirectory(`/api/session/${created.data.id}/context`, test.directory, { headers: capableHeaders })
        expect(context.status).toBe(200)
        expect(yield* context.json).toEqual({ data: [] })

        const prompt = yield* post(`/api/session/${created.data.id}/prompt`, test.directory, { prompt: { text: "hello" }, resume: false })
        expect(prompt.status).toBe(200)
        expect(yield* prompt.json).toMatchObject({ data: { kind: "prompt", sessionID: created.data.id } })

        const fork = yield* post(`/api/session/${created.data.id}/fork`, test.directory, {})
        expect(fork.status).toBe(200)
        const forkBody = yield* Schema.decodeUnknownEffect(ForkResponse)(yield* fork.json)
        const child = yield* requestInDirectory(`/api/session/${forkBody.sessionID}`, test.directory, { headers: capableHeaders })
        expect(child.status).toBe(200)
        expect(yield* child.json).toMatchObject({ data: { id: forkBody.sessionID, parentID: created.data.id, mode: "custom" } })

        const { db } = yield* Database.Service
        const snapshots = yield* db
          .select({ sessionID: SessionCompositionSnapshotTable.session_id, digest: SessionCompositionSnapshotTable.digest })
          .from(SessionCompositionSnapshotTable)
          .where(eq(SessionCompositionSnapshotTable.digest, created.snapshot.digest))
          .all()
          .pipe(Effect.orDie)
        expect(snapshots.map((snapshot) => snapshot.sessionID).sort()).toEqual([created.data.id, forkBody.sessionID].sort())
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects the V1 sync prompt, command, and shell endpoints for custom sessions",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const custom = yield* Session.use.create({ title: "legacy custom" })
        yield* markCustom(custom.id)
        const requests = [
          post(`/session/${custom.id}/message`, test.directory, { parts: [{ type: "text", text: "hello" }] }),
          post(`/session/${custom.id}/command`, test.directory, { command: "init", arguments: "" }),
          post(`/session/${custom.id}/shell`, test.directory, { agent: "build", command: "echo hi" }),
        ]

        yield* Effect.forEach(requests, (request) => Effect.gen(function* () {
          const response = yield* request
          expect(response.status).toBe(400)
          expect(yield* response.json).toMatchObject({
            _tag: "UnsupportedProductModeError",
            mode: "custom",
            message: expect.stringContaining("V2-native"),
          })
        }))
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "keeps serving chat sessions to clients without the capability",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const chat = yield* Session.use.create({ title: "chat control", mode: "chat" })
        const get = yield* requestInDirectory(`/api/session/${chat.id}`, test.directory)
        expect(get.status).toBe(200)
        expect(yield* get.json).toMatchObject({ data: { id: chat.id, mode: "chat" } })
        const prompt = yield* post(`/api/session/${chat.id}/prompt`, test.directory, { prompt: { text: "hello" }, resume: false }, false)
        expect(prompt.status).toBe(200)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "rejects plan, start, upgrade, and session.custom with 400 when custom mode flag is disabled",
    () =>
      Effect.gen(function* () {
        yield* disableCustomMode
        const test = yield* TestInstance
        const fs = yield* FileSystem.FileSystem
        const assetDirectory = `${test.directory}/.aigcfroge/agents`
        yield* fs.makeDirectory(assetDirectory, { recursive: true })
        const asset = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
        yield* fs.writeFileString(`${assetDirectory}/coder.md`, asset)

        const comp = {
          source: "temporary",
          agents: [{ kind: "agent", relativePath: "coder.md", revision: Hash.sha256(Buffer.from(asset)) }],
          bindings: {},
          presentation: "native",
          requestedCapabilities: [],
        }

        // 1. plan
        const planRes = yield* post("/custom-composition/plan", test.directory, comp, true)
        expect(planRes.status).toBe(400)
        expect(yield* planRes.json).toMatchObject({
          _tag: "InvalidRequestError",
          message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
        })

        // 2. start
        const startRes = yield* post("/custom-composition/start", test.directory, { composition: comp }, true)
        expect(startRes.status).toBe(400)
        expect(yield* startRes.json).toMatchObject({
          _tag: "InvalidRequestError",
          message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
        })

        // 3. upgrade
        const upgradeRes = yield* post(
          "/custom-composition/upgrade",
          test.directory,
          { sessionID: "ses_any", composition: comp },
          true,
        )
        expect(upgradeRes.status).toBe(400)
        expect(yield* upgradeRes.json).toMatchObject({
          _tag: "InvalidRequestError",
          message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
        })

        // 4. session.custom
        const sessionCustomRes = yield* post(
          "/api/session/custom",
          test.directory,
          { composition: comp, location: { directory: test.directory } },
          true,
        )
        expect(sessionCustomRes.status).toBe(400)
        expect(yield* sessionCustomRes.json).toMatchObject({
          _tag: "InvalidRequestError",
          message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "serves existing custom session get, children, and context when custom mode flag is disabled (history readable)",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const fs = yield* FileSystem.FileSystem
        const assetDirectory = `${test.directory}/.aigcfroge/agents`
        yield* fs.makeDirectory(assetDirectory, { recursive: true })
        const asset = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
        yield* fs.writeFileString(`${assetDirectory}/coder.md`, asset)

        // Create with flag enabled
        yield* enableCustomMode
        const created = yield* createRealCustom(test.directory)

        // Turn flag off
        yield* disableCustomMode

        // Existing session reads must still succeed (history readable)
        const get = yield* requestInDirectory(`/api/session/${created.data.id}`, test.directory, {
          headers: capableHeaders,
        })
        expect(get.status).toBe(200)
        expect(yield* get.json).toMatchObject({ data: { id: created.data.id, mode: "custom" } })

        const children = yield* requestInDirectory(
          `/api/session/${created.data.id}/children`,
          test.directory,
          { headers: capableHeaders },
        )
        expect(children.status).toBe(200)
        expect(yield* children.json).toEqual({ data: [] })

        const context = yield* requestInDirectory(
          `/api/session/${created.data.id}/context`,
          test.directory,
          { headers: capableHeaders },
        )
        expect(context.status).toBe(200)
        expect(yield* context.json).toEqual({ data: [] })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
