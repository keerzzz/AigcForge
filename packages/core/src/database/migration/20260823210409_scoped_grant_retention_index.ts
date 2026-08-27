import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823210409_scoped_grant_retention_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE INDEX \`scoped_grant_session_issued_idx\` ON \`scoped_grant\` (\`session_id\`,\`issued_at\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
