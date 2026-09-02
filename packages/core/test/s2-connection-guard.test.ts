import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Exit, Layer } from "effect"
import { sql } from "drizzle-orm"
import path from "path"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { tmpdir } from "./fixture/tmpdir"

// S2: `EventV2.publishBatch` holds one `BEGIN IMMEDIATE` transaction while its
// projectors write, which only works while every writer shares ONE SQLite
// connection. The D2 probe showed the failure: a second connection to the same
// file cannot write while the first holds the write lock, so the batch dies with
// `database is locked` — intermittently, under load, which is the worst kind of
// regression to chase.
//
// What actually enforces the invariant is layer identity, not a runtime check:
// `layerFromPath` wraps ONE shared `Database.layer` object and the MemoMap keys
// on that identity (database.ts:113-119), so two calls for the same file inside a
// single graph collapse to one connection. Attempts to split them by layer
// surgery collapse too — which is why the runtime cases below cannot be made red
// that way, and why they are documented as coverage rather than as the guard.
//
// The guard is therefore the source-level one at the bottom: `Database.Service`
// must be constructed in exactly one place. That is the mistake the comment at
// database.ts:116 records ("Building a fresh `Layer.effect(Service, …)` here
// instead produced a second in-memory database and 62 HttpApi failures"), and it
// is the only form the split can actually take.
const MARKER = "s2_connection_guard_marker"
const sessionID = SessionV2.ID.make("ses_s2_guard")

const seed = (db: Database.Interface["db"]) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .run()
    yield* db.insert(SessionTable).values({
      id: sessionID,
      project_id: Project.ID.global,
      slug: sessionID,
      directory: AbsolutePath.make("/project"),
      title: "guard",
      version: "test",
      mode: "coding",
      agent: "plan",
    })
  }).pipe(Effect.orDie)

const markerVisible = (db: Database.Interface["db"]) =>
  db
    .all<{ name: string }>(sql`SELECT name FROM sqlite_temp_master WHERE name = ${MARKER}`)
    .pipe(Effect.map((rows) => rows.length > 0))

const admit = Effect.gen(function* () {
  const events = yield* EventV2.Service
  return yield* events.publishBatch([
    EventV2.batchEntry(SessionEvent.PromptAdmitted, {
      messageID: SessionMessage.ID.make("msg_s2_guard"),
      sessionID,
      timestamp: yield* Effect.map(Effect.succeed(Date.now()), (ms) => DateTime.makeUnsafe(ms)),
      prompt: Prompt.make({ text: "guard" }),
      delivery: "steer",
    }),
  ])
})

describe("S2 connection guard", () => {
  test("a batch commits with its projectors against a real file database", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "guard.sqlite")
    // ONE Database layer object, exactly as the composition root provides it.
    const database = Database.layerFromPath(file)
    const graph = Layer.mergeAll(
      database,
      EventV2.layer.pipe(Layer.provide(database)),
      SessionProjector.layer.pipe(Layer.provide(EventV2.layer.pipe(Layer.provide(database))), Layer.provide(database)),
    )

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seed(db)
        yield* db.run(`CREATE TEMP TABLE ${MARKER} (v integer)`)
        expect(yield* markerVisible(db)).toBe(true)

        yield* admit

        // Coverage, not a guard: the rest of the suite runs on `:memory:`, so this
        // is the only place the batch transaction meets a real file and its WAL.
        const rows = yield* db.select().from(SessionInputTable).all().pipe(Effect.orDie)
        expect(rows).toHaveLength(1)
        expect(yield* markerVisible(db)).toBe(true)
        return "ok"
      }).pipe(Effect.scoped, Effect.provide(graph), Effect.exit),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("the marker discriminates connections at all", async () => {
    // Guards the guard: if temp-table visibility stopped telling connections
    // apart, the test above would pass no matter how the layers were wired.
    //
    // Two independent runtime builds are used deliberately. Inside ONE build,
    // `layerFromPath` calls for the same file already collapse to one connection
    // — they wrap the same `Database.layer` object and the MemoMap keys on layer
    // identity (database.ts:113). That collapse IS the production guarantee, so
    // the only way to observe a genuine second connection is to build twice.
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "split.sqlite")
    const database = Database.layerFromPath(file)

    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run(`CREATE TEMP TABLE ${MARKER} (v integer)`)
      }).pipe(Effect.scoped, Effect.provide(database), Effect.orDie),
    )
    const visible = await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        return yield* markerVisible(db)
      }).pipe(Effect.scoped, Effect.provide(database), Effect.orDie),
    )

    expect(visible).toBe(false)
  })
})

describe("S2 connection guard (source-level)", () => {
  test("no module builds its own Database.Service layer", async () => {
    // The only way to end up with two SQLite connections in one graph is a second
    // `Database.Service` implementation; layer identity already collapses every
    // `layerFromPath` call for the same file. So this is where the invariant gets
    // pinned. `database.ts` builds the one real layer with an unqualified
    // `Layer.effect(Service, …)`, which no other module can write — anywhere else
    // it has to name `Database.Service`, and that is what this looks for.
    //
    // Allowed exception to "no source-string assertions" (docs/testing.md §10 red
    // line 3): an architecture-convergence check, not a behaviour assertion.
    // `Effect.provideService(Database.Service, db)` is deliberately NOT matched —
    // that hands an existing connection down, which is the correct pattern.
    const glob = new Bun.Glob("packages/*/src/**/*.ts")
    const root = path.resolve(import.meta.dir, "../../..")
    const construction = /Layer\.(?:effect|succeed|sync|scoped)\(\s*Database\.Service/
    const offenders: string[] = []
    for await (const relative of glob.scan({ cwd: root })) {
      const text = await Bun.file(path.join(root, relative)).text()
      if (construction.test(text)) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })
})
