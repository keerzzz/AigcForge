import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/Aigcfroge/AgentAssetWarning"
const sessionID = "ses_agent_asset_warning"
const title = "Agent asset warning"
const candidate = {
  name: "reviewer",
  description: "Code reviewer",
  config: 'permissions:\n  - action: "*"\n    resource: "*"\n    effect: allow',
  source: "Review carefully.",
  relativePath: "",
}

const session = {
  id: sessionID,
  slug: "agent-asset-warning",
  projectID: "proj_agent_asset_warning",
  directory,
  mode: "chat",
  title,
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
}

const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }
const provider = {
  all: [
    {
      id: "aigcfroge",
      label: "AigcForge",
      models: [
        { id: "claude-opus-4-6", label: "Claude Opus 4.6", mode: "chat", variants: [{ id: "max", label: "Max" }] },
      ],
    },
  ],
  default: "aigcfroge",
}
const project = {
  id: "proj_agent_asset_warning",
  worktree: directory,
  vcs: "git",
  name: "AgentAssetWarning",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const base64Encode = (value: string) =>
  Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

const assistantMessage = {
  info: {
    id: "msg_agent_asset_warning",
    sessionID,
    role: "assistant",
    time: { created: 1700000001000 },
    summary: { diffs: [] },
    parentID: "msg_user_0",
    agent: "chat-orchestrator",
    mode: "chat",
    model,
    providerID: "aigcfroge",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [
    {
      id: "prt_agent_asset_warning",
      sessionID,
      messageID: "msg_agent_asset_warning",
      type: "tool",
      tool: "propose_agent_asset",
      state: {
        status: "completed",
        input: candidate,
        structured: {
          relativePath: "",
          exists: false,
          nameConflict: false,
          pathConflict: false,
          revision: null,
          warnings: [{ code: "wildcard_allow", action: "*", resource: "*" }],
        },
      },
    },
  ],
}

async function mockServer(page: Page, response: unknown) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [session],
    pageMessages: () => ({ items: [assistantMessage] }),
    events: () => [],
    agentAssetApply: response,
  })
}

test("agent asset apply warning is displayed after the real browser apply response", async ({ page }) => {
  await mockServer(page, {
    asset: {
      kind: "agent",
      name: candidate.name,
      description: candidate.description,
      relativePath: ".aigcfroge/agents/reviewer.md",
      revision: "a".repeat(64),
      config: candidate.config,
      source: candidate.source,
    },
    warnings: [{ code: "wildcard_allow", action: "*", resource: "*" }],
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expect(page.getByText("Ready to apply")).toBeAttached({ timeout: 15_000 })
  await page.getByRole("button", { name: "Apply" }).click()
  await expect(page.getByText("Applied", { exact: true })).toBeAttached({ timeout: 15_000 })
  await expect(page.getByText("Permission warnings from the applied asset")).toBeAttached()
  await expect(page.getByText("This asset contains a broad allow rule (* / *).")).toBeAttached()
})
