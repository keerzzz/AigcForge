import type { Session } from "@aigcfroge/sdk/v2/client"
import { DateTime } from "luxon"
import type { LocalProject } from "@/context/layout"
import { displayName, projectForSession, sortedRootSessions } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"

// Pure data owner for the Home / mode-home Session lists, split out of
// `home-shared.tsx`. The split is what makes these functions testable at all:
// `home-shared.tsx` reaches `@solidjs/router` through `@/context/tabs`, and the
// router throws "Client-only API called on the server side" the moment a bun
// test imports it. Everything here is deliberately free of JSX and of any
// context *value* import, so `home-sessions.test.ts` can call the production
// owner instead of asserting on its source text.

export const HOME_SESSION_LIMIT = 64

export type HomeSessionRecord = {
  session: Session
  project: LocalProject
  projectName: string
}

export type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

// Only the two fields this module reads, mirroring the local `SessionStore` shape
// `layout/helpers.ts` already declares for `sortedRootSessions`. Taking
// `Pick<ServerSync, "child">` instead would demand a full
// `[State, SetStoreFunction<State>]` tuple from every caller, which is more than
// this function uses and more than a test can build without a cast.
type HomeSessionStore = {
  session?: Session[]
  path: { directory: string }
}

type HomeSessionSync = {
  child: (directory: string, options: { bootstrap: boolean }) => readonly [HomeSessionStore, ...unknown[]]
}

// Same reasoning as `HomeSessionSync`: `groupSessions` only ever looks up bucket
// titles, so it asks for a translator rather than the whole language context. The
// real `useLanguage().t` widens the key to `string | number` and takes optional
// params, which is assignable here.
type HomeSessionLabels = {
  t: (key: string) => string
}

/**
 * Collects root Sessions across the given project directories into display
 * records, most recent activity first.
 *
 * De-duplicates by `directory:id`. The duplicate is real: callers build the
 * directory list as `projects.flatMap(p => [p.worktree, ...p.sandboxes])`, so a
 * linked worktree that is registered as its own project *and* listed as a sandbox
 * of its parent appears twice, and `child()` returns the same store for both.
 *
 * A Session whose project cannot be resolved is dropped rather than rendered
 * against a placeholder project.
 */
export function buildHomeSessionRecords(input: {
  sync: HomeSessionSync
  projectDirectories: () => string[]
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  return [
    ...new Map(
      input
        .projectDirectories()
        .flatMap((directory) => sortedRootSessions(input.sync.child(directory, { bootstrap: false })[0], Date.now()))
        .map((session) => [`${pathKey(session.directory)}:${session.id}`, session] as const),
    ).values(),
  ]
    .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    .flatMap((session) => {
      const project = projectForSession(session, input.projects(), input.projectByID())
      if (!project) return []
      return {
        session,
        project,
        projectName: displayName(project),
      }
    })
}

export function matchesHomeSessionSearch(record: HomeSessionRecord, query: string) {
  return `${record.session.title} ${record.projectName}`.toLowerCase().includes(query)
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.directory)}:${record.session.id}`
}

/**
 * Buckets records into today / yesterday / older by last activity, dropping
 * empty buckets. When nothing is recent the "older" bucket borrows the sidebar's
 * "recent sessions" title, so a list of only old Sessions is not labelled
 * "Older" with nothing above it.
 */
export function groupSessions(records: HomeSessionRecord[], language: HomeSessionLabels): HomeSessionGroup[] {
  records = records ?? []
  const now = DateTime.local()
  const yesterday = now.minus({ days: 1 })
  const todaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(now, "day"),
  )
  const yesterdaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(yesterday, "day"),
  )
  const olderSessions = records.filter((record) => {
    const time = DateTime.fromMillis(record.session.time.updated ?? record.session.time.created)
    return !time.hasSame(now, "day") && !time.hasSame(yesterday, "day")
  })
  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0
      ? language.t("sidebar.project.recentSessions")
      : language.t("home.sessions.group.older")

  return [
    { id: "today" as const, title: language.t("home.sessions.group.today"), sessions: todaySessions },
    { id: "yesterday" as const, title: language.t("home.sessions.group.yesterday"), sessions: yesterdaySessions },
    { id: "older" as const, title: olderTitle, sessions: olderSessions },
  ].filter((group) => group.sessions.length > 0)
}
