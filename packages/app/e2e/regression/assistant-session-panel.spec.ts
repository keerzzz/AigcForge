import { expect, test } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"

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
  await expect(assistantPanel).toHaveClass(/rounded-\[10px\]/)
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
