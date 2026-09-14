import { expect, test } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/UnknownRoute"
const projectID = "proj_unknown_route"
const sessionID = "ses_known_route"
const title = "Known route session"
const selectedServer = "http://127.0.0.1:4096"

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

test("an unknown path renders a typed not-found surface with a home recovery action", async ({ page }) => {
  await gotoWhenReady(page, "/not-a-route")

  await expect(page).toHaveURL(/\/not-a-route$/)
  const surface = page.locator('[data-component="route-error"][data-route-error-kind="unknown-route"]')
  await expect(surface).toBeVisible()
  await expect(surface.getByRole("heading", { name: "Page not found" })).toBeVisible()

  await surface.getByRole("button", { name: "Go home" }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('[data-component="home-overview"]')).toBeVisible()
})

test("a malformed canonical server key renders the typed invalid-server surface, not the fatal page", async ({
  page,
}) => {
  await gotoWhenReady(page, `/server/not-valid%25/session/${sessionID}`)

  await expect(page).toHaveURL(new RegExp(`/server/not-valid%25/session/${sessionID}$`))
  const surface = page.locator('[data-component="route-error"][data-route-error-kind="invalid-server-key"]')
  await expect(surface).toBeVisible()
  await expect(surface.getByRole("heading", { name: "Invalid server link" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
  await expect(surface.getByRole("button", { name: "Go home" })).toBeVisible()
})

test("an unknown server fails closed instead of falling back to the selected server", async ({ page }) => {
  const unknownServer = "http://127.0.0.1:4999"
  const path = `/server/${base64Encode(unknownServer)}/session/${sessionID}`
  await gotoWhenReady(page, path)

  await expect(page).toHaveURL(new RegExp(`${path}$`))
  const surface = page.locator('[data-component="route-error"][data-route-error-kind="unknown-server"]')
  await expect(surface).toBeVisible()
  await expect(surface.getByRole("heading", { name: "Server not registered" })).toBeVisible()
  // The selected server has a session with this exact ID — seeing its title here
  // is precisely the silent-fallback defect this test now forbids.
  await expect(page.getByRole("heading", { name: title })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})

test("an unknown session renders a typed session-not-found surface, not a path crash", async ({ page }) => {
  const path = `/server/${base64Encode(selectedServer)}/session/ses_missing_route`
  await gotoWhenReady(page, path)

  await expect(page).toHaveURL(new RegExp(`${path}$`))
  const surface = page.locator('[data-component="route-error"][data-route-error-kind="session-not-found"]')
  await expect(surface).toBeVisible()
  await expect(surface.getByRole("heading", { name: "Session not found" })).toBeVisible()
  // The historical failure surfaced an unrelated `isWindowsPath` TypeError; the
  // diagnostics block must not leak that internal shape anymore.
  await expect(surface).not.toContainText("isWindowsPath")
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})
