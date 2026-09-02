import { describe, expect, test } from "bun:test"
import type { Session } from "@aigcfroge/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import {
  buildHomeSessionRecords,
  groupSessions,
  homeSessionSearchKey,
  matchesHomeSessionSearch,
  type HomeSessionRecord,
} from "@/pages/home-sessions"

// Replaces the source-string assertions that used to live in
// `home-owner-contract.test.tsx` (docs/testing.md §10 red line 3). Those checked
// that `home-shared.tsx` contained the text "export function groupSessions"; they
// could not fail for any behaviour reason, and they could not be written any other
// way while the owner lived in a `.tsx` that reaches `@solidjs/router` — importing
// it in a bun test throws "Client-only API called on the server side". The pure
// owner now lives in `home-sessions.ts`, so these call it.

const HOUR = 60 * 60 * 1000
// `buildHomeSessionRecords` passes `Date.now()` to `sortedRootSessions`, whose
// comparator sorts anything updated in the last minute by id instead of by time.
// Fixtures therefore sit hours in the past so the time ordering is the thing under
// test rather than that tie-break.
const ago = (hours: number) => Date.now() - hours * HOUR

const session = (over: Partial<Session> & Pick<Session, "id" | "directory">): Session => ({
  slug: over.id,
  projectID: "",
  title: "untitled",
  version: "test",
  time: { created: ago(48), updated: ago(48) },
  ...over,
})

const project = (worktree: string, over: Partial<LocalProject> = {}): LocalProject => ({
  worktree,
  expanded: false,
  ...over,
})

const syncOf = (byDirectory: Record<string, Session[]>) => ({
  child: (directory: string) => [{ session: byDirectory[directory] ?? [], path: { directory } }] as const,
})

const build = (input: { directories: string[]; sessions: Record<string, Session[]>; projects: LocalProject[] }) =>
  buildHomeSessionRecords({
    sync: syncOf(input.sessions),
    projectDirectories: () => input.directories,
    projects: () => input.projects,
    projectByID: () => new Map(input.projects.flatMap((p) => (p.id ? [[p.id, p] as const] : []))),
  })

// The production directory list, so a fixture cannot drift from how callers build it.
const directoriesOf = (projects: LocalProject[]) =>
  projects.flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])])

const record = (over: Partial<HomeSessionRecord> & { session: Session }): HomeSessionRecord => ({
  project: project("/repo"),
  projectName: "repo",
  ...over,
})

// `groupSessions` asks only for a translator, so the stub needs no cast; the keys
// are asserted raw because which key each bucket uses is the thing under test.
const languageStub = { t: (key: string) => key }

