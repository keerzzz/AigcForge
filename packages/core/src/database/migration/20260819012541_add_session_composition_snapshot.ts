import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260819012541_add_session_composition_snapshot",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_composition_snapshot\` (
          \`session_id\` text PRIMARY KEY,
          \`version\` integer DEFAULT 1 NOT NULL,
          \`digest\` text NOT NULL,
          \`profile_path\` text,
          \`profile_revision\` text,
          \`data\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_composition_snapshot_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
