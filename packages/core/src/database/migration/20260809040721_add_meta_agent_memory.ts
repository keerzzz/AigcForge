import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260809040721_add_meta_agent_memory",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`meta_agent_memory\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`meta_agent_id\` text NOT NULL,
          \`fact_category\` text NOT NULL,
          \`content\` text NOT NULL,
          \`source_session_id\` text,
          \`source_step_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_meta_agent_memory_meta_agent_id_meta_agent_id_fk\` FOREIGN KEY (\`meta_agent_id\`) REFERENCES \`meta_agent\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`meta_agent_memory_project_idx\` ON \`meta_agent_memory\` (\`project_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
