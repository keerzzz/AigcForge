import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260806061818_add_task_revision",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`task\` ADD \`revision\` integer DEFAULT 1 NOT NULL;`)
    })
  },
} satisfies DatabaseMigration.Migration
