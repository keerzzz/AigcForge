export * as SessionTask from "./session-task"

import { Schema } from "effect"

/**
 * Task/Todo unified contract. Phase strategy (see docs/plan/todo-task-system-upgrade.md §5.2):
 * - M0: id/content/status/priority/parentID/sessionID
 * - M1.5: outputDigest (Work ProgressLedger alignment)
 * - M3: agentID/scheduledAt/recurrence (+ derived nextRun)
 * - M5: spawnedFrom/dependsOn
 * Derived values (never stored): currentStepIndex = first non-completed step;
 * canResume = exists a failed|in_progress step.
 */
export const TaskStatus = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "scheduled",
  "failed",
]).annotate({ identifier: "TaskStatus" })
export type TaskStatus = typeof TaskStatus.Type

export const TaskPriority = Schema.Literals(["high", "medium", "low"]).annotate({
  identifier: "TaskPriority",
})
export type TaskPriority = typeof TaskPriority.Type

// Value record persisted as a JSON column and exchanged as a plain object over
// HTTP, so a Struct (not a Class) keeps encode/decode working without instance
// wrapping.
export const TaskRecurrence = Schema.Struct({
  cron: Schema.String,
  timezone: Schema.optional(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "TaskRecurrence" })
export type TaskRecurrence = typeof TaskRecurrence.Type

export class Info extends Schema.Class<Info>("SessionTask.Info")({
  id: Schema.String.annotate({ description: "Stable task ID (tsk_ prefixed, time-ordered)" }),
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: TaskStatus,
  priority: TaskPriority,
  sessionID: Schema.String.annotate({ description: "Owning session scope" }),
  parentID: Schema.optional(Schema.String).annotate({
    description: "Parent task ID for subtask support",
  }),
  // ── M2: TaskPanel reload-recovery persistence (folded from M1.5) ──
  outputDigest: Schema.optional(Schema.String).annotate({
    description: "Incremental step output digest (Work ProgressLedger)",
  }),
  // ── M3: scheduled jobs ──
  agentID: Schema.optional(Schema.String).annotate({ description: "Owning agent" }),
  scheduledAt: Schema.optional(Schema.Number).annotate({
    description: "Scheduled trigger timestamp (ms)",
  }),
  recurrence: Schema.optional(TaskRecurrence),
  nextRun: Schema.optional(Schema.Number).annotate({
    description: "Next trigger timestamp (ms); derived, only set for scheduled/pending tasks",
  }),
  // ── M5: spawning & DAG ──
  spawnedFrom: Schema.optional(Schema.String).annotate({
    description: "Message ID this task was spawned from",
  }),
  dependsOn: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Predecessor task IDs (DAG dependencies)",
  }),
  // P3-a: optimistic-concurrency revision. Server-managed (never client-supplied):
  // new tasks start at 1, every write increments, expectedRevision rejects stale writes.
  revision: Schema.Number.annotate({
    description: "Server-managed revision (increments on every write; expectedRevision rejects stale writes)",
  }),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}
