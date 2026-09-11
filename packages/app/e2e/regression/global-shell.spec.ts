import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"

// English-label, desktop-geometry spec — pin the UI language and viewport so the
// zh/zht and narrow presentation projects stay green (see utils/locale.ts, utils/viewport.ts).
test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

/**
 * Global shell coverage: the chrome that wraps every route — ModeSwitcher rail,
 * titlebar tab strip and history, multi-session tabs, the dirty-draft route guard,
 * the status bar, and the connection gate that decides whether the app renders at all.
 *
 * These surfaces are shared by every page, so a defect here degrades all five modes
 * and the session detail view at once. Each describe pins one surface; the mock
 * server keeps the data deterministic (see utils/mock-server.ts).
 */
const directory = "C:/Aigcfroge/GlobalShell"
const projectID = "proj_global_shell"
const sessionA = "ses_global_shell_a"
const sessionB = "ses_global_shell_b"
const titleA = "Global shell A"
const titleB = "Global shell B"
const created = 1700000000000

const model = { providerID: "aigcfroge", modelID: "test-model", variant: "max" }

const userMessageA = {
  info: {
    id: "msg_global_shell_a",
    sessionID: sessionA,
    role: "user" as const,
    time: { created },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_global_shell_a",
      sessionID: sessionA,
      messageID: "msg_global_shell_a",
      type: "text",
      text: "Summarise this repo.",
    },
  ],
}

function baseConfig(): MockServerConfig {
  return {
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
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "global-shell",
      time: { created, updated: created },
      sandboxes: [],
    },
    sessions: [
      {
        id: sessionA,
        slug: "global-shell-a",
        projectID,
        directory,
        title: titleA,
        mode: "chat",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
      {
        id: sessionB,
        slug: "global-shell-b",
        projectID,
        directory,
        title: titleB,
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: (sessionID) => ({ items: sessionID === sessionA ? [userMessageA] : [] }),
  }
}

async function installServerMock(page: Page) {
  await mockAigcfrogeServer(page, baseConfig())
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
}

function modeButton(page: Page, label: string) {
  // Scoped to the switcher rail: "Custom"/"Work" can legitimately appear as button
  // names inside the mode surfaces themselves.
  return page.locator('nav[aria-label="Mode switcher"]').getByRole("button", { name: label, exact: true })
}

async function openSession(page: Page, sessionID: string, title: string) {
  await installServerMock(page)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
}

const MODES = [
  { label: "Chat", href: "/mode/chat", slot: "chat" },
  { label: "Coding", href: "/mode/coding", slot: "coding" },
  { label: "Work", href: "/mode/work", slot: "work" },
  { label: "Assistant", href: "/mode/assistant", slot: "assistant" },
  { label: "Custom", href: "/mode/custom", slot: "custom" },
] as const

const tabs = (page: Page) => page.locator('[data-slot="titlebar-tabs"]')
const homeButton = (page: Page) => page.getByRole("button", { name: "Home", exact: true })

test.describe("global shell: mode switcher rail", () => {
  test("renders all five mode buttons and presses exactly the active one", async ({ page }) => {
    await installServerMock(page)
    await page.goto("/mode/coding")
    await expectAppVisible(page.locator("[data-mode-workspace]"))

    for (const mode of MODES) await expect(modeButton(page, mode.label)).toBeVisible()
    await expect(modeButton(page, "Coding")).toHaveAttribute("aria-pressed", "true")
    for (const mode of MODES.filter((mode) => mode.label !== "Coding")) {
      await expect(modeButton(page, mode.label)).toHaveAttribute("aria-pressed", "false")
    }
  })

  test("clicking each mode navigates and swaps the visible sidebar and main slots", async ({ page }) => {
    await installServerMock(page)
    await page.goto("/mode/chat")
    await expectAppVisible(page.locator("[data-mode-workspace]"))

    for (const mode of MODES) {
      await modeButton(page, mode.label).click()
      await expect(page).toHaveURL(new RegExp(`${mode.href}$`))
      await expect(modeButton(page, mode.label)).toHaveAttribute("aria-pressed", "true")
      await expect(page.locator(`[data-mode-sidebar="${mode.slot}"]`)).toBeVisible()
      await expect(page.locator(`[data-mode-main="${mode.slot}"]`)).toBeVisible()
    }
  })

  test("the assistant icon shows the pending schedule count as a rail badge", async ({ page }) => {
    await installServerMock(page)
    await page.route("**/schedule/pending", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify([{ id: "sch_pending_1" }]),
      }),
    )
    await page.goto("/mode/chat")
    await expectAppVisible(page.locator("[data-mode-workspace]"))

    await expect(page.locator('nav[aria-label="Mode switcher"]').getByText("1")).toBeVisible()
  })
})

test.describe("global shell: titlebar history", () => {
  test("mod+[ and mod+] traverse the in-app history stack", async ({ page }) => {
    await installServerMock(page)
    await page.goto("/mode/chat")
    await expectAppVisible(page.locator("[data-mode-workspace]"))

    await modeButton(page, "Work").click()
    await expect(page).toHaveURL(/\/mode\/work$/)

    await page.keyboard.press("ControlOrMeta+[")
    await expect(page).toHaveURL(/\/mode\/chat$/)
    await page.keyboard.press("ControlOrMeta+[")
    await expect(page).toHaveURL(/\/$/)
    await page.keyboard.press("ControlOrMeta+]")
    await expect(page).toHaveURL(/\/mode\/chat$/)
    await page.keyboard.press("ControlOrMeta+]")
    await expect(page).toHaveURL(/\/mode\/work$/)
  })
})

