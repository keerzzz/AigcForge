import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import type { SessionMessagesResponse } from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"

/**
 * Opening the Assistant drawer must not replace the whole routed Session (section15.43
 * product-risk note). TanStack Solid Query's `data` accessor is a `createResource`, so a
 * query with no data yet that is still fetching suspends its reader; without a boundary of
 * its own the Assistant mode panel sends that suspension to the route boundary in
 * `layout.tsx` and the entire Session main column disappears until the read settles.
 *
 * The mode *home* slots already have this per-slot boundary in `mode-workspace.tsx`; the
 * session mode panels share the render-all contract but were missing it. This is the direct
 * E3: hold `GET /kb`, open the drawer from the nav tree, and assert the session stays visible
 * with only the panel waiting, then that the panel fills in when the read is released.
 */
const directory = "C:/Aigcfroge/AssistantPanelPending"
const projectID = "proj_assistant_panel_pending"
const sessionID = "ses_assistant_panel_pending"
const title = "Assistant panel pending"
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "assistant-panel-pending",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const session = {
  id: sessionID,
  slug: "assistant-panel-pending",
  projectID,
  directory,
  title,
  mode: "assistant",
  agent: "assistant-orchestrator",
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}

const note = {
  id: "kb_panel_pending_note",
  title: "Panel pending note",
  content: "A note that resolves after the drawer opens.",
  tags: ["panel"],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

async function mount(page: Page) {
  const gate = Promise.withResolvers<void>()
  let kbRequests = 0
  const path = (url: string) => new URL(url).pathname
  page.on("request", (request) => {
    if (request.method() === "GET" && path(request.url()) === "/kb") kbRequests += 1
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

  // Registered after mockAigcfrogeServer on purpose: the most recently registered matching
  // route runs first. Every list read waits on the gate.
  await page.route(/\/kb\?.*|\/kb$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    await gate.promise
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
  return { gate, kbRequests: () => kbRequests }
}

async function openAssistantSidebar(page: Page) {
  const toggle = page.locator("#secondary-sidebar-toggle")
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-label")) !== "Hide sidebar") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-label", "Hide sidebar")
  await expect(page.locator('[data-component="assistant-session-sidebar"]')).toBeVisible()
}

test.beforeEach(({ page }) => pinEnglishUI(page))

test("opening the drawer while its read is pending keeps the session visible", async ({ page }) => {
  const fixture = await mount(page)
  try {
    await openAssistantSidebar(page)
    await expect.poll(fixture.kbRequests).toBe(1)

    await page.getByRole("button", { name: /Dangling links/ }).click()

    // The routed Session must stay: no route-level fallback, the mode panel owns the wait.
    const modePanel = page.locator('[data-component="session-mode-panel"][data-mode="assistant"]')
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
    await expect(page.locator('[data-surface-pending="route"]')).toHaveCount(0)
    await expect(modePanel).toBeVisible()
    await expect(modePanel.locator('[data-surface-pending="slot"]')).toBeVisible()

    // Releasing the shared read fills the panel in place, and the read was shared (one GET).
    fixture.gate.resolve()
    const panel = page.locator('#review-panel[aria-label="Assistant panel"]')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(panel.locator('[data-component="assistant-kb-tab"]')).toContainText(note.title, { timeout: 15_000 })
    expect(fixture.kbRequests()).toBe(1)
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
  } finally {
    fixture.gate.resolve()
  }
})
