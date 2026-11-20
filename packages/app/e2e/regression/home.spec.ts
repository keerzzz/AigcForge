import { expect, test, type Page } from "@playwright/test"
import {
  expectPath,
  holdRoute,
  NO_PROVIDER,
  project,
  provider,
  REMOTE_SERVER,
  seed,
  SERVER,
  sessionHref,
} from "../utils/app"
import { mockAigcForgeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import type { PersonalMemoryInfo } from "@aigcfroge/client/promise"
import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import type { Schema } from "effect"
import { SessionTask } from "@aigcfroge/schema/session-task"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomCompositionFixture } from "../utils/custom-composition"
import { MockNotFound } from "../utils/mock-api"
import {
  homeModeSessions,
  homeScopeProjectFixture,
  homeSessionMode,
  mockHomeScopeServers,
  selectHomeSessionMode,
  selectGlobalMode,
  waitForHomeModeList,
  waitForHomeScopeGet,
  waitForHomeScopeList,
} from "../utils/home-mode"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { mockRemoteServer, mockWorkspace } from "../utils/workspace"
import { APP_READY_TIMEOUT, expectAppVisible } from "../utils/waits"

test.use({ serviceWorkers: "block" })

const row = (page: Page, title: string) =>
  page.locator('[data-component="home-session-row"]').filter({ hasText: title })

