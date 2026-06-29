import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"
import type { MetaAgent } from "@aigcfroge/schema"

export const MetaAgentTable = sqliteTable(
  "meta_agent",
  {
    id: text().$type<MetaAgent.ID>().primaryKey(),
    title: text().notNull(),
    agent: text().notNull(),
    model: text({ mode: "json" }).notNull().$type<{
      id: string
      providerID: string
      variant?: string
    }>(),
    ...Timestamps,
    time_archived: integer(),
  },
)

export const MetaAgentSessionTable = sqliteTable(
  "meta_agent_session",
  {
    meta_agent_id: text()
      .$type<MetaAgent.ID>()
      .notNull()
      .references(() => MetaAgentTable.id, { onDelete: "cascade" }),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    role: text().$type<"orchestrator" | "worker" | "tool">().notNull().default("worker"),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.meta_agent_id, table.session_id] }),
    index("meta_agent_session_meta_agent_idx").on(table.meta_agent_id),
    index("meta_agent_session_session_idx").on(table.session_id),
  ],
)
