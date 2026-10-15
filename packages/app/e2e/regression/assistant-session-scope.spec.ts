import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import type {
  InvalidRequestError,
  KbNoteNote,
  PermissionRequest,
  ProviderListResponse,
  Session,
  SessionMessagesResponse,
} from "@aigcfroge/sdk/v2/client"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { pinDesktopViewport } from "../utils/viewport"
import { expectAppVisible } from "../utils/waits"
import { AssistantMutationProbe } from "./assistant-mutation-probe"

const urlA = "http://127.0.0.1:4097"
const urlB = "http://127.0.0.1:4098"
const dirA = "C:/Aigcfroge/AssistantScopeA"
const dirB = "C:/Aigcfroge/AssistantScopeB"
const noteA = {
  id: "note_assistant_scope_shared",
  title: "Server A private note",
  content: "This note body belongs to server A.",
  scope: "global",
  tags: ["regression"],
  format: "note",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
} satisfies KbNoteNote
// The shared ID makes a wrong-server editor read return valid but incorrect content.
const noteB = {
  ...noteA,
  title: "Server B assistant note",
  content: "This note body belongs to the canonical Session on server B.",
} satisfies KbNoteNote
const sessionB = {
  id: "ses_assistant_scope_b",
  slug: "assistant-scope-b",
  projectID: "proj_assistant_scope_b",
  directory: dirB,
  mode: "assistant",
  agent: "assistant-orchestrator",
  title: "Assistant Session on server B",
  version: "dev",
  time: { created: 1700000000000, updated: 1700000000000 },
} satisfies Session

const statusSessions = ["a-error", "b-error", "b-unread", "b-permission"].map((kind) => ({
  ...sessionB,
  id: `ses_assistant_scope_${kind}`,
  slug: `assistant-scope-${kind}`,
  title: `Assistant status ${kind}`,
}))
const pendingPermission = {
  id: "per_assistant_scope_b",
  sessionID: "ses_assistant_scope_b-permission",
  permission: "edit",
  patterns: ["notes.md"],
  always: ["*.md"],
  metadata: {},
} satisfies PermissionRequest