test.describe("global shell: multi-session tabs", () => {
  test("opening a second session adds a tab each and switches between them", async ({ page }) => {
    await openSession(page, sessionA, titleA)
    await page.goto(`/${base64Encode(directory)}/session/${sessionB}`)
    await expectSessionTitle(page, titleB)

    await expect(tabs(page).locator("a", { hasText: titleA })).toBeVisible()
    await expect(tabs(page).locator("a", { hasText: titleB })).toBeVisible()

    await tabs(page).locator("a", { hasText: titleA }).click()
    await expect(page).toHaveURL(new RegExp(`session/${sessionA}$`))
    await expectSessionTitle(page, titleA)
  })

  test("closing a background tab keeps the active session and URL", async ({ page }) => {
    await openSession(page, sessionA, titleA)
    await page.goto(`/${base64Encode(directory)}/session/${sessionB}`)
    await expectSessionTitle(page, titleB)

    const before = page.url()
    const backgroundTab = tabs(page).locator("a", { hasText: titleA })
    await backgroundTab.locator("xpath=..").locator("button").click()

    await expect(page).toHaveURL(before)
    await expectSessionTitle(page, titleB)
    await expect(tabs(page).locator("a", { hasText: titleA })).toHaveCount(0)
  })

  test("closing the active tab navigates to the remaining one", async ({ page }) => {
    await openSession(page, sessionA, titleA)
    await page.goto(`/${base64Encode(directory)}/session/${sessionB}`)
    await expectSessionTitle(page, titleB)

    // Close the active (last) tab through its close affordance. The anchor's title
    // lives in a child span, so `hasText` matches the element, then `xpath=..` walks
    // up to the tab root where the close button lives.
    const activeTab = tabs(page).locator("a", { hasText: titleB })
    await activeTab.locator("xpath=..").locator("button").click()

    await expect(page).toHaveURL(new RegExp(`session/${sessionA}$`))
    await expectSessionTitle(page, titleA)
    await expect(tabs(page).locator("a", { hasText: titleB })).toHaveCount(0)
  })

  test("closing the final active tab returns focus to Home", async ({ page }) => {
    await openSession(page, sessionA, titleA)

    const activeTab = tabs(page).locator("a", { hasText: titleA })
    await activeTab.locator("xpath=..").locator("button").click()

    await expect(page).toHaveURL(/\/$/)
    await expect(homeButton(page)).toBeFocused()
  })

  test("clicking Home twice returns to the last session tab", async ({ page }) => {
    await openSession(page, sessionA, titleA)

    await homeButton(page).click()
    await expect(page).toHaveURL(/\/$/)

    await homeButton(page).click()
    await expect(page).toHaveURL(new RegExp(`session/${sessionA}$`))
    await expectSessionTitle(page, titleA)
  })

  test("the new-session button on a session route opens a draft tab that closes back to the session", async ({
    page,
  }) => {
    await openSession(page, sessionA, titleA)

    await page.getByRole("button", { name: "New session", exact: true }).click()
    await expect(page).toHaveURL(/\/new-session\?draftId=/)
    await expect(tabs(page)).toContainText("New session")

    await page.keyboard.press("ControlOrMeta+w")
    await expect(page).toHaveURL(new RegExp(`session/${sessionA}$`))
    await expectSessionTitle(page, titleA)
  })
})

test.describe("global shell: dirty draft route guard", () => {
  test("closing a dirty draft confirms before removing it", async ({ page }) => {
    await openSession(page, sessionA, titleA)
    await page.getByRole("button", { name: "New session", exact: true }).click()
    // The draft tab is registered before its route renders (the navigation runs in a
    // transition). Typing or closing inside that window would act on the session page that
    // is still mounted — the composer would be the session's and the draft would look clean.
    await expect(page).toHaveURL(/\/new-session\?draftId=/)
    const composer = page.getByRole("textbox").first()
    await composer.fill("keep this draft")

    const draftTab = tabs(page).locator("a", { hasText: "New session" })
    await draftTab.locator("xpath=..").locator("button").click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Stay" }).click()
    await expect(page).toHaveURL(/\/new-session\?draftId=/)
    await expect(composer).toContainText("keep this draft")

    await draftTab.locator("xpath=..").locator("button").click()
    await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click()
    await expect(page).toHaveURL(new RegExp(`session/${sessionA}$`))
    await expect(tabs(page).locator("a", { hasText: "New session" })).toHaveCount(0)
  })

  test("leaving with unsent composer content asks, Stay returns, Leave leaves", async ({ page }) => {
    await openSession(page, sessionA, titleA)

    const composer = page.getByRole("textbox").first()
    await composer.fill("unsent draft content")

    await homeButton(page).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("Unsaved content")

    await dialog.getByRole("button", { name: "Stay" }).click()
    await expect(page).toHaveURL(new RegExp(`session/${sessionA}$`))
    await expect(composer).toContainText("unsent draft content")

    await homeButton(page).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })
})

test.describe("global shell: status bar", () => {
  test("shows the connection trigger and opens the metrics popover", async ({ page }) => {
    await openSession(page, sessionA, titleA)

    const trigger = page.getByRole("button", { name: "Session metrics" })
    await expect(trigger).toBeVisible()

    await trigger.click()
    await expect(page.locator('[data-slot="popover-body"]')).toBeVisible()
  })
})

/**
 * Connection gate (the "Could not reach <server>" retry screen) is deliberately NOT covered
 * here: `entry.tsx:175` sets `disableHealthCheck` in the web renderer, so the gate is desktop
 * shell behavior and cannot be exercised from a web e2e. The sidecar connection lifecycle is
 * main-process territory (`packages/desktop/src/main`), which has no browser test harness.
 * Covered gap, not a forgotten one.
 */
