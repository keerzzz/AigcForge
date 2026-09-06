import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * S7 for P1-HOME-CUSTOM-NEW — "new session" while the persisted mode is Custom.
 *
 * `mode.currentMode` is the last mode the user was in (`mode.tsx:89-99`, stored under
 * `aigcfroge.global.dat:mode-view`), so after any visit to `/mode/custom` it stays `"custom"`.
 * Home and the Titlebar both passed it straight to `launchModeSession`, which builds an
 * ordinary draft — and `core/product-mode-policy.assertCreationSupported` rejects generic
 * creation for custom, because a custom session is created atomically from a composition
 * snapshot. The draft was therefore guaranteed to fail on its first send: reachable, silent,
 * and typed as fine, since the parameter was the whole five-mode union.
 *
 * Two assertions per entry point, and the negative one is the load-bearing half: arriving at
 * the Builder is only correct if no ordinary session was created on the way.
 */
const directory = "C:/Aigcfroge/HomeCustomNew"
const projectID = "proj_home_custom_new"
const created = 1700000000000

const newSessionButton = (page: Page) =>
  page.locator('[data-component="home-overview"]').locator('[data-action="home-new-session"]')

async function openHomeInMode(page: Page, mode: string) {
  const sessionPosts: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    if (new URL(request.url()).pathname !== "/session") return
    sessionPosts.push(request.url())
  })

  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "home-custom-new",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })

  await page.addInitScript(
    (input: { worktree: string; mode: string }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      // `currentMode` is the last mode the user was in. Set here rather than in a second
      // `addInitScript`, because init scripts run in order and the later one would win.
      localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: input.mode }))
      // A project is opened, so the no-project path (S6) is not what is measured here.
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [], projects: { local: [{ worktree: input.worktree, expanded: true }] }, lastProject: {} }),
      )
    },
    { worktree: directory, mode },
  )

  await page.goto("/")
  await expectAppVisible(page.locator('[data-component="home-overview"]'))
  return { sessionPosts }
}

test.describe("regression: new session in custom mode goes to the Builder", () => {
  test("Home routes to the custom Builder instead of creating a draft", async ({ page }) => {
    const { sessionPosts } = await openHomeInMode(page, "custom")

    await newSessionButton(page).click()

    await expect(page).toHaveURL(/\/mode\/custom$/)
    // The half that makes the redirect meaningful: nothing was created on the way, so there is
    // no orphaned draft whose first send would be rejected.
    expect(sessionPosts).toEqual([])
  })

  test("a creatable mode still takes the ordinary draft path from Home", async ({ page }) => {
    // The other side of the branch, so the fix cannot become "Home never creates anything".
    const { sessionPosts } = await openHomeInMode(page, "chat")

    await newSessionButton(page).click()

    // A draft tab is a client-side route, not a POST — the session is created on first send.
    await expect(page).not.toHaveURL(/\/mode\/custom$/)
    expect(sessionPosts).toEqual([])
  })
})
