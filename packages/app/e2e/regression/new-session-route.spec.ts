import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/Aigcfroge/NewSessionRoute"
const draftID = "draft_new_session_route"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "localhost"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const draftHref = `/new-session?draftId=${encodeURIComponent(draftID)}`

const composer = (page: Page) => page.locator('[data-component="prompt-input"]')
const home = (page: Page) => page.locator('[data-component="home-overview"]')

async function installMock(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    provider: {
      all: [
        {
          id: "aigcfroge",
          name: "Aigcfroge",
          models: { "test-model": { id: "test-model", name: "Test Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["aigcfroge"],
      default: { providerID: "aigcfroge", modelID: "test-model" },
    },
    project: {
      id: "proj_new_session_route",
      worktree: directory,
      vcs: "git",
      name: "new-session-route",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
}

async function installDraft(page: Page) {
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem(
        "aigcfroge.global.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory, mode: "work", agent: "build" }]),
      )
    },
    { directory, draftID, server },
  )
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await installMock(page)
})

// RED 2026-09-13: the persisted draft pins server http://localhost:4096 but the draft route resolves 127.0.0.1:4096 only — composer never renders.
// Unlock at S4/S8 with the server host-alias owner (closure plan §7.1, §11.2).
test.fixme("directly opens a persisted draft without submitting a model request", async ({ page }) => {
  await installDraft(page)
  const writes: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(new URL(request.url()).pathname)
  })

  await page.goto(draftHref)

  await expectAppVisible(composer(page))
  await expect(page).toHaveURL(new RegExp(`/new-session\\?draftId=${draftID}$`))
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toContainText("New session")
  expect(writes).toEqual([])
})

// RED 2026-09-13: the persisted draft pins server http://localhost:4096 but the draft route resolves 127.0.0.1:4096 only — composer never renders.
// Unlock at S4/S8 with the server host-alias owner (closure plan §7.1, §11.2).
test.fixme("recovers the routed draft and its unsent prompt after refresh", async ({ page }) => {
  await installDraft(page)
  await page.goto(draftHref)
  await expectAppVisible(composer(page))
  await composer(page).fill("Keep this unsent route draft")
  await expect(composer(page)).toContainText("Keep this unsent route draft")

  await page.reload()

  await expect(page).toHaveURL(new RegExp(`/new-session\\?draftId=${draftID}$`))
  await expectAppVisible(composer(page))
  await expect(composer(page)).toContainText("Keep this unsent route draft")
})

test("redirects missing and unknown draft ids to the visible home page", async ({ page }) => {
  await installDraft(page)

  await page.goto("/new-session")
  await expect(page).toHaveURL(/\/$/)
  await expectAppVisible(home(page))

  await page.goto("/new-session?draftId=not-a-persisted-draft")
  await expect(page).toHaveURL(/\/$/)
  await expectAppVisible(home(page))
})

// RED 2026-09-13: the persisted draft pins server http://localhost:4096 but the draft route resolves 127.0.0.1:4096 only — composer never renders.
// Unlock at S4/S8 with the server host-alias owner (closure plan §7.1, §11.2).
test.fixme("hydrates prompt query while the current dirty guard blocks one-shot cleanup", async ({ page }) => {
  await installDraft(page)
  const prompt = "Draft a launch plan & list risks"
  const writes: string[] = []
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(new URL(request.url()).pathname)
  })

  await page.goto(`${draftHref}&prompt=${encodeURIComponent(prompt)}`)

  await expectAppVisible(composer(page))
  await expect(composer(page)).toContainText(prompt)
  await expect(page).toHaveURL(new RegExp(`prompt=${encodeURIComponent(prompt)}$`))
  await expect(page.getByRole("dialog", { name: "Unsaved content" })).toBeVisible()
  expect(writes).toEqual([])
})
