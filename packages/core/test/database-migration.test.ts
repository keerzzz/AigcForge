import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { fileURLToPath } from "url"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@omnixa/core/database/drizzle"
import { Cause, Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, Statement } from "effect/sql"
import { sql } from "drizzle-orm"
import { DatabaseMigration } from "@omnixa/core/database/migration"
import { migrations } from "@omnixa/core/database/migration.gen"
import workspaceNameMigration from "@omnixa/core/database/migration/20260410174513_workspace-name"
import { Database } from "@omnixa/core/database/database"
import { tmpdir } from "./fixture/tmpdir"
import legacyCredentialsMigration from "@omnixa/core/database/migration/20260805200742_import_legacy_credentials"
import worktreeMigration from "@omnixa/core/database/migration/20260812213948_worktree"
import previousV2Migration from "@omnixa/core/database/migration/20260804233008_loose_psylocke"
import workspaceMigration from "@omnixa/core/database/migration/20260808023530_workspace_domain"
import executionClaimsMigration from "@omnixa/core/database/migration/20260811161259_execution_claim_attempts"
import sessionInboxMigration from "@omnixa/core/database/migration/20260812181746_session_inbox"
import sessionViewedStateMigration from "@omnixa/core/database/migration/20260819222447_session_viewed_state"
import azureCliCredentialMigration from "@omnixa/core/database/migration/20261007190000_azure_cli_external_credential"
import taskAndScheduleMigration from "@omnixa/core/database/migration/20261016151043_task_and_schedule"
import taskOperationMigration from "@omnixa/core/database/migration/20261113012729_task-operation"
import goalScheduleMigration from "@omnixa/core/database/migration/20261113121533_goal-schedule"
import { Global } from "@omnixa/util/global"
import { V1Migration } from "@omnixa/core/database/v1-migration"
import { SessionMessage } from "@omnixa/schema/session-message"

