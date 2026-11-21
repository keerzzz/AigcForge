import type {
  AgentAssetInfo,
  AgentAssetSummary,
  CommandAssetInfo,
  MCPAssetInfo,
  PermissionRequest,
  PluginAssetBridgeEntry,
  PluginAssetInfo,
  PromptAssetInfo,
  SkillAssetInfo,
  WorkflowAssetInfo,
} from "@aigcfroge/client/promise"
import { Agent } from "@aigcfroge/schema/agent"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { expectPath, provider, session, sessionHref } from "../utils/app"
import { CustomCompositionFixture } from "../utils/custom-composition"
import { CustomProfileFixture } from "../utils/custom-profile"
import { selectGlobalMode } from "../utils/home-mode"
import { openSidePanel } from "../utils/side-panel"
import { mockWorkspace } from "../utils/workspace"

const revA = "a".repeat(64)
const revB = "b".repeat(64)
const revC = "c".repeat(64)
const revD = "d".repeat(64)

function reviewerAgent(): AgentAssetSummary & AgentAssetInfo {
  return {
    kind: "agent",
    name: "reviewer",
    description: "Reviews changes and verifies invariants",
    relativePath: "reviewer.md",
    revision: revA,
    config: "mode: subagent\n",
    source: "Review carefully.\n",
    mode: "subagent",
    hidden: false,
    disabled: false,
    handoffs: [],
  }
}

function reviewWorkflow(): WorkflowAssetInfo {
  return {
    kind: "workflow",
    name: "review-flow",
    description: "Two-step code review workflow",
    relativePath: "review-flow.yaml",
    revision: revB,
    version: "1",
    triggers: ["manual"],
    content: "kind: workflow\nname: review-flow\nsteps:\n  - id: s1\n    name: Review\n    agent: reviewer\n",
    steps: [
      { id: "s1", name: "Review", agent: "reviewer", next: "s2" },
      { id: "s2", name: "PlanCheck", agent: "build", next: "END" },
    ],
  }
}

function promptFixture(scope: "location" | "project" | "global", directory: string): PromptAssetInfo {
  return {
    kind: "prompt",
    name: `review-${scope}`,
    description: `Prompt in ${scope} scope`,
    relativePath: "shared/review.md",
    revision: scope === "global" ? revC : revB,
    template: `Review code under ${scope}.`,
    target: {
      scope,
      root: scope === "global" ? "/global/.aigcfroge/prompts" : `${directory}/.aigcfroge/prompts`,
    },
  }
}

function skillFixture(directory: string): SkillAssetInfo {
  return {
    kind: "skill",
    name: "verify-diffs",
    description: "Verify git diffs thoroughly",
    relativePath: "verify-diffs/SKILL.md",
    revision: revC,
    slash: false,
    content: "Verify every diff hunk.",
    triggers: [],
    tags: [],
    target: { scope: "location", root: `${directory}/.aigcfroge/skills` },
  }
}

function commandFixture(directory: string): CommandAssetInfo {
  return {
    kind: "command",
    name: "audit",
    description: "Run static audit",
    relativePath: "audit.md",
    revision: revD,
    invocation: "/audit",
    source: "Run audit checks.",
    target: { scope: "location", root: `${directory}/.aigcfroge/commands` },
  }
}

function mcpFixture(): MCPAssetInfo {
  return {
    kind: "mcp",
    name: "docs-mcp",
    description: "Internal docs MCP server",
    relativePath: "docs.md",
    revision: revA,
    command: "npx",
    args: ["docs-mcp"],
    env: {},
    configJson: '{"transport":"stdio"}',
  }
}

function pluginFixture(): PluginAssetInfo {
  return {
    kind: "plugin",
    name: "lint-plugin",
    description: "Saved plugin asset declaration",
    relativePath: "lint.plugin.yaml",
    revision: revB,
    version: "1.0.0",
    source: { type: "mcp", mcp: { name: "docs-mcp" } },
    hooks: [],
    content: 'kind: plugin\nname: lint-plugin\nversion: "1.0.0"\n',
  }
}

function bridgedPlugin(): PluginAssetBridgeEntry {
  return {
    name: "external-codex-skill",
    description: "Discovered externally",
    source: "codex",
    category: "skills",
    originPath: "/home/demo/.codex/skills",
    format: "codex-skill-v1",
    bundled: { commands: 0, skills: 1, agents: 0, hooks: 0, mcpServers: 0 },
  }
}

