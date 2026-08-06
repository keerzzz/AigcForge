/**
 * Pure progress model for the SessionTodoProgress pulse-line (M2). All
 * boundary handling from plan §5.5 lives here as unit-testable functions:
 * status normalization (illegal → pending), divide-by-zero guards (total≤1),
 * >20 downsampling, and anchor selection (first in_progress).
 */

/** 16px unified track margin — matches index.css track/label/stats insets and the title pl-4. */
export const TRACK_INSET = 16
/** Shared width of the indeterminate activity segment. */
export const PULSE_WIDTH = 14

export type TodoProgressStatus = "pending" | "in_progress" | "completed" | "cancelled" | "scheduled" | "failed"

export interface TodoProgressInput {
  readonly id?: string
  readonly content: string
  readonly status: string
  readonly priority?: string
  /** P3-e: carried through to the fold-over writeback as expectedRevision. */
  readonly revision?: number
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
  /** Fill endpoint in the inset track's local 0-100 coordinate space. */
  readonly fillEndPct: number
  /**
   * Last completed node's local pct (0 when none). Feeds the no-anchor fill
   * endpoint and the activity pulse's completed frontier.
   */
  readonly lastCompletedPct: number
  /**
   * Indeterminate task activity, never a completion estimate. It exists only
   * when an in_progress anchor is ahead of the completed frontier; a leading
   * or single anchor relies on the node's activity glow instead of fake travel.
   */
  readonly pulse?: {
    readonly fromPct: number
    readonly toPct: number
    /**
     * Determinate pulse position (P2): when an execution source reports a 0..1
     * progress for the anchor task, the pulse rests here instead of sweeping.
     * Absent = indeterminate (sweep between fromPct and toPct).
     */
    readonly progressPct?: number
  }
  readonly nodes: TodoProgressNode[]
  /**
   * Midpoint positions (0-100) of gaps where downsampling omitted nodes
   * (plan §5.5 "只渲染首尾 + 中间省略点"). Empty unless downsampling ran.
   */
  readonly ellipsis: number[]
}

/** Above this many nodes the pulse line downsamples to first/anchor/last. */
export const DOWNSAMPLE_LIMIT = 20