test("MC09 personal Memory keeps confirmation ACK across read failure and edits, rejects, deletes, and opens its source", async ({
  page,
}, testInfo) => {
  const memory: PersonalMemoryInfo[] = [
    {
      id: "pm_first",
      content: "Prefer precise updates 中文",
      source: "explicit",
      trustLevel: "high",
      sensitivityLevel: "low",
      status: "pending",
      sourceSessionID: "ses_memory_source",
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "pm_second",
      content: "Possible preference",
      source: "derived",
      trustLevel: "low",
      sensitivityLevel: "medium",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    },
  ]

  const state = { unreadable: false }
  const calls: string[] = []
  await mockWorkspace(page, {
    name: "Memory Consumer",
    sessions: [{ id: "ses_memory_source", title: "Memory source", mode: "assistant" }],
    memory,
    onMemoryRead: () =>
      state.unreadable ? new InvalidRequestError({ message: "Memory temporarily unavailable" }) : undefined,
    onMemoryAction(action, id, body) {
      calls.push(action)
      const item = memory.find((item) => item.id === id)

      if (!item) return new InvalidRequestError({ message: "Memory not found" })

      if (action === "confirm") {
        state.unreadable = true

        return { ...item, status: "confirmed", updatedAt: 2 }
      }

      if (action === "reject") return { ...item, status: "rejected", updatedAt: 3 }

      if (action === "remove") return { ...item, status: "deleted", updatedAt: 4 }

      if (body?.content !== undefined) return { ...item, content: body.content, updatedAt: 3 }

      return new InvalidRequestError({ message: "Invalid edit" })
    },
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Assistant")
  await page.getByRole("button", { name: "Personal memory", exact: true }).press("Enter")
  const inspector = page.getByRole("region", { name: "Personal memory", exact: true })
  const first = inspector.getByRole("listitem", { name: "Memory pm_first", exact: true })
  const second = inspector.getByRole("listitem", { name: "Memory pm_second", exact: true })
  await expect(first.getByText(memory[0].content, { exact: true })).toBeVisible()
  await first.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(inspector.getByRole("alert")).toContainText("Memory temporarily unavailable")
  await expect(first.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0)
  await expect(first.getByText("Confirmed", { exact: true })).toBeVisible()
  state.unreadable = false
  await inspector.getByRole("button", { name: "Refresh", exact: true }).click()
  await first.getByRole("button", { name: "Edit", exact: true }).click()
  await inspector.getByRole("textbox", { name: "Memory content", exact: true }).fill("Updated precise preference")
  await inspector.getByRole("button", { name: "Save memory", exact: true }).click()
  await expect(first.getByText("Updated precise preference", { exact: true })).toBeVisible()
  await second.getByRole("button", { name: "Reject", exact: true }).click()
  await expect(second.getByText("Rejected", { exact: true })).toBeVisible()
  await first.getByRole("button", { name: "Delete", exact: true }).click()
  await inspector.getByRole("button", { name: "Delete memory", exact: true }).click()
  await expect(first.getByText("Deleted", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("memory-desktop.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(first).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("memory-narrow.png") })
  await first.getByRole("button", { name: "Open source session", exact: true }).click()
  await expect(page).toHaveURL(/\/session\/ses_memory_source$/)
  expect(calls).toEqual(["confirm", "edit", "reject", "remove"])
})

test("MC09 Hub shows location-owned task progress and opens the actual owning Session", async ({ page }) => {
  const stream = await installSseTransport(page, { server: SERVER })

  const task = new SessionTask.Info({
    id: "tsk_hub",
    sessionID: "ses_hub",
    agentID: "builder",
    content: "Saved Hub result 中文",
    status: "completed",
    priority: "medium",
    revision: 2,
    outputDigest: "Actual Hub digest",
    createdAt: 1,
    updatedAt: 2,
  })

  const tasks = [
    task,
    new SessionTask.Info({ ...task, id: "tsk_other", sessionID: "ses_hub_other", content: "Foreign location task" }),
  ]

  await mockWorkspace(page, {
    name: "Hub Consumer",
    sessions: [
      { id: "ses_hub", title: "Hub owner", mode: "work" },
      { id: "ses_hub_other", title: "Other owner", location: { directory: "/other" }, mode: "work" },
    ],
    tasks,
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Work")
  await page.getByRole("button", { name: "Agent Hub", exact: true }).click()
  const hub = page.getByRole("region", { name: "Agent Hub", exact: true })
  await expect(hub.getByText("Saved Hub result 中文", { exact: true })).toBeVisible()
  await expect(hub.getByText("Actual Hub digest", { exact: true })).toBeVisible()
  await expect(hub.getByText("Foreign location task", { exact: true })).toHaveCount(0)
  await expect(hub.getByRole("button", { name: "Refresh tasks", exact: true })).toBeEnabled()
  tasks[0] = new SessionTask.Info({ ...task, content: "Saved Hub result after reconnect", revision: 3 })
  const connection = await stream.waitForConnection()
  await stream.disconnect()
  await stream.waitForConnection({ after: connection.id })
  await expect(hub.getByText("Saved Hub result after reconnect", { exact: true })).toBeVisible()
  await hub.getByRole("button", { name: "Open task session", exact: true }).click()
  await expect(page).toHaveURL(/\/session\/ses_hub$/)
})

async function openHome(
  page: Page,
  input: Parameters<typeof mockStressTimeline>[1] = {},
  seedInput: Parameters<typeof seed>[1] = {},
) {
  await mockStressTimeline(page, input)
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
    ...seedInput,
  })
  await page.goto("/")
}

test("the session menu opens from row actions or context input and renames, exports, and deletes a Home session", async ({
  page,
}) => {
  await openHome(page)

  const target = row(page, fixture.expected.targetTitle)

  const more = page
    .locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`)
    .getByRole("button", { name: "More options", exact: true })

  await expect(target).toBeVisible()

  await target.focus()
  await target.press("Shift+F10")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeHidden()
  await expect(target).toBeFocused()

  const box = await target.boundingBox()
  await target.click({ button: "right", position: { x: 48, y: 12 } })
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Export…", "Delete…"])
  const menu = await page.locator('[data-component="menu-v2-content"]').boundingBox()
  expect(Math.abs((menu?.x ?? 0) - (box?.x ?? 0) - 48)).toBeLessThan(4)
  await page.keyboard.press("Escape")

  await target.hover()
  await expect(more).toHaveCSS("opacity", "1")
  await more.click()
  await expect(page).toHaveURL("/")
  await expect(page.getByRole("menuitem")).toHaveText(["Rename", "Export…", "Delete…"])

  await page.getByRole("menuitem", { name: "Rename" }).click()
  const title = page.locator('[data-component="home-session-rename"]')
  await expect(title).toBeFocused()
  await expect(title).toHaveValue(fixture.expected.targetTitle)
  await title.fill("Renamed from Home")

  const renamed = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" && new URL(request.url()).pathname.endsWith(`/session/${fixture.targetID}`),
  )

  await title.press("Enter")
  expect((await renamed).postDataJSON()).toEqual({ title: "Renamed from Home" })
  const renamedRow = row(page, "Renamed from Home")
  await renamedRow.click()
  await expect(page).toHaveURL(new RegExp(`/session/${fixture.targetID}$`))
  await expect(page.locator('[data-slot="titlebar-tabs"] a').filter({ hasText: "Renamed from Home" })).toBeVisible()
  await page.getByRole("button", { name: "Home" }).click()
  await expect(page).toHaveURL("/")

  await renamedRow.hover()
  await more.click()
  const download = page.waitForEvent("download")
  await page.getByRole("menuitem", { name: "Export…" }).click()
  expect((await download).suggestedFilename()).toBe("renamed-from-home.json")

  await more.click()
  await page.getByRole("menuitem", { name: "Delete…" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText('Delete session "Renamed from Home"?')

  const removed = page.waitForRequest(
    (request) => request.method() === "DELETE" && new URL(request.url()).pathname.endsWith(`/${fixture.targetID}`),
  )

  await dialog.getByRole("button", { name: "Delete session" }).click()
  await removed
  await expect(renamedRow).toBeHidden()
})

test("the Home shortcut focuses session search, and the Home button leaves focus alone", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, {
    projects: { local: [{ worktree: fixture.directory, expanded: true }] },
    lastProject: { local: fixture.directory },
    tabs: [fixture.sourceID],
  })
  await page.goto(sessionHref(fixture.sourceID))
  const editor = page.locator('[data-component="composer-editor"]')
  await expect(editor).toBeEditable({ timeout: APP_READY_TIMEOUT })
  await editor.click()

  await page.keyboard.press("ControlOrMeta+b")
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  await expect(search).toBeFocused()
  await page.keyboard.type("jump")
  await expect(page.getByRole("option")).toHaveCount(1)
  await expect(page.getByRole("option")).toContainText(fixture.expected.targetTitle)

  await page.keyboard.press("ControlOrMeta+b")
  await expectPath(page, sessionHref(fixture.sourceID))

  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(search).toHaveValue("")
  await expect(search).not.toBeFocused()
})

test("Home shows loaded sessions before the location request resolves", async ({ page }) => {
  const location = await holdRoute(page, (url) => url.pathname === "/api/location")
  await openHome(page)
  await expectAppVisible(row(page, fixture.expected.sourceTitle))
  location.release()
})

test("Home and the directory picker load without newer browser APIs", async ({ page }) => {
  await page.addInitScript(() => {
    // Safari 16.6 has none of these APIs. Remove them before the web entry runs.
    // SAFETY: `Partial` only makes the static method optional so `delete` type-checks; the target is the real global.
    delete (Map as Partial<typeof Map>).groupBy
    // SAFETY: as above, for the real global `Promise`.
    delete (Promise as Partial<typeof Promise>).withResolvers
    // SAFETY: as above, for the real global `Promise`.
    delete (Promise as Partial<typeof Promise>).try
  })
  await openHome(page, { fileList: () => [] })
  const target = row(page, fixture.expected.targetTitle)
  await expect(target).toBeVisible()

  await page.getByRole("button", { name: "Add project", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(target).toBeVisible()
})

test("adding a project to a signed-out server re-pairs it, then continues at the paired address", async ({ page }) => {
  // The saved address rejects the new token, so saving moves the server to the link's address.
  const paired = "http://127.0.0.1:4098"
  await mockRemoteServer(page, { name: "Remote", password: "old-password" })
  await mockAigcForgeServer(page, {
    server: paired,
    directory: "/remote/paired",
    project: project({ id: "proj_paired", directory: "/remote/paired" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
    password: "session-token",
    pairing: { code: "one-time-code", token: "session-token" },
  })
  await openHome(page, { fileList: () => [] })
  const remote = page.locator("[data-home-row]").filter({ hasText: "Remote" })
  await expect(page.getByRole("button", { name: "Authenticate", exact: true })).toBeVisible()

  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Edit server" })
  await editor.getByLabel("Pairing link", { exact: true }).fill(`${paired}/auth/connect/one-time-code`)
  await editor.getByRole("button", { name: "Save", exact: true }).click()

  // The folder picker reads the paired address; the removed one would reject the request.
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Select folder" }) })
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect(picker.getByText("Unable to read this folder")).toHaveCount(0)
})

test("a server whose saved password changes works with the new password", async ({ page }) => {
  const accepted = { password: "old-password" }
  await mockAigcForgeServer(page, {
    server: REMOTE_SERVER,
    directory: "/remote/project",
    project: project({ id: "proj_remote", directory: "/remote/project" }),
    provider: NO_PROVIDER,
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: () => [],
    password: () => accepted.password,
  })
  // Saved with the password the server accepts until the test changes it.
  await seed(page, {
    storage: {
      "aigcfroge.global.dat:server": {
        list: [{ type: "http", displayName: "Remote", http: { url: REMOTE_SERVER, password: "old-password" } }],
      },
    },
  })
  await openHome(page, { fileList: () => [] })
  const remote = page.locator("[data-home-row]").filter({ hasText: "Remote" })
  const picker = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Select folder" }) })

  // Use the server once, so its controller exists with the old password.
  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await picker.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(picker).toHaveCount(0)

  await remote.getByRole("button", { name: "More options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "Edit server" })
  await editor.getByPlaceholder("password").fill("new-password")
  // The server now rejects the old password, as after `aigcfroge service set password`.
  accepted.password = "new-password"
  await editor.getByRole("button", { name: "Save", exact: true }).click()
  await expect(editor).toHaveCount(0)

  // The picker reads the folder through the server's controller, which must use the saved password now.
  await remote.getByRole("button", { name: "Add project", exact: true }).click()
  await expect(picker.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  await expect(picker.getByText("Unable to read this folder")).toHaveCount(0)
})

const recovery = "C:/AigcForge/Worktrees/project-menu-recovery"

const worktree =
  "C:/AigcForge/Worktrees/project-42/long-folder-name-for-checking-wrapped-worktree-paths/another-long-folder-name"

for (const state of [
  { name: "local", directory: fixture.directory, icon: "monitor" },
  { name: "worktree", directory: worktree, icon: "outline-worktree" },
  { name: "closed worktree", directory: recovery, icon: "outline-worktree", recovery: "closed" },
  { name: "unopened worktree", directory: recovery, icon: "outline-worktree", recovery: "unopened" },
]) {
  test(`the session project menu opens settings and Home for a ${state.name} project`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const workspace = state.directory !== fixture.directory
    const messages = Promise.withResolvers<void>()
    await mockStressTimeline(page, {
      directory: state.directory,
      // An image icon keeps the avatar initial out of the menu item text.
      project: {
        ...fixture.project,
        sandboxes: workspace ? [state.directory] : [],
        icon: {
          url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>')}`,
        },
      },
      sessions: fixture.sessions.map((item) => ({ ...item, directory: state.directory })),
      beforeMessagesResponse: (input) =>
        state.recovery && input.sessionID === fixture.targetID ? messages.promise : Promise.resolve(),
    })

    // An unopened project has no stored project list or tabs.
    if (state.recovery !== "unopened")
      await seed(page, {
        projects: { local: [{ worktree: fixture.directory, expanded: true }] },
        lastProject: { local: fixture.directory },
        tabs: [fixture.sourceID, fixture.targetID],
      })
    const name = fixture.project.name

    if (state.recovery === "closed") {
      await page.goto("/")
      const project = page.locator('[data-component="home-project-row"]').filter({ hasText: name })
      await project.locator("..").getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menuitem", { name: "Close", exact: true }).click()
      await expect(project).toHaveCount(0)
      await page.locator(`[data-titlebar-tab-link][href="${sessionHref(fixture.targetID)}"]`).click()
    }

    if (state.recovery !== "closed") await page.goto(sessionHref(fixture.targetID))

    const header = page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true }).locator("..")
    const trigger = header.getByRole("button", { name, exact: true })
    const menu = page.getByRole("menu", { name, exact: true })
    const projectItem = menu.getByRole("menuitem", { name, exact: true })
    const pathItem = menu.getByRole("menuitem", { name: state.directory, exact: true })
    const settings = page.getByTestId("settings-screen")
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)

    for (const loaded of state.recovery ? [false, true] : [true]) {
      if (state.recovery && loaded) {
        messages.resolve()
        await expect(header.getByRole("button", { name: "More options", exact: true })).toBeVisible()
      }

      await expect(trigger.locator("use")).toHaveAttribute("href", `#aigcfroge-v2-icon-${state.icon}`)
      await trigger.click()
      await expect(menu.getByRole("menuitem")).toHaveText([name, state.directory, "Edit project"])
      await expect(pathItem).toBeDisabled()
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.press("ArrowDown")
      await expect(projectItem).toBeFocused()
      await page.keyboard.press("ArrowDown")
      await expect(pathItem).toBeFocused()

      for (const key of ["Enter", "Space"]) {
        await page.keyboard.press(key)
        await expect(menu).toBeVisible()
        await expect(pathItem).toBeFocused()
      }

      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      await expect(settings.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue(name)
      await settings.getByRole("button", { name: "Back to projects", exact: true }).click()
      await settings.getByRole("button", { name: "Back to app", exact: true }).click()
      await expect(settings).toBeHidden()
    }

    if (state.name === "local") {
      const navigation = page
        .locator('[data-slot="session-review-toggle"]')
        .getByRole("button", { name: "Projects", exact: true })

      await expect(navigation).toHaveAttribute("aria-expanded", "false")
      await navigation.click()
      const sidebar = page.locator("#shell-project-sidebar")
      await expect(sidebar).toBeVisible()
      await expect(sidebar.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0)
      await expect(sidebar.getByRole("button", { name: "Help", exact: true })).toHaveCount(0)
    }

    await trigger.click()
    await projectItem.click()
    await expect(page).toHaveURL(new URL("/", page.url()).href)
    const project = page.locator('[data-component="home-project-row"]').filter({ hasText: name })
    await expect(project).toHaveAttribute("data-selected", "")
    await expect(
      page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`),
    ).toBeVisible()

    if (state.name !== "local") return

    await expect(page.locator("#shell-project-sidebar")).toBeHidden()
    await expect(page.locator('[data-slot="home-projects-scroll"]')).toHaveCount(1)
    await expect(page.locator('[data-slot="home-panel"] [data-slot="home-projects-scroll"]')).toHaveCount(1)
    const home = page.locator('[data-slot="home-panel"]')
    await expect(home.getByRole("button", { name: "Settings", exact: true })).toBeVisible()
    await expect(home.getByRole("button", { name: "Help", exact: true })).toBeVisible()
    await project.click()
    await expect(project).not.toHaveAttribute("data-selected", "")
    await expect(
      page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`),
    ).toBeVisible()
  })
}

