export * as PersonalMemorySQL from "./personal-memory.sql"

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { PersonalMemory } from "@aigcfroge/schema/personal-memory"
import { Timestamps } from "../database/schema.sql"

/**
 * User-level personal memory (PRD §9). Cross-project by design — no project
 * foreign key. Entries are proposed by the AI and confirmed by the user;
 * derived entries stay pending until confirmed and are never injected.
 */
export const PersonalMemoryTable = sqliteTable(
  "personal_memory",
  {
    id: text().$type<PersonalMemory.ID>().primaryKey(),
    content: text().notNull(),
    source: text().$type<PersonalMemory.Source>().notNull(),
    trust_level: text().$type<PersonalMemory.TrustLevel>().notNull(),
    sensitivity_level: text().$type<PersonalMemory.SensitivityLevel>().notNull(),
    status: text().$type<PersonalMemory.Status>().notNull(),
    source_session_id: text(),
    source_message_id: text(),
    created_by: text(),
    confirmed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    index("personal_memory_status_idx").on(table.status),
    index("personal_memory_source_session_idx").on(table.source_session_id),
  ],
)
