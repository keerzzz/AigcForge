import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260824010035_scoped_grant_level_issued_index",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`CREATE INDEX \`scoped_grant_level_issued_idx\` ON \`scoped_grant\` (\`level\`,\`issued_at\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