test("the project menu path arrow has a glyph when the page has an older icon sprite", async ({ page }) => {
  await mockStressTimeline(page)
  await seed(page, { projects: { local: [{ worktree: fixture.directory, expanded: true }] }, tabs: [fixture.targetID] })
  // A page cached before the arrow icon shipped carries a sprite without it.
  await page.route(
    (url) => url.pathname === sessionHref(fixture.targetID),
    async (route) => {
      const response = await route.fetch()
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          '<div id="root"',
          '<svg id="aigcfroge-v2-icon-sprite" width="0" height="0" aria-hidden="true"><symbol id="aigcfroge-v2-icon-monitor" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></symbol></svg><div id="root"',
        ),
      })
    },
  )
  await page.goto(sessionHref(fixture.targetID))
  const header = page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true }).locator("..")
  await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)
  await header.getByRole("button", { name: fixture.project.name, exact: true }).click()

  const arrow = page
    .getByRole("menu")
    .getByRole("menuitem", { name: fixture.directory, exact: true })
    .locator('[data-slot="session-project-open-icon"]')

  await expect(arrow).toHaveCount(1)
  await expect
    .poll(() => arrow.locator("svg").evaluate((element: SVGSVGElement) => element.getBBox().width))
    .toBeGreaterThan(0)
  await expect(page.locator("#aigcfroge-v2-icon-sprite")).toHaveCount(1)
})

