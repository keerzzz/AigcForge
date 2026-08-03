export * as TaskDag from "./dag"

/**
 * M5 DAG dependency logic (plan §8 M5): a task with `dependsOn` may only be
 * triggered once every predecessor has reached a terminal state. Pure and
 * unit-testable; the trigger gates call `blockedBy` and the scheduler rejects
 * a cyclic graph via `findCycle` before arming.
 */

export interface DagTask {
  readonly id: string
  readonly status: string
  readonly dependsOn?: string[]
}

/** Statuses that count as "done" for a DAG predecessor. */
const TERMINAL = new Set(["completed", "cancelled", "failed"])

/**
 * Predecessor ids that still block `taskID`: either not terminal, or absent.
 * Empty means the task is ready to trigger.
 */
export const blockedBy = (tasks: readonly DagTask[], taskID: string): string[] => {
  const task = tasks.find((candidate) => candidate.id === taskID)
  if (!task?.dependsOn?.length) return []
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
  return task.dependsOn.filter((pred) => {
    const predTask = byId.get(pred)
    return predTask === undefined || !TERMINAL.has(predTask.status)
  })
}

/**
 * A dependency cycle (as a closed path, e.g. `["a","b","a"]`) or `undefined`
 * when the graph is acyclic. A cycle means no task in it can ever be triggered.
 */
export const findCycle = (tasks: readonly DagTask[]): string[] | undefined => {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []

  const dfs = (id: string): string[] | undefined => {
    if (visiting.has(id)) {
      const start = path.indexOf(id)
      return [...path.slice(start), id]
    }
    if (visited.has(id)) return undefined
    visiting.add(id)
    path.push(id)
    const task = byId.get(id)
    for (const dep of task?.dependsOn ?? []) {
      const cycle = dfs(dep)
      if (cycle) return cycle
    }
    visiting.delete(id)
    path.pop()
    visited.add(id)
    return undefined
  }

  for (const task of tasks) {
    const cycle = dfs(task.id)
    if (cycle) return cycle
  }
  return undefined
}
