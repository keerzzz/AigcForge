import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/Aigcfroge/AgentHubRegression"
const projectID = "proj_agent_hub_regression"
const sessionID = "ses_agent_hub_regression"
const title = "Agent hub regression"
const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

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

    // Pausing the active scheduled task PATCHes its status to cancelled.
    const patch = page.waitForResponse(
      (response) =>
        response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "PATCH",
    )
    await detail.locator('[data-slot="checkbox-v2-control"]').first().click()
    const response = await patch
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(5)
    const flipped = body.find((task: { id: string }) => task.id === "tsk_hub_sched_a")
    expect(flipped?.status).toBe("cancelled")
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
    await expect(spawn.locator('[data-component="agent-task-hub-spawn-source"]').first()).toContainText(
      "msg_user_hub",
    )
    await expect(spawn.locator('[data-component="agent-task-hub-spawn-task"]').first()).toContainText(
      "spawned audit",
    )

    // Behavior assertion: clicking the source lands on the resolved deep-link
    // hash (a render-only assertion would not catch a dead jump).
    await spawn.locator('[data-component="agent-task-hub-spawn-source"]').first().click()
    await expect(page).toHaveURL(/#message-msg_user_hub/)
  })
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
