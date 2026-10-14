import { expect, test, type Page } from "@playwright/test"
import type { BadRequestError, KbNoteNote, PersonalMemoryInfo, ProviderListResponse } from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { AssistantMutationProbe } from "./assistant-mutation-probe"

// English-label spec — pin the UI language so the zh projects stay green (see utils/locale.ts).
test.beforeEach(({ page }) => pinEnglishUI(page))

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
  // The dev server cold-compiles the dashboard route on first navigation;
  // on slow/NTFS filesystems that exceeds the default 60s test timeout.
  test.describe.configure({ timeout: 180_000 })

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
    const cancel = page.getByLabel("Cancel reminder")
    await expect(cancel).toBeVisible({ timeout: 15_000 })
    await cancel.click()
    await expect.poll(() => cancelled, { timeout: 10_000 }).toBe(true)
  })

  test("confirms and rejects a pending memory proposal", async ({ page }) => {
    let confirmed = false
    let rejected = false
    await mockServer(page, {
      state: {},
      onMemoryConfirm: () => {
        confirmed = true
      },
      onMemoryReject: () => {
        rejected = true
      },
    })
    await configurePage(page)

    await page.goto("/mode/assistant")
    await expect(page.getByText("User prefers concise answers")).toBeVisible({ timeout: 15_000 })

    await page.getByLabel("Confirm").click()
    await expect.poll(() => confirmed, { timeout: 10_000 }).toBe(true)
    await page.getByLabel("Reject").click()
    await expect.poll(() => rejected, { timeout: 10_000 }).toBe(true)
  })
  test("AI-TDD-S08-R02: a hidden dashboard defers its completed memory refresh", async ({ page }, testInfo) => {
    const memory = {
      ...pendingMemory,
      source: "derived",
      trustLevel: "medium",
      sensitivityLevel: "low",
      status: "pending",
    } satisfies PersonalMemoryInfo
    const confirmed = { ...memory, status: "confirmed", confirmedAt: 1700000000001 } satisfies PersonalMemoryInfo
    const replies = new Map<string, unknown>([["/memory", [memory]]])
    await mockServer(page, {
      state: {},
      provider: { all: [], connected: [], default: {} } satisfies ProviderListResponse,
    })
    await configurePage(page)
    const probe = await AssistantMutationProbe.track(page, replies, [`/memory/${memory.id}/confirm`])
    const dashboard = page.locator('[data-mode-main="assistant"]')
    const rail = page.getByRole("navigation", { name: "Mode switcher", exact: true })

    try {
      await page.goto("/mode/assistant")
      await expect(dashboard.getByRole("button", { name: "Confirm", exact: true })).toBeVisible()
      await probe.settle("dashboard-visible")
      expect(probe.count("/memory")).toBeGreaterThan(0)
      await dashboard.evaluate((element) => element.setAttribute("data-node-probe", "memory-mutation-owner"))

      await dashboard.getByRole("button", { name: "Confirm", exact: true }).click()
      await expect.poll(() => probe.mutations.length).toBe(1)
      await rail.getByRole("button", { name: "Work", exact: true }).click()
      await expect(dashboard).toBeHidden()
      await expect(dashboard).toHaveAttribute("data-node-probe", "memory-mutation-owner")
      await probe.settle("dashboard-hidden-before-completion")
      const hiddenReads = probe.count("/memory")

      replies.set("/memory", [confirmed])
      await probe.complete(0, { status: 200, json: confirmed })
      await probe.settle("dashboard-hidden-after-completion")
      expect(probe.count("/memory")).toBe(hiddenReads)

      await rail.getByRole("button", { name: "Assistant", exact: true }).click()
      await expect(dashboard).toBeVisible()
      await expect(dashboard).toHaveAttribute("data-node-probe", "memory-mutation-owner")
      await expect.poll(() => probe.count("/memory")).toBeGreaterThan(hiddenReads)
      await probe.settle("dashboard-restored-readback")
      await expect(dashboard.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0)
      await expect(dashboard.getByText("Confirmed", { exact: true })).toBeVisible()
      await expect(dashboard.getByRole("button", { name: "Forget", exact: true })).toBeVisible()
      expect(probe.mutations).toHaveLength(1)
    } finally {
      await probe.close()
      await testInfo.attach("s08-r02-dashboard-hidden-mutation", {
        body: JSON.stringify(probe.receipt(), null, 2),
        contentType: "application/json",
      })
    }
  })

  test("AI-TDD-S08-R02: a pending note save survives a mode round trip without duplicate submission", async ({
    page,
  }, testInfo) => {
    const saved = {
      ...kbNote,
      id: "kb_dashboard_pending_save",
      title: "Pending dashboard draft",
      content: "A held save keeps this draft until its explicit retry succeeds.",
      scope: "global",
      format: "note",
      tags: [],
    } satisfies KbNoteNote
    const payload = { title: saved.title, content: saved.content, scope: "global" }
    const rejected = { name: "BadRequest", data: { message: "fixture save rejected" } } satisfies BadRequestError
    const replies = new Map<string, unknown>([["/kb", [kbNote]]])
    await mockServer(page, {
      state: {},
      provider: { all: [], connected: [], default: {} } satisfies ProviderListResponse,
    })
    await configurePage(page)
    const probe = await AssistantMutationProbe.track(page, replies, ["/kb"])
    const dashboard = page.locator('[data-mode-main="assistant"]')
    const rail = page.getByRole("navigation", { name: "Mode switcher", exact: true })
    const titleInput = dashboard.getByRole("textbox", { name: "Title", exact: true })
    const bodyInput = dashboard.getByRole("textbox", { name: "Markdown body, may contain [[wikilinks]]", exact: true })
    const save = dashboard.getByRole("button", { name: "Save", exact: true })

    try {
      await page.goto("/mode/assistant")
      await dashboard.getByRole("button", { name: "New note", exact: true }).click()
      await titleInput.fill(saved.title)
      await bodyInput.fill(saved.content)
      await titleInput.evaluate((element) => element.setAttribute("data-node-probe", "pending-title-owner"))
      await bodyInput.evaluate((element) => element.setAttribute("data-node-probe", "pending-body-owner"))
      await probe.settle("draft-ready")

      // Both clicks use the real control while every received POST has its own held response.
      await save.dblclick()
      await expect.poll(() => probe.mutations.length).toBeGreaterThan(0)
      await probe.settle("double-click-held")
      expect(probe.mutations).toHaveLength(1)
      expect(probe.mutations[0].body).toEqual(payload)
      await expect(save).toBeDisabled()
      await expect(titleInput).toBeDisabled()
      await expect(bodyInput).toBeDisabled()

      await rail.getByRole("button", { name: "Work", exact: true }).click()
      await expect(dashboard).toBeHidden()
      await rail.getByRole("button", { name: "Assistant", exact: true }).click()
      await expect(titleInput).toHaveValue(saved.title)
      await expect(bodyInput).toHaveValue(saved.content)
      await expect(titleInput).toHaveAttribute("data-node-probe", "pending-title-owner")
      await expect(bodyInput).toHaveAttribute("data-node-probe", "pending-body-owner")
      await expect(save).toBeDisabled()
      await expect(titleInput).toBeDisabled()
      await expect(bodyInput).toBeDisabled()
      await probe.settle("pending-save-restored")
      expect(probe.mutations).toHaveLength(1)

      await probe.complete(0, { status: 400, json: rejected })
      await expect(dashboard.locator('[data-component="assistant-mutation-error"]')).toContainText(
        rejected.data.message,
      )
      await expect(titleInput).toHaveValue(saved.title)
      await expect(bodyInput).toHaveValue(saved.content)
      await expect(save).toBeEnabled()
      await expect(titleInput).toBeEnabled()
      await expect(bodyInput).toBeEnabled()
      await probe.settle("failed-save-keeps-draft")
      expect(probe.mutations).toHaveLength(1)

      await save.click()
      await expect.poll(() => probe.mutations.length).toBe(2)
      expect(probe.mutations[1].body).toEqual(payload)
      replies.set("/kb", [kbNote, saved])
      await probe.complete(1, { status: 200, json: saved })
      await probe.settle("explicit-retry-readback")
      await expect(titleInput).toHaveCount(0)
      await expect(bodyInput).toHaveCount(0)
      await expect(dashboard.getByText(saved.title, { exact: true })).toHaveCount(1)
      await expect(dashboard.getByText(saved.title, { exact: true })).toBeVisible()
      expect(probe.mutations).toHaveLength(2)
    } finally {
      await probe.close()
      await testInfo.attach("s08-r02-dashboard-pending-save", {
        body: JSON.stringify(probe.receipt(), null, 2),
        contentType: "application/json",
      })
    }
  })
})

// Hooks consumed by this spec's own page.route handlers below; the shared
// mock server (utils/mock-server.ts) does not implement them.
type DashboardHooks = {
  onScheduleCancel?: () => void
  onMemoryConfirm?: () => void
  onMemoryReject?: () => void
}

async function mockServer(page: Page, extra: { state: object } & Partial<MockServerConfig> & DashboardHooks) {
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
  await page.route("**/memory/*/confirm", (route) => {
    if (extra.onMemoryConfirm) extra.onMemoryConfirm()
    return route.fulfill({ json: { ...pendingMemory, status: "confirmed" } })
  })
  await page.route("**/memory/*/reject", (route) => {
    if (extra.onMemoryReject) extra.onMemoryReject()
    return route.fulfill({ json: { ...pendingMemory, status: "rejected" } })
  })
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
