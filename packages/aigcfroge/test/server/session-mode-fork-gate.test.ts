import { describe, expect } from "bun:test"
import { Database } from "@aigcfroge/core/database/database"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionCompositionSnapshotTable, SessionTable } from "@aigcfroge/core/session/sql"
import { Hash } from "@aigcfroge/core/util/hash"
import { SessionV1 } from "@aigcfroge/core/v1/session"
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

function post(path: string, directory: string, body?: unknown, capable = false) {
  return requestInDirectory(path, directory, {
    method: "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(capable ? capableHeaders : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function markCustom(sessionID: Session.Info["id"]) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.update(SessionTable).set({ mode: "custom" }).where(eq(SessionTable.id, sessionID))
  })
}

const prepareCustomAsset = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem
  const assetDirectory = `${directory}/.aigcfroge/agents`
  const asset = `---\nkind: agent\nname: coder\ndescription: Coder agent\n---\nYou write code.\n`
  yield* fs.makeDirectory(assetDirectory, { recursive: true })
  yield* fs.writeFileString(`${assetDirectory}/coder.md`, asset)
  return asset
})

const createRealCustom = Effect.fnUntraced(function* (directory: string, asset: string) {
  const response = yield* post(
    "/api/session/custom",
    directory,
    {
      composition: {
        source: "temporary",
        agents: [{ kind: "agent", relativePath: "coder.md", revision: Hash.sha256(Buffer.from(asset)) }],
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      },
      location: { directory },
    },
    true,
  )
  if (response.status !== 200) throw new Error(`custom create failed: ${response.status} ${yield* response.text}`)
  return yield* Schema.decodeUnknownEffect(CustomCreateResponse)(yield* response.json)
})

const assertSnapshotCopied = Effect.fnUntraced(function* (
  parentID: Session.Info["id"],
  childID: Session.Info["id"],
  digest: string,
) {
  const { db } = yield* Database.Service
  const snapshots = yield* db
    .select({ sessionID: SessionCompositionSnapshotTable.session_id })
    .from(SessionCompositionSnapshotTable)
    .where(eq(SessionCompositionSnapshotTable.digest, digest))
    .all()
    .pipe(Effect.orDie)
  expect(snapshots.map((snapshot) => snapshot.sessionID).sort()).toEqual([parentID, childID].sort())
})

describe("Session Fork ProductMode Gate", () => {
  it.instance(
    "V1 fork fails closed for orphan custom parents and forks real custom snapshots for capable clients",
    () =>
      Effect.gen(function* () {
        yield* enableCustomMode
        const test = yield* TestInstance
        const asset = yield* prepareCustomAsset(test.directory)
        const orphan = yield* Session.use.create({ title: "legacy custom parent" })
        yield* markCustom(orphan.id)

        const hidden = yield* post(`/session/${orphan.id}/fork`, test.directory)
        expect(hidden.status).toBe(400)
        expect(yield* hidden.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })

        const rejected = yield* post(`/session/${orphan.id}/fork`, test.directory, undefined, true)
        expect(rejected.status).toBe(400)
        expect(yield* rejected.json).toEqual({ _tag: "BadRequest" })

        const created = yield* createRealCustom(test.directory, asset)
        const forked = yield* post(`/session/${created.data.id}/fork`, test.directory, undefined, true)
        expect(forked.status).toBe(200)
        const child = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(SessionV1.SessionInfo))(yield* forked.json)
        expect(child).toMatchObject({ mode: "custom", parentID: created.data.id })
        yield* assertSnapshotCopied(created.data.id, child.id, created.snapshot.digest)

        const chat = yield* Session.use.create({ title: "chat parent", mode: "chat" })
        expect((yield* post(`/session/${chat.id}/fork`, test.directory)).status).toBe(200)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "V2 fork hides orphan custom parents from old clients and reports missing snapshots to capable clients",
    () =>
      Effect.gen(function* () {
        yield* enableCustomMode
        const test = yield* TestInstance
        const asset = yield* prepareCustomAsset(test.directory)
        const orphan = yield* Session.use.create({ title: "legacy custom parent" })
        yield* markCustom(orphan.id)

        const hidden = yield* post(`/api/session/${orphan.id}/fork`, test.directory, {})
        expect(hidden.status).toBe(404)
        expect(yield* hidden.json).toMatchObject({ _tag: "SessionNotFoundError", sessionID: orphan.id })

        const rejected = yield* post(`/api/session/${orphan.id}/fork`, test.directory, {}, true)
        expect(rejected.status).toBe(400)
        expect(yield* rejected.json).toMatchObject({
          _tag: "InvalidRequestError",
          message: expect.stringContaining("Missing composition snapshot"),
        })

        const created = yield* createRealCustom(test.directory, asset)
        const forked = yield* post(`/api/session/${created.data.id}/fork`, test.directory, {}, true)
        expect(forked.status).toBe(200)
        const child = yield* Schema.decodeUnknownEffect(ForkResponse)(yield* forked.json)
        yield* assertSnapshotCopied(created.data.id, child.sessionID, created.snapshot.digest)
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "V2 generic creation rejects mode=custom with and without the capability",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const location = { directory: test.directory }
        const hidden = yield* post("/api/session", test.directory, { mode: "custom", location })
        expect(hidden.status).toBe(400)
        expect(yield* hidden.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })
        const capable = yield* post("/api/session", test.directory, { mode: "custom", location }, true)
        expect(capable.status).toBe(400)
        expect(yield* capable.json).toMatchObject({ _tag: "UnsupportedProductModeError", mode: "custom" })
        const chat = yield* post("/api/session", test.directory, { mode: "chat", location })
        expect(chat.status).toBe(200)
        expect(yield* chat.json).toMatchObject({ data: { mode: "chat" } })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
