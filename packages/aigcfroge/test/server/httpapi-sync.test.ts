import { afterEach, describe, expect, mock } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { Flag } from "@aigcfroge/core/flag/flag"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const originalWorkspaces = Flag.AIGCFROGE_EXPERIMENTAL_WORKSPACES
const originalWorkspaceID = Flag.AIGCFROGE_WORKSPACE_ID
const context = Context.empty() as Context.Context<unknown>
const it = testEffect(Layer.mergeAll(Session.defaultLayer, httpApiLayer))

afterEach(async () => {
  mock.restore()
  Flag.AIGCFROGE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  Flag.AIGCFROGE_WORKSPACE_ID = originalWorkspaceID
  await disposeAllInstances()
  await resetDatabase()
})

describe("sync HttpApi", () => {
  it.instance(
    "serves sync routes",
    () =>
      Effect.gen(function* () {
        Flag.AIGCFROGE_EXPERIMENTAL_WORKSPACES = true
        const tmp = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(tmp.directory),
          "content-type": "application/json",
        }
        const session = yield* Session.use.create({ title: "sync" })

        const started = yield* requestInDirectory(SyncPaths.start, tmp.directory, { method: "POST", headers })
        expect(started.status).toBe(200)
        expect(yield* started.json).toBe(true)

        const history = yield* requestInDirectory(SyncPaths.history, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        })
        expect(history.status).toBe(200)
        const rows = (yield* history.json) as Array<{
          id: string
          aggregate_id: string
          seq: number
          type: string
          data: Record<string, unknown>
        }>
        expect(rows.map((row) => row.aggregate_id)).toContain(session.id)

        const replayed = yield* requestInDirectory(SyncPaths.replay, tmp.directory, {
          method: "POST",
          headers,
          body: JSON.stringify({
            directory: tmp.directory,
            events: rows
              .filter((row) => row.aggregate_id === session.id)
              .map((row) => ({
                id: row.id,
                aggregateID: row.aggregate_id,
                seq: row.seq,
                type: row.type,
                data: row.data,
              })),
          }),
        })
        expect(replayed.status).toBe(200)
        expect(yield* replayed.json).toEqual({ sessionID: session.id })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "validates seq values",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const headers = {
          "x-aigcfroge-directory": encodeURIComponent(tmp.directory),
          "content-type": "application/json",
        }
        const cases = [
          {
            path: SyncPaths.history,
            body: { aggregate: -1 },
          },
          {
            path: SyncPaths.history,
            body: { aggregate: 1.5 },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: -1, type: "session.created", data: {} }],
            },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: 1.5, type: "session.created", data: {} }],
            },
          },
          {
            path: SyncPaths.replay,
            body: {
              directory: tmp.directory,
              events: [{ id: "event", aggregateID: "session", seq: 0, type: "session.created", data: {} }],
            },
          },
        ]

        for (const item of cases) {
          const response = yield* requestInDirectory(item.path, tmp.directory, {
            method: "POST",
            headers,
            body: JSON.stringify(item.body),
          })
          expect(response.status).toBe(400)
        }
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "returns structured validation errors",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* Effect.promise(() =>
          HttpApiApp.webHandler().handler(
            new Request(`http://localhost${SyncPaths.history}`, {
              method: "POST",
              headers: {
                "x-aigcfroge-directory": encodeURIComponent(tmp.directory),
                "content-type": "application/json",
              },
              body: JSON.stringify({ aggregate: -1 }),
            }),
            context,
          ),
        )

        expect(response.status).toBe(400)
        expect(response.headers.get("content-type") ?? "").toContain("application/json")
        const body: unknown = yield* Effect.tryPromise(() => response.json())
        expect(body).toMatchObject({
          name: "BadRequest",
          data: { kind: "Payload", message: expect.stringContaining("aggregate") },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
  it.instance(
    "rejects a malformed steal session ID with the validation envelope",
    () =>
      Effect.gen(function* () {
        const tmp = yield* TestInstance
        const response = yield* requestInDirectory(SyncPaths.steal, tmp.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionID: "invalid" }),
        })
        expect(response.status).toBe(400)
        expect(response.headers["content-type"] ?? "").toContain("application/json")
        expect(yield* response.json).toMatchObject({
          name: "BadRequest",
          data: { kind: "Payload", message: expect.stringContaining("sessionID") },
        })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "preserves the built-in BadRequest response when steal has no workspace",
    () =>
      Effect.gen(function* () {
        const previous = Flag.AIGCFROGE_WORKSPACE_ID
        Flag.AIGCFROGE_WORKSPACE_ID = undefined
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            Flag.AIGCFROGE_WORKSPACE_ID = previous
          }),
        )
        const tmp = yield* TestInstance
        const response = yield* requestInDirectory(SyncPaths.steal, tmp.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionID: "ses_no_workspace" }),
        })
        expect(response.status).toBe(400)
        expect(response.headers["content-type"] ?? "").toContain("application/json")
        expect(yield* response.json).toEqual({ _tag: "BadRequest" })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
