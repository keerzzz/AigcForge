import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/sql"
import { Timestamps } from "../database/schema.sql"
import type { MetaAgent } from "@omnixa/schema"
import type { Model } from "@omnixa/schema/model"
import type { ModelGroup } from "@omnixa/schema/model-group"

export const MetaAgentTable = sqliteTable("meta_agent", {
  id: text().$type<MetaAgent.ID>().primaryKey(),
  title: text().notNull(),
  agent: text().notNull(),
  model: text({ mode: "json" }).notNull().$type<typeof Model.Selection.Encoded>(),
  group_behavior: text({ mode: "json" }).$type<typeof ModelGroup.BehaviorSnapshot.Encoded>(),
  ...Timestamps,
  time_archived: integer(),
})

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
    effort: text(),
    tokens_used: integer(),
    error: text(),
    result_summary: text(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.meta_agent_id, table.session_id] }),
    index("meta_agent_session_meta_agent_idx").on(table.meta_agent_id),
    index("meta_agent_session_session_idx").on(table.session_id),
  ],
)

export const MetaAgentStepTable = sqliteTable(
  "meta_agent_step",
  {
    id: text().primaryKey(),
    meta_agent_session_id: text().notNull(),
    meta_agent_id: text().$type<MetaAgent.ID>(),
    root_session_id: text(),
    event_id: text(),
    event_seq: integer(),
    event_type: text(),
    assistant_message_id: text(),
    tool_call_id: text(),
    provenance: text({ mode: "json" }).$type<Record<string, unknown>>(),
    seq: integer().notNull(),
    type: text().$type<"subagent" | "external-cli" | "tool" | "model" | "retry" | "receipt">().notNull(),
    engine: text().notNull(),
    status: text().$type<"pending" | "running" | "completed" | "failed">().notNull(),
    prompt: text(),
    result: text(),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    index("meta_agent_step_session_idx").on(table.meta_agent_session_id),
    uniqueIndex("meta_agent_step_event_idx").on(table.meta_agent_id, table.event_id),
    uniqueIndex("meta_agent_step_owner_seq_idx").on(table.meta_agent_id, table.meta_agent_session_id, table.seq),
  ],
)

export const MetaAgentMemoryTable = sqliteTable(
  "meta_agent_memory",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    meta_agent_id: text()
      .$type<MetaAgent.ID>()
      .notNull()
      .references(() => MetaAgentTable.id, { onDelete: "cascade" }),
    fact_category: text().$type<"code_trap" | "protocol" | "api" | "workflow">().notNull(),
    content: text().notNull(),
    source_session_id: text(),
    source_step_id: text(),
    ...Timestamps,
  },
  (table) => [index("meta_agent_memory_project_idx").on(table.project_id)],
)
