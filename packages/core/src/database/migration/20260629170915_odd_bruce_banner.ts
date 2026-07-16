import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260629170915_odd_bruce_banner",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`meta_agent_session\` ADD \`effort\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_session\` ADD \`tokens_used\` integer;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_session\` ADD \`error\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_session\` ADD \`result_summary\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
