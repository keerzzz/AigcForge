import { expect, test } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectSessionTitle, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/UnknownRoute"
const projectID = "proj_unknown_route"
const sessionID = "ses_known_route"
const title = "Known route session"
const selectedServer = "http://localhost:4096"

async function installServerMock(page: Parameters<typeof mockAigcfrogeServer>[0]) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "unknown-route",
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
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
})

test("invalid mode visibly recovers to the home overview", async ({ page }) => {
  await gotoWhenReady(page, "/mode/not-a-mode")

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})

test("expected current behavior: an unknown path leaves a blank main region but only shell-level recovery", async ({ page }) => {
  await gotoWhenReady(page, "/not-a-route")

  await expect(page).toHaveURL(/\/not-a-route$/)
  await expect(page.locator("main")).toBeEmpty()
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "New session", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})

test("a malformed canonical server key shows the fatal page and its restart action", async ({ page }) => {
  await gotoWhenReady(page, `/server/not-valid%25/session/${sessionID}`)

  await expect(page).toHaveURL(new RegExp(`/server/not-valid%25/session/${sessionID}$`))
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Error Details" })).toHaveValue(/Invalid server route/)
  await expect(page.getByRole("button", { name: "Restart", exact: true })).toBeVisible()
})

test("expected current behavior: an unknown server silently falls back to the selected server", async ({ page }) => {
  const unknownServer = "http://127.0.0.1:4999"
  const path = `/server/${base64Encode(unknownServer)}/session/${sessionID}`
  await gotoWhenReady(page, path)

  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expectSessionTitle(page, title)
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
  await expect(page.getByText("No server available", { exact: true })).toHaveCount(0)
})

test("expected current behavior: an unknown session crashes with an unrelated path error", async ({ page }) => {
  const path = `/server/${base64Encode(selectedServer)}/session/ses_missing_route`
  await gotoWhenReady(page, path)

  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Error Details" })).toHaveValue(
    /Cannot read properties of undefined.*isWindowsPath/s,
  )
  await expect(page.getByRole("button", { name: "Restart", exact: true })).toBeVisible()
})
