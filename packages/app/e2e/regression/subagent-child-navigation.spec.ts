import type { AigcForgeEvent, PermissionRequest, SessionMessageInfo } from "@aigcfroge/client/promise"
import { timelinePresets } from "@aigcfroge/session-ui/timeline/detail"
import { expect, test, type Locator, type Page } from "@playwright/test"
import { expectPath, SERVER, sessionHref } from "../utils/app"
import { currentSession, type MockCommunicationMutation } from "../utils/mock-server"
import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import { assistantMessage, session, sessionID, setupTimeline, textPart, toolPart, userMessage } from "../utils/timeline"
import { expectSessionTitle } from "../utils/waits"
import { mockWorkspace, type WorkspaceInput } from "../utils/workspace"
import { openSidePanel } from "../utils/side-panel"

const directory = "C:/AigcForge/SubagentNavigation"

const projectID = "proj_subagentnavigation"

const serverPort = new URL(SERVER).port

const parentID = "ses_subagent_parent"

const childID = "ses_subagent_child"

const grandchildID = "ses_subagent_grandchild"

const greatGrandchildID = "ses_subagent_great_grandchild"

const parentTitle = "Parent session"

const childTitle = "Subagent child session"

const grandchildTitle = "Nested subagent session"

const greatGrandchildTitle =
  "Deep research subagent session investigating a very long chain of agent registry failures and navigation breadcrumbs"

// Child session pages derive their heading from the task part that spawned them.
const taskDescription = "Inspect child navigation"

test.use({ viewport: { width: 1440, height: 900 } })

test("navigates to a subagent child session missing from the session list", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)

  await expectSessionTitle(page, taskDescription)
  await expect(page.getByRole("heading", { name: parentTitle })).toHaveCount(0)

  await expect(page.getByRole("button", { name: "Toggle review", exact: true })).toBeVisible()

  // Escape returns to the parent session.
  await page.keyboard.press("Escape")
  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)])
})