test("Use Home displays real team cards, filters roles, and reuses visible details in the sidebar", async ({
  page,
}, testInfo) => {
  const finance = CustomProfileFixture.info("meta", {
    name: "财报尽调团队",
    description: "核验财务数据并检查潜在风险。",
    relativePath: "finance.yaml",
    profile: {
      agents: [
        new Composition.AgentRef({
          kind: "agent",
          relativePath: "verifier.md",
          revision: Composition.Revision.make(revA),
        }),
        new Composition.AgentRef({
          kind: "agent",
          relativePath: "challenger.md",
          revision: Composition.Revision.make(revA),
        }),
      ],
      bindings: {
        orchestrator: new Composition.Binding({
          prompts: [
            new Composition.PromptRef({
              kind: "prompt",
              relativePath: "checks.md",
              revision: Composition.Revision.make(revA),
            }),
          ],
          skills: [],
          commands: [],
        }),
      },
      workflow: new Composition.WorkflowRef({
        kind: "workflow",
        relativePath: "financial-review.yaml",
        revision: Composition.Revision.make(revA),
      }),
      mcpBindings: [
        {
          serverName: "Office 文档服务",
          ref: { relativePath: "office.md", revision: Composition.Revision.make(revA) },
          transport: "stdio",
          command: ["node", "office.mjs"],
        },
      ],
    },
  })
  const solo = CustomProfileFixture.info("build", {
    name: "跨境多语种文案助手",
    description: "结合当地表达与合规词表生成商品文案。",
    relativePath: "copy.yaml",
  })
  const profiles = [
    finance,
    solo,
    ...Array.from({ length: 8 }, (_, index) =>
      CustomProfileFixture.info("plan", {
        name: `其他助手 ${index}`,
        description: "代码分析与任务规划。",
        relativePath: `other-${index}.yaml`,
      }),
    ),
  ]
  const reads: string[] = []
  const mutations: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === "POST" && /^\/(?:custom-(?:composition|profile)|api\/session)(?:\/|$)/.test(pathname))
      mutations.push(pathname)
  })
  await mockWorkspace(page, {
    name: "首页视觉验证",
    sessions: [],
    profiles,
    seed: { tabs: [], locale: "zh" },
    onProfileContent(input) {
      reads.push(input.path)
      const profile = profiles.find((profile) => profile.relativePath === input.path)
      if (!profile) throw new Error("Unexpected profile")
      return CustomProfileFixture.infoAnswer(profile)
    },
    onCompositionHealth: () => ({
      status: 200,
      body: Schema.encodeSync(Schema.toCodecJson(Composition.Health))(
        new Composition.Health({ status: "degraded", diagnostics: [], staleRevisions: [] }),
      ),
    }),
  })
  await page.setViewportSize({ width: 1360, height: 900 })
  await page.goto("/mode/custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "首页视觉验证" }).click()
  const catalog = page.getByRole("region", { name: "我的智能体与团队", exact: true })
  const financeCard = page.locator('[data-component="custom-team-card"]').filter({ hasText: "财报尽调团队" })
  await expect(financeCard.getByText("3 个角色", { exact: true })).toBeVisible()
  await expect(financeCard.getByText("提示词 / 技能 / 命令：1 / 0 / 0", { exact: true })).toBeVisible()
  expect(reads).not.toContain("other-7.yaml")
  await financeCard.getByRole("button", { name: "查看配置", exact: true }).click()
  const sidebar = page.getByRole("complementary", { name: "当前所选组合摘要", exact: true })
  await expect(sidebar.getByText("verifier.md", { exact: true })).toBeVisible()
  await expect(sidebar.getByText("checks.md", { exact: true })).toBeVisible()
  await expect(sidebar.getByText("Office 文档服务", { exact: true })).toBeVisible()
  await sidebar.getByRole("button", { name: "检查定义新鲜度", exact: true }).click()
  await expect(financeCard.getByText("需更新", { exact: true })).toBeVisible()
  expect(reads.filter((path) => path === "finance.yaml")).toHaveLength(1)
  const layout = await page.locator('[data-component="custom-use-layout"]').evaluate((element) => {
    const main = element.children[0].getBoundingClientRect()
    const sidebar = element.children[1].getBoundingClientRect()
    return { mainRight: main.right, sidebarLeft: sidebar.left }
  })
  expect(layout.sidebarLeft).toBeGreaterThan(layout.mainRight)
  await page.screenshot({ path: testInfo.outputPath("custom-home-populated-zh.png") })
  await catalog.getByRole("button", { name: "单人助手", exact: true }).click()
  await expect(financeCard).toBeHidden()
  await expect(
    page.locator('[data-component="custom-team-card"]').filter({ hasText: "跨境多语种文案助手" }),
  ).toBeVisible()
  expect(mutations).toEqual([])
})

