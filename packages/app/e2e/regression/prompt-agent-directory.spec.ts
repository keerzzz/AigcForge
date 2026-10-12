import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import type { Agent, CompositionSnapshotV2, Session, SessionMessagesResponse } from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible, expectSessionTitle, gotoWhenReady } from "../utils/waits"

const directory = "C:/Aigcfroge/PromptAgentDirectory"
const projectID = "proj_prompt_agent_directory"
const sessionID = "ses_prompt_agent_directory"
const title = "Prompt agent directory"
const path = `/${base64Encode(directory)}/session/${sessionID}`
const model = { providerID: "aigcfroge", modelID: "directory-model" }

const agent = (name: string, options: Partial<Agent> = {}): Agent => ({
  name,
  mode: "subagent",
  permission: [],
  options: {},
  primaryModes: [],
  ...options,
})

const option = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^@${name}\\b`) })
const input = (page: Page) => page.locator('[data-component="prompt-input"]')
const primary = (page: Page) => page.locator('[data-action="prompt-agent"]')

async function installMock(
  page: Page,
  options: { agents: Agent[]; showAssets?: boolean; mode?: "coding" | "custom"; snapshot?: CompositionSnapshotV2 },
) {
  const mode = options.mode ?? "coding"
  await page.addInitScript((showCustomAgents) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { showCustomAgents } }))
  }, options.showAssets ?? false)
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-agent-directory",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: model.providerID,
          name: "Aigcfroge",
          models: {
            [model.modelID]: { id: model.modelID, name: "Directory Model", limit: { context: 200000 } },
          },
        },
      ],
      connected: [model.providerID],
      default: model,
    },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-agent-directory",
        projectID,
        directory,
        title,
        mode,
        agent: mode === "custom" ? "meta" : "build",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      } satisfies Session,
    ],
    agents: [agent(mode === "custom" ? "meta" : "build", { mode: "primary", primaryModes: [mode] }), ...options.agents],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
  await page.route(`**/api/session/${sessionID}/message**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ data: [], cursor: {} } satisfies SessionMessagesResponse),
    }),
  )
  await page.route(`**/session/${sessionID}/composition**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(options.snapshot ?? {}),
    }),
  )
}

async function openComposer(page: Page, selected = "build") {
  await gotoWhenReady(page, path)
  await expectSessionTitle(page, title)
  await expectAppVisible(input(page))
  await expect(primary(page)).toContainText(selected)
}

async function openDirectory(page: Page) {
  await input(page).click()
  await input(page).pressSequentially("@")
  await expect(input(page)).toHaveText("@")
}

function sessionWrites(page: Page) {
  const writes: { method: string; path: string }[] = []
  page.on("request", (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return
    const pathname = new URL(request.url()).pathname
    if (!/^\/(?:api\/)?(?:session|delegation)(?:\/|$)/.test(pathname)) return
    writes.push({ method: request.method(), path: pathname })
  })
  return writes
}

test.beforeEach(async ({ page }) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
})

test("AI-TDD-S04-R01 lists subagent candidates independently of primaryModes and excludes hidden and primary-only agents", async ({
  page,
}) => {
  await installMock(page, {
    agents: [
      agent("reviewer", { source: "native" }),
      agent("terminal-helper", { source: "external-cli", primaryModes: ["work"] }),
      agent("hidden-helper", { hidden: true }),
      agent("primary-only", { mode: "primary", primaryModes: ["coding"] }),
    ],
  })
  await openComposer(page)
  await openDirectory(page)

  await expect(option(page, "reviewer")).toBeVisible()
  await expect(option(page, "terminal-helper")).toBeVisible()
  await expect(option(page, "terminal-helper")).toContainText("CLI")
  await expect(page.getByRole("button", { name: /^@/ })).toHaveCount(2)
  await expect(option(page, "hidden-helper")).toHaveCount(0)
  await expect(option(page, "primary-only")).toHaveCount(0)
})

test("AI-TDD-S04-R01 shows actual provenance without labelling unknown agents as native", async ({ page }) => {
  await installMock(page, {
    showAssets: true,
    agents: [
      agent("reviewer", { source: "native" }),
      agent("asset-helper", { source: "native", originRelativePath: "agents/asset-helper.md" }),
      agent("mystery-helper"),
    ],
  })
  await openComposer(page)
  await openDirectory(page)

  await expect(page.getByRole("button", { name: /^@/ })).toHaveCount(3)
  await expect(option(page, "asset-helper")).toContainText("agents/asset-helper.md")
  await expect(option(page, "reviewer")).toContainText("native")
  await expect(option(page, "mystery-helper")).toContainText("unknown")
})

test("AI-TDD-S04-R01 does not reoffer an asset hidden by the primary picker through the @ directory", async ({
  page,
}) => {
  await installMock(page, {
    showAssets: false,
    agents: [
      agent("reviewer"),
      agent("asset-helper", { mode: "all", primaryModes: ["coding"], originRelativePath: "agents/asset-helper.md" }),
    ],
  })
  await openComposer(page)
  await primary(page).click()
  await expect(page.getByRole("option", { name: "build", exact: true })).toBeVisible()
  await expect(page.getByRole("option", { name: "asset-helper", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await openDirectory(page)

  await expect(option(page, "reviewer")).toBeVisible()
  await expect(option(page, "asset-helper")).toHaveCount(0)
})

test("AI-TDD-S04-R02 mouse selection inserts one agent part, preserves focus, and sends only on explicit submit", async ({
  page,
}) => {
  await installMock(page, { agents: [agent("reviewer")] })
  const writes = sessionWrites(page)
  await openComposer(page)
  await openDirectory(page)
  await option(page, "reviewer").click()

  await expect(input(page).locator('[data-type="agent"][data-name="reviewer"]')).toHaveCount(1)
  await expect(input(page)).toBeFocused()
  await expect(primary(page)).toContainText("build")
  await page.keyboard.type("check the existing path")
  await expect(input(page)).toHaveText("@reviewer check the existing path")
  expect(writes).toEqual([])

  const request = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === `/session/${sessionID}/prompt_async`,
  )
  await input(page).press("Enter")
  const sent = await request
  expect(sent.postDataJSON()).toMatchObject({
    agent: "build",
    parts: [
      { type: "text", text: "@reviewer check the existing path" },
      { type: "agent", name: "reviewer", source: { value: "@reviewer", start: 0, end: 9 } },
    ],
  })
  expect(writes).toEqual([{ method: "POST", path: `/session/${sessionID}/prompt_async` }])
})

test("AI-TDD-S04-R06 Custom candidates come from the frozen pool, not the asset display preference", async ({
  page,
}) => {
  const frozen = {
    version: 2,
    digest: "a".repeat(64),
    sessionID,
    createdAt: 1700000000000,
    data: {
      agents: [
        {
          id: "pool-reviewer",
          name: "allowed-reviewer",
          description: "",
          relativePath: "agents/allowed.md",
          revision: "b".repeat(64),
        },
        {
          id: "allowed-by-id",
          name: "pool-alias",
          description: "",
          relativePath: "agents/by-id.md",
          revision: "c".repeat(64),
        },
      ],
      bindings: { orchestrator: { instructions: [], prompts: [], skills: [], commands: [] } },
      instructions: [],
      prompts: [],
      skills: [],
      commands: [],
      tools: { fingerprints: [], catalogDigest: "d".repeat(64), catalog: [] },
    },
  } satisfies CompositionSnapshotV2
  await installMock(page, {
    mode: "custom",
    showAssets: true,
    snapshot: frozen,
    agents: [
      agent("allowed-reviewer", { originRelativePath: "agents/allowed.md" }),
      agent("allowed-by-id", { originRelativePath: "agents/by-id.md" }),
      agent("forbidden-reviewer", { originRelativePath: "agents/forbidden.md" }),
    ],
  })
  const writes = sessionWrites(page)
  await openComposer(page, "meta")
  await openDirectory(page)

  await expect(option(page, "allowed-reviewer")).toBeVisible()
  await expect(option(page, "allowed-by-id")).toBeVisible()
  await expect(option(page, "forbidden-reviewer")).toHaveCount(0)
  expect(writes).toEqual([])
})

test("AI-TDD-S04-R06 missing Custom snapshot fails closed instead of falling back to the global agent list", async ({
  page,
}) => {
  await installMock(page, {
    mode: "custom",
    showAssets: true,
    agents: [agent("unbound-reviewer", { originRelativePath: "agents/unbound.md" })],
  })
  const writes = sessionWrites(page)
  await openComposer(page, "meta")
  await openDirectory(page)

  await expect(option(page, "unbound-reviewer")).toHaveCount(0)
  await expect(page.getByText("No matching results", { exact: true })).toBeVisible()
  expect(writes).toEqual([])
})

test("AI-TDD-S04-R06 switching mode entries does not create, reclassify, or dispatch work for an existing session", async ({
  page,
}) => {
  await installMock(page, { agents: [agent("reviewer")] })
  const writes = sessionWrites(page)
  await openComposer(page)
  await openDirectory(page)
  await option(page, "reviewer").click()
  await expect(input(page).locator('[data-type="agent"][data-name="reviewer"]')).toHaveCount(1)

  const navigation = page.getByRole("navigation", { name: "Mode switcher" })
  await navigation.getByRole("button", { name: "Custom", exact: true }).click()
  const confirmation = page.getByRole("dialog", { name: "Unsaved content" })
  await expect(confirmation).toBeVisible()
  expect(writes).toEqual([])
  await confirmation.getByRole("button", { name: "Leave", exact: true }).click()
  await expect(page).toHaveURL(/\/mode\/custom$/)
  await expect(page.locator('[data-mode-main="custom"]')).toBeVisible()
  expect(writes).toEqual([])

  await page.goBack()
  await expectSessionTitle(page, title)
  await expectAppVisible(input(page))
  await expect(page.locator('[data-component="session-product-header"]')).toHaveAttribute("data-mode", "coding")
  await expect(navigation.getByRole("button", { name: "Coding", exact: true })).toHaveAttribute("aria-pressed", "true")
  expect(writes).toEqual([])
})
