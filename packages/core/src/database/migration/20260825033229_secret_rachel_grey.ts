import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260825033229_secret_rachel_grey",
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
} satisfies DatabaseMigration.Migration