test("SC03 views a real child beside its parent, reuses the view, and closes without execution", async ({
  page,
}, testInfo) => {
  const childResponse = "SC03 original child response: the delegated history stays on its own Session."
  const parentDraft = "SC03 parent draft remains with the parent."
  const childUserID = "msg_sc03_readonly_child_user"
  const resource = "src/sc03-readonly-child.ts"
  const permissions: PermissionRequest[] = []
  const executionRequests: string[] = []

  const sideRoots = [
    {
      id: "ses_sc03_narrow_b",
      title: "SC03 narrow root B",
      response: "SC03 root B keeps its own saved timeline.",
      beforePanel: "Open file",
    },
    {
      id: "ses_sc03_narrow_c",
      title: "SC03 narrow root C",
      response: "SC03 root C keeps its own saved timeline.",
      beforePanel: "Task delegation",
    },
  ] as const

  const rootMessages = new Map<string, SessionMessageInfo[]>(
    sideRoots.map((root) => {
      const history: SessionMessageInfo[] = [
        userMessage([{ id: `prt_${root.id}_user`, type: "text", text: `Inspect ${root.title}.` }], {
          id: `msg_${root.id}_user`,
        }),
        assistantMessage([{ id: `prt_${root.id}_response`, type: "text", text: root.response }], {
          id: `msg_${root.id}_response`,
          parentID: `msg_${root.id}_user`,
        }),
      ]

      return [root.id, history] as const
    }),
  )

  page.on("request", (request) => {
    const url = new URL(request.url())

    if (request.method() !== "POST" || url.port !== serverPort) return

    if (url.pathname === "/api/session" || /^\/api\/session\/[^/]+\/(prompt|interrupt)$/.test(url.pathname))
      executionRequests.push(url.pathname)
  })

  const messages: SessionMessageInfo[] = [
    userMessage([{ id: "prt_sc03_readonly_child_user", type: "text", text: "Inspect the child timeline." }], {
      id: childUserID,
    }),
    assistantMessage([{ id: "prt_sc03_readonly_child_response", type: "text", text: childResponse }], {
      id: "msg_sc03_readonly_child_response",
      parentID: childUserID,
    }),
  ]

  const workspace = await setup(page, undefined, 0, {
    sessions: [
      { id: parentID, title: parentTitle, created: 1700000000000 },
      { id: childID, title: childTitle, created: 1700000001000, parentID },
      ...sideRoots.map((root) => ({ id: root.id, title: root.title, created: 1700000000000 })),
    ],
    seed: { tabs: [parentID, ...sideRoots.map((root) => root.id)] },
    pageMessages: (sessionID) => ({
      items:
        sessionID === parentID
          ? parentMessages()
          : sessionID === childID
            ? messages
            : (rootMessages.get(sessionID) ?? []),
    }),
    permissions: () => permissions,
    sessionPermissions: { [childID]: permissions },
  })

  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()
  await editor.fill(parentDraft)
  await openSidePanel(page, "Subagents")

  const collaboration = page.locator('[data-component="session-delegation-panel"]')
  const child = collaboration.getByRole("article", { name: `Subagent: ${childID}`, exact: true })
  await expect(child).toBeVisible()
  await expect(child.getByRole("button", { name: childTitle, exact: true })).toBeVisible()
  await child.getByRole("button", { name: childTitle, exact: true }).click()

  const view = page.locator('[data-component="session-content-panel"]')
  const viewTabs = page.locator("#session-side-panel-subagents-tab")
  await expect(view).toBeVisible()
  await expect(view.getByText(childResponse, { exact: true })).toBeVisible()
  await expect(
    view
      .locator('[data-slot="session-content-metadata"]')
      .getByRole("button", { name: "Execution details", exact: true }),
  ).toHaveAttribute("aria-expanded", "false")
  await expectSessionMetadata(view, childID)
  await expect(view.getByText("Read only", { exact: true })).toHaveCount(0)
  await expect(view.locator('[data-component="composer-editor"]')).toHaveCount(0)
  await expect(view.getByRole("textbox")).toHaveCount(0)
  await expect(view.locator('[data-slot="session-title-ancestors"]')).toHaveCount(0)
  await expect(view.getByRole("heading", { name: childTitle, exact: true })).toHaveCount(1)
  await expect(page.locator('[data-component="composer-editor"]')).toHaveCount(1)
  await expect(editor).toHaveText(parentDraft)
  await expect(page).toHaveURL(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await expect(viewTabs).toHaveCount(1)
  const firstTabID = await viewTabs.getAttribute("id")

  if (!firstTabID) throw new Error("The child view tab has no DOM id.")

  await view.getByRole("button", { name: "Back to subagents", exact: true }).click()
  await expect(child.getByRole("button", { name: childTitle, exact: true })).toBeVisible()
  await child.getByRole("button", { name: childTitle, exact: true }).click()
  await expect(view).toBeVisible()
  await expect(view.getByText(childResponse, { exact: true })).toBeVisible()
  await expect(viewTabs).toHaveCount(1)
  await expect(viewTabs).toHaveAttribute("id", firstTabID)
  await expect(view).toHaveCount(1)

  const permission: PermissionRequest = {
    id: "per_sc03_readonly_child",
    sessionID: childID,
    action: "read",
    resources: [resource],
  }

  permissions.push(permission)
  await workspace.push([
    {
      id: "evt_sc03_readonly_child_permission",
      created: 1700000003000,
      type: "permission.asked",
      location: { directory: workspace.directory },
      data: permission,
    },
  ])
  const response = page.locator('[data-slot="permission-footer-actions"]')
  await expect(response).toHaveCount(1)
  await expect(response).toBeVisible()
  await expect(page.getByText(resource, { exact: true })).toBeVisible()
  await expect(view.locator('[data-slot="permission-footer-actions"]')).toHaveCount(0)
  await expect(view.locator('[data-component="composer-editor"]')).toHaveCount(0)
  expect(executionRequests).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("sc03-child-view-readonly.png"), fullPage: true })

  await viewTabs.hover()
  await viewTabs.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(viewTabs).toHaveCount(0)
  await expect(view).toHaveCount(0)
  await expect(page).toHaveURL(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await expect(editor).toHaveCount(0)
  await expect(response).toHaveCount(1)
  expect(executionRequests).toEqual([])

  permissions.splice(0)
  await workspace.push([
    {
      id: "evt_sc03_readonly_child_permission_done",
      created: 1700000004000,
      type: "permission.replied",
      location: { directory: workspace.directory },
      data: { sessionID: childID, requestID: permission.id, reply: "once" },
    },
  ])
  await expect(response).toHaveCount(0)
  await expect(editor).toHaveText(parentDraft)

  await openSidePanel(page, "Subagents")
  await child
    .locator('[data-slot="subagent-call-records"]')
    .getByRole("button", { name: "Execution details", exact: true })
    .click()
  await child.getByRole("button", { name: "Open as main session", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(childID))
  await expectSessionTitle(page, taskDescription)
  await expect(page.getByText(childResponse, { exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="session-title-parent"]')).toHaveText(parentTitle)
  await page.locator('[data-slot="session-title-parent"]').click()
  await expect(page).toHaveURL(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await expect(editor).toHaveText(parentDraft)
  expect(executionRequests).toEqual([])

  await test.step("narrow Session views selects existing B and C bindings after a different panel was selected", async () => {
    const rootViewTabs = page.locator('#review-panel [role="tab"][id^="session-side-panel-view-tab-"]')

    for (const root of sideRoots) {
      await openSidePanel(page, "Task delegation")
      await expect(collaboration.getByRole("heading", { name: root.title, exact: true })).toHaveCount(0)
      await collaboration.getByRole("button", { name: "Attach session", exact: true }).click()
      const chooser = page.getByRole("dialog", { name: "Open sessions", exact: true })
      await expect(chooser.getByRole("button", { name: root.title, exact: true })).toBeVisible()
      await chooser.getByRole("button", { name: root.title, exact: true }).click()
      await expect(chooser).toHaveCount(0)
      const content = page.getByRole("region", { name: "Session views", exact: true })
      await expect(content.getByText(root.response, { exact: true })).toBeVisible()
      await expectSessionMetadata(content, root.id)
      await expect(page).toHaveURL(sessionHref(parentID))
    }

    await expect(rootViewTabs).toHaveCount(sideRoots.length)

    for (const root of sideRoots) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await openSidePanel(page, root.beforePanel)
      await page.setViewportSize({ width: 390, height: 844 })
      await openSidePanel(page, "Session views")

      const content = page.getByRole("region", { name: "Session views", exact: true })
      const picker = content.locator('[data-slot="session-content-picker"]')
      await expect(picker).toBeVisible()
      await expect(picker.getByRole("article")).toHaveCount(sideRoots.length)

      for (const saved of sideRoots)
        await expect(picker.getByRole("article", { name: `Session: ${saved.id}`, exact: true })).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath(
          root.beforePanel === "Open file"
            ? "sc03-saved-views-files-narrow.png"
            : "sc03-saved-views-collaborations-narrow.png",
        ),
        fullPage: true,
      })
      await picker
        .getByRole("article", { name: `Session: ${root.id}`, exact: true })
        .getByRole("button", { name: "Open view", exact: true })
        .click()
      await expectSessionMetadata(content, root.id)
      await expect(content.getByText(root.response, { exact: true })).toBeVisible()
      await expect(picker).toHaveCount(0)
      await expect(page).toHaveURL(sessionHref(parentID))
    }
  })

  await test.step("narrow View session and Attach session open their target content directly", async () => {
    await openSidePanel(page, "Subagents")
    await child.getByRole("button", { name: childTitle, exact: true }).click()
    const content = page.getByRole("region", { name: "Session views", exact: true })
    await expect(content.getByText(childResponse, { exact: true })).toBeVisible()
    await expectSessionMetadata(content, childID)
    await expect(content.getByText("Read only", { exact: true })).toHaveCount(0)
    await expect(content.getByText("Subagent sessions cannot be prompted.", { exact: true })).toHaveCount(0)
    await expect(content.locator('[data-component="composer-editor"]')).toHaveCount(0)
    await expect(page).toHaveURL(sessionHref(parentID))
    await page.screenshot({ path: testInfo.outputPath("sc03-child-view-narrow.png"), fullPage: true })

    await content.getByRole("button", { name: "Back to subagents", exact: true }).click()
    await expect(child.getByRole("button", { name: childTitle, exact: true })).toBeVisible()
    await openSidePanel(page, "Task delegation")
    await collaboration.getByRole("button", { name: "Attach session", exact: true }).click()
    const chooser = page.getByRole("dialog", { name: "Open sessions", exact: true })
    await expect(chooser.getByRole("button", { name: sideRoots[0].title, exact: true })).toBeVisible()
    await chooser.getByRole("textbox").fill(sideRoots[0].id)
    await expect(chooser.getByRole("button", { name: sideRoots[0].title, exact: true })).toBeVisible()
    await expect(chooser.getByRole("button", { name: sideRoots[1].title, exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("sc03-root-chooser-narrow.png"), fullPage: true })
    await chooser.getByRole("button", { name: sideRoots[0].title, exact: true }).click()
    await expect(chooser).toHaveCount(0)
    await expect(content.getByText(sideRoots[0].response, { exact: true })).toBeVisible()
    await expectSessionMetadata(content, sideRoots[0].id)
    await expect(content.getByText("Interactive", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(sessionHref(parentID))
    await page.screenshot({ path: testInfo.outputPath("sc03-root-attach-narrow.png"), fullPage: true })
    expect(executionRequests).toEqual([])
  })
})

test("subagent details remain read only for a coordinating Meta parent", async ({ page }, testInfo) => {
  const directory = "C:/AigcForge/SubagentInstructions"
  const childResponse = "The child keeps its own conversation."
  const parentDraft = "Keep the parent's draft while inspecting the child."
  const requests: MockCommunicationMutation[] = []

  await mockWorkspace(page, {
    name: "SubagentInstructions",
    directory,
    sessions: [
      {
        id: parentID,
        title: parentTitle,
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_subagent_instructions", rootSessionID: parentID },
      },
      { id: childID, title: childTitle, parentID },
    ],
    identities: {
      [parentID]: {
        sessionID: parentID,
        location: { directory },
        projectID: "proj_subagentinstructions",
        mode: "coding",
        agent: "meta",
        model: { status: "missing" },
        permission: { declaredTier: "propose", effect: "ask" },
        capability: { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
        detail: { status: "missing", reason: "mode-detail-not-projected" },
        coordination: {
          available: true,
          reasons: [],
          selection: { agent: "meta", event: { id: "evt_subagent_instructions_meta", seq: 1 } },
        },
      },
    },
    pageMessages: (id) => ({
      items:
        id === parentID
          ? parentMessages()
          : [userMessage(), assistantMessage([textPart("prt_instruction_child", childResponse)])],
    }),
    seed: { tabs: [parentID] },
    onCommunicationMutation(input) {
      requests.push(input)

      return new InvalidRequestError({ message: "Inspecting a child must not send a communication" })
    },
  })
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  const editor = page.locator('[data-component="composer-editor"]')

  await editor.fill(parentDraft)
  await openSidePanel(page, "Subagents")
  const child = page.getByRole("article", { name: `Subagent: ${childID}`, exact: true })

  await child.getByRole("button", { name: childTitle, exact: true }).click()
  const view = page.getByRole("region", { name: "Session views", exact: true })

  await expect(view.getByText(childResponse, { exact: true })).toBeVisible()
  await expect(view.getByRole("heading", { name: childTitle, exact: true })).toHaveCount(1)
  await expect(view.getByRole("group", { name: "Select a session view.", exact: true })).toHaveCount(0)
  await expect(view.getByRole("textbox")).toHaveCount(0)
  await expect(view.getByRole("button", { name: "Send communication", exact: true })).toHaveCount(0)
  await expect(editor).toHaveText(parentDraft)
  await expect(page).toHaveURL(sessionHref(parentID))
  await page.screenshot({ path: testInfo.outputPath("subagent-detail-meta-readonly.png"), fullPage: true })
  await view.getByRole("button", { name: "Back to subagents", exact: true }).click()
  await expect(child.getByRole("button", { name: childTitle, exact: true })).toBeVisible()
  await child.getByRole("button", { name: childTitle, exact: true }).click()
  await expect(view.getByText(childResponse, { exact: true })).toBeVisible()
  await view.getByRole("button", { name: "Open as main session", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(childID))
  await expect(page.getByText(childResponse, { exact: true })).toBeVisible()
  expect(requests).toEqual([])
})

test("keeps the parent title anchored when opening a subagent", async ({ page }) => {
  await setup(page)

  for (const direction of ["ltr", "rtl"] as const) {
    await page.goto(sessionHref(parentID))
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    await expectSessionTitle(page, parentTitle)

    const title = page.locator("[data-session-title]").getByRole("heading", { name: parentTitle })

    await expect
      .poll(() =>
        title.evaluate((element) => {
          const range = document.createRange()

          range.selectNodeContents(element)

          return range.getBoundingClientRect().width
        }),
      )
      .toBeGreaterThan(0)
    const start = await titleInlineStart(title)

    await page.getByRole("button", { name: "Used 1 Agent", exact: true }).click()
    await page.locator(`a[href="${sessionHref(childID)}"]`).click()
    const view = page.locator('[data-component="session-content-panel"]')

    await expectSessionMetadata(view, childID)
    await expectSessionTitle(page, parentTitle)
    await view.getByRole("button", { name: "Open as main session", exact: true }).click()
    await expectSessionTitle(page, taskDescription)

    const breadcrumb = page.locator('[data-slot="session-title-parent"]')

    await expect(breadcrumb).toHaveText(parentTitle)
    await expect.poll(() => titleInlineStart(breadcrumb)).toBeCloseTo(start, 0)
    await breadcrumb.click()
    await expectSessionTitle(page, parentTitle)
    await expect
      .poll(() => titleInlineStart(page.locator("[data-session-title]").getByRole("heading", { name: parentTitle })))
      .toBeCloseTo(start, 0)
  }
})

test("views running subagent cards and nested children beside the parent", async ({ page }, testInfo) => {
  const runningChildID = "ses_running_child"
  const nestedChildID = "ses_running_nested_child"
  const unopenedChildID = "ses_running_unopened_child"
  const unopenedTitle = "Inspect unopened child"
  const childResponse = "The running child retains its own response."
  const nestedResponse = "The nested child retains a separate response."
  const unopenedResponse = "The unopened child retains its own response."
  const parentDraft = "Parent draft survives child view selection."

  const parentMessages: SessionMessageInfo[] = [
    { id: "msg_user", type: "user", text: "Run it", time: { created: 1 } },
    {
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      content: [
        {
          type: "tool",
          id: "call_subagent",
          name: "subagent",
          state: {
            status: "running",
            input: { description: "Inspect code" },
            metadata: { status: "running", sessionID: runningChildID },
          },
          time: { created: 2 },
        },
      ],
      time: { created: 2 },
    },
  ]

  const childMessages: SessionMessageInfo[] = [
    userMessage([], { id: "msg_running_child_user" }),
    assistantMessage(
      [
        textPart("prt_running_child_response", childResponse),
        {
          type: "tool",
          id: "call_nested_subagent",
          name: "subagent",
          state: {
            status: "running",
            input: { description: "Inspect nested code" },
            metadata: { status: "running", sessionID: nestedChildID },
            time: { start: 3 },
          },
        },
      ],
      { id: "msg_running_child_assistant", parentID: "msg_running_child_user" },
    ),
  ]

  await setupTimeline(page, {
    settings: { timelineDetail: { ...timelinePresets[2].value, subagents: { placement: "separate" } } },
    sessionMessages: parentMessages,
    pageMessages: (id) => ({
      items:
        id === sessionID
          ? parentMessages
          : id === runningChildID
            ? childMessages
            : id === unopenedChildID
              ? [
                  userMessage([], { id: "msg_unopened_child_user" }),
                  assistantMessage([textPart("prt_unopened_child_response", unopenedResponse)], {
                    id: "msg_unopened_child_assistant",
                    parentID: "msg_unopened_child_user",
                  }),
                ]
              : [userMessage(), assistantMessage([textPart("prt_nested_child_response", nestedResponse)])],
    }),
    sessions: [
      session(),
      session({ id: runningChildID, parentID: sessionID, title: "Sleep for 5 minutes" }),
      session({ id: unopenedChildID, parentID: sessionID, title: unopenedTitle }),
      session({ id: nestedChildID, parentID: runningChildID, title: "Inspect nested code" }),
    ],
    sessionStatus: { [sessionID]: { type: "busy" }, [runningChildID]: { type: "busy" } },
  })
  const hint = page.getByRole("button", { name: /move running work to the background/i })
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable()
  await editor.fill(parentDraft)
  await expect(hint).toBeVisible()
  const view = page.locator('[data-component="session-content-panel"]')
  const viewTabs = page.locator("#session-side-panel-subagents-tab")
  const back = view.getByRole("button", { name: "Back to subagents", exact: true })

  await openSidePanel(page, "Subagents")

  const list = page.locator('[data-component="session-delegation-panel"]')

  const runningRow = list
    .getByRole("article", { name: `Subagent: ${runningChildID}`, exact: true })
    .getByRole("button", { name: "Sleep for 5 minutes", exact: true })

  const related = page.getByRole("region", { name: "Related sessions", exact: true })
  const unopenedRow = related.getByRole("button", { name: unopenedTitle, exact: true })
  const nestedRow = related.getByRole("button", { name: "Inspect nested code", exact: true })

  await expect(unopenedRow.locator("h4")).toHaveText(unopenedTitle)
  await expect(unopenedRow).toContainText("Idle")
  await expect(unopenedRow.locator('[data-slot="subagent-row-preview"]')).toHaveText(unopenedResponse)
  await expect(runningRow.locator('[data-slot="subagent-row-preview"]')).toHaveText(childResponse)
  await expect(runningRow.locator('[data-slot="subagent-session-status"]')).toHaveText("Running")
  await expect(runningRow.locator('[data-slot="icon-svg"]')).toHaveCount(2)
  await expect(list.getByRole("heading", { name: /^(Active|Done)$/ })).toHaveCount(0)
  await expect(related.getByRole("button")).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("subagent-list-unopened-children.png"), fullPage: true })
  await unopenedRow.click()
  await expect(view.getByText(unopenedResponse, { exact: true })).toBeVisible()
  await expect(viewTabs).toHaveCount(1)
  await expect(page).toHaveURL(sessionHref(sessionID))
  await expect(back.locator('[data-slot="icon-svg"]')).toBeVisible()
  await expect(back).toHaveText("")
  await expect(view.getByRole("textbox", { name: "Supplement requirements", exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("subagent-unopened-child-detail.png"), fullPage: true })
  await back.click()
  await expect(unopenedRow).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("subagent-list-after-detail-back.png"), fullPage: true })
  await page.locator('[data-component="task-tool-card"]').click()

  await expect(view.getByText(childResponse, { exact: true })).toBeVisible()
  await expectSessionMetadata(view, runningChildID)
  await expect(view.locator('[data-component="composer-editor"]')).toHaveCount(0)
  await expect(view.getByRole("button", { name: /move running work to the background/i })).toHaveCount(0)
  await expect(editor).toHaveText(parentDraft)
  await expect(page).toHaveURL(sessionHref(sessionID))
  await expect(hint).toBeVisible()
  await expect(viewTabs).toHaveCount(1)

  await expect(view.getByRole("group", { name: "Select a session view.", exact: true })).toHaveCount(0)
  await back.click()
  await expect(nestedRow).toBeVisible()
  await expect(nestedRow.locator('[data-slot="subagent-row-preview"]')).toHaveText(nestedResponse)
  await nestedRow.click()
  await expect(view.getByText(nestedResponse, { exact: true })).toBeVisible()
  await expect(viewTabs).toHaveCount(1)
  await expect(editor).toHaveText(parentDraft)
  await back.click()
  await page
    .getByRole("article", { name: `Subagent: ${runningChildID}`, exact: true })
    .getByRole("button", { name: "Sleep for 5 minutes", exact: true })
    .click()
  await expect(view.getByText(childResponse, { exact: true })).toBeVisible()
  await view.locator('[data-component="task-tool-card"]').click()
  await expect(view.getByText(nestedResponse, { exact: true })).toBeVisible()
  await expectSessionMetadata(view, nestedChildID)
  await expect(view.getByText(childResponse, { exact: true })).toHaveCount(0)
  await expect(viewTabs).toHaveCount(1)
  await expect(editor).toHaveText(parentDraft)
  await expect(page).toHaveURL(sessionHref(sessionID))
  await expect(page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-slot]')).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("running-nested-child-side-view.png"), fullPage: true })

  await view.getByRole("button", { name: "Open as main session", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(nestedChildID))
  await expect(page.getByRole("button", { name: /move running work to the background/i })).toHaveCount(0)
})

test("shows readable subagent summaries and keeps protocol output in execution details", async ({ page }, testInfo) => {
  const backgroundID = "ses_summary_background"
  const completedID = "ses_summary_completed"
  const literalID = "ses_summary_literal"
  const backgroundTitle = "Inspect background response"
  const completedTitle = "Inspect completed response"
  const literalTitle = "Inspect literal response"
  const completedResponse = "The completed child returned a useful review."
  const completedOutput = `<subagent sessionID="${completedID}" state="completed">\n${completedResponse}\n</subagent>`

  const literalResponse =
    'The reply keeps a literal <subagent sessionID="example" state="completed">example</subagent>.'

  const backgroundOutput = (id: string) =>
    [
      `The subagent is working in the background (sessionID: ${id}). You will be notified automatically when it finishes.`,
      "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
      "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
    ].join("\n")

  const messages: SessionMessageInfo[] = [
    userMessage(),
    assistantMessage([
      toolPart(
        "call_summary_background",
        "subagent",
        "completed",
        { agent: "build", description: backgroundTitle, prompt: "Inspect the background response.", background: true },
        {
          output: backgroundOutput(backgroundID),
          metadata: { sessionID: backgroundID, status: "running" },
        },
      ),
      toolPart(
        "call_summary_completed",
        "subagent",
        "completed",
        { agent: "build", description: completedTitle, prompt: "Inspect the completed response." },
        {
          output: completedOutput,
          metadata: { sessionID: completedID, status: "completed" },
        },
      ),
      toolPart(
        "call_summary_literal",
        "subagent",
        "completed",
        { agent: "build", description: literalTitle, prompt: "Inspect the literal response.", background: true },
        {
          output: backgroundOutput(literalID),
          metadata: { sessionID: literalID, status: "running" },
        },
      ),
    ]),
  ]

  await setupTimeline(page, {
    sessionMessages: messages,
    sessions: [
      session(),
      session({ id: backgroundID, parentID: sessionID, title: backgroundTitle }),
      session({ id: completedID, parentID: sessionID, title: completedTitle }),
      session({ id: literalID, parentID: sessionID, title: literalTitle }),
    ],
    sessionStatus: {
      [sessionID]: { type: "idle" },
      [backgroundID]: { type: "idle" },
      [completedID]: { type: "busy" },
      [literalID]: { type: "idle" },
    },
    pageMessages: (id) => ({
      items:
        id === sessionID
          ? messages
          : id === literalID
            ? [
                userMessage([], { id: "msg_summary_literal_user" }),
                assistantMessage([textPart("prt_summary_literal_response", literalResponse)], {
                  id: "msg_summary_literal_response",
                  parentID: "msg_summary_literal_user",
                }),
              ]
            : [userMessage([], { id: `msg_${id}_user` })],
    }),
  })

  await openSidePanel(page, "Subagents")
  const list = page.locator('[data-component="session-delegation-panel"]')
  const background = list.getByRole("article", { name: `Subagent: ${backgroundID}`, exact: true })
  const completed = list.getByRole("article", { name: `Subagent: ${completedID}`, exact: true })
  const literal = list.getByRole("article", { name: `Subagent: ${literalID}`, exact: true })
  const backgroundRow = background.getByRole("button", { name: backgroundTitle, exact: true })
  const completedRow = completed.getByRole("button", { name: completedTitle, exact: true })
  const literalRow = literal.getByRole("button", { name: literalTitle, exact: true })

  await expect(backgroundRow).toBeEnabled()
  await expect(completedRow).toBeEnabled()
  await expect(literalRow).toBeEnabled()
  await expect(backgroundRow.locator('[data-slot="subagent-session-status"]')).toHaveText("Idle")
  await expect(completedRow.locator('[data-slot="subagent-session-status"]')).toHaveText("Running")
  await expect(backgroundRow.locator("h4")).toHaveText(backgroundTitle)
  await expect(backgroundRow.locator('[data-slot="subagent-row-preview"]')).toHaveCount(0)
  await expect(completedRow.locator('[data-slot="subagent-row-preview"]')).toHaveText(completedResponse)
  await expect(literalRow.locator('[data-slot="subagent-row-preview"]')).toHaveText(literalResponse)
  await expect(backgroundRow).not.toContainText("The subagent is working in the background")
  await expect(completedRow).not.toContainText("<subagent")
  await expect(list.getByRole("heading", { name: /^(Active|Done)$/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("subagent-readable-list.png"), fullPage: true })

  const backgroundRecords = background.locator('[data-slot="subagent-call-records"]')
  await backgroundRecords.locator(':scope > [data-slot="collapsible-trigger"]').click()
  await backgroundRecords.getByRole("button", { name: "Open original tool output", exact: true }).click()
  await expect(backgroundRecords.locator("pre")).toHaveText(backgroundOutput(backgroundID))
  await backgroundRecords.locator(':scope > [data-slot="collapsible-trigger"]').click()
  await expect(backgroundRecords.locator("pre")).not.toBeVisible()

  const completedRecords = completed.locator('[data-slot="subagent-call-records"]')
  await completedRecords.locator(':scope > [data-slot="collapsible-trigger"]').click()
  await completedRecords.getByRole("button", { name: "Open original tool output", exact: true }).click()
  await expect(completedRecords.locator("pre")).toHaveText(completedOutput)
})

test("opens a directly linked nested subagent in its root session tab", async ({ page }) => {
  await setup(page, undefined, 1)
  await page.goto(sessionHref(grandchildID), { waitUntil: "domcontentloaded" })

  await expect(page.locator('[data-slot="session-title-parent"]')).toHaveText(childTitle)
  await expect(page.locator('[data-slot="session-title-child"]')).toHaveText(grandchildTitle)
  const tabs = page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-slot]')
  await expect(tabs.locator(`a[href="${sessionHref(grandchildID)}"]`)).toHaveCount(1)
  await expect(tabs).toHaveCount(1)
  await expect(tabs.locator('[data-slot="tab-title"]')).toHaveText(parentTitle)
})

test("shows the full ancestor path and navigates to an earlier subagent", async ({ page }) => {
  await setup(page, undefined, 2)
  await page.goto(sessionHref(greatGrandchildID), { waitUntil: "domcontentloaded" })

  await expect(page.locator("[data-timeline-virtual-content]")).toBeAttached()
  const header = page.locator("[data-session-title]")
  await expect(header.locator('[data-slot="session-title-ancestor"]')).toHaveText([parentTitle, childTitle])
  await expect(header.locator('[data-slot="session-title-parent"]')).toHaveText(grandchildTitle)
  await expect(header.getByRole("heading", { name: greatGrandchildTitle })).toBeVisible()

  await header.getByRole("button", { name: childTitle, exact: true }).click()
  await expect(page).toHaveURL(sessionHref(childID))
  await expect(page.locator("[data-session-title]").getByRole("heading", { name: childTitle })).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-slot]')).toHaveCount(1)
})

test("keeps the active nested session visible in a narrow desktop header", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 })
  await setup(page, undefined, 2)
  await page.goto(sessionHref(greatGrandchildID), { waitUntil: "domcontentloaded" })

  const header = page.locator("[data-session-title]")
  const heading = header.getByRole("heading", { name: greatGrandchildTitle })
  const separator = header.locator('[data-slot="session-title-ancestors"] + [data-slot="session-title-separator"]')
  await expect(header.locator('[data-slot="session-title-ancestor"]')).toHaveText([parentTitle, childTitle])
  await expect(heading).toBeInViewport()
  await expect(separator).toBeInViewport()
  const bounds = await heading.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(820)

  await page.evaluate(() => document.documentElement.setAttribute("dir", "rtl"))
  await expect(heading).toBeInViewport()
  await expect(separator).toBeInViewport()

  const root = header.locator(`[data-slot="session-title-ancestor"][data-session-id="${parentID}"]`)
  await root.focus()
  await expect(root).toBeFocused()
  await root.press("Enter")
  await expect(page).toHaveURL(sessionHref(parentID))
})

