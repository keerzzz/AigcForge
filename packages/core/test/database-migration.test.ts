import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { fileURLToPath } from "url"
import path from "path"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@aigcfroge/effect-drizzle-sqlite"
import { Effect, Layer } from "effect"
import { eq, inArray, sql } from "drizzle-orm"
import { DatabaseMigration } from "@aigcfroge/core/database/migration"
import { migrations } from "@aigcfroge/core/database/migration.gen"
import sessionUsageMigration from "@aigcfroge/core/database/migration/20260510033149_session_usage"
import normalizeStoragePathsMigration from "@aigcfroge/core/database/migration/20260601010001_normalize_storage_paths"
import sessionMessageProjectionOrderMigration from "@aigcfroge/core/database/migration/20260603040000_session_message_projection_order"
import eventSourcedSessionInputMigration from "@aigcfroge/core/database/migration/20260604172448_event_sourced_session_input"
import contextEpochAgentMigration from "@aigcfroge/core/database/migration/20260605042240_add_context_epoch_agent"
import simplifyIntegrationCredentialsMigration from "@aigcfroge/core/database/migration/20260611192811_lush_chimera"
import simplifySessionInputMigration from "@aigcfroge/core/database/migration/20260622202450_simplify_session_input"
import sessionInputKindMigration from "@aigcfroge/core/database/migration/20260705170359_session_input_kind"
import backfillTaskTableMigration from "@aigcfroge/core/database/migration/20260802220000_backfill_task_table"
import addTaskOutputDigestMigration from "@aigcfroge/core/database/migration/20260802043814_add_task_output_digest"
import addTaskScheduleFieldsMigration from "@aigcfroge/core/database/migration/20260802093236_add_task_schedule_fields"
import addTaskSpawnFieldsMigration from "@aigcfroge/core/database/migration/20260802140709_add_task_spawn_fields"
import addSessionCompositionSnapshotMigration from "@aigcfroge/core/database/migration/20260819012541_add_session_composition_snapshot"
import scopedGrantMigration from "@aigcfroge/core/database/migration/20260823072731_wakeful_lady_bullseye"
import workflowDurableProjectionMigration from "@aigcfroge/core/database/migration/20260820130142_cynical_sasquatch"
import { EventV2 } from "@aigcfroge/core/event"
import { ProjectV2 } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { SessionTable } from "@aigcfroge/core/session/sql"
import sessionMetadataMigration from "@aigcfroge/core/database/migration/20260511173437_session-metadata"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { Database } from "@aigcfroge/core/database/database"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { tmpdir } from "./fixture/tmpdir"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

