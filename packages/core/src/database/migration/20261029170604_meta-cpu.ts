import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261029170604_meta-cpu",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`delegation_participant\` ADD \`executor\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`meta_agent_id\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`root_session_id\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`event_id\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`event_seq\` integer;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`event_type\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`assistant_message_id\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`tool_call_id\` text;`)
      yield* tx.run(`ALTER TABLE \`meta_agent_step\` ADD \`provenance\` text;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`controller\` text;`)
      yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`executor_preference\` text;`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`meta_agent_step_event_idx\` ON \`meta_agent_step\` (\`meta_agent_id\`,\`event_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`meta_agent_step_owner_seq_idx\` ON \`meta_agent_step\` (\`meta_agent_id\`,\`meta_agent_session_id\`,\`seq\`);`,
      )
    })
  },
}

export default migration