test("shows parent lineage while the child timeline loads", async ({ page }) => {
  await setup(page)
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === `/api/session/${childID}/message` && url.port === serverPort,
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )

  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await page.getByRole("button", { name: "Used 1 Agent", exact: true }).click()
  await page.locator(`a[href="${sessionHref(childID)}"]`).click()
  const view = page.locator('[data-component="session-content-panel"]')

  await expectSessionMetadata(view, childID)
  await view.getByRole("button", { name: "Open as main session", exact: true }).click()
  await Promise.all([requested.promise, expect(page).toHaveURL(sessionHref(childID))])
  await Promise.all([
    expect(page.locator('[data-slot="session-title-parent"]')).toHaveText(parentTitle),
    expect(page.locator('[data-slot="session-title-child"]')).toHaveText(childTitle),
  ]).finally(() => release.resolve())
  await expectSessionTitle(page, taskDescription)
})

test("keeps the parent visible while the child session resolves", async ({ page }) => {
  await setup(page)
  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === `/api/session/${childID}` && url.port === serverPort,
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)

  await page.getByRole("button", { name: "Used 1 Agent", exact: true }).click()
  await page.locator(`a[href="${sessionHref(childID)}"]`).click()
  await requested.promise
  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)]).finally(
    () => release.resolve(),
  )

  const view = page.locator('[data-component="session-content-panel"]')

  await expect(view.getByRole("heading", { name: childTitle, exact: true })).toBeVisible()
  await view.getByRole("button", { name: "Open as main session", exact: true }).click()
  await expectSessionTitle(page, taskDescription)
})

