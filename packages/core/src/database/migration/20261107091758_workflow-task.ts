import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261107091758_workflow-task",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`frozen_snapshot\` text;`)
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`task_binding\` text;`)
    })
  },
}

export default migration
