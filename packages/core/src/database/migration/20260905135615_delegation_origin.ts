import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260905135615_delegation_origin",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`delegation_origin\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
