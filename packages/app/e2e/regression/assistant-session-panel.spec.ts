import { expect, test, type Request, type Page } from "@playwright/test"
import type {
  CompositionSnapshotV1,
  FileNode,
  KbNoteNote,
  ProviderListResponse,
  ScheduleInfo,
  Session,
  SessionMessagesResponse,
} from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { AssistantMutationProbe } from "./assistant-mutation-probe"

// English-label spec — pin the UI language so the zh projects stay green (see utils/locale.ts).
test.beforeEach(({ page }) => pinEnglishUI(page))

const directory = "C:/Aigcfroge/AssistantPanelRegression"
const projectID = "proj_assistant_panel_regression"
const sessionID = "ses_assistant_panel_regression"
const title = "Assistant panel regression"

test("assistant session renders the unified review-panel shell", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [] }),
  })

  await mockPanelHistory(page)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: title })).toBeVisible()

  // The unified shell owns the review-panel id; assistant no longer renders a
  // self-contained aside. The review-panel is open by default.
  const assistantPanel = page.locator('#review-panel[aria-label="Assistant panel"]')
  await expect(assistantPanel).toBeVisible()
  await expect(assistantPanel.locator("[data-slot='tabs-v2-list']")).toBeVisible()
  // v2 radius xl is 0.625rem = 10px. Assert the computed value, not the utility
  // class name, so a token rename (`rounded-[10px]` -> `rounded-xl`) cannot fail
  // this for the wrong reason.
  await expect(assistantPanel).toHaveCSS("border-radius", "10px")
})

/**
 * The divider that owns the panel width used to be a bare `<div onMouseDown>`: no role, no
 * name, no keyboard path, and the drag died the moment the pointer left the handle. It is the
 * only separator in the session shell, so this is its real host (1400x900 + assistant mode
 * opens the review panel by default). `End`/`Home` are exact and cannot pass by accident: a
 * separator whose arrow/End handling was never wired reports the same `aria-valuenow` before
 * and after the keypress.
 */
test("the review divider is a named, keyboard-operable separator", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [] }),
  })

  await mockPanelHistory(page)
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.getByRole("heading", { name: title })).toBeVisible()

  const handle = page.getByRole("separator", { name: "Resize session changes panel" })
  await expect(handle).toBeVisible()
  // A left/right drag is a VERTICAL divider; the axis names the divider, not the gesture.
  await expect(handle).toHaveAttribute("aria-orientation", "vertical")

  const min = Number(await handle.getAttribute("aria-valuemin"))
  const max = Number(await handle.getAttribute("aria-valuemax"))
  const value = async () => Number(await handle.getAttribute("aria-valuenow"))

  await handle.focus()
  await expect(handle).toBeFocused()

  await page.keyboard.press("End")
  await expect.poll(value).toBe(max)
  await page.keyboard.press("Home")
  await expect.poll(value).toBe(min)
  // One step key proves the axis mapping, not just the jump keys.
  await page.keyboard.press("ArrowRight")
  await expect.poll(value).toBe(min + 16)
  // The perpendicular axis must be inert: a horizontal separator ignores Up/Down.
  await page.keyboard.press("ArrowDown")
  await expect.poll(value).toBe(min + 16)
})

