export * as ScheduleSQL from "./schedule.sql"

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Schedule } from "@omnixa/schema/schedule"
import { Agent } from "@omnixa/schema/agent"
import { SessionMessage } from "@omnixa/schema/session-message"
import { SessionTask } from "@omnixa/schema/session-task"
import { SessionSchema } from "./schema"
import { SessionTable } from "./sql"
import { Timestamps } from "../database/schema.sql"

/**
 * Assistant personal schedule tables (PRD §7.1/§7.2). The Schedule row is the
 * list/cancel/runtime-state source of truth; the Delivery row is the idempotent
 * inbox projection keyed by the schedule's stable `deliveryKey`.
 */
export const ScheduleTable = sqliteTable(
  "schedule",
  {
    id: text().$type<Schedule.ID>().primaryKey(),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    kind: text().$type<Schedule.Kind>().notNull(),
    content: text().notNull(),
    due_at: integer().notNull(),
    timezone: text().notNull(),
    // `running` is retained only for pre-occurrence reminder claim recovery.
    status: text().$type<Schedule.RuleStatus | "running">().notNull(),
    revision: integer().notNull().default(1),
    recurrence: text({ mode: "json" }).$type<SessionTask.TaskRecurrence>(),
    target: text({ mode: "json" }).$type<typeof Schedule.Target.Encoded>(),
    execution_policy: text({ mode: "json" }).$type<typeof Schedule.ExecutionPolicy.Encoded>(),
    source_agent: text().$type<Agent.ID>(),
    task_id: text(),
    next_due_at: integer(),
    active_occurrence_id: text().$type<Schedule.OccurrenceID>(),
    bound_target_session_id: text().$type<SessionSchema.ID>(),
    last_error: text({ mode: "json" }).$type<typeof Schedule.ErrorInfo.Encoded>(),
    attempts: integer().notNull().default(0),
    next_attempt_at: integer(),
    lease_owner: text(),
    lease_expires_at: integer(),
    delivery_key: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("schedule_delivery_key_unique").on(table.delivery_key),
    index("schedule_status_due_at_idx").on(table.status, table.due_at),
    index("schedule_session_idx").on(table.session_id),
    uniqueIndex("schedule_task_unique").on(table.task_id),
    index("schedule_next_due_idx").on(table.status, table.next_due_at),
  ],
)

/** One immutable input identity and rule snapshot per scheduled occurrence. */
export const ScheduleOccurrenceTable = sqliteTable(
  "schedule_occurrence",
  {
    id: text().$type<Schedule.OccurrenceID>().primaryKey(),
    schedule_id: text()
      .$type<Schedule.ID>()
      .notNull()
      .references(() => ScheduleTable.id, { onDelete: "cascade" }),
    rule_revision: integer().notNull(),
    scheduled_at: integer().notNull(),
    status: text().$type<Schedule.OccurrenceStatus>().notNull(),
    target_session_id: text().$type<SessionSchema.ID>(),
    input_id: text().$type<SessionMessage.ID>().notNull(),
    operation_id: text().$type<SessionTask.OperationID>().notNull(),
    data: text({ mode: "json" }).$type<typeof Schedule.Occurrence.Encoded>().notNull(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("schedule_occurrence_due_unique").on(table.schedule_id, table.rule_revision, table.scheduled_at),
    uniqueIndex("schedule_occurrence_input_unique").on(table.input_id),
    uniqueIndex("schedule_occurrence_operation_unique").on(table.operation_id),
    index("schedule_occurrence_schedule_idx").on(table.schedule_id, table.time_created),
    index("schedule_occurrence_status_idx").on(table.status),
    index("schedule_occurrence_target_idx").on(table.target_session_id),
  ],
)

export const DeliveryTable = sqliteTable(
  "delivery",
  {
    delivery_key: text().primaryKey(),
    schedule_id: text()
      .$type<Schedule.ID>()
      .notNull()
      .references(() => ScheduleTable.id, { onDelete: "cascade" }),
    session_id: text()
      .$type<SessionSchema.ID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    kind: text().$type<Schedule.ScheduleKind>().notNull(),
    content: text().notNull(),
    delivered_at: integer().notNull(),
    caught_up: integer({ mode: "boolean" }).notNull().default(false),
    is_read: integer({ mode: "boolean" }).notNull().default(false),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [index("delivery_session_idx").on(table.session_id), index("delivery_schedule_idx").on(table.schedule_id)],
)
