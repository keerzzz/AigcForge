export * as DelegationSql from "./sql"

import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { SessionTable } from "../session/sql"
import type { ID as DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import type { ID as SessionID } from "@aigcfroge/schema/session-id"
import type {
  DelegationStatus,
  ParticipantRole,
  ParticipantContext,
  ParticipantPhase,
  TurnKind,
  TurnStatus,
  DeliveryIntent,
  RevisionDigest,
} from "@aigcfroge/schema/delegation"

export const DelegationTable = sqliteTable(
  "delegation",
  {
    id: text().$type<DelegationID>().primaryKey(),
    parent_session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    meta_agent_id: text(),
    title: text().notNull(),
    status: text().$type<DelegationStatus>().notNull(),
    latest_revision_digest: text().$type<RevisionDigest>(),
    rejection_blocked: integer().$type<0 | 1>().notNull().default(0),
    rejection_reason: text(),
    rejection_participant_id: text().$type<ParticipantID>(),
    last_activity_at: integer().notNull(),
    time_completed: integer(),
    time_closed: integer(),
    time_archived: integer(),
    ...Timestamps,
  },
  (table) => [
    index("delegation_parent_session_idx").on(table.parent_session_id),
    index("delegation_status_idx").on(table.status),
  ],
)

export const DelegationParticipantTable = sqliteTable(
  "delegation_participant",
  {
    id: text().$type<ParticipantID>().primaryKey(),
    delegation_id: text()
      .$type<DelegationID>()
      .notNull()
      .references(() => DelegationTable.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    target: text().notNull(),
    role: text().$type<ParticipantRole>().notNull(),
    context: text().$type<ParticipantContext>().notNull(),
    phase: text().$type<ParticipantPhase>().notNull(),
    child_session_id: text().$type<SessionID>(),
    external_thread_id: text(),
    last_activity_at: integer().notNull(),
    time_closed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("delegation_participant_delegation_idx").on(table.delegation_id),
    index("delegation_participant_child_session_idx").on(table.child_session_id),
  ],
)

export const DelegationTurnTable = sqliteTable(
  "delegation_turn",
  {
    id: text().$type<TurnID>().primaryKey(),
    delegation_id: text()
      .$type<DelegationID>()
      .notNull()
      .references(() => DelegationTable.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    kind: text().$type<TurnKind>().notNull(),
    status: text().$type<TurnStatus>().notNull(),
    prompt_summary: text(),
    evidence_digest: text(),
    revision_digest: text(),
    participant_ids: text({ mode: "json" }).$type<ParticipantID[]>().notNull(),
    delivery: text().$type<DeliveryIntent>().notNull(),
    ...Timestamps,
  },
  (table) => [uniqueIndex("delegation_turn_delegation_seq_idx").on(table.delegation_id, table.seq)],
)
