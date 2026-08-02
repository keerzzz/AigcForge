import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260802093236_add_task_schedule_fields",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task\` ADD \`agent_id\` text;`)
      yield* tx.run(`ALTER TABLE \`task\` ADD \`scheduled_at\` integer;`)
      yield* tx.run(`ALTER TABLE \`task\` ADD \`recurrence\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
