import type { SessionTaskInfo } from "@aigcfroge/sdk/v2/client"

/**
 * M4 AgentTaskHub pure model (plan §5.3 Layer 4 + §8 M4): aggregates tasks owned
 * by an agent across every session, and derives the zone-2 "任务衍生" list.
 * All functions are unit-testable and free of UI dependencies.
 */

/** A task surfaced in the hub, tagged with the session it belongs to. */
export interface AgentTaskRow extends SessionTaskInfo {
  readonly sessionID: string
}

/** Terminal statuses are not "active" work items. */
const ACTIVE_STATUSES = new Set(["scheduled", "pending", "in_progress"])

/**
 * Flatten every session's task list into rows, optionally narrowed to one
 * owning agent (`task.agentID`). Sessions with no tasks drop out.
 */
export const aggregateAgentTasks = (
  sessionTasks: Readonly<Record<string, readonly SessionTaskInfo[]>>,
  agentID?: string,
): AgentTaskRow[] => {
  const rows: AgentTaskRow[] = []
  for (const [sessionID, tasks] of Object.entries(sessionTasks)) {
    for (const task of tasks) {
      if (agentID !== undefined && task.agentID !== agentID) continue
      rows.push({ ...task, sessionID })
    }
  }
  return rows
}

/** Count of scheduled/pending/in_progress tasks in a row set. */
export const activeTaskCount = (rows: readonly AgentTaskRow[]): number =>
  rows.filter((row) => ACTIVE_STATUSES.has(row.status)).length

/** Row count broken down by status, ordered by the TaskStatus literal order. */
export const countByStatus = (rows: readonly AgentTaskRow[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1
  return counts
}
