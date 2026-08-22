import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260821183552_clear_boomerang",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`request_id\` text;`)
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`request_digest\` text;`)
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`parent_run_id\` text;`)
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`root_run_id\` text;`)
      yield* tx.run(`ALTER TABLE \`workflow_run\` ADD \`retry_of_step_run_id\` text;`)
      yield* tx.run(`DROP INDEX IF EXISTS \`workflow_run_identity_idx\`;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`workflow_run_request_idx\` ON \`workflow_run\` (\`session_id\`,\`request_id\`);`,
      )
    })
  },
} satisfies DatabaseMigration.Migration