test("AI-TDD-S08-R02: hidden session panels skip reads and preserve the visible editor across resizing", async ({
  page,
}, testInfo) => {
  const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  const appPort = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
  ).port
  const server = `http://127.0.0.1:${apiPort}`
  const coding = {
    ...session(),
    id: "ses_panel_activity_coding",
    title: "Panel activity Coding",
    mode: "coding",
    agent: "build",
  } satisfies Session
  const assistant = { ...session(), mode: "assistant", agent: "assistant-orchestrator" } satisfies Session
  const custom = {
    ...session(),
    id: "ses_panel_activity_custom",
    title: "Panel activity Custom",
    mode: "custom",
    agent: "meta",
  } satisfies Session
  const chat = {
    ...session(),
    id: "ses_panel_activity_chat",
    title: "Panel activity Chat",
    mode: "chat",
    agent: "meta",
  } satisfies Session
  const sessions = [coding, assistant, custom, chat]
  const note = {
    id: "note_panel_activity",
    title: "Panel activity note",
    content: "Saved note body",
    scope: "global",
    tags: ["regression"],
    format: "note",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  } satisfies KbNoteNote
  const snapshot = {
    version: 1,
    digest: "d".repeat(64),
    sessionID: custom.id,
    createdAt: 1700000000000,
    data: {
      agentID: "meta",
      instructions: [],
      prompts: [],
      skills: [],
      tools: { fingerprints: [], catalogDigest: "e".repeat(64), catalog: [] },
    },
  } satisfies CompositionSnapshotV1
  // Exact SDK paths, including the global badge owner. Every watched GET gets JSON,
  // so a missing mock cannot become an HTML response followed by query retries.
  const replies = new Map<string, unknown>([
    ["/prompt-asset", []],
    [
      "/file?path=.aigcfroge",
      [
        {
          name: "prompts",
          path: ".aigcfroge/prompts",
          absolute: directory + "/.aigcfroge/prompts",
          type: "directory",
          ignored: false,
        } satisfies FileNode,
      ],
    ],
    ["/file?path=.aigcfroge/prompts", []],
    ["/schedule/pending", []],
    ["/delivery/recent", []],
    ["/memory", []],
    ["/kb", [note]],
    ["/kb/dangling", []],
    [`/kb/${note.id}`, note],
    [`/kb/${note.id}/backlinks`, []],
    ...sessions.flatMap(
      (item): Array<[string, unknown]> => [
        [`/schedule/${item.id}`, []],
        [`/delivery/${item.id}`, []],
        [`/session/${item.id}/composition`, { ...snapshot, sessionID: item.id }],
      ],
    ),
  ])
  const reads = new Map<Request, { path: string; status?: number; finished?: boolean; failure?: string }>()
  const observations: Array<{
    phase: string
    counts: Record<string, number>
    pendingBadge: number
    compositions: Record<string, number>
  }> = []
  const readKey = (url: URL) => (url.pathname === "/file" ? "/file?path=" + url.searchParams.get("path") : url.pathname)
  const matches = (url: URL) => (url.port === apiPort || url.port === appPort) && replies.has(readKey(url))
  const count = (path: string) => [...reads.values()].filter((read) => read.path === path).length
  const ownedCounts = () =>
    Object.fromEntries(
      [...replies.keys()]
        .filter((path) => path !== "/schedule/pending" && !path.endsWith("/composition"))
        .map((path) => [path, count(path)]),
    )
  const panel = (id: string) => page.locator(`[data-component="session-mode-panel"][data-mode="${id}"]`)
  const visit = async (item: Session) => {
    await page.locator(`[data-slot="titlebar-tabs"] a[href$="/session/${item.id}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/session/${item.id}$`))
    await expect(page.getByRole("heading", { name: item.title, exact: true })).toBeVisible()
  }
  const settle = async (phase: string) => {
    // Observe real rendering and completed response bodies. No sleep or networkidle:
    // the application's SSE connection deliberately remains outside this barrier.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    )
    await expect.poll(() => [...reads.values()].every((read) => read.finished)).toBe(true)
    for (const read of reads.values()) {
      expect(read.status, `${phase}: ${read.path}`).toBe(200)
      expect(read.failure, `${phase}: ${read.path}`).toBeUndefined()
    }
    observations.push({
      phase,
      counts: ownedCounts(),
      pendingBadge: count("/schedule/pending"),
      compositions: Object.fromEntries(sessions.map((item) => [item.id, count(`/session/${item.id}/composition`)])),
    })
  }

  await page.setViewportSize({ width: 1400, height: 900 })
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions,
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript(
    (input) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true, showFileTree: true } }))
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [{ type: "http", http: { url: input.server } }], projects: {}, lastProject: {} }),
      )
      localStorage.setItem("aigcfroge.global.dat:tabs", JSON.stringify(input.tabs))
    },
    {
      server,
      tabs: sessions.map((item) => ({
        type: "session",
        server,
        dirBase64: base64Encode(directory),
        sessionId: item.id,
      })),
    },
  )
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() === "GET" && matches(url)) reads.set(request, { path: readKey(url) })
  })
  page.on("response", (response) => {
    const read = reads.get(response.request())
    if (!read) return
    read.status = response.status()
    void response.finished().then(
      (failure) => {
        read.finished = true
        if (failure) read.failure = failure.message
      },
      (failure: unknown) => {
        read.finished = true
        read.failure = String(failure)
      },
    )
  })
  page.on("requestfailed", (request) => {
    const read = reads.get(request)
    if (!read) return
    read.finished = true
    read.failure = request.failure()?.errorText ?? "request failed"
  })
  await page.route(matches, (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(replies.get(readKey(new URL(route.request().url())))),
    })
  })

  await mockPanelHistory(page)
  try {
    await page.goto(`/server/${base64Encode(server)}/session/${coding.id}`)
    await expect(page.getByRole("heading", { name: coding.title, exact: true })).toBeVisible()
    for (const id of ["assistant", "custom", "chat"]) {
      await expect(panel(id)).toHaveCount(1)
      await expect(panel(id)).toBeHidden()
    }
    await expect.poll(() => count("/schedule/pending")).toBeGreaterThan(0)
    await settle("cold-coding-hidden-panels")
    expect(Object.values(ownedCounts()).every((value) => value === 0)).toBe(true)
    // The visible Session page and composer each own useSessionSnapshotCommands.
    // Only the third, hidden CustomSessionPanel request must disappear.
    expect(count(`/session/${coding.id}/composition`)).toBe(2)

    await visit(assistant)
    await expect(panel("assistant")).toBeVisible()
    for (const path of [`/schedule/${assistant.id}`, `/delivery/${assistant.id}`, "/memory"]) {
      await expect.poll(() => count(path), { message: `${path} must load for the active Assistant` }).toBeGreaterThan(0)
    }
    await settle("assistant-active")

    await page.locator("#secondary-sidebar-toggle").click()
    const sidebar = page.locator('[data-component="assistant-session-sidebar"]')
    await expect(sidebar).toBeVisible()
    await sidebar.locator('[data-nav-section="kb"] > button').click()
    await sidebar.getByRole("button", { name: note.title, exact: true }).click()
    const editNote = panel("assistant").getByRole("button", { name: "Edit note", exact: true })
    await expect(editNote).toBeVisible()
    await editNote.click()
    const editor = panel("assistant").locator('[data-component="assistant-note-editor"] textarea')
    await expect(editor).toHaveValue(note.content)
    const draft = "Unsaved S08-R02 note draft survives presentation changes."
    await editor.fill(draft)
    const original = await editor.elementHandle()
    if (!original) throw new Error("The active note editor must have a DOM owner")
    // Close the left navigation before shrinking so only the content panel owns Escape.
    await page.locator("#secondary-sidebar-toggle").click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel("assistant")).toBeHidden()
    await page.locator("#session-mode-panel-toggle").click()
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(draft)
    expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(true)
    await page.keyboard.press("Escape")
    await expect(panel("assistant")).toBeHidden()
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(draft)
    expect(await editor.evaluate((element, previous) => element === previous, original)).toBe(true)
    await original.dispose()
    await settle("same-session-editor-preserved")
    await testInfo.attach("s08-r02-editor-preserved", { body: await page.screenshot(), contentType: "image/png" })

    const beforeCoding = ownedCounts()
    await visit(coding)
    await expect(panel("assistant")).toBeHidden()
    await settle("coding-after-assistant")
    expect(ownedCounts()).toEqual(beforeCoding)

    // Canonical Session navigation remounts the page. Only its persisted tab selection
    // is expected here; the unsaved editor's identity/value claim ends before navigation.
    await visit(assistant)
    await expect(panel("assistant").locator('[data-slot="tabs-v2-trigger"][data-value="editor"]')).toHaveAttribute(
      "data-selected",
      "",
    )
    await expect(editor).toBeVisible()
    await settle("assistant-editor-tab-restored")

    await visit(custom)
    await expect(panel("custom")).toBeVisible()
    await expect.poll(() => count(`/session/${custom.id}/composition`)).toBeGreaterThan(2)
    await expect(panel("custom").getByText(snapshot.digest, { exact: true })).toBeVisible()
    await settle("custom-composition-active")
    const beforeFinalCoding = ownedCounts()
    await visit(coding)
    await expect(panel("custom")).toBeHidden()
    await settle("coding-after-custom")
    expect(ownedCounts()).toEqual(beforeFinalCoding)

    await visit(chat)
    await expect(panel("chat")).toBeVisible()
    await page.keyboard.press("Control+Backslash")
    await expect(panel("chat").locator("#file-tree-panel")).toHaveAttribute("aria-hidden", "false")
    for (const path of ["/prompt-asset", "/file?path=.aigcfroge"]) {
      await expect.poll(() => count(path), { message: `${path} must load for active Chat` }).toBeGreaterThan(0)
    }
    await settle("chat-assets-active")
    const beforeChatHidden = ownedCounts()
    await visit(coding)
    await settle("coding-after-chat")
    expect(ownedCounts()).toEqual(beforeChatHidden)

    await visit(assistant)
    await page.getByRole("button", { name: "Open context tab", exact: true }).click()
    const contextTab = panel("assistant").getByRole("tab", { name: "Context Close tab", exact: true })
    await expect(contextTab).toHaveAttribute("aria-selected", "true")
    await contextTab.getByRole("button", { name: "Close tab", exact: true }).click()
    await expect(contextTab).toBeHidden()
    // Context is prepended by nextSessionTabsForOpen; close selects its next neighbour.
    await expect(panel("assistant").getByRole("tab", { name: "Reminders Close tab", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await settle("assistant-context-open-close")
  } finally {
    await testInfo.attach("s08-r02-panel-requests", {
      body: JSON.stringify(
        {
          observations,
          finalCounts: ownedCounts(),
          pendingBadge: count("/schedule/pending"),
          reads: [...reads.values()],
        },
        null,
        2,
      ),
      contentType: "application/json",
    })
  }
})

