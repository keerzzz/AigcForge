export * as KBSQL from "./kb.sql"

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { KBNote } from "@aigcfroge/schema/kb-note"
import { Timestamps } from "../database/schema.sql"

/**
 * Knowledge base tables (PRD §7.4). The `.md` file is the content source of
 * truth (ADR-14 §2); these tables are the FTS5 index and link-edge truth
 * (ADR-14 §3). Backlinks are single-sided (source side only) + index-derived.
 */
export const KBNoteTable = sqliteTable(
  "kb_note",
  {
    id: text().$type<KBNote.NoteID>().primaryKey(),
    /** Unique within its scope — the [[link]] match key. */
    title: text().notNull(),
    content: text().notNull(),
    scope: text().$type<KBNote.NoteScope>().notNull(),
    tags: text({ mode: "json" }).$type<string[]>().notNull(),
    aliases: text({ mode: "json" }).$type<string[]>(),
    format: text().$type<KBNote.NoteFormat>().notNull().default("note"),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("kb_note_scope_title_unique").on(table.scope, table.title),
    index("kb_note_scope_idx").on(table.scope),
    index("kb_note_updated_idx").on(table.time_updated),
  ],
)

export const KBLinkTable = sqliteTable(
  "kb_link",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    source_note_id: text()
      .$type<KBNote.NoteID>()
      .notNull()
      .references(() => KBNoteTable.id, { onDelete: "cascade" }),
    /** Resolved target note, null when dangling. */
    target_note_id: text().$type<KBNote.NoteID>(),
    target_title: text().notNull(),
    link_type: text().$type<KBNote.LinkType>().notNull().default("reference"),
    dangling: integer({ mode: "boolean" }).notNull().default(false),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("kb_link_source_idx").on(table.source_note_id),
    index("kb_link_target_idx").on(table.target_note_id),
    index("kb_link_dangling_idx").on(table.dangling),
  ],
)