test("keeps the parent tab selected while a loaded child session resolves", async ({ page }) => {
  await setup(page)
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)
  await page.goBack()
  await Promise.all([expect(page).toHaveURL(sessionHref(parentID)), expectSessionTitle(page, parentTitle)])

  const requested = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname === `/api/session/${childID}` && url.port === serverPort,
    async (route) => {
      requested.resolve()
      await release.promise
      await route.fallback()
    },
  )

  const parentTab = page.locator("[data-titlebar-tab-slot]", {
    has: page.locator('[data-slot="tab-title"]', { hasText: parentTitle }),
  })

  await page.locator(`a[href="${sessionHref(childID)}"]`).click()
  const view = page.locator('[data-component="session-content-panel"]')

  await expectSessionMetadata(view, childID)
  await view.getByRole("button", { name: "Open as main session", exact: true }).click()
  await Promise.all([requested.promise, expect(page).toHaveURL(sessionHref(childID))])
  await Promise.all([
    expect(parentTab).toHaveAttribute("data-active", "true"),
    expect(page.locator('[data-slot="session-title-parent"]')).toHaveText(parentTitle),
  ]).finally(() => release.resolve())
  await expectSessionTitle(page, taskDescription)

  const home = page.getByRole("button", { name: "Home" })
  await home.click()
  await expect(page).toHaveURL("/")
  const childTab = page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(childID)}"]`)
  await expect(childTab).toHaveCount(1)
  await childTab.click()
  await Promise.all([expect(page).toHaveURL(sessionHref(childID)), expectSessionTitle(page, taskDescription)])
})

