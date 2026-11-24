import { expect, test } from "@playwright/test"
import { ConflictError, InvalidRequestError } from "@omnixa/protocol/errors"
import type { CustomProfileApplyPayload } from "@omnixa/protocol/groups/custom-profile"
import { Composition } from "@omnixa/schema/composition"
import { Agent } from "@omnixa/schema/agent"
import { CustomProfile } from "@omnixa/schema/custom-profile"
import { Schema } from "effect"
import { expectPath, project, sessionHref } from "../utils/app"
import { CustomCompositionFixture } from "../utils/custom-composition"
import { CustomProfileFixture } from "../utils/custom-profile"
import { selectGlobalMode } from "../utils/home-mode"
import { MockNotFound } from "../utils/mock-api"
import { mockWorkspace } from "../utils/workspace"

test.use({ serviceWorkers: "block" })

test("MA03 selects an asset root and executor, saves their references, and reads the adopted versions in Chinese", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const directory = "/custom/agent-adoption"

  const rootAsset = {
    kind: "agent" as const,
    name: "custom-root",
    description: "User root",
    relativePath: "custom-root.md",
    revision: "a".repeat(64),
    config: "mode: all\n",
    source: "User root\n",
    handoffs: [],
    mode: "all" as const,
    hidden: false,
    disabled: false,
  }

  const workerAsset = {
    ...rootAsset,
    name: "custom-worker",
    description: "User executor",
    relativePath: "custom-worker.md",
    revision: "d".repeat(64),
    config: "mode: subagent\n",
    source: "User executor\n",
    mode: "subagent" as const,
  }

  const inventory = [rootAsset, workerAsset]

  const root = new Composition.AssetRoot({
    source: "asset",
    kind: "agent",
    id: Agent.ID.make(rootAsset.name),
    relativePath: rootAsset.relativePath,
    revision: Composition.Revision.make(rootAsset.revision),
  })

  const executor = new Composition.AgentRef({
    kind: "agent",
    relativePath: workerAsset.relativePath,
    revision: Composition.Revision.make(workerAsset.revision),
  })

  const rootInfo = Agent.Info.make({
    ...Agent.Info.empty(root.id),
    originKind: "user",
    originRelativePath: root.relativePath,
    originRevision: root.revision,
  })

  const workerInfo = Agent.Info.make({
    ...Agent.Info.empty(Agent.ID.make(workerAsset.name)),
    mode: "subagent",
    originKind: "user",
    originRelativePath: executor.relativePath,
    originRevision: executor.revision,
  })

  const plan = new Composition.Plan({
    ...CustomCompositionFixture.plan("build"),
    input: new Composition.TemporaryInput({
      source: "temporary",
      root,
      agents: [executor],
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
    }),
    orchestrator: rootInfo,
    agents: [
      new Composition.AgentInfo({
        id: workerInfo.id,
        name: workerInfo.name,
        description: workerAsset.description,
        relativePath: executor.relativePath,
        revision: executor.revision,
      }),
    ],
  })

  const nextRoot = new Composition.AssetRoot({
    ...root,
    revision: Composition.Revision.make("e".repeat(64)),
  })

  const nextRootInfo = Agent.Info.make({
    ...rootInfo,
    originRevision: nextRoot.revision,
  })

  const nextPlan = new Composition.Plan({
    ...plan,
    digest: Composition.Digest.make("f".repeat(64)),
    input: new Composition.TemporaryInput({
      source: "temporary",
      root: nextRoot,
      agents: [executor],
      bindings: {},
      presentation: "native",
      requestedCapabilities: [],
    }),
    orchestrator: nextRootInfo,
  })

  const writes: (typeof CustomProfileApplyPayload.Type)[] = []
  const starts: Composition.StartInput[] = []
  const plans: Composition.CompositionInput[] = []
  const profiles: CustomProfile.Info[] = []
  await mockWorkspace(page, {
    name: "Custom Agent Adoption",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    seed: { tabs: [], locale: "zh" },
    agentAssets: () => inventory,
    profiles,
    onCompositionPlan(input) {
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(
        input.body.source === "temporary" && input.body.root?.revision === nextRoot.revision ? nextPlan : plan,
      )
    },
    onProfileApply(input) {
      writes.push(input.body)

      const saved = new CustomProfile.Info({
        ...CustomProfileFixture.info(),
        name: input.body.candidate.name,
        description: input.body.candidate.description,
        relativePath: input.body.candidate.relativePath,
        profile: input.body.candidate.profile,
      })

      profiles.push(saved)

      return CustomProfileFixture.infoAnswer(saved)
    },
    onCompositionStart(input) {
      starts.push(input.body)
      const selected = input.body.expectedPlanDigest === nextPlan.digest ? nextPlan : plan

      const response = Schema.decodeUnknownSync(Schema.toCodecJson(Composition.StartResponse))(
        CustomCompositionFixture.startAnswer(input.body, directory, selected).body,
      )

      if (response.snapshot.version !== 2) throw new Error("Expected an adopted V2 snapshot")

      return {
        status: 200,
        body: Schema.encodeSync(Schema.toCodecJson(Composition.StartResponse))(
          new Composition.StartResponse({
            ...response,
            snapshot: new Composition.SnapshotV2({
              ...response.snapshot,
              data: {
                ...response.snapshot.data,
                agents: selected.agents ?? [],
                executors: [
                  new Composition.SnapshotExecutorData({
                    id: workerInfo.id,
                    relativePath: executor.relativePath,
                    revision: executor.revision,
                    info: workerInfo,
                  }),
                ],
              },
            }),
          }),
        ),
      }
    },
  })
  await page.goto("/")
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans")

  const customMode = page
    .getByRole("navigation", { name: "模式", exact: true })
    .getByRole("button", { name: "自定义", exact: true })

  await customMode.click()
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Custom Agent Adoption" }).click()
  await page.getByRole("tab", { name: "组合工作页", exact: true }).click()
  const composition = page.getByRole("region", { name: "自定义组合", exact: true })
  const definitions = composition.getByRole("region", { name: "智能体定义", exact: true })
  await definitions
    .locator("li")
    .filter({ hasText: rootAsset.name })
    .getByRole("button", { name: "设为根智能体", exact: true })
    .click()
  await definitions
    .locator("li")
    .filter({ hasText: workerAsset.name })
    .getByRole("button", { name: "添加执行成员", exact: true })
    .click()
  await composition.getByRole("button", { name: "预览组合", exact: true }).click()
  await expect(composition.getByRole("button", { name: "创建会话", exact: true })).toBeEnabled()
  expect(plans).toEqual([plan.input])
  const profile = page.getByRole("region", { name: "自定义配置方案", exact: true })
  await profile.getByRole("textbox", { name: "配置方案名称", exact: true }).fill("Saved Custom Agents")
  await profile.getByRole("textbox", { name: "配置方案路径", exact: true }).fill("custom-agents.yaml")
  await profile.getByRole("button", { name: "保存配置方案", exact: true }).click()
  await expect(profile.getByText("已保存的配置方案已就绪。", { exact: true })).toBeVisible()
  expect(writes).toHaveLength(1)
  expect(writes[0].candidate.profile).toMatchObject({ root, agents: [executor] })
  await page.screenshot({ path: testInfo.outputPath("custom-chinese-wide.png") })
  await composition.getByRole("button", { name: "预览组合", exact: true }).click()
  await composition.getByRole("button", { name: "创建会话", exact: true }).click()
  await expect.poll(() => starts.length).toBe(1)
  const id = starts[0].sessionID

  if (!id) throw new Error("Expected the reserved Session ID")
  await expectPath(page, sessionHref(id))
  await page.locator('summary[aria-label="已采用的组合"]').click()
  const adopted = page.getByRole("region", { name: "已采用的组合", exact: true })
  await expect(adopted.getByText(root.revision, { exact: true })).toBeVisible()
  await expect(
    adopted.getByRole("region", { name: "已采用的智能体", exact: true }).getByText(workerAsset.name, { exact: true }),
  ).toBeVisible()
  await expect(adopted.getByText(executor.revision, { exact: true })).toBeVisible()
  inventory.splice(0, 1, { ...rootAsset, revision: nextRoot.revision })
  await adopted.getByRole("button", { name: "重新加载组合", exact: true }).click()
  await expect(adopted.getByText(root.revision, { exact: true })).toBeVisible()
  await expect(adopted.getByText(nextRoot.revision, { exact: true })).toHaveCount(0)
  expect(starts[0]).toMatchObject({ composition: plan.input, expectedPlanDigest: plan.digest })

  await page.goto("/")
  await customMode.click()

  const selectedProject = page
    .locator('[data-component="home-project-row"]')
    .filter({ hasText: "Custom Agent Adoption" })

  if ((await selectedProject.getAttribute("aria-current")) !== "page") await selectedProject.click()
  await expect(selectedProject).toHaveAttribute("aria-current", "page")
  await definitions.getByRole("button", { name: "刷新定义", exact: true }).click()
  const nextDefinition = definitions.locator("li").filter({ hasText: rootAsset.name })
  await expect(nextDefinition.getByText(nextRoot.revision, { exact: true })).toBeVisible()
  await nextDefinition.getByRole("button", { name: "设为根智能体", exact: true }).click()
  await expect(nextDefinition.getByRole("button", { name: "已选根智能体", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await definitions
    .locator("li")
    .filter({ hasText: workerAsset.name })
    .getByRole("button", { name: "添加执行成员", exact: true })
    .click()
  await composition.getByRole("button", { name: "预览组合", exact: true }).click()
  await expect(composition.getByRole("button", { name: "创建会话", exact: true })).toBeEnabled()
  expect(plans.at(-1)).toEqual(nextPlan.input)
  await composition.getByRole("button", { name: "创建会话", exact: true }).click()
  await expect.poll(() => starts.length).toBe(2)
  const nextID = starts[1].sessionID

  if (!nextID) throw new Error("Expected the second reserved Session ID")
  expect(nextID).not.toBe(id)
  expect(starts[1]).toMatchObject({ composition: nextPlan.input, expectedPlanDigest: nextPlan.digest })
  await expectPath(page, sessionHref(nextID))
  await page.locator('summary[aria-label="已采用的组合"]').click()
  await expect(adopted.getByText(nextRoot.revision, { exact: true })).toBeVisible()
  await expect(adopted.getByText(root.revision, { exact: true })).toHaveCount(0)
  await expect(adopted.getByText(executor.revision, { exact: true })).toBeVisible()

  await page.goto(sessionHref(id))
  await page.locator('summary[aria-label="已采用的组合"]').click()
  await adopted.getByRole("button", { name: "重新加载组合", exact: true }).click()
  await expect(adopted.getByText(root.revision, { exact: true })).toBeVisible()
  await expect(adopted.getByText(nextRoot.revision, { exact: true })).toHaveCount(0)
  await expect(adopted.getByText(executor.revision, { exact: true })).toBeVisible()
  await page.goto("/")
  await customMode.click()
  await expect(composition.getByRole("heading", { name: "自定义组合", exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(profile.getByRole("textbox", { name: "配置方案名称", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("custom-chinese-narrow.png") })
})

test("B06 saves a captured root without a Session, reselects after reload, and adopts the explicit Profile plan", async ({
  page,
}, testInfo) => {
  const directory = "/profile/adoption"
  const saved = CustomProfileFixture.info()
  const profiles: CustomProfile.Info[] = []
  const writes: (typeof CustomProfileApplyPayload.Type)[] = []
  const plans: Composition.CompositionInput[] = []
  const starts: Composition.StartInput[] = []
  const creates: unknown[] = []
  const prompts: unknown[] = []
  const temporary = CustomCompositionFixture.plan("build")
  const adopted = CustomProfileFixture.plan(saved)
  await mockWorkspace(page, {
    name: "Profile Adoption",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    profiles,
    onProfileApply(input) {
      expect(input.directory).toBe(directory)
      writes.push(input.body)
      profiles.push(saved)

      return CustomProfileFixture.infoAnswer(saved)
    },
    onCompositionPlan(input) {
      expect(input.directory).toBe(directory)
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(input.body.source === "temporary" ? temporary : adopted)
    },
    onCompositionStart(input) {
      expect(input.directory).toBe(directory)
      starts.push(input.body)

      return CustomProfileFixture.startAnswer(input.body, directory, adopted, saved)
    },
    onSessionCreate: (input) => void creates.push(input),
    onPrompt: (input) => void prompts.push(input),
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Adoption" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await profile.getByRole("textbox", { name: "Profile name", exact: true }).fill(saved.name)
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill(saved.description)
  await profile.getByRole("textbox", { name: "Profile path", exact: true }).fill(saved.relativePath)
  await expect(profile.getByRole("button", { name: "Save profile", exact: true })).toBeDisabled()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).press("Enter")
  await expect(profile.getByRole("button", { name: "Save profile", exact: true })).toBeEnabled()

  const saveRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/custom-profile/apply",
  )

  await profile.getByRole("button", { name: "Save profile", exact: true }).press("Enter")
  const request = await saveRequest
  expect(request.postDataJSON()).not.toHaveProperty("sessionID")
  await expect(profile.getByText("Saved profile ready.", { exact: true })).toBeVisible()
  await expect(profile.getByText(saved.revision, { exact: true })).toBeVisible()
  await expect(profile.getByRole("button", { name: "Preview saved profile", exact: true })).toBeEnabled()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    overwrite: false,
    candidate: {
      name: saved.name,
      description: saved.description,
      relativePath: saved.relativePath,
      profile: {
        name: saved.name,
        description: saved.description,
        root: saved.profile.root,
        agents: [],
        bindings: {},
        requestedCapabilities: [],
      },
    },
  })
  expect(writes[0].baseRevision).toBeUndefined()
  expect(starts).toEqual([])
  expect(creates).toEqual([])
  expect(prompts).toEqual([])
  await expectPath(page, "/mode/custom")
  await page.reload()
  await expect(composition.getByText(directory, { exact: true })).toBeVisible()
  await expect(profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button")).toBeEnabled()
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").press("Enter")
  await page.getByRole("option", { name: `${saved.name} (${saved.relativePath})`, exact: true }).click()
  await expect(profile.getByRole("textbox", { name: "Profile name", exact: true })).toHaveValue(saved.name)
  await expect(profile.getByRole("button", { name: "Preview saved profile", exact: true })).toBeEnabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await profile.getByRole("textbox", { name: "Profile name", exact: true }).focus()
  await profile.getByRole("textbox", { name: "Profile name", exact: true }).press("Tab")
  await expect(profile.getByRole("textbox", { name: "Profile path", exact: true })).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath("saved-profile-narrow.png") })
  await profile.getByRole("button", { name: "Preview saved profile", exact: true }).press("Enter")
  await expect(composition.getByRole("heading", { name: "Composition preview", exact: true })).toBeVisible()
  await expect(composition.getByRole("button", { name: "Create session", exact: true })).toBeEnabled()
  expect(plans).toHaveLength(2)
  expect(plans[1]).toEqual({ source: "profile", profilePath: saved.relativePath, profileRevision: saved.revision })
  expect(starts).toEqual([])
  await composition.getByRole("button", { name: "Create session", exact: true }).press("Enter")
  await expect.poll(() => starts.length).toBe(1)
  const id = starts[0].sessionID

  if (!id) throw new Error("Profile start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(id))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await page.locator('summary[aria-label="Adopted composition"]').click()
  const summary = page.getByRole("region", { name: "Adopted composition", exact: true })
  await expect(summary.getByText(saved.relativePath, { exact: true })).toBeVisible()
  await expect(summary.getByText(saved.revision, { exact: true })).toBeVisible()
  await expect(summary.getByText(CustomCompositionFixture.revision, { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("adopted-profile-narrow.png") })
  expect(starts[0]).toMatchObject({ composition: adopted.input, expectedPlanDigest: adopted.digest })
  expect(creates).toEqual([])
  expect(prompts).toEqual([])
})

test("B06 keeps a save ACK after content readback fails and retries only reading the actual profile", async ({
  page,
}) => {
  const saved = CustomProfileFixture.info()
  const profiles: CustomProfile.Info[] = []
  const writes: (typeof CustomProfileApplyPayload.Type)[] = []
  const state = { unreadable: false }
  await mockWorkspace(page, {
    name: "Profile Readback",
    sessions: [],
    profiles,
    onCompositionPlan: () => CustomCompositionFixture.planAnswer(CustomCompositionFixture.plan("build")),
    onProfileApply(input) {
      writes.push(input.body)
      profiles.push(saved)
      state.unreadable = true

      return CustomProfileFixture.infoAnswer(saved)
    },
    onProfileContent: () =>
      state.unreadable
        ? {
            status: 400,
            body: Schema.encodeSync(Schema.toCodecJson(InvalidRequestError))(
              new InvalidRequestError({ message: "Saved profile temporarily unreadable" }),
            ),
          }
        : CustomProfileFixture.infoAnswer(saved),
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Readback" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await profile.getByRole("textbox", { name: "Profile name", exact: true }).fill(saved.name)
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill(saved.description)
  await profile.getByRole("textbox", { name: "Profile path", exact: true }).fill(saved.relativePath)
  await profile.getByRole("button", { name: "Save profile", exact: true }).click()
  await expect(profile.getByRole("alert")).toContainText("Saved profile temporarily unreadable")
  await expect(profile.getByRole("button", { name: "Save profile", exact: true })).toHaveCount(0)
  await expect(profile.getByRole("button", { name: "Retry reading profile", exact: true })).toBeEnabled()
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill("Edits after the save ACK")
  await profile.getByRole("textbox", { name: "Profile path", exact: true }).fill("next/reviewed.yaml")
  state.unreadable = false
  await profile.getByRole("button", { name: "Retry reading profile", exact: true }).click()
  await expect(profile.getByText(saved.revision, { exact: true })).toBeVisible()
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue(
    "Edits after the save ACK",
  )
  await expect(profile.getByRole("textbox", { name: "Profile path", exact: true })).toHaveValue("next/reviewed.yaml")
  await expect(profile.getByRole("button", { name: "Preview saved profile", exact: true })).toBeDisabled()
  expect(writes).toHaveLength(1)
  await expectPath(page, "/mode/custom")
})

test("B06 recovers a lost save reply by comparing the target content and catalog without repeating apply", async ({
  page,
}) => {
  const saved = CustomProfileFixture.info("meta")
  const profiles: CustomProfile.Info[] = []
  const writes: (typeof CustomProfileApplyPayload.Type)[] = []
  const reads: string[] = []
  await mockWorkspace(page, {
    name: "Profile Lost Reply",
    sessions: [],
    profiles,
    onCompositionPlan: () => CustomCompositionFixture.planAnswer(CustomCompositionFixture.plan("meta")),
    onProfileApply(input) {
      writes.push(input.body)
      profiles.push(saved)

      return { ...CustomProfileFixture.infoAnswer(saved), disconnect: true }
    },
    onProfileContent(input) {
      reads.push(input.path)

      return CustomProfileFixture.infoAnswer(saved)
    },
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Lost Reply" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await composition.getByRole("button", { name: "Meta", exact: true }).click()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await profile.getByRole("textbox", { name: "Profile name", exact: true }).fill(saved.name)
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill(saved.description)
  await profile.getByRole("textbox", { name: "Profile path", exact: true }).fill(saved.relativePath)
  await profile.getByRole("button", { name: "Save profile", exact: true }).click()
  await expect(profile.getByText("Saved profile ready.", { exact: true })).toBeVisible()
  await expect(profile.getByText(saved.revision, { exact: true })).toBeVisible()
  await expect(profile.getByRole("button", { name: "Preview saved profile", exact: true })).toBeEnabled()
  expect(writes).toHaveLength(1)
  expect(reads).toEqual([saved.relativePath])
  await expectPath(page, "/mode/custom")
})

test("B06 preserves edits on CAS conflict and explicitly overwrites the current revision without dropping references", async ({
  page,
}) => {
  const template = CustomProfileFixture.info()

  const references = CustomProfile.decodeProfile({
    ...template.profile,
    agents: [{ kind: "agent", relativePath: "builder.md", revision: "d".repeat(64) }],
    workflow: { kind: "workflow", relativePath: "release.yaml", revision: "e".repeat(64) },
    bindings: {
      orchestrator: {
        prompts: [{ kind: "prompt", relativePath: "review.md", revision: "f".repeat(64) }],
        skills: [{ kind: "skill", relativePath: "craft/SKILL.md", revision: "1".repeat(64) }],
        commands: [{ kind: "command", relativePath: "verify.md", revision: "2".repeat(64) }],
      },
    },
    requestedCapabilities: ["asset.info"],
    mcpBindings: [
      {
        serverName: "Docs",
        ref: { relativePath: "docs.yaml", revision: "3".repeat(64) },
        transport: "stdio",
        command: ["docs-mcp"],
      },
    ],
  })

  const initial = CustomProfileFixture.info("build", { profile: references })

  const latest = CustomProfileFixture.info("build", {
    revision: "4".repeat(64),
    description: "Changed by another editor",
    profile: CustomProfile.decodeProfile({ ...references, requestedCapabilities: ["asset.info", "project.read"] }),
  })

  const updated = CustomProfileFixture.info("build", {
    name: "My reviewed profile",
    description: "Draft edits 中文",
    revision: "5".repeat(64),
    profile: references,
  })

  const profiles = [initial]
  const writes: (typeof CustomProfileApplyPayload.Type)[] = []
  await mockWorkspace(page, {
    name: "Profile Conflict",
    sessions: [],
    profiles,
    onProfileApply(input) {
      writes.push(input.body)

      if (writes.length === 1) {
        profiles[0] = latest

        return {
          status: 409,
          body: Schema.encodeSync(Schema.toCodecJson(ConflictError))(
            new ConflictError({ resource: initial.relativePath, message: "Profile revision changed" }),
          ),
        }
      }

      profiles[0] = updated

      return CustomProfileFixture.infoAnswer(updated)
    },
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Conflict" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: `${initial.name} (${initial.relativePath})`, exact: true }).click()
  await expect(profile.getByRole("textbox", { name: "Profile name", exact: true })).toHaveValue(initial.name)
  await profile.getByRole("textbox", { name: "Profile name", exact: true }).fill(updated.name)
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill(updated.description)
  await profile.getByRole("button", { name: "Overwrite profile", exact: true }).click()
  await expect(profile.getByRole("alert")).toContainText("Profile revision changed")
  await expect(profile.getByText(`Current profile revision: ${latest.revision}`, { exact: true })).toBeVisible()
  await expect(profile.getByRole("textbox", { name: "Profile name", exact: true })).toHaveValue(updated.name)
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue(
    updated.description,
  )
  expect(writes).toHaveLength(1)
  await profile.getByRole("button", { name: "Overwrite profile", exact: true }).press("Enter")
  await expect(profile.getByText(updated.revision, { exact: true })).toBeVisible()
  expect(writes).toHaveLength(2)
  expect(writes[0].baseRevision).toBe(initial.revision)
  expect(writes[1]).toMatchObject({ overwrite: true, baseRevision: latest.revision })
  expect(writes[1].candidate.profile).toEqual(
    Schema.encodeSync(Schema.toCodecJson(CustomProfile.Profile))(updated.profile),
  )
})

test("B06 overwrites a conflicting legal path alias with the captured Build candidate and the Meta target's CAS revision", async ({
  page,
}) => {
  const initial = CustomProfileFixture.info("meta", { relativePath: "team/saved-build.yaml" })

  const updated = CustomProfileFixture.info("build", {
    name: "Build replacement 中文",
    relativePath: initial.relativePath,
    description: "Alias edit 中文",
    revision: "d".repeat(64),
  })

  const alias = ".omnixa\\custom-profiles\\team\\saved-build.yaml"
  const profiles = [initial]
  const writes: (typeof CustomProfileApplyPayload.Type)[] = []
  const reads: string[] = []
  await mockWorkspace(page, {
    name: "Profile Alias",
    sessions: [],
    profiles,
    onCompositionPlan: () => CustomCompositionFixture.planAnswer(CustomCompositionFixture.plan("build")),
    onProfileContent(input) {
      if (writes.length > 0) reads.push(input.path)

      return CustomProfileFixture.infoAnswer(profiles[0])
    },
    onProfileApply(input) {
      writes.push(input.body)

      if (writes.length === 1)
        return {
          status: 409,
          body: Schema.encodeSync(Schema.toCodecJson(ConflictError))(
            new ConflictError({ resource: initial.relativePath, message: "Profile target already exists" }),
          ),
        }

      profiles[0] = updated

      return CustomProfileFixture.infoAnswer(updated)
    },
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Alias" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await profile.getByRole("textbox", { name: "Profile name", exact: true }).fill(updated.name)
  await profile.getByRole("textbox", { name: "Profile path", exact: true }).fill(alias)
  await profile.getByRole("textbox", { name: "Profile description", exact: true }).fill(updated.description)
  await profile.getByRole("button", { name: "Save profile", exact: true }).click()
  await expect(profile.getByText(`Current profile revision: ${initial.revision}`, { exact: true })).toBeVisible()
  await expect(profile.getByRole("textbox", { name: "Profile path", exact: true })).toHaveValue(alias)
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({
    overwrite: false,
    candidate: { relativePath: alias, profile: { root: updated.profile.root } },
  })
  expect(writes[0].baseRevision).toBeUndefined()
  await profile.getByRole("button", { name: "Overwrite profile", exact: true }).press("Enter")
  await expect(profile.getByText(updated.revision, { exact: true })).toBeVisible()
  await expect(profile.getByRole("textbox", { name: "Profile path", exact: true })).toHaveValue(initial.relativePath)
  expect(writes).toHaveLength(2)
  expect(writes[1]).toMatchObject({
    overwrite: true,
    baseRevision: initial.revision,
    candidate: {
      relativePath: initial.relativePath,
      description: updated.description,
      profile: { root: updated.profile.root, agents: [] },
    },
  })
  expect(reads).toEqual([alias, initial.relativePath])
})

test("B06 rereads before Profile preview and preserves the editor when the saved revision changed", async ({
  page,
}) => {
  const initial = CustomProfileFixture.info()

  const latest = CustomProfileFixture.info("build", {
    description: "Fresh saved description",
    revision: "d".repeat(64),
  })

  const profiles = [initial]
  const plans: Composition.CompositionInput[] = []
  const starts: unknown[] = []
  await mockWorkspace(page, {
    name: "Profile Drift",
    sessions: [],
    profiles,
    onCompositionPlan(input) {
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(CustomProfileFixture.plan(latest))
    },
    onCompositionStart: (input) => {
      starts.push(input.body)

      return CustomProfileFixture.startAnswer(input.body, input.directory, CustomProfileFixture.plan(latest), latest)
    },
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Drift" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: `${initial.name} (${initial.relativePath})`, exact: true }).click()
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue(
    initial.description,
  )
  profiles[0] = latest
  await profile.getByRole("button", { name: "Preview saved profile", exact: true }).click()
  await expect(profile.getByRole("alert")).toContainText(`Profile ${initial.relativePath} changed`)
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue(
    initial.description,
  )
  await expect(profile.getByRole("button", { name: "Preview saved profile", exact: true })).toHaveCount(0)
  expect(plans).toEqual([])
  expect(starts).toEqual([])
  await profile.getByRole("button", { name: "Reload profile", exact: true }).click()
  await expect(profile.getByRole("textbox", { name: "Profile description", exact: true })).toHaveValue(
    latest.description,
  )
  await profile.getByRole("button", { name: "Preview saved profile", exact: true }).click()
  await expect(composition.getByRole("button", { name: "Create session", exact: true })).toBeEnabled()
  expect(plans).toEqual([{ source: "profile", profilePath: latest.relativePath, profileRevision: latest.revision }])
  expect(starts).toEqual([])
})

test("B06 preserves the Profile creation ACK through failed canonical readback and retries opening the same Session", async ({
  page,
}) => {
  const directory = "/profile/created-readback"
  const saved = CustomProfileFixture.info("meta")
  const value = CustomProfileFixture.plan(saved)
  const state = { unreadable: true }
  const starts: Composition.StartInput[] = []
  const prompts: unknown[] = []
  await mockWorkspace(page, {
    name: "Profile Created Readback",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    profiles: [saved],
    onCompositionPlan: () => CustomCompositionFixture.planAnswer(value),
    onCompositionStart(input) {
      starts.push(input.body)

      return CustomProfileFixture.startAnswer(input.body, directory, value, saved)
    },
    sessionReadError: () =>
      state.unreadable ? new MockNotFound({ message: "Profile session readback unavailable" }) : undefined,
    onPrompt: (input) => void prompts.push(input),
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Created Readback" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: `${saved.name} (${saved.relativePath})`, exact: true }).click()
  await profile.getByRole("button", { name: "Preview saved profile", exact: true }).click()
  await composition.getByRole("button", { name: "Create session", exact: true }).click()
  await expect(composition.getByRole("alert")).toContainText("Profile session readback unavailable")
  await expect(composition.getByRole("button", { name: "Create session", exact: true })).toHaveCount(0)
  await expect(profile.getByRole("textbox", { name: "Profile name", exact: true })).toBeDisabled()
  await expect(composition.getByRole("button", { name: "Open created session", exact: true })).toBeEnabled()
  expect(starts).toHaveLength(1)
  state.unreadable = false
  await composition.getByRole("button", { name: "Open created session", exact: true }).press("Enter")
  const id = starts[0].sessionID

  if (!id) throw new Error("Profile start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(id))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  expect(starts).toHaveLength(1)
  expect(prompts).toEqual([])
})

test("B06 retries a lost Profile start reply with the exact captured input, digest, and Session identity", async ({
  page,
}) => {
  const directory = "/profile/start-lost-reply"
  const saved = CustomProfileFixture.info()
  const value = CustomProfileFixture.plan(saved)
  const starts: Composition.StartInput[] = []
  const plans: Composition.CompositionInput[] = []

  const workspace = await mockWorkspace(page, {
    name: "Profile Start Lost Reply",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    profiles: [saved],
    onCompositionPlan(input) {
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(value)
    },
    onCompositionStart(input) {
      starts.push(input.body)

      return {
        ...CustomProfileFixture.startAnswer(input.body, directory, value, saved),
        disconnect: starts.length === 1,
      }
    },
    seed: { tabs: [] },
  })

  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile Start Lost Reply" }).click()
  await page.getByRole("tab", { name: "Compose", exact: true }).click()
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })
  await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: `${saved.name} (${saved.relativePath})`, exact: true }).click()
  await profile.getByRole("button", { name: "Preview saved profile", exact: true }).click()
  await composition.getByRole("button", { name: "Create session", exact: true }).click()
  await expect(composition.getByRole("button", { name: "Retry confirmation", exact: true })).toBeEnabled()
  await expect(profile.getByRole("textbox", { name: "Profile name", exact: true })).toBeDisabled()
  expect(starts).toHaveLength(1)
  expect(workspace.sessions).toHaveLength(1)
  await composition.getByRole("button", { name: "Retry confirmation", exact: true }).press("Enter")
  const id = starts[0].sessionID

  if (!id) throw new Error("Profile start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(id))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  expect(starts).toHaveLength(2)
  expect(starts[1]).toEqual(starts[0])
  expect(starts[0]).toMatchObject({ composition: value.input, expectedPlanDigest: value.digest })
  expect(plans).toHaveLength(1)
  expect(workspace.sessions).toHaveLength(1)
  expect(workspace.sessions[0].id).toBe(id)
})

test("B06 discards an old Location's late Profile read and adopts only the newly selected owner", async ({ page }) => {
  const directory = "/profile/owner-a"
  const nextDirectory = "/profile/owner-b"
  const first = CustomProfileFixture.info("build", { name: "Owner A profile", relativePath: "owner-a.yaml" })

  const second = CustomProfileFixture.info("plan", {
    name: "Owner B profile",
    relativePath: "owner-b.yaml",
    revision: "d".repeat(64),
  })

  const held = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const phase = { preview: false }
  const plans: { directory: string; body: Composition.CompositionInput }[] = []
  const starts: { directory: string; body: Composition.StartInput }[] = []
  await mockWorkspace(page, {
    name: "Profile owner A",
    directory,
    project: { id: "proj_owner_a" },
    projects: [
      project({ id: "proj_owner_a", directory, name: "Profile owner A" }),
      project({ id: "proj_custom_composition", directory: nextDirectory, name: "Profile owner B" }),
    ],
    sessions: [],
    onProfileList: (input) => CustomProfileFixture.listAnswer([input.directory === directory ? first : second]),
    async onProfileContent(input) {
      if (input.directory === directory && phase.preview) {
        phase.preview = false
        held.resolve()
        await release.promise
        finished.resolve()
      }

      return CustomProfileFixture.infoAnswer(input.directory === directory ? first : second)
    },
    onCompositionPlan(input) {
      plans.push(input)

      return CustomCompositionFixture.planAnswer(CustomProfileFixture.plan(second))
    },
    onCompositionStart(input) {
      starts.push(input)

      return CustomProfileFixture.startAnswer(input.body, input.directory, CustomProfileFixture.plan(second), second)
    },
    seed: {
      tabs: [],
      projects: {
        local: [
          { worktree: directory, expanded: true },
          { worktree: nextDirectory, expanded: true },
        ],
      },
    },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  const profile = page.getByRole("region", { name: "Custom profiles", exact: true })

  try {
    await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile owner A" }).click()
    await page.getByRole("tab", { name: "Compose", exact: true }).click()
    await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
    await page.getByRole("option", { name: `${first.name} (${first.relativePath})`, exact: true }).click()
    await expect(profile.getByRole("button", { name: "Preview saved profile", exact: true })).toBeEnabled()
    phase.preview = true
    await profile.getByRole("button", { name: "Preview saved profile", exact: true }).click()
    await held.promise

    const canceled = page.waitForEvent("requestfailed", {
      predicate: (request) => {
        const url = new URL(request.url())

        return url.pathname === "/custom-profile/content" && url.searchParams.get("directory") === directory
      },
    })

    await page.locator('[data-component="home-project-row"]').filter({ hasText: "Profile owner B" }).click()
    await canceled
    await page.getByRole("tab", { name: "Compose", exact: true }).click()
    await expect(composition.getByText(nextDirectory, { exact: true })).toBeVisible()
    await profile.getByRole("group", { name: "Saved profiles", exact: true }).getByRole("button").click()
    await page.getByRole("option", { name: `${second.name} (${second.relativePath})`, exact: true }).click()
    await expect(profile.getByRole("textbox", { name: "Profile name", exact: true })).toHaveValue(second.name)
    release.resolve()
    await finished.promise
    await expect(profile.getByRole("textbox", { name: "Profile path", exact: true })).toHaveValue(second.relativePath)
    expect(plans).toEqual([])
    expect(starts).toEqual([])
    await profile.getByRole("button", { name: "Preview saved profile", exact: true }).click()
    await expect(composition.getByRole("button", { name: "Create session", exact: true })).toBeEnabled()
    await composition.getByRole("button", { name: "Create session", exact: true }).click()
    await expect.poll(() => starts.length).toBe(1)
    const id = starts[0].body.sessionID

    if (!id) throw new Error("Profile start did not preserve its reserved Session ID")

    await expectPath(page, sessionHref(id))
    expect(plans).toEqual([
      {
        directory: nextDirectory,
        body: { source: "profile", profilePath: second.relativePath, profileRevision: second.revision },
      },
    ])
    expect(starts[0]).toMatchObject({
      directory: nextDirectory,
      body: {
        composition: { source: "profile", profilePath: second.relativePath, profileRevision: second.revision },
        expectedPlanDigest: CustomCompositionFixture.digest,
      },
    })
  } finally {
    release.resolve()
  }
})
