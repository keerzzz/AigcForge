import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260630143921_ordinary_vulcan",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`meta_agent_step\` (
          \`id\` text PRIMARY KEY,
          \`meta_agent_session_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`engine\` text NOT NULL,
          \`status\` text NOT NULL,
          \`prompt\` text,
          \`result\` text,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX \`meta_agent_step_session_idx\` ON \`meta_agent_step\` (\`meta_agent_session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
