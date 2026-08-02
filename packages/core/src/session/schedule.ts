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

// A part outside [min, max] (or otherwise malformed) makes the whole field
// unparseable instead of being silently dropped — a cron like "0 25 * * *"
// must fail to parse, not persist as a job that can never match.
const parseField = (field: string, min: number, max: number): Set<number> | undefined => {
  const result = new Set<number>()
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let value = min; value <= max; value++) result.add(value)
      continue
    }
    const step = part.match(/^\*\/(\d+)$/)
    if (step) {
      const interval = Number(step[1])
      if (interval <= 0) return undefined
      for (let value = min; value <= max; value += interval) result.add(value)
      continue
    }
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start < min || end > max || start > end) return undefined
      for (let value = start; value <= end; value++) result.add(value)
      continue
    }
    if (part === "") return undefined
    const value = Number(part)
    if (!Number.isInteger(value) || value < min || value > max) return undefined
    result.add(value)
  }
  return result
}

const parseCron = (cron: string): CronFields | undefined => {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  const minutes = parseField(minute, 0, 59)
  const hours = parseField(hour, 0, 23)
  const daysOfMonth = parseField(dayOfMonth, 1, 31)
  const months = parseField(month, 1, 12)
  const daysOfWeek = parseField(dayOfWeek, 0, 7)
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return undefined
  // cron treats 7 as Sunday; the JS getDay() returns 0 for Sunday.
  if (daysOfWeek.has(7)) daysOfWeek.add(0)
  return { minutes, hours, daysOfMonth, months, daysOfWeek }
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
  const base = new Date(from + 60_000)
  // Align to the minute boundary so the returned timestamp never carries the
  // seconds/millis of `from`; without this the trigger drifts within the
  // minute while the cron fields only match whole minutes.
  base.setSeconds(0, 0)
  for (let i = 0; i < SEARCH_WINDOW_MINUTES; i++) {
    const candidate = new Date(base.getTime() + i * 60_000)
    if (matches(candidate, fields)) return candidate.getTime()
  }
  return undefined
}
