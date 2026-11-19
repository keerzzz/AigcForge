import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261016143353_mcp_credential_binding",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`mcp_credential_binding\` (
          \`id\` text PRIMARY KEY,
          \`directory\` text NOT NULL,
          \`workspace_id\` text DEFAULT '' NOT NULL,
          \`server_name\` text NOT NULL,
          \`credential_ref\` text NOT NULL,
          \`binding_revision\` integer DEFAULT 1 NOT NULL,
          \`revoked_at\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`mcp_binding_directory_workspace_server_idx\` ON \`mcp_credential_binding\` (\`directory\`,\`workspace_id\`,\`server_name\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`mcp_binding_credential_ref_idx\` ON \`mcp_credential_binding\` (\`credential_ref\`);`,
      )
    })
  },
}

export default migration
