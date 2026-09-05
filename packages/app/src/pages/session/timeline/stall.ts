import type { AssistantMessage, UserMessage } from "@aigcfroge/sdk/v2"

/**
 * How long a turn may show nothing at all before the timeline calls it stalled.
 *
 * A product judgement, not a measured distribution: the report waited 40-75s on a real
 * provider before giving up, so the threshold has to sit under that to be useful and above
 * a normal slow first token to avoid crying wolf. Recorded as debt in the plan — once real
 * provider latencies are collected this should be recalibrated rather than argued about.
 */
export const STALL_THRESHOLD_MS = 60_000

/**
 * How often the timeline re-reads the clock while a turn is running. Fine enough that the
 * threshold is crossed visibly rather than a minute late, coarse enough that an idle-looking
 * page is not re-rendering constantly.
 */
export const STALL_TICK_MS = 5_000

const finite = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

/**
 * When the turn last showed a sign of life.
 *
 * Priority is fixed and tested: the newest assistant message wins, and a turn with no
 * assistant message at all falls back to when the user sent it. Anything non-finite is
 * ignored rather than treated as zero, because a missing timestamp must not read as
 * "silent since the epoch" and instantly trip the threshold.
 */
export function lastActivityAt(userMessage: UserMessage, assistantMessages: readonly AssistantMessage[]) {
  let latest: number | undefined
  for (const message of assistantMessages) {
    const created = finite(message.time.created)
    if (created !== undefined && (latest === undefined || created > latest)) latest = created
    const completed = finite(message.time.completed)
    if (completed !== undefined && (latest === undefined || completed > latest)) latest = completed
  }
  return latest ?? finite(userMessage.time.created)
}

/**
 * Whether a turn that is still running has been silent long enough to need an exit.
 *
 * `now` is undefined until the timeline's tick has produced a value, and an undefined
 * `since` means there is no trustworthy timestamp to measure from; both mean "not stalled",
 * so a missing clock can never invent the state.
 */
export function stalled(input: { since: number | undefined; now: number | undefined; thresholdMs?: number }) {
  const since = finite(input.since)
  const now = finite(input.now)
  if (since === undefined || now === undefined) return false
  return now - since >= (input.thresholdMs ?? STALL_THRESHOLD_MS)
}
