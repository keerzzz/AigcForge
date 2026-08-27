import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260826074345_scoped_grant_location",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`scoped_grant\` ADD \`directory\` text DEFAULT '' NOT NULL;`)
      yield* tx.run(`ALTER TABLE \`scoped_grant\` ADD \`workspace_id\` text DEFAULT '' NOT NULL;`)
      // Existing grants predate Location ownership and cannot be attributed safely. Fail closed.
      yield* tx.run(`DELETE FROM \`scoped_grant\` WHERE \`directory\` = '' AND \`workspace_id\` = '';`)
      yield* tx.run(`DROP INDEX IF EXISTS \`scoped_grant_session_issued_idx\`;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`scoped_grant_level_issued_idx\`;`)
      yield* tx.run(
        `CREATE INDEX \`scoped_grant_location_session_issued_idx\` ON \`scoped_grant\` (\`directory\`,\`workspace_id\`,\`session_id\`,\`issued_at\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`scoped_grant_location_level_issued_idx\` ON \`scoped_grant\` (\`directory\`,\`workspace_id\`,\`level\`,\`issued_at\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