test("Surface 1: zero-asset Use Home starts a two-stage task with retry-safe firstInputID and honest boundaries", async ({
  page,
}, testInfo) => {
  const directory = "/custom/use-home"
  const starts: Composition.StartInput[] = []
  const promptCalls: { id?: string; text?: string; files?: unknown[] }[] = []
  const genericCreates: unknown[] = []
  const hiddenAssetCalls: string[] = []
  let failPromptOnce = true
  const plan = CustomCompositionFixture.plan("plan")

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname

    if (/^\/(?:agent|prompt|skill|command|workflow|mcp|plugin)-asset/.test(pathname)) hiddenAssetCalls.push(pathname)
  })

  await mockWorkspace(page, {
    name: "Use Home Project",
    directory,
    project: { id: "proj_custom_use" },
    sessions: [],
    profiles: [],
    provider: provider({ id: "fast", name: "Fast Model" }),
    onSessionCreate: (body) => void genericCreates.push(body),
    onCompositionPlan: () => CustomCompositionFixture.planAnswer(plan),
    onCompositionStart(input) {
      starts.push(input.body)

      return CustomCompositionFixture.startAnswer(input.body, directory, plan, "proj_custom_use")
    },
    onPrompt(input) {
      const body = input.body as { id?: string; text?: string; files?: unknown[] }
      promptCalls.push(body)

      if (failPromptOnce) {
        failPromptOnce = false
        throw new Error("Transient prompt admission error")
      }
    },
    seed: { tabs: [] },
  })

  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Use Home Project" }).click()

  const useRegion = page.getByRole("region", { name: "Start a Custom task", exact: true })
  await expect(useRegion).toBeVisible()
  // Zero-asset cold start: Build, Plan (read-only), Meta are available without saved assets.
  await expect(useRegion.getByRole("button", { name: /Plan/ })).toContainText("Read-only planning")
  await useRegion.getByRole("button", { name: /Plan/ }).click()
  // Hidden Compose / Assets tabs must not fetch any 7-kind asset catalogs while on Surface 1.
  expect(hiddenAssetCalls).toEqual([])
  // Work handoff is honestly disabled.
  await expect(useRegion.getByRole("button", { name: "Run in Work (not yet available)", exact: true })).toBeDisabled()

  await useRegion.getByRole("textbox", { name: "Task instructions", exact: true }).fill("Review architecture plan")
  await useRegion.getByRole("textbox", { name: "Materials & files", exact: true }).fill("src/main.ts")
  await useRegion.getByRole("button", { name: "Add path", exact: true }).click()
  await expect(useRegion.getByText("main.ts", { exact: true })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath("surface1-use-home-wide.png") })

  // Stage 1 + Stage 2: Preview -> Start -> prompt fails once (unknown ACK) -> retry same firstInputID without repeating start!
  await useRegion.getByRole("button", { name: "Preview & start task", exact: true }).click()
  await expect(useRegion.getByRole("button", { name: "Start task session", exact: true })).toBeEnabled()
  await useRegion.getByRole("button", { name: "Start task session", exact: true }).click()

  await expect(useRegion.getByRole("button", { name: "Retry sending task", exact: true })).toBeEnabled()
  expect(starts).toHaveLength(1)
  expect(promptCalls).toHaveLength(1)
  const firstInputID = promptCalls[0]?.id
  expect(firstInputID).toBeTruthy()
  expect(promptCalls[0]?.files).toEqual([{ uri: `file://${directory}/src/main.ts`, name: "main.ts" }])

  await page.reload()
  await expect(useRegion.getByRole("button", { name: "Retry sending task", exact: true })).toBeEnabled()
  await useRegion.getByRole("button", { name: "Retry sending task", exact: true }).click()
  await expectPath(page, sessionHref(starts[0].sessionID!))
  expect(starts).toHaveLength(1)
  expect(promptCalls).toHaveLength(2)
  expect(promptCalls[1]?.id).toBe(firstInputID)
  expect(genericCreates).toEqual([])
})

for (const retry of ["frozen", "edited"] as const) {
  test(`Custom creation ${retry} recovery preserves the correct request identity`, async ({ page }) => {
    const directory = "/custom/create-recovery"
    const starts: Composition.StartInput[] = []
    const plan = CustomCompositionFixture.plan("build")
    await mockWorkspace(page, {
      name: "Recover creation",
      directory,
      sessions: [],
      profiles: [],
      onCompositionPlan: () => CustomCompositionFixture.planAnswer(plan),
      onCompositionStart(input) {
        starts.push(input.body)
        if (starts.length === 1) return { status: 503, body: { message: "Response lost" } }
        return CustomCompositionFixture.startAnswer(input.body, directory, plan)
      },
      onPrompt: () => {},
      seed: { tabs: [] },
    })
    await page.goto("/")
    await selectGlobalMode(page, "Custom")
    await page.locator('[data-component="home-project-row"]').filter({ hasText: "Recover creation" }).click()
    const use = page.getByRole("region", { name: "Start a Custom task", exact: true })
    await use.getByRole("button", { name: "Preview & start task", exact: true }).click()
    await use.getByRole("button", { name: "Create empty session", exact: true }).click()
    await expect(use.getByRole("button", { name: "Retry confirmation", exact: true })).toBeVisible()
    if (retry === "edited") {
      await use.getByRole("textbox", { name: "Task instructions", exact: true }).fill("A different task")
      await expect(use.getByRole("button", { name: "Preview & start task", exact: true })).toBeVisible()
      await use.getByRole("button", { name: "Preview & start task", exact: true }).click()
      await use.getByRole("button", { name: "Start task session", exact: true }).click()
    } else {
      await use.getByRole("button", { name: /^Plan\b/ }).click()
      await page.reload()
      await use.getByRole("button", { name: "Retry confirmation", exact: true }).click()
    }
    await expectPath(page, sessionHref(starts[1].sessionID!))
    expect(starts).toHaveLength(2)
    if (retry === "edited") expect(starts[1].sessionID).not.toBe(starts[0].sessionID)
    else expect(starts[1]).toEqual(starts[0])
  })
}

