import type { Session } from "@aigcfroge/sdk/v2/client"
import type { RootLoadArgs } from "./types"
import { cmp } from "./utils"

/**
 * Merge retained store sessions with a mode-filtered fetch, deduped by id and sorted
 * by id. The sort is load-bearing: applyDirectoryEvent upserts via Binary.search,
 * which returns a wrong insertion slot on unsorted input and duplicates the row.
 */
export function mergeModeSessions(retained: Session[], fetched: Session[]) {
  return Array.from(new Map([...retained, ...fetched].map((session) => [session.id, session])).values()).sort((a, b) =>
    cmp(a.id, b.id),
  )
}

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  const query = {
    directory: input.directory,
    roots: true as const,
    ...(input.mode ? { mode: input.mode } : {}),
  }
  try {
    const result = await input.list({ ...query, limit: input.limit })
    return {
      data: result.data,
      limit: input.limit,
      limited: true,
    } as const
  } catch {
    const result = await input.list(query)
    return {
      data: result.data,
      limit: input.limit,
      limited: false,
    } as const
  }
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
