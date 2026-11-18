import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016140143_delegation_tables",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`external_cli_session\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`participant_id\` text,
          \`cli_target\` text NOT NULL,
          \`external_session_id\` text NOT NULL,
          \`status\` text DEFAULT 'active' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_external_cli_session_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`delegation_participant\` (
          \`id\` text PRIMARY KEY,
          \`delegation_id\` text NOT NULL,
          \`provider\` text NOT NULL,
          \`target\` text NOT NULL,
          \`role\` text NOT NULL,
          \`context\` text NOT NULL,
          \`phase\` text NOT NULL,
          \`child_session_id\` text,
          \`external_thread_id\` text,
          \`last_activity_at\` integer NOT NULL,
          \`time_closed\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_delegation_participant_delegation_id_delegation_id_fk\` FOREIGN KEY (\`delegation_id\`) REFERENCES \`delegation\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`delegation\` (
          \`id\` text PRIMARY KEY,
          \`parent_session_id\` text NOT NULL,
          \`meta_agent_id\` text,
          \`title\` text NOT NULL,
          \`status\` text NOT NULL,
          \`latest_revision_digest\` text,
          \`rejection_blocked\` integer DEFAULT 0 NOT NULL,
          \`rejection_reason\` text,
          \`rejection_participant_id\` text,
          \`last_activity_at\` integer NOT NULL,
          \`time_completed\` integer,
          \`time_closed\` integer,
          \`time_archived\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_delegation_parent_session_id_session_v2_id_fk\` FOREIGN KEY (\`parent_session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`delegation_turn\` (
          \`id\` text PRIMARY KEY,
          \`delegation_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`status\` text NOT NULL,
          \`prompt_summary\` text,
          \`evidence_digest\` text,
          \`revision_digest\` text,
          \`participant_ids\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_delegation_turn_delegation_id_delegation_id_fk\` FOREIGN KEY (\`delegation_id\`) REFERENCES \`delegation\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE INDEX \`external_cli_session_session_idx\` ON \`external_cli_session\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`external_cli_session_external_idx\` ON \`external_cli_session\` (\`external_session_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`external_cli_session_participant_idx\` ON \`external_cli_session\` (\`participant_id\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`external_cli_session_unique_idx\` ON \`external_cli_session\` (\`session_id\`,\`external_session_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`delegation_participant_delegation_idx\` ON \`delegation_participant\` (\`delegation_id\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`delegation_participant_child_session_idx\` ON \`delegation_participant\` (\`child_session_id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`delegation_parent_session_idx\` ON \`delegation\` (\`parent_session_id\`);`)
      yield* tx.run(`CREATE INDEX \`delegation_status_idx\` ON \`delegation\` (\`status\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`delegation_turn_delegation_seq_idx\` ON \`delegation_turn\` (\`delegation_id\`,\`seq\`);`,
      )
    })
  },
}

export default migration