test("Assistant sidebar opens notes and creates drafts on the canonical Session server", async ({ page }, testInfo) => {
  await pinEnglishUI(page)
  await pinDesktopViewport(page)
  const reads: Array<{ server: string; path: string }> = []
  const sessionPosts: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (request.method() === "POST" && (url.pathname === "/session" || url.pathname === "/api/session")) {
      sessionPosts.push(request.url())
    }
    if (request.method() !== "GET") return
    if (/^\/(?:kb|memory|schedule|delivery)(?:\/|$)/.test(url.pathname) || /^\/api\/session\//.test(url.pathname)) {
      reads.push({ server: url.origin, path: url.pathname })
    }
  })

  await serveAssistant(page, { server: urlA, directory: dirA, projectID: "proj_assistant_scope_a", note: noteA })
  await serveAssistant(page, { server: urlB, directory: dirB, projectID: sessionB.projectID, note: noteB })
  // Browser storage fixtures follow Persist.serverGlobal and acceptKey. The production
  // origin is the local scope; both explicitly registered remote URLs retain their keys.
  await page.addInitScript(
    (input) => {
      const notification = (session: string, type: "error" | "turn-complete") => ({
        session,
        type,
        time: Date.now(),
        viewed: false,
        directory: input.dirB,
        ...(type === "error" ? { error: { name: "UnknownError", data: { message: "isolated status fixture" } } } : {}),
      })
      localStorage.setItem(
        input.notificationA,
        JSON.stringify({ list: [notification("ses_assistant_scope_a-error", "error")] }),
      )
      localStorage.setItem(
        input.notificationB,
        JSON.stringify({
          list: [
            notification("ses_assistant_scope_b-error", "error"),
            notification("ses_assistant_scope_b-unread", "turn-complete"),
          ],
        }),
      )
      localStorage.setItem(input.permissionA, JSON.stringify({ autoAccept: { [input.acceptKey]: true } }))
      localStorage.setItem(input.permissionB, JSON.stringify({ autoAccept: { [input.acceptKey]: false } }))
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      // entry.tsx reads this raw URL before ServerProvider chooses its active key.
      localStorage.setItem("aigcfroge.settings.dat:defaultServerUrl", input.urlA)
      localStorage.setItem(
        "aigcfroge.global.dat:server",
        JSON.stringify({
          list: [
            { type: "http", http: { url: input.urlA } },
            { type: "http", http: { url: input.urlB } },
          ],
          projects: {},
          lastProject: {},
        }),
      )
    },
    {
      urlA,
      urlB,
      dirB,
      notificationA: `aigcfroge.global.dat:${urlA}\u0000notification`,
      notificationB: `aigcfroge.global.dat:${urlB}\u0000notification`,
      permissionA: `aigcfroge.global.dat:${urlA}\u0000permission`,
      permissionB: `aigcfroge.global.dat:${urlB}\u0000permission`,
      acceptKey: `${base64Encode(dirB)}/${pendingPermission.sessionID}`,
    },
  )

  try {
    await page.goto(`/server/${base64Encode(urlB)}/session/${sessionB.id}`)
    await expectAppVisible(page.getByRole("heading", { name: sessionB.title, exact: true }))
    const toggle = page.locator("#secondary-sidebar-toggle")
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute("aria-label")) !== "Hide sidebar") await toggle.click()

    const sidebar = page.locator('[data-component="assistant-session-sidebar"]')
    await expect(sidebar).toBeVisible()
    const row = (kind: string) => sidebar.locator(`[data-session-id="ses_assistant_scope_${kind}"]`)
    await expect(row("a-error")).toBeVisible()
    await expect.soft(row("a-error").locator(".bg-text-diff-delete-base")).toHaveCount(0)
    await expect.soft(row("b-error").locator(".bg-text-diff-delete-base")).toBeVisible()
    await expect.soft(row("b-unread").locator(".bg-text-interactive-base")).toBeVisible()
    await expect.soft(row("b-permission").locator(".bg-surface-warning-strong")).toBeVisible()
    await sidebar.locator('[data-nav-section="kb"] > button').click()
    await expect(sidebar.getByRole("button", { name: noteB.title, exact: true })).toBeVisible()
    await expect(sidebar.getByRole("button", { name: noteA.title, exact: true })).toHaveCount(0)
    expect(reads.some((read) => read.server === urlB && read.path === "/kb")).toBe(true)

    await sidebar.getByRole("button", { name: noteB.title, exact: true }).click()
    const panel = page.locator('[data-component="session-mode-panel"][data-mode="assistant"]')
    const kb = panel.locator('[data-component="assistant-kb-tab"]')
    await expect(kb).toBeVisible()
    await expect(kb.getByRole("heading", { name: noteB.title, exact: true })).toBeVisible()
    await expect(kb.getByText(noteB.content, { exact: true })).toBeVisible()
    await expect(page.getByText(noteA.content, { exact: true })).toHaveCount(0)
    await panel.getByRole("button", { name: "Edit note", exact: true }).click()
    const editor = panel.locator('[data-component="assistant-note-editor"] textarea')
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(noteB.content)
    await expect(editor).not.toHaveValue(noteA.content)
    expect([...new Set(reads.filter((read) => read.path === `/kb/${noteB.id}`).map((read) => read.server))]).toEqual([
      urlB,
    ])
    await testInfo.attach("assistant-server-b-note-editor", {
      body: await page.screenshot(),
      contentType: "image/png",
    })

    await sidebar.getByRole("button", { name: "New session", exact: true }).click()
    await expect(page).toHaveURL(/\/new-session\?draftId=[^&]+$/)
    const draftID = new URL(page.url()).searchParams.get("draftId")
    expect(draftID).toBeTruthy()
    await expect
      .poll(() => persistedDrafts(page))
      .toEqual([{ type: "draft", draftID, server: urlB, directory: dirB, mode: "assistant" }])
    await expectAppVisible(page.locator('[data-component="prompt-input"]'))
    await expect(page.locator('[data-component="prompt-input"]')).toHaveText("")
    expect(sessionPosts).toEqual([])
  } finally {
    await testInfo.attach("assistant-session-scope-evidence", {
      body: JSON.stringify(
        {
          reads,
          sessionPosts,
          url: page.url(),
          pageClosed: page.isClosed(),
          // A closed page must not replace the original assertion/timeout failure.
          drafts: await persistedDrafts(page).catch((error: unknown) => ({ unavailable: String(error) })),
        },
        null,
        2,
      ),
      contentType: "application/json",
    })
  }
})
;(["success", "failure"] as const).forEach((outcome) => {
  test(`AI-TDD-S08-R02: same-ID notes isolate an old server save ${outcome}`, async ({ page }, testInfo) => {
    await pinEnglishUI(page)
    await pinDesktopViewport(page)
    const repliesA = await serveAssistant(page, {
      server: urlA,
      directory: dirA,
      projectID: "proj_assistant_scope_a",
      note: noteA,
    })
    const repliesB = await serveAssistant(page, {
      server: urlB,
      directory: dirB,
      projectID: sessionB.projectID,
      note: noteB,
    })
    const savedA = { ...noteA, content: "Server A submitted body", updatedAt: 1700000000001 } satisfies KbNoteNote
    const savedB = {
      ...noteB,
      content: "Server B independent draft body",
      updatedAt: 1700000000002,
    } satisfies KbNoteNote
    const rejected = {
      _tag: "InvalidRequestError",
      message: "old server A save rejected",
    } satisfies InvalidRequestError
    const probeA = await AssistantMutationProbe.track(page, repliesA, [`/kb/${noteA.id}`], { origin: urlA })
    const probeB = await AssistantMutationProbe.track(page, repliesB, [`/kb/${noteB.id}`], { origin: urlB })
    await page.addInitScript(
      (input) => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true, showFileTree: true } }))
        localStorage.setItem("aigcfroge.settings.dat:defaultServerUrl", input.urlA)
        localStorage.setItem(
          "aigcfroge.global.dat:server",
          JSON.stringify({
            list: [
              { type: "http", http: { url: input.urlA } },
              { type: "http", http: { url: input.urlB } },
            ],
            projects: {},
            lastProject: {},
          }),
        )
        localStorage.setItem(
          "aigcfroge.global.dat:tabs",
          JSON.stringify([
            { type: "session", server: input.urlA, sessionId: input.sessionID },
            { type: "session", server: input.urlB, sessionId: input.sessionID },
          ]),
        )
      },
      { urlA, urlB, sessionID: sessionB.id },
    )
    const panel = page.locator('[data-component="session-mode-panel"][data-mode="assistant"]')
    const sidebar = page.locator('[data-component="assistant-session-sidebar"]')
    const editor = panel.locator('[data-component="assistant-note-editor"]')
    const titleInput = editor.getByRole("textbox", { name: "Title", exact: true })
    const bodyInput = editor.getByRole("textbox", { name: "Markdown body, may contain [[wikilinks]]", exact: true })
    const save = editor.getByRole("button", { name: "Save", exact: true })
    const visit = async (server: string) => {
      const href = `/server/${base64Encode(server)}/session/${sessionB.id}`
      await page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first().click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expectAppVisible(page.getByRole("heading", { name: sessionB.title, exact: true }))
    }
    const openNote = async (note: KbNoteNote) => {
      const toggle = page.locator("#secondary-sidebar-toggle")
      if ((await toggle.getAttribute("aria-label")) !== "Hide sidebar") await toggle.click()
      await expect(sidebar).toBeVisible()
      const section = sidebar.locator('[data-nav-section="kb"] > button')
      if ((await section.getAttribute("aria-expanded")) !== "true") await section.click()
      await sidebar.getByRole("button", { name: note.title, exact: true }).click()
      await panel.getByRole("button", { name: "Edit note", exact: true }).click()
      await expect(titleInput).toHaveValue(note.title)
      await expect(bodyInput).toHaveValue(note.content)
    }

    try {
      await page.goto(`/server/${base64Encode(urlA)}/session/${sessionB.id}`)
      await expectAppVisible(page.getByRole("heading", { name: sessionB.title, exact: true }))
      await openNote(noteA)
      await bodyInput.fill(savedA.content)
      await save.click()
      await expect.poll(() => probeA.mutations.length).toBe(1)
      expect(probeA.mutations[0].origin).toBe(urlA)
      expect(probeA.mutations[0].body).toEqual({ title: noteA.title, content: savedA.content, tags: noteA.tags })
      expect(probeB.mutations).toHaveLength(0)

      // Use the real canonical tab link: a full page.goto would abort the old request.
      await visit(urlB)
      await openNote(noteB)
      await bodyInput.fill(savedB.content)
      const bodyOwner = await bodyInput.elementHandle()
      if (!bodyOwner) throw new Error("The current server B editor must have a DOM owner")
      await save.click()
      await expect.poll(() => probeB.mutations.length).toBe(1)
      expect(probeB.mutations[0].origin).toBe(urlB)
      expect(probeB.mutations[0].body).toEqual({ title: noteB.title, content: savedB.content, tags: noteB.tags })
      await probeA.settle("server-b-pending-before-server-a-completes")
      await probeB.settle("server-b-pending-before-server-a-completes")
      const beforeB = probeB.receipt().observations.at(-1)?.counts
      if (!beforeB) throw new Error("Server B requires a settled read baseline")

      if (outcome === "success") {
        repliesA.set("/kb", [savedA])
        repliesA.set(`/kb/${noteA.id}`, savedA)
      }
      await probeA.complete(0, outcome === "success" ? { status: 200, json: savedA } : { status: 400, json: rejected })
      await probeA.settle("server-a-completed-with-server-b-current")
      await probeB.settle("server-a-completed-with-server-b-current")
      expect(probeB.receipt().observations.at(-1)?.counts).toEqual(beforeB)
      await expect(titleInput).toHaveValue(noteB.title)
      await expect(bodyInput).toHaveValue(savedB.content)
      await expect(titleInput).toBeDisabled()
      await expect(bodyInput).toBeDisabled()
      await expect(save).toBeDisabled()
      expect(await bodyInput.evaluate((element, previous) => element === previous, bodyOwner)).toBe(true)
      await bodyOwner.dispose()
      await expect(page.getByText(rejected.message, { exact: true })).toHaveCount(0)
      expect(probeA.mutations).toHaveLength(1)
      expect(probeB.mutations).toHaveLength(1)

      repliesB.set("/kb", [savedB])
      repliesB.set(`/kb/${noteB.id}`, savedB)
      await probeB.complete(0, { status: 200, json: savedB })
      await probeB.settle("server-b-own-save-readback")
      await expect(editor).toHaveCount(0)
      await sidebar.getByRole("button", { name: noteB.title, exact: true }).click()
      const kb = panel.locator('[data-component="assistant-kb-tab"]')
      await expect(kb.getByText(savedB.content, { exact: true })).toBeVisible()

      await visit(urlA)
      await openNote(outcome === "success" ? savedA : noteA)
      await expect(bodyInput).not.toHaveValue(savedB.content)
      await expect(save).toBeEnabled()
      await probeA.settle("original-server-restored-readback")
      expect(probeA.mutations).toHaveLength(1)
      expect(probeB.mutations).toHaveLength(1)
    } finally {
      await Promise.all([probeA.close(), probeB.close()])
      await testInfo.attach(`s08-r02-note-server-owner-${outcome}`, {
        body: JSON.stringify({ serverA: probeA.receipt(), serverB: probeB.receipt() }, null, 2),
        contentType: "application/json",
      })
    }
  })
})

