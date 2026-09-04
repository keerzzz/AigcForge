// PROBE (one-shot diagnostic for plan §6 D2, do not treat as a stable contract):
// Is the "EventV2.publish cross-connection write deadlock" (docs/technical-debt.md)
// reproducible at HEAD, and does a same-connection atomic batch survive?
//
// Scenarios:
//   P1 same connection   : one Database.Service; outer BEGIN IMMEDIATE tx with two
//                          publishes + one inbox row on the SAME connection.
//   P2 cross connection  : outer BEGIN IMMEDIATE tx on connection A, two publishes on
//                          A, inbox row written via a SECOND connection (B) to the same
//                          file -- the naive "wrap N admits in one transaction" shape.
//   P3 cross connection  : EventV2.publish on A whose commit hook writes via B -- the
//                          exact WorkflowRun mechanism the debt names.
//   P4 layer identity    : two separate Layer.build scopes over the same file yield two
//                          distinct SQLite connections (temp-table marker invisible).
//
// Real file + real OS clock are required (TestClock would not advance during real
// sqlite busy waits), so every case runs with a live Effect runtime.

import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Exit, Layer, type Scope } from "effect"
import { sql } from "drizzle-orm"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@aigcfroge/effect-drizzle-sqlite"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { Prompt } from "@aigcfroge/core/session/prompt"
import { SessionInputTable, SessionTable } from "@aigcfroge/core/session/sql"
import { tmpdir } from "./fixture/tmpdir"

const sessionID = SessionV2.ID.make("ses_d2_probe")
const makeSecondClient = EffectDrizzleSqlite.makeWithDefaults()

// A genuinely separate SQLite client over the same database file, with a short
// busy_timeout so the deadlock surfaces fast instead of waiting 5s.
const withSecondClient = <A, E, R>(
  filename: string,
  use: (db: Effect.Success<typeof makeSecondClient>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const db = yield* makeSecondClient
    yield* db.run(sql`PRAGMA busy_timeout = 500`)
    return yield* use(db)
  }).pipe(Effect.provide(SqliteClient.layer({ filename })), Effect.scoped)

const seedSession = (db: Effect.Success<typeof makeSecondClient>) =>
  Effect.gen(function* () {
    const projectID = Project.ID.make("prj_d2_probe")
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/probe"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: sessionID,
        directory: "/probe",
        title: "D2 probe",
        mode: "custom",
        version: "test",
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
  })

const publishTwoEvents = () =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const first = yield* DateTime.now
    yield* events.publish(
      SessionEvent.PromptAdmitted,
      {
        messageID: SessionMessage.ID.make("msg_d2_probe_a"),
        sessionID,
        timestamp: first,
        prompt: Prompt.make({ text: "probe prompt A" }),
        delivery: "steer",
      },
      { id: EventV2.ID.create() },
    )
    const second = yield* DateTime.now
    yield* events.publish(
      SessionEvent.SyntheticAdmitted,
      {
        messageID: SessionMessage.ID.make("msg_d2_probe_b"),
        sessionID,
        timestamp: second,
        text: "probe synthetic B",
        delivery: "steer",
      },
      { id: EventV2.ID.create() },
    )
    return "published"
  })

const probeLayers = (file: string) =>
  Layer.mergeAll(Database.layerFromPath(file), EventV2.layer.pipe(Layer.provide(Database.layerFromPath(file))))

const runExit = <A, E>(file: string, body: Effect.Effect<A, E, Database.Service | EventV2.Service | Scope.Scope>) =>
  Effect.runPromise(body.pipe(Effect.scoped, Effect.provide(probeLayers(file)), Effect.exit))

describe("D2 probe: atomic-batch transaction boundaries", () => {
  test("P1 same-connection atomic batch: two publishes + inbox row inside one BEGIN IMMEDIATE tx commit", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "probe.sqlite")
    const exit = await runExit(
      file,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seedSession(db)
        return yield* db
          .transaction(
            (tx) =>
              Effect.gen(function* () {
                yield* publishTwoEvents()
                yield* tx
                  .insert(SessionInputTable)
                  .values({
                    id: SessionMessage.ID.make("msg_d2_probe_inbox"),
                    session_id: sessionID,
                    kind: "prompt",
                    prompt: Prompt.make({ text: "inbox row" }),
                    delivery: "steer",
                    admitted_seq: 1,
                  })
                  .run()
                return "committed"
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie)
      }),
    )
    console.log("P1 exit:", String(exit))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("P2 cross-connection batch: outer tx on A + inbox row via connection B fails with SQLITE_BUSY", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "probe.sqlite")
    const exit = await runExit(
      file,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seedSession(db)
        return yield* withSecondClient(file, (db2) =>
          Effect.gen(function* () {
            return yield* db
              .transaction(
                (_tx) =>
                  Effect.gen(function* () {
                    yield* publishTwoEvents()
                    yield* db2
                      .insert(SessionInputTable)
                      .values({
                        id: SessionMessage.ID.make("msg_d2_probe_inbox_cross"),
                        session_id: sessionID,
                        kind: "prompt",
                        prompt: Prompt.make({ text: "cross-connection inbox row" }),
                        delivery: "steer",
                        admitted_seq: 1,
                      })
                      .run()
                    return "committed"
                  }),
                { behavior: "immediate" },
              )
              .pipe(Effect.orDie)
          }),
        )
      }),
    )
    console.log("P2 exit:", String(exit))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toMatch(/SQLITE_BUSY|database is locked|busy/i)
  })

  test("P3 cross-connection commit hook (WorkflowRun mechanism) fails with SQLITE_BUSY", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "probe.sqlite")
    const exit = await runExit(
      file,
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seedSession(db)
        const events = yield* EventV2.Service
        return yield* withSecondClient(file, (db2) =>
          Effect.gen(function* () {
            const first = yield* DateTime.now
            return yield* events.publish(
              SessionEvent.PromptAdmitted,
              {
                messageID: SessionMessage.ID.make("msg_d2_probe_c"),
                sessionID,
                timestamp: first,
                prompt: Prompt.make({ text: "probe prompt C" }),
                delivery: "steer",
              },
              {
                id: EventV2.ID.create(),
                commit: (seq, _tx) =>
                  db2
                    .insert(SessionInputTable)
                    .values({
                      id: SessionMessage.ID.make("msg_d2_probe_inbox_c"),
                      session_id: sessionID,
                      kind: "prompt",
                      prompt: Prompt.make({ text: "cross-connection inbox row" }),
                      delivery: "steer",
                      admitted_seq: seq,
                    })
                    .run()
                    .pipe(Effect.asVoid, Effect.orDie),
              },
            )
          }),
        )
      }),
    )
    console.log("P3 exit:", String(exit))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(exit)).toMatch(/SQLITE_BUSY|database is locked|busy/i)
  })

  test("P4 two separate Layer.build scopes over the same file are distinct connections", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "probe.sqlite")
    const dbLayer = Database.layerFromPath(file)

    await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run("CREATE TEMP TABLE d2_probe_marker (v integer)")
      }).pipe(Effect.provide(dbLayer), Effect.scoped),
    )

    const visible = await Effect.runPromise(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        const rows = yield* db.all<{ name: string }>(
          sql`SELECT name FROM sqlite_temp_master WHERE name = 'd2_probe_marker'`,
        )
        return rows.length > 0
      }).pipe(Effect.provide(dbLayer), Effect.scoped),
    )

    console.log("P4 marker visible across separate builds:", visible)
    expect(visible).toBe(false)
  })
})
