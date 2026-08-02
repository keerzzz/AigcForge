import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260802043814_add_task_output_digest",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task\` ADD \`output_digest\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