const run = <A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient | Global.Service>,
  global = Global.make({ data: path.join(process.cwd(), ".test-data") }),
  filename = ":memory:",
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(Global.Service, global),
      Effect.provide(SqliteClient.layer({ filename, disableWAL: true })),
      Effect.scoped,
    ),
  )

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const legacyMainFixture = Effect.fnUntraced(function* (db: Effect.Success<typeof makeDb>) {
  yield* DatabaseMigration.apply(db)
  yield* db.run(sql`DROP TABLE workspace`)
  yield* db.run(sql`
    CREATE TABLE workspace (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
      branch TEXT, directory TEXT, extra TEXT,
      project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
      time_used INTEGER NOT NULL DEFAULT 0
    )
  `)
  yield* db.run(sql`ALTER TABLE session_v2 RENAME TO session`)
  yield* db.run(sql`DROP INDEX session_v2_time_suspended_idx`)
  for (const column of [
    "fork_session_id",
    "fork_boundary",
    "time_idle",
    "time_viewed",
    "idle_outcome",
    "time_suspended",
    "resume_attempts",
  ])
    yield* db.run(sql`ALTER TABLE session DROP COLUMN ${sql.identifier(column)}`)
  // The broken upgrade had already introduced an empty current Session table.
  yield* db.run(sql`CREATE TABLE session_v2 (id text PRIMARY KEY)`)
  yield* db.run(sql`
    CREATE TABLE message (
      id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL,
      time_updated integer NOT NULL, data text NOT NULL
    )
  `)
  yield* db.run(sql`
    CREATE TABLE part (
      id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
    )
  `)
  yield* db.run(sql`DELETE FROM migration WHERE id LIKE '20261016%'`)
  yield* db.run(sql`
    INSERT INTO migration VALUES ('20260629103917_meta_agent', 1), ('20260906023000_harden_external_cli_session_id', 2)
  `)
  yield* db.run(sql`
    INSERT INTO project (id, worktree, time_created, time_updated, time_active, sandboxes)
    VALUES ('legacy-project', '/legacy', 1, 1, 1, '[]')
  `)
  yield* db.run(sql`
    INSERT INTO session (id, project_id, mode, slug, directory, version, permission_tier, attended, time_created, time_updated)
    VALUES ('ses_legacy_events', 'legacy-project', 'work', 'events', '/legacy', 'legacy', 'propose', 1, 1, 30),
      ('ses_legacy_v1', 'legacy-project', 'coding', 'v1', '/legacy', 'legacy', 'propose', 1, 1, 11)
  `)
  yield* db.run(sql`
    INSERT INTO session_composition_snapshot (session_id, digest, data, time_created)
    VALUES ('ses_legacy_events', 'synthetic-digest', '{"preserved":true}', 1)
  `)
  yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_legacy_events', 8)`)
  const base = { sessionID: "ses_legacy_events" }
  const events: { type: string; data: Record<string, unknown> }[] = [
    {
      type: "session.next.model.switched.1",
      data: { ...base, timestamp: 2, messageID: "msg_legacy_model", model: { id: "model", providerID: "provider" } },
    },
    {
      type: "session.next.agent.switched.1",
      data: { ...base, timestamp: 3, messageID: "msg_legacy_agent", agent: "build" },
    },
    {
      type: "session.next.prompt.admitted.1",
      data: {
        ...base,
        timestamp: 4,
        messageID: "msg_legacy_user",
        prompt: { text: "Synthetic legacy request" },
        delivery: "steer",
      },
    },
    {
      type: "session.next.prompted.1",
      data: {
        ...base,
        timestamp: 5,
        messageID: "msg_legacy_user",
        prompt: { text: "Synthetic legacy request" },
        delivery: "steer",
      },
    },
    {
      type: "session.next.step.started.1",
      data: {
        ...base,
        timestamp: 6,
        assistantMessageID: "msg_legacy_answer",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    },
    {
      type: "session.next.text.started.1",
      data: { ...base, timestamp: 7, assistantMessageID: "msg_legacy_answer", textID: "text-1" },
    },
    {
      type: "session.next.text.ended.1",
      data: {
        ...base,
        timestamp: 8,
        assistantMessageID: "msg_legacy_answer",
        textID: "text-1",
        text: "Synthetic recovered answer",
      },
    },
    {
      type: "session.next.reasoning.started.1",
      data: { ...base, timestamp: 8, assistantMessageID: "msg_legacy_answer", reasoningID: "reason-1" },
    },
    {
      type: "session.next.reasoning.ended.1",
      data: {
        ...base,
        timestamp: 8,
        assistantMessageID: "msg_legacy_answer",
        reasoningID: "reason-1",
        text: "Synthetic reasoning",
      },
    },
    {
      type: "session.next.reasoning.started.1",
      data: { ...base, timestamp: 8, assistantMessageID: "msg_legacy_answer", reasoningID: "reason-1" },
    },
    {
      type: "session.next.reasoning.ended.1",
      data: {
        ...base,
        timestamp: 8,
        assistantMessageID: "msg_legacy_answer",
        reasoningID: "reason-1",
        text: "Second reasoning span",
      },
    },
    {
      type: "session.next.text.started.1",
      data: { ...base, timestamp: 8, assistantMessageID: "msg_legacy_answer", textID: "text-1" },
    },
    {
      type: "session.next.text.ended.1",
      data: {
        ...base,
        timestamp: 8,
        assistantMessageID: "msg_legacy_answer",
        textID: "text-1",
        text: "Second text span",
      },
    },
    ...["success", "failed"].flatMap((status) => [
      {
        type: "session.next.tool.input.started.1",
        data: {
          ...base,
          timestamp: 8,
          assistantMessageID: "msg_legacy_answer",
          callID: `call-${status}`,
          name: "read",
        },
      },
      {
        type: "session.next.tool.input.ended.1",
        data: {
          ...base,
          timestamp: 8,
          assistantMessageID: "msg_legacy_answer",
          callID: `call-${status}`,
          text: '{"filePath":"/legacy/result.txt"}',
        },
      },
      {
        type: "session.next.tool.called.1",
        data: {
          ...base,
          timestamp: 8,
          assistantMessageID: "msg_legacy_answer",
          callID: `call-${status}`,
          tool: "read",
          input: { filePath: "/legacy/result.txt" },
          provider: { executed: false, metadata: { fixture: "called" } },
        },
      },
      {
        type: `session.next.tool.${status}.1`,
        data: {
          ...base,
          timestamp: 8,
          assistantMessageID: "msg_legacy_answer",
          callID: `call-${status}`,
          ...(status === "success"
            ? {
                structured: { preview: "Synthetic preview" },
                content: [{ type: "text", text: "Synthetic tool full response" }],
                result: { type: "text", value: "Original raw result" },
                outputPaths: ["/legacy/result.txt"],
              }
            : { error: { type: "tool.execution", message: "Synthetic tool failed" } }),
          provider: { executed: false, metadata: { fixture: "returned" } },
        },
      },
    ]),
    {
      type: "session.next.tool.input.started.1",
      data: {
        ...base,
        timestamp: 8,
        assistantMessageID: "msg_legacy_answer",
        callID: "call-input-failed",
        name: "read",
      },
    },
    {
      type: "session.next.tool.input.ended.1",
      data: {
        ...base,
        timestamp: 8,
        assistantMessageID: "msg_legacy_answer",
        callID: "call-input-failed",
        text: '{"bad":',
      },
    },
    {
      type: "session.next.tool.failed.1",
      data: {
        ...base,
        timestamp: 8,
        assistantMessageID: "msg_legacy_answer",
        callID: "call-input-failed",
        error: { type: "tool.execution", message: "Invalid raw input" },
        provider: { executed: false },
      },
    },
    {
      type: "session.next.step.ended.2",
      data: {
        ...base,
        timestamp: 9,
        assistantMessageID: "msg_legacy_answer",
        finish: "stop",
        cost: 0,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
    {
      type: "session.next.step.started.1",
      data: {
        ...base,
        timestamp: 10,
        assistantMessageID: "msg_legacy_failed",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    },
    {
      type: "session.next.text.started.1",
      data: { ...base, timestamp: 10, assistantMessageID: "msg_legacy_failed", textID: "partial" },
    },
    {
      type: "session.next.text.ended.1",
      data: {
        ...base,
        timestamp: 10,
        assistantMessageID: "msg_legacy_failed",
        textID: "partial",
        text: "Synthetic partial before failure",
      },
    },
    {
      type: "session.next.step.failed.2",
      data: {
        ...base,
        timestamp: 11,
        assistantMessageID: "msg_legacy_failed",
        error: { type: "unknown", message: "Synthetic failed step" },
      },
    },
    {
      type: "session.next.retried.1",
      data: {
        ...base,
        timestamp: 12,
        attempt: 1,
        error: {
          message: "Synthetic retry",
          isRetryable: true,
          statusCode: 503,
          responseBody: "Original retry response",
        },
      },
    },
    {
      type: "session.next.step.started.1",
      data: {
        ...base,
        timestamp: 13,
        assistantMessageID: "msg_legacy_retry",
        agent: "build",
        model: { id: "model", providerID: "provider" },
      },
    },
    {
      type: "session.next.step.ended.2",
      data: {
        ...base,
        timestamp: 14,
        assistantMessageID: "msg_legacy_retry",
        finish: "stop",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
    {
      type: "session.next.synthetic.1",
      data: { ...base, timestamp: 15, messageID: "msg_legacy_synthetic", text: "Synthetic historical notification" },
    },
    {
      type: "session.next.prompt.admitted.1",
      data: {
        ...base,
        timestamp: 20,
        messageID: "msg_legacy_pending",
        prompt: { text: "Synthetic pending request" },
        delivery: "queue",
      },
    },
  ]
  for (const [seq, event] of events.entries())
    yield* db.run(sql`
      INSERT INTO event (id, aggregate_id, seq, type, data)
      VALUES (${"evt_legacy_" + seq}, 'ses_legacy_events', ${seq}, ${event.type}, ${JSON.stringify(event.data)})
    `)
  yield* db.run(sql`UPDATE event_sequence SET seq = ${events.length - 1} WHERE aggregate_id = 'ses_legacy_events'`)
  yield* db.run(sql`
    INSERT INTO message VALUES ('msg_legacy_v1', 'ses_legacy_v1', 10, 11,
      ${JSON.stringify({ role: "user", time: { created: 10 }, agent: "build", model: { providerID: "provider", modelID: "model" } })})
  `)
  yield* db.run(sql`
    INSERT INTO part VALUES ('prt_legacy_v1', 'msg_legacy_v1', 'ses_legacy_v1', 10, 11,
      ${JSON.stringify({ type: "text", text: "Synthetic V1 request" })})
  `)
  yield* db.run(sql`PRAGMA foreign_keys = ON`)
  return events.length
})

// A real in-memory SqlClient whose schema inspection signals `arrived` and then
// waits on `gate`. Bootstrap inspects the schema as its first locked statement,
// so a database built over this client parks while holding its migration lock.
const parkedClient = (arrived: Deferred.Deferred<void>, gate: Deferred.Deferred<void>) =>
  Layer.effect(
    SqlClient.SqlClient,
    Effect.gen(function* () {
      const client = yield* SqlClient.SqlClient
      const connection = yield* client.reserve
      const park = <A, E>(query: string, effect: Effect.Effect<A, E>) =>
        query.includes("sqlite_master")
          ? Deferred.succeed(arrived, undefined).pipe(Effect.andThen(Deferred.await(gate)), Effect.andThen(effect))
          : effect
      return yield* SqlClient.make({
        acquirer: Effect.succeed({
          ...connection,
          execute: (query, params, transform) => park(query, connection.execute(query, params, transform)),
          executeRaw: (query, params) => park(query, connection.executeRaw(query, params)),
        }),
        compiler: Statement.makeCompilerSqlite(),
        spanAttributes: [],
      })
    }),
  ).pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Layer.provide(Reactivity.layer))

describe("DatabaseMigration", () => {
  test("recovers old main history and snapshots without deleting the legacy source", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        const eventCount = yield* legacyMainFixture(db)
        yield* DatabaseMigration.apply(db)

        expect(yield* db.get(sql`SELECT count(*) AS count FROM _legacy_main_event`)).toEqual({ count: eventCount })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM _legacy_main_session`)).toEqual({ count: 2 })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM _legacy_main_message`)).toEqual({ count: 1 })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM _legacy_main_part`)).toEqual({ count: 1 })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM _legacy_main_workspace`)).toEqual({ count: 0 })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM workspace`)).toEqual({ count: 0 })
        expect(
          (yield* db.all<{ name: string }>(sql`PRAGMA table_info(_legacy_main_workspace)`)).map(
            (column) => column.name,
          ),
        ).toEqual(["id", "type", "name", "branch", "directory", "extra", "project_id", "time_used"])
        expect(
          (yield* db.all<{ name: string }>(sql`PRAGMA table_info(workspace)`)).map((column) => column.name),
        ).toEqual(expect.arrayContaining(["provider", "binding"]))
        expect(yield* db.get(sql`SELECT count(*) AS count FROM migration`)).toEqual({ count: migrations.length })
        expect(
          yield* db.get(sql`SELECT mode, permission_tier, attended FROM session_v2 WHERE id = 'ses_legacy_events'`),
        ).toEqual({
          mode: "work",
          permission_tier: "propose",
          attended: 1,
        })
        expect(yield* db.get(sql`SELECT data FROM session_composition_snapshot`)).toEqual({
          data: '{"preserved":true}',
        })
        expect(
          yield* db.all<{ table: string }>(sql`PRAGMA foreign_key_list(session_composition_snapshot)`),
        ).toContainEqual(expect.objectContaining({ table: "session_v2" }))
        const messages = yield* db.all<{ id: string; type: string; data: string }>(
          sql`SELECT id, type, data FROM session_message ORDER BY session_id, seq`,
        )
        expect(messages).toHaveLength(8)
        for (const message of messages)
          Schema.decodeUnknownSync(SessionMessage.Info)({
            ...JSON.parse(message.data),
            id: message.id,
            type: message.type,
          })
        expect(
          yield* db.get(
            sql`SELECT json_extract(data, '$.content[0].text') AS text FROM session_message WHERE id = 'msg_legacy_answer'`,
          ),
        ).toEqual({ text: "Synthetic recovered answer" })
        expect(
          yield* db.get(
            sql`SELECT json_extract(data, '$.text') AS text FROM session_message WHERE id = 'msg_legacy_v1'`,
          ),
        ).toEqual({ text: "Synthetic V1 request" })
        const answer = JSON.parse(messages.find((message) => message.id === "msg_legacy_answer")!.data)
        expect(answer.content).toContainEqual({
          type: "reasoning",
          text: "Synthetic reasoning",
          time: { created: 8, completed: 8 },
        })
        expect(answer.content).toContainEqual({
          type: "reasoning",
          text: "Second reasoning span",
          time: { created: 8, completed: 8 },
        })
        expect(answer.content).toContainEqual({ type: "text", text: "Second text span" })
        expect(answer.content.find((block: { id?: string }) => block.id === "call-success")).toMatchObject({
          state: {
            status: "completed",
            input: { filePath: "/legacy/result.txt" },
            content: [{ type: "text", text: "Synthetic tool full response" }],
            metadata: {
              preview: "Synthetic preview",
              legacy: {
                rawInput: '{"filePath":"/legacy/result.txt"}',
                result: { type: "text", value: "Original raw result" },
                outputPaths: ["/legacy/result.txt"],
              },
            },
          },
          providerState: { fixture: "called" },
          providerResultState: { fixture: "returned" },
        })
        expect(answer.content.find((block: { id?: string }) => block.id === "call-failed")).toMatchObject({
          state: { status: "error", error: { message: "Synthetic tool failed" } },
        })
        expect(answer.content.find((block: { id?: string }) => block.id === "call-input-failed")).toMatchObject({
          state: {
            status: "error",
            input: {},
            metadata: { legacy: { rawInput: '{"bad":' } },
          },
        })
        expect(JSON.parse(messages.find((message) => message.id === "msg_legacy_failed")!.data)).toMatchObject({
          content: [{ type: "text", text: "Synthetic partial before failure" }],
          finish: "error",
          error: { type: "unknown", message: "Synthetic failed step" },
          time: { created: 10, completed: 11 },
        })
        expect(JSON.parse(messages.find((message) => message.id === "msg_legacy_retry")!.data)).toMatchObject({
          retry: {
            attempt: 1,
            at: 12,
            error: { message: "Synthetic retry", status: 503, response: { body: "Original retry response" } },
          },
        })
        expect(JSON.parse(messages.find((message) => message.id === "msg_legacy_synthetic")!.data)).toMatchObject({
          text: "Synthetic historical notification",
        })
        expect(yield* db.get(sql`SELECT id, delivery FROM session_inbox`)).toEqual({
          id: "msg_legacy_pending",
          delivery: "queue",
        })
        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])

        yield* DatabaseMigration.apply(db)
        expect(yield* V1Migration.run().pipe(Effect.provideService(Database.Service, { db }))).toEqual({
          status: "completed",
        })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM _legacy_main_event`)).toEqual({ count: eventCount })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM session_message`)).toEqual({ count: 8 })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM kv WHERE key = 'migration.v1-v2'`)).toEqual({ count: 0 })
      }),
    )
  })

  test.each(["unknown event", "nonempty legacy workspace"])(
    "rolls back legacy main recovery for %s",
    async (scenario) => {
      await run(
        Effect.gen(function* () {
          const db = yield* makeDb
          const eventCount = yield* legacyMainFixture(db)
          if (scenario === "unknown event")
            yield* db.run(sql`UPDATE event SET type = 'session.next.future.1' WHERE seq = 0`)
          if (scenario === "nonempty legacy workspace")
            yield* db.run(
              sql`INSERT INTO workspace (id, type, project_id) VALUES ('legacy-workspace', 'git', 'legacy-project')`,
            )
          const result = yield* Effect.exit(DatabaseMigration.apply(db))
          expect(result._tag).toBe("Failure")
          if (scenario === "nonempty legacy workspace" && result._tag === "Failure")
            expect(Cause.squash(result.cause)).toMatchObject({ reason: "Unsupported legacy column: workspace.type" })
          expect(yield* db.get(sql`SELECT count(*) AS count FROM session`)).toEqual({ count: 2 })
          expect(yield* db.get(sql`SELECT count(*) AS count FROM event`)).toEqual({ count: eventCount })
          expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE name = '_legacy_main_session'`)).toBeUndefined()
          expect(yield* db.get(sql`SELECT count(*) AS count FROM workspace`)).toEqual({
            count: scenario === "nonempty legacy workspace" ? 1 : 0,
          })
          expect(yield* db.get(sql`SELECT count(*) AS count FROM migration WHERE id LIKE '20261016%'`)).toEqual({
            count: 0,
          })
          expect(yield* db.get(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 })
        }),
      )
    },
  )

  test("blocks direct V1 import of event-sourced legacy main sessions", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        const eventCount = yield* legacyMainFixture(db)
        expect((yield* Effect.exit(V1Migration.run().pipe(Effect.provideService(Database.Service, { db }))))._tag).toBe(
          "Failure",
        )
        expect(yield* db.get(sql`SELECT count(*) AS count FROM event`)).toEqual({ count: eventCount })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM kv WHERE key = 'migration.v1-v2'`)).toEqual({ count: 0 })
      }),
    )
  })

  test("defaults missing workspace names while preserving legacy workspace data", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`
          CREATE TABLE workspace (
            id text PRIMARY KEY,
            type text NOT NULL,
            branch text,
            directory text,
            extra text,
            project_id text NOT NULL
          )
        `)
        yield* db.run(sql`
          INSERT INTO workspace (id, type, branch, directory, extra, project_id)
          VALUES ('wrk_legacy', 'remote', 'main', '/repo', '{}', 'proj_legacy')
        `)

        yield* DatabaseMigration.applyOnly(db, [workspaceNameMigration])

        expect(yield* db.get(sql`SELECT id, name, branch, directory, extra FROM workspace`)).toEqual({
          id: "wrk_legacy",
          name: "",
          branch: "main",
          directory: "/repo",
          extra: "{}",
        })
      }),
    )
  })

  test("imports unnamed legacy Drizzle journal entries by their actual migration timestamps", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE __drizzle_migrations (id integer PRIMARY KEY, hash text, created_at integer)`)
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at)
          VALUES ('', ${Date.UTC(2026, 3, 10, 17, 45, 13)})
        `)

        yield* DatabaseMigration.applyOnly(db, [workspaceNameMigration])

        expect(yield* db.all(sql`SELECT id FROM migration`)).toEqual([{ id: "20260410174513_workspace-name" }])
      }),
    )
  })

  test("rejects unknown legacy Drizzle journal timestamps instead of guessing completed migrations", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const db = yield* makeDb
          yield* db.run(sql`CREATE TABLE __drizzle_migrations (id integer PRIMARY KEY, hash text, created_at integer)`)
          yield* db.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('', 1234567890000)`)
          yield* DatabaseMigration.applyOnly(db, [workspaceNameMigration])
        }),
      ),
    ).rejects.toThrow("does not match any known migration")
  })

  test("serializes concurrent embedded initialization for one database path", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "embedded.sqlite")

    await Effect.runPromise(
      Effect.all(
        [Database.layer({ path: filename }), Database.layer({ path: filename })].map((layer) =>
          Effect.scoped(Layer.build(layer)),
        ),
        { concurrency: "unbounded" },
      ).pipe(Effect.provideService(Global.Service, Global.make({ data: tmp.path }))),
    )
  })

  test("bootstraps distinct databases without waiting on each other's lock", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const arrived = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        // Park the first database inside its bootstrap, after it holds its lock.
        const parked = yield* Effect.forkScoped(
          Layer.build(Database.layerFromClient.pipe(Layer.provide(parkedClient(arrived, gate)))),
        )
        yield* Deferred.await(arrived)

        yield* Layer.build(
          Database.layerFromClient.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true }))),
        ).pipe(Effect.timeout("2 seconds"))

        expect(parked.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(gate, undefined)
        yield* Fiber.join(parked)
      }).pipe(
        Effect.provideService(Global.Service, Global.make({ data: path.join(process.cwd(), ".test-data") })),
        Effect.scoped,
      ),
    )
  })

  if (process.platform === "linux") {
    test("declared schema has no ungenerated migrations", async () => {
      const result = await $`bun ${fileURLToPath(new URL("../script/migration.ts", import.meta.url))} --check`
        .quiet()
        .nothrow()
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(result.stdout.toString()).toContain("No schema changes, nothing to migrate")
    }, 30_000)
  }

  test("bootstraps the current schema and records the migration registry", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)

        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'`)).toEqual(
          {
            name: "session_v2",
          },
        )
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_pending'`),
        ).toEqual({ name: "session_pending" })
        expect(
          yield* db.all(sql`
          SELECT 'session_input_result' AS name, count(*) AS count FROM session_input_result
          UNION ALL SELECT 'task_operation', count(*) FROM task_operation
          UNION ALL SELECT 'session_goal', count(*) FROM session_goal
          UNION ALL SELECT 'schedule_occurrence', count(*) FROM schedule_occurrence
        `),
        ).toEqual([
          { name: "session_input_result", count: 0 },
          { name: "task_operation", count: 0 },
          { name: "session_goal", count: 0 },
          { name: "schedule_occurrence", count: 0 },
        ])
        expect(
          yield* db.all(sql`
          SELECT id FROM migration
          WHERE id IN (${taskOperationMigration.id}, ${goalScheduleMigration.id}) ORDER BY id
        `),
        ).toEqual([{ id: taskOperationMigration.id }, { id: goalScheduleMigration.id }])
        expect(yield* db.get(sql`SELECT count(*) AS count FROM migration`)).toEqual({ count: migrations.length })
      }),
    )
  })

  test("AC23 upgrades a copied previous V2 Schedule database twice while preserving reminders, Deliveries, and Tasks", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "previous-v2.sqlite")
    const copy = path.join(tmp.path, "upgraded.sqlite")
    const global = Global.make({ data: tmp.path })
    const input = [taskOperationMigration, goalScheduleMigration]
    const schedules = sql`
      SELECT id, session_id, kind, content, due_at, timezone, status, attempts, next_attempt_at,
        lease_owner, lease_expires_at, delivery_key, time_created, time_updated
      FROM schedule ORDER BY id
    `
    const tasks = sql`
      SELECT id, session_id, content, status, priority, parent_id, output_digest, agent_id,
        scheduled_at, recurrence, spawned_from, depends_on, revision, position, time_created, time_updated
      FROM task ORDER BY id
    `
    const deliveries = sql`SELECT * FROM delivery ORDER BY delivery_key`
    const journal = sql`SELECT id, time_completed FROM migration ORDER BY id`
    const empty = sql`
      SELECT 'session_input_result' AS name, count(*) AS count FROM session_input_result
      UNION ALL SELECT 'task_operation', count(*) FROM task_operation
      UNION ALL SELECT 'session_goal', count(*) FROM session_goal
      UNION ALL SELECT 'schedule_occurrence', count(*) FROM schedule_occurrence
    `

    const previous = await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* db.run(sql`CREATE TABLE project (id text PRIMARY KEY)`)
        yield* db.run(sql`
          CREATE TABLE session_v2 (
            id text PRIMARY KEY, project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            directory text NOT NULL, time_updated integer NOT NULL
          )
        `)
        yield* db.run(sql`
          CREATE TABLE session_message (
            id text PRIMARY KEY, session_id text NOT NULL REFERENCES session_v2(id) ON DELETE CASCADE,
            type text NOT NULL, data text NOT NULL
          )
        `)
        // Use the production migration for the old Task, Schedule, and Delivery shapes.
        yield* DatabaseMigration.applyOnly(db, [taskAndScheduleMigration])
        yield* db.run(sql`INSERT INTO project VALUES ('project')`)
        yield* db.run(sql`
          INSERT INTO session_v2 (id, project_id, directory, time_updated)
          VALUES ('ses_previous', 'project', '/previous', 20)
        `)
        yield* db.run(sql`
          INSERT INTO session_message VALUES ('msg_previous', 'ses_previous', 'user',
            ${JSON.stringify({ text: "Original input", time: { created: 10 } })})
        `)
        yield* db.run(sql`
          INSERT INTO schedule (id, session_id, kind, content, due_at, timezone, status, attempts,
            next_attempt_at, lease_owner, lease_expires_at, delivery_key, time_created, time_updated)
          VALUES
            ('sch_pending', 'ses_previous', 'reminder', 'Pending reminder', 60000, 'Asia/Shanghai', 'pending',
              0, NULL, NULL, NULL, 'legacy:pending', 10, 20),
            ('sch_running', 'ses_previous', 'reminder', 'Running reminder', 60000, 'UTC', 'running',
              3, 90000, 'original-owner', 120000, 'legacy:running', 11, 80000)
        `)
        yield* db.run(sql`
          INSERT INTO delivery (delivery_key, schedule_id, session_id, kind, content, delivered_at,
            caught_up, is_read, time_created)
          VALUES ('legacy:running', 'sch_running', 'ses_previous', 'reminder', 'Original visible delivery',
            75000, 1, 1, 75000)
        `)
        yield* db.run(sql`
          INSERT INTO task (id, session_id, content, status, priority, output_digest, agent_id, scheduled_at,
            recurrence, revision, position, time_created, time_updated)
          VALUES
            ('old-due', 'ses_previous', 'Original due input', 'scheduled', 'medium', NULL, 'build',
              60000, NULL, 4, 0, 10, 20),
            ('old-running', 'ses_previous', 'Original execution', 'in_progress', 'high', 'Previous result', 'build',
              NULL, ${JSON.stringify({ cron: "* * * * *", enabled: true, timezone: "UTC" })}, 7, 1, 11, 21)
        `)
        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
        return {
          schedules: yield* db.all(schedules),
          tasks: yield* db.all(tasks),
          deliveries: yield* db.all(deliveries),
          messages: yield* db.all(sql`SELECT * FROM session_message ORDER BY id`),
          journal: yield* db.all(journal),
        }
      }),
      global,
      source,
    )
    // run closes the source connection before the isolated copy is made.
    await Bun.write(copy, Bun.file(source))

    const upgraded = await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* DatabaseMigration.applyOnly(db, input)
        expect(yield* db.all(schedules)).toEqual(previous.schedules)
        expect(yield* db.all(tasks)).toEqual(previous.tasks)
        expect(yield* db.all(deliveries)).toEqual(previous.deliveries)
        expect(yield* db.all(sql`SELECT * FROM session_message ORDER BY id`)).toEqual(previous.messages)
        expect(
          yield* db.all(sql`
          SELECT id, revision, recurrence, target, execution_policy, source_agent, task_id, next_due_at,
            active_occurrence_id, bound_target_session_id, last_error
          FROM schedule ORDER BY id
        `),
        ).toEqual(
          ["sch_pending", "sch_running"].map((id) => ({
            id,
            revision: 1,
            recurrence: null,
            target: null,
            execution_policy: null,
            source_agent: null,
            task_id: null,
            next_due_at: null,
            active_occurrence_id: null,
            bound_target_session_id: null,
            last_error: null,
          })),
        )
        expect(yield* db.all(sql`SELECT id, operation_id FROM task ORDER BY id`)).toEqual([
          { id: "old-due", operation_id: null },
          { id: "old-running", operation_id: null },
        ])
        expect(yield* db.all(empty)).toEqual([
          { name: "session_input_result", count: 0 },
          { name: "task_operation", count: 0 },
          { name: "session_goal", count: 0 },
          { name: "schedule_occurrence", count: 0 },
        ])
        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY id`)).toEqual([
          { id: taskAndScheduleMigration.id },
          { id: taskOperationMigration.id },
          { id: goalScheduleMigration.id },
        ])
        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
        return { journal: yield* db.all(journal), empty: yield* db.all(empty) }
      }),
      global,
      copy,
    )

    // Upgrade again through a fresh connection to exercise persisted migration identity.
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* DatabaseMigration.applyOnly(db, input)
        expect(yield* db.all(schedules)).toEqual(previous.schedules)
        expect(yield* db.all(tasks)).toEqual(previous.tasks)
        expect(yield* db.all(deliveries)).toEqual(previous.deliveries)
        expect(yield* db.all(sql`SELECT * FROM session_message ORDER BY id`)).toEqual(previous.messages)
        expect(yield* db.all(journal)).toEqual(upgraded.journal)
        expect(yield* db.all(empty)).toEqual(upgraded.empty)
        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
      }),
      global,
      copy,
    )

    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        expect(yield* db.all(schedules)).toEqual(previous.schedules)
        expect(yield* db.all(tasks)).toEqual(previous.tasks)
        expect(yield* db.all(deliveries)).toEqual(previous.deliveries)
        expect(yield* db.all(journal)).toEqual(previous.journal)
        expect(
          yield* db.all(sql`
          SELECT name FROM sqlite_master WHERE type = 'table'
            AND name IN ('session_input_result', 'task_operation', 'session_goal', 'schedule_occurrence')
        `),
        ).toEqual([])
      }),
      global,
      source,
    )
  })

  test("adds nullable attention state to existing sessions", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session_v2 (id text PRIMARY KEY, title text)`)
        yield* db.run(sql`INSERT INTO session_v2 (id, title) VALUES ('ses_existing', 'Existing')`)

        yield* DatabaseMigration.applyOnly(db, [sessionViewedStateMigration])
        yield* DatabaseMigration.applyOnly(db, [sessionViewedStateMigration])

        expect(yield* db.get(sql`SELECT id, title, time_idle, time_viewed, idle_outcome FROM session_v2`)).toEqual({
          id: "ses_existing",
          title: "Existing",
          time_idle: null,
          time_viewed: null,
          idle_outcome: null,
        })
        expect(yield* db.get(sql`SELECT count(*) AS count FROM migration`)).toEqual({ count: 1 })
      }),
    )
  })

  test("rejects a non-empty database without a session table", async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const db = yield* makeDb
          yield* db.run(sql`CREATE TABLE unrelated (id text PRIMARY KEY)`)
          yield* DatabaseMigration.apply(db)
        }),
      ),
    ).rejects.toThrow("Database is not empty and has no session table")
  })

  test("bootstraps alongside underscore-prefixed embedder tables", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE _embedder_state (id text PRIMARY KEY)`)
        yield* DatabaseMigration.apply(db)
        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'`)).toEqual(
          { name: "session_v2" },
        )
      }),
    )
  })

  test("applies generic migrations once and records their order", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        const input = [
          {
            id: "first",
            up: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
              tx.run(sql`CREATE TABLE applied (id text PRIMARY KEY)`),
          },
          {
            id: "second",
            up: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
              tx.run(sql`INSERT INTO applied (id) VALUES ('second')`),
          },
        ]

        yield* DatabaseMigration.applyOnly(db, input)
        yield* DatabaseMigration.applyOnly(db, input)

        expect(yield* db.all(sql`SELECT id FROM applied`)).toEqual([{ id: "second" }])
        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY time_completed, id`)).toEqual([
          { id: "first" },
          { id: "second" },
        ])
      }),
    )
  })

  test("preserves previous V2 state through the current migration lineage", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* db.run(sql`CREATE TABLE migration (id text PRIMARY KEY, time_completed integer NOT NULL)`)
        yield* db.run(sql`
          INSERT INTO migration (id, time_completed)
          VALUES ('20260730195856_optional_session_title', 1)
        `)
        yield* db.run(sql`CREATE TABLE project (id text PRIMARY KEY)`)
        yield* db.run(sql`
          CREATE TABLE project_directory (
            project_id text NOT NULL,
            directory text NOT NULL,
            type text,
            strategy text,
            time_created integer NOT NULL,
            PRIMARY KEY (project_id, directory)
          )
        `)
        yield* db.run(sql`
          CREATE TABLE workspace (
            id text PRIMARY KEY,
            type text NOT NULL,
            name text NOT NULL,
            project_id text NOT NULL,
            time_used integer NOT NULL
          )
        `)
        yield* db.run(sql`
          CREATE TABLE session (
            id text PRIMARY KEY,
            project_id text NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            workspace_id text,
            parent_id text,
            time_suspended integer
          )
        `)
        yield* db.run(sql`CREATE INDEX session_project_idx ON session (project_id)`)
        yield* db.run(sql`CREATE INDEX session_workspace_idx ON session (workspace_id)`)
        yield* db.run(sql`CREATE INDEX session_parent_idx ON session (parent_id)`)
        yield* db.run(
          sql`CREATE INDEX session_time_suspended_idx ON session (time_suspended) WHERE "session"."time_suspended" IS NOT NULL`,
        )
        yield* db.run(sql`
          CREATE TABLE session_message (
            id text PRIMARY KEY,
            session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE,
            data text NOT NULL
          )
        `)
        yield* db.run(sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL)`)
        yield* db.run(sql`
          CREATE TABLE session_pending (
            id text PRIMARY KEY,
            session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE
          )
        `)
        yield* db.run(sql`CREATE TABLE event_sequence (aggregate_id text PRIMARY KEY, seq integer NOT NULL)`)
        yield* db.run(sql`
          CREATE TABLE event (
            id text PRIMARY KEY,
            aggregate_id text NOT NULL REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE,
            seq integer NOT NULL,
            created integer NOT NULL,
            type text NOT NULL,
            data text NOT NULL
          )
        `)
        yield* db.run(sql`CREATE TABLE data_migration (name text PRIMARY KEY)`)
        yield* db.run(sql`INSERT INTO project VALUES ('project')`)
        yield* db.run(sql`INSERT INTO project_directory VALUES ('project', '/repo', 'main', NULL, 1)`)
        yield* db.run(sql`INSERT INTO session VALUES ('session', 'project', NULL, NULL, NULL)`)
        yield* db.run(sql`INSERT INTO session_message VALUES ('message', 'session', '{"text":"preserved"}')`)
        yield* db.run(sql`INSERT INTO session_pending VALUES ('pending', 'session')`)
        yield* db.run(sql`INSERT INTO event_sequence VALUES ('session', 41)`)
        yield* db.run(sql`INSERT INTO event VALUES ('event', 'session', 41, 1, 'session.text.ended.1', '{}')`)

        yield* DatabaseMigration.applyOnly(db, [
          previousV2Migration,
          workspaceMigration,
          executionClaimsMigration,
          sessionInboxMigration,
          worktreeMigration,
        ])

        expect(yield* db.get(sql`SELECT id, resume_attempts FROM session_v2`)).toEqual({
          id: "session",
          resume_attempts: 0,
        })
        expect(yield* db.get(sql`SELECT id, data FROM session_message`)).toEqual({
          id: "message",
          data: '{"text":"preserved"}',
        })
        expect(yield* db.get(sql`SELECT id FROM session_pending`)).toEqual({ id: "pending" })
        expect(yield* db.get(sql`SELECT seq FROM event_sequence`)).toEqual({ seq: 41 })
        expect(yield* db.get(sql`SELECT id, seq FROM event`)).toEqual({ id: "event", seq: 41 })
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`),
        ).toBeUndefined()
        expect(yield* db.get(sql`SELECT directory FROM worktree`)).toEqual({ directory: "/repo" })
        expect(yield* db.all<{ table: string }>(sql`PRAGMA foreign_key_list(session_message)`)).toContainEqual(
          expect.objectContaining({ table: "session_v2" }),
        )
        expect(yield* db.all<{ table: string }>(sql`PRAGMA foreign_key_list(session_pending)`)).toContainEqual(
          expect.objectContaining({ table: "session_v2" }),
        )
      }),
    )
  })

  test("rejects previous V2 databases with V1-only session history", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE migration (id text PRIMARY KEY, time_completed integer NOT NULL)`)
        yield* db.run(sql`
          INSERT INTO migration (id, time_completed)
          VALUES ('20260730195856_optional_session_title', 1)
        `)
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL)`)
        yield* db.run(sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL)`)
        yield* db.run(sql`INSERT INTO session VALUES ('session')`)
        yield* db.run(sql`INSERT INTO message VALUES ('message', 'session')`)

        expect((yield* Effect.exit(DatabaseMigration.applyOnly(db, [previousV2Migration])))._tag).toBe("Failure")
        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)).toEqual({
          name: "session",
        })
        expect(yield* db.get(sql`SELECT id FROM migration WHERE id = ${previousV2Migration.id}`)).toBeUndefined()
      }),
    )
  })

  test("copies project directories into worktrees without removing the old table", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE project (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE project_directory (project_id text NOT NULL, directory text NOT NULL, type text, strategy text, time_created integer NOT NULL, PRIMARY KEY (project_id, directory))`,
        )
        yield* db.run(
          sql`INSERT INTO project_directory (project_id, directory, type, strategy, time_created) VALUES ('project', '/root', 'main', NULL, 1), ('project', '/legacy', 'git_worktree', NULL, 2), ('project', '/strategy', NULL, 'git_worktree', 3), ('project', '/custom', NULL, 'acme/snapshot', 4)`,
        )

        yield* DatabaseMigration.applyOnly(db, [worktreeMigration])

        expect(yield* db.all(sql`SELECT directory, strategy FROM worktree ORDER BY directory`)).toEqual([
          { directory: "/custom", strategy: "acme/snapshot" },
          { directory: "/legacy", strategy: "git" },
          { directory: "/root", strategy: null },
          { directory: "/strategy", strategy: "git" },
        ])
        expect(yield* db.get(sql`SELECT count(*) AS count FROM project_directory`)).toEqual({ count: 4 })
      }),
    )
  })

  test("imports legacy JSON credentials without changing the source file or existing credentials", async () => {
    await using tmp = await tmpdir()
    const source = path.join(tmp.path, "auth.json")
    const content = JSON.stringify({
      openai: { type: "oauth", refresh: "refresh", access: "access", expires: 123, accountId: "account" },
      anthropic: { type: "api", key: "legacy-key", metadata: { region: "us" } },
      google: { type: "api", key: "google-key", metadata: { region: "us" } },
      "github-copilot": { type: "oauth", refresh: "refresh", access: "access", expires: 123 },
      "custom-provider": { type: "api", key: "custom-key" },
      "https://example.com/": { type: "wellknown", key: "TOKEN", token: "wellknown-key" },
      invalid: { type: "unknown" },
    })
    await Bun.write(source, content)

    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        const now = Date.now()
        yield* db.run(sql`
          INSERT INTO credential (id, integration_id, label, value, time_created, time_updated)
          VALUES ('existing', 'anthropic', 'Existing', ${JSON.stringify({ type: "key", key: "current-key" })}, ${now}, ${now})
        `)

        yield* db.run(sql`DELETE FROM migration WHERE id = ${legacyCredentialsMigration.id}`)
        yield* DatabaseMigration.applyOnly(db, [legacyCredentialsMigration])
        yield* DatabaseMigration.applyOnly(db, [legacyCredentialsMigration])

        expect(yield* db.all(sql`SELECT integration_id, label, value FROM credential ORDER BY integration_id`)).toEqual(
          [
            {
              integration_id: "anthropic",
              label: "Existing",
              value: JSON.stringify({ type: "key", key: "current-key" }),
            },
            {
              integration_id: "custom-provider",
              label: "API key",
              value: JSON.stringify({ type: "key", key: "custom-key" }),
            },
            {
              integration_id: "github-copilot",
              label: "OAuth",
              value: JSON.stringify({
                type: "oauth",
                methodID: "device",
                refresh: "refresh",
                access: "access",
                expires: 123,
              }),
            },
            {
              integration_id: "google",
              label: "API key",
              value: JSON.stringify({ type: "key", key: "google-key", metadata: { region: "us" } }),
            },
            {
              integration_id: "https://example.com",
              label: "API key",
              value: JSON.stringify({ type: "key", key: "wellknown-key" }),
            },
            {
              integration_id: "openai",
              label: "OAuth",
              value: JSON.stringify({
                type: "oauth",
                methodID: "chatgpt-browser",
                refresh: "refresh",
                access: "access",
                expires: 123,
                metadata: { accountID: "account" },
              }),
            },
          ],
        )
        expect(yield* db.get(sql`SELECT value FROM kv WHERE key = 'wellknown:sources'`)).toEqual({
          value: JSON.stringify(["https://example.com"]),
        })
      }),
      Global.make({ data: tmp.path }),
    )

    expect(await Bun.file(source).text()).toBe(content)
  })

  test("skips legacy credential import when the source file is absent", async () => {
    await using tmp = await tmpdir()

    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        yield* db.run(sql`DELETE FROM migration WHERE id = ${legacyCredentialsMigration.id}`)
        yield* DatabaseMigration.applyOnly(db, [legacyCredentialsMigration])

        expect(yield* db.all(sql`SELECT id FROM credential`)).toEqual([])
      }),
      Global.make({ data: tmp.path }),
    )
  })

  test("moves Azure CLI connections saved as OAuth credentials to external credentials", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        const now = Date.now()
        const oauth = { type: "oauth", methodID: "azure-cli", access: "token", refresh: "azure-cli", expires: 123 }
        yield* db.run(sql`
          INSERT INTO credential (id, integration_id, label, value, time_created, time_updated) VALUES
            ('cli', 'azure', 'Azure CLI', ${JSON.stringify({ ...oauth, metadata: { resourceName: "my-models" } })}, ${now}, ${now}),
            ('cli-configured', 'azure', 'Azure CLI', ${JSON.stringify(oauth)}, ${now}, ${now}),
            ('key', 'azure', 'API key', ${JSON.stringify({ type: "key", key: "secret" })}, ${now}, ${now}),
            ('other', 'openai', 'OAuth', ${JSON.stringify(oauth)}, ${now}, ${now})
        `)

        yield* db.run(sql`DELETE FROM migration WHERE id = ${azureCliCredentialMigration.id}`)
        yield* DatabaseMigration.applyOnly(db, [azureCliCredentialMigration])

        expect(yield* db.all(sql`SELECT id, value FROM credential ORDER BY id`)).toEqual([
          {
            id: "cli",
            value: JSON.stringify({ type: "external", methodID: "azure-cli", metadata: { resourceName: "my-models" } }),
          },
          { id: "cli-configured", value: JSON.stringify({ type: "external", methodID: "azure-cli" }) },
          { id: "key", value: JSON.stringify({ type: "key", key: "secret" }) },
          { id: "other", value: JSON.stringify(oauth) },
        ])
      }),
    )
  })

  test("rolls back a failed migration without recording it", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        const migration = {
          id: "failing",
          up: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) =>
            Effect.gen(function* () {
              yield* tx.run(sql`CREATE TABLE rolled_back (id text PRIMARY KEY)`)
              yield* Effect.fail(new Error("stop"))
            }),
        }

        expect((yield* Effect.exit(DatabaseMigration.applyOnly(db, [migration])))._tag).toBe("Failure")
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rolled_back'`),
        ).toBeUndefined()
        expect(yield* db.get(sql`SELECT id FROM migration WHERE id = 'failing'`)).toBeUndefined()
      }),
    )
  })

  test("suspends foreign keys outside migrations that rebuild referenced tables", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, title text NOT NULL)`)
        yield* db.run(
          sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL REFERENCES session(id) ON DELETE CASCADE)`,
        )
        yield* db.run(sql`INSERT INTO session VALUES ('session', 'title')`)
        yield* db.run(sql`INSERT INTO message VALUES ('message', 'session')`)

        yield* DatabaseMigration.applyOnly(db, [
          {
            id: "rebuild",
            foreignKeys: false,
            up: (tx) =>
              Effect.gen(function* () {
                yield* tx.run(sql`CREATE TABLE next_session (id text PRIMARY KEY, title text)`)
                yield* tx.run(sql`INSERT INTO next_session SELECT * FROM session`)
                yield* tx.run(sql`DROP TABLE session`)
                yield* tx.run(sql`ALTER TABLE next_session RENAME TO session`)
              }),
          },
        ])

        expect(yield* db.get(sql`SELECT id FROM message`)).toEqual({ id: "message" })
        expect(yield* db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)).toEqual({ foreign_keys: 1 })
      }),
    )
  })

  test("imports an existing Drizzle migration journal once", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, 'legacy', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [])
        expect(yield* db.all(sql`SELECT id FROM migration`)).toEqual([{ id: "legacy" }])

        yield* db.run(sql`INSERT INTO migration (id, time_completed) VALUES ('existing', 1)`)
        yield* db.run(sql`UPDATE __drizzle_migrations SET name = 'ignored'`)
        yield* DatabaseMigration.applyOnly(db, [])
        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY id`)).toEqual([{ id: "existing" }, { id: "legacy" }])
      }),
    )
  })
})
