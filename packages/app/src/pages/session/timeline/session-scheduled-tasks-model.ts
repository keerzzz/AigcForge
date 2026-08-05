import type { SessionTaskInfo } from "@aigcfroge/sdk/v2/client"

/**
 * Pure scheduled-task model for the M3b-2 session title UI (plan §5.6). All
 * derivation and formatting lives here as unit-testable functions:
 * scheduled-task selection, next-run reduction, timestamp formatting, and the
 * pause/resume status mapping that mirrors the task_schedule tool.
 *
 * SDK number fields are typed `number | "NaN" | ...` (heyapi JSON-number
 * union), so every numeric read goes through `finite` guards instead of
 * trusting the type.
 */

export type ScheduledTaskInput = Pick<
  SessionTaskInfo,
  "id" | "content" | "status" | "priority" | "scheduledAt" | "recurrence" | "nextRun"
>

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

/** A task is a scheduled job when it carries a one-shot time or a recurrence. */
export const isScheduledTask = (task: ScheduledTaskInput): boolean =>
  finite(task.scheduledAt) || task.recurrence !== undefined

/** Pause/resume semantics (task_schedule tool): checked = scheduled, unchecked = cancelled. */
export const isScheduledActive = (status: string): boolean => status === "scheduled" || status === "pending"

export const scheduledToggleStatus = (checked: boolean): "scheduled" | "cancelled" =>
  checked ? "scheduled" : "cancelled"

/**
 * Earliest upcoming trigger across the session's scheduled tasks: the smallest
 * finite `nextRun` among scheduled/pending tasks. Terminal statuses never
 * carry `nextRun` (derived server-side), so they drop out naturally.
 */
export const nextScheduledRun = (tasks: readonly ScheduledTaskInput[]): number | undefined => {
  const runs = tasks
    .filter(
      (task): task is ScheduledTaskInput & { nextRun: number } =>
        isScheduledActive(task.status) && finite(task.nextRun),
    )
    .map((task) => task.nextRun)
  if (runs.length === 0) return undefined
  return Math.min(...runs)
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * Title-chip timestamp (plan §5.6: `⚡ 9:00` / `⚡ 周一 9:00`): same-day runs
 * show the time only, later days add the short weekday. Uses the app's locale
 * (`language.intl()`) via Intl, no new dependency.
 */
export const formatNextRun = (timestamp: number, intl: string, now = Date.now()): string => {
  const date = new Date(timestamp)
  if (sameDay(date, new Date(now))) {
    return new Intl.DateTimeFormat(intl, { hour: "numeric", minute: "2-digit" }).format(date)
  }
  return new Intl.DateTimeFormat(intl, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(date)
}

/** Full timestamp for the chip tooltip. */
export const formatFullTime = (timestamp: number, intl: string): string =>
  new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))
