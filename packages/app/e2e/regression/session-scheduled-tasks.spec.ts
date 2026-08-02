import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/Aigcfroge/ScheduledTasksRegression"
const projectID = "proj_scheduled_tasks_regression"
const sessionID = "ses_scheduled_tasks_regression"
const title = "Scheduled tasks regression"
const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }

type EventPayload = {
  directory: string
  payload: Record<string, unknown>
}

const userMessage = {
  info: {
    id: "msg_user_sched",
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [
    {
      id: "prt_user_sched",
      sessionID,
      messageID: "msg_user_sched",
      type: "text",
      text: "schedule the jobs",
    },
  ],
}

const nextRun = Date.UTC(2030, 0, 2, 9, 0, 0)
const taskSchedA = {
  id: "tsk_sched_a",
  content: "nightly report",
  status: "scheduled",
  priority: "medium",
  sessionID,
  recurrence: { cron: "0 9 * * *", enabled: true },
  nextRun,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}
const taskSchedB = {
  id: "tsk_sched_b",
  content: "one off",
  status: "cancelled",
  priority: "low",
  sessionID,
  scheduledAt: 1600000000000,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

async function mockServer(page: Page, events: EventPayload[], config?: Partial<MockServerConfig>) {
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [userMessage] }),
    events: () => [
      { directory, payload: { type: "session.status", properties: { sessionID, status: { type: "busy" } } } },
      ...events.splice(0, 1),
    ],
    eventRetry: 16,
    tasks: [taskSchedA, taskSchedB],
    ...config,
  })
}

test.describe("regression: session scheduled tasks UI", () => {
  test("shows the next-run chip and toggles a scheduled task from the popover", async ({ page }) => {
    const events: EventPayload[] = []
    await mockServer(page, events)
    await configurePage(page)

    events.push({
      directory,
      payload: { type: "task.updated", properties: { sessionID, tasks: [taskSchedA, taskSchedB] } },
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    // Title chip shows the upcoming run for the scheduled/pending task.
    const chip = page.locator('[data-component="session-scheduled-chip"]')
    await expect(chip).toBeVisible({ timeout: 15_000 })
    await expect(chip).toContainText("⚡")

    // dot-grid → "Scheduled tasks" menu item → popover with both scheduled tasks.
    await page.locator('[data-session-title] [aria-label="More options"]').click()
    await page.getByText("Scheduled tasks", { exact: true }).click()
    const popover = page.locator('[data-component="session-scheduled-popover"]')
    await expect(popover).toBeVisible({ timeout: 10_000 })
    await expect(popover.locator('[data-slot="checkbox-v2"]')).toHaveCount(2)

    // Checking the active scheduled task PATCHes it to cancelled (echo body).
    const patch = page.waitForResponse(
      (response) =>
        response.url().includes(`/session/${sessionID}/task`) && response.request().method() === "PATCH",
    )
    await popover.locator('[data-slot="checkbox-v2-control"]').first().click()
    const response = await patch
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toHaveLength(2)
    const flipped = body.find((task: { id: string }) => task.id === "tsk_sched_a")
    expect(flipped?.status).toBe("cancelled")
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
    name: "scheduled-tasks-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "scheduled-tasks-regression",
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
