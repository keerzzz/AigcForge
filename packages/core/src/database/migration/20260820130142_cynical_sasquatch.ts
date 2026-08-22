import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260820130142_cynical_sasquatch",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workflow_run_next\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`snapshot_digest\` text NOT NULL,
          \`workflow_name\` text NOT NULL,
          \`workflow_revision\` text NOT NULL,
          \`status\` text NOT NULL,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`current_step_id\` text,
          \`error_category\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_completed\` integer,
          CONSTRAINT \`fk_workflow_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        INSERT INTO \`workflow_run_next\` (
          \`id\`,
          \`session_id\`,
          \`snapshot_digest\`,
          \`workflow_name\`,
          \`workflow_revision\`,
          \`status\`,
          \`revision\`,
          \`current_step_id\`,
          \`error_category\`,
          \`time_created\`,
          \`time_updated\`,
          \`time_completed\`
        )
        SELECT
          \`id\`,
          \`session_id\`,
          -- A per-row sentinel, not the session's current snapshot digest: run
          -- identity (session + snapshot digest + workflow revision) is what
          -- getOrCreate dedupes on, and stamping the live digest onto a legacy
          -- terminal run would make the next submit return that old failed run
          -- instead of starting a new one.
          'legacy:' || \`id\`,
          \`workflow_name\`,
          \`workflow_revision\`,
          \`status\`,
          1,
          \`current_step_id\`,
          CASE WHEN \`error\` IS NULL THEN NULL ELSE 'unknown_error' END,
          \`time_created\`,
          \`time_updated\`,
          \`time_completed\`
        FROM \`workflow_run\`;
      `)
      yield* tx.run(`
        CREATE TABLE \`workflow_step_run_next\` (
          \`id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL,
          \`step_id\` text NOT NULL,
          \`agent_id\` text NOT NULL,
          \`status\` text NOT NULL,
          \`attempt\` integer DEFAULT 1 NOT NULL,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`task_id\` text,
          \`child_session_id\` text,
          \`input_digest\` text,
          \`output_digest\` text,
          \`branch_target\` text,
          \`error_category\` text,
          \`time_created\` integer NOT NULL,
          \`time_started\` integer,
          \`time_completed\` integer,
          CONSTRAINT \`fk_workflow_step_run_run_id_workflow_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`workflow_run_next\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        INSERT INTO \`workflow_step_run_next\` (
          \`id\`,
          \`run_id\`,
          \`step_id\`,
          \`agent_id\`,
          \`status\`,
          \`attempt\`,
          \`revision\`,
          \`error_category\`,
          \`time_created\`,
          \`time_started\`,
          \`time_completed\`
        )
        SELECT
          \`id\`,
          \`run_id\`,
          \`step_id\`,
          \`agent_id\`,
          \`status\`,
          \`attempt\`,
          1,
          CASE WHEN \`error\` IS NULL THEN NULL ELSE 'unknown_error' END,
          \`time_created\`,
          \`time_started\`,
          \`time_completed\`
        FROM \`workflow_step_run\`;
      `)
      yield* tx.run(`DROP TABLE \`workflow_step_run\`;`)
      yield* tx.run(`DROP TABLE \`workflow_run\`;`)
      yield* tx.run(`ALTER TABLE \`workflow_run_next\` RENAME TO \`workflow_run\`;`)
      yield* tx.run(`ALTER TABLE \`workflow_step_run_next\` RENAME TO \`workflow_step_run\`;`)
      yield* tx.run(`CREATE INDEX \`workflow_run_session_idx\` ON \`workflow_run\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`workflow_run_status_idx\` ON \`workflow_run\` (\`status\`);`)
      yield* tx.run(`CREATE INDEX \`workflow_step_run_run_idx\` ON \`workflow_step_run\` (\`run_id\`);`)
      yield* tx.run(`CREATE INDEX \`workflow_step_run_status_idx\` ON \`workflow_step_run\` (\`status\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`workflow_step_run_run_step_attempt_idx\` ON \`workflow_step_run\` (\`run_id\`,\`step_id\`,\`attempt\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
