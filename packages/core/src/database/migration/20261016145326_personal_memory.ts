import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016145326_personal_memory",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`personal_memory\` (
          \`id\` text PRIMARY KEY,
          \`content\` text NOT NULL,
          \`source\` text NOT NULL,
          \`trust_level\` text NOT NULL,
          \`sensitivity_level\` text NOT NULL,
          \`status\` text NOT NULL,
          \`source_session_id\` text,
          \`source_message_id\` text,
          \`created_by\` text,
          \`confirmed_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`personal_memory_status_idx\` ON \`personal_memory\` (\`status\`);`)
      yield* tx.run(
        `CREATE INDEX \`personal_memory_source_session_idx\` ON \`personal_memory\` (\`source_session_id\`);`,
      )
    })
  },
}

export default migration
