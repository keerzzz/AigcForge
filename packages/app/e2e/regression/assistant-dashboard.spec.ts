import { expect, test, type Page } from "@playwright/test"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"

const directory = "C:/Aigcfroge/AssistantDashboardRegression"
const projectID = "proj_assistant_dashboard_regression"
const sessionID = "ses_assistant_dashboard_regression"
const title = "Assistant dashboard regression"

const pendingReminder = {
  id: "sch_pending_1",
  sessionID,
  kind: "reminder",
  content: "Follow up with customer",
  dueAt: Date.now() + 3600_000,
  timezone: "Asia/Shanghai",
  status: "pending",
  attempts: 0,
  deliveryKey: "reminder:due:1",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

const delivered = {
  deliveryKey: "reminder:delivered:1",
  scheduleID: "sch_done_1",
  sessionID,
  kind: "reminder",
  content: "Daily standup",
  deliveredAt: Date.now() - 60_000,
  caughtUp: false,
  createdAt: Date.now() - 60_000,
}

const pendingMemory = {
  id: "pm_proposed_1",
  content: "User prefers concise answers",
  source: "derived",
  trustLevel: "medium",
  sensitivityLevel: "low",
  status: "pending",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

const kbNote = {
  id: "kb_note_1",
  title: "Q3 goals",
  content: "Ship assistant mode.",
  scope: "global",
  tags: ["work"],
  format: "note",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

test.describe("regression: assistant dashboard", () => {
  test("renders the dashboard with pending reminders, deliveries, memory, and notes", async ({ page }) => {
    await mockServer(page, { state: {} })
    await configurePage(page)

    await page.goto("/mode/assistant")
    await expect(page.getByRole("heading", { name: "Assistant Dashboard" })).toBeVisible({ timeout: 15_000 })

    // ① pending reminder bar (always visible, main mental model).
    const reminder = page.getByText("Follow up with customer")
    await expect(reminder).toBeVisible({ timeout: 10_000 })

    // ② recent deliveries block.
    await expect(page.getByText("Daily standup")).toBeVisible()

    // ③ memory inspector: pending proposal with confirm/reject actions.
    await expect(page.getByText("User prefers concise answers")).toBeVisible()
    await expect(page.getByLabel("Confirm")).toBeVisible()
    await expect(page.getByLabel("Reject")).toBeVisible()

    // ④ knowledge base notes.
    await expect(page.getByText("Q3 goals")).toBeVisible()
  })

  test("cancels a pending reminder from the dashboard", async ({ page }) => {
    let cancelled = false
    await mockServer(page, {
      state: {},
      onScheduleCancel: () => {
        cancelled = true
      },
    })
    await configurePage(page)

    await page.goto("/mode/assistant")
    const cancel = page.getByLabel("Cancel").first()
    await expect(cancel).toBeVisible({ timeout: 15_000 })
    await cancel.click()
    await expect
      .poll(() => cancelled, { timeout: 10_000 })
      .toBe(true)
  })
})

async function mockServer(page: Page, extra: { state: object } & Partial<MockServerConfig>) {
  const { state, ...config } = extra
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
    ...config,
  })
  // Assistant API routes (schedule/delivery/memory/kb).
  await page.route("**/schedule/pending", (route) => route.fulfill({ json: [pendingReminder] }))
  await page.route("**/delivery/recent**", (route) => route.fulfill({ json: [delivered] }))
  await page.route("**/memory", (route) => route.fulfill({ json: [pendingMemory] }))
  await page.route("**/kb", (route) => route.fulfill({ json: [kbNote] }))
  await page.route("**/schedule/*/cancel", (route) => {
    if (extra.onScheduleCancel) extra.onScheduleCancel()
    return route.fulfill({ json: { ...pendingReminder, status: "cancelled" } })
  })
  await page.route("**/memory/*/confirm", (route) =>
    route.fulfill({ json: { ...pendingMemory, status: "confirmed" } }),
  )
  await page.route("**/memory/*/reject", (route) =>
    route.fulfill({ json: { ...pendingMemory, status: "rejected" } }),
  )
  await page.route("**/delivery/*/read", (route) => route.fulfill({ json: {} }))
  void state
}

async function configurePage(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 })
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "assistant-dashboard-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "assistant-dashboard-regression",
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
    default: { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" },
  }
}