test("Custom attachments upload the selected CSV bytes and retain the resulting path after reload", async ({
  page,
}) => {
  const directory = "/custom/upload-bytes"
  const writes: { path: string; directory: string; body: string }[] = []
  const prompts: { files?: { uri: string; name: string }[] }[] = []
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9FkAAAAASUVORK5CYII="
  const plan = CustomCompositionFixture.plan("build")
  await mockWorkspace(page, {
    name: "Upload bytes",
    directory,
    sessions: [],
    onFileWrite(write) {
      if (write.path.endsWith("/failed.csv")) throw new Error("Fixture upload failed")
      writes.push(write)
    },
    onCompositionPlan: () => CustomCompositionFixture.planAnswer(plan),
    onCompositionStart: (input) => CustomCompositionFixture.startAnswer(input.body, directory, plan),
    onPrompt: (input) => void prompts.push(input.body as (typeof prompts)[number]),
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Upload bytes" }).click()
  const use = page.getByRole("region", { name: "Start a Custom task", exact: true })
  await use.getByRole("textbox", { name: "Task instructions", exact: true }).fill("Analyze the selected CSV")
  await use
    .locator('input[type="file"]')
    .setInputFiles({ name: "failed.csv", mimeType: "text/csv", buffer: Buffer.from("fail") })
  await expect(use.getByRole("alert")).toContainText("Upload failed")
  await expect(use.getByRole("button", { name: "Remove material failed.csv", exact: true })).toHaveCount(0)
  await use.locator('input[type="file"]').setInputFiles([
    {
      name: "sales.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("item,amount\nselected,123\n"),
    },
    { name: "pixel.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
  ])
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ directory, body: "item,amount\nselected,123\n" })
  expect(writes[0]?.path).toMatch(/\/uploads\/[0-9a-f-]+\/sales\.csv$/)
  await expect(use.getByText("sales.csv", { exact: true })).toBeVisible()
  await expect(use.getByText("pixel.png", { exact: true })).toBeVisible()
  await page.reload()
  await expect(use.getByText("pixel.png", { exact: true })).toBeVisible()
  await expect(use.getByText("sales.csv", { exact: true })).toBeVisible()
  await use.getByRole("button", { name: "Preview & start task", exact: true }).click()
  await use.getByRole("button", { name: "Start task session", exact: true }).click()
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.files).toEqual([
    { uri: `file://${writes[0]?.path}`, name: "sales.csv" },
    { uri: `data:image/png;base64,${png}`, name: "pixel.png" },
  ])
})

test("Custom CAS keeps the original edit revision after an external change and tab remount", async ({ page }) => {
  const initial = CustomProfileFixture.info("build", {
    name: "Concurrent team",
    relativePath: "concurrent.yaml",
    description: "Original",
    revision: revA,
  })
  let current = initial
  const requests: { baseRevision?: string }[] = []
  await mockWorkspace(page, {
    name: "CAS remount",
    directory: "/custom/cas-remount",
    sessions: [],
    profiles: () => [current],
    onProfileApply(input) {
      requests.push(input.body)
      if (input.body.baseRevision !== current.revision)
        return {
          status: 409,
          body: { _tag: "ConflictError", resource: current.relativePath, message: "Revision changed" },
        }
      return CustomProfileFixture.infoAnswer(current)
    },
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "CAS remount" }).click()
  await page.getByRole("tab", { name: /^Compose(?: Unsaved edits)?$/ }).click()
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Concurrent team (concurrent.yaml)", exact: true }).click()
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue("Original")
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill("My unsaved edit")
  current = CustomProfileFixture.info("build", {
    name: "Concurrent team",
    relativePath: "concurrent.yaml",
    description: "External change",
    revision: revB,
  })
  await page.getByRole("tab", { name: "Use", exact: true }).click()
  await page.getByRole("tab", { name: /^Compose(?: Unsaved edits)?$/ }).click()
  await expect(profile.getByRole("button", { name: "Overwrite profile", exact: true })).toBeEnabled()
  await profile.getByRole("button", { name: "Overwrite profile", exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0]?.baseRevision).toBe(revA)
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue(
    "My unsaved edit",
  )
  await expect(profile.getByRole("button", { name: "Reload profile", exact: true })).toBeVisible()
})

