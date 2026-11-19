import type {
  AigcForgeEvent,
  SessionMessageInfo,
  DelegationLegacyState,
  DelegationResultInput,
  WorkflowAssetWorkflowStatusResponse,
  WorkflowAssetInfo,
  SessionInstanceCacheDiagnostics,
  MetaAgentMemoryRecord,
  SessionAttemptInfo,
  SessionMessageAssistant,
} from "@aigcfroge/client/promise"
import { ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Composition } from "@aigcfroge/schema/composition"
import { SessionEvent } from "@aigcfroge/schema/session-event"
import { WorkflowEvent } from "@aigcfroge/schema/workflow-event"
import { timelinePresets } from "@aigcfroge/session-ui/timeline/detail"
import { expect, test, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { Schema } from "effect"
import { provider, REMOTE_SERVER, seed, session, sessionHref, SERVER } from "../utils/app"
import { installSseTransport } from "../utils/sse-transport"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { homeModeSessions, waitForHomeModeList } from "../utils/home-mode"
import { expectSessionTitle } from "../utils/waits"
import { mockRemoteServer, mockWorkspace, openSession } from "../utils/workspace"
import { attachSession, openAdvanced, openSidePanel } from "../utils/side-panel"

const tabs = (page: Page) => page.locator('[data-slot="titlebar-tabs"] a')

for (const direction of ["ltr", "rtl"] as const) {
  test(`session header groups controls and exposes session details in ${direction}`, async ({ page }, testInfo) => {
    const work = homeModeSessions(0).find((item) => item.id === "ses_home_mode_work_case")

    const otherProject = {
      ...fixture.project,
      id: "prj_sidebar_other_project",
      worktree: fixture.directory + "/other-project",
      name: "Sidebar other project",
    }

    const otherSession = session({
      id: "ses_sidebar_other_project",
      directory: otherProject.worktree,
      projectID: otherProject.id,
      title: "Sidebar other project session",
      mode: "coding",
    })

    const recent = Array.from({ length: 4 }, (_, index) =>
      session({
        id: "ses_sidebar_recent_" + index,
        directory: fixture.directory,
        projectID: fixture.project.id,
        title: "Sidebar recent " + index,
        created: 1700000000000 - (index + 1) * 1000,
        mode: "coding",
      }),
    )

    const older = recent[3]

    const workUnread = Array.from({ length: 2 }, (_, index) =>
      session({
        id: "ses_sidebar_work_unread_" + index,
        directory: fixture.directory,
        projectID: fixture.project.id,
        title: "Sidebar Work unread " + index,
        mode: "work",
      }),
    )

    const recovered = session({
      id: "ses_sidebar_missing_metadata",
      directory: fixture.directory,
      projectID: fixture.project.id,
      title: "Sidebar recovered notification session",
      created: 1700000000000 - 5000,
      mode: "coding",
    })

    if (!work) throw new Error("The shared mode fixture must contain the Work session")

    if (!older) throw new Error("The sidebar fixture must contain the sixth Coding session")

    const sessions = [
      ...fixture.sessions.map((item) => ({ ...item, mode: "coding" })),
      ...(direction === "ltr" ? [work, ...workUnread, otherSession, ...recent] : []),
    ]

    const mocked = await mockStressTimeline(page, {
      sessions,
      projects: [fixture.project, ...(direction === "ltr" ? [otherProject] : [])],
    })

    await seed(page, {
      projects: {
        local: [
          { worktree: fixture.directory, expanded: true },
          ...(direction === "ltr" ? [{ worktree: otherProject.worktree, expanded: true }] : []),
        ],
      },
      lastProject: { local: fixture.directory },
      tabs: [fixture.sourceID, fixture.targetID, ...(direction === "ltr" ? [work.id] : [])],
      settings: { general: { showStatus: true, showFileTree: false } },
      storage: {
        "aigcfroge.global.dat:notification": {
          list:
            direction === "ltr"
              ? [
                  {
                    type: "turn-complete",
                    directory: fixture.directory,
                    session: recovered.id,
                    viewed: false,
                    time: Date.now(),
                  },
                ]
              : [],
        },
        "aigcfroge.global.dat:layout": {
          sidebar: { opened: false, width: 260, workspaces: {}, workspacesDefault: false },
          home: { mode: "work", selection: { server: SERVER } },
          fileTree: { opened: false, width: 240, tab: "changes" },
        },
      },
    })
    await page.goto(sessionHref(fixture.targetID))
    const header = page.locator("[data-session-title]")
    const more = header.getByRole("button", { name: "More options", exact: true })
    const project = header.getByRole("button", { name: fixture.project.name, exact: true })
    const actions = page.locator('[data-slot="session-review-toggle"]')
    const navigation = actions.getByRole("button", { name: "Projects", exact: true })
    const review = actions.getByRole("button", { name: "Toggle review", exact: true })
    const projectPanel = page.locator("#shell-project-sidebar")
    const filePanel = page.locator("#file-tree-panel")
    const sidePanel = page.locator("#session-side-panel-tabs")
    const exposedSide = page.locator('#session-side-panel-tabs:not([aria-hidden="true"][inert])')
    const details = header.getByRole("button", { name: "Session details", exact: true })
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)
    await expect(
      header.getByRole("button", { name: /^(Skill|Command|Prompt|Agent|MCP|Plugin|Workflow) proposals$/ }),
    ).toHaveCount(0)
    await page.evaluate((direction) => document.documentElement.setAttribute("dir", direction), direction)
    await expect(navigation).toBeVisible()
    await expect(navigation).toHaveAttribute("aria-controls", "shell-project-sidebar")
    await expect(review).toBeVisible()
    await expect(review).toHaveAttribute("aria-controls", "session-side-panel-tabs")
    await expect(navigation).toHaveAttribute("aria-expanded", "false")
    await expect(review).toHaveAttribute("aria-expanded", "false")
    await expect(projectPanel).toBeHidden()
    await expect(projectPanel).toHaveAttribute("aria-hidden", "true")
    await expect(projectPanel).toHaveJSProperty("inert", true)
    await expect(filePanel).toBeHidden()
    await expect(sidePanel).toBeHidden()
    await expect(exposedSide).toHaveCount(0)
    await expect(details).toBeVisible()
    await expect(page.locator('[data-slot="titlebar-v2"]').getByRole("button", { name: "Status" })).toHaveCount(0)
    const titleBounds = await header.getByRole("heading").boundingBox()
    expect(titleBounds).not.toBeNull()

    const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}"))

    for (const current of [
      { button: navigation, icon: "layout-left", narrowLeft: true },
      { button: review, icon: "sidebar-right", narrowLeft: false },
    ]) {
      const icon = current.button.locator('[data-slot="icon-svg"]')
      await expect(icon.locator("use")).toHaveAttribute("href", `#aigcfroge-v2-icon-${current.icon}`)
      await expect
        .poll(() =>
          icon.evaluate((element, narrowLeft) => {
            const use = element.querySelector("use")
            const href = use?.getAttribute("href")

            if (!use || !href) return 1

            const bounds = use.getBBox()
            const paths = Array.from(document.querySelectorAll<SVGPathElement>(`${href} path`))

            // Sample the visible divider, excluding the frame's outer edges.
            const divider = Array.from(
              { length: 101 },
              (_, index) => bounds.x + bounds.width * (0.15 + index * 0.007),
            ).filter((x) =>
              paths.some((path) => {
                const point = new DOMPoint(x, bounds.y + bounds.height / 2)
                const paint = getComputedStyle(path)

                return (
                  (paint.fill !== "none" && path.isPointInFill(point)) ||
                  (paint.stroke !== "none" && path.isPointInStroke(point))
                )
              }),
            )

            if (!divider.length || !bounds.width) return 1

            const ratio = ((Math.min(...divider) + Math.max(...divider)) / 2 - bounds.x) / bounds.width

            return narrowLeft ? ratio : 1 - ratio
          }, current.narrowLeft),
        )
        .toBeLessThan(0.5)
    }

    for (const editing of [false, true]) {
      if (editing) {
        await header.getByRole("heading").click()
        await expect(header.getByRole("textbox")).toHaveValue(fixture.expected.targetTitle)
        await expect(header.getByRole("textbox")).toBeFocused()
      }

      await expect(header.locator('[data-slot="session-title-child"]')).toHaveCSS("padding-left", "4px")
      await expect(header.locator('[data-slot="session-title-child"]')).toHaveCSS("padding-right", "4px")
      await expect
        .poll(async () => {
          const [icon, title, menu, navigationBounds, sidebar, summary] = await Promise.all(
            [project, header.locator('[data-slot="session-title-child"]'), more, navigation, review, details].map(
              (control) => control.boundingBox(),
            ),
          )

          if (!icon || !title || !menu || !navigationBounds || !sidebar || !summary || !titleBounds) return false

          if (Math.abs(title.y - titleBounds.y) > 0.5 || Math.abs(title.height - titleBounds.height) > 0.5) return false

          if (Math.abs(navigationBounds.width - 28) > 0.5 || Math.abs(sidebar.width - 28) > 0.5) return false

          if (Math.abs(sidebar.x - navigationBounds.x - navigationBounds.width - 8) > 0.5) return false

          return direction === "ltr"
            ? Math.abs(title.x - icon.x - icon.width - 2) <= 0.5 &&
                Math.abs(menu.x - title.x - title.width - 2) <= 0.5 &&
                menu.x + menu.width <= summary.x &&
                summary.x + summary.width <= navigationBounds.x
            : Math.abs(icon.x - title.x - title.width - 2) <= 0.5 &&
                Math.abs(title.x - menu.x - menu.width - 2) <= 0.5 &&
                sidebar.x + sidebar.width <= summary.x &&
                summary.x + summary.width <= menu.x
        })
        .toBe(true)
    }

    await header.getByRole("textbox").press("Escape")
    await expect(header.getByRole("heading")).toHaveText(fixture.expected.targetTitle)

    await navigation.focus()
    await expect(navigation).toBeFocused()
    const sidebarLoad = direction === "ltr" ? waitForHomeModeList(page, "coding") : undefined
    await navigation.press("Space")

    if (sidebarLoad) await sidebarLoad
    await expect(navigation).toHaveAttribute("aria-expanded", "true")
    await expect(projectPanel).toBeVisible()
    await expect(filePanel).toBeHidden()
    await expect(review).toHaveAttribute("aria-expanded", "false")
    await expect(sidePanel).toBeHidden()
    await expect(exposedSide).toHaveCount(0)

    if (direction === "ltr") {
      const sidebarProject = projectPanel
        .locator('[data-component="home-project-row"]')
        .filter({ hasText: fixture.project.name })

      const projectGroup = sidebarProject.locator("../..")
      const projectIcon = sidebarProject.locator('[data-slot="icon-svg"] use')

      const otherGroup = projectPanel
        .locator('[data-component="home-project-row"]')
        .filter({ hasText: otherProject.name })
        .locator("../..")

      const target = projectGroup
        .locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`)
        .locator('[data-component="home-session-row"]')

      const source = projectGroup
        .locator(`[data-component="home-session-row-container"][data-session-id="${fixture.sourceID}"]`)
        .locator('[data-component="home-session-row"]')

      const workRow = projectGroup
        .locator(`[data-component="home-session-row-container"][data-session-id="${work.id}"]`)
        .locator('[data-component="home-session-row"]')

      const other = otherGroup
        .locator(`[data-component="home-session-row-container"][data-session-id="${otherSession.id}"]`)
        .locator('[data-component="home-session-row"]')

      const olderRow = projectGroup
        .locator(`[data-component="home-session-row-container"][data-session-id="${older.id}"]`)
        .locator('[data-component="home-session-row"]')

      const unreadBadge = sidebarProject.locator("..").locator('[data-component="tag"]')
      const retry = sidebarProject.locator("..").getByRole("button", { name: "Try again", exact: true })
      const showMore = projectGroup.getByRole("button", { name: "Show more", exact: true })
      const showLess = projectGroup.getByRole("button", { name: "Show less", exact: true })

      await expect(sidebarProject).toHaveAttribute("aria-expanded", "true")
      await expect(projectIcon).toHaveAttribute("href", "#aigcfroge-v2-icon-folder-open")
      await expect(retry).toBeVisible()
      await expect(unreadBadge).toHaveCount(0)
      await expect(target.locator('[data-component="home-session-title"]')).toHaveText(fixture.expected.targetTitle)
      await expect(target.locator('[data-component="project-avatar-v2"]')).toHaveCount(0)
      await expect(source.locator('[data-component="home-session-title"]')).toHaveText(fixture.expected.sourceTitle)
      await expect(projectGroup.locator('[data-component="home-session-row"]')).toHaveCount(5)
      await expect(olderRow).toBeHidden()
      await expect(showMore).toHaveAttribute("aria-expanded", "false")
      await expect(otherGroup.locator('[data-component="home-session-row"]')).toHaveCount(1)
      await expect(projectGroup.locator(`[data-session-id="${otherSession.id}"]`)).toHaveCount(0)
      await expect(other.locator('[data-component="home-session-title"]')).toHaveText(otherSession.title)
      await expect(otherGroup.locator(`[data-session-id="${fixture.targetID}"]`)).toHaveCount(0)
      await expect(workRow).toHaveCount(0)
      await expect(target).toHaveAttribute("aria-current", "page")
      await expect(target).toHaveAttribute("data-selected", "")
      await expect(source).not.toHaveAttribute("aria-current", "page")

      await showMore.focus()
      await expect(showMore).toBeFocused()
      await showMore.press("Enter")
      await expect(showLess).toHaveAttribute("aria-expanded", "true")
      await expect(projectGroup.locator('[data-component="home-session-row"]')).toHaveCount(6)
      await olderRow.click()
      await expectSessionTitle(page, older.title)
      await expect(olderRow).toHaveAttribute("aria-current", "page")
      await showLess.click()
      await expect(olderRow).toBeVisible()
      await expect(olderRow).toHaveAttribute("aria-current", "page")
      await expect(projectGroup.locator('[data-component="home-session-row"]')).toHaveCount(6)
      await target.click()
      await expectSessionTitle(page, fixture.expected.targetTitle)
      await expect(projectGroup.locator('[data-component="home-session-row"]')).toHaveCount(5)
      await expect(olderRow).toBeHidden()

      await page.goto(sessionHref(fixture.childID))
      await expectSessionTitle(page, fixture.expected.childTitle)
      await expect(projectGroup.locator(`[data-session-id="${fixture.childID}"]`)).toHaveCount(0)
      await expect(projectGroup.locator('[data-component="home-session-row"]')).toHaveCount(5)
      await header.getByRole("button", { name: fixture.expected.sourceTitle, exact: true }).click()
      await expectSessionTitle(page, fixture.expected.sourceTitle)
      await expect(page).toHaveURL(new URL(sessionHref(fixture.sourceID), page.url()).href)
      await page.locator(`[data-titlebar-tab-link][href="${sessionHref(fixture.targetID)}"]`).click()
      await expectSessionTitle(page, fixture.expected.targetTitle)
      await expect(target).toHaveAttribute("aria-current", "page")

      const notificationEvents = [
        ...Array.from(
          { length: 3 },
          (_, index) =>
            ({
              id: "evt_sidebar_coding_unread_" + index,
              type: SessionEvent.Execution.Succeeded.type,
              created: 1700000001000 + index,
              durable: { aggregateID: older.id, seq: index + 1, version: 1 },
              data: { sessionID: older.id },
            }) satisfies AigcForgeEvent,
        ),
        ...workUnread.map(
          (item, index) =>
            ({
              id: "evt_sidebar_work_unread_" + index,
              type: SessionEvent.Execution.Succeeded.type,
              created: 1700000002000 + index,
              durable: { aggregateID: item.id, seq: 1, version: 1 },
              data: { sessionID: item.id },
            }) satisfies AigcForgeEvent,
        ),
      ]

      await mocked.push(notificationEvents)
      await expect(unreadBadge).toHaveText("3")
      await expect(retry).toBeVisible()
      await expect
        .poll(async () => {
          const [labelBounds, badgeBounds, retryBounds] = await Promise.all(
            [sidebarProject.locator('[data-slot="home-row-label"]'), unreadBadge, retry].map((element) =>
              element.boundingBox(),
            ),
          )

          if (!labelBounds || !badgeBounds || !retryBounds) return -Infinity

          return Math.min(
            badgeBounds.x - labelBounds.x - labelBounds.width,
            retryBounds.x - badgeBounds.x - badgeBounds.width,
          )
        })
        .toBeGreaterThanOrEqual(0)
      await sidebarProject.hover({ position: { x: 16, y: 10 } })
      await sidebarProject.locator("..").getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menu").getByRole("menuitem", { name: "Clear notifications", exact: true }).click()
      await expect(unreadBadge).toHaveCount(0)
      await expect(retry).toBeVisible()

      await source.click({ button: "middle" })
      await expect(page).toHaveURL(new URL(sessionHref(fixture.targetID), page.url()).href)
      await expect(target).toHaveAttribute("aria-current", "page")
      await expect(source).not.toHaveAttribute("aria-current", "page")

      await source.click()
      await expectSessionTitle(page, fixture.expected.sourceTitle)
      await expect(page).toHaveURL(new URL(sessionHref(fixture.sourceID), page.url()).href)
      await expect(source).toHaveAttribute("aria-current", "page")
      await expect(target).not.toHaveAttribute("aria-current", "page")
      await expect(projectPanel.locator('[data-component="home-session-row"][aria-current="page"]')).toHaveCount(1)

      await other.click()
      await expectSessionTitle(page, otherSession.title)
      await expect(page).toHaveURL(new URL(sessionHref(otherSession.id), page.url()).href)
      await expect(other).toHaveAttribute("aria-current", "page")
      await expect(source).not.toHaveAttribute("aria-current", "page")
      await expect(projectPanel.locator('[data-component="home-session-row"][aria-current="page"]')).toHaveCount(1)

      await target.click()
      await expectSessionTitle(page, fixture.expected.targetTitle)
      await expect(target).toHaveAttribute("aria-current", "page")

      const pointerDown = await page.evaluateHandle(() => ({
        result: new Promise<{
          project: string | null
          selected: string | null
          expanded: string | null
          background: string | null
          url: string
        }>((resolve) => {
          // Window bubbling observes the row handler before the native click.
          window.addEventListener(
            "pointerdown",
            (event) => {
              const row =
                event.target instanceof Element ? event.target.closest('[data-component="home-project-row"]') : null

              resolve({
                project: row?.textContent?.trim() ?? null,
                selected: row?.getAttribute("data-selected") ?? null,
                expanded: row?.getAttribute("aria-expanded") ?? null,
                background: row?.parentElement ? getComputedStyle(row.parentElement).backgroundColor : null,
                url: location.href,
              })
            },
            { once: true },
          )
        }),
      }))

      await sidebarProject.click({ position: { x: 16, y: 10 } })
      const pressed = await pointerDown.evaluate((value) => value.result)
      await pointerDown.dispose()
      expect(pressed.project).toBe(fixture.project.name)
      expect(pressed.selected).toBe("")
      expect(pressed.expanded).toBe("true")
      expect(pressed.background).toBe("rgba(0, 0, 0, 0)")
      expect(pressed.url).toBe(new URL(sessionHref(fixture.targetID), page.url()).href)
      await expect(sidebarProject).toHaveAttribute("aria-expanded", "false")
      await expect(projectIcon).toHaveAttribute("href", "#aigcfroge-v2-icon-folder")
      await expect(target).toBeHidden()
      await expect(page).toHaveURL(new URL(sessionHref(fixture.targetID), page.url()).href)
      await sidebarProject.focus()
      await expect(sidebarProject).toBeFocused()
      await sidebarProject.press("Enter")
      await expect(sidebarProject).toHaveAttribute("aria-expanded", "true")
      await expect(projectIcon).toHaveAttribute("href", "#aigcfroge-v2-icon-folder-open")
      await expect(sidebarProject).toHaveAttribute("data-selected", "")
      await expect(target).toHaveAttribute("aria-current", "page")

      const workLoad = waitForHomeModeList(page, "work")
      await page.locator(`[data-titlebar-tab-link][href="${sessionHref(work.id)}"]`).click()
      await workLoad
      await expectSessionTitle(page, work.title)
      await expect(workRow).toHaveAttribute("aria-current", "page")
      await expect(projectPanel.locator('[data-component="home-session-row"]')).toHaveCount(3)

      try {
        await expect(unreadBadge).toHaveText("2")

        for (const session of workUnread) {
          const row = projectGroup
            .locator(`[data-component="home-session-row-container"][data-session-id="${session.id}"]`)
            .locator('[data-component="home-session-row"]')

          const badge = row.locator('[data-component="tag"]')

          await expect(badge).toHaveText("1")
          await expect(row.locator('[data-component="project-avatar-v2"]')).toHaveCount(0)
          await expect
            .poll(async () => {
              const [title, status] = await Promise.all([
                row.locator('[data-component="home-session-title"]').boundingBox(),
                badge.boundingBox(),
              ])

              if (!title || !status) return -Infinity

              return status.x - title.x - title.width
            })
            .toBeGreaterThanOrEqual(0)
        }
      } finally {
        await testInfo.attach("work-project-notifications", {
          body: JSON.stringify({
            badge: await unreadBadge.textContent(),
            activeSessionID: work.id,
            events: notificationEvents,
            persisted: await page.evaluate(() => localStorage.getItem("aigcfroge.global.dat:notification")),
          }),
          contentType: "application/json",
        })
      }

      await expect(target).toHaveCount(0)
      await expect(source).toHaveCount(0)
      await expect(other).toHaveCount(0)
      await sidebarProject.hover({ position: { x: 16, y: 10 } })
      await sidebarProject.locator("..").getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menu").getByRole("menuitem", { name: "Clear notifications", exact: true }).click()
      await expect(unreadBadge).toHaveCount(0)
      await page.locator(`[data-titlebar-tab-link][href="${sessionHref(fixture.targetID)}"]`).click()
      await expectSessionTitle(page, fixture.expected.targetTitle)
      await expect(target).toHaveAttribute("aria-current", "page")
      await expect(workRow).toHaveCount(0)
      await expect(projectGroup.locator('[data-component="home-session-row"]')).toHaveCount(5)
      await expect(otherGroup.locator('[data-component="home-session-row"]')).toHaveCount(1)

      await expect(retry).toBeVisible()
      await expect(unreadBadge).toHaveCount(0)
      sessions.push(recovered)

      const recoveredRead = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).origin === SERVER &&
          new URL(response.url()).pathname === `/api/session/${recovered.id}` &&
          response.status() === 200,
      )

      await retry.click()
      expect((await recoveredRead).ok()).toBe(true)
      await expect(retry).toHaveCount(0)
      await expect(unreadBadge).toHaveText("1")
      await expect(target).toHaveAttribute("aria-current", "page")
      await expect(sidebarProject).toHaveAttribute("aria-expanded", "true")
      await expect(page).toHaveURL(new URL(sessionHref(fixture.targetID), page.url()).href)
      await sidebarProject.hover({ position: { x: 16, y: 10 } })
      await sidebarProject.locator("..").getByRole("button", { name: "More options", exact: true }).click()
      await page.getByRole("menu").getByRole("menuitem", { name: "Clear notifications", exact: true }).click()
      await expect(unreadBadge).toHaveCount(0)
    }

    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "true")
    await expect(sidePanel).toBeVisible()
    await expect(sidePanel).toHaveAttribute("aria-hidden", "false")
    await expect(sidePanel).toHaveJSProperty("inert", false)
    await expect(navigation).toHaveAttribute("aria-expanded", "true")
    await expect(projectPanel).toBeVisible()
    await expect(projectPanel).toHaveAttribute("aria-hidden", "false")
    await expect(projectPanel).toHaveJSProperty("inert", false)

    if (direction === "ltr") {
      const projectBody = projectPanel.getByRole("complementary", { name: "Projects", exact: true })
      const conversation = page.locator('[data-slot="session-chat-panel"]')
      const reviewBody = page.locator("#review-panel")
      const modes = page.getByRole("navigation", { name: "Modes", exact: true })

      await expect
        .poll(async () => {
          const [project, chat, side] = await Promise.all(
            [projectBody, conversation, reviewBody].map((panel) => panel.boundingBox()),
          )

          if (!project || !chat || !side) return { aligned: false, projectGap: null, reviewGap: null }

          return {
            aligned:
              Math.max(project.y, chat.y, side.y) - Math.min(project.y, chat.y, side.y) <= 0.5 &&
              Math.max(project.y + project.height, chat.y + chat.height, side.y + side.height) -
                Math.min(project.y + project.height, chat.y + chat.height, side.y + side.height) <=
                0.5,
            projectGap: Math.round(chat.x - project.x - project.width),
            reviewGap: Math.round(side.x - chat.x - chat.width),
          }
        })
        .toEqual({ aligned: true, projectGap: 8, reviewGap: 8 })

      const [projectPaint, reviewPaint, modePaint] = await Promise.all(
        [projectBody, reviewBody, modes].map((panel) =>
          panel.evaluate((element) => {
            type PanelPaint = { color: string; shadow: string }

            const paint = (current: Element | null): PanelPaint => {
              if (!current) return { color: "", shadow: "" }
              const style = getComputedStyle(current)

              return style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent"
                ? paint(current.parentElement)
                : { color: style.backgroundColor, shadow: style.boxShadow }
            }

            return paint(element)
          }),
        ),
      )

      expect(projectPaint?.color).toBe(reviewPaint?.color)
      expect(projectPaint?.color).not.toBe(modePaint?.color)
      expect(projectPaint?.shadow).toBe("none")
    }

    await expect(filePanel).toBeHidden()
    await navigation.click()
    await expect(navigation).toHaveAttribute("aria-expanded", "false")
    await expect(projectPanel).toBeHidden()
    await expect(projectPanel).toHaveAttribute("aria-hidden", "true")
    await expect(projectPanel).toHaveJSProperty("inert", true)
    await expect(filePanel).toBeHidden()
    await expect(review).toHaveAttribute("aria-expanded", "true")
    await expect(sidePanel).toBeVisible()
    await expect(sidePanel).toHaveAttribute("aria-hidden", "false")
    await expect(sidePanel).toHaveJSProperty("inert", false)
    await navigation.click()
    await expect(navigation).toHaveAttribute("aria-expanded", "true")
    await expect(projectPanel).toBeVisible()
    await expect(filePanel).toBeHidden()

    if (direction === "ltr") {
      await expect
        .poll(async () => {
          const [project, review] = await Promise.all(
            [projectPanel, page.locator("#review-panel")].map((panel) =>
              panel.evaluate((element) => {
                const style = getComputedStyle(element)

                return { duration: style.transitionDuration, easing: style.transitionTimingFunction }
              }),
            ),
          )

          return { project, review }
        })
        .toEqual({
          project: { duration: "0.24s", easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
          review: { duration: "0.24s", easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        })
    }

    await review.click()
    await expect(review).toHaveAttribute("aria-expanded", "false")
    await expect(sidePanel).toBeHidden()
    await expect(exposedSide).toHaveCount(0)
    await expect(navigation).toHaveAttribute("aria-expanded", "true")
    await expect(projectPanel).toBeVisible()
    await expect(filePanel).toBeHidden()
    await navigation.click()
    await expect(navigation).toHaveAttribute("aria-expanded", "false")
    await expect(projectPanel).toBeHidden()
    await expect(filePanel).toBeHidden()

    if (direction === "ltr") {
      await navigation.click()
      await expect(projectPanel).toBeVisible()
      await expect(filePanel).toBeHidden()
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(localStorage.getItem("aigcfroge.global.dat:layout") ?? "{}").sidebar?.opened),
        )
        .toBe(true)
      await page.reload()
      await expectSessionTitle(page, fixture.expected.targetTitle)
      await expect(navigation).toHaveAttribute("aria-expanded", "true")
      await expect(projectPanel).toBeVisible()
      await expect(filePanel).toBeHidden()
      await expect(review).toHaveAttribute("aria-expanded", "false")
      await expect(sidePanel).toBeHidden()
      await expect(exposedSide).toHaveCount(0)
      await navigation.click()
      await expect(navigation).toHaveAttribute("aria-expanded", "false")
      await expect(projectPanel).toBeHidden()
      await expect(filePanel).toBeHidden()
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(localStorage.getItem("aigcfroge.global.dat:layout") ?? "{}").sidebar?.opened),
        )
        .toBe(false)
    }

    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("aigcfroge.global.dat:layout") ?? "{}").fileTree?.opened),
      )
      .toBe(false)
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}")))
      .toEqual(preferences)

    await more.click()
    const options = page.getByRole("menu")
    await expect(options.locator('[data-slot="menu-v2-item-content"]')).toHaveText([
      "Rename",
      "Fork from message",
      "Copy Session ID",
      "Export…",
      "Delete…",
    ])
    await expect(options.getByRole("menuitem", { name: "Fork from message", exact: true })).toBeEnabled()
    await expect(options.getByRole("menuitem", { name: "Copy Session ID", exact: true })).toBeEnabled()

    if (direction === "ltr") {
      await expect
        .poll(async () => {
          const [button, menu] = await Promise.all([
            header.getByRole("button", { name: "More options", exact: true, includeHidden: true }).boundingBox(),
            options.boundingBox(),
          ])

          return button && menu ? Math.abs(button.x - menu.x) : Infinity
        })
        .toBeLessThanOrEqual(1)
    }

    await expect
      .poll(() =>
        options.evaluate((element) => {
          const menu = element.getBoundingClientRect()
          const rtl = getComputedStyle(element).direction === "rtl"

          return Math.min(
            ...Array.from(element.querySelectorAll('[role="menuitem"]'), (row) => {
              const label =
                row.querySelector('[data-slot="menu-v2-item-shortcut"]') ??
                row.querySelector('[data-slot="menu-v2-item-content"]')

              if (!label) throw new Error("Session menu item has no content")

              const range = document.createRange()
              range.selectNodeContents(label)
              const text = range.getBoundingClientRect()

              return rtl ? text.left - menu.left : menu.right - text.right
            }),
          )
        }),
      )
      .toBeCloseTo(32, 0)
    await expect
      .poll(() =>
        options.evaluate((element) => {
          const menu = element.getBoundingClientRect()
          const divider = element.querySelector('[data-slot="menu-v2-separator"]')?.getBoundingClientRect()
          const rows = Array.from(element.querySelectorAll('[role="menuitem"]'), (row) => row.getBoundingClientRect())

          return (
            !!divider &&
            Math.abs(divider.left - menu.left) <= 0.5 &&
            Math.abs(divider.right - menu.right) <= 0.5 &&
            rows.every(
              (row) => Math.abs(row.left - menu.left - 2) <= 0.5 && Math.abs(menu.right - row.right - 2) <= 0.5,
            )
          )
        }),
      )
      .toBe(true)
    await expect(page.getByRole("menuitem", { name: "Server status", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await details.click()
    const summary = page.getByRole("dialog", { name: "Session details", exact: true })
    const mcp = summary.getByRole("button", { name: "MCP", exact: true })
    await expect(mcp).toBeVisible()
    await expect(summary.getByRole("button", { name: "Plugins", exact: true })).toBeVisible()
    const projectDisclosure = summary.getByRole("button", { name: fixture.project.name, exact: true })
    const serverDisclosure = summary.getByRole("button", { name: "Extensions", exact: true })

    await expect(projectDisclosure).toHaveAttribute("aria-expanded", "true")
    await projectDisclosure.click()
    await expect(projectDisclosure).toHaveAttribute("aria-expanded", "false")
    await projectDisclosure.click()
    await expect(projectDisclosure).toHaveAttribute("aria-expanded", "true")
    await serverDisclosure.click()
    await expect(serverDisclosure).toHaveAttribute("aria-expanded", "false")
    await expect(mcp).toBeHidden()
    await serverDisclosure.click()
    await expect(serverDisclosure).toHaveAttribute("aria-expanded", "true")
    await expect(mcp).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(mcp).toBeHidden()
  })
}

test.describe("session menu commands", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] })

  test("binds menu commands to cached main sessions and the remote embedded session", async ({ page }) => {
    const sourceID = "ses_menu_source"
    const targetID = "ses_menu_target"
    const remoteDirectory = "/remote/session-menus"
    await mockWorkspace(page, {
      name: "Session menus",
      sessions: [
        { id: sourceID, title: "Empty menu source" },
        { id: targetID, title: "Local empty target" },
      ],
    })
    await mockRemoteServer(page, {
      directory: remoteDirectory,
      sessions: [session({ id: targetID, directory: remoteDirectory, title: "Remote fork source", mode: "assistant" })],
      pageMessages: () => ({
        items: [{ id: "msg_remote_menu_prompt", type: "user", text: "Fork this remote prompt", time: { created: 1 } }],
      }),
    })
    await seed(page, { tabs: [sourceID, targetID, { session: targetID, server: REMOTE_SERVER }] })
    await page.goto(sessionHref(targetID, REMOTE_SERVER))
    await expectSessionTitle(page, "Remote fork source")

    const main = page.locator('[data-slot="session-chat-panel"]')
    const more = main.getByRole("button", { name: "More options", exact: true })
    const options = page.getByRole("menu")

    for (const current of [
      { id: sourceID, title: "Empty menu source" },
      { id: targetID, title: "Local empty target" },
      { id: sourceID, title: "Empty menu source" },
    ]) {
      await tabs(page).filter({ hasText: current.title }).click()
      await expectSessionTitle(page, current.title)
      await more.click()
      await expect(options.getByRole("menuitem", { name: "Fork from message", exact: true })).toBeDisabled()
      await options.getByRole("menuitem", { name: "Copy Session ID", exact: true }).click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(current.id)
    }

    await attachSession(page, { server: REMOTE_SERVER, sessionID: targetID, title: "Remote fork source" })
    const embedded = page.locator('[data-component="session-content-panel"]:visible')
    const embeddedMore = embedded.getByRole("button", { name: "More options", exact: true })
    await expect(embedded.getByRole("heading", { name: "Remote fork source", exact: true, level: 1 })).toBeVisible()
    await embeddedMore.click()
    await expect(options.getByRole("menuitem", { name: "Fork from message", exact: true })).toBeEnabled()
    await options.getByRole("menuitem", { name: "Copy Session ID", exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(targetID)
    await expect(page).toHaveURL(sessionHref(sourceID))

    await embeddedMore.click()
    await options.getByRole("menuitem", { name: "Fork from message", exact: true }).click()

    const fork = page.getByRole("dialog", { name: "Fork from message", exact: true })

    const preview = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).origin === REMOTE_SERVER &&
        new URL(response.url()).pathname === `/api/session/${targetID}`,
    )

    await fork.getByRole("button", { name: /Fork this remote prompt/ }).click()
    expect((await preview).ok()).toBe(true)
    await expect(fork.getByText("Remote fork source", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(sessionHref(sourceID))
    const confirm = fork.getByRole("button", { name: "Confirm fork", exact: true })
    await expect(confirm).toBeEnabled()
    await confirm.focus()
    await expect(confirm).toBeFocused()
    await confirm.press("Escape")
    await expect(fork).toBeHidden()
  })

  for (const item of [
    { id: "session.undo", key: "U", menu: undefined },
    { id: "session.redo", key: "R", menu: undefined },
    { id: "session.compact", key: "K", menu: undefined },
    { id: "session.fork", key: "F", menu: "Fork from message" },
    { id: "session.export", key: "X", menu: "Export…" },
    { id: "session.copyID", key: "I", menu: "Copy Session ID" },
    { id: "project.copyID", key: "D", menu: undefined },
  ] as const) {
    test(`keyboard shortcut ${item.id} uses its existing session action`, async ({ page }, testInfo) => {
      const sessionID = `ses_shortcut_${item.key.toLowerCase()}`
      const title = `Session shortcut ${item.key}`
      const model = { providerID: "aigcfroge", id: "shortcut-model" }
      const staged: { sessionID: string; messageID: string }[] = []
      const compactions: { sessionID: string; body: Schema.JsonObject }[] = []

      const messages = [
        { id: "msg_shortcut_first", type: "user", text: "First shortcut prompt", time: { created: 1 } },
        {
          id: "msg_shortcut_reply",
          type: "assistant",
          agent: "build",
          model,
          content: [{ type: "text", text: "Saved shortcut reply" }],
          time: { created: 2, completed: 3 },
        },
        { id: "msg_shortcut_second", type: "user", text: "Latest shortcut prompt", time: { created: 4 } },
      ] satisfies SessionMessageInfo[]

      const workspace = await openSession(page, {
        name: `SessionShortcut${item.key}`,
        sessions: [
          {
            id: sessionID,
            title,
            mode: "coding",
            model,
            revert: item.id === "session.redo" ? { messageID: "msg_shortcut_second" } : undefined,
          },
        ],
        provider: provider({ id: model.id, name: "Shortcut model" }),
        pageMessages: () => ({ items: messages }),
        onRevertStage: (input) => staged.push(input),
        onCompact: (input) => compactions.push(input),
      })

      const main = page.locator('[data-slot="session-chat-panel"]')
      const draft = "Keep this draft while using the session action shortcut."
      const shortcut = `Control+Alt+Shift+${item.key}`
      await expect(main.getByText("First shortcut prompt", { exact: true })).toBeVisible()
      await workspace.editor.fill(draft)

      if (item.menu) {
        await main.getByRole("button", { name: "More options", exact: true }).click()
        const menu = page.getByRole("menu")
        const action = menu.getByRole("menuitem", { name: item.menu, exact: true })
        await expect(action).toBeEnabled()
        await expect(action.locator('[data-slot="menu-v2-item-shortcut"]')).toHaveText(`Ctrl+Alt+Shift+${item.key}`)

        if (item.id === "session.copyID")
          await page.screenshot({ path: testInfo.outputPath("session-menu-shortcuts.png") })

        await page.keyboard.press("Escape")
        await expect(menu).toHaveCount(0)
      }

      if (item.id === "session.undo") {
        await workspace.editor.press("Control+z")
        await expect(main.getByText("Latest shortcut prompt", { exact: true })).toBeVisible()
        expect(staged).toEqual([])
        await workspace.editor.fill(draft)

        const response = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === `/api/session/${sessionID}/revert/stage`,
        )

        await workspace.editor.press(shortcut)
        expect((await response).ok()).toBe(true)
        expect(staged).toEqual([{ sessionID, messageID: "msg_shortcut_second" }])
        await expect(workspace.editor).toHaveText("Latest shortcut prompt")

        return
      }

      if (item.id === "session.redo") {
        const response = page.waitForResponse(
          (response) =>
            response.request().method() === "DELETE" &&
            new URL(response.url()).pathname === `/api/session/${sessionID}/revert`,
        )

        await workspace.editor.press(shortcut)
        expect((await response).ok()).toBe(true)
        expect(staged).toEqual([])
        await expect(workspace.editor).toHaveText(draft)

        return
      }

      if (item.id === "session.compact") {
        const response = page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname === `/api/session/${sessionID}/compact`,
        )

        await workspace.editor.press(shortcut)

        const admitted = await response
        expect(admitted.ok()).toBe(true)
        expect(compactions).toEqual([{ sessionID, body: { id: expect.any(String) } }])
        await expect(admitted.json()).resolves.toMatchObject({
          data: { id: compactions[0]?.body.id, sessionID, type: "compaction", delivery: "steer" },
        })
        await expect(workspace.editor).toHaveText(draft)

        return
      }

      if (item.id === "session.fork") {
        await workspace.editor.press(shortcut)
        const fork = page.getByRole("dialog", { name: "Fork from message", exact: true })
        await expect(fork.getByRole("button", { name: /Latest shortcut prompt/ })).toBeEnabled()
        await expect(workspace.editor).toHaveText(draft)
        await page.keyboard.press("Escape")
        await expect(fork).toHaveCount(0)

        return
      }

      if (item.id === "session.export") {
        const ready = page.waitForEvent("download")
        await workspace.editor.press(shortcut)
        const download = await ready
        expect(download.suggestedFilename()).toBe("session-shortcut-x.json")
        const file = await download.path()

        if (!file) throw new Error("The session export was not saved")

        expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ info: { id: sessionID, title }, messages })
        await expect(workspace.editor).toHaveText(draft)

        return
      }

      await workspace.editor.press(shortcut)
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(item.id === "project.copyID" ? workspace.projectID : sessionID)
      await expect(workspace.editor).toHaveText(draft)
    })
  }
})

test.describe("rename", () => {
  const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true })
  // Rename requests (`PATCH /api/session/:id`); the mock stores the new title for later reads.
  const renames: { sessionID: string; body: unknown }[] = []

  test.beforeEach(async ({ page }) => {
    renames.length = 0
    page.on("request", (request) => {
      const match = new URL(request.url()).pathname.match(/^\/api\/session\/([^/]+)$/)

      if (request.method() === "PATCH" && match) renames.push({ sessionID: match[1]!, body: request.postDataJSON() })
    })
    await mockStressTimeline(page)
    await page.goto("/")
    await page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.targetTitle }).click()
    await expect(heading(page, fixture.expected.targetTitle)).toBeVisible()
  })

  for (const commit of ["Enter", "blur", "click outside"]) {
    test(`saves the session heading on ${commit}`, async ({ page }) => {
      await heading(page, fixture.expected.targetTitle).click()
      const input = page.locator('input[data-slot="session-title-child"]')
      await expect(input).toBeFocused()
      await input.fill("Renamed session")

      if (commit === "Enter") await input.press("Enter")

      if (commit === "blur") await input.press("Tab")

      if (commit === "click outside") await page.locator('[data-component="composer-editor"]').click()
      await expect(heading(page, "Renamed session")).toBeVisible()
      await expect(tabs(page).filter({ hasText: "Renamed session" })).toBeVisible()
      await expect.poll(() => renames).toEqual([{ sessionID: fixture.targetID, body: { title: "Renamed session" } }])
      await page.reload()
      await expect(heading(page, "Renamed session")).toBeVisible()
    })
  }

  for (const edit of [
    { name: "cancelled with Escape", value: "Discard this title", key: "Escape" },
    { name: "left empty", value: "   ", key: "Tab" },
  ]) {
    test(`keeps the session heading when the edit is ${edit.name}`, async ({ page }) => {
      await heading(page, fixture.expected.targetTitle).click()
      const input = page.locator('input[data-slot="session-title-child"]')
      await input.fill(edit.value)
      await input.press(edit.key)
      await expect(heading(page, fixture.expected.targetTitle)).toBeVisible()
      await page.reload()
      await expect(heading(page, fixture.expected.targetTitle)).toBeVisible()
      expect(renames).toEqual([])
    })
  }

  test("keeps the draft when saving the session heading fails", async ({ page }) => {
    await page.route("**/api/session/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" } })
        : route.fallback(),
    )
    await heading(page, fixture.expected.targetTitle).click()
    const input = page.locator('input[data-slot="session-title-child"]')
    await input.fill("Retry this title")
    await input.press("Tab")
    await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
    await expect(input).toBeEnabled()
    await expect(input).toHaveValue("Retry this title")
    await expect(tabs(page).filter({ hasText: fixture.expected.targetTitle })).toBeVisible()
  })

  test("renames and closes the session tab from its context menu", async ({ page }) => {
    const tab = tabs(page).filter({ hasText: fixture.expected.targetTitle })
    await tab.click({ button: "right" })
    await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeHidden()
    await expect(tab).toBeFocused()
    await tab.press("Shift+F10")
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    const input = page.locator('[data-slot="tab-title"][contenteditable="true"]')
    await expect(input).toBeFocused()
    await input.fill("Renamed from tab")
    await input.press("Enter")
    await expect(heading(page, "Renamed from tab")).toBeVisible()
    await expect.poll(() => renames).toEqual([{ sessionID: fixture.targetID, body: { title: "Renamed from tab" } }])
    await page.reload()
    await expect(heading(page, "Renamed from tab")).toBeVisible()
    const renamed = tabs(page).filter({ hasText: "Renamed from tab" })
    await renamed.click({ button: "right" })
    await page.getByRole("menuitem", { name: "Close tab", exact: true }).click()
    await expect(renamed).toBeHidden()
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await expect(
      page.locator('[data-component="home-session-row"]').filter({ hasText: "Renamed from tab" }),
    ).toBeVisible()
  })

  test("renames an inactive tab without switching sessions", async ({ page }) => {
    await page.getByRole("button", { name: "Home", exact: true }).click()
    await page.locator('[data-component="home-session-row"]').filter({ hasText: fixture.expected.sourceTitle }).click()
    await expect(heading(page, fixture.expected.sourceTitle)).toBeVisible()
    await tabs(page).filter({ hasText: fixture.expected.targetTitle }).click({ button: "right" })
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
    const input = page.locator('[data-slot="tab-title"][contenteditable="true"]')
    await expect(input).toBeFocused()
    await input.fill("Inactive tab renamed")
    await input.press("Tab")
    await expect(heading(page, fixture.expected.sourceTitle)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/session/${fixture.sourceID}$`))
    await tabs(page).filter({ hasText: "Inactive tab renamed" }).click()
    await expect(heading(page, "Inactive tab renamed")).toBeVisible()
    expect(renames).toEqual([{ sessionID: fixture.targetID, body: { title: "Inactive tab renamed" } }])
    await page.reload()
    await expect(heading(page, "Inactive tab renamed")).toBeVisible()
  })
})