describe("DatabaseMigration", () => {
  test("serializes concurrent embedded initialization for one database path", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "embedded.sqlite")
    const layers = [Database.layerFromPath(filename), Database.layerFromPath(filename)]

    await Effect.runPromise(
      Effect.all(
        layers.map((layer) => Effect.scoped(Layer.build(layer))),
        { concurrency: "unbounded" },
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
    }, 90_000)
  }

  test("applies tracked migrations to an empty database", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)

        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)).toEqual({
          name: "session",
        })
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_input'`),
        ).toEqual({ name: "session_input" })
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_context_epoch'`),
        ).toEqual({ name: "session_context_epoch" })
        expect(
          yield* db.get(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_composition_snapshot'`,
          ),
        ).toEqual({ name: "session_composition_snapshot" })
        expect(
          yield* db.get(
            sql`SELECT name FROM pragma_table_info('session_context_epoch') WHERE name IN ('agent', 'replacement_seq', 'revision')`,
          ),
        ).toBeUndefined()
        expect(yield* db.get(sql`SELECT count(*) as count FROM migration`)).toEqual({ count: migrations.length })
        expect(
          yield* db.all(
            sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('event_aggregate_seq_idx', 'event_aggregate_type_seq_idx', 'session_input_session_pending_seq_idx', 'session_input_session_pending_delivery_seq_idx', 'session_input_session_admitted_seq_idx', 'session_input_session_promoted_seq_idx', 'session_message_session_idx', 'session_message_session_type_idx', 'session_message_session_seq_idx', 'session_message_session_type_seq_idx', 'session_message_session_time_created_id_idx') ORDER BY name`,
          ),
        ).toEqual([
          { name: "event_aggregate_seq_idx" },
          { name: "event_aggregate_type_seq_idx" },
          { name: "session_input_session_admitted_seq_idx" },
          { name: "session_input_session_pending_delivery_seq_idx" },
          { name: "session_input_session_promoted_seq_idx" },
          { name: "session_message_session_seq_idx" },
          { name: "session_message_session_time_created_id_idx" },
          { name: "session_message_session_type_seq_idx" },
        ])
      }),
    )
  })

  test("migrates legacy workflow rows to the safe durable projection", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE session_composition_snapshot (session_id text PRIMARY KEY, digest text NOT NULL)`,
        )
        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_legacy_workflow')`)
        yield* db.run(
          sql`INSERT INTO session_composition_snapshot (session_id, digest) VALUES ('ses_legacy_workflow', 'snapshot-digest')`,
        )
        yield* db.run(sql`
          CREATE TABLE workflow_run (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            workflow_name text NOT NULL,
            workflow_revision text NOT NULL,
            status text NOT NULL,
            current_step_id text,
            error text,
            time_created integer NOT NULL,
            time_updated integer NOT NULL,
            time_completed integer,
            FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
          )
        `)
        yield* db.run(sql`
          CREATE TABLE workflow_step_run (
            id text PRIMARY KEY,
            run_id text NOT NULL,
            step_id text NOT NULL,
            agent_id text NOT NULL,
            status text NOT NULL,
            attempt integer DEFAULT 1 NOT NULL,
            input text,
            output text,
            error text,
            time_created integer NOT NULL,
            time_started integer,
            time_completed integer,
            FOREIGN KEY (run_id) REFERENCES workflow_run(id) ON DELETE CASCADE
          )
        `)
        yield* db.run(
          sql`INSERT INTO workflow_run (id, session_id, workflow_name, workflow_revision, status, error, time_created, time_updated) VALUES ('wfr_legacy', 'ses_legacy_workflow', 'legacy', 'workflow-revision', 'failed', 'raw failure', 1, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO workflow_step_run (id, run_id, step_id, agent_id, status, input, output, error, time_created) VALUES ('wfs_legacy', 'wfr_legacy', 'step', 'coder', 'failed', '{"prompt":"secret"}', '{"answer":"secret"}', 'raw failure', 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [workflowDurableProjectionMigration])

        const runColumns = yield* db.all<{ name: string }>(sql`PRAGMA table_info(workflow_run)`)
        const stepColumns = yield* db.all<{ name: string }>(sql`PRAGMA table_info(workflow_step_run)`)
        expect(runColumns.map((column) => column.name)).not.toContain("error")
        expect(stepColumns.map((column) => column.name)).not.toEqual(
          expect.arrayContaining(["input", "output", "error"]),
        )
        expect(stepColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining(["revision", "input_digest", "output_digest", "error_category"]),
        )

        // The legacy run keeps a per-row sentinel digest, never the session's live
        // snapshot digest: run identity is (session, snapshot digest, workflow
        // revision), so stamping the live digest here would make the next submit
        // dedupe onto this old `failed` run instead of starting a fresh one.
        expect(
          yield* db.get<{ snapshot_digest: string; error_category: string }>(
            sql`SELECT snapshot_digest, error_category FROM workflow_run WHERE id = 'wfr_legacy'`,
          ),
        ).toEqual({ snapshot_digest: "legacy:wfr_legacy", error_category: "unknown_error" })
        const liveDigest = yield* db.get<{ digest: string }>(
          sql`SELECT digest FROM session_composition_snapshot WHERE session_id = 'ses_legacy_workflow'`,
        )
        expect(liveDigest?.digest).toBe("snapshot-digest")
        expect(
          yield* db.all(
            sql`SELECT id FROM workflow_run WHERE session_id = 'ses_legacy_workflow' AND snapshot_digest = 'snapshot-digest'`,
          ),
        ).toEqual([])
        expect(
          yield* db.get<{ input_digest: string | null; output_digest: string | null; error_category: string }>(
            sql`SELECT input_digest, output_digest, error_category FROM workflow_step_run WHERE id = 'wfs_legacy'`,
          ),
        ).toEqual({ input_digest: null, output_digest: null, error_category: "unknown_error" })
      }),
    )
  })

  test("migrates a session that already holds two legacy workflow runs", async () => {
    // Two runs of one workflow in one session was the normal legacy shape (the
    // old `create` was an unconditional insert). A unique index over
    // (session_id, snapshot_digest, workflow_revision) would abort the whole
    // migration here, and `DatabaseMigration.apply` is `orDie` on the Database
    // layer — i.e. the app would fail to start on every launch.
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE session_composition_snapshot (session_id text PRIMARY KEY, digest text NOT NULL)`,
        )
        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_two_legacy')`)
        yield* db.run(
          sql`INSERT INTO session_composition_snapshot (session_id, digest) VALUES ('ses_two_legacy', 'same-digest')`,
        )
        yield* db.run(sql`
          CREATE TABLE workflow_run (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            workflow_name text NOT NULL,
            workflow_revision text NOT NULL,
            status text NOT NULL,
            current_step_id text,
            error text,
            time_created integer NOT NULL,
            time_updated integer NOT NULL,
            time_completed integer,
            FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
          )
        `)
        yield* db.run(sql`
          CREATE TABLE workflow_step_run (
            id text PRIMARY KEY,
            run_id text NOT NULL,
            step_id text NOT NULL,
            agent_id text NOT NULL,
            status text NOT NULL,
            attempt integer DEFAULT 1 NOT NULL,
            input text,
            output text,
            error text,
            time_created integer NOT NULL,
            time_started integer,
            time_completed integer,
            FOREIGN KEY (run_id) REFERENCES workflow_run(id) ON DELETE CASCADE
          )
        `)
        for (const id of ["wfr_first", "wfr_second"]) {
          yield* db.run(
            sql`INSERT INTO workflow_run (id, session_id, workflow_name, workflow_revision, status, time_created, time_updated) VALUES (${id}, 'ses_two_legacy', 'same', 'same-revision', 'failed', 1, 1)`,
          )
        }

        yield* DatabaseMigration.applyOnly(db, [workflowDurableProjectionMigration])

        expect(
          yield* db.all<{ id: string; snapshot_digest: string }>(
            sql`SELECT id, snapshot_digest FROM workflow_run ORDER BY id`,
          ),
        ).toEqual([
          { id: "wfr_first", snapshot_digest: "legacy:wfr_first" },
          { id: "wfr_second", snapshot_digest: "legacy:wfr_second" },
        ])
      }),
    )
  })

  test("rejects a non-empty database without a session table", () => {
    expect(
      run(
        Effect.gen(function* () {
          const db = yield* makeDb
          yield* db.run(sql`CREATE TABLE unrelated (id text PRIMARY KEY)`)
          yield* DatabaseMigration.apply(db)
        }),
      ),
    ).rejects.toThrow("Database is not empty and has no session table")
  })

  test("backfills existing Context Epoch rows to the build agent", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE session_context_epoch (session_id text PRIMARY KEY, baseline text NOT NULL, snapshot text NOT NULL, baseline_seq integer NOT NULL, replacement_seq integer, revision integer DEFAULT 0 NOT NULL)`,
        )
        yield* db.run(
          sql`INSERT INTO session_context_epoch (session_id, baseline, snapshot, baseline_seq) VALUES ('ses_existing', 'baseline', '{}', 0)`,
        )

        yield* DatabaseMigration.applyOnly(db, [contextEpochAgentMigration])

        expect(yield* db.get(sql`SELECT agent FROM session_context_epoch WHERE session_id = 'ses_existing'`)).toEqual({
          agent: "build",
        })
      }),
    )
  })

  test("keeps legacy credential fields nullable", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE credential (id text PRIMARY KEY, connector_id text NOT NULL, method_id text NOT NULL, label text NOT NULL, value text NOT NULL, active integer DEFAULT false NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE UNIQUE INDEX credential_connector_active_idx ON credential (connector_id) WHERE active = 1`,
        )
        yield* DatabaseMigration.applyOnly(db, [simplifyIntegrationCredentialsMigration])

        yield* db.run(
          sql`INSERT INTO credential (id, connector_id, method_id, label, value, active, time_created, time_updated) VALUES ('legacy', 'openai', 'oauth', 'Legacy', '{}', 1, 1, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO credential (id, integration_id, label, value, time_created, time_updated) VALUES ('current', 'anthropic', 'Current', '{}', 2, 2)`,
        )
        expect(yield* db.get(sql`SELECT connector_id, method_id, active FROM credential WHERE id = 'current'`)).toEqual(
          { connector_id: null, method_id: null, active: null },
        )
      }),
    )
  })

  test("backfills existing session_input rows as prompt kind and relaxes prompt nullability", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        // Pre-migration shape: prompt NOT NULL, no kind/command columns.
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE session_input (id text PRIMARY KEY, session_id text NOT NULL, prompt text NOT NULL, delivery text NOT NULL, admitted_seq integer NOT NULL, promoted_seq integer, time_created integer NOT NULL)`,
        )
        yield* db.run(
          sql`INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, time_created) VALUES ('inp_old', 'ses_old', '{"text":"hi"}', 'steer', 1, 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [sessionInputKindMigration])

        // Existing row backfilled as a prompt input.
        expect(yield* db.get(sql`SELECT kind, prompt, command FROM session_input WHERE id = 'inp_old'`)).toEqual({
          kind: "prompt",
          prompt: '{"text":"hi"}',
          command: null,
        })
        // prompt is now nullable so shell inputs can store a command instead.
        yield* db.run(
          sql`INSERT INTO session_input (id, session_id, kind, command, delivery, admitted_seq, time_created) VALUES ('inp_shell', 'ses_old', 'shell', 'pwd', 'queue', 2, 2)`,
        )
        expect(yield* db.get(sql`SELECT kind, prompt, command FROM session_input WHERE id = 'inp_shell'`)).toEqual({
          kind: "shell",
          prompt: null,
          command: "pwd",
        })
        // Named indexes survived the rebuild (auto-indexes are excluded).
        expect(
          (yield* db.all<{ name: string }>(sql`PRAGMA index_list(session_input)`))
            .map((index) => index.name)
            .filter((name) => !name.startsWith("sqlite_autoindex_"))
            .sort(),
        ).toEqual(
          [
            "session_input_session_admitted_seq_idx",
            "session_input_session_pending_delivery_seq_idx",
            "session_input_session_promoted_seq_idx",
          ].sort(),
        )
      }),
    )
  })

  test("resets beta history and rebuilds event-sourced Session input storage", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, workspace_id text)`)
        yield* db.run(sql`CREATE TABLE workspace (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE message (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE part (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE event_sequence (aggregate_id text PRIMARY KEY, seq integer NOT NULL)`)
        yield* db.run(
          sql`CREATE TABLE event (id text PRIMARY KEY, aggregate_id text NOT NULL, seq integer NOT NULL, type text NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(sql`CREATE INDEX event_aggregate_seq_idx ON event (aggregate_id, seq)`)
        yield* db.run(sql`CREATE INDEX event_aggregate_type_seq_idx ON event (aggregate_id, type, seq)`)
        yield* db.run(
          sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(sql`CREATE INDEX session_message_session_seq_idx ON session_message (session_id, seq)`)
        yield* db.run(
          sql`CREATE TABLE session_input (seq integer PRIMARY KEY AUTOINCREMENT, id text NOT NULL UNIQUE, session_id text NOT NULL, prompt text NOT NULL, delivery text NOT NULL, promoted_seq integer, time_created integer NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE INDEX session_input_session_pending_delivery_seq_idx ON session_input (session_id, promoted_seq, delivery, seq)`,
        )
        yield* db.run(sql`INSERT INTO session (id, workspace_id) VALUES ('session', 'wrk_old')`)
        yield* db.run(sql`INSERT INTO workspace (id) VALUES ('wrk_old')`)
        yield* db.run(sql`INSERT INTO message (id) VALUES ('message')`)
        yield* db.run(sql`INSERT INTO part (id) VALUES ('part')`)
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('session', 0)`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('evt_old', 'session', 0, 'old.1', '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('msg_old', 'session', 'user', 0, 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_input (id, session_id, prompt, delivery, time_created) VALUES ('msg_pending', 'session', '{}', 'steer', 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [eventSourcedSessionInputMigration])

        expect(yield* db.all(sql`SELECT id, workspace_id FROM session`)).toEqual([
          { id: "session", workspace_id: null },
        ])
        expect(yield* db.all(sql`SELECT id FROM workspace`)).toEqual([])
        expect(yield* db.all(sql`SELECT id FROM message`)).toEqual([{ id: "message" }])
        expect(yield* db.all(sql`SELECT id FROM part`)).toEqual([{ id: "part" }])
        expect(yield* db.all(sql`SELECT id FROM event`)).toEqual([])
        expect(yield* db.all(sql`SELECT aggregate_id FROM event_sequence`)).toEqual([])
        expect(yield* db.all(sql`SELECT id FROM session_message`)).toEqual([])
        expect(yield* db.all(sql`SELECT id FROM session_input`)).toEqual([])
        expect(
          (yield* db.all<{ name: string }>(sql`PRAGMA table_info(session_input)`)).map((column) => column.name),
        ).toEqual(["id", "session_id", "prompt", "delivery", "admitted_seq", "promoted_seq", "time_created"])
        expect(
          (yield* db.all<{ name: string; unique: number }>(sql`PRAGMA index_list(session_message)`)).find(
            (index) => index.name === "session_message_session_seq_idx",
          ),
        ).toMatchObject({ unique: 1 })
        expect(
          (yield* db.all<{ name: string; unique: number }>(sql`PRAGMA index_list(event)`)).find(
            (index) => index.name === "event_aggregate_seq_idx",
          ),
        ).toMatchObject({ unique: 1 })
        expect(
          (yield* db.all<{ name: string; unique: number }>(sql`PRAGMA index_list(session_input)`)).filter((index) =>
            ["session_input_session_admitted_seq_idx", "session_input_session_promoted_seq_idx"].includes(index.name),
          ),
        ).toEqual([
          expect.objectContaining({ name: "session_input_session_promoted_seq_idx", unique: 1 }),
          expect.objectContaining({ name: "session_input_session_admitted_seq_idx", unique: 1 }),
        ])
      }),
    )
  })

  test("preserves canonical V1 state and restarts its event stream", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* DatabaseMigration.apply(db)
        yield* db.run(
          sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global', '/project', 1, 1, '[]')`,
        )
        yield* db.run(
          sql`INSERT INTO workspace (id, type, project_id, time_used) VALUES ('workspace', 'local', 'global', 1)`,
        )
        yield* db.run(
          sql`INSERT INTO session (id, project_id, workspace_id, slug, directory, title, version, time_created, time_updated) VALUES ('session', 'global', 'workspace', 'session', '/project', 'Before', 'test', 1, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('message', 'session', 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('part', 'message', 'session', 1, 1, '{}')`,
        )
        yield* db.run(sql`INSERT INTO event_sequence (aggregate_id, seq) VALUES ('session', 9)`)
        yield* db.run(
          sql`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('event', 'session', 9, 'session.updated.1', '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_input (id, session_id, prompt, delivery, admitted_seq, time_created) VALUES ('input', 'session', '{}', 'steer', 9, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('projected', 'session', 'user', 9, 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_context_epoch (session_id, baseline, snapshot, baseline_seq) VALUES ('session', 'baseline', '{}', 9)`,
        )
        yield* db.run(sql`DELETE FROM migration WHERE id = ${simplifySessionInputMigration.id}`)
        yield* DatabaseMigration.applyOnly(db, [simplifySessionInputMigration])

        const database = Layer.succeed(Database.Service, { db })
        const events = EventV2.layer.pipe(Layer.provide(database))
        yield* EventV2.Service.use((service) =>
          service.publish(SessionV1.Event.Updated, {
            sessionID: SessionSchema.ID.make("session"),
            info: {
              id: SessionSchema.ID.make("session"),
              mode: "coding",
              slug: "session",
              projectID: ProjectV2.ID.global,
              directory: "/project",
              title: "After",
              version: "test",
              time: { created: 1, updated: 2 },
            },
          }),
        ).pipe(
          Effect.provide(
            Layer.merge(events, SessionProjector.layer.pipe(Layer.provide(events), Layer.provide(database))),
          ),
        )

        expect(
          yield* db.get(sql`
            SELECT
              (SELECT title FROM session WHERE id = 'session') AS title,
              (SELECT workspace_id FROM session WHERE id = 'session') AS workspaceID,
              (SELECT COUNT(*) FROM message WHERE id = 'message') AS messages,
              (SELECT COUNT(*) FROM part WHERE id = 'part') AS parts,
              (SELECT COUNT(*) FROM workspace) AS workspaces,
              (SELECT COUNT(*) FROM session_input) AS sessionInputs,
              (SELECT COUNT(*) FROM session_message) AS sessionMessages,
              (SELECT COUNT(*) FROM session_context_epoch) AS contextEpochs,
              (SELECT seq FROM event_sequence WHERE aggregate_id = 'session') AS seq,
              (SELECT type FROM event WHERE aggregate_id = 'session') AS eventType
          `),
        ).toEqual({
          title: "After",
          workspaceID: null,
          messages: 1,
          parts: 1,
          workspaces: 0,
          sessionInputs: 0,
          sessionMessages: 0,
          contextEpochs: 0,
          seq: 0,
          eventType: "session.updated.1",
        })
      }),
    )
  })

  test("resets incompatible projected Session messages before adding sequence order", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(sql`CREATE TABLE event (id text PRIMARY KEY, seq integer NOT NULL)`)
        yield* db.run(
          sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
        )
        yield* db.run(
          sql`CREATE INDEX session_message_session_time_created_id_idx ON session_message (session_id, time_created, id)`,
        )
        yield* db.run(
          sql`CREATE INDEX session_message_session_type_time_created_id_idx ON session_message (session_id, type, time_created, id)`,
        )
        yield* db.run(sql`INSERT INTO session (id) VALUES ('session')`)
        yield* db.run(
          sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('legacy_message', 'session', 1, 1, '{"role":"user"}')`,
        )
        yield* db.run(
          sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('legacy_part', 'legacy_message', 'session', 1, 1, '{"type":"text","text":"hello"}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES ('stale_projection', 'session', 'user', 1, 1, '{}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [sessionMessageProjectionOrderMigration])

        expect(yield* db.all(sql`SELECT id, session_id, data FROM message`)).toEqual([
          { id: "legacy_message", session_id: "session", data: '{"role":"user"}' },
        ])
        expect(yield* db.all(sql`SELECT id, message_id, session_id, data FROM part`)).toEqual([
          {
            id: "legacy_part",
            message_id: "legacy_message",
            session_id: "session",
            data: '{"type":"text","text":"hello"}',
          },
        ])
        expect(yield* db.all(sql`SELECT id FROM session_message`)).toEqual([])

        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('fresh_projection', 'session', 'user', 7, 2, 2, '{}')`,
        )
        expect(yield* db.get(sql`SELECT id, seq FROM session_message`)).toEqual({ id: "fresh_projection", seq: 7 })
      }),
    )
  })

  test("runs session usage backfill in order with schema changes", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, time_updated integer NOT NULL)`)
        yield* db.run(sql`CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, data text NOT NULL)`)
        yield* db.run(sql`INSERT INTO session (id, time_updated) VALUES ('session_1', 1)`)
        yield* db.run(
          sql`INSERT INTO message (id, session_id, data) VALUES ('message_1', 'session_1', '{"role":"assistant","cost":1.25,"tokens":{"input":2,"output":3,"reasoning":4,"cache":{"read":5,"write":6}}}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [sessionUsageMigration])

        expect(
          yield* db.get(
            sql`SELECT cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session WHERE id = 'session_1'`,
          ),
        ).toEqual({
          cost: 1.25,
          tokens_input: 2,
          tokens_output: 3,
          tokens_reasoning: 4,
          tokens_cache_read: 5,
          tokens_cache_write: 6,
        })
      }),
    )
  })

  test("normalizes Windows storage paths and leaves POSIX paths untouched", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, sandboxes text NOT NULL)`)
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, directory text NOT NULL, path text)`)
        // Windows-shaped rows (drive + backslash) must be normalized.
        yield* db.run(
          sql`INSERT INTO project (id, worktree, sandboxes) VALUES (${"win"}, ${"C:\\Repo\\Thing"}, ${JSON.stringify([
            "C:\\Repo\\Thing\\sandbox",
          ])})`,
        )
        yield* db.run(
          sql`INSERT INTO session (id, directory, path) VALUES (${"win"}, ${"C:\\Repo\\Thing\\packages\\api"}, ${"packages\\api"})`,
        )
        // UNC worktrees and their sandboxes must normalize too (not just drive paths).
        yield* db.run(
          sql`INSERT INTO project (id, worktree, sandboxes) VALUES (${"unc"}, ${"\\\\server\\share"}, ${JSON.stringify([
            "\\\\server\\share\\sandbox",
          ])})`,
        )
        // The "/" worktree sentinel and POSIX paths (including a pathological
        // backslash in a POSIX filename) must survive byte-for-byte.
        yield* db.run(sql`INSERT INTO project (id, worktree, sandboxes) VALUES (${"global"}, ${"/"}, ${"[]"})`)
        yield* db.run(
          sql`INSERT INTO session (id, directory, path) VALUES (${"posix"}, ${"/home/me/we\\ird"}, ${"src\\weird"})`,
        )

        yield* DatabaseMigration.applyOnly(db, [normalizeStoragePathsMigration])

        expect(yield* db.get(sql`SELECT worktree, sandboxes FROM project WHERE id = 'win'`)).toEqual({
          worktree: "C:/Repo/Thing",
          sandboxes: JSON.stringify(["C:/Repo/Thing/sandbox"]),
        })
        expect(yield* db.get(sql`SELECT directory, path FROM session WHERE id = 'win'`)).toEqual({
          directory: "C:/Repo/Thing/packages/api",
          path: "packages/api",
        })
        expect(yield* db.get(sql`SELECT worktree, sandboxes FROM project WHERE id = 'unc'`)).toEqual({
          worktree: "//server/share",
          sandboxes: JSON.stringify(["//server/share/sandbox"]),
        })
        expect(yield* db.get(sql`SELECT worktree FROM project WHERE id = 'global'`)).toEqual({ worktree: "/" })
        expect(yield* db.get(sql`SELECT directory, path FROM session WHERE id = 'posix'`)).toEqual({
          directory: "/home/me/we\\ird",
          path: "src\\weird",
        })
      }),
    )
  })

  test("maps native Windows paths through database columns", async () => {
    if (process.platform !== "win32") return
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        const projectID = ProjectV2.ID.make("codec_project")
        const worktree = AbsolutePath.make("C:\\Repo\\Thing")
        const sandbox = AbsolutePath.make("C:\\Repo\\Thing\\sandbox")
        const directory = "C:\\Repo\\Thing\\packages\\api"
        const sessionID = SessionSchema.ID.make("ses_codec")

        expect(() =>
          Effect.runSync(
            db
              .insert(ProjectTable)
              .values({
                id: ProjectV2.ID.make("invalid_path"),
                worktree: AbsolutePath.make("not-absolute"),
                sandboxes: [],
                time_created: 1,
                time_updated: 1,
              })
              .run(),
          ),
        ).toThrow()

        yield* db
          .insert(ProjectTable)
          .values({
            id: projectID,
            worktree,
            sandboxes: [sandbox],
            time_created: 1,
            time_updated: 1,
          })
          .run()
        yield* db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: projectID,
            slug: "codec",
            directory,
            path: "packages\\api",
            title: "Codec",
            version: "test",
            time_created: 1,
            time_updated: 1,
          })
          .run()

        expect(
          yield* db.get<{ worktree: string; sandboxes: string }>(
            sql`SELECT worktree, sandboxes FROM project WHERE id = ${projectID}`,
          ),
        ).toEqual({
          worktree: "C:/Repo/Thing",
          sandboxes: JSON.stringify(["C:/Repo/Thing/sandbox"]),
        })
        expect(
          yield* db.get<{ directory: string; path: string }>(
            sql`SELECT directory, path FROM session WHERE id = ${sessionID}`,
          ),
        ).toEqual({
          directory: "C:/Repo/Thing/packages/api",
          path: "packages/api",
        })

        const project = yield* db.select().from(ProjectTable).where(eq(ProjectTable.worktree, worktree)).get()
        const session = yield* db.select().from(SessionTable).where(eq(SessionTable.directory, directory)).get()
        expect(project?.worktree).toBe(worktree)
        expect(project?.sandboxes).toEqual([sandbox])
        expect(session?.directory).toBe(directory)
        expect(session?.path).toBe("packages/api")

        expect((yield* db.select().from(SessionTable).where(eq(SessionTable.path, "packages\\api")).get())?.id).toBe(
          sessionID,
        )

        const moved = AbsolutePath.make("D:\\Moved\\Thing")
        const updated = yield* db
          .update(ProjectTable)
          .set({ worktree: moved, sandboxes: [moved] })
          .where(eq(ProjectTable.id, projectID))
          .returning()
          .get()
        expect(updated?.worktree).toBe(moved)
        expect(updated?.sandboxes).toEqual([moved])
        expect(
          yield* db.get<{ worktree: string; sandboxes: string }>(
            sql`SELECT worktree, sandboxes FROM project WHERE id = ${projectID}`,
          ),
        ).toEqual({ worktree: "D:/Moved/Thing", sandboxes: JSON.stringify(["D:/Moved/Thing"]) })
        expect(
          (yield* db
            .select()
            .from(ProjectTable)
            .where(inArray(ProjectTable.worktree, [moved]))
            .get())?.id,
        ).toBe(projectID)

        yield* db.run(sql`UPDATE project SET worktree = ${"not-absolute"} WHERE id = ${projectID}`)
        expect(() =>
          Effect.runSync(db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get()),
        ).toThrow()
      }),
    )
  })

  test("imports existing drizzle migration state", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260127222353_familiar_lady_ursula', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [])

        expect(yield* db.get(sql`SELECT id FROM migration`)).toEqual({ id: "20260127222353_familiar_lady_ursula" })
      }),
    )
  })

  test("does not replay a migrated session metadata column", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, metadata text)`)
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260511173437_session-metadata', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [sessionMetadataMigration])

        expect(yield* db.all(sql`SELECT id FROM migration`)).toEqual([{ id: "20260511173437_session-metadata" }])
      }),
    )
  })

  test("accepts the temporary replacement session metadata migration id", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, metadata text)`)
        yield* db.run(sql`CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
        yield* db.run(sql`INSERT INTO migration (id, time_completed) VALUES ('20260530232709_lovely_romulus', 1)`)

        yield* DatabaseMigration.applyOnly(db, [sessionMetadataMigration])

        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY id`)).toEqual([
          { id: "20260511173437_session-metadata" },
          { id: "20260530232709_lovely_romulus" },
        ])
      }),
    )
  })

  test("skips drizzle import when migration table already has state", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
        yield* db.run(sql`INSERT INTO migration (id, time_completed) VALUES ('existing', 1)`)
        yield* db.run(
          sql`CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)`,
        )
        yield* db.run(sql`
          INSERT INTO __drizzle_migrations (hash, created_at, name, applied_at)
          VALUES ('hash', 1, '20260127222353_familiar_lady_ursula', ${new Date().toISOString()})
        `)

        yield* DatabaseMigration.applyOnly(db, [])

        expect(yield* db.all(sql`SELECT id FROM migration ORDER BY id`)).toEqual([{ id: "existing" }])
      }),
    )
  })

  test("backward-compatible add-column preserves existing rows", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb

        // Create a minimal session table with existing data.
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, title text NOT NULL)`)
        yield* db.run(sql`INSERT INTO session (id, title) VALUES ('ses_1', 'Original')`)
        yield* db.run(sql`INSERT INTO session (id, title) VALUES ('ses_2', 'Another')`)

        // Build a mock migration that adds a nullable column.
        const addColumnMigration = {
          id: "99999999999999_test_add_column",
          up(tx: Parameters<DatabaseMigration.Migration["up"]>[0]) {
            return Effect.gen(function* () {
              yield* tx.run(sql`ALTER TABLE session ADD COLUMN summary text`)
              yield* tx.run(
                sql`CREATE INDEX session_summary_idx ON session (summary) WHERE summary IS NOT NULL`,
              )
            })
          },
        } satisfies DatabaseMigration.Migration

        yield* DatabaseMigration.applyOnly(db, [addColumnMigration])

        // Existing rows preserved.
        expect(yield* db.all(sql`SELECT id, title, summary FROM session ORDER BY id`)).toEqual([
          { id: "ses_1", title: "Original", summary: null },
          { id: "ses_2", title: "Another", summary: null },
        ])

        // New column is writable.
        yield* db.run(sql`UPDATE session SET summary = 'Updated' WHERE id = 'ses_1'`)
        expect(yield* db.get(sql`SELECT summary FROM session WHERE id = 'ses_1'`)).toEqual({ summary: "Updated" })
      }),
    )
  })

  test("backfills legacy todo rows into the task table with tsk_ ids and preserved positions", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        // Pre-migration shape: legacy todo table + empty task table.
        yield* db.run(sql`
          CREATE TABLE todo (
            session_id text NOT NULL,
            content text NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            position integer NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL,
            PRIMARY KEY (session_id, position)
          )
        `)
        yield* db.run(sql`
          CREATE TABLE task (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            content text NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            parent_id text,
            position integer NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL
          )
        `)
        yield* db.run(
          sql`INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES ('ses_1', 'first', 'in_progress', 'high', 0, 111, 222)`,
        )
        yield* db.run(
          sql`INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES ('ses_1', 'second', 'pending', 'low', 1, 333, 444)`,
        )

        yield* DatabaseMigration.applyOnly(db, [backfillTaskTableMigration])

        const migrated = yield* db.all<{
          id: string
          session_id: string
          content: string
          status: string
          priority: string
          position: number
          time_created: number
          time_updated: number
        }>(sql`SELECT id, session_id, content, status, priority, position, time_created, time_updated FROM task ORDER BY position`)
        expect(migrated).toHaveLength(2)
        expect(migrated[0]).toMatchObject({
          session_id: "ses_1",
          content: "first",
          status: "in_progress",
          priority: "high",
          position: 0,
          time_created: 111,
          time_updated: 222,
        })
        expect(migrated[1]).toMatchObject({
          session_id: "ses_1",
          content: "second",
          status: "pending",
          priority: "low",
          position: 1,
          time_created: 333,
          time_updated: 444,
        })
        expect(migrated.every((row) => row.id.startsWith("tsk_"))).toBe(true)
        expect(new Set(migrated.map((row) => row.id)).size).toBe(2)

        // Legacy table retained for backward-compatible reads.
        const remaining = yield* db.all<{ content: string }>(sql`SELECT content FROM todo ORDER BY position`)
        expect(remaining.map((row) => row.content)).toEqual(["first", "second"])
      }),
    )
  })

  test("backfill migration normalizes legacy free-form status/priority", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`
          CREATE TABLE todo (
            session_id text NOT NULL,
            content text NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            position integer NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL,
            PRIMARY KEY (session_id, position)
          )
        `)
        yield* db.run(sql`
          CREATE TABLE task (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            content text NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            parent_id text,
            position integer NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL
          )
        `)
        // Legacy Todo.Info had unconstrained status/priority strings.
        yield* db.run(
          sql`INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES ('ses_1', 'legacy', 'done', 'urgent', 0, 1, 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [backfillTaskTableMigration])

        const migrated = yield* db.get<{ status: string; priority: string }>(
          sql`SELECT status, priority FROM task WHERE content = 'legacy'`,
        )
        expect(migrated).toEqual({ status: "pending", priority: "medium" })
      }),
    )
  })

  test("adds a nullable output_digest column to task preserving existing rows", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        // Pre-migration shape: task table without output_digest, with existing rows.
        yield* db.run(sql`
          CREATE TABLE task (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            content text NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            parent_id text,
            position integer NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL
          )
        `)
        yield* db.run(
          sql`INSERT INTO task (id, session_id, content, status, priority, position, time_created, time_updated) VALUES ('tsk_1', 'ses_1', 'first', 'pending', 'low', 0, 1, 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [addTaskOutputDigestMigration])

        // Column exists and existing rows read back a null digest.
        const cols = yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('task')`)
        expect(cols.map((column) => column.name)).toContain("output_digest")
        expect(yield* db.get(sql`SELECT output_digest FROM task WHERE id = 'tsk_1'`)).toEqual({ output_digest: null })

        // Column is writable.
        yield* db.run(sql`UPDATE task SET output_digest = 'ses_child' WHERE id = 'tsk_1'`)
        expect(yield* db.get(sql`SELECT output_digest FROM task WHERE id = 'tsk_1'`)).toEqual({
          output_digest: "ses_child",
        })
      }),
    )
  })

  test("adds nullable agent_id/scheduled_at/recurrence columns preserving existing rows", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        // Pre-migration shape: task table without the M3 schedule columns.
        yield* db.run(sql`
          CREATE TABLE task (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            content text NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            parent_id text,
            output_digest text,
            position integer NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL
          )
        `)
        yield* db.run(
          sql`INSERT INTO task (id, session_id, content, status, priority, position, time_created, time_updated) VALUES ('tsk_1', 'ses_1', 'audit', 'scheduled', 'medium', 0, 1, 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [addTaskScheduleFieldsMigration])

        const cols = yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('task')`)
        const names = cols.map((column) => column.name)
        expect(names).toContain("agent_id")
        expect(names).toContain("scheduled_at")
        expect(names).toContain("recurrence")
        // Existing rows read back null for the new columns.
        expect(yield* db.get(sql`SELECT agent_id, scheduled_at, recurrence FROM task WHERE id = 'tsk_1'`)).toEqual({
          agent_id: null,
          scheduled_at: null,
          recurrence: null,
        })
        // The columns are writable.
        yield* db.run(
          sql`UPDATE task SET agent_id = 'ag_audit', scheduled_at = 1234, recurrence = '{"cron":"0 9 * * *","enabled":true}' WHERE id = 'tsk_1'`,
        )
        expect(yield* db.get(sql`SELECT agent_id, scheduled_at, recurrence FROM task WHERE id = 'tsk_1'`)).toEqual({
          agent_id: "ag_audit",
          scheduled_at: 1234,
          recurrence: '{"cron":"0 9 * * *","enabled":true}',
        })
      }),
    )
  })

  test("adds the session permission_tier column to a clean database", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)

        const columns = yield* db.all<{ name: string; notnull: number; dflt_value: unknown }>(
          sql`SELECT name, "notnull", dflt_value FROM pragma_table_info('session') WHERE name = 'permission_tier'`,
        )
        expect(columns).toEqual([{ name: "permission_tier", notnull: 1, dflt_value: "'propose'" }])
      }),
    )
  })

  test("adds nullable permission_tier to existing sessions defaulting to propose", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, title text NOT NULL)`)
        yield* db.run(sql`INSERT INTO session (id, title) VALUES ('ses_1', 'Original')`)

        const migration = migrations.find((item) => item.id.endsWith("add_session_permission_tier"))
        if (!migration) throw new Error("missing add_session_permission_tier migration")

        yield* DatabaseMigration.applyOnly(db, [migration])

        const columns = yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('session')`)
        expect(columns.map((column) => column.name)).toContain("permission_tier")
        expect(yield* db.get(sql`SELECT permission_tier FROM session WHERE id = 'ses_1'`)).toEqual({
          permission_tier: "propose",
        })

        yield* db.run(sql`UPDATE session SET permission_tier = 'full' WHERE id = 'ses_1'`)
        expect(yield* db.get(sql`SELECT permission_tier FROM session WHERE id = 'ses_1'`)).toEqual({
          permission_tier: "full",
        })
      }),
    )
  })

  test("adds nullable spawned_from/depends_on columns preserving existing rows", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        // Pre-migration shape: task table without the M5 spawn columns.
        yield* db.run(sql`
          CREATE TABLE task (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            content text NOT NULL,
            status text NOT NULL,
            priority text NOT NULL,
            parent_id text,
            output_digest text,
            agent_id text,
            scheduled_at integer,
            recurrence text,
            position integer NOT NULL,
            time_created integer NOT NULL,
            time_updated integer NOT NULL
          )
        `)
        yield* db.run(
          sql`INSERT INTO task (id, session_id, content, status, priority, position, time_created, time_updated) VALUES ('tsk_1', 'ses_1', 'spawn', 'pending', 'medium', 0, 1, 1)`,
        )

        yield* DatabaseMigration.applyOnly(db, [addTaskSpawnFieldsMigration])

        const cols = yield* db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('task')`)
        const names = cols.map((column) => column.name)
        expect(names).toContain("spawned_from")
        expect(names).toContain("depends_on")
        expect(yield* db.get(sql`SELECT spawned_from, depends_on FROM task WHERE id = 'tsk_1'`)).toEqual({
          spawned_from: null,
          depends_on: null,
        })
        yield* db.run(
          sql`UPDATE task SET spawned_from = 'msg_1', depends_on = '["tsk_a","tsk_b"]' WHERE id = 'tsk_1'`,
        )
        expect(yield* db.get(sql`SELECT spawned_from, depends_on FROM task WHERE id = 'tsk_1'`)).toEqual({
          spawned_from: "msg_1",
          depends_on: '["tsk_a","tsk_b"]',
        })
      }),
    )
  })

  test("adds session_composition_snapshot table with FK cascade on delete session", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_test_1')`)
        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_test_2')`)

        yield* DatabaseMigration.applyOnly(db, [addSessionCompositionSnapshotMigration])

        expect(
          yield* db.get(
            sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_composition_snapshot'`,
          ),
        ).toEqual({ name: "session_composition_snapshot" })

        // Insert snapshot
        yield* db.run(sql`
          INSERT INTO session_composition_snapshot (session_id, version, digest, profile_path, profile_revision, data, time_created)
          VALUES ('ses_test_1', 1, 'digest123', 'custom-profiles/test.yaml', 'rev123', '{"agentID":"agent-1"}', 1000)
        `)

        expect(
          yield* db.get(sql`SELECT session_id, version, digest FROM session_composition_snapshot WHERE session_id = 'ses_test_1'`),
        ).toEqual({
          session_id: "ses_test_1",
          version: 1,
          digest: "digest123",
        })

        // Rerun idempotency check: running applyOnly with same migration is a no-op
        yield* DatabaseMigration.applyOnly(db, [addSessionCompositionSnapshotMigration])

        // FK cascade test: deleting session deletes snapshot
        yield* db.run(sql`DELETE FROM session WHERE id = 'ses_test_1'`)
        expect(
          yield* db.get(sql`SELECT session_id FROM session_composition_snapshot WHERE session_id = 'ses_test_1'`),
        ).toBeUndefined()
      }),
    )
  })

  // Existing-DB leg for the Phase D migration (CLAUDE.md requires clean +
  // existing + rerun). `scoped_grant` is a pure CREATE TABLE with no backfill,
  // so "existing" means: applied onto a database that already carries prior
  // state, it adds the table, leaves that state untouched, and re-running is a
  // no-op. Mirrors the session_composition_snapshot case above.
  test("adds scoped_grant to an existing database, preserves prior rows and reruns clean", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(sql`INSERT INTO session (id) VALUES ('ses_pre_existing')`)

        yield* DatabaseMigration.applyOnly(db, [scopedGrantMigration])

        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scoped_grant'`),
        ).toEqual({ name: "scoped_grant" })
        // Pre-existing state is untouched.
        expect(yield* db.all(sql`SELECT id FROM session`)).toEqual([{ id: "ses_pre_existing" }])

        // grant_revision defaults to 1 so the CAS counter starts where the store expects.
        yield* db.run(sql`
          INSERT INTO scoped_grant (id, level, action, resources, issued_at, time_created, time_updated)
          VALUES ('grt_test', 'once', 'bash', '["*"]', 1000, 1000, 1000)
        `)
        expect(yield* db.get(sql`SELECT id, level, grant_revision FROM scoped_grant WHERE id = 'grt_test'`)).toEqual({
          id: "grt_test",
          level: "once",
          grant_revision: 1,
        })

        // Rerun is a no-op and does not drop the row.
        yield* DatabaseMigration.applyOnly(db, [scopedGrantMigration])
        expect(yield* db.all(sql`SELECT id FROM scoped_grant`)).toEqual([{ id: "grt_test" }])
      }),
    )
  })
})
