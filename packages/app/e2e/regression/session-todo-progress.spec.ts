import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/Aigcfroge/TodoProgressRegression"
const projectID = "proj_todo_progress_regression"
const sessionID = "ses_todo_progress_regression"
const title = "Todo progress regression"
const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

const userMessage = {
  info: {
    id: "msg_user_todo",
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_user_todo",
      sessionID,
      messageID: "msg_user_todo",
      type: "text",
      text: "delegate the work",
    },
  ],
}

const taskA = {
  id: "tsk_mock_a",
  content: "audit",
  status: "completed",
  priority: "high",
  sessionID,
  outputDigest: "ses_child",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
const taskB = {
  id: "tsk_mock_b",
  content: "review",
  status: "pending",
  priority: "medium",
  sessionID,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
const todoProjection = [
  { content: "audit", status: "completed", priority: "high" },
  { content: "review", status: "pending", priority: "medium" },
]

async function mockServer(page: Page, events: EventPayload[], config?: Partial<MockServerConfig>) {
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [userMessage] }),
    // Always re-serve a busy session status (idempotent) so the progress
    // container renders again after a reload, then drain the test's queue.
    events: () => [
      { directory, payload: { type: "session.status", properties: { sessionID, status: { type: "busy" } } } },
      ...events.splice(0, 1),
    ],
    eventRetry: 16,
    tasks: [taskA, taskB],
    ...config,
  })
}

test.describe("regression: session todo progress pulse line", () => {
  test("shows id-bearing nodes, opens the fold-over, and PATCHes a checkbox writeback", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    // The task.updated event fills the id-bearing session_task store.
    events.push({ directory, payload: { type: "task.updated", properties: { sessionID, tasks: [taskA, taskB] } } })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const node = page.locator('[data-component="session-todo-progress-node"]')
    await expect(node).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("1/2")
    // Id-bearing keys survive (the child-session digest link rides outputDigest).
    await expect(node.first()).toHaveAttribute("data-key", "tsk_mock_a")

    // Click stats → interactive checkbox fold-over.
    await page.locator('[data-component="session-todo-progress-stats"]').click()
    const panel = page.locator('[data-component="session-todo-progress-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-slot="checkbox-v2"]')).toHaveCount(2)

    // Checking the pending task PATCHes the reconciled list back. Kobalte
    // toggles on the control element, not the root.
    const patch = page.waitForResponse(
      (response) =>
        response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "PATCH",
    )
    await panel.locator('[data-slot="checkbox-v2-control"]').nth(1).click()
    const response = await patch
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(2)
    expect(body[1]?.id).toBe("tsk_mock_b")
    expect(body[1]?.status).toBe("completed")

    // The republished task.updated reconciles the fold-over to 2/2.
    events.push({
      directory,
      payload: {
        type: "task.updated",
        properties: { sessionID, tasks: [taskA, { ...taskB, status: "completed" }] },
      },
    })
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("2/2", {
      timeout: 10_000,
    })
  })

  test("restores nodes and stats after a reload via the todo pull", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events, { todoList: todoProjection })
    await configurePage(page)

    events.push({ directory, payload: { type: "task.updated", properties: { sessionID, tasks: [taskA, taskB] } } })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const node = page.locator('[data-component="session-todo-progress-node"]')
    await expect(node).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("1/2")

    // Reload: the busy status is re-served and the mock re-serves the todo
    // projection, so the pulse line recovers without re-delivering task.updated.
    await page.reload()
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("1/2")
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
    name: "todo-progress-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "todo-progress-regression",
    projectID,
    directory,
    title,
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
