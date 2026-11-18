import { expect, test, type Page } from "@playwright/test"
import type { AigcForgeEvent, SessionMessageInfo } from "@aigcfroge/client/promise"
import {
  NO_PROVIDER,
  REMOTE_SERVER,
  SERVER,
  T0,
  expectPath,
  holdRoute,
  project,
  seed,
  session,
  sessionHref,
} from "../utils/app"
import { mockServers } from "../utils/mock-server"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { fileNode, mockWorkspace, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const a = { id: "ses_tab_a", title: "Tab A session" }

const b = { id: "ses_tab_b", title: "Tab B session" }

const c = { id: "ses_tab_c", title: "Tab C session" }

test.use({ serviceWorkers: "block" })

test("tab strip keeps draft tabs as wide as session tabs and navigates on mouse down", async ({ page }) => {
  const workspace = await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b],
    seed: { tabs: [a.id, { draft: "draft_tab_width", directory: "C:/AigcForge/Tabs" }, b.id] },
  })

  await page.goto(sessionHref(a.id))

  const tabs = page.locator("[data-titlebar-tab-slot]")
  await expect(tabs.locator("[data-titlebar-tab-title]")).toHaveText([a.title, "Session", b.title])
  await expect
    .poll(() =>
      tabs.evaluateAll((tabs) => {
        const widths = tabs.map((tab) => tab.getBoundingClientRect().width)

        return Math.max(...widths) - Math.min(...widths)
      }),
    )
    .toBeLessThan(1)

  const link = page.locator(`a[data-titlebar-tab-link][href="${sessionHref(b.id, workspace.server)}"]`)
  const box = await link.boundingBox()

  if (!box) throw new Error("tab link has no bounding box")
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expectPath(page, sessionHref(b.id))
  await page.mouse.up()
  await expectPath(page, sessionHref(b.id))
})

test("a tab does not reopen its title editor while a rename is saving", async ({ page }) => {
  await mockWorkspace(page, { name: "Tabs", sessions: [a, b] })
  await page.goto(sessionHref(a.id))
  const title = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"]) [data-slot="tab-title"]`)
  const editor = page.locator('[data-slot="tab-title"][contenteditable="true"]')
  await expect(title).toHaveText(a.title)
  const save = await holdRoute(page, (url) => url.pathname === `/api/session/${a.id}`, { method: "PATCH" })

  await title.dblclick()
  await expect(editor).toBeFocused()
  await editor.fill("Renamed tab")
  await editor.press("Enter")
  expect((await save.arrived).postDataJSON()).toEqual({ title: "Renamed tab" })
  await expect(editor).toHaveCount(0)
  await title.dblclick()
  await expect(editor).toHaveCount(0)

  // The context menu's Rename item is enabled again once the save settles.
  save.release()
  await title.click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeEnabled()
  await page.keyboard.press("Escape")
  await title.dblclick()
  await expect(editor).toBeFocused()
})

test("keyboard navigation follows the visible tab order and skips unresolved tabs", async ({ page }) => {
  await mockWorkspace(page, { name: "Tabs", sessions: [a, c], seed: { tabs: [a.id, "ses_tab_unresolved", c.id] } })
  await page.route(
    (url) => url.pathname === "/api/session/ses_tab_unresolved",
    () => new Promise(() => {}),
  )
  await page.goto(sessionHref(a.id))
  await expect(page.locator("[data-titlebar-tab-slot]:visible")).toHaveCount(2)
  await expect(page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(c.id)}"])`)).toBeVisible()

  await page.keyboard.press("Control+Alt+ArrowRight")

  await expectPath(page, sessionHref(c.id))
})