test("B06 exposes explicit builtin roots on Custom and requires a selected project before preview", async ({
  page,
}) => {
  const creates: unknown[] = []
  const calls: string[] = []
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (/\/custom-composition\/(?:plan|start)$/.test(path) || /\/session\/[^/]+\/prompt$/.test(path)) calls.push(path)
  })
  await openHome(page, {
    sessions: [],
    skills: [],
    commands: [],
    onSessionCreate: (input) => void creates.push(input),
  })
  await selectGlobalMode(page, "Custom")
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  await expect(composition).toBeVisible()
  await expect(page.locator('[data-component="home-workspace-context"]')).toHaveCount(0)
  await expect(composition.getByRole("button", { name: "Build", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(composition.getByRole("button", { name: "Preview composition", exact: true })).toBeDisabled()
  await expect(composition.getByText("Choose a project to preview a composition.", { exact: true })).toBeVisible()
  await composition.getByRole("button", { name: "Plan", exact: true }).press("Enter")
  await expect(composition.getByRole("button", { name: "Plan", exact: true })).toHaveAttribute("aria-pressed", "true")
  await composition.getByRole("button", { name: "Meta", exact: true }).click()
  await expect(composition.getByRole("button", { name: "Meta", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.locator('[data-component="home-project-row"]').filter({ hasText: fixture.project.name }).click()
  await expect(
    page.locator('[data-component="home-workspace-context"]').getByText(fixture.directory, { exact: true }),
  ).toBeVisible()
  await expect(composition.getByText(fixture.directory, { exact: true })).toBeVisible()
  await expect(composition.getByRole("button", { name: "Preview composition", exact: true })).toBeEnabled()
  await expectPath(page, "/mode/custom")
  expect(calls).toEqual([])
  expect(creates).toEqual([])
})

test("B06 preserves the reviewed builtin root and chosen model through explicit plan and start without sending", async ({
  page,
}, testInfo) => {
  const directory = "/builtin/adoption"
  const plans: Composition.CompositionInput[] = []
  const starts: Composition.StartInput[] = []
  const prompts: unknown[] = []
  const creates: unknown[] = []
  const value = CustomCompositionFixture.plan("build")
  await mockWorkspace(page, {
    name: "Builtin Adoption",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    skills: [],
    commands: [],
    provider: provider({ id: "first", name: "Default model" }, { id: "selected", name: "Selected model" }),
    onCompositionPlan(input) {
      expect(input.directory).toBe(directory)
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(value)
    },
    onCompositionStart(input) {
      expect(input.directory).toBe(directory)
      starts.push(input.body)

      return CustomCompositionFixture.startAnswer(input.body, directory, value)
    },
    onPrompt: (input) => void prompts.push(input),
    onSessionCreate: (input) => void creates.push(input),
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Builtin Adoption" }).click()
  const model = composition.getByRole("group", { name: "Composition model", exact: true }).getByRole("button")
  await expect(model).toBeEnabled()
  await model.click()
  await page.getByRole("option", { name: "Selected model (aigcfroge)", exact: true }).click()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect(composition.getByRole("heading", { name: "Composition preview", exact: true })).toBeVisible()
  await expect(
    composition
      .getByLabel("Composition preview", { exact: true })
      .getByText(CustomCompositionFixture.revision, { exact: true }),
  ).toBeVisible()
  await expect(composition.getByText("Built-in", { exact: true })).toBeVisible()
  await expect(composition.locator("dl").getByText("Selected model (aigcfroge)", { exact: true })).toBeVisible()
  await expect(composition.getByText("Permissions are checked for each operation.", { exact: true })).toBeVisible()
  expect(starts).toEqual([])
  expect(prompts).toEqual([])
  await composition.getByRole("button", { name: "Cancel", exact: true }).click()
  await expect(composition.getByRole("heading", { name: "Composition preview", exact: true })).toHaveCount(0)
  await expect(model).toHaveText("Selected model (aigcfroge)")
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect(composition.getByRole("button", { name: "Create session", exact: true })).toBeEnabled()
  await composition.getByRole("button", { name: "Create session", exact: true }).press("Enter")
  await expect.poll(() => starts.length).toBe(1)
  const createdID = starts[0].sessionID
  expect(createdID).toMatch(/^ses_/)

  if (!createdID) throw new Error("Custom start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(createdID))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  const summary = page.locator('summary[aria-label="Adopted composition"]')
  await summary.click()
  const adopted = page.getByRole("region", { name: "Adopted composition", exact: true })
  await expect(adopted.getByText(CustomCompositionFixture.revision, { exact: true })).toBeVisible()
  await expect(adopted.getByText("Built-in", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("adopted-composition.png") })
  await page.reload()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await summary.click()
  await expect(adopted.getByText(CustomCompositionFixture.revision, { exact: true })).toBeVisible()
  expect(plans).toHaveLength(2)
  expect(plans[0]).toMatchObject({
    source: "temporary",
    root: { source: "builtin", id: "build" },
    agents: [],
    bindings: {},
    requestedCapabilities: [],
  })
  expect(plans[0].source === "temporary" ? plans[0].root?.revision : undefined).toBeUndefined()
  expect(starts[0]).toMatchObject({
    composition: value.input,
    expectedPlanDigest: value.digest,
    model: { id: "selected", providerID: "aigcfroge" },
  })
  expect(prompts).toEqual([])
  expect(creates).toEqual([])
})

test("B06 discards a late preview after the selected project changes and starts only the new owner", async ({
  page,
}) => {
  const directory = "/builtin/source-a"
  const nextDirectory = "/builtin/source-b"
  const pending = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const starts: { directory: string; body: Composition.StartInput }[] = []
  const first = CustomCompositionFixture.plan("build")
  const second = CustomCompositionFixture.plan("plan", { revision: "d".repeat(64), digest: "e".repeat(64) })
  await mockWorkspace(page, {
    name: "Source A",
    directory,
    project: { id: "proj_source_a" },
    projects: [
      project({ id: "proj_source_a", directory, name: "Source A" }),
      project({ id: "proj_source_b", directory: nextDirectory, name: "Source B" }),
    ],
    sessions: [],
    async onCompositionPlan(input) {
      if (input.directory === directory) {
        entered.resolve()
        await pending.promise
        finished.resolve()

        return CustomCompositionFixture.planAnswer(first)
      }

      expect(input.directory).toBe(nextDirectory)

      return CustomCompositionFixture.planAnswer(second)
    },
    onCompositionStart(input) {
      starts.push(input)

      return CustomCompositionFixture.startAnswer(input.body, input.directory, second, "proj_source_b")
    },
    seed: {
      tabs: [],
      projects: {
        local: [
          { worktree: directory, expanded: true },
          { worktree: nextDirectory, expanded: true },
        ],
      },
    },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Source A" }).click()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await entered.promise
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Source B" }).click()
  await expect(composition.getByText(nextDirectory, { exact: true })).toBeVisible()
  await expect(composition.getByRole("button", { name: "Create session", exact: true })).toHaveCount(0)
  await composition.getByRole("button", { name: "Plan", exact: true }).click()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect(
    composition.getByLabel("Composition preview", { exact: true }).getByText("d".repeat(64), { exact: true }),
  ).toBeVisible()
  pending.resolve()
  await finished.promise
  await expect(
    composition
      .getByLabel("Composition preview", { exact: true })
      .getByText(CustomCompositionFixture.revision, { exact: true }),
  ).toHaveCount(0)
  await expect(composition.getByRole("button", { name: "Plan", exact: true })).toHaveAttribute("aria-pressed", "true")
  await composition.getByRole("button", { name: "Create session", exact: true }).click()
  await expect.poll(() => starts.length).toBe(1)
  expect(starts[0]).toMatchObject({
    directory: nextDirectory,
    body: { composition: second.input, expectedPlanDigest: second.digest },
  })
  const createdID = starts[0].body.sessionID

  if (!createdID) throw new Error("Custom start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(createdID))
})

test("B06 preserves creation ACK after canonical readback fails and retries only opening the saved Session", async ({
  page,
}) => {
  const directory = "/builtin/readback"
  const state = { unavailable: true }
  const starts: Composition.StartInput[] = []
  const prompts: unknown[] = []
  const value = CustomCompositionFixture.plan("build")
  await mockWorkspace(page, {
    name: "Builtin Readback",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    onCompositionPlan: () => CustomCompositionFixture.planAnswer(value),
    onCompositionStart(input) {
      starts.push(input.body)

      return CustomCompositionFixture.startAnswer(input.body, directory, value)
    },
    sessionReadError: () => (state.unavailable ? new MockNotFound({ message: "Readback unavailable" }) : undefined),
    onPrompt: (input) => void prompts.push(input),
    seed: { tabs: [] },
  })
  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Builtin Readback" }).click()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await composition.getByRole("button", { name: "Create session", exact: true }).click()
  await expect(composition.getByRole("alert")).toContainText("Readback unavailable")
  await expect(
    composition.getByText("Session created. Submit a prompt in the session to begin.", { exact: true }),
  ).toBeVisible()
  await expect(composition.getByRole("button", { name: "Create session", exact: true })).toHaveCount(0)
  await expect(composition.getByRole("button", { name: "Open created session", exact: true })).toBeEnabled()
  expect(starts).toHaveLength(1)
  state.unavailable = false
  await composition.getByRole("button", { name: "Open created session", exact: true }).click()
  const createdID = starts[0].sessionID

  if (!createdID) throw new Error("Custom start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(createdID))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  expect(starts).toHaveLength(1)
  expect(prompts).toEqual([])
})

test("B06 retries a lost start reply with the same confirmation and adopts exactly one saved Session", async ({
  page,
}) => {
  const stream = await installSseTransport(page, { server: SERVER })
  const directory = "/builtin/lost-reply"
  const plans: Composition.CompositionInput[] = []
  const starts: Composition.StartInput[] = []
  const prompts: unknown[] = []
  const value = CustomCompositionFixture.plan("build")

  const workspace = await mockWorkspace(page, {
    name: "Builtin Lost Reply",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    onCompositionPlan(input) {
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(value)
    },
    onCompositionStart(input) {
      starts.push(input.body)

      return { ...CustomCompositionFixture.startAnswer(input.body, directory, value), disconnect: starts.length === 1 }
    },
    onPrompt: (input) => void prompts.push(input),
    seed: { tabs: [] },
  })

  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Builtin Lost Reply" }).click()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await composition.getByRole("button", { name: "Create session", exact: true }).click()
  await expect(composition.getByRole("button", { name: "Retry confirmation", exact: true })).toBeEnabled()
  expect(starts).toHaveLength(1)
  expect(workspace.sessions).toHaveLength(1)
  await expect(composition.getByRole("button", { name: "Build", exact: true })).toBeDisabled()
  await expect(composition.getByRole("button", { name: "Preview composition", exact: true })).toBeDisabled()
  const connection = await stream.waitForConnection()
  const nextConnection = stream.waitForConnection({ after: connection.id })
  await stream.disconnect("B06 reconnect after losing the start reply")
  const reconnected = await nextConnection
  expect(reconnected.id).toBeGreaterThan(connection.id)
  expect((await stream.connections()).find((item) => item.id === connection.id)?.endedBy).toBe("disconnect")
  await expect(composition.getByRole("button", { name: "Retry confirmation", exact: true })).toBeEnabled()
  expect(starts).toHaveLength(1)
  expect(plans).toHaveLength(1)
  expect(workspace.sessions).toHaveLength(1)
  await composition.getByRole("button", { name: "Retry confirmation", exact: true }).click()
  await expect.poll(() => starts.length).toBe(2)
  const createdID = starts[0].sessionID

  if (!createdID) throw new Error("Custom start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(createdID))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  expect(starts[1]).toEqual(starts[0])
  expect(workspace.sessions).toHaveLength(1)
  expect(workspace.sessions[0].id).toBe(createdID)
  expect(plans).toHaveLength(1)
  expect(prompts).toEqual([])
})

test("B06 releases a rejected stale confirmation for a new preview without creating or sending", async ({ page }) => {
  const directory = "/builtin/stale-confirmation"
  const revision = "d".repeat(64)
  const first = CustomCompositionFixture.plan("build")
  const revised = CustomCompositionFixture.plan("build", { revision, digest: "e".repeat(64) })
  const plans: Composition.CompositionInput[] = []
  const starts: Composition.StartInput[] = []
  const prompts: unknown[] = []
  const creates: unknown[] = []

  const workspace = await mockWorkspace(page, {
    name: "Builtin Stale Confirmation",
    directory,
    project: { id: "proj_custom_composition" },
    sessions: [],
    onCompositionPlan(input) {
      plans.push(input.body)

      return CustomCompositionFixture.planAnswer(plans.length === 1 ? first : revised)
    },
    onCompositionStart(input) {
      starts.push(input.body)

      if (starts.length === 1)
        return CustomCompositionFixture.staleAnswer("build", CustomCompositionFixture.revision, revision)

      return CustomCompositionFixture.startAnswer(input.body, directory, revised)
    },
    onPrompt: (input) => void prompts.push(input),
    onSessionCreate: (input) => void creates.push(input),
    seed: { tabs: [] },
  })

  await page.goto("/")
  await selectGlobalMode(page, "Custom")
  const composition = page.getByRole("region", { name: "Custom composition", exact: true })
  await page.locator('[data-component="home-project-row"]').filter({ hasText: "Builtin Stale Confirmation" }).click()
  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect(
    composition
      .getByLabel("Composition preview", { exact: true })
      .getByText(CustomCompositionFixture.revision, { exact: true }),
  ).toBeVisible()
  await composition.getByRole("button", { name: "Create session", exact: true }).click()
  await expect(composition.getByRole("alert")).toContainText(
    `Builtin root 'build' revision mismatch: expected ${CustomCompositionFixture.revision}, found ${revision}`,
  )
  await expect(composition.getByRole("button", { name: "Preview composition", exact: true })).toBeEnabled()
  await expect(composition.getByRole("button", { name: "Create session", exact: true })).toHaveCount(0)
  await expect(composition.getByRole("button", { name: "Retry confirmation", exact: true })).toHaveCount(0)
  await expect(composition.getByRole("button", { name: "Build", exact: true })).toHaveAttribute("aria-pressed", "true")
  expect(starts).toHaveLength(1)
  expect(workspace.sessions).toHaveLength(0)
  expect(prompts).toEqual([])
  expect(creates).toEqual([])

  await composition.getByRole("button", { name: "Preview composition", exact: true }).click()
  await expect(
    composition.getByLabel("Composition preview", { exact: true }).getByText(revision, { exact: true }),
  ).toBeVisible()
  await expect(
    composition
      .getByLabel("Composition preview", { exact: true })
      .getByText(CustomCompositionFixture.revision, { exact: true }),
  ).toHaveCount(0)
  await composition.getByRole("button", { name: "Create session", exact: true }).click()
  await expect.poll(() => starts.length).toBe(2)
  const createdID = starts[1].sessionID

  if (!createdID) throw new Error("Custom start did not preserve its reserved Session ID")

  await expectPath(page, sessionHref(createdID))
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  expect(starts[0]).toMatchObject({ composition: first.input, expectedPlanDigest: first.digest })
  expect(starts[1]).toMatchObject({ composition: revised.input, expectedPlanDigest: revised.digest })
  expect(workspace.sessions).toHaveLength(1)
  expect(workspace.sessions[0].id).toBe(createdID)
  expect(plans).toHaveLength(2)
  expect(prompts).toEqual([])
  expect(creates).toEqual([])
})

for (const entry of [
  { from: "list", mode: "chat", label: "Chat" },
  { from: "project", mode: "work", label: "Work" },
  { from: "titlebar", mode: "assistant", label: "Assistant" },
  { from: "shortcut", mode: "chat", label: "Chat" },
] as const) {
  test(`Home selected mode reaches ${entry.from} New and its created session`, async ({ page }) => {
    const creates: Schema.JsonObject[] = []
    await openHome(page, {
      sessions: entry.from === "project" ? await mockHomeScopeServers(page) : homeModeSessions(2),
      provider: provider({ id: "home-choice-model", name: "Home Choice Model" }),
      onSessionCreate: (body) => {
        creates.push(body)
      },
    })
    await selectHomeSessionMode(page, entry.label)
    await expectPath(page, "/")
    await expect(page.locator('[data-action="home-new-session"]')).toHaveText(`New ${entry.label} session`)

    if (entry.from === "list") await page.locator('[data-action="home-new-session"]').click()

    if (entry.from === "project") {
      const projectRow = page.locator('[data-component="home-project-row"]').filter({ hasText: fixture.project.name })

      const remoteProject = page
        .locator('[data-component="home-project-row"]')
        .filter({ hasText: "Scope remote project" })

      await remoteProject.click()
      await expect(remoteProject).toHaveAttribute("data-selected", "")
      await expect(homeSessionMode(page)).toHaveText(entry.label)
      await expect(row(page, "Home remote cached exact")).toBeVisible()
      await expect(page.locator('[data-action="home-new-session"]')).toHaveText(`New ${entry.label} session`)
      await projectRow.click()
      await expect(projectRow).toHaveAttribute("data-selected", "")
      await expect(remoteProject).not.toHaveAttribute("data-selected", "")
      await expect(homeSessionMode(page)).toHaveText(entry.label)
      await expect(row(page, "Home local cached exact")).toBeVisible()
      await expect(page.locator('[data-action="home-new-session"]')).toHaveText(`New ${entry.label} session`)
      await projectRow.hover()
      await projectRow.locator("..").locator('[data-action="home-project-new-session"]').click()
    }

    if (entry.from === "titlebar")
      await page.getByRole("banner").getByRole("button", { name: "New session", exact: true }).click()

    if (entry.from === "shortcut") await page.keyboard.press("Control+t")

    const draft = page.locator('[data-component="new-session"]')
    await expect(draft.locator('[data-component="composer-editor"]')).toBeEditable()
    await expect(draft.getByRole("button", { name: /^Session mode(?: |$)/ })).toHaveText(entry.label)
    expect(creates).toEqual([])
    await page.locator('[data-component="composer"]').getByRole("button", { name: "Choose agent", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "build", exact: true }).click()
    await draft.locator('[data-component="composer-editor"]').fill(`Create ${entry.mode} from Home ${entry.from}.`)
    await page.locator('[data-action="composer-submit"]').click()
    await expect.poll(() => creates).toEqual([expect.objectContaining({ mode: entry.mode, agent: "build" })])
    const created = creates[0]

    if (!created) throw new Error("Missing Home session creation")
    await expectPath(page, sessionHref(String(created.id)))
    await expect(
      page
        .getByRole("navigation", { name: "Modes", exact: true })
        .getByRole("button", { name: entry.label, exact: true }),
    ).toHaveAttribute("aria-current", "page")
  })
}

test("Home Custom selection opens the composition through list and titlebar New", async ({ page }) => {
  await openHome(page, { sessions: homeModeSessions(2) })
  await selectHomeSessionMode(page, "Custom")
  await page.locator('[data-action="home-new-session"]').click()
  await expectPath(page, "/mode/custom")
  await expect(page.getByRole("region", { name: "Custom composition", exact: true })).toBeVisible()
  await page.goto("/")
  await expect(homeSessionMode(page)).toHaveText("Custom")
  await page.getByRole("banner").getByRole("button", { name: "New session", exact: true }).click()
  await expectPath(page, "/mode/custom")
})

test("Home work summary loads waiting children, separates running work and opens the owning session", async ({
  page,
}, testInfo) => {
  const parentID = "ses_home_attention"
  const middleID = "ses_home_attention_delegate"
  const childID = "ses_home_attention_child"
  const runningID = "ses_home_running"
  const completedID = "ses_home_completed"
  const executions: string[] = []
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/session(?:$|\/[^/]+\/(?:prompt|interrupt)$)/.test(new URL(request.url()).pathname)
    )
      executions.push(request.url())
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockWorkspace(page, {
    name: "Home workspace",
    sessions: [
      { id: parentID, title: "Review project changes", mode: "work" },
      { id: middleID, parentID, title: "Review delegation", mode: "work" },
      { id: childID, parentID: middleID, title: "Review child", mode: "work" },
      { id: runningID, title: "Run the regression checks", mode: "work", outcome: "succeeded" },
      { id: completedID, title: "Updated project notes", mode: "work", outcome: "succeeded" },
    ],
    sessionStatus: { [childID]: { type: "busy" }, [runningID]: { type: "busy" } },
    sessionPermissions: {
      [childID]: [
        {
          id: "per_home_child",
          sessionID: childID,
          action: "read",
          resources: ["src/review.ts"],
          metadata: {},
          save: [],
        },
      ],
    },
    seed: { tabs: [] },
  })
  await page.goto("/")
  const summary = page.getByRole("complementary", { name: "Work summary", exact: true })
  const waiting = summary.getByRole("region", { name: "Needs your attention", exact: true })
  const running = summary.getByRole("region", { name: "In progress", exact: true })
  const completed = summary.getByRole("region", { name: "Recently completed", exact: true })
  await expect(waiting.getByRole("button", { name: /Review project changes/ })).toBeVisible()
  await expect(running.getByRole("button", { name: /Run the regression checks/ })).toBeVisible()
  await expect(running.getByRole("button", { name: /Review project changes/ })).toHaveCount(0)
  await expect(completed.getByRole("button", { name: /Updated project notes/ })).toBeVisible()
  await expect(completed.getByRole("button", { name: /Run the regression checks/ })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("home-summary-wide.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  await summary.scrollIntoViewIfNeeded()
  await expect(waiting.getByRole("button", { name: /Review project changes/ })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath("home-summary-narrow.png") })
  await waiting.getByRole("button", { name: /Review project changes/ }).click()
  await expectPath(page, sessionHref(parentID))
  await expect(page.locator('[data-component="dock-prompt"][data-kind="permission"]')).toContainText("src/review.ts")
  expect(executions).toEqual([])
})

test("global mode navigation drives Home and New without changing an existing draft", async ({ page }) => {
  const creates: unknown[] = []
  await page.setViewportSize({ width: 1280, height: 800 })
  await openHome(page, {
    sessions: homeModeSessions(),
    onSessionCreate: (input) => {
      creates.push(input)
    },
  })
  await expect(homeSessionMode(page)).toHaveText("Choose a session mode")
  const navigation = page.getByRole("navigation", { name: "Modes", exact: true })
  await expect(navigation.getByRole("button")).toHaveCount(5)
  await expect(navigation.getByRole("button", { name: "Modes", exact: true })).toHaveCount(0)
  await expect(navigation).toHaveCSS("width", "44px")
  const rail = await navigation.boundingBox()
  expect(rail?.x).toBe(await navigation.evaluate((element) => element.parentElement?.getBoundingClientRect().x))
  expect(rail?.height).toBeGreaterThan(200)
  const geometry = new Map<string, Awaited<ReturnType<typeof navigation.boundingBox>>>()

  const modes = [
    { id: "chat", label: "Chat" },
    { id: "coding", label: "Coding" },
    { id: "work", label: "Work" },
    { id: "assistant", label: "Assistant" },
    { id: "custom", label: "Custom" },
  ] as const

  for (const mode of modes) {
    const button = navigation.getByRole("button", { name: mode.label, exact: true })
    await expect(button.locator("svg use")).toHaveAttribute("href", `#aigcfroge-v2-icon-rail-${mode.id}`)
    await expect(button.locator("svg")).toHaveAttribute("width", "20")
    await expect(button).toHaveCSS("width", "40px")
    await expect(button).toHaveCSS("height", "40px")
    const strokes = page.locator(`#aigcfroge-v2-icon-rail-${mode.id} [stroke="currentColor"]`)
    expect(await strokes.count()).toBeGreaterThan(0)
    for (const stroke of await strokes.all()) await expect(stroke).toHaveCSS("stroke-width", "1.25px")
    geometry.set(mode.id, await button.boundingBox())
  }

  await expect(navigation.locator('[data-slot="active-indicator"]')).toHaveCount(5)
  const drafts: { href: string; label: string }[] = []

  for (const mode of modes.filter((mode) => mode.id !== "custom")) {
    await selectGlobalMode(page, mode.label)
    await expectPath(page, `/mode/${mode.id}`)
    await expect(homeSessionMode(page)).toHaveText(mode.label)
    await expect(
      page.getByRole("navigation", { name: "Modes" }).getByRole("button", { name: mode.label, exact: true }),
    ).toHaveAttribute("aria-current", "page")
    const button = navigation.getByRole("button", { name: mode.label, exact: true })
    const indicator = button.locator('[data-slot="active-indicator"]')
    await expect(indicator).toHaveCSS("opacity", "1")
    await expect(indicator).toHaveCSS("width", "2px")
    await expect(indicator).toHaveCSS("height", "20px")
    expect(await button.boundingBox()).toEqual(geometry.get(mode.id))
    await page.locator('[data-action="home-new-session"]').click()
    const editor = page.locator('[data-component="new-session"] [data-component="composer-editor"]')
    await expect(editor).toBeEditable()
    await expect(
      page.locator('[data-component="new-session"]').getByRole("button", { name: /^Session mode(?: |$)/ }),
    ).toHaveText(mode.label)
    await editor.fill(`Keep ${mode.id} draft`)
    drafts.push({ href: new URL(page.url()).pathname + new URL(page.url()).search, label: mode.label })
  }

  await expect(page.getByRole("navigation", { name: "Modes", exact: true })).toHaveCount(1)
  await selectGlobalMode(page, "Custom")
  await expectPath(page, "/mode/custom")
  await expect(homeSessionMode(page)).toHaveText("Custom")
  await expect(row(page, "Home custom session")).toBeVisible()
  await page.locator('[data-action="home-new-session"]').click()
  await expect(page.getByRole("region", { name: "Custom composition", exact: true })).toBeVisible()
  await expectPath(page, "/mode/custom")
  expect(creates).toEqual([])

  for (const draft of drafts) {
    await page.locator(`[data-titlebar-tab-link][href="${draft.href}"]`).click()
    await expect(
      page.locator('[data-component="new-session"]').getByRole("button", { name: /^Session mode(?: |$)/ }),
    ).toHaveText(draft.label)
    await expect(page.locator('[data-component="new-session"] [data-component="composer-editor"]')).toHaveText(
      `Keep ${draft.label.toLowerCase()} draft`,
    )
  }
})

test("Home requires a selected session mode before offering New", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await openHome(page, { sessions: homeModeSessions(2) })
  const projectRow = page.locator('[data-component="home-project-row"]').filter({ hasText: fixture.project.name })
  const create = page.locator('[data-action="home-new-session"]')
  const projectCreate = projectRow.locator("..").locator('[data-action="home-project-new-session"]')
  const drafts = page.locator('[data-titlebar-tab-link][href^="/new-session"]')
  await expect(projectRow).toBeEnabled()
  await expect(row(page, "Home coding session")).toBeVisible()
  await expect(row(page, "Home work session")).toBeVisible()
  await expect(create).toHaveCount(0)
  await expect(homeSessionMode(page)).toHaveText("Choose a session mode")
  await expect(projectCreate).toHaveCount(0)
  await expect(drafts).toHaveCount(0)
  await projectRow.click()
  await expect(projectRow).toHaveAttribute("data-selected", "")
  await expect(homeSessionMode(page)).toHaveText("Choose a session mode")
  await expect(create).toHaveCount(0)
  await expect(projectCreate).toHaveCount(0)
  await projectRow.hover()
  await projectRow.locator("..").getByRole("button", { name: "More options", exact: true }).click()
  const menu = page.getByRole("menu")
  await expect(menu.getByRole("menuitem", { name: "Edit project", exact: true })).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "New session", exact: true })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  await page.keyboard.press("Control+t")
  await expect(page.locator("[data-sonner-toast]").getByText("Choose a session mode", { exact: true })).toBeVisible()
  await expectPath(page, "/")
  await expect(drafts).toHaveCount(0)
  await expect(page.locator('[data-component="new-session"]')).toHaveCount(0)
  await homeSessionMode(page).click()
  const choices = page.getByRole("listbox")
  await expect(choices.getByRole("option")).toHaveText(["Chat", "Coding", "Work", "Assistant", "Custom"])
  await choices.getByRole("option", { name: "Work", exact: true }).click()
  await expect(homeSessionMode(page)).toHaveText("Work")
  await expect(create).toHaveText("New Work session")
  await expect(projectCreate).toBeEnabled()
  await expect(row(page, "Home work session")).toBeVisible()
  const reloaded = waitForHomeModeList(page, "work")
  await page.reload()
  expect(new URL((await reloaded).url()).searchParams.get("mode")).toBe("work")
  await expect(homeSessionMode(page)).toHaveText("Work")
  await expect(create).toHaveText("New Work session")
  await expect(drafts).toHaveCount(0)
})

test("Home filters mode before its quota, persists the filter, and keeps cross-mode tabs readable", async ({
  page,
}) => {
  const created: unknown[] = []
  const initialList = waitForHomeModeList(page)
  await openHome(
    page,
    {
      sessions: homeModeSessions(),
      onSessionCreate: (input) => {
        created.push(input)
      },
    },
    { tabs: ["ses_home_mode_coding_199"] },
  )
  expect(new URL((await initialList).url()).searchParams.get("mode")).toBeNull()
  const rows = page.locator('[data-component="home-session-row"]')
  const projectRow = page.locator('[data-component="home-project-row"]').filter({ hasText: fixture.project.name })
  const tab = page.locator(`[data-titlebar-tab-link][href="${sessionHref("ses_home_mode_coding_199")}"]`)
  await expect(homeSessionMode(page)).toHaveText("Choose a session mode")
  await expect(rows).toHaveCount(64)
  await expect(row(page, "Home work session")).toHaveCount(0)
  await expect(tab).toBeVisible()
  await expect(projectRow).toBeEnabled()

  for (const mode of [
    { value: "chat", label: "Chat", id: "ses_home_mode_chat_case" },
    { value: "work", label: "Work", id: "ses_home_mode_work_case" },
    { value: "assistant", label: "Assistant", id: "ses_home_mode_assistant_case" },
    { value: "custom", label: "Custom", id: "ses_home_mode_custom_case" },
  ] as const) {
    const requested = waitForHomeModeList(page, mode.value)
    await selectHomeSessionMode(page, mode.label)
    const query = new URL((await requested).url()).searchParams
    expect(query.get("mode")).toBe(mode.value)
    expect(query.get("parentID")).toBe("null")
    await expect(rows).toHaveCount(1)
    await expect(
      page.locator(`[data-component="home-session-row-container"][data-session-id="${mode.id}"]`),
    ).toBeVisible()
    await expect(tab).toBeVisible()
    await expect(projectRow).toBeEnabled()
  }

  expect(created).toHaveLength(0)

  await selectHomeSessionMode(page, "Work")
  await expect(row(page, "Home work session")).toBeVisible()
  const reloaded = waitForHomeModeList(page, "work")
  await page.reload()
  await reloaded
  await expect(homeSessionMode(page)).toHaveText("Work")
  await expect(rows).toHaveCount(1)
  await expect(row(page, "Home work session")).toBeVisible()
  await expect(tab).toBeVisible()

  await projectRow.click()
  await expect(projectRow).toHaveAttribute("data-selected", "")
  await expect(homeSessionMode(page)).toHaveText("Work")
  await expect(rows).toHaveCount(1)
  await projectRow.click()
  await expect(projectRow).not.toHaveAttribute("data-selected", "")
  await expect(homeSessionMode(page)).toHaveText("Work")
  await expect(rows).toHaveCount(1)

  await tab.click()
  await expectPath(page, sessionHref("ses_home_mode_coding_199"))
  await expect(page.getByRole("heading", { name: "Home coding 199", exact: true })).toBeVisible()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable({ timeout: APP_READY_TIMEOUT })
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expectPath(page, "/")
  await expect(homeSessionMode(page)).toHaveText("Work")
  await expect(rows).toHaveCount(1)
  await expect(row(page, "Home work session")).toBeVisible()
  await expect(tab).toBeVisible()
  expect(created).toHaveLength(0)
})

test("Home keeps Work selected across server A to B, reload, and back to A", async ({ page }) => {
  await openHome(
    page,
    { sessions: await mockHomeScopeServers(page) },
    {
      tabs: ["ses_home_scope_local_cached", { session: "ses_home_scope_remote_cached", server: REMOTE_SERVER }],
    },
  )

  const local = page
    .locator("[data-home-row]")
    .filter({ hasText: "Scope server A" })
    .getByRole("button", { name: /Scope server A/ })

  const remote = page
    .locator("[data-home-row]")
    .filter({ hasText: "Scope server B" })
    .getByRole("button", { name: /Scope server B/ })

  const rows = page.locator('[data-component="home-session-row-container"]')
  const tabs = page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab-link]')
  const localTab = tabs.filter({ hasText: "Home local cached exact" })
  const remoteTab = tabs.filter({ hasText: "Home remote cached exact" })

  const expectList = async (listed: ReturnType<typeof waitForHomeModeList>, server: string) => {
    const url = new URL((await listed).url())
    expect(url.origin).toBe(server)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "5000",
      order: "desc",
      parentID: "null",
      mode: "work",
    })
  }

  const expectHome = async (scope: "local" | "remote") => {
    await expectPath(page, "/")
    await expect(homeSessionMode(page)).toHaveText("Work")
    await expect(scope === "local" ? local : remote).toHaveAttribute("data-selected", "")
    await expect(scope === "local" ? remote : local).not.toHaveAttribute("data-selected", "")
    await expect(rows).toHaveCount(2)
    await expect(
      page.locator(`[data-component="home-session-row-container"][data-session-id="ses_home_scope_${scope}_cached"]`),
    ).toBeVisible()
    await expect(
      page.locator(`[data-component="home-session-row-container"][data-session-id="ses_home_scope_${scope}_pending"]`),
    ).toBeVisible()
    await expect(tabs).toHaveCount(2)
    await expect(localTab).toHaveAttribute("href", sessionHref("ses_home_scope_local_cached"))
    await expect(remoteTab).toHaveAttribute("href", sessionHref("ses_home_scope_remote_cached", REMOTE_SERVER))
    await expect(localTab).toBeVisible()
    await expect(remoteTab).toBeVisible()
  }

  await expect(homeSessionMode(page)).toHaveText("Choose a session mode")
  await expect(local).toHaveAttribute("data-selected", "")
  await expect(rows).toHaveCount(2)
  await expect(localTab).toBeVisible()
  await expect(remoteTab).toBeVisible()
  const firstWork = waitForHomeModeList(page, "work")
  await selectHomeSessionMode(page, "Work")
  await expectList(firstWork, SERVER)
  await expectHome("local")

  const remoteWork = waitForHomeModeList(page, "work")
  await expect(remote).toBeEnabled({ timeout: APP_READY_TIMEOUT })
  await remote.focus()
  await expect(remote).toBeFocused()
  await remote.press("Enter")
  await expectList(remoteWork, REMOTE_SERVER)
  await expectHome("remote")

  const reloadedWork = waitForHomeModeList(page, "work")
  await page.reload()
  await expectList(reloadedWork, REMOTE_SERVER)
  await expectHome("remote")

  const restoredWork = waitForHomeModeList(page, "work")
  await expect(local).toBeEnabled({ timeout: APP_READY_TIMEOUT })
  await local.focus()
  await expect(local).toBeFocused()
  await local.press("Enter")
  await expectList(restoredWork, SERVER)
  await expectHome("local")
})

test("Home mode scopes text and exact discovery, while mode omission and mutations keep their views consistent", async ({
  page,
}) => {
  await openHome(page, { sessions: homeModeSessions(0) })
  const rows = page.locator('[data-component="home-session-row"]')
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  const results = page.locator("#home-session-search-results")
  await expect(rows).toHaveCount(6)

  const unscoped = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/session/ses_home_mode_coding_case",
  )

  await search.fill("ses_home_mode_coding_case")
  const unscopedResponse = await unscoped
  expect(unscopedResponse.status()).toBe(200)
  expect(new URL(unscopedResponse.url()).searchParams.get("mode")).toBeNull()
  await expect(results.getByRole("option")).toHaveCount(1)
  await expect(results.getByRole("option")).toContainText("Home coding session")
  await search.fill("")
  const codingList = waitForHomeModeList(page, "coding")
  await selectHomeSessionMode(page, "Coding")
  await codingList
  await expect(rows).toHaveCount(2)
  await expect(row(page, "Home coding session")).toBeVisible()
  await expect(row(page, "Home legacy coding session")).toBeVisible()

  const workList = waitForHomeModeList(page, "work")
  await selectHomeSessionMode(page, "Work")
  await workList
  await expect(rows).toHaveCount(1)
  await search.fill("Home")
  await expect(results.getByRole("option")).toHaveCount(1)
  await expect(results.getByRole("option")).toContainText("Home work session")

  const mismatch = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/session/ses_home_mode_coding_case",
  )

  await search.fill("ses_home_mode_coding_case")
  const mismatchResponse = await mismatch
  expect(mismatchResponse.status()).toBe(200)
  expect(new URL(mismatchResponse.url()).searchParams.get("mode")).toBeNull()
  await expect(results.getByRole("option")).toHaveCount(0)
  await expect(results.getByText("No sessions found for ses_home_mode_coding_case", { exact: true })).toBeVisible()

  await search.fill("")
  await page.keyboard.press("ControlOrMeta+Shift+P")
  const palette = page.getByRole("dialog").filter({ has: page.getByPlaceholder("Search commands and sessions") })
  const paletteInput = palette.getByRole("textbox")
  await expect(paletteInput).toBeFocused()

  const paletteListed = page.waitForResponse((response) => {
    const url = new URL(response.url())

    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/session" &&
      url.searchParams.get("mode") === "work" &&
      url.searchParams.get("search") === "Home"
    )
  })

  await paletteInput.fill("Home")
  expect((await paletteListed).status()).toBe(200)
  const paletteSessions = palette.getByRole("option").filter({ hasText: /Home .* session/ })
  await expect(paletteSessions).toHaveCount(1)
  await expect(paletteSessions).toContainText("Home work session")

  const paletteExact = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/session/ses_home_mode_coding_case",
  )

  const paletteSearch = page.waitForResponse((response) => {
    const url = new URL(response.url())

    return (
      response.request().method() === "GET" &&
      url.pathname === "/api/session" &&
      url.searchParams.get("mode") === "work" &&
      url.searchParams.get("search") === "ses_home_mode_coding_case"
    )
  })

  await paletteInput.fill("ses_home_mode_coding_case")
  const paletteResponses = await Promise.all([paletteExact, paletteSearch])
  expect(paletteResponses.map((response) => response.status())).toEqual([200, 200])
  await expect(palette.getByRole("option")).toHaveCount(0)
  await expect(palette.getByText("No results found", { exact: true })).toBeVisible()
  await paletteInput.press("Escape")
  await expect(palette).toBeHidden()

  await row(page, "Home work session").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const title = page.locator('[data-component="home-session-rename"]')
  await expect(title).toBeFocused()
  await title.fill("Renamed Home work")

  const renamed = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === "/api/session/ses_home_mode_work_case",
  )

  await title.press("Enter")
  expect((await renamed).status()).toBe(204)
  await expect(title).toBeHidden()
  await expect(row(page, "Renamed Home work")).toBeVisible()
  await selectHomeSessionMode(page, "Coding")
  await expect(rows).toHaveCount(2)
  await expect(row(page, "Home coding session")).toBeVisible()
  await expect(row(page, "Home legacy coding session")).toBeVisible()
  await expect(row(page, "Renamed Home work")).toHaveCount(0)
  await selectHomeSessionMode(page, "Work")
  await expect(rows).toHaveCount(1)
  await expect(row(page, "Renamed Home work")).toBeVisible()

  await row(page, "Renamed Home work").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete…", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText('Delete session "Renamed Home work"?')

  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === "/api/session/ses_home_mode_work_case",
  )

  await dialog.getByRole("button", { name: "Delete session", exact: true }).click()
  expect((await removed).status()).toBe(204)
  await expect(dialog).toBeHidden()
  await expect(rows).toHaveCount(0)
  await selectHomeSessionMode(page, "Coding")
  await expect(rows).toHaveCount(2)
  await expect(row(page, "Renamed Home work")).toHaveCount(0)
  await expect(row(page, "Home legacy coding session")).toBeVisible()
  await selectHomeSessionMode(page, "Work")
  await expect(rows).toHaveCount(0)
})

