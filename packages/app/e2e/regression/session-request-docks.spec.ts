import { expect, test, type Locator, type Page } from "@playwright/test"
import type { SessionGoalInfo, SessionMessageInfo, SessionTaskOperationInfo } from "@aigcfroge/client/promise"
import { ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { SessionID } from "@aigcfroge/schema/session-id"
import { SessionTaskEvent } from "@aigcfroge/schema/session-task-event"
import { SessionStatusEvent } from "@aigcfroge/schema/session-status-event"
import { timelinePresets } from "@aigcfroge/session-ui/timeline/detail"
import { project, provider, REMOTE_SERVER, SERVER, seed, session, sessionHref } from "../utils/app"
import { mockServers, type MockGoalMutation } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"
import { mockWorkspace, type WorkspaceInput } from "../utils/workspace"
import { attachSession, openSidePanel } from "../utils/side-panel"

const directory = "C:/AigcForge/RequestDocks"

const sessionID = "ses_request_docks"

const title = "Request dock regression"

test("SC03 responds only in the visible target owner and keeps late cross-server replies isolated", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const sourceID = "ses_sc03_request_source"
  const targetID = "ses_sc03_shared_target"
  const childID = "ses_sc03_request_child"
  const remoteDirectory = "/home/sc03-request-target"
  const permissionID = "per_sc03_same"
  const formID = "frm_sc03_remote"
  const replies: { server: string; sessionID: string; permissionID: string; body: unknown }[] = []
  const executions: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const path = new URL(request.url()).pathname

    if (path === "/api/session" || /\/(prompt|interrupt)$/.test(path)) executions.push(request.url())
  })

  const permission = (sessionID: string, resource: string) => ({
    id: permissionID,
    sessionID,
    action: "read",
    resources: [resource],
    metadata: {},
    save: [],
  })

  const servers = await mockServers(page, {
    [SERVER]: {
      directory,
      project: project({ id: "proj_sc03_request_source", directory }),
      provider: provider(),
      sessions: [
        session({ id: sourceID, directory, title: "Request source A" }),
        session({ id: targetID, directory, title: "Local target" }),
      ],
      pageMessages: () => ({ items: [] }),
      sessionPermissions: { [targetID]: [permission(targetID, "local-only")] },
      onPermissionReply: (reply) => void replies.push({ server: SERVER, ...reply }),
    },
    [REMOTE_SERVER]: {
      directory: remoteDirectory,
      project: project({ id: "proj_sc03_request_target", directory: remoteDirectory }),
      provider: provider(),
      sessions: [
        session({ id: targetID, directory: remoteDirectory, title: "Remote target" }),
        session({ id: childID, parentID: targetID, directory: remoteDirectory, title: "Remote child" }),
      ],
      pageMessages: () => ({ items: [] }),
      sessionPermissions: { [childID]: [permission(childID, "remote-only")] },
      onPermissionReply: (reply) => void replies.push({ server: REMOTE_SERVER, ...reply }),
      forms: [
        {
          id: formID,
          sessionID: childID,
          title: "Remote question",
          metadata: { kind: "question" },
          fields: [
            {
              key: "q0",
              type: "string",
              title: "Continue remote",
              description: "Continue the remote target?",
              options: [{ value: "yes", label: "Continue remote" }],
            },
          ],
        },
      ],
    },
  })

  await seed(page, {
    servers: [REMOTE_SERVER],
    tabs: [sourceID, targetID, { session: targetID, server: REMOTE_SERVER }],
  })
  // Prime the already-open remote root's real metadata before selecting it in the source panel.
  await page.goto(sessionHref(targetID, REMOTE_SERVER))
  await expectSessionTitle(page, "Remote target")
  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sourceID)}"])`).click()
  await expectSessionTitle(page, "Request source A")
  const main = page.locator('[data-slot="session-chat-panel"]')
  const view = page.locator('[data-component="session-content-panel"]:visible')
  const permissionDock = (within: Locator) => within.locator('[data-component="dock-prompt"][data-kind="permission"]')
  const questionDock = (within: Locator) => within.locator('[data-component="dock-prompt"][data-kind="question"]')
  await main.locator('[data-component="composer-editor"]').fill("Source A remains editable")

  const attach = async (server: string) => {
    await attachSession(page, {
      server,
      sessionID: targetID,
      title: server === REMOTE_SERVER ? "Remote target" : "Local target",
    })
  }

  await attach(REMOTE_SERVER)
  await expect(view).toContainText("Remote target")
  await expect(permissionDock(view)).toContainText("remote-only")
  await expect(questionDock(view)).toContainText("Continue the remote target?")
  await expect(permissionDock(main)).toHaveCount(0)
  await expect(questionDock(main)).toHaveCount(0)
  await expect(main.locator('[data-component="composer-editor"]')).toHaveText("Source A remains editable")
  await questionDock(view).getByRole("button", { name: "Minimize question", exact: true }).click()
  await expect(questionDock(view)).toBeVisible()
  await expect(view.locator('[data-component="composer-editor"]')).toHaveCount(0)
  await view.getByRole("button", { name: "Open as main session", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(targetID, REMOTE_SERVER))
  await expect(permissionDock(main)).toContainText("remote-only")
  await expect(questionDock(main)).toBeVisible()
  await expect(page.locator('[data-slot="permission-footer-actions"]')).toHaveCount(1)
  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sourceID)}"])`).click()
  await expect(permissionDock(view)).toContainText("remote-only")
  await expect(questionDock(view)).toBeVisible()
  await page
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(targetID, REMOTE_SERVER)}"])`)
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(permissionDock(view)).toBeVisible()

  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) =>
      url.origin === REMOTE_SERVER && url.pathname === `/api/session/${childID}/permission/${permissionID}/reply`,
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback()
      started.resolve()
      await release.promise
      await route.fallback()
    },
  )
  await permissionDock(view).getByRole("button", { name: "Allow once", exact: true }).click()
  await started.promise

  try {
    await attach(SERVER)
    await expect(view).toContainText("Local target")
    await expect(permissionDock(view)).toContainText("local-only")
    await expect(questionDock(view)).toHaveCount(0)
  } finally {
    release.resolve()
  }

  await expect
    .poll(() => replies)
    .toEqual([{ server: REMOTE_SERVER, sessionID: childID, permissionID, body: { decision: "once" } }])
  await expect(permissionDock(view)).toContainText("local-only")
  await permissionDock(view).getByRole("button", { name: "Allow once", exact: true }).click()
  await expect
    .poll(() => replies)
    .toEqual([
      { server: REMOTE_SERVER, sessionID: childID, permissionID, body: { decision: "once" } },
      { server: SERVER, sessionID: targetID, permissionID, body: { decision: "once" } },
    ])
  await expect(view.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(main.locator('[data-component="composer-editor"]')).toHaveText("Source A remains editable")

  const remoteTabID = `session-side-panel-view-tab-${encodeURIComponent(`${SERVER}\n${sourceID}`)}-session-${encodeURIComponent(`${REMOTE_SERVER}\n${targetID}`)}`
  await page.locator(`[id="${remoteTabID}"]`).click()
  await expect(questionDock(view)).toBeVisible()
  await expect(view.locator('[data-component="composer-editor"]')).toHaveCount(0)
  const restore = questionDock(view).getByRole("button", { name: "Restore question", exact: true })

  if (await restore.isVisible()) await restore.click()
  await questionDock(view).getByRole("radio", { name: "Continue remote", exact: true }).click()

  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url() === `${REMOTE_SERVER}/api/session/${childID}/form/${formID}/reply`,
  )

  await questionDock(view).getByRole("button", { name: "Submit", exact: true }).click()
  expect((await submitted).postDataJSON()).toEqual({ answer: { q0: "yes" } })
  expect(
    (await servers[SERVER]!.transport.connections()).filter((connection) => connection.endedAt === undefined),
  ).toHaveLength(1)
  expect(
    (await servers[REMOTE_SERVER]!.transport.connections()).filter((connection) => connection.endedAt === undefined),
  ).toHaveLength(1)
  expect(executions).toEqual([])
})

