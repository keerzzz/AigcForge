import { expect, type Page } from "@playwright/test"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { fixture } from "./session-fixture"
import { project, REMOTE_SERVER, seed, SERVER } from "./app"
import { mockRemoteServer } from "./workspace"

/** Fresh mixed-mode roots, with matching non-Coding rows older than the Home quota. */
export function homeModeSessions(codingCount = 200) {
  const base = fixture.sessions[0]

  if (!base) throw new Error("The shared Home fixture must contain a root")
  const created = base.time.created

  return [
    ...ProductMode.ID.literals.map((mode, index) => ({
      ...base,
      id: "ses_home_mode_" + mode + "_case",
      title: "Home " + mode + " session",
      mode,
      time: { created: created + index, updated: created + index },
    })),
    {
      ...base,
      id: "ses_home_mode_legacy_coding",
      title: "Home legacy coding session",
      time: { created: created + 5, updated: created + 5 },
    },
    ...Array.from({ length: codingCount }, (_, index) => ({
      ...base,
      id: "ses_home_mode_coding_" + String(index).padStart(3, "0"),
      title: "Home coding " + String(index).padStart(3, "0"),
      mode: "coding",
      time: { created: created + 100 + index, updated: created + 100 + index },
    })),
  ]
}

export function homeSessionMode(page: Page) {
  return page.getByRole("button", { name: /^Session mode(?: |$)/ })
}

export async function selectGlobalMode(page: Page, label: string) {
  const navigation = page.getByRole("navigation", { name: "Modes", exact: true })
  await expect(navigation).toBeVisible()
  await navigation.getByRole("button", { name: label, exact: true }).click()
}

export async function selectHomeSessionMode(page: Page, label: string) {
  await expect(homeSessionMode(page)).toBeEnabled()
  await homeSessionMode(page).click()
  await page.getByRole("listbox").getByRole("option", { name: label, exact: true }).click()
  await expect(homeSessionMode(page)).toHaveText(label)
}

export function waitForHomeModeList(page: Page, mode?: ProductMode.ID) {
  return page.waitForRequest((request) => {
    const url = new URL(request.url())

    return (
      request.method() === "GET" &&
      url.pathname === "/api/session" &&
      url.searchParams.get("limit") === "5000" &&
      url.searchParams.get("mode") === (mode ?? null)
    )
  })
}

/** Separate server-owned roots and a child; exact reads retain their existing contract. */
export function homeScopeSessions(scope: "local" | "remote", input: { directory?: string; projectID?: string } = {}) {
  const base = fixture.sessions[0]

  if (!base) throw new Error("The shared Home fixture must contain a root")
  const parentID = `ses_home_scope_${scope}_cached`

  return [
    { ...base, ...input, id: parentID, title: `Home ${scope} cached exact`, mode: "work" },
    { ...base, ...input, id: `ses_home_scope_${scope}_pending`, title: `Home ${scope} pending exact`, mode: "work" },
    {
      ...base,
      ...input,
      id: `ses_home_scope_${scope}_child`,
      title: `Home ${scope} child exact`,
      mode: "work",
      parentID,
    },
  ]
}

export async function mockHomeScopeServers(page: Page) {
  const directory = "/remote/home-scope"
  await mockRemoteServer(page, {
    name: "Scope server B",
    directory,
    project: project({ id: "prj_home_scope_remote", directory, name: "Scope remote project" }),
    sessions: homeScopeSessions("remote", { directory, projectID: "prj_home_scope_remote" }),
    provider: fixture.provider,
  })
  await seed(page, {
    servers: [
      { url: SERVER, name: "Scope server A" },
      { url: REMOTE_SERVER, name: "Scope server B" },
    ],
    projects: { [REMOTE_SERVER]: [{ worktree: directory, expanded: true }] },
  })

  return homeScopeSessions("local")
}

export function homeScopeProjectFixture() {
  const sessions = homeScopeSessions("local")
  const base = sessions[0]

  if (!base) throw new Error("The shared scope fixture must contain a root")
  const directory = fixture.directory + "/scope-worktree"

  return {
    sessions: [
      ...sessions,
      { ...base, id: "ses_home_scope_worktree_root", title: "Home hydrated worktree", directory },
    ],
    worktrees: [{ directory: fixture.directory }, { directory, strategy: "git" }],
  }
}

export function waitForHomeScopeList(page: Page, server = SERVER) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())

    return (
      response.request().method() === "GET" &&
      url.origin === server &&
      url.pathname === "/api/session" &&
      url.searchParams.get("limit") === "5000"
    )
  })
}

export function waitForHomeScopeGet(page: Page, sessionID: string, server = SERVER) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())

    return (
      response.request().method() === "GET" && url.origin === server && url.pathname === `/api/session/${sessionID}`
    )
  })
}