test("a late Home exact reply cannot replace a result from the newly selected mode", async ({ page }) => {
  await openHome(page, { sessions: homeModeSessions(0) })
  const workList = waitForHomeModeList(page, "work")
  await selectHomeSessionMode(page, "Work")
  await workList
  await expect(row(page, "Home work session")).toBeVisible()
  const search = page.getByRole("textbox", { name: /Search sessions/ })
  const results = page.locator("#home-session-search-results")
  await search.fill("ses_home_mode_work_case")
  await expect(results.getByRole("option")).toHaveCount(1)
  await expect(results.getByRole("option")).toContainText("Home work session")
  await search.fill("Home")
  await expect(results.getByRole("option")).toHaveCount(1)
  await expect(results.getByRole("option")).toContainText("Home work session")

  const late = await holdRoute(page, (url) => url.pathname === "/api/session/ses_home_mode_work_case", {
    method: "GET",
  })

  const lateReply = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/session/ses_home_mode_work_case",
  )

  try {
    await search.fill("ses_home_mode_work_case")
    await late.arrived
    const codingList = waitForHomeModeList(page, "coding")
    await selectHomeSessionMode(page, "Coding")
    await codingList
    await expect(page.locator('[data-component="home-session-row"]')).toHaveCount(2)

    const currentReply = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/session/ses_home_mode_coding_case",
    )

    await search.fill("ses_home_mode_coding_case")
    expect((await currentReply).status()).toBe(200)
    await expect(results.getByRole("option")).toHaveCount(1)
    await expect(results.getByRole("option")).toContainText("Home coding session")

    late.release()
    const response = await lateReply
    expect(response.status()).toBe(200)
    await response.body()
    expect(await response.finished()).toBeNull()
    await expect(search).toHaveValue("ses_home_mode_coding_case")
    await expect(results.getByRole("option")).toHaveCount(1)
    await expect(results.getByRole("option")).toContainText("Home coding session")
    await expect(results.getByRole("option").filter({ hasText: "Home work session" })).toHaveCount(0)
  } finally {
    late.release()
  }
})

