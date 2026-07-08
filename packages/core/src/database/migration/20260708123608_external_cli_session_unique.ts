import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260708123608_external_cli_session_unique",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(
        `CREATE UNIQUE INDEX \`external_cli_session_unique_idx\` ON \`external_cli_session\` (\`session_id\`,\`external_session_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
