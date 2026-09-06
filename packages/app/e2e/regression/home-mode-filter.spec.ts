import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * S6 RED for P1-HOME-CUSTOM — the global Home's mode filter list is hand-copied.
 *
 * `home-overview.tsx:345-351` writes the four modes out by hand:
 *
 *   { id: "all",       label: t("home.overview.all") },
 *   { id: "coding",    label: t("mode.coding") },
 *   { id: "chat",      label: t("mode.chat") },
 *   { id: "work",      label: t("mode.work") },
 *   { id: "assistant", label: t("mode.assistant") },
 *
 * while `context/mode.tsx:6-45` `MODE_DEFINITIONS` is the five-mode contract that
 * `ModeSwitcher` already renders unconditionally (`mode-switcher.tsx:39`). Every other layer
 * is already five-wide: `countByMode` (`home-overview-model.ts:5`) counts custom, the filter
 * state is typed `"all" | Mode`, and the sidebar takes `Record<Mode, number>`. Only the
 * rendering of the list forked, and the fork dropped one entry.
 *
 * Two separate claims, because they fail for different reasons:
 *   1. the list must be the definitions, in their order — not "contains custom", which a
 *      sixth hand-written line would also satisfy;
 *   2. selecting Custom must actually filter to Custom rows, so the entry is not decorative.
 *
 * The order in `MODE_DEFINITIONS` is chat → coding → work → assistant → custom, which is not
 * the hand-written order, so deriving changes what the user sees. That is intended: one
 * source of truth decides the order, and `ModeSwitcher` already uses that one.
 */
const directory = "C:/Aigcfroge/HomeCustomFilter"
const projectID = "proj_home_custom_filter"
const created = 1700000000000

const customSessionID = "ses_home_custom"
const chatSessionID = "ses_home_chat"
const customTitle = "Custom composition run"
const chatTitle = "Chat about the repo"

const session = (id: string, title: string, mode: string, time: number) => ({
  id,
  slug: id,
  projectID,
  directory,
  title,
  mode,
  agent: "build",
  version: "dev",
  time: { created: time, updated: time },
})

const filters = (page: Page) => page.locator('[data-component="home-overview-mode-filter"]')
const homeRow = (page: Page, title: string) =>
  page.locator('[data-component="home-overview"]').getByText(title, { exact: true })

async function openHome(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "home-custom-filter",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [session(chatSessionID, chatTitle, "chat", created), session(customSessionID, customTitle, "custom", created + 1000)],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    // Home only lists sessions from projects the user has opened, and that list is
    // client-side. Same seeding as `home-mode-ownership.spec.ts:70-80`.
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)
  await page.goto(`/${base64Encode(directory)}`)
  await page.goto("/")
  await expectAppVisible(page.locator('[data-component="home-overview"]'))
}

test.describe("regression: Home mode filters come from the mode definitions", () => {
  test("the filter list is All plus every defined mode, in the definitions' order", async ({ page }) => {
    await openHome(page)

    // Length and order together. A sixth hand-written line would pass a "contains Custom"
    // assertion; only the sequence pins the list to its source.
    await expect(filters(page)).toHaveCount(6)
    await expect(filters(page)).toHaveText([/^All/, /^Chat/, /^Coding/, /^Work/, /^Assistant/, /^Custom/])
  })

  test("selecting Custom lists the custom session and hides the others", async ({ page }) => {
    await openHome(page)

    // Both are visible unfiltered, so the filter has something to do.
    await expectAppVisible(homeRow(page, chatTitle))
    await expect(homeRow(page, customTitle)).toBeVisible()

    await filters(page).filter({ hasText: "Custom" }).click()

    await expect(homeRow(page, customTitle)).toBeVisible()
    await expect(homeRow(page, chatTitle)).toHaveCount(0)
  })
})
