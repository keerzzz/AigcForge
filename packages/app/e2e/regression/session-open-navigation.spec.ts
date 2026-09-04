import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * Opening a session record commits its client-side navigation.
 *
 * `openSessionRecord` (`pages/layout/helpers.ts:245`) runs inside `startTransition`, so
 * the URL and the DOM only change once Solid resolves that transition — and
 * `@solidjs/router` writes history in the transition's `.finally()`. A resource left
 * registered in `Transition.promises` therefore wedges the navigation with no error, no
 * pending request and no visible symptom other than "clicking a session does nothing".
 *
 * That is what happened: `useSessionSnapshotCommands` used a source accessor that turns
 * `undefined` when there is no session id, and Solid's `load()` takes an early branch for
 * a null source that skips `Transition.promises.delete(pr)`. `loadEnd`'s own delete is
 * guarded by `loadedUnderTransition`, which that same call had just recomputed as
 * `Transition.running` — false once the transition body has run. The already-settled
 * promise stayed in the set forever, so `Transition.promises.size` never reached 0.
 *
 * Measured causally before the fix: evicting that one set entry and clicking again landed
 * the navigation immediately, while a second click without the eviction did nothing.
 */
const directory = "C:/Aigcfroge/SessionOpenNavigation"
const projectID = "proj_session_open_navigation"
const firstSessionID = "ses_open_nav_first"
const targetSessionID = "ses_open_nav_target"
const firstTitle = "First seeded session"
const targetTitle = "Target seeded session"

const homeRow = (page: Page, title: string) =>
  page.locator('[data-component="home-session-row"]').filter({ hasText: title })

const session = (id: string, title: string, mode: string, created: number) => ({
  id,
  slug: id,
  projectID,
  directory,
  title,
  mode,
  agent: "meta",
  version: "dev",
  time: { created, updated: created },
})

test.describe("regression: opening a session record navigates", () => {
  test("clicking a session row on Home lands on that session", async ({ page }) => {
    await mockAigcfrogeServer(page, {
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "session-open-navigation",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: { providers: [], default: {} },
      sessions: [
        session(firstSessionID, firstTitle, "chat", 1700000000000),
        session(targetSessionID, targetTitle, "work", 1700000001000),
      ],
      pageMessages: () => ({ items: [] }),
      events: () => [],
      eventRetry: 16,
    })
    await page.addInitScript((worktree: string) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
      )
    }, directory)

    // Home only lists sessions from projects the client already has open, and a seeded
    // `Persist.global` entry alone does not do it — visiting one session does.
    await page.goto(`/${base64Encode(directory)}/session/${firstSessionID}`)
    await expectAppVisible(page.getByRole("heading", { name: firstTitle }))

    await page.goto("/")
    await expectAppVisible(homeRow(page, targetTitle))

    await homeRow(page, targetTitle).click()

    // The observable contract of the click: history moved and the session rendered.
    // Both matter — the wedge wrote the tab record and called `navigate()` with the
    // right href, so a tab-store assertion would have passed the whole time.
    await expect(page).toHaveURL(new RegExp(`/server/[^/]+/session/${targetSessionID}$`))
    await expectAppVisible(page.getByRole("heading", { name: targetTitle }))
  })
})
