import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Hash } from "@aigcfroge/core/util/hash"
import { Database } from "@aigcfroge/core/database/database"
import { memoMap } from "@aigcfroge/core/effect/memo-map"
import { SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionMessage } from "@aigcfroge/core/session/message"
import * as SessionSchema from "@aigcfroge/core/session/schema"
import { CustomCompositionApiGroup } from "../../src/server/routes/instance/httpapi/groups/custom-composition"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.makeUnsafe<unknown>(new Map())

let savedCustomMode: string | undefined

// Branded at creation so every query site can use it directly — passing a bare string into
// `eq(SessionInputTable.id, ...)` does not typecheck (the column carries Brand<"Session.Message.ID">).
const newMessageID = (n: number) => SessionMessage.ID.make(`msg_${Date.now()}_${n}`)

// The tests run under `test/preload.ts` which sets AIGCFROGE_DB=":memory:". A bare
// `Effect.provide(Database.defaultLayer)` builds a fresh in-memory connection that can
// never see the writes the HttpApiApp graph made. Building the layer with the shared
// app `memoMap` instead reuses the HttpApiApp's connection so the assertions below
// observe the handler's durable writes.
const runDb = <A>(body: (db: Database.Interface["db"]) => Effect.Effect<A, never, never>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.scope
        const graph = yield* Layer.buildWithMemoMap(Database.defaultLayer, memoMap, scope)
        const { db } = Context.get(graph, Database.Service)
        return yield* body(db)
      }),
    ),
  )

const readInputRow = (id: SessionMessage.ID) =>
  runDb((db) => db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie))

const readSessionRow = (id: string) =>
  runDb((db) =>
    db
      .select()
      .from(SessionTable)
      .where(eq(SessionTable.id, SessionSchema.ID.make(id)))
      .get()
      .pipe(Effect.orDie),
  )

function request(route: string, directory: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-aigcfroge-directory", encodeURIComponent(directory))
  // Custom sessions gate on the capability header both at composition start
  // and at prompt_async (assertRuntimeSupported); without it the fixture never
  // reaches the assertions below.
  headers.set("x-aigcfroge-capabilities", "product-mode-custom-v1")
  if (!headers.has("content-type")) headers.set("content-type", "application/json")
  return HttpApiApp.webHandler().handler(new Request(`http://localhost${route}`, { ...init, headers }), context)
}

async function createCustomSession(directory: string) {
  const agentDir = path.join(directory, ".aigcfroge", "agents")
  await fs.mkdir(agentDir, { recursive: true })
  const agentRaw = `---\nkind: agent\nname: coder\ndescription: Coder\n---\nYou code.\n`
  await fs.writeFile(path.join(agentDir, "coder.md"), agentRaw)
  const agentRev = Hash.sha256(Buffer.from(agentRaw))
  const input = {
    source: "temporary",
    agents: [{ kind: "agent", relativePath: "coder.md", revision: agentRev }],
    bindings: { "agents/coder": { prompts: [], skills: [] } },
    presentation: "native",
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    requestedCapabilities: [] as string[],
  }
  // The request helper below sends the custom capability header, which both
  // composition start and prompt_async gate on for custom sessions.
  const res = await request(CustomCompositionApiGroup.CustomCompositionPaths.start, directory, {
    method: "POST",
    body: JSON.stringify({ composition: input }),
  })
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const body = (await res.json()) as { session: { id: string } }
  return body.session.id
}

beforeEach(() => {
  savedCustomMode = process.env["AIGCFROGE_CUSTOM_MODE"]
  process.env["AIGCFROGE_CUSTOM_MODE"] = "true"
})

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
  if (savedCustomMode === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
  else process.env["AIGCFROGE_CUSTOM_MODE"] = savedCustomMode
})

describe("P1-1 prompt_async V2 branch — HTTP + durable RED", () => {
  test("1. two text parts must both appear in session_input prompt", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionID = await createCustomSession(tmp.path)
    const messageID = newMessageID(1)
    const res = await request(`/session/${sessionID}/prompt_async`, tmp.path, {
      method: "POST",
      body: JSON.stringify({
        parts: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
        messageID,
      }),
    })
    expect(res.status).toBe(204)
    const row = await readInputRow(messageID)
    expect(row?.prompt).toBeDefined()
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const text = (row?.prompt as { text?: string })?.text ?? ""
    expect(text.includes("first")).toBe(true)
    expect(text.includes("second")).toBe(true)
  })

  test("2. explicit messageID must be stored as session_input.id", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionID = await createCustomSession(tmp.path)
    const messageID = newMessageID(2)
    const res = await request(`/session/${sessionID}/prompt_async`, tmp.path, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: "hello" }], messageID }),
    })
    expect(res.status).toBe(204)
    const row = await readInputRow(messageID)
    expect(row?.id).toBe(messageID)
  })

  test("3. model / agent / variant must be durable before wake", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionID = await createCustomSession(tmp.path)
    const messageID = newMessageID(3)
    const res = await request(`/session/${sessionID}/prompt_async`, tmp.path, {
      method: "POST",
      body: JSON.stringify({
        parts: [{ type: "text", text: "hello" }],
        messageID,
        model: { providerID: "test", modelID: "test-model" },
        agent: "coder",
        variant: "high",
      }),
    })
    expect(res.status).toBe(204)
    // Selection is NOT stored on session_input — that table has no agent/model/variant column
    // (core/src/session/sql.ts SessionInputTable). It lives on the session row: `agent` text plus
    // a `model` JSON column shaped { id, providerID, variant? } (sql.ts:57-61), so the request's
    // `modelID` lands in `model.id`. The V2 branch at handlers/session.ts:831 forwards only
    // `{ text: promptText }`, so all three are dropped — asserting the post-fix contract here is
    // what makes this a RED instead of a row-exists check.
    const session = await readSessionRow(sessionID)
    expect(session?.agent).toBe("coder")
    expect(session?.model?.providerID).toBe("test")
    expect(session?.model?.id).toBe("test-model")
    expect(session?.model?.variant).toBe("high")
  })

  test("4. pure attachment (no text, files non-empty) must admit, not 204 with zero rows", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionID = await createCustomSession(tmp.path)
    const messageID = newMessageID(4)
    const res = await request(`/session/${sessionID}/prompt_async`, tmp.path, {
      method: "POST",
      body: JSON.stringify({
        parts: [{ type: "text", text: "" }],
        files: [{ uri: "file:///tmp/a.txt", mime: "text/plain", name: "a.txt" }],
        messageID,
      }),
    })
    expect(res.status).toBe(204)
    const row = await readInputRow(messageID)
    expect(row).toBeDefined()
    expect(row?.id).toBe(messageID)
  })

  test("5. truly empty payload (no text, no attachment) must be typed 400, not 204", async () => {
    await using tmp = await tmpdir({ git: true })
    const sessionID = await createCustomSession(tmp.path)
    const res = await request(`/session/${sessionID}/prompt_async`, tmp.path, {
      method: "POST",
      body: JSON.stringify({ parts: [] }),
    })
    expect(res.status).toBe(400)
  })

  test("6. snapshot missing / conflict / mode disabled must not be 204", async () => {
    await using tmp = await tmpdir({ git: true })
    const missingSession = `ses_missing_${Date.now()}`
    const res = await request(`/session/${missingSession}/prompt_async`, tmp.path, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: "hi" }] }),
    })
    expect([400, 404, 409]).toContain(res.status)
    expect(res.status).not.toBe(204)
  })
})