describe("buildHomeSessionRecords", () => {
  test("collapses a Session reached twice because its worktree is also a sandbox entry", () => {
    // `/repo/wt` is registered as its own project AND listed as a sandbox of
    // `/repo`, so the production directory list names it twice and `child()`
    // returns the same store both times. Note the duplicate cannot come from a
    // Session "appearing under" a sibling directory: `sortedRootSessions` only
    // yields Sessions whose own `directory` equals the store's, so a duplicated
    // directory in the list is the only way one Session is seen twice.
    const projects = [project("/repo", { sandboxes: ["/repo/wt"] }), project("/repo/wt")]
    const directories = directoriesOf(projects)
    expect(directories.filter((directory) => directory === "/repo/wt")).toHaveLength(2)

    const records = build({
      directories,
      sessions: { "/repo/wt": [session({ id: "ses_a", directory: "/repo/wt" })] },
      projects,
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.session.id).toBe("ses_a")
  })

  test("drops a Session whose project cannot be resolved instead of inventing one", () => {
    const records = build({
      directories: ["/repo", "/gone"],
      sessions: {
        "/repo": [session({ id: "ses_keep", directory: "/repo" })],
        "/gone": [session({ id: "ses_orphan", directory: "/gone" })],
      },
      projects: [project("/repo")],
    })

    expect(records.map((item) => item.session.id)).toEqual(["ses_keep"])
  })

  test("orders by last activity, preferring updated over created", () => {
    const records = build({
      directories: ["/repo"],
      sessions: {
        "/repo": [
          session({ id: "ses_old", directory: "/repo", time: { created: ago(2), updated: ago(10) } }),
          session({ id: "ses_new", directory: "/repo", time: { created: ago(50), updated: ago(3) } }),
        ],
      },
      projects: [project("/repo")],
    })

    // ses_new was created first but touched most recently, so it leads.
    expect(records.map((item) => item.session.id)).toEqual(["ses_new", "ses_old"])
  })

  test("excludes child Sessions, archived Sessions and Sessions from another directory", () => {
    const records = build({
      directories: ["/repo"],
      sessions: {
        "/repo": [
          session({ id: "ses_root", directory: "/repo" }),
          session({ id: "ses_child", directory: "/repo", parentID: "ses_root" }),
          session({ id: "ses_archived", directory: "/repo", time: { created: ago(9), updated: ago(9), archived: 1 } }),
          session({ id: "ses_elsewhere", directory: "/other" }),
        ],
      },
      projects: [project("/repo"), project("/other")],
    })

    expect(records.map((item) => item.session.id)).toEqual(["ses_root"])
  })

  test("names the project from its own name, falling back to the worktree basename", () => {
    const records = build({
      directories: ["/srv/named", "/srv/unnamed"],
      sessions: {
        "/srv/named": [session({ id: "ses_1", directory: "/srv/named" })],
        "/srv/unnamed": [session({ id: "ses_2", directory: "/srv/unnamed" })],
      },
      projects: [project("/srv/named", { name: "Explicit" }), project("/srv/unnamed")],
    })

    expect(records.map((item) => item.projectName).sort()).toEqual(["Explicit", "unnamed"])
  })

  test("resolves the project by id even when the directory does not match a worktree", () => {
    const records = build({
      directories: ["/checkout"],
      sessions: { "/checkout": [session({ id: "ses_1", directory: "/checkout", projectID: "prj_1" })] },
      projects: [project("/elsewhere", { id: "prj_1", name: "ById" })],
    })

    expect(records.map((item) => item.projectName)).toEqual(["ById"])
  })
})

describe("matchesHomeSessionSearch", () => {
  const target = record({ session: session({ id: "ses_1", directory: "/repo", title: "Fix Login Bug" }) })

  test("matches on the Session title and on the project name", () => {
    expect(matchesHomeSessionSearch(target, "login")).toBe(true)
    expect(matchesHomeSessionSearch(target, "repo")).toBe(true)
    expect(matchesHomeSessionSearch(target, "logout")).toBe(false)
  })

  test("expects the caller to lower-case the query", () => {
    // Both call sites (`home-overview.tsx`, `mode-workspace-slots.tsx`) do
    // `search().toLowerCase()` first. Only the record side is normalised here, so
    // an unnormalised query silently matches nothing — pinned so a new caller that
    // forgets is a test failure rather than an empty result list.
    expect(matchesHomeSessionSearch(target, "Login")).toBe(false)
  })
})

describe("homeSessionSearchKey", () => {
  test("is stable across directory spellings that name the same path", () => {
    const plain = record({ session: session({ id: "ses_1", directory: "/repo" }) })
    const trailing = record({ session: session({ id: "ses_1", directory: "/repo/" }) })

    expect(homeSessionSearchKey(trailing)).toBe(homeSessionSearchKey(plain))
  })

  test("separates two Sessions with the same id under different directories", () => {
    const here = record({ session: session({ id: "ses_1", directory: "/a" }) })
    const there = record({ session: session({ id: "ses_1", directory: "/b" }) })

    expect(homeSessionSearchKey(here)).not.toBe(homeSessionSearchKey(there))
  })
})

describe("groupSessions", () => {
  const at = (id: string, ms: number) =>
    record({ session: session({ id, directory: "/repo", time: { created: ms, updated: ms } }) })

  test("buckets by last activity and omits empty buckets", () => {
    const groups = groupSessions([at("ses_today", Date.now()), at("ses_old", ago(24 * 30))], languageStub)

    expect(groups.map((group) => group.id)).toEqual(["today", "older"])
    expect(groups[0]?.sessions.map((item) => item.session.id)).toEqual(["ses_today"])
    expect(groups[1]?.sessions.map((item) => item.session.id)).toEqual(["ses_old"])
  })

  test("borrows the sidebar's recent-sessions title when nothing is recent", () => {
    // With no today/yesterday bucket above it, a lone "Older" heading reads as if
    // something were missing, so the title changes instead.
    const onlyOld = groupSessions([at("ses_old", ago(24 * 30))], languageStub)
    expect(onlyOld.map((group) => group.title)).toEqual(["sidebar.project.recentSessions"])

    const withToday = groupSessions([at("ses_today", Date.now()), at("ses_old", ago(24 * 30))], languageStub)
    expect(withToday.map((group) => group.title)).toEqual(["home.sessions.group.today", "home.sessions.group.older"])
  })

  test("returns no groups for an empty list", () => {
    expect(groupSessions([], languageStub)).toEqual([])
  })
})
