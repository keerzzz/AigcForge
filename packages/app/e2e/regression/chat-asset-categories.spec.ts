import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinDesktopViewport } from "../utils/viewport"
import { pinEnglishUI } from "../utils/locale"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/Aigcfroge/ChatAssetCategories"
const sessionID = "ses_chat_asset_categories"
const sessionTitle = "Chat asset categories"
const project = {
  id: "proj_chat_asset_categories",
  worktree: directory,
  vcs: "git",
  name: "chat-asset-categories",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
  sandboxes: [],
}
const session = {
  id: sessionID,
  slug: "chat-asset-categories",
  projectID: project.id,
  directory,
  mode: "chat",
  agent: "meta",
  title: sessionTitle,
  version: "dev",
  time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
}

const categories = [
  ["Prompts", "prompt", "prompt-one", "/prompt-asset"],
  ["Skills", "skill", "skill-one", "/skill-asset"],
  ["MCP", "mcp", "mcp-one", "/mcp-asset"],
  ["Commands", "command", "command-one", "/command-asset"],
  ["Agents", "agent", "agent-one", "/agent-asset"],
  ["Workflows", "workflow", "workflow-one", "/workflow-asset"],
  ["Plugins", "plugin", "plugin-one", "/plugin-asset"],
] as const

async function prepare(page: Page) {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider: { providers: [], default: {} },
    sessions: [session],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })

  const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  await page.route(
    (url) => url.port === apiPort && categories.some((entry) => entry[3] === url.pathname),
    async (route) => {
      const path = new URL(route.request().url()).pathname
      const entry = categories.find((category) => category[3] === path)
      if (!entry) return route.fallback()
      const [, kind, name] = entry
      const payload = {
        assets: [
          {
            kind,
            name,
            description: `${kind} description`,
            relativePath: `${kind}-one.asset`,
            revision: "a".repeat(64),
          },
        ],
        invalid: [],
        ...(kind === "plugin" ? { bridged: [] } : {}),
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })
    },
  )

  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: sessionTitle }))
  await page.goto("/mode/chat")
  await expectAppVisible(page.locator('[data-mode-main="chat"]'))
}

test("each Chat asset category filters the shared workbench to its own rows", async ({ page }) => {
  await prepare(page)
  const sidebar = page.locator('[data-mode-sidebar="chat"]')
  const main = page.locator('[data-mode-main="chat"]')

  for (const [label, kind, name] of categories) {
    await sidebar.getByRole("button", { name: new RegExp(`^${label}(?:\\s+\\d+)?$`) }).click()
    await expect(main.getByRole("heading", { name: `${label} assets` })).toBeVisible()
    const rows = main.locator('[data-component="asset-row"]')
    await expect(rows).not.toHaveCount(0)
    await expect(rows).toContainText([new RegExp(kind)])
    const projectRow = rows.filter({ hasText: name })
    await expect(projectRow).toHaveCount(1)
    await expect(projectRow).toContainText(kind)
    await expect(projectRow).toContainText(`${kind} description`)
  }
})

test("selecting an asset row only marks it selected and exposes no asset detail surface", async ({ page }) => {
  await prepare(page)
  const main = page.locator('[data-mode-main="chat"]')
  const row = main.locator('[data-component="asset-row"]', { hasText: "prompt-one" })

  await row.click()
  await expect(row).toHaveAttribute("data-selected", "")
  await expect(main.getByRole("heading", { name: /prompt-one/i })).toHaveCount(0)
  await expect(main.getByText("a".repeat(64), { exact: true })).toHaveCount(0)
})
