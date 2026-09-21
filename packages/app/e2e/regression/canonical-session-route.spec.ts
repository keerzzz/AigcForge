import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectSessionTitle, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/CanonicalSession"
const projectID = "proj_canonical_session"
const sessionID = "ses_canonical_session"
const rootSessionID = "ses_canonical_root"
const childSessionID = "ses_canonical_child"
const orphanSessionID = "ses_canonical_orphan"
const missingParentID = "ses_canonical_missing_parent"
const title = "Canonical session"
const rootTitle = "Canonical root session"
const childTitle = "Canonical child session"
const server = "http://127.0.0.1:4096"
const currentServer = "http://localhost:4096"

const session = (id: string, sessionTitle: string, parentID?: string) => ({
  id,
  slug: id,
  projectID,
  directory,
  title: sessionTitle,
  mode: "work",
  agent: "build",
  version: "dev",
  parentID,
  time: { created: 1700000000000, updated: 1700000000000 },
})

async function installServerMock(page: Parameters<typeof mockAigcfrogeServer>[0], port?: string) {
  await mockAigcfrogeServer(page, {
    port,
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "canonical-session",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      session(sessionID, title),
      session(rootSessionID, rootTitle),
      session(childSessionID, childTitle, rootSessionID),
      session(orphanSessionID, "Canonical orphan session", missingParentID),
    ],
    pageMessages: () => ({ items: [] }),
  })
}

const canonicalPath = (sessionId: string, serverKey = server) =>
  `/server/${base64Encode(serverKey)}/session/${sessionId}`

async function failSessionRead(page: Page, sessionId: string) {
  await page.route(`http://127.0.0.1:4096/session/${sessionId}`, (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ name: "NotFoundError", message: `Session not found: ${sessionId}` }),
    }),
  )
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await installServerMock(page)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
})

test("cold-loads and refreshes the canonical session URL", async ({ page }) => {
  const path = canonicalPath(sessionID)
  await gotoWhenReady(page, path)

  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expectSessionTitle(page, title)
  await expect(page.getByRole("button", { name: "Work", exact: true })).toHaveAttribute("aria-pressed", "true")

  await page.reload()
  await expectSessionTitle(page, title)
  await expect(page).toHaveURL(new RegExp(`${path}$`))
})

// Host-alias ruling (plan §7.1 附则): two PHYSICALLY different servers keep
// same-id tabs isolated; one server under two host spellings is ONE tab.
test("keeps same-id tabs isolated when the canonical URL targets a non-current server", async ({ page }) => {
  const otherServer = "http://127.0.0.1:4097"
  await page.addInitScript(
    ({ activeServer, servers, id }) => {
      localStorage.setItem(
        "aigcfroge.global.dat:tabs",
        JSON.stringify([{ type: "session", server: activeServer, sessionId: id }]),
      )
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({
          list: servers.map((url) => ({ type: "http", http: { url } })),
          projects: {},
          lastProject: {},
        }),
      )
    },
    { activeServer: server, servers: [server, otherServer], id: sessionID },
  )

  await installServerMock(page)
  await installServerMock(page, "4097")

  const targetPath = canonicalPath(sessionID, otherServer)
  const currentPath = canonicalPath(sessionID, server)
  await gotoWhenReady(page, targetPath)
  await expectSessionTitle(page, title)

  const tabLinks = page.locator('[data-slot="titlebar-tabs"] a')
  await expect(tabLinks).toHaveCount(2)
  expect(await tabLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")))).toEqual([
    currentPath,
    targetPath,
  ])
  await expect(page).toHaveURL(new RegExp(`${targetPath}$`))
})

