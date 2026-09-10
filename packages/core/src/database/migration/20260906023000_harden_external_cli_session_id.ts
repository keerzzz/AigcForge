import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260906023000_harden_external_cli_session_id",
  up(tx) {
    return Effect.gen(function* () {
      // Older Phase 3 attempts wrote child Session IDs into this compatibility
      // column. They are not participant identities and must become unbound so
      // the canonical participant lookup can reconcile them explicitly.
      yield* tx.run(
        `UPDATE \`external_cli_session\` SET \`participant_id\` = NULL WHERE \`participant_id\` IS NOT NULL AND \`participant_id\` NOT LIKE 'par_%';`,
      )
      yield* tx.run(`
        CREATE TABLE \`__new_external_cli_session\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`session_id\` text NOT NULL,
          \`participant_id\` text,
          \`cli_target\` text NOT NULL,
          \`external_session_id\` text NOT NULL,
          \`status\` text DEFAULT 'active' NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_external_cli_session_session_id_session_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        INSERT INTO \`__new_external_cli_session\`(
          \`id\`, \`session_id\`, \`participant_id\`, \`cli_target\`, \`external_session_id\`,
          \`status\`, \`time_created\`, \`time_updated\`
        )
        SELECT COALESCE(\`id\`, printf('ecs_%016x', rowid)), \`session_id\`, \`participant_id\`, \`cli_target\`,
          \`external_session_id\`, \`status\`, \`time_created\`, \`time_updated\`
        FROM \`external_cli_session\`;
      `)
      yield* tx.run(`DROP TABLE \`external_cli_session\`;`)
      yield* tx.run(`ALTER TABLE \`__new_external_cli_session\` RENAME TO \`external_cli_session\`;`)
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
    })
  },
} satisfies DatabaseMigration.Migration
