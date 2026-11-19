import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016151043_task_and_schedule",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`delivery\` (
          \`delivery_key\` text PRIMARY KEY,
          \`schedule_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`content\` text NOT NULL,
          \`delivered_at\` integer NOT NULL,
          \`caught_up\` integer DEFAULT false NOT NULL,
          \`is_read\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_delivery_schedule_id_schedule_id_fk\` FOREIGN KEY (\`schedule_id\`) REFERENCES \`schedule\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_delivery_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`schedule\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`content\` text NOT NULL,
          \`due_at\` integer NOT NULL,
          \`timezone\` text NOT NULL,
          \`status\` text NOT NULL,
          \`attempts\` integer DEFAULT 0 NOT NULL,
          \`next_attempt_at\` integer,
          \`lease_owner\` text,
          \`lease_expires_at\` integer,
          \`delivery_key\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_schedule_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_composition_snapshot\` (
          \`session_id\` text PRIMARY KEY,
          \`version\` integer DEFAULT 1 NOT NULL,
          \`digest\` text NOT NULL,
          \`profile_path\` text,
          \`profile_revision\` text,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_composition_snapshot_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`task\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`content\` text NOT NULL,
          \`status\` text NOT NULL,
          \`priority\` text NOT NULL,
          \`parent_id\` text,
          \`output_digest\` text,
          \`agent_id\` text,
          \`scheduled_at\` integer,
          \`recurrence\` text,
          \`spawned_from\` text,
          \`depends_on\` text,
          \`revision\` integer DEFAULT 1 NOT NULL,
          \`position\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_task_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`mode\` text DEFAULT 'coding' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`permission_tier\` text DEFAULT 'propose' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`attended\` integer DEFAULT 0;`)
      yield* tx.run(`CREATE INDEX \`delivery_session_idx\` ON \`delivery\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`delivery_schedule_idx\` ON \`delivery\` (\`schedule_id\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`schedule_delivery_key_unique\` ON \`schedule\` (\`delivery_key\`);`)
      yield* tx.run(`CREATE INDEX \`schedule_status_due_at_idx\` ON \`schedule\` (\`status\`,\`due_at\`);`)
      yield* tx.run(`CREATE INDEX \`schedule_session_idx\` ON \`schedule\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_project_mode_time_updated_idx\` ON \`session_v2\` (\`project_id\`,\`mode\`,\`time_updated\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_v2_directory_mode_time_updated_idx\` ON \`session_v2\` (\`directory\`,\`mode\`,\`time_updated\`);`,
      )
      yield* tx.run(`CREATE INDEX \`task_session_idx\` ON \`task\` (\`session_id\`);`)
    })
  },
}

export default migration
