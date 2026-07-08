import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"
import { SessionSchema } from "../session/schema"

/**
 * Tracks external CLI session IDs for resume capability.
 * When an external CLI (claude-code, gemini, codex, opencode) emits a
 * session.resume_hint frame, the session ID is persisted here so the
 * task tool can resume the external CLI session on reconnect.
 */
export const ExternalCliSessionTable = sqliteTable(
  "external_cli_session",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    cli_target: text().notNull(),
    external_session_id: text().notNull(),
    status: text().$type<"active" | "completed" | "failed">().notNull().default("active"),
    ...Timestamps,
  },
  (table) => [
    index("external_cli_session_session_idx").on(table.session_id),
    index("external_cli_session_external_idx").on(table.external_session_id),
  ],
)
