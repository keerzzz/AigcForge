import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260707100100_session_attended",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`attended\` integer DEFAULT 0;`)
    })
  },
} satisfies DatabaseMigration.Migration
