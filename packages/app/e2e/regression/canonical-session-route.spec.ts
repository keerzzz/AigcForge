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

async function installServerMock(page: Parameters<typeof mockAigcfrogeServer>[0]) {
  await mockAigcfrogeServer(page, {
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

// RED 2026-09-13: the app merges the localhost:4096 tab with the 127.0.0.1:4096 canonical URL into one tab.
// Unlock at S4/S8 once the server host-alias owner lands (closure plan §7.1, §11.2).
test.fixme("keeps same-id tabs isolated when the canonical URL targets a non-current server", async ({ page }) => {
  await page.addInitScript(
    ({ activeServer, id }) => {
      localStorage.setItem(
        "aigcfroge.global.dat:tabs",
        JSON.stringify([{ type: "session", server: activeServer, sessionId: id }]),
      )
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({
          list: [{ type: "http", http: { url: "http://127.0.0.1:4096" } }],
          projects: {},
          lastProject: {},
        }),
      )
    },
    { activeServer: currentServer, id: sessionID },
  )

  const targetPath = canonicalPath(sessionID)
  const currentPath = canonicalPath(sessionID, currentServer)
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

// RED 2026-09-13: the `main` element no longer exists on this failure path; §7.2 targets a typed error page.
// Unlock at S4 with the §7.2 fail-closed rewrite.
test.fixme("leaves the main surface blank when the requested Session returns 404", async ({ page }) => {
  const missingSessionID = "ses_canonical_missing"
  await failSessionRead(page, missingSessionID)
  await gotoWhenReady(page, canonicalPath(missingSessionID))

  await expect(page.locator("main")).toBeEmpty()
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
})

// RED 2026-09-13: the product already fail-closes here ("Something went wrong" renders) — §7.2 rewrite must pin this new baseline, not the old silent one.
// Unlock at S4 with the §7.2 typed parent-missing rewrite.
test.fixme("fails silently when resolving a child whose parent returns 404", async ({ page }) => {
  await failSessionRead(page, missingParentID)
  await gotoWhenReady(page, canonicalPath(orphanSessionID))

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

test("shows an error page for a malformed server key", async ({ page }) => {
  await gotoWhenReady(page, `/server/not-valid%25/session/${sessionID}`)

  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Error Details" })).toHaveValue(/Invalid server route/)
})
