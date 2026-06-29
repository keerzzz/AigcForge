import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260629103917_meta_agent",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`meta_agent_session\` (
          \`meta_agent_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`role\` text DEFAULT 'worker' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`meta_agent_session_pk\` PRIMARY KEY(\`meta_agent_id\`, \`session_id\`),
          CONSTRAINT \`fk_meta_agent_session_meta_agent_id_meta_agent_id_fk\` FOREIGN KEY (\`meta_agent_id\`) REFERENCES \`meta_agent\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_meta_agent_session_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`meta_agent\` (
          \`id\` text PRIMARY KEY,
          \`title\` text NOT NULL,
          \`agent\` text NOT NULL,
          \`model\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_archived\` integer
        );
      `)
      yield* tx.run(`CREATE INDEX \`meta_agent_session_meta_agent_idx\` ON \`meta_agent_session\` (\`meta_agent_id\`);`)
      yield* tx.run(`CREATE INDEX \`meta_agent_session_session_idx\` ON \`meta_agent_session\` (\`session_id\`);`)
    })
  },
} satisfies DatabaseMigration.Migration