test("shows the not found fallback when the viewed session is deleted", async ({ page }) => {
  const events: AigcForgeEvent[] = []
  await setup(page, () => events.splice(0, 1))
  await openChildFromParent(page)
  await expectSessionTitle(page, taskDescription)

  events.push({
    id: "evt_session_deleted",
    created: 1700000003000,
    type: "session.deleted",
    durable: { aggregateID: childID, seq: 1, version: 2 },
    location: { directory },
    data: { sessionID: childID },
  })

  await expect(page.getByText("This session cannot be found")).toBeVisible()
  await expect(page.getByRole("button", { name: "Close Tab", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: taskDescription })).toHaveCount(0)
})

test.describe("session ID links", () => {
  const target = "ses_0123456789abcdefghijklmnop"
  const missing = "ses_abcdefghijklmnopqrstuvwxyz"

  test("opens a verified session from agent prose or inline code with the keyboard", async ({ page }) => {
    await setupTimeline(page, {
      sessions: [session(), session({ id: target, title: "Linked session" })],
      messages: [
        userMessage(),
        assistantMessage([textPart("prt_session_links", `Visit ${target} or \`${target}\` to see the result.`)]),
      ],
    })
    const markdown = page.locator('[data-component="markdown"]').filter({ hasText: `Visit ${target}` })
    await expect(markdown).toHaveAttribute("data-markdown-ready", "")
    await expect(markdown.getByRole("button", { name: target })).toHaveCount(2)
    await markdown
      .getByRole("button", { name: target })
      .filter({ has: page.locator("code") })
      .press("Enter")
    await expectPath(page, sessionHref(target))
    await expect(page.locator(`[data-titlebar-tab-link][href$="/session/${target}"]`)).toContainText("Linked session")
  })

  test("does not navigate to an ID that is absent from the current server", async ({ page }) => {
    await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([textPart("prt_session_missing", `See ${missing}.`)])],
    })
    const markdown = page.locator('[data-component="markdown"]').filter({ hasText: `See ${missing}.` })
    await expect(markdown).toHaveAttribute("data-markdown-ready", "")
    await markdown.getByRole("button", { name: missing }).click()
    await expect(page.getByText("This session cannot be found")).toBeVisible()
    await expectPath(page, sessionHref(sessionID))
  })
})

