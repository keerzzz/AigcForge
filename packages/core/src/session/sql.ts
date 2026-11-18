import { sqliteTable, text, integer, index, primaryKey, real, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
import { SessionTask } from "@aigcfroge/schema/session-task"
import type { Composition } from "@aigcfroge/schema/composition"
import { directoryColumn, pathColumn } from "../database/path.js"
import { ProjectTable } from "../project/sql.js"
import type { SessionMessage } from "./message.js"
import type { SessionInbox } from "./inbox.js"
import type { FileDiff } from "@aigcfroge/schema/file-diff"
import type { Permission } from "@aigcfroge/schema/permission"
import type { Project } from "@aigcfroge/schema/project"
import type { SessionSchema } from "./schema.js"
import type { Workspace } from "@aigcfroge/schema/workspace"
import { Timestamps } from "../database/schema.sql.js"
import type { Instruction } from "@aigcfroge/schema/instruction"
import type { Session } from "@aigcfroge/schema/session"
import type { CompactionPayload, MovePayload, SyntheticPayload, UserPayload } from "@aigcfroge/schema/session-inbox"
import type { RevertV1 } from "@aigcfroge/schema/session-revert"
import type { Schema } from "effect"
import type { SystemContext } from "../system-context/index.js"
import type { SessionConsultation } from "@aigcfroge/schema/session-consultation"
import type { FileAttachment } from "@aigcfroge/schema/prompt"
import type { Event } from "@aigcfroge/schema/event"
import type { SessionError } from "@aigcfroge/schema/session-error"
import type { SessionGoal } from "@aigcfroge/schema/session-goal"
import type { Model } from "@aigcfroge/schema/model"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type SessionMessageData = DistributiveOmit<(typeof SessionMessage.Info)["Encoded"], "type" | "id">

export const SessionGoalTable = sqliteTable("session_goal", {
  id: text().$type<SessionGoal.ID>().primaryKey(),
  session_id: text().$type<SessionSchema.ID>().notNull().references(() => SessionTable.id, { onDelete: "cascade" }),
  revision: integer().notNull(),
  status: text().$type<SessionGoal.Status>().notNull(),
  last_round_input_id: text().$type<SessionMessage.ID>(),
  data: text({ mode: "json" }).$type<typeof SessionGoal.Info.Encoded>().notNull(),
  ...Timestamps,
}, (table) => [
  index("session_goal_session_status").on(table.session_id, table.status),
  uniqueIndex("session_goal_active").on(table.session_id).where(sql`${table.status} = 'active'`),
])

export const SessionTable = sqliteTable(
  "session_v2",
  {
    id: text().$type<SessionSchema.ID>().primaryKey(),
    project_id: text()
      .$type<Project.ID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<Workspace.ID>(),
    parent_id: text().$type<SessionSchema.ID>(),
    fork_session_id: text().$type<SessionSchema.ID>(),
    fork_boundary: text({ mode: "json" }).$type<Session.ForkBoundary>(),
    mode: text().$type<ProductMode.ID>().notNull().default(ProductMode.Default),
    slug: text().notNull(),
    directory: directoryColumn().notNull(),
    path: pathColumn(),
    title: text(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<FileDiff.LegacyInfo[]>(),
    metadata: text({ mode: "json" }).$type<Session.Metadata>(),
    cost: real().notNull().default(0),
    tokens_input: integer().notNull().default(0),
    tokens_output: integer().notNull().default(0),
    tokens_reasoning: integer().notNull().default(0),
    tokens_cache_read: integer().notNull().default(0),
    tokens_cache_write: integer().notNull().default(0),
    unknown_price_attempts: integer(),
    missing_usage_attempts: integer(),
    revert: text({ mode: "json" }).$type<Session.Revert | RevertV1>(),
    permission: text({ mode: "json" }).$type<Permission.Ruleset>(),
    permission_tier: text().$type<PermissionTier.ID>().notNull().default(PermissionTier.Default),
    attended: integer().$type<0 | 1>().default(0),
    agent: text(),
    controller: text({ mode: "json" }).$type<Session.Controller>(),
    executor_preference: text({ mode: "json" }).$type<Session.ExecutorPreference>(),
    model: text({ mode: "json" }).$type<typeof Model.Selection.Encoded>(),
    ...Timestamps,
    time_idle: integer(),
    time_viewed: integer(),
    idle_outcome: text().$type<NonNullable<Session.Info["outcome"]>>(),
    time_compacting: integer(),
    time_archived: integer(),
    /** The execution claim timestamp (historical column name; see SessionStore.claim). */
    time_suspended: integer(),
    resume_attempts: integer().notNull().default(0),
  },
  (table) => [
    index("session_v2_project_idx").on(table.project_id),
    index("session_v2_workspace_idx").on(table.workspace_id),
    index("session_v2_parent_idx").on(table.parent_id),
    index("session_v2_project_mode_time_updated_idx").on(table.project_id, table.mode, table.time_updated),
    index("session_v2_directory_mode_time_updated_idx").on(table.directory, table.mode, table.time_updated),
    index("session_v2_time_suspended_idx")
      .on(table.time_suspended)
      .where(sql`${table.time_suspended} is not null`),
  ],
)

export const TaskTable = sqliteTable(
  "task",
  {
    id: text().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().$type<SessionTask.TaskStatus>().notNull(),
    priority: text().$type<SessionTask.TaskPriority>().notNull(),
    parent_id: text(),
    // M2: incremental step output digest (Work ProgressLedger) — TaskPanel
    // reload-recovery reads it back after a page refresh.
    output_digest: text(),
    // M3: scheduled jobs — owning agent, next trigger, and repetition rule.
    agent_id: text(),
    scheduled_at: integer(),
    recurrence: text({ mode: "json" }).$type<SessionTask.TaskRecurrence>(),
    // M5: spawning & DAG — originating message and predecessor task ids.
    spawned_from: text(),
    depends_on: text({ mode: "json" }).$type<readonly string[]>(),
    // P3-a: optimistic-concurrency revision (server-managed, increments on every write).
    revision: integer().notNull().default(1),
    operation_id: text().$type<SessionTask.OperationID>(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [index("task_session_idx").on(table.session_id)],
)

/** Task deletion preserves independent operation history; only source Session deletion cascades. */
export const TaskOperationTable = sqliteTable(
  "task_operation",
  {
    source_session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    operation_id: text().$type<SessionTask.OperationID>().notNull(),
    task_id: text(),
    input_id: text().$type<SessionMessage.ID>().notNull().unique(),
    target_session_id: text().$type<SessionSchema.ID>(),
    phase: text().$type<SessionTask.OperationPhase>().notNull(),
    data: text({ mode: "json" }).$type<typeof SessionTask.OperationInfo.Encoded>().notNull(),
    event_seq: integer().notNull().default(-1),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.source_session_id, table.operation_id] }),
    index("task_operation_task_idx").on(table.source_session_id, table.task_id, table.time_created),
    index("task_operation_target_idx").on(table.target_session_id, table.phase),
    index("task_operation_source_phase_idx").on(table.source_session_id, table.phase, table.time_created),
  ],
)

export const SessionMessageTable = sqliteTable(
  "session_message",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<SessionMessage.Type>().notNull(),
    seq: integer().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<SessionMessageData>(),
  },
  (table) => [
    uniqueIndex("session_message_session_seq_idx").on(table.session_id, table.seq),
    index("session_message_session_type_seq_idx").on(table.session_id, table.type, table.seq),
    index("session_message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id),
    index("session_message_time_created_idx").on(table.time_created),
  ],
)

export const SessionInputResultTable = sqliteTable(
  "session_input_result",
  {
    input_id: text()
      .$type<SessionMessage.ID>()
      .primaryKey()
      .references(() => SessionMessageTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    anchor_input_id: text().$type<SessionMessage.ID>().notNull(),
    operation_ref: text({ mode: "json" }).$type<SessionTask.OperationReadonlyRef>(),
    joined_event_id: text().$type<Event.ID>().notNull(),
    joined_event_seq: integer().notNull(),
    status: text().$type<"processing" | "completed" | "failed" | "interrupted" | "unverified">().notNull(),
    assistant_message_id: text().$type<SessionMessage.ID>(),
    terminal_event_id: text().$type<Event.ID>(),
    terminal_event_seq: integer(),
    error: text({ mode: "json" }).$type<SessionError.Error>(),
  },
  (table) => [
    index("session_input_result_anchor_idx").on(table.session_id, table.anchor_input_id),
    index("session_input_result_status_idx").on(table.session_id, table.status),
  ],
)

export const SessionPendingTable = sqliteTable(
  "session_pending",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<SessionInbox.Info["type"]>().notNull(),
    data: text({ mode: "json" }).$type<UserPayload | SyntheticPayload | Record<string, never>>().notNull(),
    delivery: text().$type<SessionInbox.Delivery>(),
    admitted_seq: integer().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("session_pending_session_delivery_seq_idx").on(table.session_id, table.delivery, table.admitted_seq),
    uniqueIndex("session_pending_session_compaction_idx")
      .on(table.session_id)
      .where(sql`${table.type} = 'compaction'`),
    uniqueIndex("session_pending_session_admitted_seq_idx").on(table.session_id, table.admitted_seq),
  ],
)

export const SessionInboxTable = sqliteTable(
  "session_inbox",
  {
    id: text().$type<SessionMessage.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    type: text().$type<SessionInbox.Info["type"]>().notNull(),
    payload: text({ mode: "json" }).$type<UserPayload | SyntheticPayload | CompactionPayload | MovePayload>().notNull(),
    delivery: text().$type<SessionInbox.Delivery>().notNull(),
    enqueued_seq: integer().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("session_inbox_session_delivery_seq_idx").on(table.session_id, table.delivery, table.enqueued_seq),
    uniqueIndex("session_inbox_session_enqueued_seq_idx").on(table.session_id, table.enqueued_seq),
  ],
)

export const SessionConsultationTable = sqliteTable("session_consultation", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  source_session_id: text().$type<SessionSchema.ID>().notNull(),
  first_message_id: text().$type<SessionMessage.ID>().notNull().unique(),
  boundary: text({ mode: "json" }).$type<SessionConsultation.Reference["boundary"]>().notNull(),
  boundary_seq: integer().notNull(),
  source_message_ids: text({ mode: "json" }).$type<SessionConsultation.Reference["sourceMessageIDs"]>().notNull(),
  digest: text().notNull(),
  omissions: text({ mode: "json" }).$type<SessionConsultation.Reference["omissions"]>().notNull(),
  phase: text().$type<"reserved" | "admitted" | "cancelled">().notNull(),
  reference_promoted: integer({ mode: "boolean" }).notNull().default(false),
  reference_carrier_id: text().$type<SessionMessage.ID>(),
  reference_file: text({ mode: "json" }).$type<FileAttachment>(),
})

