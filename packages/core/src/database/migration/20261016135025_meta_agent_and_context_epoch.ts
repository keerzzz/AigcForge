import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016135025_meta_agent_and_context_epoch",
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
      yield* tx.run(`
        CREATE TABLE \`meta_agent_session\` (
          \`meta_agent_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`role\` text DEFAULT 'worker' NOT NULL,
          \`effort\` text,
          \`tokens_used\` integer,
          \`error\` text,
          \`result_summary\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`meta_agent_session_pk\` PRIMARY KEY(\`meta_agent_id\`, \`session_id\`),
          CONSTRAINT \`fk_meta_agent_session_meta_agent_id_meta_agent_id_fk\` FOREIGN KEY (\`meta_agent_id\`) REFERENCES \`meta_agent\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_meta_agent_session_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
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
      yield* tx.run(`
        CREATE TABLE \`session_context_epoch\` (
          \`session_id\` text PRIMARY KEY,
          \`baseline\` text NOT NULL,
          \`snapshot\` text NOT NULL,
          \`baseline_seq\` integer NOT NULL,
          CONSTRAINT \`fk_session_context_epoch_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`meta_agent_memory_project_idx\` ON \`meta_agent_memory\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`meta_agent_session_meta_agent_idx\` ON \`meta_agent_session\` (\`meta_agent_id\`);`)
      yield* tx.run(`CREATE INDEX \`meta_agent_session_session_idx\` ON \`meta_agent_session\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`meta_agent_step_session_idx\` ON \`meta_agent_step\` (\`meta_agent_session_id\`);`)
    })
  },
}

export default migration