async function setup(
  page: Page,
  events?: () => AigcForgeEvent[],
  nestedDepth: 0 | 1 | 2 = 0,
  input: Pick<WorkspaceInput, "pageMessages" | "permissions" | "sessionPermissions" | "sessions" | "seed"> = {},
) {
  const workspace = await mockWorkspace(page, {
    name: "SubagentNavigation",
    sessions: input.sessions ?? [
      { id: parentID, title: parentTitle, created: 1700000000000 },
      { id: childID, title: childTitle, created: 1700000001000, parentID },
      ...(nestedDepth >= 1
        ? [{ id: grandchildID, title: grandchildTitle, created: 1700000002000, parentID: childID }]
        : []),
      ...(nestedDepth >= 2
        ? [{ id: greatGrandchildID, title: greatGrandchildTitle, created: 1700000003000, parentID: grandchildID }]
        : []),
    ],
    pageMessages: input.pageMessages ?? ((sessionID) => ({ items: sessionID === parentID ? parentMessages() : [] })),
    permissions: input.permissions,
    sessionPermissions: input.sessionPermissions,
    events,
    eventRetry: events ? 16 : undefined,
    seed: input.seed ?? { tabs: [parentID] },
  })
  // The child session resolves by ID but is absent from the session list,
  // matching a subagent session that has not been loaded into the list cache yet.

  await page.route(
    (url) => url.pathname === "/api/session" && url.port === serverPort,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          data: input.sessions
            ? workspace.sessions
                .filter((item) => input.sessions?.some((entry) => entry.id === item.id && !entry.parentID))
                .map((item) => currentSession(item))
            : [
                currentSession({
                  id: parentID,
                  slug: parentID,
                  projectID,
                  directory,
                  title: parentTitle,
                  version: "dev",
                  time: { created: 1700000000000, updated: 1700000000000 },
                }),
              ],
          cursor: {},
        }),
      }),
  )

  return workspace
}