for (const row of [
  { tabLayout: "horizontal", width: 360 },
  { tabLayout: "vertical", width: 390 },
]) {
  test(`mobile drawer exposes close controls and navigates between tabs (${row.tabLayout})`, async ({ page }) => {
    await page.setViewportSize({ width: row.width, height: 720 })

    const history = Array.from({ length: 3 }, (_, index) => ({
      id: "ses_mobile_project_history_" + index,
      title: "Mobile project history " + index,
      mode: "coding",
      created: T0 - (index + 1) * 1000,
    }))

    const work = { id: "ses_mobile_project_work", title: "Mobile Work session", mode: "work" }

    await mockWorkspace(page, {
      name: "Tabs",
      sessions:
        row.tabLayout === "horizontal"
          ? [...[a, b, c].map((item) => ({ ...item, mode: "coding" })), ...history, work]
          : [a, b, c],
      seed: {
        settings: { appearance: { tabLayout: row.tabLayout } },
        tabs: [a.id, b.id, c.id, ...(row.tabLayout === "horizontal" ? [work.id] : [])],
      },
    })
    await page.goto(sessionHref(a.id))
    await page.getByRole("button", { name: "Tabs", exact: true }).click()

    const drawer = page.locator('[data-slot="mobile-tabs-drawer"]')
    const tabA = drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(a.id)}"])`)
    const tabB = drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
    await expect(tabA).toHaveAttribute("data-active", "true")
    await expect(tabA.locator('[data-slot="tab-close"]')).toBeVisible()
    await expect(tabB.locator('[data-slot="tab-close"]')).toBeVisible()
    await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)

    await tabB.locator(`a[href="${sessionHref(b.id)}"]`).click()

    await expectPath(page, sessionHref(b.id))
    await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()

    if (row.tabLayout === "horizontal") {
      const older = history[2]

      if (!older) throw new Error("The mobile project fixture must contain a sixth Coding session")
      await page.getByRole("button", { name: "Tabs", exact: true }).click()
      const projects = drawer.getByRole("complementary", { name: "Projects", exact: true })

      const olderRow = projects
        .locator(`[data-component="home-session-row-container"][data-session-id="${older.id}"]`)
        .locator('[data-component="home-session-row"]')

      await expect(projects).toBeVisible()
      await expect(projects.locator('[data-component="home-session-row"]')).toHaveCount(5)
      await expect(projects.locator('[data-component="home-session-title"]')).toHaveText([
        a.title,
        b.title,
        c.title,
        ...history.slice(0, 2).map((item) => item.title),
      ])
      await expect(olderRow).toBeHidden()
      await expect(projects.locator(`[data-session-id="${work.id}"]`)).toHaveCount(0)
      await expect(drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(work.id)}"])`)).toBeVisible()
      await projects.getByRole("button", { name: "Show more", exact: true }).click()
      await expect(olderRow).toBeVisible()
      await olderRow.click()
      await expectPath(page, sessionHref(older.id))
      await expectSessionTitle(page, older.title)
      await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()

      await page.getByRole("button", { name: "Tabs", exact: true }).click()
      await expect(drawer.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(older.id)}"])`)).toHaveAttribute(
        "data-active",
        "true",
      )
      await expect(olderRow).toHaveAttribute("aria-current", "page")
      await olderRow.click()
      await expectPath(page, sessionHref(older.id))
      await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()
      await page.getByRole("button", { name: "Tabs", exact: true }).click()
      await drawer.locator('[data-action="mobile-tabs-home"]').click()
      await expectPath(page, "/")
      await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()
      await page.getByRole("button", { name: "Tabs", exact: true }).click()
      await expect(projects).toHaveCount(0)
      await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).not.toHaveAttribute(
        "data-transitioning",
        "",
      )
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()

      return
    }

    await page.getByRole("button", { name: "Tabs", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)
    await expect(page.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`)).toBeVisible()
    await expect(page.locator('[data-slot="titlebar-tabs"]')).toBeVisible()
    await page.setViewportSize({ width: row.width, height: 720 })
    await expect(page.getByRole("dialog", { name: "Tabs", exact: true })).toBeHidden()
    await expect(page.locator('[data-slot="mobile-projects-drawer"]')).toHaveCount(0)
  })
}

test("legacy vertical tabs use the shared top strip on Home and session details", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Tabs",
    sessions: [a, b],
    seed: { settings: { appearance: { tabLayout: "vertical" } } },
  })
  await page.goto(sessionHref(a.id))
  await expectSessionTitle(page, a.title)
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toBeVisible()
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click()
  await expectPath(page, sessionHref(b.id))
  await expectSessionTitle(page, b.title)
  await page.goto("/")
  await expect(page.locator('[data-slot="vertical-tabs-sidebar"]')).toHaveCount(0)
  await expect(page.locator("#shell-project-sidebar")).toHaveCount(0)
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toBeVisible()
})

test("closing the active server's last tab opens the remaining server tab", async ({ page }) => {
  const sessionA = session({ id: "ses_server_a", directory: "C:/server-a", title: "Server A session" })
  const sessionB = session({ id: "ses_server_b", directory: "/home/server-b", title: "Server B session" })
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "OPTIONS") requests.push(request.url())
  })
  await twoServers(page, { a: [sessionA], b: [sessionB] })
  await page.goto(sessionHref(sessionA.id))
  await expectSessionTitle(page, sessionA.title)

  await page
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionA.id)}"])`)
    .getByRole("button", { name: "Close tab", exact: true })
    .click()

  await expectPath(page, sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)
  const reads = requests.filter((url) => url.includes(`/session/${sessionB.id}`))
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.filter((url) => !url.startsWith(REMOTE_SERVER))).toEqual([])
})