async function serveAssistant(
  page: Page,
  input: { server: string; directory: string; projectID: string; note: KbNoteNote },
) {
  await mockAigcfrogeServer(page, {
    port: new URL(input.server).port,
    directory: input.directory,
    project: {
      id: input.projectID,
      worktree: input.directory,
      vcs: "git",
      name: input.projectID,
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} } satisfies ProviderListResponse,
    sessions: [sessionB, ...statusSessions].map((session) => ({
      ...session,
      directory: input.directory,
      projectID: input.projectID,
    })),
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  const replies = new Map<string, unknown>([
    ["/permission", input.server === urlB ? [pendingPermission] : []],
    ["/schedule/pending", []],
    ["/delivery/recent", []],
    ["/memory", []],
    ["/memory/pending", []],
    ["/kb", [input.note]],
    ["/kb/dangling", []],
    [`/kb/${input.note.id}`, input.note],
    [`/kb/${input.note.id}/backlinks`, []],
    [`/schedule/${sessionB.id}`, []],
    [`/delivery/${sessionB.id}`, []],
    [`/api/session/${sessionB.id}/message`, { data: [], cursor: {} } satisfies SessionMessagesResponse],
  ])
  await page.route(
    (url) => url.origin === input.server && replies.has(url.pathname),
    (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(replies.get(new URL(route.request().url()).pathname)),
      })
    },
  )
  return replies
}

async function persistedDrafts(page: Page) {
  return page.evaluate(() => {
    const value: unknown = JSON.parse(localStorage.getItem("aigcfroge.global.dat:tabs") ?? "[]")
    if (!Array.isArray(value)) return []
    return value
      .filter(
        (tab: unknown): tab is Record<string, unknown> =>
          typeof tab === "object" && tab !== null && "type" in tab && tab.type === "draft",
      )
      .map((tab) => ({
        type: tab.type,
        draftID: tab.draftID,
        server: tab.server,
        directory: tab.directory,
        mode: tab.mode,
      }))
  })
}