function titleInlineStart(title: Locator) {
  return title.evaluate((element) => {
    const range = document.createRange()

    range.selectNodeContents(element)

    const bounds = range.getBoundingClientRect()

    return document.documentElement.dir === "rtl" ? bounds.right : bounds.left
  })
}

async function expectSessionMetadata(content: Locator, sessionID: string) {
  const metadata = content.locator('[data-slot="session-content-metadata"]')
  const trigger = metadata.getByRole("button", { name: "Execution details", exact: true })

  await expect(trigger).toBeVisible()

  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()

  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(metadata.getByText(sessionID, { exact: true })).toBeVisible()
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
}

async function openChildFromParent(page: Page) {
  await page.goto(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await page.getByRole("button", { name: "Used 1 Agent", exact: true }).click()

  const card = page.locator(`a[href="${sessionHref(childID)}"]`)
  await expect(card).toBeVisible()
  await card.click()

  const view = page.locator('[data-component="session-content-panel"]')

  await expectSessionMetadata(view, childID)
  await expect(page).toHaveURL(sessionHref(parentID))
  await expectSessionTitle(page, parentTitle)
  await view.getByRole("button", { name: "Open as main session", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/server/.+/session/${childID}$`), { timeout: 15_000 })
}

function parentMessages(): SessionMessageInfo[] {
  const userID = "msg_user_0001"
  const assistantID = "msg_assistant_0001"

  return [
    {
      id: userID,
      type: "user",
      time: { created: 1700000000000 },
      text: "Delegate work to a subagent",
    },
    {
      id: assistantID,
      type: "assistant",
      time: { created: 1700000001000, completed: 1700000002000 },
      model: { id: "claude-opus-4-6", providerID: "aigcfroge" },
      agent: "build",
      cost: 0.01,
      tokens: { input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
      content: [
        {
          type: "tool",
          id: "call_subagent_0001",
          name: "subagent",
          time: { created: 1700000001000, ran: 1700000001000, completed: 1700000002000 },
          state: {
            status: "completed",
            input: { description: taskDescription, agent: "explore", prompt: "Inspect the delegated work." },
            content: [{ type: "text", text: "Subagent finished" }],
            metadata: { sessionID: childID },
          },
        },
      ],
    },
  ]
}
