import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { Database } from "@aigcfroge/core/database/database"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { eq } from "drizzle-orm"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { TestInstance } from "../fixture/fixture"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer, httpApiLayer))

type Endpoint = {
  readonly name: string
  readonly method: "GET" | "POST"
  readonly path: (sessionID: string) => string
  readonly body?: (targetSessionID: string) => unknown
  // Runtime endpoints stay rejected (400 UnsupportedProductModeError) even for
  // capable clients in M0; read endpoints are served to capable clients.
  readonly runtime: boolean
}

// The full V2 session surface from packages/server/src/groups/session.ts, with
// minimal schema-valid payloads. Note: children/context look read-shaped but
// are implemented via requireRuntimeSession (packages/server/src/handlers/session.ts),
// so they are gated as runtime operations here; only session.get is a pure read.
const endpoints: Endpoint[] = [
  { name: "session.get", method: "GET", path: (id) => `/api/session/${id}`, runtime: false },
  { name: "session.children", method: "GET", path: (id) => `/api/session/${id}/children`, runtime: true },
  { name: "session.context", method: "GET", path: (id) => `/api/session/${id}/context`, runtime: true },
  {
    name: "session.prompt",
    method: "POST",
    path: (id) => `/api/session/${id}/prompt`,
    body: () => ({ prompt: { text: "hello" }, resume: false }),
    runtime: true,
  },
  {
    name: "session.switchAgent",
    method: "POST",
    path: (id) => `/api/session/${id}/agent`,
    body: () => ({ agent: "build" }),
    runtime: true,
  },
  {
    name: "session.switchModel",
    method: "POST",
    path: (id) => `/api/session/${id}/model`,
    body: () => ({ model: { id: "test-model", providerID: "test" } }),
    runtime: true,
  },
  { name: "session.compact", method: "POST", path: (id) => `/api/session/${id}/compact`, runtime: true },
  { name: "session.wait", method: "POST", path: (id) => `/api/session/${id}/wait`, runtime: true },
  { name: "session.interrupt", method: "POST", path: (id) => `/api/session/${id}/interrupt`, runtime: true },
  {
    name: "session.shell",
    method: "POST",
    path: (id) => `/api/session/${id}/shell`,
    body: () => ({ command: "echo hi", resume: false }),
    runtime: true,
  },
  {
    name: "session.skill",
    method: "POST",
    path: (id) => `/api/session/${id}/skill`,
    body: () => ({ skill: "review", resume: false }),
    runtime: true,
  },
  {
    name: "session.share",
    method: "POST",
    path: (id) => `/api/session/${id}/share`,
    body: (targetSessionID) => ({ targetSessionID, scope: "reference" }),
    runtime: true,
  },
  {
    name: "session.fork",
    method: "POST",
    path: (id) => `/api/session/${id}/fork`,
    body: () => ({}),
    runtime: true,
  },
]

function callEndpoint(
  endpoint: Endpoint,
  input: { sessionID: string; targetSessionID: string; directory: string; capable: boolean },
) {
  const headers = new Headers()
  if (input.capable) headers.set(ProductModePolicy.CAPABILITIES_HEADER, ProductModePolicy.CAPABILITY_CUSTOM_V1)
  const body = endpoint.body?.(input.targetSessionID)
  if (body !== undefined) headers.set("content-type", "application/json")
  return requestInDirectory(endpoint.path(input.sessionID), input.directory, {
    method: endpoint.method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

// Historical pre-M0 custom sessions only exist as stored rows: the generic
// creation path never writes mode=custom, so tests re-tag storage directly.
function markCustom(sessionID: Session.Info["id"]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, sessionID))
  })
}

describe("V2 Session Capability Matrix", () => {
  it.instance(
    "endpoints hide historical custom sessions from clients without the custom capability",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const target = yield* Session.use.create({ title: "share target" })
        const custom = yield* Session.use.create({ title: "legacy custom" })
        yield* markCustom(custom.id)

        // Every endpoint must answer 404 SessionNotFoundError — the exact-status
        // assertions double as the guard that no endpoint leaks a 500.
        for (const endpoint of endpoints) {
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
        }
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "runtime endpoints reject custom sessions with UnsupportedProductModeError for capable clients",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const target = yield* Session.use.create({ title: "share target" })
        const custom = yield* Session.use.create({ title: "legacy custom" })
        yield* markCustom(custom.id)

        for (const endpoint of endpoints) {
          const response = yield* callEndpoint(endpoint, {
            sessionID: custom.id,
            targetSessionID: target.id,
            directory: test.directory,
            capable: true,
          })
          // session.get is the only pure read: capable clients may see the session.
          if (!endpoint.runtime) {
            expect({ endpoint: endpoint.name, status: response.status, body: yield* response.json }).toMatchObject({
              endpoint: endpoint.name,
              status: 200,
              body: { data: { id: custom.id, mode: "custom" } },
            })
            continue
          }
          expect({ endpoint: endpoint.name, status: response.status, body: yield* response.json }).toMatchObject({
            endpoint: endpoint.name,
            status: 400,
            body: { _tag: "UnsupportedProductModeError", mode: "custom" },
          })
        }
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "endpoints keep serving chat sessions to clients without the capability",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const chat = yield* Session.use.create({ title: "chat control", mode: "chat" })

        const get = yield* requestInDirectory(`/api/session/${chat.id}`, test.directory)
        expect(get.status).toBe(200)
        expect(yield* get.json).toMatchObject({ data: { id: chat.id, mode: "chat" } })

        const children = yield* requestInDirectory(`/api/session/${chat.id}/children`, test.directory)
        expect(children.status).toBe(200)
        expect(yield* children.json).toMatchObject({ data: [] })

        // resume:false admits the input without scheduling model execution, so
        // no LLM is needed for the control.
        const prompt = yield* requestInDirectory(`/api/session/${chat.id}/prompt`, test.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: { text: "hello" }, resume: false }),
        })
        expect(prompt.status).toBe(200)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
