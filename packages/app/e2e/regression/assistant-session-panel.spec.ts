import { expect, test } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"

// English-label spec — pin the UI language so the zh projects stay green (see utils/locale.ts).
test.beforeEach(({ page }) => pinEnglishUI(page))

const directory = "C:/Aigcfroge/AssistantPanelRegression"
const projectID = "proj_assistant_panel_regression"
const sessionID = "ses_assistant_panel_regression"
const title = "Assistant panel regression"

test("assistant session renders the unified review-panel shell", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [] }),
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: title })).toBeVisible()

  // The unified shell owns the review-panel id; assistant no longer renders a
  // self-contained aside. The review-panel is open by default.
  const assistantPanel = page.locator('#review-panel[aria-label="Assistant panel"]')
  await expect(assistantPanel).toBeVisible()
  await expect(assistantPanel.locator("[data-slot='tabs-v2-list']")).toBeVisible()
  // v2 radius xl is 0.625rem = 10px. Assert the computed value, not the utility
  // class name, so a token rename (`rounded-[10px]` -> `rounded-xl`) cannot fail
  // this for the wrong reason.
  await expect(assistantPanel).toHaveCSS("border-radius", "10px")
})

/**
 * The divider that owns the panel width used to be a bare `<div onMouseDown>`: no role, no
 * name, no keyboard path, and the drag died the moment the pointer left the handle. It is the
 * only separator in the session shell, so this is its real host (1400x900 + assistant mode
 * opens the review panel by default). `End`/`Home` are exact and cannot pass by accident: a
 * separator whose arrow/End handling was never wired reports the same `aria-valuenow` before
 * and after the keypress.
 */
test("the review divider is a named, keyboard-operable separator", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [] }),
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: title })).toBeVisible()

  const handle = page.getByRole("separator", { name: "Resize session changes panel" })
  await expect(handle).toBeVisible()
  // A left/right drag is a VERTICAL divider; the axis names the divider, not the gesture.
  await expect(handle).toHaveAttribute("aria-orientation", "vertical")

  const min = Number(await handle.getAttribute("aria-valuemin"))
  const max = Number(await handle.getAttribute("aria-valuemax"))
  const value = async () => Number(await handle.getAttribute("aria-valuenow"))

  await handle.focus()
  await expect(handle).toBeFocused()

  await page.keyboard.press("End")
  await expect.poll(value).toBe(max)
  await page.keyboard.press("Home")
  await expect.poll(value).toBe(min)
  // One step key proves the axis mapping, not just the jump keys.
  await page.keyboard.press("ArrowRight")
  await expect.poll(value).toBe(min + 16)
  // The perpendicular axis must be inert: a horizontal separator ignores Up/Down.
  await page.keyboard.press("ArrowDown")
  await expect.poll(value).toBe(min + 16)
})

function session() {
  return {
    id: sessionID,
    slug: "assistant-panel-regression",
    projectID,
    directory,
    title,
    mode: "assistant",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "assistant-panel-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function provider() {
  return {
    all: [
      {
        id: "aigcfroge",
        name: "Aigcfroge",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["aigcfroge"],
    default: { providerID: "aigcfroge", modelID: "claude-opus-4-6" },
  }
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
