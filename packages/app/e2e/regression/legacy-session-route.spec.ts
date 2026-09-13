import { expect, test } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectSessionTitle, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/LegacySession"
const projectID = "proj_legacy_session"
const sessionID = "ses_legacy_session"
const title = "Legacy session"
const server = "http://localhost:4096"
const legacyBase = `/${base64Encode(directory)}/session`
const canonicalPath = `/server/${base64Encode(server)}/session/${sessionID}`

async function installServerMock(page: Parameters<typeof mockAigcfrogeServer>[0]) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "legacy-session",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        mode: "work",
        agent: "build",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await installServerMock(page)
  await page.addInitScript((projectDirectory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({
        list: [],
        projects: { local: [{ worktree: projectDirectory, expanded: true }] },
        lastProject: {},
      }),
    )
  }, directory)
})

test("replaces an id-bearing legacy URL with the canonical session URL", async ({ page }) => {
  await gotoWhenReady(page, "/mode/chat")
  await page.goto(`${legacyBase}/${sessionID}`)

  await expect(page).toHaveURL(new RegExp(`${canonicalPath}$`))
  await expectSessionTitle(page, title)
  await expect(page.getByRole("button", { name: "Work", exact: true })).toHaveAttribute("aria-pressed", "true")

  await page.goBack()
  await expect(page).toHaveURL(/\/mode\/chat$/)
})

test("creates a draft from an id-less legacy URL", async ({ page }) => {
  await gotoWhenReady(page, legacyBase)

  await expect(page).toHaveURL(/\/new-session\?draftId=[^&#]+$/, { timeout: 30_000 })
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toContainText("New session")
  await expect(page.getByRole("textbox").first()).toBeVisible()
})

test("drops query and hash while redirecting an id-bearing legacy URL", async ({ page }) => {
  await gotoWhenReady(page, `${legacyBase}/${sessionID}?insert=legacy-context#message-old`)

  await expect(page).toHaveURL(new RegExp(`${canonicalPath}$`))
  await expectSessionTitle(page, title)
  expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toEqual({
    search: "",
    hash: "",
  })
})

test("drops query and hash when an id-less legacy URL creates a draft", async ({ page }) => {
  await gotoWhenReady(page, `${legacyBase}?prompt=legacy-prompt#legacy-anchor`)

  await expect(page).toHaveURL(/\/new-session\?draftId=[^&#]+$/, { timeout: 30_000 })
  expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toMatchObject({ hash: "" })
  expect(new URL(page.url()).searchParams.has("prompt")).toBe(false)
})

test("stays on an id-less legacy URL when no project is open", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("aigcfroge.global.dat:server")
  })
  await gotoWhenReady(page, legacyBase)

  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`${legacyBase}$`))
  await expect(page.locator('[data-slot="titlebar-tabs"] a')).toHaveAttribute("href", legacyBase)
})
