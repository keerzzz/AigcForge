import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260802140709_add_task_spawn_fields",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task\` ADD \`spawned_from\` text;`)
      yield* tx.run(`ALTER TABLE \`task\` ADD \`depends_on\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