test.describe("revert", () => {
  const messages = [
    { id: "msg_first", type: "user", text: "First prompt", time: { created: 1 } },
    {
      id: "msg_first_reply",
      type: "assistant",
      agent: "build",
      model: { id: "test", providerID: "aigcfroge" },
      content: [{ type: "text", text: "First reply" }],
      time: { created: 2, completed: 3 },
    },
    { id: "msg_second", type: "user", text: "Second prompt", time: { created: 4 } },
  ] satisfies SessionMessageInfo[]

  const workspace = {
    name: "SessionMessageRevert",
    pageMessages: () => ({ items: messages }),
  }

  test("reverts directly to the selected user message", async ({ page }) => {
    const staged: { sessionID: string; messageID: string }[] = []
    const { session } = await openSession(page, { ...workspace, onRevertStage: (input) => staged.push(input) })
    const settles: string[] = []
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname
      const step = ["/interrupt", "/wait", "/revert/stage"].find((suffix) => path.endsWith(`/${session.id}${suffix}`))

      if (step) settles.push(step)
    })
    const message = page.locator('[data-message-id="msg_second"]')
    await message.hover()

    const response = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${session.id}/revert/stage`,
    )

    await message.getByRole("button", { name: "Revert message" }).click()
    expect((await response).ok()).toBe(true)

    await expect(page.getByRole("textbox", { name: "Prompt" })).toHaveText("Second prompt")
    expect(staged).toEqual([{ sessionID: session.id, messageID: "msg_second" }])
    // Interrupt acknowledges before the run settles, and the server refuses to stage while it is active.
    expect(settles).toEqual(["/interrupt", "/wait", "/revert/stage"])
  })

  test("redo restores every reverted message at once, as in the TUI", async ({ page }) => {
    const staged: { sessionID: string; messageID: string }[] = []

    const { editor } = await openSession(page, {
      ...workspace,
      sessions: [{ id: "ses_revert_redo", title: "Session message revert", revert: { messageID: "msg_first" } }],
      onRevertStage: (input) => staged.push(input),
    })

    const cleared = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        new URL(response.url()).pathname === "/api/session/ses_revert_redo/revert",
    )

    await editor.pressSequentially("/redo")
    await expect(
      page.locator('[data-component="composer-suggestions"] [data-suggestion-id][data-active]'),
    ).toContainText("/redo")
    await editor.press("Enter")

    expect((await cleared).ok()).toBe(true)
    expect(staged).toEqual([])
  })

  test("hides revert actions in a child session", async ({ page }) => {
    await mockWorkspace(page, {
      ...workspace,
      sessions: [
        { id: "ses_parent", title: "Parent session" },
        { id: "ses_child", title: "Session message revert", parentID: "ses_parent" },
      ],
    })
    await page.goto(sessionHref("ses_child"))
    await expectSessionTitle(page, "Session message revert")
    const message = page.locator('[data-message-id="msg_second"]')
    await message.hover()
    await expect(message.getByRole("button", { name: "Revert message" })).toHaveCount(0)
  })
})

test.describe("session management", () => {
  test("shows saved Delegation identities, original results, and an acknowledged control across reload", async ({
    page,
  }, testInfo) => {
    const sessionID = "ses_collaboration"
    const fullResult = "Original worker evidence: first line\nLast line retained from the actual Tool result."
    const previousResult = "Previous attempt error: first line\n\nRetained full error details."
    const externalResult = "EXTERNAL_FULL_BEGIN\n" + "x".repeat(60_000) + "\nEXTERNAL_FULL_TAIL"

    const value: DelegationLegacyState = {
      delegation: {
        id: "dlg_ui",
        parentSessionID: sessionID,
        title: "Review the complete recovered collaboration 中文长标题",
        status: "running",
        rejectionBlocked: true,
        rejectionReason: "Saved reviewer rejection",
        rejectionParticipantID: "par_two",
        latestRevisionDigest: `rev_${"a".repeat(64)}`,
        lastActivityAt: 2,
        createdAt: 1,
        updatedAt: 2,
      },
      participants: ["par_one", "par_two", "par_external"].map((id) => ({
        id,
        delegationID: "dlg_ui",
        provider: id === "par_external" ? "codex" : "internal",
        target: "build",
        role: id === "par_two" ? ("reviewer" as const) : ("implementer" as const),
        context: "fresh" as const,
        phase: "active" as const,
        runtimeStatus: "idle" as const,
        ...(id === "par_external" ? { externalThreadID: "external-thread-saved" } : { childSessionID: `ses_${id}` }),
        lastActivityAt: 2,
        createdAt: 1,
        updatedAt: 2,
      })),
      turns: [
        {
          id: "trn_saved",
          delegationID: "dlg_ui",
          seq: 1,
          kind: "task",
          status: "completed",
          participantIDs: ["par_one"],
          delivery: "steer",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      deliveries: [
        {
          delegationID: "dlg_ui",
          turnID: "trn_saved",
          participantID: "par_one",
          deliveryOrigin: "human",
          senderParticipantID: "par_one",
          attempt: 1,
          provider: "internal",
          status: "failed",
          current: false,
          updatedAt: 1,
          receipt: {
            delegationID: "dlg_ui",
            turnID: "trn_saved",
            participantID: "par_one",
            deliveryOrigin: "human",
            senderParticipantID: "par_one",
            attempt: 1,
            childSessionID: "ses_par_one",
            inputID: "msg_previous_input",
          },
          source: { type: "tool", messageID: "msg_previous_tool", id: "call_previous" },
          parentTaskID: "tsk_previous",
          summary: "Previous failure digest",
        },
        {
          delegationID: "dlg_ui",
          turnID: "trn_saved",
          participantID: "par_one",
          deliveryOrigin: "human",
          senderParticipantID: "par_one",
          attempt: 2,
          provider: "internal",
          status: "completed",
          current: true,
          updatedAt: 2,
          receipt: {
            delegationID: "dlg_ui",
            turnID: "trn_saved",
            participantID: "par_one",
            deliveryOrigin: "human",
            senderParticipantID: "par_one",
            attempt: 2,
            childSessionID: "ses_par_one",
            inputID: "msg_child_input",
          },
        },
        {
          delegationID: "dlg_ui",
          turnID: "trn_external",
          participantID: "par_external",
          deliveryOrigin: "meta",
          senderParticipantID: "par_external",
          attempt: 1,
          provider: "codex",
          status: "completed",
          current: true,
          updatedAt: 2,
          externalThreadID: "external-thread-saved",
          externalTurnID: "external-turn-saved",
          source: { type: "tool", messageID: "msg_external_tool", id: "call_external" },
          parentTaskID: "tsk_external",
          summary: "External result digest",
        },
      ],
      reviews: [
        {
          participantID: "par_two",
          reviewedRevisionDigest: `rev_${"a".repeat(64)}`,
          verdict: "rejected",
          findings: [],
          summary: "Original retained review",
        },
      ],
      barrier: { passed: false, reason: "Pending reviewer evidence", completionEligible: false },
      softExpired: false,
    }

    const messages: SessionMessageInfo[] = [
      { id: "msg_collaboration_prompt", type: "user", text: "Review the recovered work", time: { created: 1 } },
      {
        id: "msg_previous_tool",
        type: "assistant",
        agent: "meta",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 1, completed: 2 },
        content: [
          {
            id: "call_previous",
            type: "tool",
            name: "task",
            time: { created: 1, ran: 1, completed: 2 },
            state: {
              status: "error",
              input: {
                description: "Previous failed worker",
                subagent_type: "build",
                prompt: "Review the recovered work",
              },
              error: { type: "TaskFailed", message: "Previous failed attempt" },
              metadata: {
                status: "failed",
                receipt: {
                  delegationID: "dlg_ui",
                  turnID: "trn_saved",
                  participantID: "par_one",
                  childSessionID: "ses_par_one",
                  inputID: "msg_previous_input",
                  deliveryOrigin: "human",
                  senderParticipantID: "par_one",
                  attempt: 1,
                },
              },
            },
          },
        ],
      },
      {
        id: "msg_collaboration_result",
        type: "assistant",
        agent: "meta",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 2, completed: 3 },
        content: [
          {
            id: "call_collaboration",
            type: "tool",
            name: "task",
            time: { created: 2, ran: 2, completed: 3 },
            state: {
              status: "completed",
              input: {
                description: "Saved worker result",
                subagent_type: "build",
                prompt: "Review the recovered work",
              },
              content: [{ type: "text", text: "Background delivery admitted" }],
              metadata: {
                status: "running",
                truncated: true,
                sessionID: "ses_par_one",
                delegationID: "dlg_ui",
                participantID: "par_one",
                turnID: "trn_saved",
                receipt: {
                  delegationID: "dlg_ui",
                  turnID: "trn_saved",
                  participantID: "par_one",
                  childSessionID: "ses_par_one",
                  inputID: "msg_child_input",
                  deliveryOrigin: "human",
                  senderParticipantID: "par_one",
                  attempt: 2,
                },
              },
            },
          },
        ],
      },
    ]

    const state = { unreadable: false, actionCount: 0 }
    const calls: unknown[] = []
    const resultReads: DelegationResultInput[] = []
    await openSession(page, {
      name: "Delegation consumer",
      sessions: [
        {
          id: sessionID,
          title: "Delegation consumer",
          agent: "meta",
          controller: { kind: "root", metaAgentID: "mag_ui", rootSessionID: sessionID },
        },
        { id: "ses_par_one", parentID: sessionID, title: "First build worker" },
        { id: "ses_par_two", parentID: sessionID, title: "Second build worker" },
      ],
      pageMessages: (id) => ({ items: id === sessionID ? messages : [] }),
      delegations: [value],
      seed: {
        theme: { id: "oc-2", scheme: "dark" },
        settings: { timelineDetail: timelinePresets[2].value },
      },
      onDelegationResult(input) {
        resultReads.push(input)

        const delivery = value.deliveries?.find(
          (delivery) =>
            delivery.delegationID === input.delegationID &&
            delivery.turnID === input.turnID &&
            delivery.participantID === input.participantID &&
            delivery.attempt === input.attempt,
        )

        if (!delivery) return new InvalidRequestError({ message: "Original result not found" })

        return {
          delivery,
          available: true,
          text: delivery.provider === "codex" ? externalResult : delivery.attempt === 2 ? fullResult : previousResult,
        }
      },
      onDelegationRead: () =>
        state.unreadable
          ? new InvalidRequestError({ message: "Saved collaboration is temporarily unavailable" })
          : undefined,
      onDelegationAction(input) {
        calls.push(input)
        state.actionCount++
        state.unreadable = true

        return value
      },
    })
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")

    const read = page.waitForResponse(
      (answer) => new URL(answer.url()).pathname === "/delegation" && answer.request().method() === "GET",
    )

    await openSidePanel(page, "Task delegation")
    const answer = await read
    expect(answer.status(), await answer.text()).toBe(200)
    const collaboration = page.getByRole("region", { name: "Task delegation", exact: true })
    await expect(collaboration.getByRole("heading", { name: value.delegation.title, exact: true })).toBeVisible()
    await expect(collaboration.getByText("Saved reviewer rejection", { exact: true })).toBeVisible()
    const first = collaboration.getByRole("listitem", { name: "Participant: build · par_one", exact: true })
    const second = collaboration.getByRole("listitem", { name: "Participant: build · par_two", exact: true })
    const external = collaboration.getByRole("listitem", { name: "Participant: build · par_external", exact: true })
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()

    const externalDetails = external
      .locator(':scope > [data-slot="task-row-content"] [data-slot="task-disclosure"]')
      .getByRole("button", { name: "Execution details", exact: true })

    await expect(externalDetails).toHaveCount(1)
    await expect(externalDetails).toHaveAttribute("aria-expanded", "false")
    await externalDetails.click()
    await expect(externalDetails).toHaveAttribute("aria-expanded", "true")
    await expect(external.getByText("external-thread-saved", { exact: true })).toBeVisible()
    await expect(external.getByRole("button", { name: "Open as main session", exact: true })).toHaveCount(0)
    await expect(first.getByRole("button", { name: "Retry delivery", exact: true })).toHaveCount(0)
    await expect(first.getByText("Attempt 2 · Completed", { exact: true })).toBeVisible()
    const reviews = collaboration.getByRole("button", { name: "Review records", exact: true })
    await expect(reviews).toHaveAttribute("aria-expanded", "false")
    await reviews.click()
    await expect(reviews).toHaveAttribute("aria-expanded", "true")
    await expect(collaboration).toContainText("Original retained review")
    await expect(collaboration).toContainText("Recorded reviews require attention")
    const previous = first.locator('[data-slot="delegation-receipt"]').filter({ hasText: "Previous attempt" })
    await expect(previous.getByRole("button", { name: "Retry delivery", exact: true })).toHaveCount(0)
    await previous.getByRole("button", { name: "Open full result", exact: true }).click()
    await expect(previous.locator("pre")).toHaveText(previousResult)
    const previousDetails = previous.getByRole("button", { name: "Execution details", exact: true })
    await expect(previousDetails).toHaveAttribute("aria-expanded", "false")
    await previousDetails.click()
    await expect(previousDetails).toHaveAttribute("aria-expanded", "true")
    await expect(previous.locator("code")).toHaveText("tsk_previous")
    await external.getByRole("button", { name: "Open full result", exact: true }).click()
    await expect(external.locator("pre")).toHaveText(externalResult)
    const completed = first.locator('[data-slot="delegation-receipt"]').filter({ hasText: "Attempt 2 · Completed" })
    await completed.getByRole("button", { name: "Open full result", exact: true }).click()
    await expect(completed.locator("pre")).toHaveText(fullResult)
    expect(resultReads).toEqual([
      {
        delegationID: "dlg_ui",
        turnID: "trn_saved",
        participantID: "par_one",
        deliveryOrigin: "human",
        senderParticipantID: "par_one",
        attempt: 1,
        directory: "C:/AigcForge/Delegation consumer",
      },
      {
        delegationID: "dlg_ui",
        turnID: "trn_external",
        participantID: "par_external",
        deliveryOrigin: "meta",
        senderParticipantID: "par_external",
        attempt: 1,
        directory: "C:/AigcForge/Delegation consumer",
      },
      {
        delegationID: "dlg_ui",
        turnID: "trn_saved",
        participantID: "par_one",
        deliveryOrigin: "human",
        senderParticipantID: "par_one",
        attempt: 2,
        directory: "C:/AigcForge/Delegation consumer",
      },
    ])
    await page.screenshot({ path: testInfo.outputPath("collaboration-desktop.png") })
    await collaboration.getByRole("button", { name: "Interrupt delegation", exact: true }).click()
    await expect(collaboration.getByRole("status")).toHaveText("Interrupt requested.")
    await expect(collaboration.getByRole("alert")).toContainText("Saved collaboration is temporarily unavailable")
    expect(state.actionCount).toBe(1)
    expect(calls).toEqual([
      { action: "interrupt", delegationID: "dlg_ui", directory: "C:/AigcForge/Delegation consumer", body: {} },
    ])
    state.unreadable = false
    await collaboration.getByRole("button", { name: "Reload collaborations", exact: true }).click()
    await expect(collaboration.getByRole("alert")).toHaveCount(0)

    const original = first
      .locator('[data-slot="delegation-receipt"]')
      .filter({ has: page.getByText(fullResult, { exact: true }) })

    await original.getByText("Open full result", { exact: true }).click()
    await expect(page.getByText(fullResult, { exact: true })).toBeVisible()

    const group = page.locator('[data-component="collapsed-tool-group"][data-timeline-part-ids*="call_collaboration"]')

    const groupTrigger = group.locator(':scope > [data-component="collapsible"] > [data-slot="collapsible-trigger"]')

    const originalTool = group.locator('[data-timeline-part-id="call_collaboration"]')

    await expect(group).toHaveAttribute("data-timeline-part-ids", "call_previous,call_collaboration")
    await expect(groupTrigger).toHaveAttribute("aria-expanded", "false")
    await expect(originalTool).toHaveCount(0)
    await original.getByRole("button", { name: "Open original tool", exact: true }).click()
    await expect(page).toHaveURL(/\/session\/ses_collaboration$/)
    await expect(originalTool).toBeVisible()
    await expect(groupTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(originalTool.getByText("Saved worker result", { exact: true })).toBeVisible()
    await expect(originalTool.getByText("subagent_type=build", { exact: true })).toBeVisible()
    await expect(originalTool.getByText("prompt=Review the recovered work", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("collaboration-original-tool.png") })
    await openSidePanel(page, "Task delegation")
    await first.getByRole("button", { name: "Open as main session", exact: true }).click()
    await expect(page).toHaveURL(/\/session\/ses_par_one$/)
    await expectSessionTitle(page, "Saved worker result")
    await page.goBack()
    await expectSessionTitle(page, "Delegation consumer")
    await page.reload()
    await expectSessionTitle(page, "Delegation consumer")
    await page.setViewportSize({ width: 390, height: 844 })
    await openSidePanel(page, "Task delegation")
    await expect(collaboration.getByRole("heading", { name: value.delegation.title, exact: true })).toBeVisible()
    await expect(second).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath("collaboration-narrow.png") })
    expect(state.actionCount).toBe(1)
  })

  test("SC02 ordinary subagents keep sources, live state, and Related sessions beside Delegations", async ({
    page,
  }, testInfo) => {
    const ids = {
      parent: "ses_sc02_collaboration",
      first: "ses_sc02_first",
      second: "ses_sc02_second",
      missing: "ses_sc02_readback",
      linked: "ses_sc02_linked",
      workflow: "ses_sc02_workflow",
      formal: "ses_sc02_formal",
      foreign: "ses_sc02_foreign",
    }

    const foregroundMessageID = "msg_sc02_foreground"
    const backgroundMessageID = "msg_sc02_background"
    const runningMessageID = "msg_sc02_running"
    const foregroundResult = "Foreground result first line\nComplete original foreground result tail."
    const backgroundResult = "Background admission first line\nThe child Session is still running."
    const cancelledResult = "Original subagent failure: cancelled by the parent\nRetained cancellation details."
    const startupError = "Original startup error before a child was created\nRetained startup failure details."
    const readbackStarted = Promise.withResolvers<void>()
    const releaseReadback = Promise.withResolvers<void>()
    const readback = { sessions: Array<ReturnType<typeof session>>(), requests: Array<string>() }

    const activity = {
      [ids.first]: { type: "busy" },
      [ids.second]: { type: "busy" },
    } satisfies Record<string, { type: string }>

    const delegations = { [ids.parent]: Array<DelegationLegacyState>() }

    const backgroundInput = {
      description: "Background continuation",
      agent: "build",
      prompt: "Continue the same child in the background",
    }

    const backgroundTool: Extract<SessionMessageInfo, { type: "assistant" }>["content"][number] = {
      id: "call_sc02_background",
      type: "tool",
      name: "subagent",
      time: { created: 4, ran: 4 },
      state: { status: "running", input: backgroundInput, metadata: { sessionID: ids.first } },
    }

    const messages: SessionMessageInfo[] = [
      { id: "msg_sc02_prompt", type: "user", text: "Inspect the saved worker sources", time: { created: 1 } },
      {
        id: foregroundMessageID,
        type: "assistant",
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 2, completed: 3 },
        content: [
          {
            id: "call_sc02_foreground",
            type: "tool",
            name: "subagent",
            time: { created: 2, ran: 2, completed: 3 },
            state: {
              status: "completed",
              input: { description: "Completed foreground call", agent: "build", prompt: "Inspect the first child" },
              content: [{ type: "text", text: foregroundResult }],
              metadata: { sessionID: ids.first, status: "completed" },
            },
          },
        ],
      },
      {
        id: backgroundMessageID,
        type: "assistant",
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 4 },
        content: [backgroundTool],
      },
      {
        id: runningMessageID,
        type: "assistant",
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 5 },
        content: [
          {
            id: "call_sc02_running",
            type: "tool",
            name: "subagent",
            time: { created: 5, ran: 5 },
            state: {
              status: "running",
              input: { description: "Current second worker", agent: "build", prompt: "Inspect the second child" },
              metadata: { sessionID: ids.second },
            },
          },
          {
            id: "call_sc02_cancelled",
            type: "tool",
            name: "subagent",
            time: { created: 5, ran: 5, completed: 6 },
            state: {
              status: "error",
              input: { description: "Earlier cancelled call", agent: "build", prompt: "Saved cancelled input" },
              error: { type: "TaskFailed", message: cancelledResult },
              metadata: { sessionID: ids.second },
            },
          },
          {
            id: "call_sc02_readback",
            type: "tool",
            name: "subagent",
            time: { created: 5, ran: 5 },
            state: {
              status: "running",
              input: { description: "Child metadata readback", agent: "build", prompt: "Wait for the actual child" },
              metadata: { sessionID: ids.missing },
            },
          },
          {
            id: "call_sc02_starting",
            type: "tool",
            name: "subagent",
            time: { created: 5 },
            state: { status: "streaming", input: '{"description":"Still preparing the child"}' },
          },
          {
            id: "call_sc02_startup_error",
            type: "tool",
            name: "subagent",
            time: { created: 5, completed: 6 },
            state: {
              status: "error",
              input: { description: "Failed before child creation", agent: "build", prompt: "Saved startup input" },
              error: { type: "TaskFailed", message: startupError },
            },
          },
          {
            id: "call_sc02_wrong_parent",
            type: "tool",
            name: "subagent",
            time: { created: 5, ran: 5 },
            state: {
              status: "running",
              input: { description: "Reference with another saved parent", agent: "build", prompt: "Keep the source" },
              metadata: { sessionID: ids.foreign },
            },
          },
          {
            id: "call_sc02_linked_task",
            type: "tool",
            name: "task",
            time: { created: 5, ran: 5, completed: 6 },
            state: {
              status: "completed",
              input: { description: "Linked Task child", subagent_type: "build", prompt: "Saved Task source" },
              content: [{ type: "text", text: "A Task reference is not a subagent Tool call." }],
              metadata: { sessionID: ids.linked, status: "completed" },
            },
          },
        ],
      },
    ]

    const workspace = await mockWorkspace(page, {
      name: "SC02 collaboration sources",
      sessions: [
        {
          id: ids.parent,
          title: "SC02 collaboration sources",
          agent: "meta",
          controller: { kind: "root", metaAgentID: "mag_sc02", rootSessionID: ids.parent },
        },
        {
          id: ids.first,
          title: "Shared worker name",
          parentID: ids.parent,
          controller: {
            kind: "child",
            metaAgentID: "mag_sc02",
            rootSessionID: ids.parent,
            executor: { agent: "build", model: { providerID: "fixture", id: "fixture" }, source: "tool" },
            source: { kind: "subagent", assistantMessageID: foregroundMessageID, toolCallID: "call_sc02_foreground" },
          },
        },
        { id: ids.second, title: "Shared worker name", parentID: ids.parent },
        { id: ids.linked, title: "Shared worker name", parentID: ids.parent },
        {
          id: ids.workflow,
          title: "Related run",
          parentID: ids.parent,
          controller: {
            kind: "child",
            metaAgentID: "mag_sc02",
            rootSessionID: ids.parent,
            executor: { agent: "build", model: { providerID: "fixture", id: "fixture" }, source: "tool" },
            source: { kind: "workflow", runID: "wfr_sc02", stepRunID: "wsr_sc02", inputID: "msg_sc02_workflow" },
          },
        },
        {
          id: ids.formal,
          title: "Formal participant child",
          parentID: ids.parent,
          controller: {
            kind: "child",
            metaAgentID: "mag_sc02",
            rootSessionID: ids.parent,
            executor: { agent: "build", model: { providerID: "fixture", id: "fixture" }, source: "tool" },
            source: { kind: "task", delegationID: "dlg_sc02", participantID: "par_sc02" },
          },
        },
        { id: ids.foreign, title: "Shared worker name", parentID: "ses_sc02_another_parent" },
      ],
      pageMessages: (id) => ({ items: id === ids.parent ? messages : [] }),
      sessionStatus: () => activity,
      meta: {
        [ids.parent]: {
          owner: {
            id: "mag_sc02",
            title: "SC02 actual Meta owner",
            agent: "meta",
            model: { providerID: "fixture", id: "fixture" },
            time: { created: 1, updated: 12 },
          },
          controller: { kind: "root", metaAgentID: "mag_sc02", rootSessionID: ids.parent },
          sessions: [
            { sessionID: ids.parent, role: "orchestrator" },
            { sessionID: ids.first, role: "worker" },
            { sessionID: ids.formal, role: "worker" },
            { sessionID: ids.linked, role: "worker" },
            { sessionID: ids.workflow, role: "worker" },
          ],
        },
      },
      delegations: () => delegations[ids.parent],
      seed: { tabs: [ids.parent], settings: { timelineDetail: timelinePresets[2].value } },
      async onSession(id) {
        if (id !== ids.missing) return
        readback.requests.push(id)
        readbackStarted.resolve()
        await releaseReadback.promise

        if (readback.sessions.some((item) => item.id === id)) return
        readback.sessions.push(
          session({
            id,
            title: "Readback worker",
            parentID: ids.parent,
            directory: "C:/AigcForge/SC02 collaboration sources",
            projectID: "proj_sc02_collaboration_sources",
          }),
        )
      },
    })

    readback.sessions = workspace.sessions
    await page.goto(sessionHref(ids.parent))
    await expectSessionTitle(page, "SC02 collaboration sources")
    await openSidePanel(page, "Subagents")
    const subagentPanel = page.getByRole("region", { name: "Subagents", exact: true })
    const panel = page.getByRole("region", { name: "Task delegation", exact: true })
    const ordinary = subagentPanel.locator('[data-slot="subagent-group"]')
    const child = (id: string) => ordinary.getByRole("article", { name: `Subagent: ${id}`, exact: true })

    const source = (messageID: string, callID: string) =>
      ordinary
        .locator('[data-slot="subagent-call"]')
        .filter({ has: page.getByText(messageID, { exact: true }) })
        .filter({ has: page.getByText(callID, { exact: true }) })

    const related = subagentPanel.locator('[data-slot="collaboration-related-group"]')

    const relatedChild = (title: string) =>
      related
        .locator('[data-slot="collaboration-related-session"]')
        .filter({ has: page.getByRole("button", { name: title, exact: true }) })

    const openRecords = async (expectedGroups: number, expectedCalls: number) => {
      const groups = ordinary.locator('[data-slot="subagent-call-records"] > [data-slot="collapsible-trigger"]')
      await expect(groups).toHaveCount(expectedGroups)

      for (const group of await groups.all()) {
        if ((await group.getAttribute("aria-expanded")) !== "true") await group.click()
        await expect(group).toHaveAttribute("aria-expanded", "true")
      }

      const calls = ordinary.locator(
        '[data-slot="subagent-call"] [data-slot="task-disclosure"] > [data-slot="collapsible-trigger"]',
      )
      await expect(calls).toHaveCount(expectedCalls)

      for (const call of await calls.all()) {
        if ((await call.getAttribute("aria-expanded")) !== "true") await call.click()
        await expect(call).toHaveAttribute("aria-expanded", "true")
      }
    }

    await expect(subagentPanel.getByRole("heading", { name: "Subagents", exact: true })).toBeVisible()
    await expect(subagentPanel.locator('[data-slot="task-empty"]')).toHaveCount(0)
    await expect(subagentPanel.getByText("No child sessions yet.", { exact: true })).toHaveCount(0)
    await expect(child(ids.first).getByRole("button", { name: "Shared worker name", exact: true })).toBeEnabled()
    await expect(child(ids.second).getByRole("button", { name: "Shared worker name", exact: true })).toBeEnabled()
    await openRecords(6, 8)
    await expect(child(ids.first).locator('[data-slot="subagent-call"]')).toHaveCount(2)
    const foreground = source(foregroundMessageID, "call_sc02_foreground")
    const background = source(backgroundMessageID, "call_sc02_background")
    await expect(foreground.getByText("Tool call: Completed", { exact: true })).toBeVisible()
    await expect(background.getByText("Tool call: Running", { exact: true })).toBeVisible()
    await expect(child(ids.first).locator('[data-slot="subagent-session-status"]')).toHaveText("Running")
    await expect(child(ids.second).locator('[data-slot="subagent-session-status"]')).toHaveText("Running")
    await expect(
      source(runningMessageID, "call_sc02_starting").getByText("Tool call: Starting", { exact: true }),
    ).toBeVisible()
    await expect(
      source(runningMessageID, "call_sc02_starting").getByRole("button", { name: "Open as main session", exact: true }),
    ).toHaveCount(0)
    await expect(source(runningMessageID, "call_sc02_wrong_parent")).toBeVisible()
    await expect(child(ids.foreign).getByRole("button", { name: "Open as main session", exact: true })).toHaveCount(0)
    await expect(related.locator('[data-slot="collaboration-related-session"]')).toHaveCount(3)
    await expect(relatedChild("Shared worker name")).toHaveCount(1)
    await expect(relatedChild("Related run")).toHaveCount(1)
    await expect(relatedChild("Formal participant child")).toHaveCount(1)
    await expect(child(ids.linked)).toHaveCount(0)
    await expect(child(ids.workflow)).toHaveCount(0)
    await expect(ordinary.getByRole("button", { name: /^(Stop|Interrupt|Retry)(?: session| worker)?$/ })).toHaveCount(0)
    await readbackStarted.promise
    const missingCall = source(runningMessageID, "call_sc02_readback")
    await expect(missingCall).toBeVisible()
    await expect(child(ids.missing).getByText("Loading child session…", { exact: true })).toBeVisible()
    await expect(missingCall.getByText("Tool call: Completed", { exact: true })).toHaveCount(0)
    await expect(child(ids.missing).getByRole("button", { name: "Open as main session", exact: true })).toHaveCount(0)

    const metadata = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === `/api/session/${ids.missing}`,
    )

    releaseReadback.resolve()
    expect((await metadata).ok()).toBe(true)
    await expect(child(ids.missing).getByRole("button", { name: "Readback worker", exact: true })).toBeEnabled()
    await expect(child(ids.missing).getByRole("button", { name: "Open as main session", exact: true })).toBeVisible()
    expect(readback.requests).toContain(ids.missing)

    for (const target of [
      { id: ids.linked, title: "Shared worker name" },
      { id: ids.workflow, title: "Related run" },
      { id: ids.formal, title: "Formal participant child" },
    ]) {
      await relatedChild(target.title).getByRole("button", { name: target.title, exact: true }).click()
      const view = page
        .locator("#session-side-panel-subagents-tabpanel")
        .locator('[data-component="session-content-panel"]')
      await expect(
        view.locator('[data-slot="session-content-heading"]').getByRole("heading", { name: target.title, exact: true }),
      ).toBeVisible()
      const details = view
        .locator('[data-slot="session-content-heading"] [data-slot="session-content-metadata"]')
        .getByRole("button", { name: "Execution details", exact: true })
      await expect(details).toHaveAttribute("aria-expanded", "false")
      await details.click()
      await expect(details).toHaveAttribute("aria-expanded", "true")
      await expect(view.getByText(target.id, { exact: true })).toBeVisible()
      await expect(page).toHaveURL(new URL(sessionHref(ids.parent), page.url()).href)
      await view.getByRole("button", { name: "Back to subagents", exact: true }).click()
      await expect(view).toHaveCount(0)
      await expect(subagentPanel.getByRole("heading", { name: "Subagents", exact: true })).toBeVisible()
    }

    await openRecords(6, 8)
    const firstOutput = foreground.locator('[data-slot="delegation-result"]')
    const firstOutputTrigger = firstOutput.getByRole("button", { name: "Open original tool output", exact: true })
    await firstOutputTrigger.click()
    await expect(firstOutputTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(firstOutput.locator("pre")).toHaveText(foregroundResult)
    backgroundTool.state = {
      status: "completed",
      input: backgroundInput,
      content: [{ type: "text", text: backgroundResult }],
      metadata: { sessionID: ids.first, status: "running" },
    }
    await workspace.push([
      {
        id: "evt_sc02_background_ack",
        type: SessionEvent.Tool.Success.type,
        created: 8,
        durable: { aggregateID: ids.parent, seq: 8, version: 2 },
        data: {
          sessionID: ids.parent,
          assistantMessageID: backgroundMessageID,
          id: "call_sc02_background",
          content: [{ type: "text", text: backgroundResult }],
          metadata: { sessionID: ids.first, status: "running" },
          executed: false,
        },
      },
    ])
    await expect(background.getByText("Tool call: Running in background", { exact: true })).toBeVisible()
    await expect(child(ids.first).locator('[data-slot="subagent-session-status"]')).toHaveText("Running")
    await expect(firstOutputTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(firstOutput.locator("pre")).toHaveText(foregroundResult)
    const cancelled = source(runningMessageID, "call_sc02_cancelled")
    await expect(cancelled.getByText("Tool call: Error", { exact: true })).toBeVisible()
    await cancelled.getByRole("button", { name: "Open original tool output", exact: true }).click()
    await expect(cancelled.locator("pre")).toHaveText(cancelledResult)
    const startup = source(runningMessageID, "call_sc02_startup_error")
    await expect(startup.getByText("Tool call: Error", { exact: true })).toBeVisible()
    await startup.getByRole("button", { name: "Open original tool output", exact: true }).click()
    await expect(startup.locator("pre")).toHaveText(startupError)
    await expect(startup.getByRole("button", { name: "Open as main session", exact: true })).toHaveCount(0)
    await workspace.push([
      {
        id: "evt_sc02_permission",
        type: "permission.asked",
        created: 9,
        location: { directory: workspace.directory },
        data: {
          id: "per_sc02",
          sessionID: ids.second,
          action: "read",
          resources: ["src/**"],
          source: { type: "tool", messageID: "msg_sc02_child_read", id: "call_sc02_child_read" },
        },
      },
    ])
    await expect(child(ids.second).locator('[data-slot="subagent-session-status"]')).toHaveText("Waiting for input")
    await expect(cancelled.locator("pre")).toHaveText(cancelledResult)
    await workspace.push([
      {
        id: "evt_sc02_permission_done",
        type: "permission.replied",
        created: 10,
        location: { directory: workspace.directory },
        data: { sessionID: ids.second, requestID: "per_sc02", reply: "once" },
      },
    ])
    await expect(child(ids.second).locator('[data-slot="subagent-session-status"]')).toHaveText("Running")
    delete activity[ids.first]
    await workspace.push([
      {
        id: "evt_sc02_idle",
        type: SessionEvent.Execution.Succeeded.type,
        created: 11,
        durable: { aggregateID: ids.first, seq: 1, version: 1 },
        data: { sessionID: ids.first },
      },
    ])
    await expect(child(ids.first).locator('[data-slot="subagent-session-status"]')).toHaveText("Idle")
    activity[ids.first] = { type: "busy" }
    await workspace.push([
      {
        id: "evt_sc02_running",
        type: SessionEvent.Execution.Started.type,
        created: 12,
        durable: { aggregateID: ids.first, seq: 2, version: 1 },
        data: { sessionID: ids.first },
      },
    ])
    await expect(child(ids.first).locator('[data-slot="subagent-session-status"]')).toHaveText("Running")
    await expect(child(ids.first).locator('[data-slot="subagent-call"]')).toHaveCount(2)
    await expect(foreground.getByText("Tool call: Completed", { exact: true })).toBeVisible()
    await expect(firstOutputTrigger).toHaveAttribute("aria-expanded", "true")
    delegations[ids.parent] = [
      {
        delegation: {
          id: "dlg_sc02",
          parentSessionID: ids.parent,
          title: "Saved formal collaboration",
          status: "running",
          rejectionBlocked: false,
          lastActivityAt: 12,
          createdAt: 1,
          updatedAt: 12,
        },
        participants: [
          {
            id: "par_sc02",
            delegationID: "dlg_sc02",
            provider: "internal",
            target: "build",
            role: "implementer",
            context: "fresh",
            phase: "active",
            runtimeStatus: "idle",
            childSessionID: ids.formal,
            lastActivityAt: 12,
            createdAt: 1,
            updatedAt: 12,
          },
        ],
        turns: [],
        deliveries: [],
        reviews: [],
        barrier: { passed: false, completionEligible: false },
        softExpired: false,
      },
    ]
    await subagentPanel.getByRole("button", { name: "Reload collaborations", exact: true }).click()
    await expect(subagentPanel.getByRole("heading", { name: "Subagents", exact: true })).toBeVisible()
    await expect(relatedChild("Formal participant child")).toHaveCount(0)
    await expect(related.locator('[data-slot="collaboration-related-session"]')).toHaveCount(2)
    await expect(relatedChild("Shared worker name")).toBeVisible()
    await expect(relatedChild("Related run")).toBeVisible()
    await expect(firstOutputTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(firstOutput.locator("pre")).toHaveText(foregroundResult)
    await page.screenshot({ path: testInfo.outputPath("sc02-subagents-normal.png") })
    await openSidePanel(page, "Task delegation")
    await expect(panel.getByRole("heading", { name: "Delegations", exact: true })).toBeVisible()
    await expect(panel.getByRole("heading", { name: "Saved formal collaboration", exact: true })).toBeVisible()
    await expect(panel.getByRole("listitem", { name: "Participant: build · par_sc02", exact: true })).toBeVisible()
    await expect(panel.locator('[data-slot="subagent-group"]')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath("sc02-collaborations-normal.png") })

    await openAdvanced(page)
    const meta = page.getByRole("region", { name: "Advanced management", exact: true })
    const metaDetails = meta
      .locator('[data-slot="meta-recorded-details"]')
      .getByRole("button", { name: "Execution details", exact: true })
    await expect(metaDetails).toHaveAttribute("aria-expanded", "false")
    await metaDetails.click()
    await expect(metaDetails).toHaveAttribute("aria-expanded", "true")
    const attached = meta.getByRole("listitem", { name: `Session: ${ids.first}`, exact: true })
    await expect(attached.getByText("Session: Running", { exact: true })).toBeVisible()
    await expect(attached.getByText(foregroundMessageID, { exact: true })).toBeVisible()
    await expect(attached.getByText("call_sc02_foreground", { exact: true })).toBeVisible()
    const linked = meta.getByRole("listitem", { name: `Session: ${ids.linked}`, exact: true })
    await expect(linked.getByText(ids.linked, { exact: true })).toBeVisible()
    await expect(linked.getByRole("button", { name: /^Open (Subagent|Task|Workflow) source$/ })).toHaveCount(0)
    const workflow = meta.getByRole("listitem", { name: `Session: ${ids.workflow}`, exact: true })
    await expect(workflow.getByText("Workflow", { exact: true })).toBeVisible()
    await expect(workflow.getByText("wfr_sc02", { exact: true })).toBeVisible()
    await expect(workflow.getByText("wsr_sc02", { exact: true })).toBeVisible()
    await expect(workflow.getByText("msg_sc02_workflow", { exact: true })).toBeVisible()
    await attached.getByRole("button", { name: "Open Subagent source", exact: true }).click()
    const selectedSubagentSource = subagentPanel.getByRole("region", {
      name: "Selected collaboration source",
      exact: true,
    })
    await expect(page.locator("#review-panel").getByRole("tab", { name: "Subagents", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(selectedSubagentSource.getByText(ids.parent, { exact: true })).toBeVisible()
    await expect(selectedSubagentSource.getByText(foregroundMessageID, { exact: true })).toBeVisible()
    await expect(selectedSubagentSource.getByText("call_sc02_foreground", { exact: true })).toBeVisible()
    await openRecords(1, 1)
    await expect(child(ids.first).locator('[data-slot="subagent-call"]')).toHaveCount(1)
    await expect(foreground).toBeVisible()
    await expect(source(backgroundMessageID, "call_sc02_background")).toHaveCount(0)
    await page.reload()
    await expectSessionTitle(page, "SC02 collaboration sources")
    await openSidePanel(page, "Subagents")
    await expect(selectedSubagentSource.getByText(ids.parent, { exact: true })).toBeVisible()
    await expect(selectedSubagentSource.getByText(foregroundMessageID, { exact: true })).toBeVisible()
    await expect(selectedSubagentSource.getByText("call_sc02_foreground", { exact: true })).toBeVisible()
    await openRecords(1, 1)
    await firstOutputTrigger.click()
    await expect(firstOutputTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(firstOutput.locator("pre")).toHaveText(foregroundResult)
    await subagentPanel.getByRole("button", { name: "Show all collaborations", exact: true }).click()
    await expect(selectedSubagentSource).toHaveCount(0)
    await openRecords(6, 8)
    await expect(child(ids.first).locator('[data-slot="subagent-call"]')).toHaveCount(2)

    await openAdvanced(page)
    await expect(metaDetails).toHaveAttribute("aria-expanded", "false")
    await metaDetails.click()
    await expect(metaDetails).toHaveAttribute("aria-expanded", "true")
    const formal = meta.getByRole("listitem", { name: `Session: ${ids.formal}`, exact: true })
    await expect(formal.getByText("Session: Idle", { exact: true })).toBeVisible()
    await formal.getByRole("button", { name: "Open Task source", exact: true }).click()
    const selected = panel.getByRole("region", { name: "Selected collaboration source", exact: true })
    await expect(selected.getByText("dlg_sc02", { exact: true })).toBeVisible()
    await expect(selected.getByText("par_sc02", { exact: true })).toBeVisible()
    await expect(panel.getByRole("listitem", { name: "Participant: build · par_sc02", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    )
    await expect(panel.locator('[data-slot="subagent-group"]')).toHaveCount(0)
    await panel.getByRole("button", { name: "Show all collaborations", exact: true }).click()
    await expect(selected).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    await openSidePanel(page, "Task delegation")
    await expect(panel.getByRole("heading", { name: "Saved formal collaboration", exact: true })).toBeVisible()
    await openSidePanel(page, "Subagents")
    await expect(subagentPanel.getByRole("heading", { name: "Subagents", exact: true })).toBeVisible()
    await openRecords(6, 8)
    await expect(child(ids.first).locator('[data-slot="subagent-call"]')).toHaveCount(2)

    if ((await firstOutputTrigger.getAttribute("aria-expanded")) !== "true") await firstOutputTrigger.click()
    await expect(firstOutputTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(firstOutput.locator("pre")).toHaveText(foregroundResult)
    await page.screenshot({ path: testInfo.outputPath("sc02-collaborations-narrow.png") })
  })

  for (const pendingInput of [false, true] as const) {
    test(`MC09 Workflow and Meta keep actual sources, revisions, recorded usage, and child navigation${pendingInput ? " with a pending source input" : ""}`, async ({
      page,
    }, testInfo) => {
      const sessionID = "ses_workflow_ui"
      const historicalChildID = "ses_workflow_history_child"
      const stream = await installSseTransport(page, { server: SERVER })

      const savedInput: SessionMessageInfo = {
        id: "msg_workflow_saved_input",
        type: "user",
        text: "Actual historical worker input中文\nSecond line retained from the original child.",
        time: { created: 100 },
      }

      const fact = {
        id: "mem_project_ui",
        projectID: "proj_workflow_consumer",
        metaAgentID: "mag_workflow_ui",
        factCategory: "api",
        content: "Saved project API fact",
        sourceSessionID: sessionID,
        timeCreated: 1,
        timeUpdated: 2,
      } satisfies MetaAgentMemoryRecord

      const run: WorkflowAssetWorkflowStatusResponse = {
        run: {
          id: "wfr_ui",
          sessionID,
          snapshotDigest: "a".repeat(64),
          workflowName: "Release workflow 中文",
          workflowRevision: "b".repeat(64),
          status: "running",
          revision: 7,
          source: { type: "tool", messageID: "msg_workflow_tool", id: "call_workflow" },
          parentTaskID: "tsk_workflow_ui",
          timeCreated: 1000,
          timeUpdated: 2000,
        },
        steps: [
          {
            id: "swr_failed",
            runId: "wfr_ui",
            stepId: "build",
            agentId: "builder",
            status: "failed",
            attempt: 1,
            revision: 3,
            childSessionId: "ses_workflow_child",
            outputDigest: "Actual saved step result",
            errorCategory: "step_failed",
            timeCreated: 1000,
            timeStarted: 1100,
            timeCompleted: 1800,
          },
          {
            id: "swr_running",
            runId: "wfr_ui",
            stepId: "publish",
            agentId: "publisher",
            status: "running",
            attempt: 1,
            revision: 4,
            timeCreated: 1000,
            timeStarted: 1900,
          },
          {
            id: "swr_skipped",
            runId: "wfr_ui",
            stepId: "optional",
            agentId: "publisher",
            status: "skipped",
            attempt: 1,
            revision: 1,
            timeCreated: 1000,
            timeCompleted: 2000,
          },
        ],
      }

      const calls: { action: string; body: unknown }[] = []
      const inputReads: string[] = []
      const sourceReads: { sessionID: string; runID?: string }[] = []

      const historical: WorkflowAssetWorkflowStatusResponse = {
        run: {
          id: "wfr_historical_ui",
          sessionID,
          snapshotDigest: "c".repeat(64),
          workflowName: "Release workflow 中文",
          workflowRevision: "d".repeat(64),
          status: "failed",
          revision: 5,
          source: { type: "tool", messageID: "msg_workflow_tool", id: "call_workflow" },
          parentTaskID: "tsk_saved_ui",
          parentRunID: "wfr_saved_root",
          rootRunID: "wfr_saved_root",
          retryOfStepRunID: "swr_saved_root",
          timeCreated: 100,
          timeUpdated: 200,
          timeCompleted: 200,
        },
        steps: [
          {
            id: "swr_historical_ui",
            runId: "wfr_historical_ui",
            stepId: "build",
            agentId: "builder",
            status: "failed",
            attempt: 1,
            revision: 2,
            childSessionId: historicalChildID,
            outputDigest: "Actual historical step result",
            timeCreated: 100,
            timeStarted: 120,
            timeCompleted: 200,
          },
        ],
      }

      const parentRun: WorkflowAssetWorkflowStatusResponse = {
        run: {
          id: "wfr_saved_root",
          sessionID,
          snapshotDigest: "e".repeat(64),
          workflowName: "Release workflow 中文",
          workflowRevision: "f".repeat(64),
          status: "failed",
          revision: 3,
          timeCreated: 50,
          timeUpdated: 100,
          timeCompleted: 100,
        },
        steps: [
          {
            id: "swr_saved_root",
            runId: "wfr_saved_root",
            stepId: "build",
            agentId: "builder",
            status: "failed",
            attempt: 1,
            revision: 2,
            timeCreated: 50,
            timeCompleted: 100,
          },
        ],
      }

      const messages: SessionMessageInfo[] = [
        { id: "msg_workflow_prompt", type: "user", text: "Run the accepted Work workflow", time: { created: 900 } },
        {
          id: "msg_workflow_tool",
          type: "assistant",
          agent: "meta",
          model: { providerID: "fixture", id: "fixture" },
          time: { created: 1000, completed: 4000 },
          tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 300, write: 40 } },
          content: [
            {
              id: "call_workflow",
              type: "tool",
              name: "task",
              time: { created: 1000, ran: 1100, completed: 4000 },
              state: {
                status: "completed",
                input: {
                  description: "Original workflow Task",
                  prompt: "Run the accepted Work workflow",
                  subagent_type: "builder",
                },
                content: [{ type: "text", text: "Original workflow evidence" }],
                metadata: { status: "completed" },
              },
            },
          ],
        },
      ]

      await openSession(page, {
        name: "Workflow Consumer",
        sessions: [
          {
            id: sessionID,
            title: "Workflow Consumer",
            mode: "work",
            agent: "meta",
            controller: { kind: "root", metaAgentID: "mag_workflow_ui", rootSessionID: sessionID },
          },
          { id: "ses_workflow_child", title: "Workflow child", parentID: sessionID },
          {
            id: historicalChildID,
            title: "Workflow child",
            mode: "assistant",
            parentID: sessionID,
            outcome: "failed",
            controller: {
              kind: "child",
              metaAgentID: "mag_workflow_ui",
              rootSessionID: sessionID,
              executor: { agent: "builder", model: { providerID: "fixture", id: "fixture" }, source: "tool" },
              source: {
                kind: "workflow",
                runID: "wfr_historical_ui",
                stepRunID: "swr_historical_ui",
                inputID: savedInput.id,
              },
            },
          },
        ],
        pageMessages: (id) => ({
          items: id === sessionID ? messages : id === historicalChildID && !pendingInput ? [savedInput] : [],
        }),
        message: (id, messageID) =>
          id === historicalChildID && messageID === savedInput.id
            ? pendingInput
              ? undefined
              : savedInput
            : messages.find((message) => message.id === messageID),
        inbox: pendingInput
          ? [
              {
                id: savedInput.id,
                sessionID: historicalChildID,
                type: "user",
                payload: { text: savedInput.text },
                delivery: "steer",
                time: savedInput.time,
              },
            ]
          : [],
        onMessage(input) {
          if (input.messageID === savedInput.id) inputReads.push(input.messageID)
        },
        workflows: { [sessionID]: run },
        workflowHistory: [historical, parentRun],
        onWorkflowRead(input) {
          if (input.runID) sourceReads.push(input)

          return undefined
        },
        meta: {
          [sessionID]: {
            owner: {
              id: "mag_workflow_ui",
              title: "Current Meta owner",
              agent: "meta",
              model: { providerID: "cpu", id: "cpu" },
              time: { created: 1, updated: 2 },
            },
            controller: { kind: "root", metaAgentID: "mag_workflow_ui", rootSessionID: sessionID },
            sessions: [
              { sessionID, role: "orchestrator" },
              { sessionID: "ses_workflow_child", role: "worker" },
              { sessionID: historicalChildID, role: "worker" },
            ],
            stats: {
              totalSessions: 3,
              recordedTokens: 320,
              unknownTokenSessionCount: 1,
              stepCount: 2,
              unknownStepCount: 0,
              recordedOnly: true,
              physicalAttemptCoverage: "unknown",
            },
          },
        },
        projectMemory: { [sessionID]: [fact] },
        cacheDiagnostics: {
          [sessionID]: {
            sessionHitRate: 75,
            sessionCacheRead: 300,
            sessionCacheWrite: 40,
            sessionTotalInput: 100,
            confidence: "high",
            perStep: [{ assistantMessageID: "msg_workflow_tool", hitRate: 75, cacheRead: 300, cacheWrite: 40 }],
          },
        },
        onWorkflowAction(action, input) {
          calls.push({ action, body: input.body })

          if (action === "cancelStep") {
            if (run.run) run.run = { ...run.run, revision: 8 }

            return new ConflictError({ message: "Run revision changed", resource: "workflow" })
          }

          if (run.run) run.run = { ...run.run, status: "cancelled", revision: 9, timeCompleted: 5000 }

          return run
        },
      })
      await openSidePanel(page, "Workflow run")
      const workflow = page.getByRole("region", { name: "Workflow run", exact: true })
      const failed = workflow.getByRole("listitem", { name: "Step build · attempt 1", exact: true })
      await failed.getByText("Recorded step details", { exact: true }).click()
      await expect(failed.getByText("Actual saved step result", { exact: true })).toBeVisible()
      await workflow.getByRole("button", { name: "Cancel step", exact: true }).click()
      await expect(workflow.getByRole("alert")).toContainText("Run revision changed")
      await workflow.getByRole("button", { name: "Cancel workflow", exact: true }).click()
      await expect(workflow.getByRole("status")).toContainText("Workflow cancellation acknowledged.")
      expect(calls).toEqual([
        { action: "cancelStep", body: { expectedRunRevision: 7, expectedStepRevision: 4 } },
        { action: "cancelRun", body: { expectedRunRevision: 8 } },
      ])
      await openAdvanced(page)
      const meta = page.getByRole("region", { name: "Advanced management", exact: true })
      const metaDetails = meta
        .locator('[data-slot="meta-recorded-details"]')
        .getByRole("button", { name: "Execution details", exact: true })
      await expect(metaDetails).toHaveAttribute("aria-expanded", "false")
      await metaDetails.click()
      await expect(metaDetails).toHaveAttribute("aria-expanded", "true")
      await expect(meta.getByText("Current Meta owner", { exact: true })).toBeVisible()
      await expect(meta.getByText("Saved project API fact", { exact: true })).toBeVisible()
      await expect(meta.getByText("Meta total tokens", { exact: true }).locator("..")).toContainText("Unknown")
      await expect(
        meta
          .locator(':scope > [data-slot="task-toolbar"]')
          .getByRole("button", { name: "Refresh Meta state", exact: true }),
      ).toBeEnabled()
      fact.content = "Project API fact after reconnect"
      const connection = await stream.waitForConnection()
      await stream.disconnect()
      await stream.waitForConnection({ after: connection.id })
      await expect(meta.getByText(fact.content, { exact: true })).toBeVisible()
      await meta
        .getByRole("listitem")
        .filter({ hasText: fact.content })
        .getByRole("button", { name: "Delete", exact: true })
        .click()
      await meta.getByRole("button", { name: "Delete project fact", exact: true }).click()
      await expect(meta.getByText(fact.content, { exact: true })).toHaveCount(0)
      const history = meta.getByRole("listitem", { name: `Session: ${historicalChildID}`, exact: true })
      await expect(history.getByText("Session: Failed", { exact: true })).toBeVisible()
      await expect(history.getByText("wfr_historical_ui", { exact: true })).toBeVisible()
      await history.getByRole("button", { name: "Open Workflow source", exact: true }).click()
      const selectedSource = workflow.getByRole("region", { name: "Selected workflow source", exact: true })
      await expect(selectedSource.getByText("wfr_historical_ui", { exact: true })).toBeVisible()
      const selectedStep = workflow.getByRole("listitem", { name: "Step build · attempt 1", exact: true })
      await expect(selectedStep).toHaveAttribute("aria-current", "step")
      await expect(selectedStep.getByText("Actual historical step result", { exact: true })).toBeVisible()
      await expect(workflow.getByRole("region", { name: "Source input", exact: true }).locator("pre")).toHaveText(
        savedInput.text,
      )
      await expect(
        workflow.getByRole("button", { name: pendingInput ? "Open pending input" : "Open input message", exact: true }),
      ).toBeVisible()

      if (pendingInput) {
        await expect(
          workflow.getByRole("region", { name: "Source input", exact: true }).getByRole("status"),
        ).toHaveText("Pending input")
        expect(inputReads).toEqual([])
      }

      if (!pendingInput) expect(inputReads).toEqual([savedInput.id])
      await page.screenshot({
        path: testInfo.outputPath(`workflow-source-${pendingInput ? "pending" : "promoted"}.png`),
      })
      await expect(workflow.getByRole("button", { name: "Cancel workflow", exact: true })).toHaveCount(0)
      expect(sourceReads).toContainEqual({ sessionID, runID: "wfr_historical_ui" })
      await workflow.getByRole("button", { name: "Open retried step", exact: true }).click()
      await expect(selectedSource.getByText("wfr_saved_root", { exact: true })).toBeVisible()
      await expect(workflow.getByRole("listitem", { name: "Step build · attempt 1", exact: true })).toHaveAttribute(
        "aria-current",
        "step",
      )
      expect(sourceReads).toContainEqual({ sessionID, runID: "wfr_saved_root" })
      await workflow.getByRole("button", { name: "Show current run", exact: true }).click()
      await expect(selectedSource).toHaveCount(0)
      await expect(workflow.getByText("wfr_ui", { exact: true })).toBeVisible()
      expect(calls).toHaveLength(2)
      await page.getByRole("button", { name: "View context usage", exact: true }).click()
      const usage = page.getByRole("region", { name: "Recorded usage", exact: true })
      const recorded = usage.getByRole("button", { name: "Recorded usage", exact: true })
      await expect(recorded).toHaveAttribute("aria-expanded", "false")
      await expect(usage.getByRole("button", { name: /Open recorded step:/ })).toHaveCount(0)
      await recorded.click()
      await expect(recorded).toHaveAttribute("aria-expanded", "true")
      await expect(usage.getByText("Session cache hit rate", { exact: true }).locator("..")).toContainText("75%")
      await usage.getByRole("button", { name: /Open recorded step: msg_workflow_tool/ }).click()
      await expect(usage).toContainText("Original workflow evidence")
      await page.screenshot({ path: testInfo.outputPath("workflow-meta-cache.png") })
      await openSidePanel(page, "Workflow run")
      await workflow.getByRole("button", { name: "Open worker session", exact: true }).click()
      await expectSessionTitle(page, "Workflow child")
      await page.goBack()
      await page.reload()
      await openSidePanel(page, "Workflow run")
      await expect(workflow.getByText("Release workflow 中文", { exact: true }).locator("..")).toContainText(
        "Cancelled",
      )
      expect(calls).toHaveLength(2)
    })
  }

  for (const scenario of ["metrics", "step", "step-error"] as const) {
    test(`MC09 Context keeps the newest same-session ${scenario} response`, async ({ page }) => {
      const sessionID = "ses_context_requests"
      const started = Promise.withResolvers<void>()
      const released = Promise.withResolvers<void>()
      const state = { armed: false, cacheReads: 0 }

      const cache = {
        [sessionID]: {
          sessionHitRate: 75,
          sessionCacheRead: 300,
          sessionCacheWrite: 40,
          sessionTotalInput: 100,
          confidence: "high",
          perStep: [
            { assistantMessageID: "msg_context_a", hitRate: 75, cacheRead: 300, cacheWrite: 40 },
            { assistantMessageID: "msg_context_b", hitRate: 75, cacheRead: 300, cacheWrite: 40 },
          ],
        },
      } satisfies Record<string, SessionInstanceCacheDiagnostics>

      const retained: SessionMessageInfo[] = ["a", "b"].map((id) => ({
        id: `msg_context_${id}`,
        type: "assistant",
        agent: "build",
        model: { providerID: "fixture", id: "fixture" },
        time: { created: 1000, completed: 2000 },
        content: [{ type: "text", text: id === "a" ? "Older recorded A" : "Latest recorded B" }],
      }))

      const priorAttempt: SessionAttemptInfo = {
        ordinal: 0,
        attemptID: "attempt_context_prior",
        agent: "build",
        selection: { type: "group", groupID: "context-balanced" },
        model: { providerID: "context-provider", id: "prior" },
        apiModelID: "prior",
        quote: { status: "unknown" },
        goalRefs: [],
        transition: "initial",
        started: 1000,
        observations: [],
        terminal: {
          status: "failed",
          ended: 1200,
          outputStarted: true,
          usage: { input: 200, output: 20, reasoning: 10, cache: { read: 100, write: 20 } },
        },
      }

      const currentAttempt: SessionAttemptInfo = {
        ...priorAttempt,
        ordinal: 1,
        attemptID: "attempt_context_current",
        model: { providerID: "context-provider", id: "current" },
        apiModelID: "current",
        transition: "continuation",
        started: 1300,
        terminal: undefined,
      }

      const currentUsage: NonNullable<SessionAttemptInfo["terminal"]> = {
        status: "completed",
        ended: 1800,
        outputStarted: true,
        usage: { input: 100, output: 30, reasoning: 10, cache: { read: 100, write: 10 } },
      }

      const latest: SessionMessageAssistant = {
        id: "msg_context_current",
        type: "assistant",
        agent: "build",
        model: priorAttempt.model,
        attempts: [priorAttempt, currentAttempt],
        time: { created: 1000 },
        tokens: { input: 300, output: 50, reasoning: 20, cache: { read: 200, write: 30 } },
        cost: 0.37,
        content: [{ type: "text", text: "Current physical request result" }],
      }

      const workspace = await openSession(page, {
        name: "Context requests",
        sessions: [{ id: sessionID, title: "Context requests", cost: 0.37 }],
        pageMessages: () => ({ items: scenario === "metrics" ? [latest] : [] }),
        provider: {
          all: [
            {
              id: "context-provider",
              name: "Context provider",
              models: {
                prior: { id: "prior", name: "Prior physical model", limit: { context: 2000, output: 500 } },
                current: { id: "current", name: "Current physical model", limit: { context: 1000, output: 500 } },
              },
            },
          ],
          connected: ["context-provider"],
          default: { providerID: "context-provider", modelID: "current" },
        },
        cacheDiagnostics: cache,
        message: (_sessionID, messageID) =>
          scenario === "step-error" && messageID === "msg_context_b"
            ? undefined
            : retained.find((message) => message.id === messageID),
        async onCacheRead() {
          if (scenario === "step" || !state.armed || ++state.cacheReads !== 1) return
          started.resolve()
          await released.promise

          if (scenario === "metrics") return new InvalidRequestError({ message: "Older metrics request failed" })
        },
        async onMessage(input) {
          if (scenario !== "step" || !state.armed || input.messageID !== "msg_context_a") return
          started.resolve()
          await released.promise
        },
      })

      await page.getByRole("button", { name: "View context usage", exact: true }).click()
      const usage = page.getByRole("region", { name: "Recorded usage", exact: true })
      const recorded = usage.getByRole("button", { name: "Recorded usage", exact: true })
      await expect(recorded).toHaveAttribute("aria-expanded", "false")
      await expect(usage.getByRole("button", { name: /Open recorded step:/ })).toHaveCount(0)
      await recorded.click()
      await expect(recorded).toHaveAttribute("aria-expanded", "true")
      const refresh = usage.getByRole("button", { name: "Refresh usage", exact: true })
      const hitRate = usage.getByText("Session cache hit rate", { exact: true }).locator("..")
      await expect(hitRate).toContainText("75%")
      await expect(refresh).toBeEnabled()
      state.armed = true

      if (scenario === "step-error") {
        await usage.getByRole("button", { name: "Open recorded step: msg_context_a", exact: true }).click()
        await expect(usage).toContainText("Older recorded A")

        const refreshed = page.waitForResponse(
          (response) => new URL(response.url()).pathname === `/session/${sessionID}/cache-diagnostics`,
        )

        await refresh.click()
        await started.promise

        const missing = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/session/${sessionID}/message/msg_context_b` &&
            response.status() === 404,
        )

        await usage.getByRole("button", { name: "Open recorded step: msg_context_b", exact: true }).click()
        await (await missing).finished()
        await expect(usage.getByRole("alert")).toContainText("Message not found")
        cache[sessionID] = { ...cache[sessionID]!, sessionHitRate: 90 }
        released.resolve()
        await (await refreshed).finished()
        await expect(hitRate).toContainText("90%")
        await expect(refresh).toBeEnabled()
        await expect(usage.getByRole("alert")).toContainText("Message not found")
        await expect(usage).toContainText("Older recorded A")

        return
      }

      if (scenario === "metrics") {
        const context = page.locator('[data-slot="session-usage-content"]')
        const stat = (label: string) => context.getByText(label, { exact: true }).locator("..")

        const rawMessages = context.getByRole("region", { name: "Raw messages", exact: true })
        const rawToggle = rawMessages.getByRole("button", { name: "Raw messages", exact: true })
        const rawID = context.getByText(`• ${latest.id}`, { exact: true })
        await expect(rawID).toHaveCount(0)
        await expect(rawToggle).toHaveAttribute("aria-expanded", "false")
        await expect(rawMessages.getByRole("button", { name: "Export session", exact: true })).toBeEnabled()
        await rawToggle.click()
        await expect(rawToggle).toHaveAttribute("aria-expanded", "true")
        await expect(rawID).toBeVisible()
        await rawToggle.click()
        await expect(rawToggle).toHaveAttribute("aria-expanded", "false")
        await expect(rawID).toHaveCount(0)
        await expect(rawMessages.getByRole("button", { name: "Export session", exact: true })).toBeEnabled()

        await expect(stat("Provider")).toHaveText("ProviderContext provider")
        await expect(stat("Model")).toHaveText("ModelCurrent physical model")
        await expect(stat("Context Limit")).toHaveText("Context Limit1,000")
        await expect(stat("Total Tokens")).toHaveText("Total Tokens—")
        await expect(stat("Usage")).toHaveText("Usage—")
        await expect(stat("Total Cost")).toHaveText("Total Cost$0.37")
        await expect(page.getByText("Current physical request result", { exact: true })).toHaveCount(1)

        await workspace.push([
          {
            id: "evt_context_attempt_usage",
            type: SessionEvent.Attempt.Ended.type,
            created: 1800,
            durable: { aggregateID: sessionID, seq: 1, version: 1 },
            location: { directory: workspace.directory },
            data: { sessionID, assistantMessageID: latest.id, ordinal: currentAttempt.ordinal, terminal: currentUsage },
          },
        ])
        await expect(stat("Total Tokens")).toHaveText("Total Tokens250")
        await expect(stat("Usage")).toHaveText("Usage25%")
        await expect(stat("Input Tokens")).toHaveText("Input Tokens100")
        await expect(stat("Output Tokens")).toHaveText("Output Tokens30")
        await expect(stat("Reasoning Tokens")).toHaveText("Reasoning Tokens10")
        await expect(stat("Cache Tokens (read/write)")).toHaveText("Cache Tokens (read/write)100 / 10")
        await expect(stat("Total Cost")).toHaveText("Total Cost$0.37")
        await expect(page.getByText("Current physical request result", { exact: true })).toHaveCount(1)

        const ended = (seq: number) =>
          ({
            id: `evt_context_${seq}`,
            type: SessionEvent.Step.Ended.type,
            created: 3000 + seq,
            durable: { aggregateID: sessionID, seq, version: 1 },
            location: { directory: workspace.directory },
            data: {
              sessionID,
              assistantMessageID: latest.id,
              finish: "stop",
              cost: 0,
              tokens: latest.tokens!,
            },
          }) satisfies Parameters<typeof workspace.push>[0][number]

        const firstMeta = page.waitForResponse(
          (response) => new URL(response.url()).pathname === `/session/${sessionID}/meta`,
        )

        await workspace.push([ended(2)])
        await started.promise
        await (await firstMeta).finished()
        cache[sessionID] = { ...cache[sessionID]!, sessionHitRate: 90 }

        const nextMeta = page.waitForRequest(
          (request) => new URL(request.url()).pathname === `/session/${sessionID}/meta`,
        )

        await workspace.push([ended(3)])
        await nextMeta

        const rejected = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/session/${sessionID}/cache-diagnostics` && response.status() === 400,
        )

        released.resolve()
        await (await rejected).finished()
        await expect(hitRate).toContainText("90%")
        await expect(refresh).toBeEnabled()
        await expect(usage.getByRole("alert")).toHaveCount(0)
        await expect(stat("Total Tokens")).toHaveText("Total Tokens250")
        await expect(stat("Model")).toHaveText("ModelCurrent physical model")
        await expect(stat("Total Cost")).toHaveText("Total Cost$0.37")
        await expect(page.getByText("Current physical request result", { exact: true })).toHaveCount(1)

        return
      }

      await usage.getByRole("button", { name: "Open recorded step: msg_context_a", exact: true }).click()
      await started.promise
      await usage.getByRole("button", { name: "Open recorded step: msg_context_b", exact: true }).click()
      await expect(usage).toContainText("Latest recorded B")

      const older = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/session/${sessionID}/message/msg_context_a`,
      )

      released.resolve()
      await (await older).finished()
      await expect(usage).toContainText("Latest recorded B")
      await expect(usage).not.toContainText("Older recorded A")
    })
  }

  test("MC09 Work Workflow run and retry submit Meta requests before recorded execution changes", async ({
    page,
  }, testInfo) => {
    const sessionID = "ses_workflow_requests"

    const asset: WorkflowAssetInfo = {
      kind: "workflow",
      name: "Published release 中文",
      description: "Release using the published worker",
      relativePath: "releases/published.yaml",
      revision: "a".repeat(64),
      content: "Published workflow content",
      version: "1",
      triggers: [],
      steps: [
        { id: "build", name: "Build release", agent: "release-worker", input: { prompt: "Published step input" } },
      ],
    }

    const status: WorkflowAssetWorkflowStatusResponse = { steps: [] }
    const requests: { sessionID: string; body: unknown }[] = []
    const direct: string[] = []

    const workspace = await openSession(page, {
      name: "Workflow requests",
      sessions: [
        {
          id: sessionID,
          title: "Workflow requests",
          mode: "work",
          agent: "meta",
          controller: { kind: "root", metaAgentID: "mag_requests", rootSessionID: sessionID },
        },
      ],
      workflows: { [sessionID]: status },
      workflowAssets: [asset],
      agentAssets: [
        {
          kind: "agent",
          name: "release-worker",
          description: "Published release worker",
          relativePath: "workers/release.md",
          revision: "b".repeat(64),
          config: "mode: subagent\n",
          source: "Published release worker\n",
          handoffs: [],
        },
      ],
      onPrompt(input) {
        requests.push(input)
      },
      onWorkflowAction(action) {
        direct.push(action)

        return new InvalidRequestError({ message: "Work execution belongs to Meta Task" })
      },
      strictDirectory: true,
    })

    await openSidePanel(page, "Workflow run")
    const workflow = page.getByRole("region", { name: "Workflow run", exact: true })
    const selection = workflow.getByRole("group", { name: "Workflow definition", exact: true }).getByRole("button")
    await expect(selection).toBeEnabled()
    await selection.click()
    await page.getByRole("option", { name: asset.name, exact: true }).click()
    const run = workflow.getByRole("button", { name: "Run workflow", exact: true })
    await expect(run).toBeEnabled()

    const admitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${sessionID}/prompt`,
    )

    await run.press("Enter")
    expect((await admitted).ok()).toBe(true)
    await expect(workflow.getByRole("status")).toHaveText("Workflow run request submitted to Meta.")
    await expect(workflow.getByText("No recorded workflow run for this session.", { exact: true })).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      sessionID,
      body: { id: expect.stringMatching(/^msg_/), text: expect.any(String) },
    })
    const first = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, text: Schema.String }))(requests[0]?.body)
    const argumentsText = first.text.match(/```json\n([\s\S]*?)\n```/)?.[1]
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(argumentsText)).toEqual({
      description: `Run ${asset.name}`,
      prompt: `Execute the published steps of ${asset.name}.`,
      workflow: {
        source: "temporary",
        agents: [{ kind: "agent", relativePath: "workers/release.md", revision: "b".repeat(64) }],
        workflow: { kind: "workflow", relativePath: asset.relativePath, revision: asset.revision },
        bindings: {},
        presentation: "native",
        requestedCapabilities: [],
      },
    })
    status.run = {
      id: "wfr_request_original",
      sessionID,
      snapshotDigest: "c".repeat(64),
      workflowName: asset.name,
      workflowRevision: asset.revision,
      status: "failed",
      revision: 5,
      source: { type: "tool", messageID: "msg_actual_task", id: "call_actual_task" },
      parentTaskID: "tsk_actual_task",
      timeCreated: 1000,
      timeUpdated: 2000,
      timeCompleted: 2000,
    }
    status.steps = [
      {
        id: "swr_request_original",
        runId: status.run.id,
        stepId: "build",
        agentId: "release-worker",
        status: "failed",
        attempt: 1,
        revision: 4,
        timeCreated: 1000,
        timeCompleted: 2000,
        outputDigest: "Owner retained failed result",
      },
    ]
    await workspace.push([
      {
        ...Schema.encodeSync(WorkflowEvent.Updated)(
          Schema.decodeUnknownSync(WorkflowEvent.Updated)({
            id: "evt_workflow_request",
            type: WorkflowEvent.Updated.type,
            created: 2000,
            durable: { aggregateID: status.run.id, seq: 1, version: 1 },
            location: { directory: workspace.directory },
            data: {
              runID: status.run.id,
              sessionID,
              status: status.run.status,
              revision: status.run.revision,
              timeUpdated: 2000,
            },
          }),
        ),
        durable: { aggregateID: status.run.id, seq: 1, version: 1 },
      },
    ])
    await expect(workflow.getByText("call_actual_task", { exact: true })).toBeVisible()
    const step = workflow.getByRole("listitem", { name: "Step build · attempt 1", exact: true })
    const retry = step.getByRole("button", { name: "Retry step", exact: true })
    await expect(retry).toBeEnabled()

    const retryAdmitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${sessionID}/prompt`,
    )

    await retry.click()
    expect((await retryAdmitted).ok()).toBe(true)
    await expect(workflow.getByRole("status")).toHaveText("Workflow retry request submitted to Meta.")
    await expect(workflow.getByText("call_actual_task", { exact: true })).toBeVisible()
    expect(requests).toHaveLength(2)

    const second = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, text: Schema.String }))(
      requests[1]?.body,
    )

    expect(second.id).not.toBe(first.id)
    expect(
      Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(
        second.text.match(/```json\n([\s\S]*?)\n```/)?.[1],
      ),
    ).toEqual({
      description: "Retry build",
      prompt: `Retry the recorded build step of ${asset.name}.`,
      workflow_retry: {
        runID: status.run.id,
        stepRunID: "swr_request_original",
        expectedRunRevision: 5,
        expectedStepRevision: 4,
      },
    })
    expect(direct).toEqual([])
    await page.screenshot({ path: testInfo.outputPath("work-workflow-admission.png") })
    status.run = {
      ...status.run,
      id: "wfr_request_retry",
      source: { type: "tool", messageID: "msg_retry_task", id: "call_retry_task" },
      parentTaskID: "tsk_retry_task",
      parentRunID: "wfr_request_original",
      retryOfStepRunID: "swr_request_original",
      revision: 1,
      status: "completed",
    }
    status.steps = []
    await workflow.getByRole("button", { name: "Reload workflow", exact: true }).click()
    await expect(workflow.getByText("call_retry_task", { exact: true })).toBeVisible()
    await page.reload()
    await openSidePanel(page, "Workflow run")
    await expect(workflow.getByText("call_retry_task", { exact: true })).toBeVisible()
    expect(requests).toHaveLength(2)
  })

  for (const retained of [true, false]) {
    test(`MC09 Custom Workflow ${retained ? "runs and retries from its saved composition despite an ACK read failure" : "keeps retained-events refusal separate from history and cancellation"}`, async ({
      page,
    }, testInfo) => {
      const sessionID = "ses_custom_workflow"

      const snapshot = Schema.decodeUnknownSync(Composition.Snapshot)({
        version: 2,
        digest: "d".repeat(64),
        sessionID,
        createdAt: 1,
        data: {
          agents: [
            {
              id: "worker",
              name: "worker",
              description: "Saved worker",
              relativePath: "worker.md",
              revision: "a".repeat(64),
            },
          ],
          workflow: {
            name: "Saved Custom workflow",
            description: "Saved release steps",
            relativePath: "saved.yaml",
            revision: "b".repeat(64),
            steps: [{ id: "build", name: "Build the saved release", agent: "worker" }],
          },
          instructions: [],
          prompts: [],
          skills: [],
          tools: { fingerprints: [], catalogDigest: "c".repeat(64), catalog: [] },
        },
      })

      const status: WorkflowAssetWorkflowStatusResponse = { steps: [] }
      const state = { unreadable: false }
      const calls: { action: string; sessionID: string; runID?: string; stepRunID?: string; body: unknown }[] = []

      const history: NonNullable<WorkflowAssetWorkflowStatusResponse["run"]> = {
        id: "wfr_custom_saved",
        sessionID,
        snapshotDigest: snapshot.digest,
        workflowName: "Saved Custom workflow",
        workflowRevision: "b".repeat(64),
        status: "failed",
        revision: 5,
        timeCreated: 1000,
        timeUpdated: 2000,
        timeCompleted: 2000,
      }

      const failed = {
        id: "swr_custom_saved",
        runId: history.id,
        stepId: "build",
        agentId: "worker",
        status: "failed" as const,
        attempt: 1,
        revision: 3,
        timeCreated: 1000,
        timeCompleted: 2000,
        outputDigest: "Saved failed step",
      }

      await openSession(page, {
        name: "Custom Workflow",
        sessions: [{ id: sessionID, title: "Custom Workflow", mode: "custom" }],
        compositions: { [sessionID]: snapshot },
        workflows: { [sessionID]: status },
        onWorkflowRead: () =>
          state.unreadable
            ? new InvalidRequestError({ message: "Workflow refresh temporarily unavailable" })
            : undefined,
        onWorkflowAction(action, input) {
          calls.push({ action, ...input })

          if (action !== "cancelRun" && !retained)
            return new InvalidRequestError({
              message: "Retained events are disabled",
              kind: "workflow_requires_retained_events",
            })

          if (action === "run") {
            status.run = history
            status.steps = [failed]
            state.unreadable = true

            return status
          }

          if (action === "retryStep") {
            status.run = {
              ...history,
              id: "wfr_custom_retry",
              status: "running",
              revision: 1,
              parentRunID: history.id,
              retryOfStepRunID: failed.id,
            }
            status.steps = []

            return status
          }

          if (status.run) status.run = { ...status.run, status: "cancelled", revision: status.run.revision + 1 }

          return status
        },
        strictDirectory: true,
      })
      await openSidePanel(page, "Workflow run")
      const workflow = page.getByRole("region", { name: "Workflow run", exact: true })
      const run = workflow.getByRole("button", { name: "Run workflow", exact: true })
      await expect(run).toBeEnabled()
      await run.click()

      if (retained) {
        await expect(workflow.getByRole("status")).toHaveText("Workflow run accepted.")
        await expect(workflow.getByRole("alert")).toContainText("Workflow refresh temporarily unavailable")
        await expect(workflow.getByText(history.id, { exact: true })).toBeVisible()
        state.unreadable = false
      }

      if (!retained) {
        await expect(workflow.getByRole("alert")).toContainText("Workflow execution requires retained events.")
        await expect(workflow.getByText("No recorded workflow run for this session.", { exact: true })).toBeVisible()
        status.run = history
        status.steps = [failed]
      }

      await workflow.getByRole("button", { name: "Reload workflow", exact: true }).click()
      const step = workflow.getByRole("listitem", { name: "Step build · attempt 1", exact: true })
      await step.getByText("Recorded step details", { exact: true }).click()
      await expect(step.getByText("Saved failed step", { exact: true })).toBeVisible()
      await step.getByRole("button", { name: "Retry step", exact: true }).click()

      if (retained) await expect(workflow.getByRole("status")).toHaveText("Step retry accepted as a new workflow run.")

      if (!retained) {
        await expect(workflow.getByRole("alert")).toContainText("Workflow execution requires retained events.")
        status.run = { ...history, status: "running", revision: 6 }
        await workflow.getByRole("button", { name: "Reload workflow", exact: true }).click()
      }

      await workflow.getByRole("button", { name: "Cancel workflow", exact: true }).click()
      await expect(workflow.getByRole("status")).toHaveText("Workflow cancellation acknowledged.")

      const start = Schema.decodeUnknownSync(
        Schema.Struct({ requestID: Schema.String, expectedSnapshotDigest: Schema.String }),
      )(calls[0]?.body)

      expect(start.expectedSnapshotDigest).toBe(snapshot.digest)
      expect(calls[1]).toMatchObject({
        action: "retryStep",
        sessionID,
        runID: history.id,
        stepRunID: failed.id,
        body: { expectedRunRevision: 5, expectedStepRevision: 3 },
      })
      expect(calls[2]).toMatchObject({ action: "cancelRun", body: { expectedRunRevision: retained ? 1 : 6 } })
      await page.screenshot({ path: testInfo.outputPath(`custom-workflow-${retained ? "running" : "events-off"}.png`) })
      await page.reload()
      await openSidePanel(page, "Workflow run")
      await expect(workflow.getByText("Saved Custom workflow", { exact: true }).locator("..")).toContainText(
        "Cancelled",
      )
      expect(calls).toHaveLength(3)
    })
  }
})

