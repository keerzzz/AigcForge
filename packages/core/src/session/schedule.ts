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

/**
 * Day-loop step budget. This bounds the number of individual day advances the
 * search performs before giving up — NOT an elapsed-time horizon (differential-
 * review MEDIUM-4): month jumps are single steps, so a sparse-but-possible cron
 * (e.g. leap-day Feb 29) can legitimately resolve several years ahead within the
 * budget, while an impossible one (Feb 30) bails after 365 day-steps. The
 * original minute-scan capped at 525,600 ticks (~365 days) and would have
 * returned `undefined` for a leap-day match beyond that; the field-jump search
 * deliberately keeps those valid future matches.
 */
const MAX_DAY_STEPS = 365

/**
 * Next timestamp (ms) strictly after `from` that matches the cron, or
 * `undefined` when the expression is invalid or has no match in the window.
 *
 * Field-jumping search (differential-review MEDIUM-2): instead of scanning
 * every minute, the candidate advances month → day → hour → minute, so a sparse
 * cron (yearly, Feb 29) needs at most a few hundred day-steps rather than
 * ~525k minute-steps. After the minute loop rolls into a later hour/day, the
 * candidate is re-validated as a whole; a mismatch re-advances from the rolled
 * date, so the returned value is always the earliest full match after `from`.
 */
export const nextRun = (cron: string, from: number): number | undefined => {
  const fields = parseCron(cron)
  if (!fields) return undefined
  const candidate = new Date(from + 60_000)
  // Align to the minute boundary so the returned timestamp never carries the
  // seconds/millis of `from`; without this the trigger drifts within the
  // minute while the cron fields only match whole minutes.
  candidate.setSeconds(0, 0)
  let daySteps = 0
  while (daySteps <= MAX_DAY_STEPS) {
    while (!fields.months.has(candidate.getMonth() + 1)) {
      candidate.setMonth(candidate.getMonth() + 1, 1)
      candidate.setHours(0, 0, 0, 0)
    }
    while (!(fields.daysOfMonth.has(candidate.getDate()) && fields.daysOfWeek.has(candidate.getDay()))) {
      candidate.setDate(candidate.getDate() + 1)
      candidate.setHours(0, 0, 0, 0)
      if (++daySteps > MAX_DAY_STEPS) return undefined
    }
    while (!fields.hours.has(candidate.getHours())) {
      candidate.setHours(candidate.getHours() + 1, 0, 0, 0)
    }
    while (!fields.minutes.has(candidate.getMinutes())) {
      candidate.setMinutes(candidate.getMinutes() + 1, 0, 0)
    }
    if (matches(candidate, fields)) return candidate.getTime()
  }
  return undefined
}