test("a remote tab stays busy while a child session runs", async ({ page }) => {
  const sessionA = session({ id: "ses_server_a", directory: "C:/server-a", title: "Server A session" })
  const sessionB = session({ id: "ses_server_b", directory: "/home/server-b", title: "Server B session" })
  const child = session({ id: "ses_server_b_child", directory: sessionB.directory, parentID: sessionB.id })
  await twoServers(page, { a: [sessionA], b: [sessionB, child], running: child.id })
  await page.goto(sessionHref(sessionB.id, REMOTE_SERVER))
  await expectSessionTitle(page, sessionB.title)

  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionB.id, REMOTE_SERVER)}"])`)
  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionA.id)}"])`)
  await expect(tabB.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()
  await expect(tabA.locator("[data-titlebar-tab-title]")).toHaveText(sessionA.title)
  await expect(tabA.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
})

test("inactive tabs stay busy while work waits in their inbox, and pulse on a new prompt, as in the TUI", async ({
  page,
}) => {
  const workspace = await openSession(page, {
    name: "TabInbox",
    sessions: [a, b, c],
    inbox: [
      {
        id: "inb_tab_b",
        sessionID: b.id,
        time: { created: 1 },
        type: "user",
        payload: { text: "Queued follow-up" },
        delivery: "queue",
      },
      // Parked synthetic context, such as a user shell's output, waits without work.
      {
        id: "inb_tab_c",
        sessionID: c.id,
        time: { created: 1 },
        type: "synthetic",
        payload: { text: "Shell output", description: "Shell finished" },
        delivery: "steer",
      },
    ],
  })

  const tab = (id: string) => page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(id)}"])`)
  const progress = '[data-component="session-progress-indicator-v2"]'

  await expect(tab(b.id).locator(progress)).toBeVisible()
  await expect(tab(c.id).locator("[data-titlebar-tab-title]")).toHaveText(c.title)
  await expect(tab(c.id).locator(progress)).toHaveCount(0)
  await expect(tab(c.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
  // The pulse lasts one animation, so record that it appeared rather than racing its removal.
  await tab(c.id).evaluate((element) => {
    const observer = new MutationObserver(() => {
      if (!element.querySelector('[data-slot="tab-prompt-pulse"]')) return
      element.setAttribute("data-test-pulsed", "")
      observer.disconnect()
    })

    observer.observe(element, { childList: true, subtree: true })
  })

  await workspace.push([
    {
      id: "evt_tab_c_prompt",
      created: 2,
      type: "session.inbox.enqueued",
      durable: { aggregateID: c.id, seq: 1, version: 1 },
      data: {
        sessionID: c.id,
        inboxID: "inb_tab_c_prompt",
        item: { type: "user", payload: { text: "Another client's prompt" }, delivery: "queue" },
      },
    } satisfies Extract<AigcForgeEvent, { type: "session.inbox.enqueued" }>,
  ])

  await expect(tab(c.id)).toHaveAttribute("data-test-pulsed", "")
  await expect(tab(c.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
  await expect(tab(c.id).locator(progress)).toBeVisible()
  await expect(tab(a.id).locator('[data-slot="tab-prompt-pulse"]')).toHaveCount(0)
})

test("selecting a tab with waiting work waits for its transcript instead of showing only the inbox", async ({
  page,
}) => {
  await openSession(page, {
    name: "TabInboxTranscript",
    sessions: [a, b],
    pageMessages: (id) => ({
      items:
        id === b.id ? [{ id: "msg_tab_b_history", type: "user", text: "Earlier prompt", time: { created: 1 } }] : [],
    }),
    inbox: [
      {
        id: "inb_tab_b_steer",
        sessionID: b.id,
        time: { created: 2 },
        type: "user",
        payload: { text: "Pending steer" },
        delivery: "steer",
      },
    ],
  })
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(b.id)}"])`)
  // The inactive tab read its inbox, which materializes the pending steer as a transcript row.
  await expect(tabB.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()

  const transcript = await holdRoute(page, (url) => url.pathname === `/api/session/${b.id}/message`)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(b.id)}"]`).click()
  await transcript.arrived
  await expect(page.locator("[data-timeline-virtual-content]")).toHaveCount(0)

  transcript.release()
  await expect(page.locator('[data-timeline-row="UserMessage"][data-message-id="msg_tab_b_history"]')).toContainText(
    "Earlier prompt",
  )
  await expect(page.locator('[data-timeline-row="UserMessage"][data-message-id="inb_tab_b_steer"]')).toContainText(
    "Pending steer",
  )
})

test("inactive tabs load attention and inbox, but read the transcript only on selection", async ({ page }) => {
  const reads: string[] = []
  const mutations: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/") && !response.ok())
      errors.push(`HTTP ${response.status()}: ${response.url()}`)
  })
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (!path.startsWith("/api/")) return

    if (request.method() === "GET") reads.push(path)

    if (request.method() === "DELETE" || /\/(interrupt|prompt)$/.test(path)) mutations.push(path)
  })
  const state = { text: "Original fixture answer" }
  await mockStressTimeline(page, {
    pageMessages: (id) => ({
      items: [
        { id: `msg_${id}_user`, type: "user", text: "Review the renderer change", time: { created: 1 } },
        {
          id: `msg_${id}_assistant`,
          type: "assistant",
          agent: "build",
          model: { id: "claude-opus-4-6", providerID: "aigcfroge" },
          content: [{ type: "text", text: state.text }],
          time: { created: 2, completed: 3 },
        },
      ],
    }),
  })
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
    tabs: [fixture.sourceID, fixture.targetID, fixture.childID],
  })

  const attention = Promise.all(
    [fixture.targetID, fixture.childID].flatMap((id) =>
      ["permission", "form", "inbox"].map((kind) =>
        page.waitForResponse((response) => new URL(response.url()).pathname === `/api/session/${id}/${kind}`),
      ),
    ),
  )

  await page.goto(sessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.sourceID}_assistant:text:0"]`)).toContainText(
    state.text,
  )
  await attention

  const child = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(fixture.childID)}"])`)
  await child.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(child).toHaveCount(0)
  await expectPath(page, sessionHref(fixture.sourceID))

  state.text = "Latest fixture answer after tab restoration"
  await page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(fixture.targetID)}"]`).click()
  await expectSessionTitle(page, fixture.expected.targetTitle)
  await expect(page.locator(`[data-timeline-part-id="msg_${fixture.targetID}_assistant:text:0"]`)).toContainText(
    state.text,
  )

  // Every tab reads its inbox once, since waiting work keeps a tab busy; selection reuses that read.
  for (const id of [fixture.sourceID, fixture.targetID, fixture.childID])
    expect(reads.filter((path) => path === `/api/session/${id}/inbox`)).toHaveLength(1)

  for (const id of [fixture.sourceID, fixture.targetID])
    expect(reads.filter((path) => path === `/api/session/${id}/message`)).toHaveLength(1)

  expect(reads.filter((path) => path === `/api/session/${fixture.childID}/message`)).toEqual([])
  expect(mutations).toEqual([])
  expect(errors).toEqual([])
})

