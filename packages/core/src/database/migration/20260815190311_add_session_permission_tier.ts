import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260815190311_add_session_permission_tier",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`permission_tier\` text DEFAULT 'propose' NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
