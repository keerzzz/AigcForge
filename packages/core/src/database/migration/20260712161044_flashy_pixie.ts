import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260712161044_flashy_pixie",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`mode\` text DEFAULT 'coding' NOT NULL;`)
      yield* tx.run(
        `CREATE INDEX \`session_project_mode_time_updated_idx\` ON \`session\` (\`project_id\`,\`mode\`,\`time_updated\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_directory_mode_time_updated_idx\` ON \`session\` (\`directory\`,\`mode\`,\`time_updated\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
