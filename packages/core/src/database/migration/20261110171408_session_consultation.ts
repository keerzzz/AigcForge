import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261110171408_session_consultation",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_consultation\` (
          \`session_id\` text PRIMARY KEY,
          \`source_session_id\` text NOT NULL,
          \`first_message_id\` text NOT NULL UNIQUE,
          \`boundary\` text NOT NULL,
          \`boundary_seq\` integer NOT NULL,
          \`source_message_ids\` text NOT NULL,
          \`digest\` text NOT NULL,
          \`omissions\` text NOT NULL,
          \`phase\` text NOT NULL,
          \`reference_promoted\` integer DEFAULT false NOT NULL,
          \`reference_carrier_id\` text,
          \`reference_file\` text,
          CONSTRAINT \`fk_session_consultation_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
