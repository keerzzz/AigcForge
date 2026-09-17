import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, expectAppVisible } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"

/**
 * S8 measurement for coverage-manifest `project-large-list` (plan §11.1 `大列表`).
 *
 * The project list is an unbounded plain `For` (`pages/home-overview.tsx:436`) and the
 * persisted `projects[scope]` array is never trimmed, so "no cap exists" is a code fact.
 * What is not yet measured is what a list far past the current sizes actually does, and
 * that is the only thing that can decide whether a cap, a virtualised list or nothing is
 * owed. This spec seeds N projects straight into the registry store — the same shape
 * `home-mode-filter.spec.ts:86-94` uses — because the mock's `/project` only ever answers
 * `[config.project]` and knows nothing about extra entries.
 *
 * It is a measurement, not a cap or virtualisation contract. Assertions stay
 * contract-like: the app renders the rows it was given, still reacts to clicks, and
 * throws nothing. Timings are printed as `[project-list-scale]` JSON lines (raw data for
 * the report), deliberately not encoded as machine-dependent `expect` thresholds.
 */

const directory = "C:/Aigcfroge/Scale/root"
const projectID = "proj_scale_root"
const created = 1700000000000

const ROW = '[data-component="home-project-row"]'
const ALL_PROJECTS = '[data-component="home-overview-project-all"]'
const MODE_FILTER = '[data-component="home-overview-mode-filter"]'
const HOME = '[data-component="home-overview"]'

const SCALES = [0, 50, 500, 2000]

/** Registry entries are exactly `{ worktree, expanded }` (`context/server.tsx:8`). */
const seededProjects = (n: number) =>
  Array.from({ length: n }, (_, index) => ({
    worktree: `C:/Aigcfroge/Scale/p${String(index).padStart(4, "0")}`,
    expanded: true,
  }))

async function openHome(page: Page, n: number) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "project-list-scale",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    // No sessions: the projects are the only variable in this measurement.
    sessions: [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript((entries) => {
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: entries }, lastProject: {} }),
    )
  }, seededProjects(n))
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

for (const n of SCALES) {
  test(`N=${n} seeded projects render, stay interactive and throw nothing`, async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    const apiRequests: Record<string, number> = {}
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message))
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })
    // Attribution data: how much server fan-out the N-entry registry causes, by first path
    // segment (`/path`, `/provider`, `/session`, …). This is the part of the timing that is
    // per-project data loading rather than DOM.
    page.on("request", (request) => {
      const url = new URL(request.url())
      if (url.port !== serverPort) return
      const segment = url.pathname.split("/")[1] || "/"
      apiRequests[segment] = (apiRequests[segment] ?? 0) + 1
    })

    await openHome(page, n)

    // Time from just before navigation to (a) the Home shell and (b) every row in the DOM.
    const started = Date.now()
    await page.goto("/")
    await expectAppVisible(page.locator(HOME))
    const overviewMs = Date.now() - started

    const rows = page.locator(ROW)
    await expect.poll(() => rows.count(), { timeout: APP_READY_TIMEOUT }).toBe(n)
    const rowsMs = Date.now() - started
    const rowsInDom = await rows.count()

    console.log(
      `[project-list-scale] ${JSON.stringify({ n, rowsInDom, overviewMs, rowsMs, apiRequests, pageErrors: pageErrors.length, consoleErrors: consoleErrors.length })}`,
    )

    // Contract: the number of rows in the DOM is the number the registry was given.
    await expect(rows).toHaveCount(n)

    // Contract: the list is large but the controls over it still react.
    if (n > 0) {
      await rows.first().click()
      await expect(rows.first()).toHaveAttribute("data-selected", "")
      await expect(page.locator(ALL_PROJECTS)).not.toHaveAttribute("aria-current", "page")
    }
    await page.locator(ALL_PROJECTS).click()
    await expect(page.locator(ALL_PROJECTS)).toHaveAttribute("aria-current", "page")
    const chat = page.locator(MODE_FILTER).filter({ hasText: "Chat" })
    await chat.click()
    await expect(chat).toHaveAttribute("data-selected", "")

    await expect(rows).toHaveCount(n)
    console.log(
      `[project-list-scale] ${JSON.stringify({ n, interactive: true, pageErrors: pageErrors.length, consoleErrors: consoleErrors.length })}`,
    )
    // Contract: nothing threw while rendering or interacting with the list.
    expect(pageErrors).toEqual([])
  })
}
