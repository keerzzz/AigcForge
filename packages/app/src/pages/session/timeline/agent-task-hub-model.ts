import type { SessionTaskInfo, SessionTaskWriteInfo } from "@aigcfroge/sdk/v2/client"
import { isScheduledTask } from "@/pages/session/timeline/session-scheduled-tasks-model"

/**
 * M4 AgentTaskHub pure model (plan §5.3 Layer 4 + §8 M4): aggregates tasks owned
 * by an agent across every session, and derives the zone-2 "任务衍生" list.
 * All functions are unit-testable and free of UI dependencies.
 */

/** A task surfaced in the hub, tagged with the session it belongs to. */
export interface AgentTaskRow extends SessionTaskInfo {
  readonly sessionID: string
}

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

/**
 * Tasks with no owning agent — the hub's "未归属" bucket. `agentID` is optional
 * on a task (M0/M1 tasks predate agent ownership), so these surface separately
 * from per-agent rows rather than being dropped by an agent filter.
 */
export const unassignedTasks = (sessionTasks: Readonly<Record<string, readonly SessionTaskInfo[]>>): AgentTaskRow[] =>
  aggregateAgentTasks(sessionTasks).filter((row) => !row.agentID)

/**
 * Step 4 agent-view management list: the selected agent's scheduled tasks
 * (one-shot `scheduledAt` or `recurrence`) across every session. Scheduled jobs
 * are just tasks, so `aggregateAgentTasks` + `isScheduledTask` narrows them.
 */
export const scheduledAgentTasks = (
  sessionTasks: Readonly<Record<string, readonly SessionTaskInfo[]>>,
  agentID?: string,
): AgentTaskRow[] => aggregateAgentTasks(sessionTasks, agentID).filter(isScheduledTask)

/** Sessions bound to an agent — the detail header's session count. */
export const sessionCountForAgent = (sessions: readonly { agent?: string }[], agentName: string): number =>
  sessions.filter((session) => session.agent === agentName).length

/** A group of derived tasks spawned from one source message. */
export interface DerivedTaskGroup {
  readonly sourceMessageID: string
  readonly rows: readonly AgentTaskRow[]
}

/**
 * M5 zone 2b (任务衍生): tasks carrying `spawnedFrom` (spawned by task_spawn),
 * grouped by their source message. Read-only aggregation across every session —
 * the same store the hub seeds on open via `GET /agent-task`.
 */
export const derivedTasksBySource = (
  sessionTasks: Readonly<Record<string, readonly SessionTaskInfo[]>>,
): DerivedTaskGroup[] => {
  const bySource = new Map<string, AgentTaskRow[]>()
  for (const [sessionID, tasks] of Object.entries(sessionTasks)) {
    for (const task of tasks) {
      if (!task.spawnedFrom) continue
      const list = bySource.get(task.spawnedFrom) ?? []
      list.push({ ...task, sessionID })
      bySource.set(task.spawnedFrom, list)
    }
  }
  return [...bySource.entries()].map(([sourceMessageID, rows]) => ({ sourceMessageID, rows }))
}

/** Build a mint-able scheduled-task write shape (task_schedule `schedule` semantics). */
export const newScheduledTask = (input: {
  content: string
  agentID: string
  scheduledAt?: number
  recurrence?: { cron: string; timezone?: string; enabled: boolean }
}): SessionTaskWriteInfo => ({
  content: input.content,
  status: "scheduled",
  priority: "medium",
  agentID: input.agentID,
  ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}),
  ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
})
