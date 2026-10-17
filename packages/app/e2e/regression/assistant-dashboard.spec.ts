import { expect, test, type Page } from "@playwright/test"
import type {
  BadRequestError,
  InvalidRequestError,
  KbNoteNote,
  PersonalMemoryInfo,
  ProviderListResponse,
} from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { AssistantMutationProbe } from "./assistant-mutation-probe"

// English-label spec — pin the UI language so the zh projects stay green (see utils/locale.ts).
// Tagged presentation cases must observe the project's real theme/locale/viewport instead.
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.tags.includes("@presentation")) await pinEnglishUI(page)
})

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
} satisfies KbNoteNote

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

  test("AI-TDD-S08-R02: a failed memory read is retryable, not an empty dashboard", async ({ page }) => {
    await mockServer(page, { state: {} })
    let fail = true
    await page.route("**/memory", (route) => {
      if (!fail) {
        return route.fulfill({
          json: [pendingMemory],
          headers: { "access-control-allow-origin": "*" },
        })
      }
      return route.fulfill({
        status: 400,
        json: { message: "memory read failed" },
        headers: { "access-control-allow-origin": "*" },
      })
    })
    await configurePage(page)

    await page.goto("/mode/assistant")
    await expect(page.getByRole("heading", { name: "Assistant Dashboard" })).toBeVisible({ timeout: 15_000 })
    const alert = page.getByRole("alert").filter({ hasText: "Couldn't load. Try again." })
    await expect(alert).toBeVisible({ timeout: 20_000 })

    fail = false
    await alert.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(page.getByText("User prefers concise answers", { exact: true })).toBeVisible()
    await expect(alert).toHaveCount(0)
  })

  test("AI-TDD-S08-R02: a failed reminder read is retryable, not an empty dashboard", async ({ page }) => {
    await mockServer(page, { state: {} })
    let fail = true
    await page.route("**/schedule/pending", (route) => {
      if (!fail) {
        return route.fulfill({ json: [pendingReminder], headers: { "access-control-allow-origin": "*" } })
      }
      return route.fulfill({
        status: 400,
        json: { message: "reminder read failed" },
        headers: { "access-control-allow-origin": "*" },
      })
    })
    await configurePage(page)

    await page.goto("/mode/assistant")
    await expect(page.getByRole("heading", { name: "Assistant Dashboard" })).toBeVisible({ timeout: 15_000 })
    const alert = page.getByRole("alert").filter({ hasText: "Couldn't load. Try again." })
    await expect(alert).toBeVisible({ timeout: 20_000 })

    fail = false
    await alert.getByRole("button", { name: "Retry", exact: true }).click()
    await expect(page.getByText("Follow up with customer", { exact: true })).toBeVisible()
    await expect(alert).toHaveCount(0)
  })

  test(
    "AI-TDD-S08-R02: reminder error is visible and retryable in dark, Chinese and 390px",
    { tag: "@presentation" },
    async ({ page }, testInfo) => {
      const expected = {
        chromium: { scheme: "light", lang: "en" },
        "chromium-dark": { scheme: "dark", lang: "en" },
        "chromium-zh": { scheme: "light", lang: "zh" },
        "chromium-narrow": { scheme: "light", lang: "en" },
      }[testInfo.project.name]
      if (!expected) throw new Error(`unexpected project ${testInfo.project.name}`)
      const narrow = testInfo.project.name === "chromium-narrow"
      await mockServer(page, { state: {} })
      let fail = true
      await page.route("**/schedule/pending", (route) => {
        if (!fail) return route.fulfill({ json: [pendingReminder] })
        return route.fulfill({ status: 400, json: { message: "reminder read failed" } })
      })
      if (narrow) await page.setViewportSize({ width: 390, height: 844 })

      await page.goto("/mode/assistant")
      await expect(
        page.getByRole("heading", { name: expected.lang === "zh" ? "助手仪表盘" : "Assistant Dashboard" }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", expected.scheme)
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(expected.lang)
      if (narrow) expect(page.viewportSize()).toEqual({ width: 390, height: 844 })

      const alert = page.getByRole("alert")
      const label = expected.lang === "zh" ? "加载失败，请重试" : "Couldn't load. Try again."
      await expect(alert).toContainText(label, { timeout: 20_000 })
      const retry = alert.getByRole("button", { name: expected.lang === "zh" ? "重试" : "Retry", exact: true })
      await expect(retry).toBeVisible()
      const box = await alert.boundingBox()
      if (!box) throw new Error("the reminder error must have a box")
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)

      let focused = false
      for (let index = 0; index < 80 && !focused; index += 1) {
        await page.keyboard.press("Tab")
        focused = await retry.evaluate((node) => node === document.activeElement)
      }
      expect(focused, "the retry must be keyboard reachable").toBe(true)
      await expect(retry).toBeFocused()
      const outline = await retry.evaluate((node) => {
        const style = getComputedStyle(node)
        return { style: style.outlineStyle, width: style.outlineWidth }
      })
      expect(outline.style).not.toBe("none")
      expect(Number.parseFloat(outline.width)).toBeGreaterThan(0)

      fail = false
      await page.keyboard.press("Enter")
      await expect(page.getByText("Follow up with customer", { exact: true })).toBeVisible()
      await expect(alert).toHaveCount(0)
    },
  )

  test(
    "AI-TDD-S08-R02: memory error is visible and retryable in dark, Chinese and 390px",
    { tag: "@presentation" },
    async ({ page }, testInfo) => {
      const expected = {
        chromium: { scheme: "light", lang: "en" },
        "chromium-dark": { scheme: "dark", lang: "en" },
        "chromium-zh": { scheme: "light", lang: "zh" },
        "chromium-narrow": { scheme: "light", lang: "en" },
      }[testInfo.project.name]
      if (!expected) throw new Error(`unexpected project ${testInfo.project.name}`)
      const narrow = testInfo.project.name === "chromium-narrow"
      await mockServer(page, { state: {} })
      let fail = true
      await page.route("**/memory", (route) => {
        if (!fail) return route.fulfill({ json: [pendingMemory] })
        return route.fulfill({ status: 400, json: { message: "memory read failed" } })
      })
      if (narrow) await page.setViewportSize({ width: 390, height: 844 })

      await page.goto("/mode/assistant")
      await expect(
        page.getByRole("heading", { name: expected.lang === "zh" ? "助手仪表盘" : "Assistant Dashboard" }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", expected.scheme)
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(expected.lang)
      if (narrow) expect(page.viewportSize()).toEqual({ width: 390, height: 844 })

      const alert = page.getByRole("alert")
      const label = expected.lang === "zh" ? "加载失败，请重试" : "Couldn't load. Try again."
      await expect(alert).toContainText(label, { timeout: 20_000 })
      const retry = alert.getByRole("button", { name: expected.lang === "zh" ? "重试" : "Retry", exact: true })
      await expect(retry).toBeVisible()
      const box = await alert.boundingBox()
      if (!box) throw new Error("the memory error must have a box")
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width)

      let focused = false
      for (let index = 0; index < 80 && !focused; index += 1) {
        await page.keyboard.press("Tab")
        focused = await retry.evaluate((node) => node === document.activeElement)
      }
      expect(focused, "the retry must be keyboard reachable").toBe(true)
      await expect(retry).toBeFocused()
      const outline = await retry.evaluate((node) => {
        const style = getComputedStyle(node)
        return { style: style.outlineStyle, width: style.outlineWidth }
      })
      expect(outline.style).not.toBe("none")
      expect(Number.parseFloat(outline.width)).toBeGreaterThan(0)

      fail = false
      await page.keyboard.press("Enter")
      await expect(page.getByText("User prefers concise answers", { exact: true })).toBeVisible()
      await expect(alert).toHaveCount(0)
    },
  )

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
  ;(["success", "failure"] as const).forEach((outcome) => {
    test(`AI-TDD-S08-R02: Dashboard Cancel then New isolates an old save ${outcome}`, async ({ page }, testInfo) => {
      const oldNote = {
        ...kbNote,
        id: `kb_cancelled_draft_${outcome}`,
        title: `Cancelled dashboard draft ${outcome}`,
        content: "The cancelled draft may finish, but does not own its replacement.",
        scope: "global",
        format: "note",
      } satisfies KbNoteNote
      const nextNote = {
        ...oldNote,
        id: `kb_recreated_draft_${outcome}`,
        title: `Replacement dashboard draft ${outcome}`,
        content: "The replacement draft has its own pending save.",
      } satisfies KbNoteNote
      const rejected = {
        _tag: "InvalidRequestError",
        message: "old cancelled save rejected",
      } satisfies InvalidRequestError
      const replies = new Map<string, unknown>([["/kb", [kbNote]]])
      await mockServer(page, {
        state: {},
        provider: { all: [], connected: [], default: {} } satisfies ProviderListResponse,
      })
      await configurePage(page)
      const probe = await AssistantMutationProbe.track(page, replies, ["/kb"])
      const dashboard = page.locator('[data-mode-main="assistant"]')
      const titleInput = dashboard.getByRole("textbox", { name: "Title", exact: true })
      const bodyInput = dashboard.getByRole("textbox", {
        name: "Markdown body, may contain [[wikilinks]]",
        exact: true,
      })
      const save = dashboard.getByRole("button", { name: "Save", exact: true })

      try {
        await page.goto("/mode/assistant")
        await dashboard.getByRole("button", { name: "New note", exact: true }).click()
        await titleInput.fill(oldNote.title)
        await bodyInput.fill(oldNote.content)
        await save.click()
        await expect.poll(() => probe.mutations.length).toBe(1)
        expect(probe.mutations[0].body).toEqual({ title: oldNote.title, content: oldNote.content, scope: "global" })
        await expect(save).toBeDisabled()

        await dashboard.getByRole("button", { name: "Cancel", exact: true }).click()
        await expect(titleInput).toHaveCount(0)
        await dashboard.getByRole("button", { name: "New note", exact: true }).click()
        await expect(titleInput).toHaveValue("")
        await expect(bodyInput).toHaveValue("")
        await titleInput.fill(nextNote.title)
        await bodyInput.fill(nextNote.content)
        const bodyOwner = await bodyInput.elementHandle()
        if (!bodyOwner) throw new Error("The recreated dashboard draft must have a DOM owner")
        await save.click()
        await expect.poll(() => probe.mutations.length).toBe(2)
        expect(probe.mutations[1].body).toEqual({ title: nextNote.title, content: nextNote.content, scope: "global" })
        await probe.settle("replacement-draft-save-held")

        if (outcome === "success") replies.set("/kb", [kbNote, oldNote])
        await probe.complete(
          0,
          outcome === "success" ? { status: 200, json: oldNote } : { status: 400, json: rejected },
        )
        await probe.settle("cancelled-save-completed-with-replacement-current")
        await expect(titleInput).toHaveValue(nextNote.title)
        await expect(bodyInput).toHaveValue(nextNote.content)
        await expect(titleInput).toBeDisabled()
        await expect(bodyInput).toBeDisabled()
        await expect(save).toBeDisabled()
        expect(await bodyInput.evaluate((element, previous) => element === previous, bodyOwner)).toBe(true)
        await bodyOwner.dispose()
        await expect(dashboard.locator('[data-component="assistant-mutation-error"]')).toHaveCount(0)
        expect(probe.mutations).toHaveLength(2)

        replies.set("/kb", outcome === "success" ? [kbNote, oldNote, nextNote] : [kbNote, nextNote])
        await probe.complete(1, { status: 200, json: nextNote })
        await probe.settle("replacement-draft-save-readback")
        await expect(titleInput).toHaveCount(0)
        await expect(bodyInput).toHaveCount(0)
        await expect(dashboard.getByText(nextNote.title, { exact: true })).toBeVisible()
        await expect(dashboard.getByText(oldNote.title, { exact: true })).toHaveCount(outcome === "success" ? 1 : 0)
        expect(probe.mutations).toHaveLength(2)
      } finally {
        await probe.close()
        await testInfo.attach(`s08-r02-dashboard-cancel-new-${outcome}`, {
          body: JSON.stringify(probe.receipt(), null, 2),
          contentType: "application/json",
        })
      }
    })
  })
})

