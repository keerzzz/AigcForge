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

const capableHeaders = { [ProductModePolicy.CAPABILITIES_HEADER]: ProductModePolicy.CAPABILITY_CUSTOM_V1 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Historical pre-M0 custom sessions only exist as stored rows: the generic
// creation path never writes mode=custom, so tests re-tag storage directly.
function markCustom(sessionID: Session.Info["id"]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, sessionID))
  })
}

function sessionRowsInDirectory(directory: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    return yield* db.select().from(SessionTable).where(eq(SessionTable.directory, directory)).all().pipe(Effect.orDie)
  })
}

describe("Session Fork ProductMode Gate", () => {
  it.instance("V1 POST /session/:id/fork rejects historical custom parents for every client", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const chat = yield* Session.use.create({ title: "chat parent", mode: "chat" })
      const custom = yield* Session.use.create({ title: "legacy custom parent" })
      yield* markCustom(custom.id)

      // Old client without the capability header: requireSession rejects the
      // custom parent before the fork logic runs.
      const noCap = yield* requestInDirectory(`/session/${custom.id}/fork`, test.directory, { method: "POST" })
      expect(noCap.status).toBe(400)
      expect(yield* noCap.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })

      // Capable client: the parent becomes visible, but the creation policy
      // still refuses to derive a new session from a custom parent.
      const capable = yield* requestInDirectory(`/session/${custom.id}/fork`, test.directory, {
        method: "POST",
        headers: capableHeaders,
      })
      expect(capable.status).toBe(400)
      expect(yield* capable.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })

      // Neither rejected fork may produce a session: the capable list holds
      // exactly the two parents, and storage holds exactly one custom row.
      const list = yield* requestInDirectory("/session", test.directory, { headers: capableHeaders })
      expect(list.status).toBe(200)
      const sessions = yield* list.json
      if (!Array.isArray(sessions)) throw new Error("Expected array list")
      const ids = sessions.filter(isRecord).map((session) => session.id)
      expect(ids).toHaveLength(2)
      expect(ids).toContain(chat.id)
      expect(ids).toContain(custom.id)
      const customRows = (yield* sessionRowsInDirectory(test.directory)).filter((row) => row.mode === "custom")
      expect(customRows.map((row) => row.id)).toEqual([custom.id])

      // Control: forking a normal chat parent still succeeds.
      const forked = yield* requestInDirectory(`/session/${chat.id}/fork`, test.directory, { method: "POST" })
      expect(forked.status).toBe(200)
      const forkedBody = yield* forked.json
      if (!isRecord(forkedBody) || typeof forkedBody.id !== "string") throw new Error("Expected session info")
      expect(forkedBody.id).not.toBe(chat.id)
      const after = yield* requestInDirectory("/session", test.directory, { headers: capableHeaders })
      const afterSessions = yield* after.json
      if (!Array.isArray(afterSessions)) throw new Error("Expected array list")
      expect(afterSessions.filter(isRecord).map((session) => session.id)).toContain(forkedBody.id)
    }),
  )

  it.instance(
    "V2 POST /api/session/:id/fork hides historical custom parents from old clients and rejects them for capable clients",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const custom = yield* Session.use.create({ title: "legacy custom parent" })
        yield* markCustom(custom.id)

        // Old client without the capability header: the custom parent is
        // invisible, indistinguishable from a missing session.
        const noCap = yield* requestInDirectory(`/api/session/${custom.id}/fork`, test.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
        expect(noCap.status).toBe(404)
        expect(yield* noCap.json).toMatchObject({ _tag: "SessionNotFoundError", sessionID: custom.id })

        // Capable client: the parent is visible, but the creation policy
        // refuses custom derivation with a typed 400.
        const capable = yield* requestInDirectory(`/api/session/${custom.id}/fork`, test.directory, {
          method: "POST",
          headers: { "content-type": "application/json", ...capableHeaders },
          body: JSON.stringify({}),
        })
        expect(capable.status).toBe(400)
        expect(yield* capable.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })

        // No forked child may be persisted by either attempt.
        expect(yield* sessionRowsInDirectory(test.directory)).toHaveLength(1)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "V2 POST /api/session rejects direct mode=custom creation with and without the capability",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const location = { directory: test.directory }

        // session.create runs assertCreationSupported before any visibility
        // check, so both old and capable clients get the same typed 400.
        const noCap = yield* requestInDirectory("/api/session", test.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "custom", location }),
        })
        expect(noCap.status).toBe(400)
        expect(yield* noCap.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })

        const capable = yield* requestInDirectory("/api/session", test.directory, {
          method: "POST",
          headers: { "content-type": "application/json", ...capableHeaders },
          body: JSON.stringify({ mode: "custom", location }),
        })
        expect(capable.status).toBe(400)
        expect(yield* capable.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })

        expect(yield* sessionRowsInDirectory(test.directory)).toHaveLength(0)

        // Control: supported modes still create through the same endpoint.
        const chat = yield* requestInDirectory("/api/session", test.directory, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "chat", location }),
        })
        expect(chat.status).toBe(200)
        expect(yield* chat.json).toMatchObject({ data: { mode: "chat" } })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