test("Custom profile switching requires an explicit discard of a dirty composition draft", async ({ page }) => {
  const saved = CustomProfileFixture.info("build", { name: "Other team", relativePath: "other.yaml" })
  await mockWorkspace(page, { name: "Keep dirty draft", sessions: [], profiles: [saved], seed: { tabs: [] } })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Keep dirty draft" }).click()
  await page.getByRole("tab", { name: /^Compose(?: Unsaved edits)?$/ }).click()
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill("Keep my work")
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Other team (other.yaml)", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Unsaved composition draft", exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click()
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue("Keep my work")
  await page.reload()
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue("Keep my work")
  await page.getByRole("tab", { name: "Use", exact: true }).click()
  await page.getByRole("button", { name: "New composition", exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click()
  await page.getByRole("tab", { name: /^Compose(?: Unsaved edits)?$/ }).click()
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue("Keep my work")
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Other team (other.yaml)", exact: true }).click()
  await dialog.getByRole("button", { name: "Discard and continue", exact: true }).click()
  await expect(profile.getByRole("textbox", { name: "Profile name", exact: true })).toHaveValue("Other team")
})

test("Surface 2: Compose Workspace wires real role bindings, workflow diagnostics, MCP Profile gate, and draft reload", async ({
  page,
}, testInfo) => {
  const directory = "/custom/compose-team"
  const plans: Composition.CompositionInput[] = []
  const writes: unknown[] = []
  const removals: string[] = []
  const savedProfiles: CustomProfile.Info[] = []
  const reviewer = reviewerAgent()
  const workflow = reviewWorkflow()
  const prompt = promptFixture("project", directory)
  const mcp = mcpFixture()

  await mockWorkspace(page, {
    name: "Compose Team",
    directory,
    project: { id: "proj_compose_team" },
    sessions: [],
    profiles: () => savedProfiles,
    agentAssets: [reviewer],
    promptAssets: [prompt],
    skillAssets: [skillFixture(directory)],
    commandAssets: [commandFixture(directory)],
    workflowAssets: [workflow],
    mcpAssets: [mcp],
    onCompositionPlan(input) {
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(CustomCompositionFixture.plan("build"))
    },
    onProfileApply(input) {
      writes.push(input.body)
      const info = new CustomProfile.Info({
        kind: "custom-profile",
        name: input.body.candidate.name,
        description: input.body.candidate.description,
        relativePath: input.body.candidate.relativePath,
        revision: CustomProfile.Revision.make(revD),
        profile: input.body.candidate.profile,
      })
      savedProfiles.splice(0, savedProfiles.length, info)

      return CustomProfileFixture.infoAnswer(info)
    },
    onProfileRemove(input) {
      removals.push(input.body.relativePath)
      savedProfiles.splice(0, savedProfiles.length)

      return { status: 200, body: { relativePath: input.body.relativePath, referencingProfiles: [] } }
    },
    seed: { tabs: [] },
  })

  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Compose Team" }).click()
  await page.getByRole("tab", { name: /^Compose(?: Unsaved edits)?$/ }).click()

  const compose = page.getByRole("region", { name: "Custom composition", exact: true })
  // Select workflow BEFORE adding reviewer -> diagnoses both missing member and root-only mismatch!
  const workflowSection = compose.getByRole("region", { name: "Workflow", exact: true })
  await workflowSection.getByRole("group", { name: "Select workflow", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: `${workflow.name} (${workflow.relativePath})`, exact: true }).click()
  await expect(workflowSection.getByText("Missing executor member: reviewer", { exact: true })).toBeVisible()
  await expect(
    workflowSection.getByText("build is the root agent; workflow steps must target a declared executor member.", {
      exact: true,
    }),
  ).toBeVisible()

  // Add reviewer member -> s1 matches!
  const definitions = compose.getByRole("region", { name: "Agent definitions", exact: true })
  await definitions.getByRole("button", { name: "Add executor", exact: true }).click()
  await expect(workflowSection.getByText("Executor matched", { exact: true })).toBeVisible()

  // Equip reviewer role with a Project-scoped Prompt!
  const bindingsSection = compose.getByRole("region", { name: "Per-role equipment", exact: true })
  await bindingsSection.getByRole("button", { name: /reviewer \(0\)/ }).click()
  await expect(bindingsSection.getByText("Consumer key: agents/reviewer", { exact: true })).toBeVisible()
  await bindingsSection.getByRole("button", { name: "Project", exact: true }).click()
  await bindingsSection.getByRole("button", { name: "Mount to role", exact: true }).first().click()
  await expect(
    bindingsSection.locator("li").filter({ hasText: "Unmount" }).getByText("shared/review.md", { exact: true }),
  ).toBeVisible()

  // Preview sends REAL bindings (never hardcoded `{}`) and workflow ref!
  await compose.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect.poll(() => plans.length).toBe(1)
  expect(plans[0]).toMatchObject({
    source: "temporary",
    workflow: { kind: "workflow", relativePath: workflow.relativePath, revision: workflow.revision },
    bindings: {
      "agents/reviewer": {
        prompts: [
          {
            kind: "prompt",
            relativePath: "shared/review.md",
            revision: revB,
            target: { scope: "project", root: `${directory}/.aigcfroge/prompts` },
          },
        ],
      },
    },
  })

  // Adding MCP binding blocks TemporaryInput preview (never silently drops MCP) and requires saving Profile.
  const mcpSection = compose.getByRole("region", { name: "External capabilities (MCP)", exact: true })
  await mcpSection.getByRole("group", { name: "Bind from saved MCP asset", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: `${mcp.name} (${mcp.relativePath})`, exact: true }).click()
  await mcpSection.getByRole("textbox", { name: "Command and args", exact: true }).fill("npx docs-mcp")
  await mcpSection.getByRole("button", { name: "Add MCP binding", exact: true }).click()
  await compose.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect(
    compose.getByText("Save profile before previewing or starting with MCP bindings.", { exact: true }),
  ).toBeVisible()
  expect(plans).toHaveLength(1)

  // Save Profile with full bindings + workflow + mcpBindings, then verify Location-scoped delete!
  const profileSection = compose.getByRole("region", { name: "Custom profiles", exact: true })
  await profileSection.getByRole("textbox", { name: "Profile name", exact: true }).fill("Review Team")
  await profileSection.getByRole("textbox", { name: "Profile path", exact: true }).fill("team/review.yaml")
  await page.screenshot({ path: testInfo.outputPath("surface2-compose-workspace.png") })

  await profileSection.getByRole("button", { name: "Save profile", exact: true }).click()
  await expect(profileSection.getByText("Saved profile ready.", { exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)

  // Reload page: persisted Compose draft stays on Compose tab with profile intact.
  await page.reload()
  await expect(page.getByRole("tab", { name: /^Compose(?: Unsaved edits)?$/ })).toHaveAttribute("aria-selected", "true")

  // Delete Profile via Location-scoped POST /custom-profile/delete without a Session.
  await profileSection.getByRole("button", { name: "Delete profile", exact: true }).click()
  await profileSection.getByRole("alert").getByRole("button", { name: "Delete profile", exact: true }).click()
  await expect.poll(() => removals).toEqual(["team/review.yaml"])
})

test("Surface 3: Asset Library covers 7 kinds, paired scopes, snapshotsComplete=false warning, and Plugin 4-way separation", async ({
  page,
}, testInfo) => {
  const directory = "/custom/assets-lib"
  const referenceQueries: { kind: string; path: string; scope?: string; targetRoot?: string }[] = []
  const assetRemovals: { kind: string; relativePath: string; target?: { scope: string; root: string } }[] = []
  const promptGlobal = promptFixture("global", directory)
  const prompts = [promptFixture("location", directory), promptGlobal]

  await mockWorkspace(page, {
    name: "Assets Lib",
    directory,
    project: { id: "proj_assets_lib" },
    sessions: [],
    agentAssets: [reviewerAgent()],
    promptAssets: () => prompts,
    skillAssets: [skillFixture(directory)],
    commandAssets: [commandFixture(directory)],
    workflowAssets: [reviewWorkflow()],
    mcpAssets: [mcpFixture()],
    pluginAssets: [pluginFixture()],
    pluginBridged: [bridgedPlugin()],
    plugins: [
      { id: "builtin-git", source: { type: "builtin" }, features: { server: true }, state: { status: "active" } },
    ],
    onCompositionReferences(input) {
      referenceQueries.push({
        kind: input.kind,
        path: input.path,
        scope: input.scope,
        targetRoot: input.targetRoot,
      })

      return {
        status: 200,
        body: {
          profiles: [],
          snapshots: [],
          snapshotsComplete: false,
        },
      }
    },
    onAssetRemove(input) {
      assetRemovals.push({ kind: input.kind, relativePath: input.relativePath, target: input.target })
      const index = prompts.findIndex(
        (item) => item.relativePath === input.relativePath && item.target?.scope === input.target?.scope,
      )

      if (index >= 0) prompts.splice(index, 1)
    },
    seed: { tabs: [] },
  })

  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Assets Lib" }).click()
  await page.getByRole("tab", { name: "Assets", exact: true }).click()

  const assets = page.getByRole("region", { name: "Asset library", exact: true })
  await expect(assets).toBeVisible()
  // Exactly 7 asset kinds; CustomProfile is not listed in Asset Library.
  await expect(assets.getByRole("tab")).toHaveCount(7)
  // Agent tab must NOT show owner scope selector.
  await expect(assets.getByRole("group", { name: "Owner scope", exact: true })).toHaveCount(0)

  // Switch to Prompts -> Owner scope selector appears -> select Global -> check references passes paired scope + targetRoot!
  await assets.getByRole("tab", { name: "Prompts", exact: true }).click()
  const scopeGroup = assets.getByRole("group", { name: "Owner scope", exact: true })
  await expect(scopeGroup).toBeVisible()
  await scopeGroup.getByRole("button", { name: "Global", exact: true }).click()
  await assets.getByRole("button", { name: /review-global/ }).click()
  await assets.getByRole("button", { name: "Check references", exact: true }).click()

  // snapshotsComplete=false MUST display warning alert and NEVER claim "No profiles or readable session snapshots".
  await expect(
    assets.getByText(
      "Some historical session snapshots could not be read reliably. Reference counts may be incomplete; do not assume zero references.",
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    assets.getByText("No profiles or readable session snapshots reference this asset.", { exact: true }),
  ).toHaveCount(0)
  expect(referenceQueries).toEqual([
    {
      kind: "prompt",
      path: "shared/review.md",
      scope: "global",
      targetRoot: "/global/.aigcfroge/prompts",
    },
  ])

  await page.screenshot({ path: testInfo.outputPath("surface3-asset-library-prompts.png") })

  // Delete Global prompt via Location-scoped endpoint carrying paired target.
  await assets.getByRole("button", { name: "Delete asset", exact: true }).click()
  await assets.getByRole("alert").getByRole("button", { name: "Delete asset", exact: true }).click()
  await expect
    .poll(() => assetRemovals)
    .toEqual([
      {
        kind: "prompt",
        relativePath: "shared/review.md",
        target: { scope: "global", root: "/global/.aigcfroge/prompts" },
      },
    ])

  // Switch to Plugins -> verify 4-way separation (saved definitions, external bridged, runtime server plugins, GUI note).
  await assets.getByRole("tab", { name: "Plugins", exact: true }).click()
  await expect(assets.getByRole("group", { name: "Owner scope", exact: true })).toHaveCount(0)
  await expect(assets.getByText("Saved plugin asset definitions", { exact: true })).toBeVisible()
  await expect(
    assets.getByText("External discovered entries (read-only · not installed)", { exact: true }),
  ).toBeVisible()
  await expect(assets.getByText("external-codex-skill", { exact: true })).toBeVisible()
  await expect(assets.getByText("Active server runtime plugins (read-only)", { exact: true })).toBeVisible()
  await expect(assets.getByText("builtin-git", { exact: true })).toBeVisible()
  await expect(
    assets.getByText("GUI extensions are managed separately under Settings → Extensions.", { exact: true }),
  ).toBeVisible()
  await assets.getByRole("button", { name: /lint-plugin/ }).click()
  await expect(
    assets.getByText("Plugin assets are not mountable directly into compositions.", { exact: true }),
  ).toBeVisible()
})

test("Surface 4: Session Detail separates adopted Snapshot from actual participants and opens Compose draft without mutating history", async ({
  page,
}, testInfo) => {
  const worktree = "/custom/session-detail"
  const directory = `${worktree}/sandbox`
  const plans: string[] = []
  const rootID = "ses_custom_detail_root"
  const childID = "ses_custom_detail_child"
  const reviewer = { ...reviewerAgent(), name: "Code Reviewer", relativePath: "team/code-reviewer.md" }
  const workflow = reviewWorkflow()
  const now = Date.now()

  const snapshot = new Composition.SnapshotV2({
    version: 2,
    sessionID: rootID,
    digest: Composition.Digest.make(revA),
    profilePath: "team/review.yaml",
    profileRevision: Composition.Revision.make(revB),
    createdAt: now,
    data: new Composition.SnapshotDataV2({
      root: new Composition.BuiltinRoot({ source: "builtin", id: "build", revision: Composition.Revision.make(revA) }),
      agents: [],
      executors: [
        {
          id: Agent.ID.make(reviewer.name),
          relativePath: reviewer.relativePath,
          revision: Composition.Revision.make(reviewer.revision),
          info: Schema.decodeUnknownSync(Agent.Info)({
            id: reviewer.name,
            name: reviewer.name,
            description: reviewer.description,
            mode: "subagent",
            permissions: [],
            request: { settings: {}, headers: {}, body: {} },
            hidden: false,
            handoffs: [],
          }),
        },
      ],
      workflow: new Composition.WorkflowInfo({
        relativePath: workflow.relativePath,
        revision: Composition.Revision.make(workflow.revision),
        name: workflow.name,
        description: workflow.description,
        steps: [new WorkflowAsset.StepDef({ id: "s1", name: "Review", agent: "reviewer", next: "END" })],
      }),
      bindings: {
        "agents/code-reviewer": new Composition.SnapshotBindingData({
          instructions: [],
          prompts: [
            { relativePath: "shared/review.md", revision: Composition.Revision.make(revB), content: "Review." },
          ],
          skills: [],
          commands: [],
        }),
      },
      instructions: [],
      prompts: [],
      skills: [],
      tools: new Composition.SnapshotToolInfo({
        fingerprints: [],
        catalogDigest: Composition.Digest.make(revA),
        catalog: [],
      }),
    }),
  })

  const rootSession = session({ id: rootID, title: "Custom Review Run", directory, mode: "custom", agent: "build" })
  const childSession = session({
    id: childID,
    parentID: rootID,
    title: "Reviewer child run",
    directory,
    mode: "custom",
    agent: "reviewer",
  })

  const childPermissions: PermissionRequest[] = [
    {
      id: "per_child_1",
      sessionID: childID,
      action: "bash",
      resources: ["npm test"],
    },
  ]

  await mockWorkspace(page, {
    name: "Session Detail Project",
    directory,
    project: { id: "proj_session_detail", worktree, canonical: worktree, sandboxes: [directory] },
    onCompositionPlan(input) {
      plans.push(input.directory)
      return CustomCompositionFixture.planAnswer(CustomCompositionFixture.plan("build"))
    },
    sessions: [rootSession, childSession],
    compositions: { [rootID]: snapshot },
    permissions: childPermissions,
    sessionPermissions: { [childID]: childPermissions },
    tasks: [
      new SessionTask.Info({
        id: "task_1",
        sessionID: rootID,
        content: "Audit modified modules",
        status: "in_progress",
        priority: "high",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ],
    workflows: {
      [rootID]: {
        run: {
          id: "wfr_1",
          sessionID: rootID,
          snapshotDigest: revA,
          workflowName: workflow.name,
          workflowRevision: workflow.revision,
          status: "running",
          revision: 1,
          timeCreated: now,
          timeUpdated: now,
        },
        steps: [
          {
            id: "wfs_1",
            runId: "wfr_1",
            stepId: "s1",
            agentId: "reviewer",
            status: "running",
            attempt: 2,
            revision: 1,
            childSessionId: childID,
            timeCreated: now,
          },
        ],
      },
    },
    onCompositionHealth: () => ({
      status: 200,
      body: {
        status: "degraded",
        diagnostics: [{ code: "stale", severity: "warning", message: "reviewer.md has a newer revision." }],
        staleRevisions: [],
      },
    }),
    seed: {
      projects: { local: [{ worktree, expanded: true }] },
      lastProject: { local: worktree },
      tabs: [{ session: rootID }],
    },
  })

  await page.goto(sessionHref(rootID))
  // Pending child permission renders in the canonical owning Session Composer request dock.
  await expect(page.getByText("Permission required", { exact: true })).toBeVisible()

  // Session header has NO asset library buttons piled into it.
  await expect(page.getByRole("banner").getByRole("button", { name: /Asset|资产/i })).toHaveCount(0)

  // Expand Adopted composition summary -> shows configured vs actual counts separately.
  await page.locator('summary[aria-label="Adopted composition"]').click()
  const adoptedSummary = page.getByRole("region", { name: "Adopted composition", exact: true })
  await expect(adoptedSummary.getByText("Configured roles: 2", { exact: true })).toBeVisible()
  await expect(adoptedSummary.getByText("Actual execution records: 2", { exact: true })).toBeVisible()

  // Open right-sidebar Team configuration panel via the real session panel launcher.
  await openSidePanel(page, "Team configuration")
  const panel = page.locator('[data-component="session-composition-panel"]')
  await expect(panel).toBeVisible()
  await expect(panel.getByText("Configured roles: 2", { exact: true })).toBeVisible()
  await expect(panel.getByText("Execution records: 2", { exact: true })).toBeVisible()
  await expect(panel.getByText("Prompts: 1 · Skills: 0 · Commands: 0", { exact: true })).toBeVisible()
  await expect(
    panel.getByText("Waiting for approval or reply in the owning session composer.", { exact: true }).first(),
  ).toBeVisible()
  await expect(panel.getByText("Attempts / turns: 2", { exact: true })).toBeVisible()

  // On-demand freshness check shows drift without mutating current session.
  await panel.getByRole("button", { name: "Check latest definition", exact: true }).click()
  await expect(panel.getByText("Newer asset revisions or warnings exist.", { exact: true })).toBeVisible()
  await expect(panel.getByText("reviewer.md has a newer revision.", { exact: true })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath("surface4-session-team-panel.png") })

  // Edit in Compose workspace stages snapshot into Compose tab without mutating current session.
  await adoptedSummary.getByRole("button", { name: "Edit in Compose workspace", exact: true }).click()
  await expectPath(page, "/mode/custom")
  const footerLocation = page.getByRole("contentinfo").getByRole("button", { name: /^New session location/ })
  await expect(footerLocation).toContainText("sandbox")
  await footerLocation.click()
  await expect(page.getByRole("dialog", { name: "New session location", exact: true }).locator("code")).toHaveText(
    directory,
  )
  await page.keyboard.press("Escape")
  await expect(page.getByRole("tab", { name: /^Compose(?: Unsaved edits)?$/ })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("region", { name: "Custom composition", exact: true })).toBeVisible()
  const compose = page.getByRole("region", { name: "Custom composition", exact: true })
  await compose.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect.poll(() => plans).toEqual([directory])
  const description = compose.getByRole("textbox", { name: "Profile description", exact: true })
  await description.fill("Keep sandbox changes")
  await page.goto(sessionHref(rootID))
  await page.locator('summary[aria-label="Adopted composition"]').click()
  await adoptedSummary.getByRole("button", { name: "Edit in Compose workspace", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Unsaved composition draft", exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Keep editing", exact: true }).click()
  await expect(description).toHaveValue("Keep sandbox changes")
})

test("Responsive narrow viewport, dark theme, and Chinese locale render cleanly without horizontal overflow", async ({
  page,
}, testInfo) => {
  const directory = "/custom/responsive-zh"
  await mockWorkspace(page, {
    name: "中文自定义项目测试长名称",
    directory,
    project: { id: "proj_zh_narrow" },
    sessions: [],
    profiles: [CustomProfileFixture.info("build", { name: "代码审查与架构设计超长团队名称方案" })],
    seed: {
      tabs: [],
      locale: "zh",
      theme: { id: "oc-2", scheme: "dark" },
    },
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans")
  await page
    .getByRole("navigation", { name: "模式", exact: true })
    .getByRole("button", { name: "自定义", exact: true })
    .click()
  await expect(page.getByRole("region", { name: "发起自定义任务", exact: true })).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(2)
  await page.screenshot({ path: testInfo.outputPath("surface1-narrow-dark-zh.png") })

  await page.getByRole("tab", { name: "组合工作页", exact: true }).click()
  await expect(page.getByRole("region", { name: "自定义组合", exact: true })).toBeVisible()
  const composeOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(composeOverflow).toBeLessThanOrEqual(2)
  await page.screenshot({ path: testInfo.outputPath("surface2-narrow-dark-zh.png") })

  await page.getByRole("textbox", { name: "配置方案描述", exact: true }).fill("保留中文草稿")
  await expect(page.getByRole("tab", { name: "组合工作页 未保存", exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "使用首页", exact: true }).click()
  await page.getByRole("button", { name: "新建组合", exact: true }).click()

  const dialog = page.getByRole("dialog", { name: "组合草稿尚未保存", exact: true })

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("要放弃未保存的修改并加载另一个组合吗？", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "放弃修改并继续", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "继续编辑", exact: true })).toBeFocused()

  const dialogOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  expect(dialogOverflow).toBeLessThanOrEqual(2)
  await page.screenshot({ path: testInfo.outputPath("surface1-unsaved-dialog-narrow-dark-zh.png") })
  await dialog.getByRole("button", { name: "继续编辑", exact: true }).click()

  await page.getByRole("tab", { name: "资产库", exact: true }).click()
  await expect(page.getByRole("region", { name: "资产库", exact: true })).toBeVisible()
  const assetsOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(assetsOverflow).toBeLessThanOrEqual(2)
  await page.screenshot({ path: testInfo.outputPath("surface3-narrow-dark-zh.png") })
})
