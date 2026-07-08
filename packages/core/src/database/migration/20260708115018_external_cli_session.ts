import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260708115018_external_cli_session",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`external_cli_session\` (
          \`session_id\` text NOT NULL,
          \`cli_target\` text NOT NULL,
          \`external_session_id\` text NOT NULL,
          \`status\` text DEFAULT 'active' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_external_cli_session_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`external_cli_session_session_idx\` ON \`external_cli_session\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`external_cli_session_external_idx\` ON \`external_cli_session\` (\`external_session_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