export const InstructionEntryTable = sqliteTable(
  "instruction_entry",
  {
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    key: text().notNull(),
    value: text({ mode: "json" }).$type<Schema.Json>(),
    removed: integer({ mode: "boolean" }).notNull().default(false),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.session_id, table.key] })],
)

export const InstructionBlobTable = sqliteTable("instruction_blob", {
  hash: text().$type<Instruction.Hash>().primaryKey(),
  value: text({ mode: "json" }).$type<Schema.Json>(),
})

export const InstructionStateTable = sqliteTable("instruction_state", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  epoch_start: integer().notNull(),
  through_seq: integer().notNull(),
  initial_values: text({ mode: "json" }).notNull().$type<Instruction.Values>(),
  current_values: text({ mode: "json" }).notNull().$type<Instruction.Values>(),
})

/** Fork-retained (System Context): per-session context epoch (baseline + snapshot). Migration lands with the R2 migration slice. */
export const SessionContextEpochTable = sqliteTable("session_context_epoch", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  baseline: text().notNull(),
  snapshot: text({ mode: "json" }).notNull().$type<SystemContext.Snapshot>(),
  baseline_seq: integer().notNull(),
})

export const SessionCompositionSnapshotTable = sqliteTable("session_composition_snapshot", {
  session_id: text()
    .$type<SessionSchema.ID>()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  version: integer().notNull().default(1),
  digest: text().notNull(),
  profile_path: text(),
  profile_revision: text(),
  data: text({ mode: "json" }).notNull().$type<Composition.SnapshotData>(),
  time_created: integer()
    .notNull()
    .$default(() => Date.now()),
})