for (const operation of ["create", "update", "remove"] as const) {
  test(`AI-TDD-S08-R02: Dashboard ${operation} refresh failure retries reads without repeating the write`, async ({
    page,
  }, testInfo) => {
    const note = {
      ...kbNote,
      id: operation === "create" ? "kb_readback_created" : kbNote.id,
      title: operation === "remove" ? kbNote.title : "Applied dashboard note",
      content: operation === "remove" ? kbNote.content : "Applied dashboard content",
    } satisfies KbNoteNote
    const replies = new Map<string, unknown>([["/kb", [kbNote]]])
    const readReplies = new Map<string, { status: number; json: unknown }>()
    await mockServer(page, {
      state: {},
      provider: { all: [], connected: [], default: {} } satisfies ProviderListResponse,
    })
    await configurePage(page)
    const path = operation === "create" ? "/kb" : `/kb/${note.id}${operation === "remove" ? "/remove" : ""}`
    const probe = await AssistantMutationProbe.track(page, replies, [path], { readReplies })
    const dashboard = page.locator('[data-mode-main="assistant"]')
    const titleInput = dashboard.getByRole("textbox", { name: "Title", exact: true })
    const bodyInput = dashboard.getByRole("textbox", { name: "Markdown body, may contain [[wikilinks]]", exact: true })
    const save = dashboard.getByRole("button", { name: "Save", exact: true })
    const remove = dashboard.getByRole("button", { name: "Delete", exact: true })
    try {
      await page.goto("/mode/assistant")
      if (operation === "create") await dashboard.getByRole("button", { name: "New note", exact: true }).click()
      if (operation !== "create") await dashboard.getByText(kbNote.title, { exact: true }).click()
      await titleInput.fill(note.title)
      await bodyInput.fill(note.content)
      await probe.settle("readback-draft-ready")
      await (operation === "remove" ? remove : save).click()
      await expect.poll(() => probe.mutations.length).toBe(1)
      readReplies.set("/kb", {
        status: 400,
        json: { _tag: "InvalidRequestError", message: "Synthetic post-write read failure" },
      })
      replies.set("/kb", operation === "remove" ? [] : [note])
      await probe.complete(0, { status: 200, json: operation === "remove" ? true : note })

      const error = dashboard.getByRole("alert")
      await expect(error).toContainText("Changes applied. Could not refresh the notes.")
      await expect(titleInput).toHaveValue(note.title)
      await expect(bodyInput).toHaveValue(note.content)
      await expect(titleInput).toBeDisabled()
      await expect(bodyInput).toBeDisabled()
      await expect(save).toBeDisabled()
      if (operation !== "create") await expect(remove).toBeDisabled()
      expect(probe.mutations).toHaveLength(1)
      const failedReads = probe.count("/kb")
      expect(failedReads).toBeGreaterThan(1)
      readReplies.delete("/kb")
      await error.getByRole("button", { name: "Refresh", exact: true }).click()
      await expect(titleInput).toHaveCount(0)
      await expect(bodyInput).toHaveCount(0)
      await expect(error).toHaveCount(0)
      await expect.poll(() => probe.count("/kb")).toBe(failedReads + 1)
      await expect(dashboard.getByText(note.title, { exact: true })).toHaveCount(operation === "remove" ? 0 : 1)
      expect(probe.mutations).toHaveLength(1)
    } finally {
      await probe.close()
      await testInfo.attach(`dashboard-${operation}-readback`, {
        body: JSON.stringify(probe.receipt()),
        contentType: "application/json",
      })
    }
  })
}

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
  await page.route("**/kb/dangling", (route) => route.fulfill({ json: [] }))
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
