import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * One user-granted approval (ADR-20 §2.3/§2.4). Encoded contract lives in
 * `McpScope.ScopedGrant`; this table adds runtime-only columns:
 * `consumed_at` (once-grant single use) and `grant_revision` (CAS counter).
 */
export const ScopedGrantTable = sqliteTable("scoped_grant", {
  id: text().primaryKey(),
  directory: text().notNull().default(""),
  workspace_id: text().notNull().default(""),
  level: text().$type<"once" | "session" | "location">().notNull(),
  session_id: text(),
  action: text().notNull(),
  resources: text({ mode: "json" }).$type<ReadonlyArray<string>>().notNull(),
  agent: text(),
  asset_revision: text(),
  issued_at: integer().notNull(),
  expires_at: integer(),
  revoked_at: integer(),
  consumed_at: integer(),
  grant_revision: integer().notNull().default(1),
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
  time_updated: integer()
    .notNull()
    .$onUpdate(() => Date.now()),
}, (table) => [
  index("scoped_grant_location_session_issued_idx").on(table.directory, table.workspace_id, table.session_id, table.issued_at),
  index("scoped_grant_location_level_issued_idx").on(table.directory, table.workspace_id, table.level, table.issued_at),
])