test("shows a pending question dock", async ({ page }) => {
  await mockServer(page, {
    forms: [
      {
        id: "frm_question_request",
        sessionID,
        title: "Questions",
        metadata: { kind: "question" },
        fields: [
          {
            key: "q0",
            type: "string",
            title: "Implementation",
            description: "Which implementation should be used?",
            options: [
              { value: "minimal", label: "Minimal", description: "Use the smallest correct change" },
              { value: "extended", label: "Extended", description: "Include additional behavior" },
            ],
            custom: true,
          },
        ],
      },
    ],
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question).toBeVisible()
  await expect(question.getByText("Which implementation should be used?")).toBeVisible()
  await expect(question.getByRole("radio", { name: /Minimal/ })).toBeVisible()
  await expect(question.getByRole("radio", { name: /Extended/ })).toBeVisible()
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  const rejectRequests: string[] = []
  page.on("request", (request) => {
    if (
      request.method() === "DELETE" &&
      new URL(request.url()).pathname === `/api/session/${sessionID}/form/frm_question_request`
    )
      rejectRequests.push(request.url())
  })

  await question.getByRole("button", { name: "Minimize question" }).click()
  await expect(question).toBeVisible()
  await expect(question.getByText("Which implementation should be used?")).toBeVisible()
  await expect(question.getByText("Select one answer")).toBeHidden()
  await expect(question.getByRole("radio", { name: /Minimal/ })).toBeHidden()
  await expect(question.getByRole("radio", { name: /Extended/ })).toBeHidden()
  await expect(question.getByRole("button", { name: "Dismiss" })).toBeVisible()
  await expect(question.getByRole("button", { name: "Submit" })).toBeVisible()
  await expect(page.locator('[data-component="question-minimized-dock"]')).toHaveCount(0)
  expect(rejectRequests).toEqual([])

  await question.getByRole("button", { name: "Restore question" }).click()
  await expect(question).toBeVisible()
  await expect(question.getByText("Which implementation should be used?")).toBeVisible()
  await expect(question.getByRole("radio", { name: /Minimal/ })).toBeVisible()
  expect(rejectRequests).toEqual([])

  await question.getByRole("radio", { name: /Minimal/ }).click()

  const reply = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/api/session/${sessionID}/form/frm_question_request/reply`,
  )

  await question.getByRole("button", { name: "Submit" }).click()
  expect((await reply).postDataJSON()).toEqual({ answer: { q0: "minimal" } })
})

test("shows a pending permission dock", async ({ page }) => {
  const replies: { sessionID: string; permissionID: string; body: unknown }[] = []
  await mockServer(page, {
    onPermissionReply: (reply) => replies.push(reply),
    sessionPermissions: {
      [sessionID]: [
        {
          id: "permission-request",
          sessionID,
          permission: "shell",
          patterns: ["git status", "git diff"],
          metadata: {},
          always: [],
        },
      ],
    },
  })

  await page.goto(sessionHref(sessionID))
  await expectSessionTitle(page, title)

  const permission = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
  await expect(permission).toBeVisible()
  await expect(permission.getByText("git status")).toBeVisible()
  await expect(permission.getByText("git diff")).toBeVisible()
  await expect(permission.locator('[data-slot="permission-footer-actions"] button')).toHaveCount(3)
  await expect(page.locator('[data-component="composer"]')).toHaveCount(0)

  const reply = page.waitForResponse((response) => response.request().method() === "POST")
  await permission.getByRole("button", { name: "Allow once" }).click()
  const response = await reply
  expect(new URL(response.url()).pathname).toBe(`/api/session/${sessionID}/permission/permission-request/reply`)
  expect(response.request().postDataJSON()).toEqual({ decision: "once" })
  expect(response.status()).toBe(204)
  expect(replies).toEqual([{ sessionID, permissionID: "permission-request", body: { decision: "once" } }])
  await expect(permission).toHaveCount(0)
  await expect(page.locator('[data-component="composer"]')).toBeVisible()
})

test("restores the draft caret before typing after a request dock closes", async ({ page }) => {
  const transport = await installSseTransport(page, { server: SERVER, retry: 20 })
  await mockServer(page, { forms: [] })
  await page.goto(sessionHref(sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)

  const editor = page.locator('[data-component="composer-editor"][contenteditable="true"]')
  const draft = "keep the caret at the end"

  const caret = () =>
    editor.evaluate((element) => {
      const selection = window.getSelection()

      if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return -1
      const range = selection.getRangeAt(0).cloneRange()
      range.selectNodeContents(element)
      range.setEnd(selection.anchorNode!, selection.anchorOffset)

      return range.toString().length
    })

  await editor.fill(draft)
  // The editor places the caret after the filled text; move it only from that known position.
  await expect.poll(caret).toBe(draft.length)

  for (let index = 0; index < 4; index++) await page.keyboard.press("ArrowLeft")
  const cursor = draft.length - 4
  await expect.poll(caret).toBe(cursor)
  await transport.send({
    id: "evt_form_created",
    created: 1700000001000,
    type: "form.created",
    location: { directory },
    data: {
      form: {
        id: "frm_question_caret",
        sessionID,
        title: "Questions",
        metadata: { kind: "question", tool: { messageID: "message-caret", id: "call-caret" } },
        fields: [
          {
            key: "q0",
            type: "string",
            title: "Continue",
            description: "Continue?",
            options: [{ value: "yes", label: "Yes", description: "Continue the session" }],
            custom: true,
          },
        ],
      },
    },
  })
  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question).toBeVisible()
  await expect(editor).toHaveCount(0)

  await transport.send({
    id: "evt_form_cancelled",
    created: 1700000002000,
    type: "form.cancelled",
    location: { directory },
    data: { sessionID, id: "frm_question_caret" },
  })
  await expect(question).toHaveCount(0)
  await expect(editor).toBeVisible()
  await page.keyboard.press("x")

  await expect(editor).toHaveText(`${draft.slice(0, cursor)}x${draft.slice(cursor)}`)
})

test("task dock follows durable snapshots without writes and coexists with request docks", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const transport = await installSseTransport(page, { server: SERVER, retry: 20 })
  const otherID = "ses_request_tasks_other"
  const otherTitle = "Other task dock"
  const records: SessionTask.Info[] = []
  const reads: string[] = []
  const writes: string[] = []
  const executions: string[] = []
  const fault = { read: false }

  const finished = new SessionTask.Info({
    id: "tsk_request_finished",
    sessionID,
    content: "Inspect the saved evidence",
    status: "completed",
    priority: "medium",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  })

  const pending = new SessionTask.Info({
    id: "tsk_request_pending",
    sessionID,
    content: "Run the follow-up check",
    status: "pending",
    priority: "medium",
    revision: 1,
    createdAt: 2,
    updatedAt: 2,
  })

  const active = new SessionTask.Info({
    id: "tsk_request_active",
    sessionID,
    content: "Finish the implementation",
    status: "in_progress",
    priority: "high",
    revision: 1,
    createdAt: 3,
    updatedAt: 3,
  })

  const other = new SessionTask.Info({
    id: "tsk_request_other",
    sessionID: otherID,
    content: "Keep the other Session separate",
    status: "pending",
    priority: "low",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  })

  const messages: SessionMessageInfo[] = [
    { id: "msg_task_first_prompt", type: "user", text: "Inspect the first saved attempt", time: { created: 1 } },
    {
      id: "msg_task_first_result",
      type: "assistant",
      agent: "meta",
      model: { providerID: "fixture", id: "fixture" },
      time: { created: 2, completed: 3 },
      content: [
        {
          id: "call_task_source_first",
          type: "tool",
          name: "task",
          time: { created: 2, ran: 2, completed: 3 },
          state: {
            status: "completed",
            input: {
              description: "First saved implementation attempt",
              subagent_type: "build",
              prompt: "Inspect the first implementation attempt",
            },
            content: [{ type: "text", text: "The first attempt finished." }],
            metadata: { parentTaskID: active.id },
          },
        },
        {
          id: "call_task_no_metadata",
          type: "tool",
          name: "task",
          time: { created: 2, ran: 2, completed: 3 },
          state: {
            status: "completed",
            input: { description: "Unconfirmed task source", parent_task_id: pending.id },
            content: [{ type: "text", text: "No parent task was confirmed in the result." }],
          },
        },
      ],
    },
    { id: "msg_task_second_prompt", type: "user", text: "Continue the same implementation task", time: { created: 4 } },
    {
      id: "msg_task_second_result",
      type: "assistant",
      agent: "meta",
      model: { providerID: "fixture", id: "fixture" },
      time: { created: 5, completed: 6 },
      content: [
        {
          id: "call_task_source_second",
          type: "tool",
          name: "task",
          time: { created: 5, ran: 5, completed: 6 },
          state: {
            status: "completed",
            input: {
              description: "Second saved implementation attempt",
              subagent_type: "build",
              prompt: "Inspect the second implementation attempt",
            },
            content: [{ type: "text", text: "The second attempt finished." }],
            metadata: { parentTaskID: active.id },
          },
        },
        {
          id: "call_task_unlinked_finished",
          type: "tool",
          name: "task",
          time: { created: 5, ran: 5, completed: 6 },
          state: {
            status: "completed",
            input: { description: "Unlinked evidence check" },
            content: [{ type: "text", text: "Saved evidence remains available." }],
          },
        },
      ],
    },
  ]

  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (request.method() === "POST" && (path === "/api/session" || /\/(prompt|interrupt)$/.test(path)))
      executions.push(request.url())

    if (!/^\/session\/[^/]+\/task(?:\/[^/]+)?$/.test(path)) return

    if (request.method() === "GET" || request.method() === "OPTIONS") return
    writes.push(`${request.method()} ${path}`)
  })

  await mockWorkspace(page, {
    name: "Task dock regression",
    directory,
    sessions: [
      { id: sessionID, title },
      { id: otherID, title: otherTitle },
    ],
    tasks: records,
    pageMessages: (id) => ({ items: id === sessionID ? messages : [] }),
    forms: [],
    seed: { settings: { timelineDetail: timelinePresets[2].value } },
    onTaskRead(input) {
      reads.push(input.sessionID)

      if (input.sessionID === sessionID && fault.read)
        return new InvalidRequestError({ message: "Task read temporarily unavailable", kind: "invalid_request" })
    },
  })
  await page.goto(sessionHref(sessionID))
  await transport.waitForConnection()
  await expectSessionTitle(page, title)
  await expect.poll(() => reads.includes(sessionID)).toBe(true)
  const dock = page.locator('[data-component="session-todo-dock"]')
  const composer = page.locator('[data-component="composer-editor"][contenteditable="true"]')
  await expect(dock).toHaveCount(0)
  await expect(composer).toBeEditable()
  const draft = "Keep this composer draft while tasks and requests change."
  await composer.fill(draft)

  // The real MockApi reads these shared durable rows; the SSE notification only invalidates the client snapshot.
  records.splice(0, records.length, finished, pending, active, other)

  const loaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === `/session/${sessionID}/task`,
  )

  await transport.send({
    id: "evt_request_tasks_arrived",
    created: 4,
    type: SessionTaskEvent.Updated.type,
    location: { directory },
    data: {
      sessionID,
      tasks: records.flatMap((task) => {
        if (task.sessionID !== sessionID) return []

        return [{ ...task, dependsOn: task.dependsOn && [...task.dependsOn] }]
      }),
    },
  })
  expect((await loaded).status()).toBe(200)
  await expect(page.getByRole("region", { name: "Tasks", exact: true })).toBeVisible()
  await expect(dock.getByText("1 of 3 tasks completed", { exact: true })).toBeVisible()
  await expect(dock.getByRole("button", { name: "Collapse tasks", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  )
  await expect(dock.getByRole("listitem")).toHaveCount(3)
  await expect(
    dock.getByRole("listitem", { name: `Task: ${pending.content}`, exact: true }).getByText("Pending", { exact: true }),
  ).toBeVisible()
  await expect(
    dock
      .getByRole("listitem", { name: `Task: ${active.content}`, exact: true })
      .getByText("In progress", { exact: true }),
  ).toBeVisible()
  await expect(dock.getByRole("checkbox", { name: finished.content, exact: true })).toBeChecked()
  const readonly = dock.getByRole("checkbox", { name: pending.content, exact: true })
  await expect(readonly).not.toBeChecked()
  await readonly.press("Space")
  await expect(readonly).not.toBeChecked()
  await expect(dock.getByText(other.content, { exact: true })).toHaveCount(0)
  await expect(composer).toHaveText(draft)
  expect(writes).toEqual([])

  await composer.press("Control+Alt+J")
  await expect(dock.getByRole("button", { name: "Expand tasks", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(dock.getByRole("listitem")).toHaveCount(0)
  await expect(composer).toHaveText(draft)
  await composer.press("Control+Alt+J")
  await expect(dock.getByRole("button", { name: "Collapse tasks", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  )
  await expect(dock.getByRole("listitem")).toHaveCount(3)
  await composer.press("End")
  await composer.press("j")
  await expect(composer).toHaveText(draft + "j")
  await expect(dock.getByRole("listitem")).toHaveCount(3)
  await composer.fill(draft)
  expect(writes).toEqual([])

  const activeRow = dock.getByRole("listitem", { name: `Task: ${active.content}`, exact: true })

  const firstSource = activeRow.getByRole("button", {
    name: `View source call_task_source_first for ${active.content}`,
    exact: true,
  })

  const secondSource = activeRow.getByRole("button", {
    name: `View source call_task_source_second for ${active.content}`,
    exact: true,
  })

  await expect(activeRow.getByRole("button", { name: /^View source / })).toHaveCount(2)
  await expect(firstSource).toHaveText("Source 1")
  await expect(firstSource).toHaveAttribute("title", "call_task_source_first")
  await expect(secondSource).toHaveText("Source 2")
  await expect(secondSource).toHaveAttribute("title", "call_task_source_second")
  await expect(
    dock
      .getByRole("listitem", { name: `Task: ${pending.content}`, exact: true })
      .getByRole("button", { name: /^View source / }),
  ).toHaveCount(0)
  await expect(
    dock
      .getByRole("listitem", { name: `Task: ${finished.content}`, exact: true })
      .getByRole("button", { name: /^View source / }),
  ).toHaveCount(0)

  const firstGroup = page.locator(
    '[data-component="collapsed-tool-group"][data-timeline-part-ids="call_task_source_first,call_task_no_metadata"]',
  )

  const secondGroup = page.locator(
    '[data-component="collapsed-tool-group"][data-timeline-part-ids="call_task_source_second,call_task_unlinked_finished"]',
  )

  const firstTrigger = firstGroup.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

  const secondTrigger = secondGroup.locator(
    ':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]',
  )

  const firstTool = firstGroup.locator('[data-timeline-part-id="call_task_source_first"]')
  const secondTool = secondGroup.locator('[data-timeline-part-id="call_task_source_second"]')
  await expect(firstTrigger).toHaveAttribute("aria-expanded", "false")
  await expect(secondTrigger).toHaveAttribute("aria-expanded", "false")
  await expect(firstTool).toHaveCount(0)
  await expect(secondTool).toHaveCount(0)
  await firstSource.click()
  await expect(firstTool).toBeVisible()
  await expect(firstTrigger).toHaveAttribute("aria-expanded", "true")
  await expect(firstTool.getByText("First saved implementation attempt", { exact: true })).toBeVisible()
  await expect(firstTool.getByText("prompt=Inspect the first implementation attempt", { exact: true })).toBeVisible()
  await expect(secondTrigger).toHaveAttribute("aria-expanded", "false")
  await expect(secondTool).toHaveCount(0)
  await expect(page).toHaveURL(sessionHref(sessionID))
  await expect(composer).toHaveText(draft)
  await secondSource.click()
  await expect(secondTool).toBeVisible()
  await expect(secondTrigger).toHaveAttribute("aria-expanded", "true")
  await expect(secondTool.getByText("Second saved implementation attempt", { exact: true })).toBeVisible()
  await expect(secondTool.getByText("prompt=Inspect the second implementation attempt", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(sessionHref(sessionID))
  await expect(composer).toHaveText(draft)
  expect(writes).toEqual([])
  expect(executions).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("task-dock-wide.png") })

  await dock.getByRole("button", { name: "Collapse tasks", exact: true }).click()
  await expect(
    dock.getByRole("button", { name: "Expand tasks", exact: true }).locator('[data-slot="icon-svg"]'),
  ).toHaveCSS("rotate", "180deg")
  await expect(dock.getByRole("button", { name: "Expand tasks", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(dock.getByRole("listitem")).toHaveCount(0)
  await expect(dock.getByText(active.content, { exact: true })).toBeVisible()
  await expect(dock.getByText(pending.content, { exact: true })).toHaveCount(0)
  await dock.getByRole("button", { name: "Expand tasks", exact: true }).click()
  await expect(
    dock.getByRole("button", { name: "Collapse tasks", exact: true }).locator('[data-slot="icon-svg"] use'),
  ).toHaveAttribute("href", /chevron-down$/)
  await expect(dock.getByRole("listitem")).toHaveCount(3)

  await transport.send({
    id: "evt_request_tasks_question",
    created: 5,
    type: "form.created",
    location: { directory },
    data: {
      form: {
        id: "frm_request_tasks_question",
        sessionID,
        title: "Questions",
        metadata: { kind: "question" },
        fields: [
          {
            key: "q0",
            type: "string",
            title: "Continue",
            description: "Continue while tasks remain visible?",
            options: [{ value: "yes", label: "Yes", description: "Continue the Session" }],
            custom: true,
          },
        ],
      },
    },
  })
  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await expect(question).toBeVisible()
  await expect(dock).toBeVisible()
  await expect(dock.getByRole("listitem")).toHaveCount(3)
  await expect(composer).toHaveCount(0)
  await expect
    .poll(async () => {
      const taskBounds = await dock.boundingBox()
      const questionBounds = await question.boundingBox()

      return !!taskBounds && !!questionBounds && taskBounds.y + taskBounds.height <= questionBounds.y
    })
    .toBe(true)
  await transport.send({
    id: "evt_request_tasks_question_cancelled",
    created: 6,
    type: "form.cancelled",
    location: { directory },
    data: { sessionID, id: "frm_request_tasks_question" },
  })
  await expect(question).toHaveCount(0)
  await expect(composer).toHaveText(draft)

  records[2] = new SessionTask.Info({ ...active, status: "completed", revision: 2, updatedAt: 7 })
  await transport.send({
    id: "evt_request_tasks_completed",
    created: 7,
    type: SessionTaskEvent.Updated.type,
    location: { directory },
    data: {
      sessionID,
      tasks: records.flatMap((task) => {
        if (task.sessionID !== sessionID) return []

        return [{ ...task, dependsOn: task.dependsOn && [...task.dependsOn] }]
      }),
    },
  })
  await expect(dock.getByText("2 of 3 tasks completed", { exact: true })).toBeVisible()
  await dock.getByRole("button", { name: "Collapse tasks", exact: true }).click()
  await expect(dock.getByText(pending.content, { exact: true })).toBeVisible()
  await dock.getByRole("button", { name: "Expand tasks", exact: true }).click()

  fault.read = true
  await transport.send({
    id: "evt_request_tasks_read_failed",
    created: 8,
    type: SessionTaskEvent.Updated.type,
    location: { directory },
    data: {
      sessionID,
      tasks: records.flatMap((task) => {
        if (task.sessionID !== sessionID) return []

        return [{ ...task, dependsOn: task.dependsOn && [...task.dependsOn] }]
      }),
    },
  })
  const status = dock.getByRole("status")
  await expect(status).toContainText("Could not refresh tasks.")
  await expect(dock.getByRole("listitem")).toHaveCount(3)

  fault.read = false

  const recovered = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === `/session/${sessionID}/task`,
  )

  await status.getByRole("button", { name: "Try again", exact: true }).click()
  expect((await recovered).status()).toBe(200)
  await expect(status).toHaveCount(0)

  records[1] = new SessionTask.Info({ ...pending, status: "cancelled", revision: 2, updatedAt: 9 })
  await transport.send({
    id: "evt_request_tasks_settled",
    created: 9,
    type: SessionTaskEvent.Updated.type,
    location: { directory },
    data: {
      sessionID,
      tasks: records.flatMap((task) => {
        if (task.sessionID !== sessionID) return []

        return [{ ...task, dependsOn: task.dependsOn && [...task.dependsOn] }]
      }),
    },
  })
  await expect(dock.getByRole("button", { name: "Expand tasks", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(dock.getByText(active.content, { exact: true })).toBeVisible()
  await transport.send({
    id: "evt_request_tasks_idle",
    created: 10,
    type: SessionStatusEvent.Status.type,
    location: { directory },
    data: { sessionID, status: { type: "idle" } },
  })
  await expect(dock.getByText("2 of 3 tasks completed", { exact: true })).toBeVisible()
  await dock.getByRole("button", { name: "Expand tasks", exact: true }).click()
  await expect(dock.getByRole("listitem")).toHaveCount(3)
  await expect(
    dock
      .getByRole("listitem", { name: `Task: ${pending.content}`, exact: true })
      .getByText("Cancelled", { exact: true }),
  ).toBeVisible()

  await page.locator("[data-titlebar-tab-slot]", { hasText: otherTitle }).click()
  await expectSessionTitle(page, otherTitle)
  await expect(dock.getByText("0 of 1 task completed", { exact: true })).toBeVisible()
  await expect(dock.getByRole("listitem")).toHaveCount(1)
  await expect(dock.getByText(other.content, { exact: true })).toBeVisible()
  await expect(dock.getByText(active.content, { exact: true })).toHaveCount(0)
  await expect.poll(() => reads.includes(otherID)).toBe(true)
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await expect(dock.getByText("2 of 3 tasks completed", { exact: true })).toBeVisible()
  await expect(dock.getByText(other.content, { exact: true })).toHaveCount(0)
  await expect(composer).toHaveText(draft)
  const toggle = dock.getByRole("button", { name: /^(Expand|Collapse) tasks$/ })
  await expect(toggle).toBeVisible()

  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")

  await composer.click()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.locator('[data-action="settings-language"]').click()
  await page.getByRole("option", { name: "简体中文", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans")
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await expect(page.getByRole("region", { name: "任务清单", exact: true })).toBeVisible()
  await expect(dock.getByText("已完成2/3项任务", { exact: true })).toBeVisible()
  await dock.getByRole("button", { name: "展开任务清单", exact: true }).click()
  await expect(dock.getByRole("button", { name: "收起任务清单", exact: true })).toHaveAttribute("aria-expanded", "true")
  await expect(
    dock.getByRole("listitem", { name: `任务：${pending.content}`, exact: true }).getByText("已取消", { exact: true }),
  ).toBeVisible()
  await expect(composer).toHaveText(draft)
  await dock.getByRole("button", { name: "收起任务清单", exact: true }).click()
  records[1] = new SessionTask.Info({ ...pending, revision: 3, updatedAt: 11 })
  await transport.send({
    id: "evt_request_tasks_pending_again",
    created: 11,
    type: SessionTaskEvent.Updated.type,
    location: { directory },
    data: {
      sessionID,
      tasks: records.flatMap((task) => {
        if (task.sessionID !== sessionID) return []

        return [{ ...task, dependsOn: task.dependsOn && [...task.dependsOn] }]
      }),
    },
  })
  await expect(dock.getByRole("button", { name: "收起任务清单", exact: true })).toHaveAttribute("aria-expanded", "true")
  await expect(
    dock.getByRole("listitem", { name: `任务：${pending.content}`, exact: true }).getByText("待处理", { exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dock).toBeVisible()
  await expect(composer).toBeVisible()
  await expect(dock.getByRole("button", { name: `查看 ${pending.content} 的详情`, exact: true })).toHaveText("详情")
  await page.screenshot({ path: testInfo.outputPath("task-dock-narrow-chinese.png") })
  expect(writes).toEqual([])
  expect(executions).toEqual([])
})

test("MP03 Task dock and notice open the exact saved operation without reading legacy result messages", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const transport = await installSseTransport(page, { server: SERVER })
  const sourceID = "ses_mp03_task_source"
  const targetID = "ses_mp03_task_target"
  const taskID = "tsk_mp03_operation"
  const operationID = "top_mp03_operation"
  const taskTitle = "Inspect the exact saved operation"

  const operations: SessionTaskOperationInfo[] = [
    {
      sourceSessionID: sourceID,
      sourceLocation: { directory },
      sourceMode: "work",
      operationID,
      taskID,
      inputID: "msg_mp03_operation",
      targetSessionID: targetID,
      requestDigest: "a".repeat(64),
      request: {
        operationID,
        inputID: "msg_mp03_operation",
        taskID,
        target: { type: "existing_root", sessionID: targetID },
        prompt: "Exact saved dispatch prompt",
        description: "Saved Task description",
        files: [],
        delivery: "queue",
        resume: false,
      },
      source: { type: "user_coordination", sessionID: sourceID, agent: "meta" },
      selection: { agent: "meta", seq: 1 },
      phase: "settled",
      cancelIntent: false,
      createdAt: 1,
      updatedAt: 3,
      admission: { eventID: "evt_mp03_task_admission", seq: 2 },
      sourceSettlement: "pending",
      result: {
        sessionID: targetID,
        inputID: "msg_mp03_operation",
        messageIDs: ["msg_mp03_legacy_result"],
        text: "Complete durable Task result\nSecond result line",
        resultEventID: "evt_mp03_task_result",
        sharedInputs: ["msg_mp03_other_input"],
        digest: "b".repeat(64),
      },
    },
  ]

  const tasks = [
    new SessionTask.Info({
      id: taskID,
      sessionID: sourceID,
      content: taskTitle,
      status: "in_progress",
      priority: "high",
      revision: 1,
      operationRef: new SessionTask.OperationReadonlyRef({
        sourceSessionID: SessionID.make(sourceID),
        operationID: SessionTask.OperationID.make(operationID),
      }),
      createdAt: 1,
      updatedAt: 3,
    }),
  ]

  const reads: string[] = []
  const writes: string[] = []
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.method() !== "OPTIONS" &&
      /^\/(?:api\/session|session\/[^/]+\/task|schedule\/)/.test(new URL(request.url()).pathname)
    )
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
  })
  await mockWorkspace(page, {
    name: "MP03 Task operation",
    directory,
    tasks,
    operations,
    sessions: [
      {
        id: sourceID,
        title: "Task operation source",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_mp03_task", rootSessionID: sourceID },
      },
      { id: targetID, title: "Task operation target", mode: "coding", agent: "build" },
    ],
    pageMessages(id) {
      reads.push(id)

      return {
        items:
          id === sourceID
            ? [
                {
                  id: "msg_mp03_task_notice",
                  type: "synthetic",
                  text: "Task coordination: Saved Task description",
                  time: { created: 2 },
                  metadata: {
                    coordination: {
                      kind: "task",
                      operationRef: { sourceSessionID: sourceID, operationID },
                      actorSessionID: sourceID,
                      actorAgent: "meta",
                      targetSessionID: targetID,
                    },
                  },
                },
              ]
            : [],
      }
    },
  })
  await page.goto(sessionHref(sourceID))
  await expectSessionTitle(page, "Task operation source")
  await transport.waitForConnection()
  const dock = page.getByRole("region", { name: "Tasks", exact: true })
  await dock.getByRole("button", { name: `View details for ${taskTitle}`, exact: true }).click()
  const side = page.locator("#review-panel")
  const details = side.getByRole("region", { name: "Task details", exact: true })
  const dispatch = details.getByRole("article", { name: `Dispatch ${operationID}`, exact: true })
  await expect(dispatch).toContainText("Awaiting source Task update")
  await details.getByRole("button", { name: "Back to collaborations", exact: true }).click()
  await openSidePanel(page, "Task delegation")
  const monitor = side.getByRole("region", { name: "Task dispatch", exact: true })
  const running = monitor.getByRole("button", { name: "Running", exact: true })
  const completed = monitor.getByRole("button", { name: "Completed", exact: true })
  const taskList = monitor.getByRole("region", { name: "Tasks", exact: true })
  const taskButton = taskList.getByRole("button", { name: `View task: ${taskTitle}`, exact: true })
  const overview = side.getByRole("region", { name: "Task overview", exact: true })

  await expect(running.getByText("1", { exact: true })).toBeVisible()
  await expect(completed.getByText("0", { exact: true })).toBeVisible()
  await completed.click()
  await expect(completed).toHaveAttribute("aria-pressed", "true")
  await expect(taskButton).toHaveCount(0)
  await running.click()
  await expect(running).toHaveAttribute("aria-pressed", "true")
  await expect(taskButton).toHaveCount(1)
  await taskButton.click()
  await expect(overview.getByRole("heading", { name: taskTitle, exact: true })).toBeVisible()
  await overview.getByRole("button", { name: "All tasks", exact: true }).click()
  await expect(running).toHaveAttribute("aria-pressed", "true")
  await expect(taskButton).toHaveCount(1)
  await taskButton.click()
  await overview.getByRole("button", { name: "Task details", exact: true }).click()
  await expect(dispatch.getByText("Exact saved dispatch prompt", { exact: true })).toBeVisible()
  await expect(dispatch.getByText("Complete durable Task result\nSecond result line", { exact: true })).toBeVisible()
  await expect(dispatch).toContainText("Awaiting source Task update")
  const consumption = dispatch.getByRole("region", { name: "Recorded model consumption", exact: true })
  await expect(
    consumption.getByText("No model consumption is recorded for this result.", { exact: true }),
  ).toBeVisible()

  const consumers = [
    {
      consumerSessionID: sourceID,
      assistantMessageID: "msg_mp03_consuming_step",
      eventID: "evt_mp03_consuming_step",
      resultDigest: "b".repeat(64),
    },
  ]

  const persisted = operations[0]

  if (!persisted) throw new Error("The saved Task operation fixture is missing")
  Object.assign(persisted, { consumers, sourceSettlement: "settled", updatedAt: 4 })
  await transport.send({
    id: "evt_mp03_operation_consumer",
    type: "task.operation.changed",
    created: 4,
    location: { directory },
    durable: { aggregateID: sourceID, seq: 3, version: 1 },
    data: { sessionID: sourceID, operationID, change: { consumers } },
  })
  await expect(dispatch).toContainText("Source Task updated")
  await expect(consumption.getByText("No model consumption is recorded for this result.", { exact: true })).toHaveCount(
    0,
  )
  await expect(consumption.getByText(sourceID, { exact: true })).toBeVisible()
  await expect(consumption.getByText("msg_mp03_consuming_step", { exact: true })).toBeVisible()
  await expect(consumption.getByText("evt_mp03_consuming_step", { exact: true })).toBeVisible()
  await expect(consumption.getByText("b".repeat(64), { exact: true })).toBeVisible()
  await expect(consumption.getByRole("button", { name: "Open consuming model step", exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath("meta-task-details.png"), fullPage: true })
  await expect(dispatch.getByRole("button", { name: "Read result text", exact: true })).toHaveCount(0)
  expect(reads).not.toContain(targetID)
  await details.getByRole("button", { name: "Back to collaborations", exact: true }).click()
  await expect(overview.getByRole("heading", { name: taskTitle, exact: true })).toBeVisible()
  await overview.getByRole("button", { name: "All tasks", exact: true }).click()
  await expect(running).toHaveAttribute("aria-pressed", "true")
  await expect(running.getByText("1", { exact: true })).toBeVisible()
  await expect(completed.getByText("0", { exact: true })).toBeVisible()
  await expect(taskButton).toHaveCount(1)

  const currentTask = tasks[0]

  if (!currentTask) throw new Error("The saved Task fixture is missing")
  tasks[0] = new SessionTask.Info({
    ...currentTask,
    status: "completed",
    outputDigest: persisted.result?.text,
    revision: currentTask.revision + 1,
    updatedAt: 5,
  })
  const taskUpdated = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === `/session/${sourceID}/task`,
  )

  await transport.send({
    id: "evt_mp03_task_completed",
    created: 5,
    type: SessionTaskEvent.Updated.type,
    location: { directory },
    data: {
      sessionID: sourceID,
      tasks: tasks.map((task) => ({ ...task, dependsOn: task.dependsOn && [...task.dependsOn] })),
    },
  })
  expect((await taskUpdated).status()).toBe(200)
  await expect(running.getByText("0", { exact: true })).toBeVisible()
  await expect(completed.getByText("1", { exact: true })).toBeVisible()
  await expect(taskButton).toHaveCount(0)
  await completed.click()
  await expect(completed).toHaveAttribute("aria-pressed", "true")
  await expect(taskButton).toHaveCount(1)
  await expect(taskList.getByText("Completed", { exact: true })).toBeVisible()

  const notice = page
    .locator('[data-slot="session-chat-panel"] [data-slot="session-timeline-coordination"]')
    .filter({ hasText: "Task request" })

  await notice.getByRole("button", { name: "View Task details", exact: true }).click()
  await expect(dispatch.getByText("Exact saved dispatch prompt", { exact: true })).toBeVisible()
  await expect(dispatch).toContainText("msg_mp03_other_input")
  await expect(dispatch).toContainText("evt_mp03_task_result")
  expect(reads).not.toContain(targetID)
  expect(writes).toEqual([])
  await expect(page).toHaveURL(sessionHref(sourceID))
})

test("task dock reloads durable rows after SSH sign-in replaces the client", async ({ page }) => {
  const directory = "/home/box/task-owner"
  const sessionID = "ses_task_ssh_owner"
  const title = "Task SSH owner"
  const path = `/session/${sessionID}/task`
  const writes: string[] = []

  const first = new SessionTask.Info({
    id: "tsk_ssh_owner",
    sessionID,
    content: "Task read by the original SSH client",
    status: "pending",
    priority: "medium",
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  })

  const next = new SessionTask.Info({
    ...first,
    content: "Task read by the replacement SSH client",
    status: "in_progress",
    revision: 2,
    updatedAt: 2,
  })

  const records = [first]

  const config = {
    directory,
    project: project({ id: "proj_task_ssh_owner", directory }),
    provider: provider(),
    sessions: [session({ id: sessionID, title, directory })],
    pageMessages: () => ({ items: [] }),
    tasks: records,
  }

  page.on("request", (request) => {
    if (new URL(request.url()).origin !== REMOTE_SERVER || new URL(request.url()).pathname !== path) return

    if (request.method() === "GET" || request.method() === "OPTIONS") return
    writes.push(request.method())
  })
  await mockServers(page, {
    [SERVER]: { ...config, sessions: [] },
    [REMOTE_SERVER]: config,
  })

  const initial = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === path &&
      response.request().headers()["authorization"] === "Basic " + btoa("aigcfroge:ssh-1"),
  )

  await page.goto(
    "/e2e/utils/settings-wsl.html?" +
      new URLSearchParams({
        server: SERVER,
        mode: "ready",
        ssh: REMOTE_SERVER,
        path: sessionHref(sessionID, "ssh:box"),
      }),
  )
  await expectSessionTitle(page, title)
  expect((await initial).status()).toBe(200)
  const dock = page.locator('[data-component="session-todo-dock"]')
  await expect(dock.getByRole("listitem", { name: `Task: ${first.content}`, exact: true })).toBeVisible()

  const reread = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === path &&
      new URL(response.url()).searchParams.get("directory") === directory &&
      response.request().headers()["authorization"] === "Basic " + btoa("aigcfroge:ssh-2"),
  )

  records.splice(0, records.length, next)
  await page.getByRole("button", { name: "Require SSH sign-in", exact: true }).click()
  await expect(page.getByLabel("SSH connects")).toHaveText("1")
  await expectSessionTitle(page, title)
  const response = await reread
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject([{ id: next.id, sessionID, revision: 2, content: next.content }])
  await expect(dock.getByRole("listitem", { name: `Task: ${next.content}`, exact: true })).toBeVisible()
  await expect(dock.getByText("In progress", { exact: true })).toBeVisible()
  await expect(dock.getByText(first.content, { exact: true })).toHaveCount(0)
  await expect(dock.getByRole("listitem")).toHaveCount(1)
  expect(writes).toEqual([])
})

test("Goal dock preserves edits, confirms exact evidence and cancels without rewriting independent tasks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const id = "ses_goal_dock_lifecycle"
  const goalID = "gol_goal_dock_lifecycle"
  const location = "C:/AigcForge/GoalDock"
  const count = { steps: 0, attempts: 0, recordedTokens: 0, sharedTokens: 0, unknownAttempts: 0, pendingAttempts: 0 }

  const initial: SessionGoalInfo = {
    id: goalID,
    sessionID: id,
    metaAgentID: "mag_goal_dock",
    agent: "meta",
    selection: { agent: "meta", event: { id: "evt_goal_dock_agent", seq: 1 } },
    objective: "Finish homepage mode inheritance",
    conditions: [
      { id: "check", kind: "command_result", command: "bun typecheck", cwd: location, exit: 0, outputIncludes: [] },
      { id: "acceptance", kind: "human_acceptance", description: "Accept the saved result" },
    ],
    taskRefs: [],
    revision: 1,
    status: "active",
    revisionCreatedAt: 1,
    pauseVersion: 0,
    budget: { rounds: 4 },
    rounds: [],
    attempts: [],
    evidence: [
      {
        id: "evidence_goal_dock_check",
        conditionID: "check",
        kind: "command_result",
        revision: 1,
        acceptedRevisions: [1, 2],
        recordedAt: 2,
        producer: {
          eventID: "evt_goal_dock_check",
          sessionID: id,
          assistantMessageID: "msg_goal_dock_check",
          toolCallID: "call_goal_dock_check",
        },
        result: {
          id: "sh_goal_dock_check",
          command: "bun typecheck",
          cwd: location,
          exit: 0,
          timeout: false,
          truncated: false,
          outputDigest: "c".repeat(64),
          started: 1,
          completed: 2,
        },
        outputIncludes: [],
      },
    ],
    currentEvidenceIDs: ["evidence_goal_dock_check"],
    evidenceSetDigest: "a".repeat(64),
    satisfiedConditionIDs: ["check"],
    activeMilliseconds: 0,
    accounting: {
      rounds: 0,
      activeMilliseconds: 0,
      coordinator: { ...count },
      worker: { ...count },
      compaction: { ...count },
      auxiliary: { ...count },
    },
    createdAt: 1,
    updatedAt: 2,
  }

  const goals = [initial]
  const mutations: MockGoalMutation[] = []
  const taskWrites: string[] = []
  const executions: string[] = []
  const fault = { edit: true }
  const identityReload = { hold: false, released: Promise.withResolvers<void>() }

  const identity: NonNullable<WorkspaceInput["identities"]>[string] = {
    sessionID: id,
    location: { directory: location },
    projectID: "proj_goal_dock",
    mode: "work",
    agent: "meta",
    model: { status: "missing" },
    permission: { declaredTier: "propose", effect: "ask" },
    capability: { health: "degraded", reasons: [] },
    detail: { status: "missing", reason: "mode-detail-not-projected" },
    coordination: { available: true, reasons: [], selection: initial.selection },
  }

  const transport = await installSseTransport(page, { server: SERVER })
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(prompt|interrupt)$/.test(new URL(request.url()).pathname))
      executions.push(request.url())
  })
  await mockWorkspace(page, {
    name: "GoalDock",
    directory: location,
    project: { id: identity.projectID },
    goals,
    identities: { [id]: identity },
    onIdentityRead: async (sessionID) => {
      if (sessionID === id && identityReload.hold) await identityReload.released.promise
    },
    sessions: [
      {
        id,
        title: "Goal lifecycle",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: initial.metaAgentID, rootSessionID: id },
      },
    ],
    tasks: [
      new SessionTask.Info({
        id: "tsk_goal_independent",
        sessionID: id,
        content: "Keep the independent task",
        status: "in_progress",
        priority: "medium",
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    ],
    onTaskMutation: (input) => void taskWrites.push(input.action),
    onGoalMutation(input) {
      mutations.push(input)

      if (input.action === "edit" && fault.edit)
        return new ConflictError({ resource: input.goalID, message: "Goal revision changed" })

      if (input.action === "set") return new InvalidRequestError({ message: "Goal creation is not used by the dock" })
      const goal = goals.find((goal) => goal.id === input.goalID)

      if (!goal) return new InvalidRequestError({ message: "Goal not found" })

      if (input.action === "edit") Object.assign(goal, { objective: input.body.objective, revision: 2 })

      if (input.action === "pause") Object.assign(goal, { status: "paused", pauseReason: "user" })

      if (input.action === "resume") Object.assign(goal, { status: "active", pauseReason: undefined })

      if (input.action === "confirm")
        Object.assign(goal, { status: "completed", satisfiedConditionIDs: ["check", "acceptance"] })

      if (input.action === "cancel") Object.assign(goal, { status: "cancelled" })
      goal.updatedAt += 1

      return goal
    },
  })
  await page.goto(sessionHref(id))
  await expectSessionTitle(page, "Goal lifecycle")
  await transport.waitForConnection()
  const composer = page.locator('[data-component="composer-editor"]')
  await expect(composer).toBeEditable()
  await composer.fill("Keep this unsent message while changing the Goal.")
  const dock = page.getByRole("region", { name: "Current Goal", exact: true })
  await expect(dock.getByText(initial.objective, { exact: true })).toBeVisible()
  await expect(dock.getByRole("progressbar", { name: "Acceptance progress" })).toHaveAttribute("aria-valuenow", "1")
  await expect(dock.getByRole("progressbar", { name: "Acceptance progress" })).toHaveAttribute("aria-valuemax", "2")
  expect(mutations).toEqual([])
  const editGoal = dock.getByRole("button", { name: "Edit Goal", exact: true })
  await expect(editGoal).toBeEnabled()
  identityReload.hold = true
  await transport.send({
    id: "evt_goal_dock_permission_replied",
    created: 3,
    type: "permission.replied",
    location: { directory: location },
    data: { sessionID: id, requestID: "per_goal_dock_identity", reply: "once" },
  })
  await expect(editGoal).toBeDisabled()
  identityReload.released.resolve()
  await expect(editGoal).toBeEnabled()
  await editGoal.click()
  await dock
    .getByRole("textbox", { name: "Goal objective", exact: true })
    .fill("Include titlebar and shortcut creation")
  await dock.getByRole("button", { name: "Save", exact: true }).click()
  await expect(dock.getByRole("alert")).toContainText("Goal revision changed")
  await expect(dock.getByRole("textbox", { name: "Goal objective", exact: true })).toHaveValue(
    "Include titlebar and shortcut creation",
  )
  expect(mutations).toEqual([
    {
      action: "edit",
      sessionID: id,
      goalID,
      body: { objective: "Include titlebar and shortcut creation", expectedRevision: 1 },
    },
  ])
  fault.edit = false
  await dock.getByRole("button", { name: "Save", exact: true }).click()
  await expect(dock.getByText("Include titlebar and shortcut creation", { exact: true })).toBeVisible()
  expect(goals[0]?.conditions).toEqual(initial.conditions)
  expect(goals[0]?.budget).toEqual({ rounds: 4 })
  await dock.getByRole("button", { name: "Pause Goal", exact: true }).click()
  await expect(dock.getByRole("status")).toHaveText("Paused")
  await dock.getByRole("button", { name: "Resume Goal", exact: true }).click()
  await expect(dock.getByRole("status")).toHaveText("In progress")
  await dock.getByRole("button", { name: "Accept result", exact: true }).click()
  await expect(dock.getByRole("status")).toHaveText("Completed")
  expect(mutations.at(-1)).toEqual({
    action: "confirm",
    sessionID: id,
    goalID,
    body: { expectedRevision: 2, evidenceIDs: ["evidence_goal_dock_check"], evidenceSetDigest: "a".repeat(64) },
  })
  await expect(dock.getByRole("button", { name: "Edit Goal", exact: true })).toHaveCount(0)

  const next: SessionGoalInfo = {
    ...initial,
    id: "gol_goal_dock_next",
    objective: "The next Goal",
    status: "active",
    revision: 1,
    satisfiedConditionIDs: ["check"],
    createdAt: 4,
    updatedAt: 4,
  }

  goals.push(next)
  await transport.send({
    id: "evt_goal_dock_next",
    created: 4,
    type: "session.goal.updated",
    location: { directory: location },
    data: { sessionID: id, goal: next },
  })
  await expect(dock.getByText(next.objective, { exact: true })).toBeVisible()
  await dock.getByRole("button", { name: "Cancel Goal", exact: true }).click()
  await expect(dock.getByRole("status")).toHaveText("Cancelled")
  await expect(dock.getByText(next.objective, { exact: true })).toBeVisible()
  expect(mutations.at(-1)).toEqual({ action: "cancel", sessionID: id, goalID: next.id, body: { expectedRevision: 1 } })
  await expect(page.getByRole("listitem", { name: "Task: Keep the independent task", exact: true })).toContainText(
    "In progress",
  )
  await expect(composer).toHaveText("Keep this unsent message while changing the Goal.")
  expect(taskWrites).toEqual([])
  expect(executions).toEqual([])
})

test("Goal dock keeps a late edit acknowledgement in its original server and Session", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const id = "ses_goal_dock_shared"
  const count = { steps: 0, attempts: 0, recordedTokens: 0, sharedTokens: 0, unknownAttempts: 0, pendingAttempts: 0 }

  const initial: SessionGoalInfo = {
    id: "gol_goal_dock_shared",
    sessionID: id,
    metaAgentID: "mag_goal_dock_shared",
    agent: "meta",
    selection: { agent: "meta", event: { id: "evt_goal_dock_shared_agent", seq: 1 } },
    objective: "Local Goal objective",
    conditions: [{ id: "acceptance", kind: "human_acceptance", description: "Accept the result" }],
    taskRefs: [],
    revision: 1,
    status: "active",
    revisionCreatedAt: 1,
    pauseVersion: 0,
    budget: {},
    rounds: [],
    attempts: [],
    evidence: [],
    currentEvidenceIDs: [],
    evidenceSetDigest: "b".repeat(64),
    satisfiedConditionIDs: [],
    activeMilliseconds: 0,
    accounting: {
      rounds: 0,
      activeMilliseconds: 0,
      coordinator: { ...count },
      worker: { ...count },
      compaction: { ...count },
      auxiliary: { ...count },
    },
    createdAt: 1,
    updatedAt: 1,
  }

  const localGoals = [initial]
  const remoteGoal: SessionGoalInfo = { ...initial, objective: "Remote Goal objective" }
  const localDirectory = "C:/AigcForge/GoalOwner"
  const remoteDirectory = "/home/goal-owner"

  const localSession = session({
    id,
    title: "Local Goal owner",
    directory: localDirectory,
    mode: "work",
    agent: "meta",
    controller: { kind: "root", metaAgentID: initial.metaAgentID, rootSessionID: id },
  })

  const held = Promise.withResolvers<SessionGoalInfo>()
  const reconnectHeld = Promise.withResolvers<SessionGoalInfo>()
  const replacementHeld = Promise.withResolvers<SessionGoalInfo | ConflictError>()
  const transport = await installSseTransport(page, { server: SERVER, retry: 20 })
  const mutations: MockGoalMutation[] = []

  const identity = (directory: string, projectID: string): NonNullable<WorkspaceInput["identities"]>[string] => ({
    sessionID: id,
    location: { directory },
    projectID,
    mode: "work",
    agent: "meta",
    model: { status: "missing" },
    permission: { declaredTier: "propose", effect: "ask" },
    capability: { health: "degraded", reasons: [] },
    detail: { status: "missing", reason: "mode-detail-not-projected" },
    coordination: { available: true, reasons: [], selection: initial.selection },
  })

  await mockServers(page, {
    [SERVER]: {
      directory: localDirectory,
      project: project({ id: "proj_goal_owner_local", directory: localDirectory }),
      provider: provider(),
      sessions: [localSession],
      identities: { [id]: identity(localDirectory, "proj_goal_owner_local") },
      goals: localGoals,
      pageMessages: () => ({ items: [] }),
      onGoalMutation(input) {
        mutations.push(input)

        if (mutations.length === 1) return held.promise

        if (mutations.length === 2) return reconnectHeld.promise

        return replacementHeld.promise
      },
    },
    [REMOTE_SERVER]: {
      directory: remoteDirectory,
      project: project({ id: "proj_goal_owner_remote", directory: remoteDirectory }),
      provider: provider(),
      sessions: [
        session({
          id,
          title: "Remote Goal owner",
          directory: remoteDirectory,
          mode: "work",
          agent: "meta",
          controller: { kind: "root", metaAgentID: remoteGoal.metaAgentID, rootSessionID: id },
        }),
      ],
      identities: { [id]: identity(remoteDirectory, "proj_goal_owner_remote") },
      goals: [remoteGoal],
      pageMessages: () => ({ items: [] }),
    },
  })
  await seed(page, { servers: [REMOTE_SERVER], tabs: [id, { session: id, server: REMOTE_SERVER }] })
  await page.goto(sessionHref(id))
  await expectSessionTitle(page, "Local Goal owner")
  const dock = page.getByRole("region", { name: "Current Goal", exact: true })
  await expect(dock.getByText(initial.objective, { exact: true })).toBeVisible()
  await dock.getByRole("button", { name: "Edit Goal", exact: true }).click()
  await dock.getByRole("textbox", { name: "Goal objective", exact: true }).fill("Local edit returns after navigation")
  await dock.getByRole("button", { name: "Save", exact: true }).click()
  await expect.poll(() => mutations.length).toBe(1)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(id, REMOTE_SERVER)}"]`).click()
  await expectSessionTitle(page, "Remote Goal owner")
  await expect(dock.getByText(remoteGoal.objective, { exact: true })).toBeVisible()

  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).origin === SERVER &&
      new URL(response.url()).pathname === `/api/session/${id}/goal/${initial.id}`,
  )

  const accepted: SessionGoalInfo = {
    ...initial,
    objective: "Local edit returns after navigation",
    revision: 2,
    updatedAt: 2,
  }

  localGoals.splice(0, localGoals.length, accepted)
  held.resolve(accepted)
  expect((await response).status()).toBe(200)
  await expect(dock.getByText(remoteGoal.objective, { exact: true })).toBeVisible()
  await expect(dock.getByText(accepted.objective, { exact: true })).toHaveCount(0)
  await expect(dock.getByRole("button", { name: "Edit Goal", exact: true })).toBeEnabled()
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(id)}"]`).click()
  await expectSessionTitle(page, "Local Goal owner")
  await expect(dock.getByText(accepted.objective, { exact: true })).toBeVisible()
  expect(mutations).toEqual([
    { action: "edit", sessionID: id, goalID: initial.id, body: { objective: accepted.objective, expectedRevision: 1 } },
  ])

  const connection = await transport.waitForConnection()
  const objective = dock.getByRole("textbox", { name: "Goal objective", exact: true })
  const save = dock.getByRole("button", { name: "Save", exact: true })
  await dock.getByRole("button", { name: "Edit Goal", exact: true }).click()
  await objective.fill("Keep this draft across reconnect")
  await save.click()
  await expect.poll(() => mutations.length).toBe(2)
  await expect(save).toBeDisabled()
  await transport.disconnect()
  await transport.waitForConnection({ after: connection.id })
  await expect(objective).toHaveValue("Keep this draft across reconnect")
  await expect(save).toBeEnabled()

  await objective.fill("Preserve the new owner draft")
  await save.click()
  await expect.poll(() => mutations.length).toBe(3)
  await expect(save).toBeDisabled()
  localSession.title = "Local Goal owner after metadata refresh"

  const metadataResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === SERVER &&
      new URL(response.url()).pathname === `/api/session/${id}`,
  )

  await transport.send({
    id: "evt_goal_dock_metadata_refresh",
    created: 4,
    type: "session.viewed",
    durable: { aggregateID: id, seq: 1, version: 1 },
    data: { sessionID: id, idle: 4 },
  })
  expect((await metadataResponse).status()).toBe(200)
  await expectSessionTitle(page, localSession.title)
  await expect(objective).toHaveValue("Preserve the new owner draft")
  await expect(save).toBeDisabled()

  const oldResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).origin === SERVER &&
      response.request().postData()?.includes("Keep this draft across reconnect") === true,
  )

  const oldAcknowledgement: SessionGoalInfo = {
    ...accepted,
    objective: "Keep this draft across reconnect",
    status: "paused",
    pauseReason: "user",
    revision: 3,
    updatedAt: 3,
  }

  localGoals.splice(0, localGoals.length, oldAcknowledgement)
  reconnectHeld.resolve(oldAcknowledgement)
  expect((await oldResponse).status()).toBe(200)
  // The status proves Client Data consumed the old acknowledgement before checking the new operation's busy state.
  await expect(dock.getByRole("status")).toHaveText("Paused")
  await expect(objective).toHaveValue("Preserve the new owner draft")
  await expect(save).toBeDisabled()

  replacementHeld.resolve(new ConflictError({ resource: initial.id, message: "Review the new Goal revision" }))
  await expect(dock.getByRole("alert")).toContainText("Review the new Goal revision")
  await expect(objective).toHaveValue("Preserve the new owner draft")
  await expect(save).toBeEnabled()
  expect(mutations.slice(1)).toEqual([
    {
      action: "edit",
      sessionID: id,
      goalID: initial.id,
      body: { objective: "Keep this draft across reconnect", expectedRevision: 2 },
    },
    {
      action: "edit",
      sessionID: id,
      goalID: initial.id,
      body: { objective: "Preserve the new owner draft", expectedRevision: 2 },
    },
  ])
})

function mockServer(page: Page, requests: Pick<WorkspaceInput, "sessionPermissions" | "onPermissionReply" | "forms">) {
  return mockWorkspace(page, { name: "RequestDocks", directory, sessions: [{ id: sessionID, title }], ...requests })
}