test("merges a persisted localhost-spelled tab into the canonical server tab (host alias)", async ({ page }) => {
  await page.addInitScript(
    ({ activeServer, id }) => {
      localStorage.setItem(
        "aigcfroge.global.dat:tabs",
        JSON.stringify([{ type: "session", server: activeServer, sessionId: id }]),
      )
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({
          list: [{ type: "http", http: { url: activeServer } }],
          projects: {},
          lastProject: {},
        }),
      )
    },
    { activeServer: currentServer, id: sessionID },
  )

  await installServerMock(page)
  await gotoWhenReady(page, canonicalPath(sessionID))
  await expectSessionTitle(page, title)

  // One tab — the two spellings are the same server. The rendered href keeps
  // the persisted raw spelling: identity is canonical, display is preserved.
  const tabLinks = page.locator('[data-slot="titlebar-tabs"] a')
  await expect(tabLinks).toHaveCount(1)
  await expect(tabLinks.first()).toHaveAttribute("href", canonicalPath(sessionID, currentServer))
})

test("keeps a child URL while opening one root-session tab and reuses its placement", async ({ page }) => {
  const childPath = canonicalPath(childSessionID)
  const rootPath = canonicalPath(rootSessionID)
  await gotoWhenReady(page, childPath)

  await expectSessionTitle(page, childTitle)
  await expect(page).toHaveURL(new RegExp(`${childPath}$`))
  await expect(page.getByRole("button", { name: rootTitle })).toBeVisible()
  await expect(page.getByRole("heading", { name: childTitle })).toBeVisible()
  await expect(page.getByText("Subagent sessions cannot be prompted.")).toBeVisible()
  const backToMain = page.getByRole("button", { name: /Back to main session/ })
  await expect(backToMain).toBeVisible()

  await backToMain.click()
  await expectSessionTitle(page, rootTitle)
  await expect(page).toHaveURL(new RegExp(`${rootPath}$`))
})

test("shows a typed session-not-found surface when the requested Session returns 404", async ({ page }) => {
  const missingSessionID = "ses_canonical_missing"
  await failSessionRead(page, missingSessionID)
  await gotoWhenReady(page, canonicalPath(missingSessionID))

  const surface = page.locator('[data-component="route-error"][data-route-error-kind="session-not-found"]')
  await expect(surface).toBeVisible()
  await expect(surface.getByRole("heading", { name: "Session not found" })).toBeVisible()
  await expect(surface).toContainText(missingSessionID)
  // A failed resolution must not claim a tab for the session it could not load.
  await expect(page.locator('[data-slot="titlebar-tabs"] a')).toHaveCount(0)
})

test("names the missing parent when a child session's parent returns 404", async ({ page }) => {
  await failSessionRead(page, missingParentID)
  await gotoWhenReady(page, canonicalPath(orphanSessionID))

  const surface = page.locator('[data-component="route-error"][data-route-error-kind="parent-not-found"]')
  await expect(surface).toBeVisible()
  await expect(surface.getByRole("heading", { name: "Parent session missing" })).toBeVisible()
  await expect(surface).toContainText(missingParentID)
  // No half-open session: the orphan child's own title must not render.
  await expect(page.locator("main")).not.toContainText("Canonical orphan session")
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})

test("preserves query and hash on a canonical URL", async ({ page }) => {
  const path = canonicalPath(sessionID)
  await gotoWhenReady(page, `${path}?view=details#message-anchor`)

  await expectSessionTitle(page, title)
  await expect(page).toHaveURL(new RegExp(`${path}\\?view=details#message-anchor$`))
  expect(await page.evaluate(() => ({ search: location.search, hash: location.hash }))).toEqual({
    search: "?view=details",
    hash: "#message-anchor",
  })
})

test("shows a typed invalid-server surface for a malformed server key", async ({ page }) => {
  await gotoWhenReady(page, `/server/not-valid%25/session/${sessionID}`)

  const surface = page.locator('[data-component="route-error"][data-route-error-kind="invalid-server-key"]')
  await expect(surface).toBeVisible()
  await expect(surface.getByRole("heading", { name: "Invalid server link" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})
