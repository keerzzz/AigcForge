import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016152635_grants_and_profiles",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`scoped_grant\` (
          \`id\` text PRIMARY KEY,
          \`directory\` text DEFAULT '' NOT NULL,
          \`workspace_id\` text DEFAULT '' NOT NULL,
          \`level\` text NOT NULL,
          \`session_id\` text,
          \`action\` text NOT NULL,
          \`resources\` text NOT NULL,
          \`agent\` text,
          \`asset_revision\` text,
          \`issued_at\` integer NOT NULL,
          \`expires_at\` integer,
          \`revoked_at\` integer,
          \`consumed_at\` integer,
          \`grant_revision\` integer DEFAULT 1 NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE INDEX \`scoped_grant_location_session_issued_idx\` ON \`scoped_grant\` (\`directory\`,\`workspace_id\`,\`session_id\`,\`issued_at\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`scoped_grant_location_level_issued_idx\` ON \`scoped_grant\` (\`directory\`,\`workspace_id\`,\`level\`,\`issued_at\`);`,
      )
    })
  },
}

export default migration