test("five loaded workspace tabs stay rendered and reactive through repeated switches", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  const sessions = Array.from({ length: 5 }, (_, index) => ({
    ...fixture.sessions[0]!,
    id: `ses_workspace_cycle_${index}`,
    directory: `${fixture.directory}/worktree-${index}`,
    title: `Workspace session ${index}`,
  }))

  const mock = await mockStressTimeline(page, {
    sessions,
    pageMessages: (id) => ({
      items: [
        { id: `msg_user_${id}`, type: "user", text: `Prompt for ${id}`, time: { created: 1 } },
        {
          id: `msg_assistant_${id}`,
          type: "assistant",
          agent: "build",
          model: { id: "claude-opus-4-6", providerID: "aigcfroge" },
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: `Answer for ${id}` }],
        },
      ] satisfies SessionMessageInfo[],
    }),
  })

  // Each worktree session resolves to its own location in the shared project (the mock echoes the requested one).
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    tabs: sessions.map((item) => item.id),
  })
  await page.goto(sessionHref(sessions[0]!.id))
  await expect(page.getByText(`Answer for ${sessions[0]!.id}`, { exact: true })).toBeVisible()

  for (const item of [...sessions.slice(1), ...sessions, ...sessions.toReversed()]) {
    await page.locator(`[data-titlebar-tab-link][href="${sessionHref(item.id)}"]`).click()
    await expect(page.locator(`[data-timeline-part-id="msg_assistant_${item.id}:text:0"]`)).toBeVisible()
    await expect(page.locator("[data-timeline-virtual-content]")).toHaveCSS("visibility", "visible")
  }

  const active = sessions[0]!
  await mock.push([
    {
      id: "evt_workspace_cycle_update",
      created: 4,
      type: "session.text.ended",
      location: { directory: active.directory },
      durable: { aggregateID: active.id, seq: 0, version: 1 },
      data: {
        sessionID: active.id,
        assistantMessageID: `msg_assistant_${active.id}`,
        ordinal: 0,
        text: "Still receiving updates",
      },
    },
  ])
  await expect(page.getByText("Still receiving updates", { exact: true })).toBeVisible()
})

