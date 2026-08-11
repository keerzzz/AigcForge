export * as ScheduleSQL from "./schedule.sql"

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { Schedule } from "@aigcfroge/schema/schedule"
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
    kind: text().$type<Schedule.ScheduleKind>().notNull(),
    content: text().notNull(),
    due_at: integer().notNull(),
    timezone: text().notNull(),
    status: text().$type<Schedule.ScheduleStatus>().notNull(),
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
  (table) => [
    index("delivery_session_idx").on(table.session_id),
    index("delivery_schedule_idx").on(table.schedule_id),
  ],
)
