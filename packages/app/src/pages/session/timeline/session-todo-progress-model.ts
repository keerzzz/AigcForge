/**
 * Pure progress model for the SessionTodoProgress pulse-line (M2). All
 * boundary handling from plan §5.5 lives here as unit-testable functions:
 * status normalization (illegal → pending), divide-by-zero guards (total≤1),
 * >20 downsampling, and anchor selection (first in_progress).
 */

export type TodoProgressStatus = "pending" | "in_progress" | "completed" | "cancelled"

export interface TodoProgressInput {
  readonly id?: string
  readonly content: string
  readonly status: string
  readonly priority?: string
}

export interface TodoProgressNode {
  readonly id: string
  readonly content: string
  readonly status: TodoProgressStatus
  /** 0-100 horizontal position on the pulse line. */
  readonly pct: number
  /** True for the first in_progress node (the animation anchor). */
  readonly anchor: boolean
}

export interface TodoProgress {
  readonly total: number
  readonly done: number
  readonly doneRatio: number
  readonly nodes: TodoProgressNode[]
}

/** Above this many nodes the pulse line downsamples to first/anchor/last. */
export const DOWNSAMPLE_LIMIT = 20

export const normalizeStatus = (status: string): TodoProgressStatus => {
  switch (status) {
    case "pending":
    case "in_progress":
    case "completed":
    case "cancelled":
      return status
    default:
      return "pending"
  }
}

/** Priority stays within the TaskPriority literal for the PATCH writeback. */
export const normalizePriority = (priority: string | undefined): "high" | "medium" | "low" => {
  if (priority === "high" || priority === "low") return priority
  return "medium"
}

/** Checkbox toggle: checking an unfinished task completes it, unchecking a
 * completed one returns it to pending. Cancelled tasks stay untouched. */
export const flipTaskStatus = (status: TodoProgressStatus): TodoProgressStatus => {
  if (status === "completed") return "pending"
  if (status === "cancelled") return "cancelled"
  return "completed"
}

export const computeTodoProgress = (todos: readonly TodoProgressInput[]): TodoProgress => {
  const total = todos.length
  const done = todos.filter((todo) => todo.status === "completed").length
  const doneRatio = total === 0 ? 0 : done / total

  const pct = (i: number) => (total <= 1 ? 50 : (i / (total - 1)) * 100)

  const firstInProgress = todos.findIndex((todo) => todo.status === "in_progress")

  const raw = todos.map((todo, i) => ({
    id: todo.id ?? `todo-${i}`,
    content: todo.content,
    status: normalizeStatus(todo.status),
    pct: pct(i),
    anchor: i === firstInProgress,
  }))

  let nodes = raw
  if (total > DOWNSAMPLE_LIMIT) {
    const keep = new Set<number>([0, total - 1])
    if (firstInProgress !== -1 && firstInProgress !== 0 && firstInProgress !== total - 1) {
      keep.add(firstInProgress)
    }
    nodes = [...keep].sort((a, b) => a - b).map((i) => raw[i])
  }

  return { total, done, doneRatio, nodes }
}