test("each session tab shows its own file tab after a switch to a session in another folder", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const directory = "C:/AigcForge/FolderSwitch"
  const alpha = { id: "ses_folderswitch_alpha", title: "Folder switch alpha" }
  const beta = { id: "ses_folderswitch_beta", title: "Folder switch beta" }
  const other = { id: "ses_folderswitch_other", title: "Folder switch other", directory: "C:/AigcForge/FolderOther" }
  await openSession(page, {
    name: "FolderSwitch",
    sessions: [alpha, beta, other],
    fileList: (path) => (path ? [] : ["greet.ts", "guide.md", "notes.txt"].map((file) => fileNode(directory, file))),
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    seed: { panes: Object.fromEntries([alpha, beta, other].map((item) => [item.id, { review: true }])) },
  })
  const panel = page.locator("#review-panel")

  const shows = async (file: string) => {
    await expect(panel.getByRole("tab", { name: file, exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(panel.getByText(`contents:${file}`, { exact: true })).toBeVisible()
  }

  const visit = async (target: { id: string; title: string }) => {
    await page.locator(`[data-titlebar-tab-link][href="${sessionHref(target.id)}"]`).click()
    await expectSessionTitle(page, target.title)
  }

  const open = async (file: string) => {
    await panel.getByRole("button", { name: "Open file" }).click()
    await panel.getByRole("button", { name: file, exact: true }).click()
    await shows(file)
  }

  await open("greet.ts")
  await visit(other)
  await open("notes.txt")
  await visit(beta)
  await open("guide.md")

  // The session screen stays mounted while the route moves between folders, and each tab reads its own folder.
  for (const [target, file] of [
    [alpha, "greet.ts"],
    [other, "notes.txt"],
    [beta, "guide.md"],
    [other, "notes.txt"],
    [alpha, "greet.ts"],
  ] as const) {
    await visit(target)
    await shows(file)
  }
})

// Windows has no native menu bar: the titlebar menu owns Paste, which only the desktop edit action can perform.
test("the Windows titlebar menu pastes through the desktop edit action", async ({ page }) => {
  await mockWorkspace(page, { name: "WindowsMenu", sessions: [] })
  await page.goto(`/e2e/utils/windows-menu.html?${new URLSearchParams({ server: SERVER })}`)
  await page.getByRole("button", { name: "AigcForge menu", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const paste = page.getByRole("menuitem", { name: /^Paste/ })
  await expect(paste).toHaveText("PasteCtrl+V")
  await paste.click()
  await expect(page.getByRole("status", { name: "Desktop menu actions" })).toHaveText("edit.paste")
})

// Server A is the default origin; B is a remote that answers only for its own directories.
async function twoServers(
  page: Page,
  input: {
    a: ReturnType<typeof session>[]
    b: ReturnType<typeof session>[]
    running?: string
  },
) {
  const config = (sessions: ReturnType<typeof session>[], id: string) => {
    const directory = String(sessions[0]!.directory)

    return {
      directory,
      project: project({ id, directory }),
      provider: NO_PROVIDER,
      sessions,
      pageMessages: () => ({ items: [] }),
      strictDirectory: true,
    }
  }

  await mockServers(page, {
    [SERVER]: config(input.a, "proj_server_a"),
    [REMOTE_SERVER]: {
      ...config(input.b, "proj_server_b"),
      sessionStatus: input.running ? { [input.running]: { type: "running" } } : {},
    },
  })
  await seed(page, {
    servers: [REMOTE_SERVER],
    tabs: [input.a[0]!.id, { session: input.b[0]!.id, server: REMOTE_SERVER }],
  })
}