for (const state of ["cached", "pending"] as const) {
  test(`Home drops a ${state} exact owner when keyboard selection changes the server`, async ({ page }) => {
    await openHome(page, { sessions: await mockHomeScopeServers(page) })
    const search = page.getByRole("textbox", { name: /Search sessions/ })
    const results = page.locator("#home-session-search-results")
    const sourceID = `ses_home_scope_local_${state}`
    const sourceReply = waitForHomeScopeGet(page, sourceID)
    await search.fill(sourceID)
    expect((await sourceReply).status()).toBe(200)
    await expect(results.getByRole("option")).toHaveCount(1)
    await expect(results.getByRole("option")).toContainText(`Home local ${state} exact`)

    const late =
      state === "pending"
        ? await holdRoute(page, (url) => url.origin === SERVER && url.pathname === `/api/session/${sourceID}`, {
            method: "GET",
          })
        : undefined

    const lateReply = late ? waitForHomeScopeGet(page, sourceID) : undefined

    try {
      if (late) {
        await search.fill("Home")
        await expect(results.getByRole("option")).toHaveCount(2)
        await search.fill(sourceID)
        await late.arrived
      }

      const remote = page
        .locator("[data-home-row]")
        .filter({ hasText: "Scope server B" })
        .getByRole("button", { name: /Scope server B/ })

      await expect(remote).toBeEnabled({ timeout: APP_READY_TIMEOUT })
      const remoteList = waitForHomeScopeList(page, REMOTE_SERVER)
      // Keyboard activation has no outside pointerdown to close the old exact.
      await remote.focus()
      await expect(remote).toBeFocused()
      await remote.press("Enter")
      expect((await remoteList).status()).toBe(200)
      await expect(remote).toHaveAttribute("data-selected", "")
      await expect(row(page, "Home remote cached exact")).toBeEnabled()
      await expect(search).toHaveValue("")
      await expect(results.getByRole("option")).toHaveCount(0)
      await search.focus()
      await search.press("Enter")
      await expectPath(page, "/")
      await expect(
        page.locator(`[data-titlebar-tab-link][href="${sessionHref(sourceID, REMOTE_SERVER)}"]`),
      ).toHaveCount(0)

      if (late && lateReply) {
        const currentReply = waitForHomeScopeGet(page, "ses_home_scope_remote_cached", REMOTE_SERVER)
        await search.fill("ses_home_scope_remote_cached")
        expect((await currentReply).status()).toBe(200)
        await expect(results.getByRole("option")).toHaveCount(1)
        await expect(results.getByRole("option")).toContainText("Home remote cached exact")
        late.release()
        const response = await lateReply
        expect(response.status()).toBe(200)
        await response.body()
        expect(await response.finished()).toBeNull()
        await expect(search).toHaveValue("ses_home_scope_remote_cached")
        await expect(results.getByRole("option")).toHaveCount(1)
        await expect(results.getByRole("option")).toContainText("Home remote cached exact")
        await expect(
          page.locator(`[data-titlebar-tab-link][href="${sessionHref(sourceID, REMOTE_SERVER)}"]`),
        ).toHaveCount(0)
      }

      if (state !== "cached") return
      // Scope cancellation is already asserted above; this later selector cannot mask that red.
      const filtered = waitForHomeModeList(page, "work")
      await selectHomeSessionMode(page, "Work")
      expect(new URL((await filtered).url()).origin).toBe(REMOTE_SERVER)
      await expect(row(page, "Home remote cached exact")).toBeEnabled()
      // A fresh same-mode child remains readable; the exact path is not the root index filter.
      await expect(row(page, "Home remote child exact")).toHaveCount(0)
      const childReply = waitForHomeScopeGet(page, "ses_home_scope_remote_child", REMOTE_SERVER)
      await search.fill("ses_home_scope_remote_child")
      const response = await childReply
      expect(response.status()).toBe(200)
      expect((await response.json()).data.parentID).toBe("ses_home_scope_remote_cached")
      await expect(results.getByRole("option")).toHaveCount(1)
      await expect(results.getByRole("option")).toContainText("Home remote child exact")
      await results.getByRole("option").click()
      await expectPath(page, sessionHref("ses_home_scope_remote_child", REMOTE_SERVER))
      await expect(page.getByRole("heading", { name: "Home remote child exact", exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "Back to main session.", exact: true })).toBeEnabled()
    } finally {
      late?.release()
    }
  })
}