test("AI-TDD-S08-R02: an old note save does not close the current note draft", async ({ page }, testInfo) => {
  const assistant = { ...session(), mode: "assistant", agent: "assistant-orchestrator" } satisfies Session
  const noteA = {
    id: "kb_mutation_owner_a",
    title: "Mutation owner note A",
    content: "Saved body A",
    scope: "global",
    tags: ["regression"],
    format: "note",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  } satisfies KbNoteNote
  const noteB = { ...noteA, id: "kb_mutation_owner_b", title: "Mutation owner note B", content: "Saved body B" }
  const savedA = { ...noteA, content: "Completed body A", updatedAt: 1700000000001 } satisfies KbNoteNote
  const savedB = {
    ...noteB,
    content: "Unsaved body B must survive A completing",
    updatedAt: 1700000000002,
  } satisfies KbNoteNote
  const fixture = await mockAssistantMutationPanel(page, [assistant])
  fixture.replies.set("/kb", [noteA, noteB])
  for (const note of [noteA, noteB]) {
    fixture.replies.set(`/kb/${note.id}`, note)
    fixture.replies.set(`/kb/${note.id}/backlinks`, [])
  }
  const probe = await AssistantMutationProbe.track(page, fixture.replies, [`/kb/${noteA.id}`, `/kb/${noteB.id}`])
  const panel = page.locator('[data-component="session-mode-panel"][data-mode="assistant"]')
  const sidebar = page.locator('[data-component="assistant-session-sidebar"]')
  const editor = panel.locator('[data-component="assistant-note-editor"]')
  const bodyInput = editor.getByRole("textbox", { name: "Markdown body, may contain [[wikilinks]]", exact: true })

  try {
    await page.goto(fixture.url)
    await expect(page.getByRole("heading", { name: assistant.title, exact: true })).toBeVisible()
    await expect(panel).toBeVisible()
    await page.locator("#secondary-sidebar-toggle").click()
    await expect(sidebar).toBeVisible()
    await sidebar.locator('[data-nav-section="kb"] > button').click()
    await sidebar.getByRole("button", { name: noteA.title, exact: true }).click()
    await panel.getByRole("button", { name: "Edit note", exact: true }).click()
    await expect(bodyInput).toHaveValue(noteA.content)
    await bodyInput.fill(savedA.content)
    await editor.getByRole("button", { name: "Save", exact: true }).click()
    await expect.poll(() => probe.mutations.length).toBe(1)
    expect(probe.mutations[0].path).toBe(`/kb/${noteA.id}`)
    expect(probe.mutations[0].body).toEqual({ title: noteA.title, content: savedA.content, tags: noteA.tags })

    // Real sidebar navigation replaces A's editor while its POST remains in flight.
    await sidebar.getByRole("button", { name: noteB.title, exact: true }).click()
    await panel.getByRole("button", { name: "Edit note", exact: true }).click()
    await expect(editor.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(noteB.title)
    await expect(bodyInput).toHaveValue(noteB.content)
    await bodyInput.fill(savedB.content)
    const bodyOwner = await bodyInput.elementHandle()
    if (!bodyOwner) throw new Error("The current note B editor must have a DOM owner")
    await probe.settle("note-b-draft-before-a-completes")

    fixture.replies.set(`/kb/${noteA.id}`, savedA)
    fixture.replies.set("/kb", [savedA, noteB])
    await probe.complete(0, { status: 200, json: savedA })
    await probe.settle("note-a-completed-with-b-current")
    await expect(editor).toBeVisible()
    await expect(editor.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(noteB.title)
    await expect(bodyInput).toHaveValue(savedB.content)
    expect(await bodyInput.evaluate((element, previous) => element === previous, bodyOwner)).toBe(true)
    await bodyOwner.dispose()
    await expect(panel.locator('[data-slot="tabs-v2-trigger"][data-value="editor"]')).toHaveAttribute(
      "data-selected",
      "",
    )
    expect(probe.mutations).toHaveLength(1)

    await editor.getByRole("button", { name: "Save", exact: true }).click()
    await expect.poll(() => probe.mutations.length).toBe(2)
    expect(probe.mutations[1].path).toBe(`/kb/${noteB.id}`)
    expect(probe.mutations[1].body).toEqual({ title: noteB.title, content: savedB.content, tags: noteB.tags })
    fixture.replies.set(`/kb/${noteB.id}`, savedB)
    fixture.replies.set("/kb", [savedA, savedB])
    await probe.complete(1, { status: 200, json: savedB })
    await probe.settle("current-note-b-save-readback")
    await expect(editor).toHaveCount(0)
    const kb = panel.locator('[data-component="assistant-kb-tab"]')
    await expect(kb).toBeVisible()
    await sidebar.getByRole("button", { name: noteB.title, exact: true }).click()
    await expect(kb.getByRole("heading", { name: noteB.title, exact: true })).toBeVisible()
    await expect(kb.getByText(savedB.content, { exact: true })).toBeVisible()
    expect(probe.mutations).toHaveLength(2)
  } finally {
    await probe.close()
    await testInfo.attach("s08-r02-note-editor-mutation-owner", {
      body: JSON.stringify(probe.receipt(), null, 2),
      contentType: "application/json",
    })
  }
})

test("AI-TDD-S08-R02: a completed reminder mutation stays with its original Session", async ({ page }, testInfo) => {
  const sessionA = {
    ...session(),
    id: "ses_reminder_mutation_a",
    title: "Reminder mutation Session A",
    mode: "assistant",
    agent: "assistant-orchestrator",
  } satisfies Session
  const sessionB = {
    ...sessionA,
    id: "ses_reminder_mutation_b",
    title: "Reminder mutation Session B",
  } satisfies Session
  const reminderA = {
    id: "sch_mutation_owner_a",
    sessionID: sessionA.id,
    kind: "reminder",
    content: "Cancel only Session A reminder",
    dueAt: Date.now() + 3600_000,
    timezone: "Asia/Shanghai",
    status: "pending",
    attempts: 0,
    deliveryKey: "reminder:mutation-owner:a",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  } satisfies ScheduleInfo
  const reminderB = {
    ...reminderA,
    id: "sch_mutation_owner_b",
    sessionID: sessionB.id,
    content: "Session B reminder stays pending",
    deliveryKey: "reminder:mutation-owner:b",
  } satisfies ScheduleInfo
  const cancelled = { ...reminderA, status: "cancelled", updatedAt: 1700000000001 } satisfies ScheduleInfo
  const fixture = await mockAssistantMutationPanel(page, [sessionA, sessionB])
  fixture.replies.set(`/schedule/${sessionA.id}`, [reminderA])
  fixture.replies.set(`/schedule/${sessionB.id}`, [reminderB])
  const probe = await AssistantMutationProbe.track(page, fixture.replies, [`/schedule/${reminderA.id}/cancel`])
  const panel = page.locator('[data-component="session-mode-panel"][data-mode="assistant"]')
  const visit = async (item: Session) => {
    await page.locator(`[data-slot="titlebar-tabs"] a[href$="/session/${item.id}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`/session/${item.id}$`))
    await expect(page.getByRole("heading", { name: item.title, exact: true })).toBeVisible()
    await expect(panel).toBeVisible()
  }

  try {
    await page.goto(fixture.url)
    await expect(page.getByRole("heading", { name: sessionA.title, exact: true })).toBeVisible()
    await expect(panel.getByText(reminderA.content, { exact: true })).toBeVisible()
    await probe.settle("session-a-before-cancel")
    expect(probe.count(`/schedule/${sessionA.id}`)).toBeGreaterThan(0)
    await panel.getByRole("button", { name: "Cancel reminder", exact: true }).click()
    await expect.poll(() => probe.mutations.length).toBe(1)
    expect(probe.mutations[0].path).toBe(`/schedule/${reminderA.id}/cancel`)

    await visit(sessionB)
    await expect(panel.getByText(reminderB.content, { exact: true })).toBeVisible()
    await expect(panel.getByText(reminderA.content, { exact: true })).toHaveCount(0)
    await probe.settle("session-b-before-a-completes")
    const beforeA = probe.count(`/schedule/${sessionA.id}`)
    const beforeB = probe.count(`/schedule/${sessionB.id}`)

    fixture.replies.set(`/schedule/${sessionA.id}`, [cancelled])
    await probe.complete(0, { status: 200, json: cancelled })
    await probe.settle("session-b-after-a-completes")
    // Session navigation remounts the page. The old owner must not refresh either Session here.
    expect(probe.count(`/schedule/${sessionA.id}`)).toBe(beforeA)
    expect(probe.count(`/schedule/${sessionB.id}`)).toBe(beforeB)
    await expect(page.getByRole("heading", { name: sessionB.title, exact: true })).toBeVisible()
    await expect(panel.getByText(reminderB.content, { exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Cancel reminder", exact: true })).toHaveCount(1)

    await visit(sessionA)
    // A stale inactive cache must still get an authoritative read when its Session returns.
    await expect.poll(() => probe.count(`/schedule/${sessionA.id}`)).toBeGreaterThan(beforeA)
    await probe.settle("session-a-cancelled-readback")
    await expect(panel.getByText(reminderA.content, { exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Cancel reminder", exact: true })).toHaveCount(0)
    expect(probe.mutations).toHaveLength(1)
  } finally {
    await probe.close()
    await testInfo.attach("s08-r02-session-reminder-mutation-owner", {
      body: JSON.stringify(probe.receipt(), null, 2),
      contentType: "application/json",
    })
  }
})

async function mockAssistantMutationPanel(page: Page, sessions: Session[]) {
  const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const snapshot = {
    version: 1,
    digest: "a".repeat(64),
    sessionID: sessions[0].id,
    createdAt: 1700000000000,
    data: {
      agentID: "assistant-orchestrator",
      instructions: [],
      prompts: [],
      skills: [],
      tools: { fingerprints: [], catalogDigest: "b".repeat(64), catalog: [] },
    },
  } satisfies CompositionSnapshotV1
  const replies = new Map<string, unknown>([
    ["/schedule/pending", []],
    ["/delivery/recent", []],
    ["/memory", []],
    ["/kb", []],
    ["/kb/dangling", []],
    ...sessions.flatMap(
      (item): Array<[string, unknown]> => [
        [`/schedule/${item.id}`, []],
        [`/delivery/${item.id}`, []],
        [`/session/${item.id}/composition`, { ...snapshot, sessionID: item.id }],
      ],
    ),
  ])
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: { all: [], connected: [], default: {} } satisfies ProviderListResponse,
    sessions,
    pageMessages: () => ({ items: [] }),
    canonicalMessages: () => ({ data: [], cursor: {} }) satisfies SessionMessagesResponse,
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript(
    (input) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { showFileTree: true } }))
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({ list: [{ type: "http", http: { url: input.server } }], projects: {}, lastProject: {} }),
      )
      localStorage.setItem("aigcfroge.global.dat:tabs", JSON.stringify(input.tabs))
    },
    {
      server,
      tabs: sessions.map((item) => ({
        type: "session",
        server,
        dirBase64: base64Encode(directory),
        sessionId: item.id,
      })),
    },
  )
  return { replies, url: `/server/${base64Encode(server)}/session/${sessions[0].id}` }
}

async function mockPanelHistory(page: Page) {
  await page.route(/\/api\/session\/[^/]+\/message(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ data: [], cursor: {} } satisfies SessionMessagesResponse),
    }),
  )
}

function session() {
  return {
    id: sessionID,
    slug: "assistant-panel-regression",
    projectID,
    directory,
    title,
    mode: "assistant",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "assistant-panel-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
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
