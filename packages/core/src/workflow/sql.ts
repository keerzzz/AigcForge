import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import type { Session as SessionSchema } from "@aigcfroge/schema/session"
import { SessionTable } from "../session/sql"

export const WorkflowRunTable = sqliteTable(
  "workflow_run",
  {
    id: text().primaryKey().$type<WorkflowAsset.WorkflowRunID>(),
    session_id: text()
      .notNull()
      .$type<SessionSchema.ID>()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    snapshot_digest: text().notNull(),
    workflow_name: text().notNull(),
    workflow_revision: text().notNull(),
    request_id: text(),
    request_digest: text(),
    parent_run_id: text().$type<WorkflowAsset.WorkflowRunID>(),
    root_run_id: text().$type<WorkflowAsset.WorkflowRunID>(),
    retry_of_step_run_id: text().$type<WorkflowAsset.StepRunID>(),
    status: text().notNull().$type<WorkflowAsset.WorkflowRunStatus>(),
    revision: integer().notNull().default(1),
    current_step_id: text(),
    error_category: text().$type<WorkflowAsset.ErrorCategory>(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
    time_completed: integer(),
  },
  (table) => [
    index("workflow_run_session_idx").on(table.session_id),
    index("workflow_run_status_idx").on(table.status),
    uniqueIndex("workflow_run_request_idx").on(table.session_id, table.request_id),
  ],
)

export const WorkflowStepRunTable = sqliteTable(
  "workflow_step_run",
  {
    id: text().primaryKey().$type<WorkflowAsset.StepRunID>(),
    run_id: text()
      .notNull()
      .$type<WorkflowAsset.WorkflowRunID>()
      .references(() => WorkflowRunTable.id, { onDelete: "cascade" }),
    step_id: text().notNull(),
    agent_id: text().notNull(),
    status: text().notNull().$type<WorkflowAsset.StepRunStatus>(),
    attempt: integer().notNull().default(1),
    revision: integer().notNull().default(1),
    task_id: text(),
    child_session_id: text(),
    input_digest: text(),
    output_digest: text(),
    branch_target: text(),
    error_category: text().$type<WorkflowAsset.ErrorCategory>(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_started: integer(),
    time_completed: integer(),
  },
  (table) => [
    index("workflow_step_run_run_idx").on(table.run_id),
    index("workflow_step_run_status_idx").on(table.status),
    uniqueIndex("workflow_step_run_run_step_attempt_idx").on(table.run_id, table.step_id, table.attempt),
  ],
)
