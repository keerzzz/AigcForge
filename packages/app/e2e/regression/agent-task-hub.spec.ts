import { expect, test, type Page } from "@playwright/test"
import type { DelegationParticipantInfo, DelegationState, SessionTaskInfo } from "@aigcfroge/sdk/v2/client"
import { ProductModeAgentPolicy } from "@aigcfroge/core/product-mode-agent-policy"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { pinEnglishUI } from "../utils/locale"
import { expectSessionTitle } from "../utils/waits"

// English-label spec — pin the UI language so the zh projects stay green (see utils/locale.ts).
test.beforeEach(({ page }) => pinEnglishUI(page))

const directory = "C:/Aigcfroge/AgentHubRegression"
const projectID = "proj_agent_hub_regression"
const sessionID = "ses_agent_hub_regression"
const title = "Agent hub regression"
const model = { providerID: "deepseek", modelID: "deepseek-v4-flas" }

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

const userMessage = {
  info: {
    id: "msg_user_hub",
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_user_hub",
      sessionID,
      messageID: "msg_user_hub",
      type: "text",
      text: "manage agents",
    },
  ],
}

const assistantMessage = {
  info: {
    id: "msg_assistant_hub",
    sessionID,
    role: "assistant",
    time: { created: 1700000001000 },
    parentID: "msg_user_hub",
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [
    {
      id: "prt_assistant_hub",
      sessionID,
      messageID: "msg_assistant_hub",
      type: "text",
      text: "spawned a task",
    },
  ],
}

const nextRun = Date.UTC(2030, 0, 2, 9, 0, 0)
const taskSchedA = {
  id: "tsk_hub_sched_a",
  content: "nightly report",
  status: "scheduled",
  priority: "medium",
  sessionID,
  agentID: "build",
  recurrence: { cron: "0 9 * * *", enabled: true },
  nextRun,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
const taskSchedB = {
  id: "tsk_hub_sched_b",
  content: "one off",
  status: "cancelled",
  priority: "low",
  sessionID,
  agentID: "build",
  scheduledAt: 1600000000000,
  nextRun,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
const taskPlain = {
  id: "tsk_hub_plain",
  content: "audit",
  status: "pending",
  priority: "high",
  sessionID,
  agentID: "build",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
const taskOrphan = {
  id: "tsk_hub_orphan",
  content: "legacy",
  status: "pending",
  priority: "low",
  sessionID,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
const taskSpawned = {
  id: "tsk_hub_spawned",
  content: "spawned audit",
  status: "pending",
  priority: "medium",
  sessionID,
  agentID: "build",
  spawnedFrom: "msg_assistant_hub",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

const allTasks = [taskSchedA, taskSchedB, taskPlain, taskOrphan, taskSpawned]

async function mockServer(page: Page, events: EventPayload[], config?: Partial<MockServerConfig>) {
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [userMessage, assistantMessage] }),
    // The hub lists every directory agent plus the unassigned bucket. The shared mock now
    // also exposes meta/assistant-orchestrator (2026-10-15 projection alignment), so pin this
    // spec's directory to the one agent its assertions are about.
    agents: [
      {
        name: "build",
        mode: "primary",
        permission: [],
        options: {},
        primaryModes: [...ProductModeAgentPolicy.primaryModes("build")],
      },
    ],
    events: () => [
      { directory, payload: { type: "session.status", properties: { sessionID, status: { type: "busy" } } } },
      ...events.splice(0, 1),
    ],
    eventRetry: 16,
    tasks: allTasks,
    ...config,
  })
}

test.describe("regression: agent hub scheduled-task management (M4)", () => {
  test("opens the hub, lists the agent's tasks, and toggles a scheduled task", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    events.push({
      directory,
      payload: { type: "task.updated", properties: { sessionID, tasks: allTasks } },
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    // dot-grid → "My agents" menu item → the hub popover opens.
    await page.locator('[data-session-title] [aria-label="More options"]').click()
    await page.getByText("My agents", { exact: true }).click()
    const hub = page.locator('[data-component="agent-task-hub"]')
    await expect(hub).toBeVisible({ timeout: 15_000 })

    // Zone 1 shows the registered "build" agent plus the "未归属" bucket for the
    // orphaned (agent-less) task.
    const agentRows = hub.locator('[data-component="agent-task-hub-agent"]')
    await expect(agentRows).toHaveCount(2)
    await expect(agentRows.first()).toContainText("build")
    await expect(agentRows.nth(1)).toContainText("Unassigned")

    // Select "build" and wait for the cross-session aggregation to seed the store.
    await agentRows.first().click()
    const detail = hub.locator('[data-component="agent-task-hub-detail"]')
    await expect(detail).toBeVisible({ timeout: 15_000 })
    await expect(detail.locator('[data-component="agent-task-hub-scheduled"]')).toHaveCount(2)

    // The plain (non-scheduled) task renders as a read-only row.
    await expect(detail.locator('[data-component="agent-task-hub-task"]').first()).toContainText("audit")

    // Pausing the active scheduled task PATCHes its status to cancelled
    // (single-task patch, HIGH-2 — response is the one patched task).
    const patch = page.waitForResponse(
      (response) => response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "PATCH",
    )
    await detail.locator('[data-slot="checkbox-v2-control"]').first().click()
    const response = await patch
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.id).toBe("tsk_hub_sched_a")
    expect(body.status).toBe("cancelled")
  })

  test("renders the task-derivation zone grouped by source message", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    events.push({
      directory,
      payload: { type: "task.updated", properties: { sessionID, tasks: allTasks } },
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    await page.locator('[data-session-title] [aria-label="More options"]').click()
    await page.getByText("My agents", { exact: true }).click()
    const hub = page.locator('[data-component="agent-task-hub"]')
    await expect(hub).toBeVisible({ timeout: 15_000 })

    // Zone 2b: the spawned task is grouped under its source message — an
    // assistant message, whose jump resolves to the parent user message anchor.
    const spawn = hub.locator('[data-component="agent-task-hub-spawn"]')
    await expect(spawn).toBeVisible({ timeout: 15_000 })
    await expect(spawn.locator('[data-component="agent-task-hub-spawn-source"]').first()).toContainText("msg_user_hub")
    await expect(spawn.locator('[data-component="agent-task-hub-spawn-task"]').first()).toContainText("spawned audit")

    // Behavior assertion: clicking the source lands on the resolved deep-link
    // hash (a render-only assertion would not catch a dead jump).
    await spawn.locator('[data-component="agent-task-hub-spawn-source"]').first().click()
    await expect(page).toHaveURL(/#message-msg_user_hub/)
  })

  test("deletes a scheduled task via the hub's remove action", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    events.push({
      directory,
      payload: { type: "task.updated", properties: { sessionID, tasks: allTasks } },
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    await page.locator('[data-session-title] [aria-label="More options"]').click()
    await page.getByText("My agents", { exact: true }).click()
    const hub = page.locator('[data-component="agent-task-hub"]')
    await expect(hub).toBeVisible({ timeout: 15_000 })
    await hub.locator('[data-component="agent-task-hub-agent"]').first().click()
    const detail = hub.locator('[data-component="agent-task-hub-detail"]')
    await expect(detail).toBeVisible({ timeout: 15_000 })
    await expect(detail.locator('[data-component="agent-task-hub-scheduled"]')).toHaveCount(2)

    // Removing the first scheduled task DELETEs it atomically (HIGH-2).
    const del = page.waitForResponse(
      (response) => response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "DELETE",
    )
    await detail
      .locator('[data-component="agent-task-hub-scheduled"]')
      .first()
      .locator('[data-component="agent-task-hub-task-delete"]')
      .click()
    const response = await del
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.id).toBe("tsk_hub_sched_a")
  })

  test("creates a scheduled task via the hub's create form", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    events.push({
      directory,
      payload: { type: "task.updated", properties: { sessionID, tasks: allTasks } },
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    await page.locator('[data-session-title] [aria-label="More options"]').click()
    await page.getByText("My agents", { exact: true }).click()
    const hub = page.locator('[data-component="agent-task-hub"]')
    await expect(hub).toBeVisible({ timeout: 15_000 })
    await hub.locator('[data-component="agent-task-hub-agent"]').first().click()
    const detail = hub.locator('[data-component="agent-task-hub-detail"]')
    await expect(detail).toBeVisible({ timeout: 15_000 })

    // Toggle the create form open (the secondary button flips to "Cancel").
    await detail.getByText("New scheduled task", { exact: true }).click()
    const form = detail.locator('[data-component="agent-task-hub-create-form"]')
    await expect(form).toBeVisible()
    const submit = form.getByText("New scheduled task", { exact: true })
    await form.getByPlaceholder("Task content").fill("nightly digest")

    // A one-shot time in the past must not be creatable (m-5: the server's
    // dead-job guard only validates recurrence, so the UI rejects it up front).
    const atInput = form.locator('input[type="datetime-local"]')
    await atInput.fill("2020-01-01T09:00")
    await expect(submit).toBeDisabled()
    await atInput.fill("")

    await form.getByPlaceholder("Cron expression").fill("0 8 * * *")

    // With the form open, "New scheduled task" is now the submit button.
    // The create appends ONE task atomically (POST, HIGH-2).
    const create = page.waitForResponse(
      (response) => response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "POST",
    )
    await submit.click()
    const response = await create
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      content: "nightly digest",
      status: "scheduled",
      priority: "medium",
      agentID: "build",
      recurrence: { cron: "0 8 * * *", enabled: true },
    })
  })
})

test("delegation panel remains usable at a narrow viewport", async ({ page }) => {
  const errors = trackPageErrors(page)
  const events: EventPayload[] = []
  await mockServer(page, events, {
    delegations: [
      {
        delegation: {
          id: "dlg_narrow",
          parentSessionID: sessionID,
          title: "A very long delegation title that must wrap without losing controls",
          status: "running",
          rejectionBlocked: false,
          lastActivityAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        participants: [],
        turns: [],
        softExpired: false,
      },
    ],
  })
  // Coding sessions never consume the Custom snapshot; the fixture's fidelity 404 for
  // that request is expected here and unrelated to the delegation panel under test.
  await page.route("**/session/*/composition*", (route) => route.fulfill({ status: 200, json: {} }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await page.locator('[data-session-title] [aria-label="More options"]').click()
  await page.getByText("My agents", { exact: true }).click()
  const panel = page.locator('[data-component="delegation-panel"]')
  await expect(panel).toBeVisible()
  const card = panel.locator('[data-component="delegation-card"]')
  await expect(card).toBeVisible()
  await expect(card).toContainText("running")
  expect((await panel.boundingBox())?.width ?? 999).toBeLessThanOrEqual(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  )
  expect(errors, `unexpected browser errors: ${errors.join(" | ")}`).toEqual([])
})

async function configurePage(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 })
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "agent-hub-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "agent-hub-regression",
    projectID,
    directory,
    title,
    agent: "build",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "deepseek",
        name: "DeepSeek",
        models: {
          "deepseek-v4-flas": {
            id: "deepseek-v4-flas",
            name: "DeepSeek V4 Flas",
            limit: { context: 200_000 },
          },
        },
      },
    ],
    connected: ["deepseek"],
    default: { providerID: "deepseek", modelID: "deepseek-v4-flas" },
  }
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

test("AI-TDD-S04-R03 and AI-TDD-S04-R04 same-named participants keep independent child routes after summary changes", async ({
  page,
}) => {
  const childA = "ses_s04_child_a"
  const childB = "ses_s04_child_b"
  const delegation: DelegationState = {
    delegation: {
      id: "dlg_s04_instances",
      parentSessionID: sessionID,
      title: "same agent instances",
      status: "running",
      rejectionBlocked: false,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    participants: [
      s04Participant({ id: "par_s04_a", delegationID: "dlg_s04_instances", childSessionID: childA }),
      s04Participant({ id: "par_s04_b", delegationID: "dlg_s04_instances", childSessionID: childB }),
    ],
    turns: [],
    softExpired: false,
  }
  await mockServer(page, [], {
    sessions: [
      { ...session(), mode: "coding" },
      { ...session(), id: childA, slug: childA, parentID: sessionID, title: "First build instance", mode: "coding" },
      { ...session(), id: childB, slug: childB, parentID: sessionID, title: "Second build instance", mode: "coding" },
    ],
    pageMessages: (id) => ({ items: id === sessionID ? [userMessage, assistantMessage] : [] }),
    delegations: [delegation],
  })
  await configurePage(page)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  const hub = await openS04Hub(page)
  const card = hub.locator('[data-component="delegation-card"]')
  const participants = card.getByRole("button", { name: "implementer: build", exact: true })

  await expect(card).toHaveCount(1)
  await expect(card).toHaveAttribute("data-status", "running")
  await expect(participants).toHaveCount(2)
  await participants.nth(0).click()
  await expect(page).toHaveURL(new RegExp(`/session/${childA}$`))
  await expectSessionTitle(page, "First build instance")

  delegation.delegation.title = "completed summary points to ses_not_the_child"
  await page.goBack()
  await expectSessionTitle(page, title)
  await openS04Hub(page)
  await expect(card).toContainText("completed summary points to ses_not_the_child")
  await expect(card).toHaveAttribute("data-status", "running")
  await expect(participants).toHaveCount(2)
  await participants.nth(1).click()
  await expect(page).toHaveURL(new RegExp(`/session/${childB}$`))
  await expectSessionTitle(page, "Second build instance")
})

test("AI-TDD-S04-R03 cross-session tasks stay independent and the unassigned bucket retains all six states", async ({
  page,
}) => {
  const childA = "ses_s04_tasks_a"
  const childB = "ses_s04_tasks_b"
  const statuses = ["pending", "in_progress", "completed", "cancelled", "scheduled", "failed"] as const
  const tasks: SessionTaskInfo[] = [
    {
      id: "tsk_s04_a",
      sessionID: childA,
      agentID: "build",
      content: "same summary",
      status: "in_progress",
      priority: "medium",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "tsk_s04_b",
      sessionID: childB,
      agentID: "build",
      content: "same summary",
      status: "failed",
      priority: "medium",
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    ...statuses.map(
      (status, index): SessionTaskInfo => ({
        id: `tsk_s04_unassigned_${index}`,
        sessionID,
        content: `unassigned ${status}`,
        status,
        priority: "medium",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ),
  ]
  await mockServer(page, [], {
    sessions: [
      { ...session(), mode: "coding" },
      { ...session(), id: childA, slug: childA, parentID: sessionID, title: "First task instance", mode: "coding" },
      { ...session(), id: childB, slug: childB, parentID: sessionID, title: "Second task instance", mode: "coding" },
    ],
    pageMessages: (id) => ({ items: id === sessionID ? [userMessage, assistantMessage] : [] }),
    tasks,
  })
  await configurePage(page)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  const hub = await openS04Hub(page)
  await hub.locator('[data-component="agent-task-hub-agent"]').filter({ hasText: "build" }).click()
  const rows = hub.locator('[data-component="agent-task-hub-task"]')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: "same summary" })).toHaveCount(2)
  await expect(hub.locator('[data-component="agent-task-hub-task"][data-status="in_progress"]')).toHaveCount(1)
  await expect(hub.locator('[data-component="agent-task-hub-task"][data-status="failed"]')).toHaveCount(1)

  await hub.locator('[data-component="agent-task-hub-agent"]').filter({ hasText: "Unassigned" }).click()
  await expect(rows).toHaveCount(6)
  await Promise.all(
    statuses.map((status) =>
      expect(hub.locator(`[data-component="agent-task-hub-task"][data-status="${status}"]`)).toContainText(
        `unassigned ${status}`,
      ),
    ),
  )
})

test("AI-TDD-S04-R05 active or running participants without advertised capabilities expose no delegation controls", async ({
  page,
}) => {
  const child = "ses_s04_navigable"
  const delegation: DelegationState = {
    delegation: {
      id: "dlg_s04_no_capabilities",
      parentSessionID: sessionID,
      title: "steer resume interrupt are not capabilities",
      status: "running",
      rejectionBlocked: false,
      lastActivityAt: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    participants: [
      s04Participant({ id: "par_s04_internal", delegationID: "dlg_s04_no_capabilities", childSessionID: child }),
      s04Participant({
        id: "par_s04_external",
        delegationID: "dlg_s04_no_capabilities",
        provider: "codex",
        target: "codex",
        role: "reviewer",
        phase: "active",
        runtimeStatus: "running",
        externalThreadID: "thread_s04_external",
      }),
    ],
    turns: [],
    softExpired: false,
  }
  await mockServer(page, [], {
    sessions: [
      { ...session(), mode: "coding" },
      { ...session(), id: child, slug: child, parentID: sessionID, title: "Navigable child", mode: "coding" },
    ],
    pageMessages: (id) => ({ items: id === sessionID ? [userMessage, assistantMessage] : [] }),
    delegations: [delegation],
  })
  await configurePage(page)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  const hub = await openS04Hub(page)
  const panel = hub.locator('[data-component="delegation-panel"]')

  await expect(panel.locator('[data-component="delegation-card"]')).toHaveCount(1)
  await expect(panel.getByRole("button")).toHaveCount(2)
  await expect(panel.getByRole("button", { name: "implementer: build", exact: true })).toBeEnabled()
  await expect(panel.getByRole("button", { name: "reviewer: codex", exact: true })).toBeDisabled()
  await expect(panel.getByRole("button", { name: /steer|resume|interrupt/i })).toHaveCount(0)
})

function s04Participant(
  input: Pick<DelegationParticipantInfo, "id" | "delegationID"> & Partial<DelegationParticipantInfo>,
): DelegationParticipantInfo {
  return {
    provider: "internal",
    target: "build",
    role: "implementer",
    context: "fresh",
    phase: "active",
    runtimeStatus: "running",
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...input,
  }
}

async function openS04Hub(page: Page) {
  await page.locator('[data-session-title] [aria-label="More options"]').click()
  await page.getByText("My agents", { exact: true }).click()
  const hub = page.locator('[data-component="agent-task-hub"]')
  await expect(hub).toBeVisible()
  return hub
}
