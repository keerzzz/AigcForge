import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import type { SessionMessagesResponse } from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"

/**
 * Direct E3 for the shared query observer when the Assistant drawer closes mid-refetch
 * (section15.43, `session-hidden-mode-effects` closed-panel in-flight/shared-observer).
 *
 * Two earlier attempts opened the drawer while an Assistant read was still pending; the
 * route Suspense boundary then stayed on `surface-pending` until that read settled. That
 * is TanStack Solid Query's resource-backed `data` accessor suspending on a query that has
 * no data yet (see the 2026-10-18 diagnosis in the ledger), not a fixture problem — so this
 * flow starts from loaded data: open the KB tab, start a shared refetch through the note
 * editor's own invalidation path, hold that refetch with a route gate, close the drawer,
 * and assert the nav tree (the remaining shared observer) still receives the result and
 * reopening never replays the read.
 */
const directory = "C:/Aigcfroge/AssistantClosedPanel"
const projectID = "proj_assistant_closed_panel"
const sessionID = "ses_assistant_closed_panel"
const title = "Assistant closed panel"
const noteID = "kb_closed_panel_note"
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "assistant-closed-panel",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const session = {
  id: sessionID,
  slug: "assistant-closed-panel",
  projectID,
  directory,
  title,
  mode: "assistant",
  agent: "assistant-orchestrator",
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}

const note = {
  id: noteID,
  title: "Closed panel note",
  content: "A note served before the drawer was closed.",
  tags: ["panel"],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

type Observed = {
  kbRequests: number
  kbResponses: number[]
  kbFailures: string[]
}

async function mount(page: Page) {
  const gate = Promise.withResolvers<void>()
  const observed: Observed = { kbRequests: 0, kbResponses: [], kbFailures: [] }
  const path = (url: string) => new URL(url).pathname

  page.on("request", (request) => {
    if (request.method() !== "GET") return
    if (path(request.url()) === "/kb") observed.kbRequests += 1
  })
  page.on("response", (response) => {
    if (response.request().method() !== "GET") return
    if (path(response.url()) === "/kb") observed.kbResponses.push(response.status())
  })
  page.on("requestfailed", (request) => {
    if (request.method() !== "GET") return
    if (path(request.url()) === "/kb") observed.kbFailures.push(request.failure()?.errorText ?? "failed")
  })

  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider: { all: [], connected: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
    canonicalMessages: () => ({ data: [], cursor: {} }) satisfies SessionMessagesResponse,
    events: () => [],
    eventRetry: 16,
  })

  // Registered after mockAigcfrogeServer on purpose: Playwright runs the most recently
  // registered matching route first. The first list read resolves immediately; every later
  // list read (the editor's invalidation refetch) is held by the gate.
  let listReads = 0
  await page.route(/\/kb\?.*|\/kb$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    listReads += 1
    if (listReads > 1) await gate.promise
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify([note]),
    })
  })
  await page.route(/\/kb\/dangling(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "[]",
    }),
  )
  await page.route(/\/kb\/kb_closed_panel_note\/backlinks(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "[]",
    }),
  )
  await page.route(/\/kb\/kb_closed_panel_note(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(note),
    }),
  )

  await page.addInitScript(
    (input) => {
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [{ type: "http", http: { url: input.server } }], projects: {}, lastProject: {} }),
      )
      localStorage.setItem("aigcfroge.global.dat:mode-view", JSON.stringify({ currentMode: "assistant" }))
      localStorage.setItem(
        "aigcfroge.global.dat:tabs",
        JSON.stringify([{ type: "session", server: input.server, dirBase64: input.dir, sessionId: input.sessionID }]),
      )
    },
    { server, dir: base64Encode(directory), sessionID },
  )

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: 15_000 })
  return { gate, observed }
}

async function openAssistantSidebar(page: Page) {
  const toggle = page.locator("#secondary-sidebar-toggle")
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-label")) !== "Hide sidebar") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-label", "Hide sidebar")
  await expect(page.locator('[data-component="assistant-session-sidebar"]')).toBeVisible()
}

test.beforeEach(({ page }) => pinEnglishUI(page))

test("closing the drawer during a shared refetch keeps the observer and does not replay", async ({ page }) => {
  const fixture = await mount(page)
  try {
    await openAssistantSidebar(page)
    await expect.poll(() => fixture.observed.kbRequests).toBe(1)
    await expect.poll(() => fixture.observed.kbResponses).toEqual([200])

    const panel = page.locator('#review-panel[aria-label="Assistant panel"]')
    const kbTab = panel.locator('[data-component="assistant-kb-tab"]')
    const editor = panel.locator('[data-component="assistant-note-editor"]')
    const toggleReview = page.getByRole("button", { name: "Toggle review", exact: true })

    // Open the KB tab from the nav tree and hydrate its note list before starting any new read.
    await page.getByRole("button", { name: /Dangling links/ }).click()
    await expect(panel).toBeVisible()
    await expect(kbTab).toBeVisible()
    await kbTab.getByRole("button", { name: /Closed panel note/ }).click()
    await expect(panel.getByRole("button", { name: "Edit note", exact: true })).toBeVisible()

    // Open the editor tab; it loads the note through GET /kb/:id, not the list.
    await panel.getByRole("button", { name: "Edit note", exact: true }).click()
    const body = editor.getByRole("textbox", { name: /Markdown body/ })
    await expect(body).toHaveValue(note.content, { timeout: 15_000 })
    await body.fill(`${note.content} Edited while the drawer closes.`)

    // Saving invalidates the whole assistant KB key group, which starts the shared /kb
    // refetch. It stays pending behind the gate.
    await editor.getByRole("button", { name: "Save", exact: true }).click()
    await expect.poll(() => fixture.observed.kbRequests).toBe(2)

    // Close the drawer while the refetch is in flight; the still-visible nav tree observes
    // the same query key, so `useModeQueryActivity` must not cancel it.
    await toggleReview.click()
    await expect(panel).toHaveAttribute("aria-hidden", "true")
    await expect(kbTab).toHaveCount(0)
    expect(fixture.observed.kbFailures).toEqual([])

    fixture.gate.resolve()
    await expect.poll(() => fixture.observed.kbResponses).toEqual([200, 200])
    expect(fixture.observed.kbRequests).toBe(2)
    expect(fixture.observed.kbFailures).toEqual([])
    // The visible nav tree received the resolved data while the drawer was shut.
    await expect(page.locator('[data-nav-section="kb"]')).toContainText("1")

    // Reopening reuses the cached result: no replay of the list read. The editor tab was
    // the active one when the drawer closed, so revisit the KB tab explicitly.
    await toggleReview.click()
    await expect(panel).toHaveAttribute("aria-hidden", "false")
    await panel.getByRole("tab", { name: /Knowledge base/i }).click()
    await expect(kbTab).toContainText(note.title)
    expect(fixture.observed.kbRequests).toBe(2)
  } finally {
    fixture.gate.resolve()
  }
})
