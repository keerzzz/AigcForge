import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260811165437_oval_karen_page",
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
          CONSTRAINT \`fk_delivery_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
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
          CONSTRAINT \`fk_schedule_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`delivery_session_idx\` ON \`delivery\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`delivery_schedule_idx\` ON \`delivery\` (\`schedule_id\`);`)
      yield* tx.run(`CREATE UNIQUE INDEX \`schedule_delivery_key_unique\` ON \`schedule\` (\`delivery_key\`);`)
      yield* tx.run(`CREATE INDEX \`schedule_status_due_at_idx\` ON \`schedule\` (\`status\`,\`due_at\`);`)
      yield* tx.run(`CREATE INDEX \`schedule_session_idx\` ON \`schedule\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
