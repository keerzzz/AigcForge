import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261114221321_model-groups",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`meta_agent\` ADD \`group_behavior\` text;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`unknown_price_attempts\` integer;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`missing_usage_attempts\` integer;`)
    })
  },
}

export default migration
