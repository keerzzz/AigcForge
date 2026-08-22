import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260820093052_breezy_tarot",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`workflow_run\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`workflow_name\` text NOT NULL,
          \`workflow_revision\` text NOT NULL,
          \`status\` text NOT NULL,
          \`current_step_id\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_completed\` integer,
          CONSTRAINT \`fk_workflow_run_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
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
          \`input\` text,
          \`output\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_started\` integer,
          \`time_completed\` integer,
          CONSTRAINT \`fk_workflow_step_run_run_id_workflow_run_id_fk\` FOREIGN KEY (\`run_id\`) REFERENCES \`workflow_run\`(\`id\`) ON DELETE CASCADE
        );
      `)
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
