import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261113012729_task-operation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_input_result\` (
          \`input_id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`anchor_input_id\` text NOT NULL,
          \`operation_ref\` text,
          \`joined_event_id\` text NOT NULL,
          \`joined_event_seq\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`assistant_message_id\` text,
          \`terminal_event_id\` text,
          \`terminal_event_seq\` integer,
          \`error\` text,
          CONSTRAINT \`fk_session_input_result_input_id_session_message_id_fk\` FOREIGN KEY (\`input_id\`) REFERENCES \`session_message\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_input_result_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task_operation\` (
          \`source_session_id\` text NOT NULL,
          \`operation_id\` text NOT NULL,
          \`task_id\` text,
          \`input_id\` text NOT NULL UNIQUE,
          \`target_session_id\` text,
          \`phase\` text NOT NULL,
          \`data\` text NOT NULL,
          \`event_seq\` integer DEFAULT -1 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`task_operation_pk\` PRIMARY KEY(\`source_session_id\`, \`operation_id\`),
          CONSTRAINT \`fk_task_operation_source_session_id_session_v2_id_fk\` FOREIGN KEY (\`source_session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`task\` ADD \`operation_id\` text;`)
      yield* tx.run(
        `CREATE INDEX \`session_input_result_anchor_idx\` ON \`session_input_result\` (\`session_id\`,\`anchor_input_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_input_result_status_idx\` ON \`session_input_result\` (\`session_id\`,\`status\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_operation_task_idx\` ON \`task_operation\` (\`source_session_id\`,\`task_id\`,\`time_created\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_operation_target_idx\` ON \`task_operation\` (\`target_session_id\`,\`phase\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`task_operation_source_phase_idx\` ON \`task_operation\` (\`source_session_id\`,\`phase\`,\`time_created\`);`,
      )
    })
  },
}

export default migration
