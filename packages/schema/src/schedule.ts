export * as Schedule from "./schedule"

import { Schema } from "effect"
import { descending } from "./identifier"
import { withStatics } from "./schema"

/**
 * Assistant personal schedule contract (PRD §7.1/§7.2, Assistant M0).
 * One `Schedule` row is one user-confirmed personal item (M1: `reminder`)
 * with an absolute due time; a `Delivery` row is one idempotent inbox
 * delivery keyed by the schedule's stable `deliveryKey`.
 */

export const ID = Schema.String.check(Schema.isStartsWith("sch")).pipe(
  Schema.brand("ScheduleID"),
  withStatics((schema) => ({
    create: () => schema.make("sch_" + descending()),
    descending: (id?: string) => (id === undefined ? schema.make("sch_" + descending()) : schema.make(id)),
  })),
)
export type ID = typeof ID.Type

export const ScheduleKind = Schema.Literals(["reminder"]).annotate({ identifier: "ScheduleKind" })
export type ScheduleKind = typeof ScheduleKind.Type

/** pending → running → completed | failed; cancelled is terminal from any pre-terminal state. */
export const ScheduleStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "cancelled",
  "failed",
]).annotate({ identifier: "ScheduleStatus" })
export type ScheduleStatus = typeof ScheduleStatus.Type

export class Info extends Schema.Class<Info>("Schedule.Info")({
  id: ID,
  sessionID: Schema.String,
  kind: ScheduleKind,
  content: Schema.String.annotate({ description: "User-confirmed reminder text" }),
  dueAt: Schema.Number.annotate({ description: "Normalized absolute due timestamp (ms)" }),
  timezone: Schema.String.annotate({ description: "User-confirmed IANA timezone" }),
  status: ScheduleStatus,
  attempts: Schema.Number,
  nextAttemptAt: Schema.optional(Schema.Number).annotate({ description: "Bounded retry state" }),
  leaseOwner: Schema.optional(Schema.String).annotate({ description: "Temporary claim, recoverable after crash" }),
  leaseExpiresAt: Schema.optional(Schema.Number),
  deliveryKey: Schema.String.annotate({ description: "Stable idempotency key across retries" }),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export class Delivery extends Schema.Class<Delivery>("Schedule.Delivery")({
  deliveryKey: Schema.String,
  scheduleID: ID,
  sessionID: Schema.String,
  kind: ScheduleKind,
  content: Schema.String.annotate({ description: "Displayable content snapshot at delivery time" }),
  deliveredAt: Schema.Number,
  caughtUp: Schema.Boolean.annotate({ description: "True when delivered by offline catch-up after restart" }),
  createdAt: Schema.Number,
}) {}