export const normalizeStatus = (status: string): TodoProgressStatus => {
  switch (status) {
    case "pending":
    case "in_progress":
    case "completed":
    case "cancelled":
    case "scheduled":
    case "failed":
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
  if (status === "cancelled" || status === "scheduled") return status
  return "completed"
}

/**
 * Six-state literal accepted by the task write endpoint (persist path only).
 * Distinct from the four-state {@link TodoProgressStatus} used for rendering.
 */
export type TaskWriteStatus = "pending" | "in_progress" | "completed" | "cancelled" | "scheduled" | "failed"

/**
 * Write-side status guard (differential-review HIGH-1): preserves the full
 * six-state task status verbatim. Display normalization (`normalizeStatus`,
 * which folds scheduled/failed into pending) must NEVER run on the persist
 * path — it would flatten an unrelated scheduled/failed task to pending on
 * every checkbox interaction, and with a preserved recurrence the daemon could
 * re-arm a failed job. Only a genuinely illegal value falls back to pending.
 */
export const preserveStatus = (status: string): TaskWriteStatus => {
  switch (status) {
    case "pending":
    case "in_progress":
    case "completed":
    case "cancelled":
    case "scheduled":
    case "failed":
      return status
    default:
      return "pending"
  }
}

/**
 * Target-status transition for the interactive fold-over (explicit six-state
 * adjudication, differential-review HIGH-1): checking an unfinished task
 * completes it, unchecking a completed one returns it to pending. `cancelled`
 * and `scheduled` are not interactively togglable in the fold-over — they have
 * their own management UI (scheduled-tasks popover / Agent Hub) — so they pass
 * through unchanged and a checkbox interaction can never corrupt their state.
 */
export const flipTaskWriteStatus = (status: TaskWriteStatus): TaskWriteStatus => {
  switch (status) {
    case "completed":
      return "pending"
    case "cancelled":
    case "scheduled":
      return status
    default:
      return "completed"
  }
}

export const computeTodoProgress = (
  todos: readonly TodoProgressInput[],
  /**
   * P2: optional 0..1 progress for the anchor task (from a `task.progress` event).
   * When in range and a pulse exists, the pulse gets a determinate `progressPct`
   * (rests instead of sweeping). Out-of-range/absent = indeterminate sweep.
   */
  anchorProgress?: number,
): TodoProgress => {
  const total = todos.length
  const done = todos.filter((todo) => todo.status === "completed").length
  const doneRatio = total === 0 ? 0 : done / total

  // Geometry is local to the already-inset track element. CSS owns the 16px
  // outer margin; the model only needs stable normalized positions.
  const pct = (i: number) => (total <= 1 ? 50 : (i / (total - 1)) * 100)

  const firstInProgress = todos.findIndex((todo) => todo.status === "in_progress")

  // M7 决策 4 fill endpoint (index semantics, not the ratio): all-complete
  // runs through to 100, otherwise stop at the anchor, else the last completed
  // node, else 0. lastCompletedPct feeds fillEndPct in the no-anchor branch.
  let lastCompleted = -1
  for (let i = 0; i < total; i++) {
    if (todos[i].status === "completed") lastCompleted = i
  }
  const lastCompletedPct = lastCompleted !== -1 ? pct(lastCompleted) : 0

  // Activity is indeterminate: it says "work is happening in this interval",
  // never "the LLM is N% done". No anchor means no task pulse. A leading or
  // single anchor has no interval, so its node glow carries the activity.
  let completedFrontier = -1
  for (let i = 0; i < firstInProgress; i++) {
    if (todos[i].status === "completed") completedFrontier = i
  }
  const pulseFromPct = completedFrontier === -1 ? 0 : pct(completedFrontier)
  const pulseToPct = firstInProgress === -1 ? 0 : pct(firstInProgress)
  const hasInterval = firstInProgress > 0 && pulseFromPct < pulseToPct
  const progressPct =
    hasInterval && typeof anchorProgress === "number" && anchorProgress >= 0 && anchorProgress <= 1
      ? pulseFromPct + anchorProgress * (pulseToPct - pulseFromPct)
      : undefined
  const pulse = hasInterval
    ? {
        fromPct: pulseFromPct,
        toPct: pulseToPct,
        ...(progressPct !== undefined ? { progressPct } : {}),
      }
    : undefined

  let fillEndPct: number
  if (total === 0) {
    fillEndPct = 0
  } else if (done === total) {
    fillEndPct = 100
  } else if (firstInProgress !== -1) {
    fillEndPct = pct(firstInProgress)
  } else {
    fillEndPct = lastCompletedPct
  }

  const raw = todos.map((todo, i) => ({
    id: todo.id ?? `todo-${i}`,
    content: todo.content,
    status: normalizeStatus(todo.status),
    pct: pct(i),
    anchor: i === firstInProgress,
  }))

  let nodes = raw
  let ellipsis: number[] = []
  if (total > DOWNSAMPLE_LIMIT) {
    const keep = new Set<number>([0, total - 1])
    if (firstInProgress !== -1 && firstInProgress !== 0 && firstInProgress !== total - 1) {
      keep.add(firstInProgress)
    }
    const kept = [...keep].sort((a, b) => a - b)
    nodes = kept.map((i) => raw[i])
    ellipsis = kept.slice(1).flatMap((j, k) => {
      const i = kept[k]
      return j - i > 1 ? [(raw[i].pct + raw[j].pct) / 2] : []
    })
  }

  return {
    total,
    done,
    doneRatio,
    fillEndPct,
    lastCompletedPct,
    pulse,
    nodes,
    ellipsis,
  }
}

/**
 * Equality on the fields the legacy todo projection carries (id-less), so a V2
 * `todo.updated` echo of the same write never reads as a diverging source.
 * Also used by the mount-seed guard (M7 ⑦ NIT): discard a persisted task pull
 * when the live todo source already holds diverging data.
 */
export const sameTodoList = (a: readonly TodoProgressInput[], b: readonly TodoProgressInput[]): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.content !== y.content || x.status !== y.status || (x.priority ?? "medium") !== (y.priority ?? "medium")) {
      return false
    }
  }
  return true
}

/**
 * Pick which of the two sources drives the progress bar (plan §5.8 decision 7):
 * `task` is the id-bearing writable source (V2's real channel and V1's
 * writeback/recovery seed), `todo` is the legacy id-less projection (V1's live
 * channel and V2's per-write echo).
 *
 * Raw "later timestamp wins" is wrong here: every V2 write publishes
 * `task.updated` then a `todo.updated` echo of the same content, so the todo
 * timestamp is always the newer — that would lock writeback out permanently.
 * Instead, when both sources agree on content the id-bearing task source wins
 * (writable, and visually identical), and only a genuinely diverging source —
 * a standalone V1 `todo.updated`, including a newer *empty* list — wins by
 * recency so the seeded task pull can never freeze the live channel nor
 * resurrect tasks the user already cleared (BLOCKER-2).
 */
export const pickProgressTodos = (
  task: readonly TodoProgressInput[] | undefined,
  taskUpdatedAt: number | undefined,
  todo: readonly TodoProgressInput[] | undefined,
  todoUpdatedAt: number | undefined,
): readonly TodoProgressInput[] => {
  const taskEntries = task ?? []
  const todoEntries = todo ?? []
  if (taskEntries.length === 0) return todoEntries
  if (sameTodoList(taskEntries, todoEntries)) return taskEntries
  const taskTs = taskUpdatedAt ?? -Infinity
  const todoTs = todoUpdatedAt ?? -Infinity
  return todoTs > taskTs ? todoEntries : taskEntries
}
