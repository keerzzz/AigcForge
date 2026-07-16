import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260706021802_session_input_skill",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`skill\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
