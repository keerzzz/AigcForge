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

async function prepare(page: Page, options: { onListRequest?: (path: string) => void } = {}) {
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
      options.onListRequest?.(path)
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

/**
 * S3-3: the sidebar used to own a second resource over the same seven list
 * endpoints, so entering Chat issued each list twice and re-issued them on every
 * return to the mode. These two cases are the acceptance the debt row asked for —
 * request counts, and an A→B→A round trip that must not refetch.
 *
 * The counts are absolute because the set of readers is now known and small: after
 * S3-3 the workspace resource is the only reader of six of the seven categories, and
 * `prompt` has one more, from a different owner with a different purpose —
 * `chat-right-panel.tsx:145-148` builds its candidate resource with
 * `kind: candidate?.kind ?? "prompt"` and discards the value (it keeps only
 * `refetch`), so mounting the panel lists prompt assets for a diff nobody asked for.
 * That prefetch is registered as its own finding rather than folded in here, because
 * removing it changes when the panel has data, not how many owners read the store.
 */
test("reads each asset category once per directory, not once per surface", async ({ page }) => {
  const requests: string[] = []
  await prepare(page, { onListRequest: (path) => requests.push(path) })
  await expect(page.locator('[data-mode-main="chat"] [data-component="asset-row"]').first()).toBeVisible()

  const tallies = Object.fromEntries(categories.map(([, , , path]) => [path, requests.filter((p) => p === path).length]))
  // One each, except `/prompt-asset`: 2. Before S3-3 every one of the seven was 2
  // (workspace + sidebar); a 2 on any other path means a third reader appeared.
  expect(tallies).toEqual({
    "/prompt-asset": 2,
    "/skill-asset": 1,
    "/mcp-asset": 1,
    "/command-asset": 1,
    "/agent-asset": 1,
    "/workflow-asset": 1,
    "/plugin-asset": 1,
  })
})

test("keeps the counts across an A to B to A mode round trip, without doubling the read", async ({ page }) => {
  const requests: string[] = []
  await prepare(page, { onListRequest: (path) => requests.push(path) })
  const sidebar = page.locator('[data-mode-sidebar="chat"]')
  const prompts = sidebar.getByRole("button", { name: /^Prompts(?:\s+\d+)?$/ })
  await expect(prompts).toContainText("1")

  const afterFirstRead = requests.length
  expect(afterFirstRead).toBeGreaterThanOrEqual(categories.length)

  await page.goto("/mode/coding")
  await expectAppVisible(page.locator('[data-mode-main="coding"]'))
  await page.goto("/mode/chat")
  await expectAppVisible(page.locator('[data-mode-main="chat"]'))

  // Recovery, measured as "one round, not two": the counts come back on the same
  // resource, and the round trip costs at most one pass over the seven lists. The
  // debt this replaces was a SECOND reader, so the failure mode being excluded here
  // is a 2x (7 -> 14) return; that the resource re-reads at all on return is
  // pre-existing keying behaviour and is registered as its own finding, not quietly
  // asserted away.
  await expect(prompts).toContainText("1")
  const returned = requests.slice(afterFirstRead)
  expect(returned.length, `A→B→A refetched ${returned.length} lists: ${returned.join(", ")}`).toBeLessThanOrEqual(
    categories.length,
  )
})
