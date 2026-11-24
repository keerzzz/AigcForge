import type { SessionInfo, SessionListInput, SessionsResponse } from "@omnixa/client/promise"
import { ProductMode } from "@omnixa/schema/product-mode"
import { pathKey } from "@/workspaces/path-key"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "@/runtime/server/global-sync/types"
import { compareSessionMessageTime } from "./records"

export const HOME_V2_SESSION_PAGE_LIMIT = 5_000

export const HOME_SESSION_LIMIT = 64

// Rows kept per directory from the fetched index: the visible limit plus the
// recent-window search bucket. Merging locally known sessions and pending
// removals into this subset resolves exactly like merging into the complete
// index, so Home shows the same rows, order, and search results while the
// query cache and every per-update re-merge stay bounded by directory count.
export const HOME_SESSION_INDEX_LIMIT = HOME_SESSION_LIMIT + SESSION_RECENT_LIMIT

export async function loadHomeSessionIndex(
  list: (
    input: Pick<SessionListInput, "mode"> & {
      limit: number
      order: "desc"
      parentID: null
      cursor?: string
    },
    options: { signal?: AbortSignal },
  ) => Promise<SessionsResponse>,
  signal?: AbortSignal,
  mode?: ProductMode.ID,
  order: "updated" | "message" = "updated",
  activity?: (sessions: SessionInfo[], signal?: AbortSignal) => Promise<SessionInfo[]>,
) {
  const now = Date.now()
  let retained: SessionInfo[] = []
  let cursor: string | undefined

  for (;;) {
    const response = await list(
      {
        limit: HOME_V2_SESSION_PAGE_LIMIT,
        order: "desc",
        parentID: null,
        mode,
        cursor,
      },
      { signal },
    )

    // Re-rank each page with the retained subset. Message order can promote a later API page;
    // peak allocation remains one page plus the retained subset, not the whole history.
    const parsed = parseHomeSessionIndex(response.data, mode)
    retained = retainHomeSessions(
      [...retained, ...(activity ? await activity(parsed, signal) : parsed)],
      HOME_SESSION_INDEX_LIMIT,
      now,
      order,
    )

    if (response.data.length < HOME_V2_SESSION_PAGE_LIMIT || !response.cursor.next) return retained
    cursor = response.cursor.next
  }
}

// Keep this filter for locally known sessions merged into the fetched index.
export function parseHomeSessionIndex(sessions: SessionInfo[], mode?: ProductMode.ID) {
  return sessions
    .filter((session) => !session.parentID && session.time.archived === undefined)
    .filter((session) => matchesHomeSessionMode(session, mode))
}

export function mergeHomeSessionIndex(fetched: SessionInfo[], known: SessionInfo[], mode?: ProductMode.ID) {
  return parseHomeSessionIndex(
    [...new Map([...fetched, ...known].map((session) => [session.id, session] as const)).values()],
    mode,
  )
}

export function retainHomeSessions(
  sessions: SessionInfo[],
  limit: number,
  now: number,
  order: "updated" | "message" = "updated",
) {
  return [...Map.groupBy(sessions, (session) => pathKey(session.location.directory)).values()].flatMap((items) => {
    const sorted = items.toSorted(
      order === "message"
        ? compareSessionMessageTime
        : (a, b) => {
            const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)

            return updated || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
          },
    )

    const recent = sorted
      .slice(limit)
      .filter(
        (session) =>
          (order === "message"
            ? (session.time.message ?? session.time.created)
            : (session.time.updated ?? session.time.created)) >
          now - SESSION_RECENT_WINDOW,
      )
      .slice(0, SESSION_RECENT_LIMIT)

    return [...sorted.slice(0, limit), ...recent]
  })
}

/** Session.Info decodes an omitted wire mode to the existing ProductMode.Default. */
export function matchesHomeSessionMode(session: Pick<SessionInfo, "mode">, mode?: ProductMode.ID) {
  return mode === undefined || (session.mode ?? ProductMode.Default) === mode
}
