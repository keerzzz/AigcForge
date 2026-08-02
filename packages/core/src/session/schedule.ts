export * as Schedule from "./schedule"

/**
 * Minimal minute-level cron evaluation for scheduled jobs (M3). Supports the
 * standard 5-field cron:
 *
 *   minute hour day-of-month month day-of-week
 *
 * with star, step (star/n), single values, ranges, and comma lists. No seconds
 * field, no names (@daily etc.), no timezone-aware DST handling — the scheduler
 * is a single-process in-memory minute ticker (plan §10: 分钟级 cron).
 */

type CronFields = {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
}

const parseField = (field: string, min: number, max: number): Set<number> => {
  const result = new Set<number>()
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let value = min; value <= max; value++) result.add(value)
      continue
    }
    const step = part.match(/^\*\/(\d+)$/)
    if (step) {
      const interval = Number(step[1])
      if (interval <= 0) continue
      for (let value = min; value <= max; value += interval) result.add(value)
      continue
    }
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      for (let value = start; value <= end; value++) result.add(value)
      continue
    }
    const value = Number(part)
    if (!Number.isNaN(value)) result.add(value)
  }
  return result
}

const parseCron = (cron: string): CronFields | undefined => {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  const daysOfWeek = parseField(dayOfWeek, 0, 7)
  // cron treats 7 as Sunday; the JS getDay() returns 0 for Sunday.
  if (daysOfWeek.has(7)) daysOfWeek.add(0)
  return {
    minutes: parseField(minute, 0, 59),
    hours: parseField(hour, 0, 23),
    daysOfMonth: parseField(dayOfMonth, 1, 31),
    months: parseField(month, 1, 12),
    daysOfWeek,
  }
}

// NOTE: day-of-month AND day-of-week must both match. Standard cron ORs them
// when both are restricted; the AND here is a deliberate minute-level
// simplification of the M3 scheduler (plan §10).
const matches = (date: Date, fields: CronFields): boolean =>
  fields.minutes.has(date.getMinutes()) &&
  fields.hours.has(date.getHours()) &&
  fields.months.has(date.getMonth() + 1) &&
  fields.daysOfMonth.has(date.getDate()) &&
  fields.daysOfWeek.has(date.getDay())

/** Search cap: ~1 year of minute ticks, bounded so a bad schedule cannot spin. */
const SEARCH_WINDOW_MINUTES = 525_600

/**
 * Next timestamp (ms) strictly after `from` that matches the cron, or
 * `undefined` when the expression is invalid or has no match in the window.
 */
export const nextRun = (cron: string, from: number): number | undefined => {
  const fields = parseCron(cron)
  if (!fields) return undefined
  const start = from + 60_000
  const base = new Date(start)
  for (let i = 0; i < SEARCH_WINDOW_MINUTES; i++) {
    const candidate = new Date(base.getTime() + i * 60_000)
    if (matches(candidate, fields)) return candidate.getTime()
  }
  return undefined
}