for (const state of ["cached", "pending"] as const) {
  test(`Home clears a ${state} exact owner when selected Project worktrees hydrate`, async ({ page }) => {
    const scope = homeScopeProjectFixture()
    await openHome(page, {
      sessions: scope.sessions,
      project: { ...fixture.project, sandboxes: [] },
      worktrees: scope.worktrees,
    })
    const search = page.getByRole("textbox", { name: /Search sessions/ })
    const results = page.locator("#home-session-search-results")
    const projectRow = page.locator('[data-component="home-project-row"]').filter({ hasText: fixture.project.name })
    await expect(row(page, "Home hydrated worktree")).toBeVisible()

    const inventory = await holdRoute(
      page,
      (url) =>
        url.origin === SERVER &&
        url.pathname === "/api/worktree" &&
        url.searchParams.get("projectID") === fixture.project.id,
      { method: "GET" },
    )

    const inventoryReply = page.waitForResponse((response) => {
      const url = new URL(response.url())

      return (
        response.request().method() === "GET" &&
        url.origin === SERVER &&
        url.pathname === "/api/worktree" &&
        url.searchParams.get("projectID") === fixture.project.id
      )
    })

    const sourceID = `ses_home_scope_local_${state}`

    try {
      await expect(projectRow).toBeEnabled()
      await projectRow.focus()
      await expect(projectRow).toBeFocused()
      await projectRow.press("Enter")
      await inventory.arrived
      await expect(projectRow).toHaveAttribute("data-selected", "")
      await expect(row(page, "Home hydrated worktree")).toHaveCount(0)
      const sourceReply = waitForHomeScopeGet(page, sourceID)
      await search.fill(sourceID)
      expect((await sourceReply).status()).toBe(200)
      await expect(results.getByRole("option")).toHaveCount(1)
      await expect(results.getByRole("option")).toContainText(`Home local ${state} exact`)

      // Warm the exact path before holding the next GET, so prefetch cannot stand in for its reply.
      const late =
        state === "pending"
          ? await holdRoute(page, (url) => url.origin === SERVER && url.pathname === `/api/session/${sourceID}`, {
              method: "GET",
            })
          : undefined

      const lateReply = late ? waitForHomeScopeGet(page, sourceID) : undefined

      try {
        if (late) {
          await search.fill("Home")
          await expect(results.getByRole("option")).toHaveCount(2)
          await search.fill(sourceID)
          await late.arrived
        }

        await expect(search).toBeFocused()

        // No UI action follows typing: the real inventory response changes the selected scope.
        inventory.release()
        const hydrated = await inventoryReply
        expect(hydrated.status()).toBe(200)
        await hydrated.body()
        expect(await hydrated.finished()).toBeNull()
        await expect(row(page, "Home hydrated worktree")).toBeEnabled()
        await expect(search).toHaveValue("")
        await expect(results.getByRole("option")).toHaveCount(0)

        if (late && lateReply) {
          late.release()
          const response = await lateReply
          expect(response.status()).toBe(200)
          await response.body()
          expect(await response.finished()).toBeNull()
          await expect(search).toHaveValue("")
          await expect(results.getByRole("option")).toHaveCount(0)
        }

        // The DOM input kept focus during hydration. New typing must reopen live results.
        await expect(search).toBeFocused()
        await search.pressSequentially("Home")
        await expect(results).toBeVisible()
        await expect(results.getByRole("option")).toHaveCount(3)
        await expect(results.getByRole("option").filter({ hasText: "Home local cached exact" })).toBeVisible()
        await expect(results.getByRole("option").filter({ hasText: "Home local pending exact" })).toBeVisible()
        await expect(results.getByRole("option").filter({ hasText: "Home hydrated worktree" })).toBeVisible()
        await expectPath(page, "/")
        await expect(page.locator(`[data-titlebar-tab-link][href="${sessionHref(sourceID)}"]`)).toHaveCount(0)
      } finally {
        late?.release()
      }
    } finally {
      inventory.release()
    }
  })
}
