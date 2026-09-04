import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * S0 baseline for P2-HOME-EMPTY — the global Home's "new session" action when the
 * user has no opened project.
 *
 * `home-overview.tsx:159-172` is two silent early returns:
 *
 *   function openNewSession() {
 *     const conn = focusedServer()
 *     const ctx = focusedServerCtx()
 *     if (!conn || !ctx) return          // :162  connection missing
 *     const directory = newSessionDirectory()
 *     if (!directory) return             // :164  no project — this one
 *     launchModeSession({ ... })
 *   }
 *
 * `newSessionDirectory()` (`:144-157`) falls back to `projects()[0]?.worktree`, so with
 * an empty opened-project list it is `undefined` and `:164` fires: no navigation, no
 * dialog, no toast. That is the reported symptom.
 *
 * Home lists (and creates from) the projects the user has OPENED, held client-side under
 * `aigcfroge.global.dat:server` — see the same seeding note in
 * `home-mode-ownership.spec.ts:70-80`. Seeding `projects.local` as `[]` is therefore the
 * faithful no-project state, not a server-side trick.
 *
 * Two assertions, deliberately opposite in polarity:
 *   1. some feedback must appear — RED today (the whole defect);
 *   2. no generic `POST /session` may be issued — passes today, and must keep passing
 *      once (1) is fixed, because the fix must not paper over the missing directory by
 *      creating a session anyway.
 */
const directory = "C:/Aigcfroge/HomeEmptyNewSession"
const projectID = "proj_home_empty_new_session"

const newSessionButton = (page: Page) =>
  page.locator('[data-component="home-overview"]').locator('[data-action="home-new-session"]')

async function openHomeWithoutProjects(page: Page) {
  const sessionPosts: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    if (new URL(request.url()).pathname !== "/session") return
    sessionPosts.push(request.url())
  })

  await mockAigcfrogeServer(page, {
    directory,
    // The server still knows about a project; what is empty is the client-side opened
    // list. That separation is the point — the defect is reachable on a fresh profile
    // against a perfectly healthy backend.
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "home-empty-new-session",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })

  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [] }, lastProject: {} }),
    )
  })

  await page.goto("/")
  await expectAppVisible(page.locator('[data-component="home-overview"]'))
  return { sessionPosts }
}

test.describe("regression: global Home new session without a project", () => {
  test("clicking new session with no opened project gives visible feedback", async ({ page }) => {
    const { sessionPosts } = await openHomeWithoutProjects(page)

    const button = newSessionButton(page)
    await expect(button).toHaveCount(1)
    await button.click()

    // A directory/project picker is a dialog; an inline "add a project first" hint is an
    // alert. Either is acceptable feedback — silence is not. Both roles are the app's own
    // semantics, not markers added for this test.
    await expect(page.getByRole("dialog").or(page.getByRole("alert")).first()).toBeVisible({ timeout: 10_000 })

    // Whatever the feedback turns out to be, it must not have created a session behind it.
    expect(sessionPosts).toEqual([])
  })

  test("clicking new session with no opened project does not navigate away from Home", async ({ page }) => {
    const { sessionPosts } = await openHomeWithoutProjects(page)

    await newSessionButton(page).click()

    // Recorded as the current non-regression half: with no directory there is nothing to
    // open, so staying on `/` is correct. It is asserted so a future fix cannot start
    // routing to a draft that will fail its first send.
    await expect(page).toHaveURL(/\/$/)
    expect(sessionPosts).toEqual([])
  })
})
