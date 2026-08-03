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
    // Id-bearing keys survive, and each node exposes its content via title
    // (the keyboard-accessible tooltip per plan §5.5).
    await expect(node.first()).toHaveAttribute("data-key", "tsk_mock_a")
    await expect(node.first()).toHaveAttribute("title", "audit")
    await expect(node.nth(1)).toHaveAttribute("title", "review")

    // Click stats → interactive checkbox fold-over.
    await page.locator('[data-component="session-todo-progress-stats"]').click()
    const panel = page.locator('[data-component="session-todo-progress-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-slot="checkbox-v2"]')).toHaveCount(2)

    // Checking the pending task PATCHes the reconciled list back. Kobalte
    // toggles on the control element, not the root.
    const patch = page.waitForResponse(
      (response) => response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "PATCH",
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

  test("restores nodes and stats after a reload via the task pull", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events, { todoList: todoProjection })
    await configurePage(page)

    events.push({ directory, payload: { type: "task.updated", properties: { sessionID, tasks: [taskA, taskB] } } })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const node = page.locator('[data-component="session-todo-progress-node"]')
    await expect(node).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("1/2")

    // Reload: the busy status is re-served and the mount effect reseeds the
    // id-bearing store from GET /session/:id/task (task.updated is NOT
    // re-delivered), so the pulse line recovers with stable ids.
    await page.reload()
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("1/2")
  })

  test("keeps stable task ids through a reload-to-toggle round trip", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    // Only the initial GET /session/:id/task seeds the store; no task.updated
    // event is delivered in this test at all.
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(2, { timeout: 15_000 })

    // Reload and toggle without any SSE re-delivery: the writeback must PATCH
    // with the ORIGINAL ids (re-minting ids would delete the stored rows and
    // wipe their persisted outputDigest).
    await page.reload()
    await expectSessionTitle(page, title)
    await page.locator('[data-component="session-todo-progress-stats"]').click()
    const panel = page.locator('[data-component="session-todo-progress-panel"]')
    await expect(panel).toBeVisible()

    const patch = page.waitForResponse(
      (response) => response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "PATCH",
    )
    await panel.locator('[data-slot="checkbox-v2-control"]').nth(1).click()
    const response = await patch
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(2)
    expect(body[0]?.id).toBe("tsk_mock_a")
    expect(body[1]?.id).toBe("tsk_mock_b")
    expect(body[1]?.status).toBe("completed")
  })

  test("renders the id-less V1 todo projection read-only", async ({ page }) => {
    const events: EventPayload[] = []
    // No tasks served by GET /session/:id/task and no task.updated event:
    // the component falls back to the three-field todo projection (V1 runtime).
    await mockServer(page, events, { tasks: [], todoList: todoProjection })
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(2, { timeout: 15_000 })
    await page.locator('[data-component="session-todo-progress-stats"]').click()
    const panel = page.locator('[data-component="session-todo-progress-panel"]')
    await expect(panel).toBeVisible()
    // Id-less entries are read-only: PATCHing them would re-mint ids and wipe
    // the persisted outputDigest, so every checkbox is disabled. Kobalte marks
    // disabled state with the data-disabled attribute on the control element.
    await expect(panel.locator('[data-slot="checkbox-v2-control"]').first()).toHaveAttribute("data-disabled", "")
    await expect(panel.locator('[data-slot="checkbox-v2-control"]').nth(1)).toHaveAttribute("data-disabled", "")
  })
})

test.describe("regression: session todo progress M7 unified track", () => {
  test("renders the track below the title row", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)
    events.push({ directory, payload: { type: "task.updated", properties: { sessionID, tasks: [taskA, taskB] } } })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(2, { timeout: 15_000 })

    const track = page.locator('[data-component="session-todo-progress"]')
    const titleRow = page.locator('[data-slot="session-title-child"]')
    const trackBox = await track.boundingBox()
    const titleBox = await titleRow.boundingBox()
    expect(trackBox).not.toBeNull()
    expect(titleBox).not.toBeNull()
    // M7 决策 1: the unified track sits below the title row.
    expect(trackBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height)
  })

  test("renders no label/nodes/stats in the no-todo environment-pulse state", async ({ page }) => {
    const events: EventPayload[] = []
    // No task data and no todo projection → the container shows only the env pulse.
    await mockServer(page, events, { tasks: [] })
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-progress-bar"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-component="session-todo-progress-label"]')).toHaveCount(0)
    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(0)
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveCount(0)
  })

  test("shows the task-list label once tasks activate", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)
    events.push({ directory, payload: { type: "task.updated", properties: { sessionID, tasks: [taskA, taskB] } } })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-label"]')).toBeVisible({ timeout: 15_000 })
  })

  test("retains a static strip when idle with tasks (no task pulse)", async ({ page }) => {
    // No busy session.status event — the session stays idle, so the strip must
    // persist statically (M7 决策 2 idle 静态留存) without the task pulse.
    await mockAigcfrogeServer(page, {
      directory,
      project: project(),
      provider: provider(),
      sessions: [session()],
      pageMessages: () => ({ items: [userMessage] }),
      events: () => [
        { directory, payload: { type: "task.updated", properties: { sessionID, tasks: [taskA, taskB] } } },
      ],
      eventRetry: 16,
      tasks: [taskA, taskB],
    })
    await configurePage(page)
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(2, { timeout: 15_000 })
    await expect(page.locator('[data-component="session-todo-progress-pulse"]')).toHaveCount(0)
  })

  test("flips the stats to the success color when all tasks complete", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)
    events.push({
      directory,
      payload: {
        type: "task.updated",
        properties: { sessionID, tasks: [taskA, { ...taskB, status: "completed" }] },
      },
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveAttribute(
      "data-complete",
      "true",
      {
        timeout: 15_000,
      },
    )
  })

  test("closes the fold-over when clicking outside the track", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)
    events.push({ directory, payload: { type: "task.updated", properties: { sessionID, tasks: [taskA, taskB] } } })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expect(page.locator('[data-component="session-todo-progress-node"]')).toHaveCount(2, { timeout: 15_000 })

    const panel = page.locator('[data-component="session-todo-progress-panel"]')
    await page.locator('[data-component="session-todo-progress-stats"]').click()
    await expect(panel).toBeVisible()
    // A click on the title row (outside the track) dismisses the panel.
    await page.locator('[data-slot="session-title-child"]').click()
    await expect(panel).not.toBeVisible()
  })

  test("measures the track and renders the task pulse px range when working", async ({ page }) => {
    const events: EventPayload[] = []
    // Mount with an empty task list: the strip must mount strictly after the
    // first frame, when the task.updated event arrives over SSE. A one-shot
    // ref read at mount would leave trackWidth at 0 — the pulse would render
    // without its --pulse-*-px range and the 8px inset would stay dead.
    await mockServer(page, events, { tasks: [] })
    await configurePage(page)
    events.push({
      directory,
      payload: {
        type: "task.updated",
        properties: { sessionID, tasks: [taskA, { ...taskB, status: "in_progress" }] },
      },
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    const pulse = page.locator('[data-component="session-todo-progress-pulse"]')
    await expect(pulse).toBeVisible({ timeout: 15_000 })
    await expect(pulse).toHaveAttribute("style", /--pulse-from-px/)
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