test("project sessions follow message activity and remain stable while viewed", async ({ page }) => {
  const latest = {
    id: "ses_sidebar_message_latest",
    title: "Latest message session",
    mode: "coding",
    time: { created: 1000, updated: 2000, message: 2000 },
  }

  const older = {
    id: "ses_sidebar_message_older",
    title: "Older message renamed session",
    mode: "coding",
    time: { created: 1000, updated: 9000, message: 1500 },
  }

  const copied = {
    id: "ses_sidebar_copied_history",
    title: "New fork with older messages",
    mode: "coding",
    time: { created: 6000, updated: 6000, message: 1250 },
  }

  const empty = {
    id: "ses_sidebar_empty_session",
    title: "Empty session",
    mode: "coding",
    time: { created: 1750, updated: 1750 },
  }

  const legacy = {
    id: "ses_sidebar_legacy_copied_history",
    title: "Legacy fork with older messages",
    mode: "coding",
    time: { created: 7000, updated: 7000 },
  }

  const workspace = await mockWorkspace(page, {
    name: "Message order",
    sessions: [legacy, copied, older, empty, latest],
    pageMessages: (id) => ({
      items:
        id === legacy.id
          ? [{ id: "msg_sidebar_legacy_copy", type: "user", text: "Copied earlier prompt", time: { created: 1100 } }]
          : [],
    }),
  })

  await page.goto(sessionHref(latest.id))
  await expectSessionTitle(page, latest.title)

  const toggle = page.getByRole("button", { name: "Projects", exact: true })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  const projects = page.locator("#shell-project-sidebar")
  const titles = projects.locator('[data-component="home-session-title"]')
  await expect(titles).toHaveText([latest.title, empty.title, older.title, copied.title, legacy.title])
  await projects.getByRole("button", { name: older.title, exact: true }).click()
  await expectSessionTitle(page, older.title)
  await expect(titles).toHaveText([latest.title, empty.title, older.title, copied.title, legacy.title])
  await projects.getByRole("button", { name: latest.title, exact: true }).click()
  await expectSessionTitle(page, latest.title)
  await expect(titles).toHaveText([latest.title, empty.title, older.title, copied.title, legacy.title])
  await workspace.push([
    {
      id: "evt_sidebar_new_message",
      type: "session.step.started",
      created: 10000,
      durable: { aggregateID: older.id, seq: 1, version: 1 },
      data: {
        sessionID: older.id,
        assistantMessageID: "msg_sidebar_new_message",
        agent: "build",
        model: { providerID: "aigcfroge", id: "test" },
        started: 10000,
      },
    },
  ])
  await expect(titles).toHaveText([older.title, latest.title, empty.title, copied.title, legacy.title])
})
