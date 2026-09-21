import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

/**
 * E3 coverage for plan §11.1 `offline` (Home lifecycle): the global Home must not claim an
 * account is empty when the focused server is unreachable.
 *
 * Defect measured before the fix: with `/global/health` and the session list aborted, Home
 * rendered its ordinary empty state — `No sessions found` with every mode count at 0 — and
 * the only failure signal was a toast that had already expired (`context/server-sync.tsx:434-441`
 * swallows the load rejection). That is a false statement, not a degraded one.
 *
 * Unreachability is expressed the way existing specs do it (mock-server's `MockServerConfig`
 * has no switch, and the file is shared): `page.route` abort for the health and session
 * endpoints. Registered after `mockAigcfrogeServer`, so it takes precedence over the mock's
 * catch-all `**\/*` handler.
 */
const directory = "C:/Aigcfroge/HomeServerUnreachable"
const projectID = "proj_home_server_unreachable"

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "home-server-unreachable",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const offlineNotice = (page: Page) => page.locator('[data-component="home-overview-offline"]')
const homeRows = (page: Page) => page.locator('[data-component="home-session-row"]')

const cachedSession = {
  id: "ses_cached_while_offline",
  slug: "cached-while-offline",
  projectID,
  directory,
  title: "Cached session remains visible",
  mode: "chat",
  agent: "build",
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}

/**
 * Mutable switch, consulted per request, so a case can start against a healthy server and
 * then take it away without reloading the page — the transition the one-shot cases cannot
 * express, and the only way to ask whether the offline treatment is additive.
 */
type Offline = { current: boolean }

async function openHome(page: Page, options: { sessions?: MockServerConfig["sessions"]; offline?: Offline } = {}) {
  const offline = options.offline ?? { current: false }
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider: { providers: [], default: {} },
    sessions: options.sessions ?? [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })

  // Only the mocked backend port; the dev server's own requests must pass through.
  const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  const backend = (url: string) => new URL(url).port === serverPort
  await page.route("**/global/health*", (route) =>
    offline.current ? route.abort("connectionrefused") : route.fallback(),
  )
  await page.route("**/session**", (route) =>
    offline.current && backend(route.request().url()) ? route.abort("connectionrefused") : route.fallback(),
  )

  await page.addInitScript((worktree) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] } }),
    )
  }, directory)

  await gotoWhenReady(page, "/")
  await expectAppVisible(page.locator('[data-component="home-overview"]'))
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

test.describe("regression: Home against an unreachable server", () => {
  test("says the server is unreachable instead of claiming the account is empty", async ({ page }) => {
    await openHome(page, { offline: { current: true } })

    const notice = offlineNotice(page)
    await expect(notice).toBeVisible()
    await expect(notice).toContainText("Could not reach")
    await expect(notice).toContainText(/4096/)
    await expect(notice).toContainText("Sessions can't be loaded while this server is unreachable.")
    await expect(notice).toContainText("Retrying automatically...")

    // The defect: the ordinary empty state is a claim Home cannot support offline.
    await expect(page.getByText("No sessions found")).toHaveCount(0)
  })

  test("offers the shell's server-management dialog as the way forward", async ({ page }) => {
    await openHome(page, { offline: { current: true } })

    const manage = offlineNotice(page).getByRole("button", { name: "Manage servers" })
    await expect(manage).toBeVisible()
    await manage.click()
    await expect(page.getByRole("dialog")).toBeVisible()
  })

  // Control: the offline treatment is keyed to health, not to Home being empty. A reachable
  // server with no sessions still shows the ordinary page it always did.
  test("a healthy server still shows the ordinary empty page", async ({ page }) => {
    await openHome(page)

    await expect(offlineNotice(page)).toHaveCount(0)
    await expect(page.getByText("No sessions found")).toBeVisible()
  })

  // The offline treatment is additive: a session list already loaded from a healthy server
  // must survive the health transition, with the notice above it rather than replacing it
  // with the empty state. This is the half the one-shot offline cases cannot reach, because
  // they abort the endpoints before the first load ever succeeds.
  test("keeps cached sessions visible under the offline notice", async ({ page }) => {
    const offline = { current: false }
    await openHome(page, { sessions: [cachedSession], offline })

    await expect(homeRows(page).filter({ hasText: cachedSession.title })).toBeVisible()

    offline.current = true
    // The budget must cover one poll interval (server-health.ts: pollMs), so a failure here
    // means the health poll stopped reporting, not that it was given too little time.
    await expect(offlineNotice(page)).toBeVisible({ timeout: 15_000 })
    await expect(homeRows(page).filter({ hasText: cachedSession.title })).toBeVisible()
  })
})
