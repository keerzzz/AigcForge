import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016151845_workflow_runs",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workflow_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`snapshot_digest\` text NOT NULL,
          \`workflow_name\` text NOT NULL,
          \`workflow_revision\` text NOT NULL,
          \`request_id\` text,
          \`request_digest\` text,
          \`parent_run_id\` text,
          \`root_run_id\` text,
          \`retry_of_step_run_id\` text,
          \`status\` text NOT NULL,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`current_step_id\` text,
          \`error_category\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_completed\` integer,
          CONSTRAINT \`fk_workflow_run_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`workflow_step_run\` (
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
          CONSTRAINT \`fk_workflow_step_run_run_id_workflow_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`workflow_run\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`workflow_run_session_idx\` ON \`workflow_run\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`workflow_run_status_idx\` ON \`workflow_run\` (\`status\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`workflow_run_request_idx\` ON \`workflow_run\` (\`session_id\`,\`request_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`workflow_step_run_run_idx\` ON \`workflow_step_run\` (\`run_id\`);`)
      yield* tx.run(`CREATE INDEX \`workflow_step_run_status_idx\` ON \`workflow_step_run\` (\`status\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`workflow_step_run_run_step_attempt_idx\` ON \`workflow_step_run\` (\`run_id\`,\`step_id\`,\`attempt\`);`,
      )
    })
  },
}

export default migration
