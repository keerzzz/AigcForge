import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260901162239_rare_human_cannonball",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session_input\` ADD \`command_payload\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
