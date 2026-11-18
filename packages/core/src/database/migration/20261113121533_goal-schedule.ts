import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261113121533_goal-schedule",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`schedule_occurrence\` (
          \`id\` text PRIMARY KEY,
          \`schedule_id\` text NOT NULL,
          \`rule_revision\` integer NOT NULL,
          \`scheduled_at\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`target_session_id\` text,
          \`input_id\` text NOT NULL,
          \`operation_id\` text NOT NULL,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_schedule_occurrence_schedule_id_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`schedule\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_goal\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`revision\` integer NOT NULL,
          \`status\` text NOT NULL,
          \`last_round_input_id\` text,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_session_goal_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`revision\` integer DEFAULT 1 NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`recurrence\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`target\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`execution_policy\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`source_agent\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`task_id\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`next_due_at\` integer;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`active_occurrence_id\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`bound_target_session_id\` text;`)
      yield* tx.run(`ALTER TABLE \`schedule\` ADD \`last_error\` text;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`schedule_occurrence_due_unique\` ON \`schedule_occurrence\` (\`schedule_id\`,\`rule_revision\`,\`scheduled_at\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`schedule_occurrence_input_unique\` ON \`schedule_occurrence\` (\`input_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`schedule_occurrence_operation_unique\` ON \`schedule_occurrence\` (\`operation_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`schedule_occurrence_schedule_idx\` ON \`schedule_occurrence\` (\`schedule_id\`,\`time_created\`);`,
      )
      yield* tx.run(`CREATE INDEX \`schedule_occurrence_status_idx\` ON \`schedule_occurrence\` (\`status\`);`)
      yield* tx.run(
        `CREATE INDEX \`schedule_occurrence_target_idx\` ON \`schedule_occurrence\` (\`target_session_id\`);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX \`schedule_task_unique\` ON \`schedule\` (\`task_id\`);`)
      yield* tx.run(`CREATE INDEX \`schedule_next_due_idx\` ON \`schedule\` (\`status\`,\`next_due_at\`);`)
      yield* tx.run(`CREATE INDEX \`session_goal_session_status\` ON \`session_goal\` (\`session_id\`,\`status\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_goal_active\` ON \`session_goal\` (\`session_id\`) WHERE "session_goal"."status" = 'active';`,
      )
    })
  },
}

export default migration
