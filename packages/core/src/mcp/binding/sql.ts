import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/**
 * One Location-scoped credential binding (ADR-21 §2.2 v1.2). Only the opaque
 * ref is stored. `workspace_id` is NOT NULL with `""` sentinel so the
 * composite uniqueness actually works for workspace-less Locations.
 */
export const McpCredentialBindingTable = sqliteTable(
  "mcp_credential_binding",
  {
    id: text().primaryKey(),
    directory: text().notNull(),
    workspace_id: text().notNull().default(""),
    server_name: text().notNull(),
    credential_ref: text().notNull(),
    binding_revision: integer().notNull().default(1),
    revoked_at: integer(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
  },
  (table) => [
    uniqueIndex("mcp_binding_directory_workspace_server_idx").on(
      table.directory,
      table.workspace_id,
      table.server_name,
    ),
    index("mcp_binding_credential_ref_idx").on(table.credential_ref),
  ],
)
