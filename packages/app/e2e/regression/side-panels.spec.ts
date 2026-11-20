import { expect, test, type Locator, type Page } from "@playwright/test"
import type {
  CommandAssetListOutput,
  PromptAssetListOutput,
  SkillAssetListOutput,
  SkillInfo,
  SessionMessageInfo,
  SessionGoalInfo,
  SessionCommunicationMessage,
  AigcForgeEvent,
  ScheduleRule,
  ScheduleOccurrence,
} from "@aigcfroge/client/promise"
import { ApiNotFoundError, ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { base64Encode } from "@aigcfroge/util/encode"
import { Match, Schema } from "effect"
import { AgentAssets } from "../utils/agent-asset"
import { CommandAssets } from "../utils/command-asset"
import { CustomProfileFixture } from "../utils/custom-profile"
import { McpAssets } from "../utils/mcp-asset"
import { PluginAssets } from "../utils/plugin-asset"
import { PromptAssets } from "../utils/prompt-asset"
import { SkillAssets } from "../utils/skill-asset"
import { WorkflowAssets } from "../utils/workflow-asset"
import {
  expectPath,
  holdRoute,
  pageMessagesFrom,
  project,
  provider,
  REMOTE_SERVER,
  SERVER,
  seed,
  session,
  sessionHref,
  tabKey,
} from "../utils/app"
import { installSseTransport } from "../utils/sse-transport"
import { fileDiff, fileNode, mockRemoteServer, openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"
import { attachSession, openAdvanced, openSidePanel } from "../utils/side-panel"
import {
  mockServers,
  type MockCommunicationMutation,
  type MockGoalMutation,
  type MockScheduleMutation,
} from "../utils/mock-server"
import type { WorkspaceInput } from "../utils/workspace"

test("web browser module uses the shared launcher without native IPC or extra controls", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 900 })
  const title = "Browser module"
  await openSession(page, { name: title, sessions: [{ id: "ses_browser_module", title, mode: "chat" }] })
  await openSidePanel(page, "Browser")
  const panel = page.locator("#browser-panel")
  await expect(panel.getByText("The built-in browser is available in the desktop app.", { exact: true })).toBeVisible()

  const geometry = () =>
    panel.evaluate((element) => {
      const region = element.closest("#review-panel") ?? element.parentElement
      const description = element.querySelector("p")
      const heading = element.querySelector("h2")

      if (!region || !description || !heading) throw new Error("Browser panel geometry is unavailable")
      const box = element.getBoundingClientRect()
      const boundaries = [region.getBoundingClientRect(), { left: 0, right: window.innerWidth }]
      const animations = element.getAnimations()
      let ancestor = element.parentElement

      while (ancestor) {
        if (getComputedStyle(ancestor).overflowX !== "visible") boundaries.push(ancestor.getBoundingClientRect())
        animations.push(...ancestor.getAnimations())
        ancestor = ancestor.parentElement
      }

      const left = Math.max(...boundaries.map((boundary) => boundary.left))
      const right = Math.min(...boundaries.map((boundary) => boundary.right))
      const text = description.getBoundingClientRect()
      const title = heading.getBoundingClientRect()

      return {
        panelLeft: box.left,
        panelRight: box.right,
        boundaryLeft: left,
        boundaryRight: right,
        descriptionLeft: text.left,
        descriptionRight: text.right,
        contentWidth: element.closest('[data-slot="session-review-content"]')?.getBoundingClientRect().width,
        contained: box.left >= left - 1 && box.right <= right + 1 && text.left >= left - 1 && text.right <= right + 1,
        centered: Math.abs((title.left + title.right - left - right) / 2) <= 1,
        animating: animations.some(
          (animation) =>
            animation.playState === "running" && animation.effect?.getComputedTiming().endTime !== Infinity,
        ),
      }
    })

  await expect(panel.locator("iframe")).toHaveCount(0)
  await expect(panel.getByRole("textbox")).toHaveCount(0)
  await expect(panel.getByRole("button")).toHaveCount(0)
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await page.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("Control+Shift+B")
  await expect(panel).toBeVisible()
  const browserTab = page.locator("#review-panel").getByRole("tab", { name: "Browser", exact: true })
  const browserClose = browserTab.locator("..").getByRole("button", { name: "Close tab", exact: true })
  await page.locator('[data-component="composer-editor"]').click()
  await page.mouse.move(0, 0)
  await expect(browserClose).toHaveCSS("opacity", "0")
  await browserTab.hover()
  await expect(browserClose).toHaveCSS("opacity", "1")
  await browserClose.click()
  await expect(browserTab).toHaveCount(0)
  await page.locator('[data-component="composer-editor"]').press("Control+Shift+B")
  await expect(panel).toBeVisible()
  await testInfo.attach("browser-reopened-geometry", {
    body: JSON.stringify(await geometry(), null, 2),
    contentType: "application/json",
  })
  await expect.poll(geometry).toMatchObject({ contained: true, centered: true, animating: false })
  await testInfo.attach("browser-wide-geometry", {
    body: JSON.stringify(await geometry(), null, 2),
    contentType: "application/json",
  })
  await page.screenshot({ path: testInfo.outputPath("browser-web-module-wide.png") })

  for (const [language, description] of [
    ["简体中文", "内置浏览器可在桌面端使用。"],
    ["繁體中文", "內建瀏覽器可在桌面端使用。"],
  ]) {
    await page.locator('[data-component="composer-editor"]').click()
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    await settings.locator('[data-action="settings-language"]').click()
    await page.getByRole("option", { name: language, exact: true }).click()
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expect(panel.getByText(description, { exact: true })).toBeVisible()
  }

  await page.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await settings.locator('[data-action="settings-language"]').click()
  await page.getByRole("option", { name: "English", exact: true }).click()
  await settings.getByRole("switch", { name: "Show Browser", exact: true }).press("Space")
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await openSidePanel(page, "Context")
  await page.locator("#review-panel").getByRole("button", { name: "Add tab", exact: true }).click()
  const launcher = page.locator('#review-panel [data-component="session-panel-launcher"]')
  await expect(launcher.getByRole("button", { name: "Browser", exact: true })).toHaveCount(0)
  await page.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("Control+,")
  await settings.getByRole("switch", { name: "Show Browser", exact: true }).press("Space")
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await openSidePanel(page, "Browser")
  await expect(panel.getByText("The built-in browser is available in the desktop app.", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button")).toHaveCount(0)
  await expect.poll(geometry).toMatchObject({ contained: true, centered: true, animating: false })
  await testInfo.attach("browser-narrow-geometry", {
    body: JSON.stringify(await geometry(), null, 2),
    contentType: "application/json",
  })
  await page.screenshot({ path: testInfo.outputPath("browser-web-module-narrow.png") })
  expect(errors).toEqual([])
})

test("Chinese sidebar labels follow live language changes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const title = "中文侧栏"
  const sessionID = "ses_sidebar_chinese"
  await openSession(page, {
    name: title,
    sessions: [
      {
        id: sessionID,
        title,
        mode: "chat",
      },
    ],
    vcsDiff: [fileDiff("sidebar-chinese.ts")],
    seed: { locale: "zh" },
  })
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hans")
  const modes = page.getByRole("navigation", { name: "模式", exact: true })

  for (const name of ["聊天", "编程", "工作", "助手", "自定义"]) {
    await modes.getByRole("button", { name, exact: true }).hover()
    await expect(page.getByRole("tooltip", { name, exact: true })).toHaveText(name)
  }

  await page.getByRole("button", { name: "切换审查", exact: true }).click()
  const side = page.locator("#review-panel")
  await side.getByRole("button", { name: "添加标签页", exact: true }).click()
  const launcher = side.locator('[data-component="session-panel-launcher"]')

  await expect(side.getByRole("tab", { name: "新标签", exact: true })).toHaveAttribute("aria-selected", "true")

  for (const name of [
    "上下文",
    "审查",
    "任务委派",
    "技能提案",
    "命令提案",
    "提示词提案",
    "智能体提案",
    "MCP提案",
    "插件提案",
    "工作流提案",
  ]) {
    await expect(launcher.getByRole("button", { name, exact: true })).toBeVisible()
  }

  await page.screenshot({ path: testInfo.outputPath("sidebar-chinese-launcher.png") })
  await launcher.getByRole("button", { name: "打开文件", exact: true }).click()
  await expect(side.getByRole("tab", { name: "打开文件", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(side.getByRole("switch", { name: "预览文件", exact: true })).toHaveCount(0)

  for (const [name, expected] of [
    ["任务委派", "暂无任务。"],
    ["技能提案", "此会话尚无已完成的技能提案。"],
    ["命令提案", "此会话尚无已完成的命令提案。"],
    ["提示词提案", "此会话尚无已完成的提示词提案。"],
    ["智能体提案", "此会话尚无已完成的智能体提案。"],
    ["MCP提案", "此会话尚无已完成的MCP提案。"],
    ["插件提案", "此会话尚无已完成的插件提案。"],
    ["工作流提案", "此会话尚无已完成的工作流提案。"],
  ]) {
    await side.getByRole("button", { name: "添加标签页", exact: true }).click()
    await launcher.getByRole("button", { name, exact: true }).click()
    await expect(side.getByRole("tab", { name: "新标签", exact: true })).toHaveCount(0)
    await expect(side.getByText(expected, { exact: true })).toBeVisible()
  }

  await page.screenshot({ path: testInfo.outputPath("sidebar-chinese-wide.png") })

  await page.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")

  for (const name of [
    "显示任务委派",
    "显示高级管理",
    "显示工作流运行",
    "显示产物",
    "显示文件",
    "显示审查",
    "显示浏览器",
    "显示上下文",
    "显示技能提案",
    "显示命令提案",
    "显示提示词提案",
    "显示智能体提案",
    "显示MCP提案",
    "显示插件提案",
    "显示工作流提案",
  ]) {
    await expect(settings.getByRole("switch", { name, exact: true })).toBeChecked()
  }

  await expect(settings.getByRole("switch", { name: "使用临时文件标签", exact: true })).not.toBeChecked()
  await settings.locator('[data-action="settings-language"]').click()
  await page.getByRole("option", { name: "English", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await expect(settings.getByRole("switch", { name: "Show task delegation", exact: true })).toBeChecked()
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await openSidePanel(page, "Open file")
  await expect(side.getByRole("switch", { name: "Preview files", exact: true })).toHaveCount(0)
  await openSidePanel(page, "Task delegation")
  await expect(side.getByRole("region", { name: "Task delegation", exact: true })).toBeVisible()
  await expect(side.getByText("No tasks yet.", { exact: true })).toBeVisible()
  await page.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("Control+,")
  await settings.locator('[data-action="settings-language"]').click()
  await page.getByRole("option", { name: "简体中文", exact: true }).click()
  await expect(settings.getByRole("switch", { name: "显示任务委派", exact: true })).toBeChecked()
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole("tablist", { name: "会话视图", exact: true })
    .getByRole("tab", { name: "更多…", exact: true })
    .click()
  const drawer = page.getByRole("dialog")
  await drawer.getByRole("button", { name: "任务委派", exact: true }).click()
  await expect(drawer).toBeHidden()
  await expect(page.getByRole("region", { name: "任务委派", exact: true })).toBeVisible()
  await expect(page.getByText("暂无任务。", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("sidebar-chinese-narrow.png") })

  await page.setViewportSize({ width: 1600, height: 900 })
  await seed(page, { locale: "zht" })
  await page.reload()
  await expectSessionTitle(page, title)
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant")
  await expect(side.getByRole("tab", { name: "任務委派", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(side.getByRole("region", { name: "任務委派", exact: true })).toBeVisible()
  await expect(side.getByText("尚無任務。", { exact: true })).toBeVisible()
  await side.getByRole("button", { name: "新增分頁", exact: true }).click()
  await expect(launcher).toBeVisible()

  for (const name of [
    "任務委派",
    "子智慧體工作階段",
    "技能提案",
    "命令提案",
    "提示詞提案",
    "智慧體提案",
    "MCP提案",
    "外掛提案",
    "工作流提案",
  ])
    await expect(launcher.getByRole("button", { name, exact: true })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath("sidebar-traditional-chinese-launcher.png") })
  await launcher.getByRole("button", { name: "子智慧體工作階段", exact: true }).click()
  await expect(side.getByRole("tab", { name: "子智慧體工作階段", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await expect(side.getByRole("region", { name: "子智慧體工作階段", exact: true })).toBeVisible()
  await expect(side.getByText("暫無子工作階段。", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("sidebar-traditional-chinese-subagents.png") })
})

test("new tab launcher keeps one placeholder and opens advanced management inside task delegation", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const sessionID = "ses_panel_launcher"
  const title = "Panel launcher"
  await openSession(page, {
    name: "PanelLauncher",
    sessions: [
      {
        id: sessionID,
        title,
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_panel_launcher", rootSessionID: sessionID },
      },
    ],
  })
  const side = page.locator("#review-panel")
  const add = side.getByRole("button", { name: "Add tab", exact: true })
  const guide = side.getByRole("tab", { name: "New tab", exact: true })
  const launcher = side.locator('[data-component="session-panel-launcher"]')
  const delegation = side.getByRole("tab", { name: "Task delegation", exact: true })
  const advanced = side.getByRole("tab", { name: "Advanced management", exact: true })
  await openSidePanel(page, "Task delegation")
  const composer = page.locator('[data-component="composer-editor"]')
  await composer.press("Control+Alt+N")
  await expect(guide).toHaveAttribute("aria-selected", "true")
  await expect(guide).toHaveCount(1)
  await expect(launcher.getByRole("button", { name: "Task delegation", exact: true })).toBeVisible()
  await expect(launcher.getByRole("button", { name: "Subagents", exact: true })).toBeVisible()
  await expect(launcher.getByRole("button", { name: "Advanced management", exact: true })).toHaveCount(0)
  await composer.press("Control+Alt+A")
  const subagents = side.getByRole("tab", { name: "Subagents", exact: true })
  await expect(subagents).toHaveAttribute("aria-selected", "true")
  await expect(subagents).toHaveCount(1)
  await expect(guide).toHaveCount(0)
  await composer.press("Control+Alt+N")
  await expect(guide).toHaveAttribute("aria-selected", "true")
  await add.click()
  await expect(guide).toHaveCount(1)
  await launcher.getByRole("button", { name: "Task delegation", exact: true }).click()
  await expect(guide).toHaveCount(0)
  await expect(delegation).toHaveAttribute("aria-selected", "true")
  await expect(delegation).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("panel-launcher-wide.png") })
  await side
    .getByRole("region", { name: "Task delegation", exact: true })
    .getByRole("button", { name: "Advanced management", exact: true })
    .click()
  await expect(delegation).toHaveAttribute("aria-selected", "true")
  await expect(advanced).toHaveCount(0)

  const search = side
    .getByRole("region", { name: "Advanced management", exact: true })
    .getByRole("textbox", { name: "Search project facts", exact: true })

  const draft = "Keep this fact search while reopening advanced management."
  await search.fill(draft)
  await openAdvanced(page)
  await expect(advanced).toHaveCount(0)
  await expect(delegation).toHaveCount(1)
  await expect(search).toHaveValue(draft)
  await page.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await expect(settings.getByRole("switch", { name: "Show subagents", exact: true })).toBeChecked()
  await expect(settings.getByRole("switch", { name: "Show advanced management", exact: true })).toBeChecked()
  await settings.getByRole("switch", { name: "Show advanced management", exact: true }).press("Space")
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await expect(advanced).toHaveCount(0)
  await delegation.click()
  await expect(
    side
      .getByRole("region", { name: "Task delegation", exact: true })
      .getByRole("button", { name: "Advanced management", exact: true }),
  ).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("panel-launcher-meta-hidden.png") })
  await page.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("Control+,")
  await settings.getByRole("switch", { name: "Show advanced management", exact: true }).press("Space")
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await openAdvanced(page)
  await expect(advanced).toHaveCount(0)
  await expect(search).toHaveValue(draft)
  await expect(delegation).toHaveCount(1)
})

test("restores the old Meta tab as task delegation and preserves explicit advanced management", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const directory = "C:/AigcForge/MetaTabMigration"
  const sessionID = "ses_meta_tab_migration"
  const rootID = "ses_meta_tab_reference"
  const rootTitle = "Independent reference session"
  const draft = "Keep the saved project fact search through the Meta tab migration."
  await openSession(page, {
    name: "MetaTabMigration",
    directory,
    sessionID,
    sessions: [
      {
        id: sessionID,
        title: "Meta tab migration",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_meta_tab_migration", rootSessionID: sessionID },
      },
      { id: rootID, title: rootTitle },
    ],
  })
  const side = page.locator("#review-panel")
  await attachSession(page, { server: SERVER, sessionID: rootID, title: rootTitle })
  const rootTab = side.locator('[role="tab"][id^="session-side-panel-view-tab-"]')
  await expect(rootTab).toHaveCount(1)
  await expect(rootTab).toContainText(rootTitle)
  const rootKey = await rootTab.getAttribute("data-value")

  if (!rootKey) throw new Error("The independent root view has no saved tab key")

  await openAdvanced(page)
  const advanced = side.getByRole("tab", { name: "Advanced management", exact: true })

  const search = side
    .getByRole("region", { name: "Advanced management", exact: true })
    .getByRole("textbox", { name: "Search project facts", exact: true })

  await search.fill(draft)
  await side.getByRole("button", { name: "Back to collaborations", exact: true }).click()
  await seed(page, {
    storage: {
      "aigcfroge.global.dat:layout": {
        sessionTabs: {
          [`local\u0000${base64Encode(directory)}/${sessionID}`]: {
            all: ["session-management:meta", "session-management:collaborations", rootKey],
            active: "session-management:meta",
          },
        },
      },
    },
  })
  await page.reload()
  await expectSessionTitle(page, "Meta tab migration")
  const delegation = side.getByRole("tab", { name: "Task delegation", exact: true })
  await expect(delegation).toHaveCount(1)
  await expect(delegation).toHaveAttribute("aria-selected", "true")
  await expect(advanced).toHaveCount(0)
  await expect(side.getByRole("region", { name: "Advanced management", exact: true })).toHaveCount(0)
  await expect(rootTab).toHaveCount(1)
  await expect(rootTab).toHaveAttribute("data-value", rootKey)
  await page.screenshot({ path: testInfo.outputPath("old-meta-restored-as-task-delegation.png") })
  await rootTab.click()
  await expect(
    side
      .getByRole("region", { name: "Session views", exact: true })
      .getByRole("heading", { name: rootTitle, level: 3, exact: true }),
  ).toBeVisible()
  await expect(side.getByRole("textbox", { name: "Input to send", exact: true })).toHaveCount(0)
  await openAdvanced(page)
  await expect(delegation).toHaveAttribute("data-value", "session-management:collaborations")
  await expect(advanced).toHaveCount(0)
  await expect(search).toHaveValue(draft)
  await expect(rootTab).toHaveCount(1)
  await page.reload()
  await expectSessionTitle(page, "Meta tab migration")
  await expect(delegation).toHaveAttribute("aria-selected", "true")
  await expect(search).toHaveValue(draft)
  await expect(delegation).toHaveCount(1)
  await expect(rootTab).toHaveAttribute("data-value", rootKey)

  await seed(page, {
    storage: {
      "aigcfroge.global.dat:layout": {
        sessionTabs: {
          [`local\u0000${base64Encode(directory)}/${sessionID}`]: {
            all: ["session-management:advanced", "session-management:collaborations", rootKey],
            active: "session-management:advanced",
          },
        },
      },
    },
  })
  await page.reload()
  await expectSessionTitle(page, "Meta tab migration")
  await expect(delegation).toHaveCount(1)
  await expect(delegation).toHaveAttribute("aria-selected", "true")
  await expect(advanced).toHaveCount(0)
  await expect(search).toHaveValue(draft)
  await expect(rootTab).toHaveAttribute("data-value", rootKey)

  await seed(page, {
    storage: {
      "aigcfroge.global.dat:extension.session-management.display": JSON.stringify({
        collaborations: false,
        meta: false,
        workflow: false,
        artifacts: false,
      }),
    },
  })
  await page.reload()
  await expectSessionTitle(page, "Meta tab migration")
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")

  await expect(settings).toBeVisible()
  await expect(settings.getByRole("switch", { name: "Show subagents", exact: true })).toBeChecked()

  for (const name of ["Show task delegation", "Show advanced management", "Show Workflow run", "Show Artifacts"])
    await expect(settings.getByRole("switch", { name, exact: true })).not.toBeChecked()
})

test("Chat launcher shares Context and Review tabs with original controls and display preferences", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const title = "Chat panel launcher"

  await openSession(page, {
    name: "ChatPanelLauncher",
    sessions: [{ id: "ses_chat_panel_launcher", title, mode: "chat" }],
    vcsDiff: [fileDiff("src/chat-review.ts")],
  })

  const side = page.locator("#review-panel")
  const add = side.getByRole("button", { name: "Add tab", exact: true })
  const guide = side.getByRole("tab", { name: "New tab", exact: true })
  const launcher = side.locator('[data-component="session-panel-launcher"]')
  const context = side.getByRole("tab", { name: "Context", exact: true })
  const review = side.locator("#session-side-panel-review-tab")
  const collaboration = side.getByRole("tab", { name: "Task delegation", exact: true })
  const contextButton = page.getByRole("button", { name: "View context usage", exact: true })
  const reviewToggle = page.getByRole("button", { name: "Toggle review", exact: true })
  const composer = page.locator('[data-component="composer-editor"]')
  const settings = page.getByTestId("settings-screen")

  await openSidePanel(page, "Task delegation")
  await expect(collaboration).toHaveAttribute("data-value", "session-management:collaborations")
  await add.click()
  await expect(guide).toHaveAttribute("aria-selected", "true")

  for (const name of ["Context", "Review", "Task delegation"]) {
    await expect(launcher.getByRole("button", { name, exact: true })).toBeVisible()
  }

  for (const name of ["Advanced management", "Workflow run", "Artifacts"]) {
    await expect(launcher.getByRole("button", { name, exact: true })).toHaveCount(0)
  }

  await composer.press("Control+Alt+C")
  await expect(guide).toHaveCount(0)
  await expect(context).toHaveAttribute("data-value", "context:main")
  await expect(context).toHaveAttribute("aria-selected", "true")
  const usage = side.getByRole("region", { name: "Recorded usage", exact: true })
  await expect(usage).toBeVisible()
  await usage.getByRole("button", { name: "Recorded usage", exact: true }).click()
  await expect(usage.getByRole("button", { name: "Refresh usage", exact: true })).toBeEnabled()
  await collaboration.click()
  await expect(collaboration).toHaveAttribute("aria-selected", "true")
  await contextButton.click()
  await expect(context).toHaveAttribute("aria-selected", "true")
  await expect(context).toHaveAttribute("data-value", "context:main")
  await expect(context).toHaveCount(1)
  await add.click()
  await launcher.getByRole("button", { name: "Review", exact: true }).click()
  await expect(guide).toHaveCount(0)
  await expect(review).toHaveAttribute("data-value", "review:changes")
  await expect(review).toHaveAttribute("aria-selected", "true")
  await expect(review).toHaveText("Files Changed 1")
  await expect(side.locator('[data-slot="session-review-v2-file-name"]')).toHaveText("chat-review.ts")
  await expect(review).toHaveCount(1)
  await reviewToggle.click()
  await expect(reviewToggle).toHaveAttribute("aria-expanded", "false")
  await composer.click()
  await page.keyboard.press("Control+Shift+R")
  await expect(reviewToggle).toHaveAttribute("aria-expanded", "true")
  await expect(review).toHaveAttribute("aria-selected", "true")
  await expect(review).toHaveAttribute("data-value", "review:changes")
  await expect(review).toHaveCount(1)
  await expect(context).toHaveCount(1)
  await expect(collaboration).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("chat-panel-launcher-review.png") })

  for (const [name, key, other, shortcut] of [
    ["Context", "context:main", "Review", "Control+Alt+C"],
    ["Review", "review:changes", "Context", "Control+Alt+R"],
  ] as const) {
    const tab = name === "Review" ? review : context
    const entry = launcher.getByRole("button", { name, exact: true })
    const show = settings.getByRole("switch", { name: `Show ${name}`, exact: true })

    await add.click()
    await expect(guide).toHaveAttribute("aria-selected", "true")
    await expect(entry).toBeVisible()
    await composer.click()
    await page.keyboard.press("Control+,")
    await expect(show).toBeChecked()
    await show.press("Space")
    await expect(show).not.toBeChecked()
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
    await expect(guide).toHaveAttribute("aria-selected", "true")
    await expect(entry).toHaveCount(0)
    await expect(tab).toHaveCount(0)
    await expect(launcher.getByRole("button", { name: other, exact: true })).toBeVisible()
    await expect(name === "Context" ? review : context).toHaveCount(1)
    await composer.press(shortcut)
    await expect(guide).toHaveAttribute("aria-selected", "true")
    await expect(tab).toHaveCount(0)
    await collaboration.click()
    await expect(collaboration).toHaveAttribute("aria-selected", "true")
    await composer.click()
    await page.keyboard.press("Control+,")
    await expect(show).not.toBeChecked()
    await show.press("Space")
    await expect(show).toBeChecked()
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
    await expect(collaboration).toHaveAttribute("aria-selected", "true")
    await expect(collaboration).toHaveAttribute("data-value", "session-management:collaborations")
    await expect(collaboration).toHaveCount(1)
    await expect(tab).toHaveAttribute("data-value", key)
    await expect(tab).toHaveCount(1)
    await add.click()
    await expect(guide).toHaveCount(1)
    await expect(entry).toBeVisible()
    await composer.press(shortcut)
    await expect(guide).toHaveCount(0)
    await expect(tab).toHaveAttribute("aria-selected", "true")
    await expect(tab).toHaveAttribute("data-value", key)
    await expect(tab).toHaveCount(1)
  }
})

test("panel close controls reveal on hover and preserve the draft and closed tabs after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const title = "Panel close controls"
  await openSession(page, {
    name: "PanelCloseControls",
    sessions: [{ id: "ses_panel_close_controls", title, mode: "chat" }],
    vcsDiff: [],
  })
  await openSidePanel(page, "Context")
  await openSidePanel(page, "Review")
  const side = page.locator("#review-panel")
  const add = side.getByRole("button", { name: "Add tab", exact: true })
  const launcher = side.locator('[data-component="session-panel-launcher"]')
  const context = side.getByRole("tab", { name: "Context", exact: true })
  const review = side.locator("#session-side-panel-review-tab")
  const composer = page.locator('[data-component="composer-editor"]')
  await composer.fill("Keep this draft while closing panels")
  for (const [name, tab] of [
    ["Context", context],
    ["Review", review],
  ] as const) {
    const close = tab.locator("..").getByRole("button", { name: "Close tab", exact: true })
    await composer.click()
    await page.mouse.move(0, 0)
    await expect(close).toHaveCSS("opacity", "0")
    await tab.hover()
    await expect(close).toHaveCSS("opacity", "1")
    await close.click()
    await expect(tab).toHaveCount(0)
    await expect(composer).toHaveText("Keep this draft while closing panels")
    await add.click()
    await launcher.getByRole("button", { name, exact: true }).click()
    await expect(tab).toHaveAttribute("aria-selected", "true")
  }
  await review.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await page.reload()
  await expectSessionTitle(page, title)
  await expect(review).toHaveCount(0)
  await expect(context).toHaveCount(1)
  await expect(composer).toHaveText("Keep this draft while closing panels")
  await openSidePanel(page, "Review")
  await expect(review).toHaveAttribute("aria-selected", "true")
})

test("side-panel shortcuts follow saved custom bindings and retain the composer draft", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const title = "Custom sidebar shortcuts"

  const workspace = await openSession(page, {
    name: title,
    sessions: [{ id: "ses_custom_sidebar_shortcuts", title, mode: "work", agent: "meta" }],
    seed: { settings: { keybinds: { "session-management.artifacts": "mod+alt+y", "context.open": "none" } } },
  })

  const side = page.locator("#review-panel")
  const artifacts = side.getByRole("tab", { name: "Artifacts", exact: true })
  const draft = "Keep this draft while opening sidebar modules with a custom shortcut."
  await workspace.editor.fill(draft)
  await workspace.editor.press("Control+Alt+C")
  await expect(side.getByRole("tab", { name: "Context", exact: true })).toHaveCount(0)
  await workspace.editor.press("Control+Alt+F")
  await expect(artifacts).toHaveCount(0)
  await workspace.editor.press("Control+Alt+Y")
  await expect(artifacts).toHaveAttribute("aria-selected", "true")
  await expect(side.getByRole("region", { name: "Work artifact", exact: true })).toBeVisible()
  await workspace.editor.press("Control+Alt+Y")
  await expect(artifacts).toHaveCount(1)
  await expect(workspace.editor).toHaveText(draft)
  await workspace.editor.press("Control+Alt+N")
  const launcher = side.locator('[data-component="session-panel-launcher"]')
  await expect(launcher.getByRole("button", { name: "Artifacts", exact: true })).toContainText("Y")
  await artifacts.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(artifacts).toHaveCount(0)
  await page.reload()
  await expectSessionTitle(page, title)
  await expect(workspace.editor).toBeEditable()
  await workspace.editor.press("Control+Alt+F")
  await expect(artifacts).toHaveCount(0)
  await workspace.editor.press("Control+Alt+Y")
  await expect(artifacts).toHaveAttribute("aria-selected", "true")
  await expect(artifacts).toHaveCount(1)
  await expect(workspace.editor).toHaveText(draft)
})

test("the new tab launcher follows Chat, Coding, Work, Custom, and Assistant session modes", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })

  const common = ["Context", "Open file", "Task delegation", "Review"]

  const proposals = [
    "Skill proposals",
    "Command proposals",
    "Prompt proposals",
    "Agent proposals",
    "MCP proposals",
    "Plugin proposals",
    "Workflow proposals",
  ]

  const cases = [
    {
      session: { id: "ses_launcher_chat", title: "Launcher Chat", mode: "chat" },
      visible: [...common, ...proposals],
    },
    {
      session: { id: "ses_launcher_coding", title: "Launcher Coding", mode: "coding" },
      visible: common,
    },
    {
      session: {
        id: "ses_launcher_work",
        title: "Launcher Work",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_launcher_work", rootSessionID: "ses_launcher_work" },
      },
      visible: [...common, "Workflow run", "Artifacts"],
    },
    {
      session: { id: "ses_launcher_custom", title: "Launcher Custom", mode: "custom" },
      visible: [...common, "Workflow run"],
    },
    {
      session: { id: "ses_launcher_assistant", title: "Launcher Assistant", mode: "assistant" },
      visible: common,
    },
    {
      session: {
        id: "ses_launcher_workflow_child",
        title: "Launcher Workflow child",
        mode: "assistant",
        parentID: "ses_launcher_work",
        controller: {
          kind: "child",
          metaAgentID: "mag_launcher_work",
          rootSessionID: "ses_launcher_work",
          executor: { agent: "build", model: { providerID: "fixture", id: "fixture" }, source: "tool" },
          source: {
            kind: "workflow",
            runID: "wfr_launcher_saved",
            stepRunID: "swr_launcher_saved",
            inputID: "msg_launcher_saved_input",
          },
        },
      },
      visible: [...common, "Workflow run"],
    },
    {
      session: {
        id: "ses_launcher_artifact",
        title: "Launcher recorded artifact",
        mode: "assistant",
        workContract: {
          source: "ad-hoc",
          contractVersion: 1,
          output: {
            outputType: "markdown",
            artifact: { title: "Saved artifact", filename: "saved.md", relativeDir: "reports" },
          },
        },
      },
      visible: [...common, "Artifacts"],
    },
  ] as const

  await openSession(page, {
    name: "PanelModeMatrix",
    sessions: cases.map((item) => item.session),
    vcsDiff: [],
    workflows: {
      ses_launcher_work: {
        run: {
          id: "wfr_launcher_saved",
          sessionID: "ses_launcher_work",
          snapshotDigest: "a".repeat(64),
          workflowName: "Saved launcher workflow",
          workflowRevision: "b".repeat(64),
          status: "completed",
          revision: 2,
          timeCreated: 1,
          timeUpdated: 2,
          timeCompleted: 2,
        },
        steps: [
          {
            id: "swr_launcher_saved",
            runId: "wfr_launcher_saved",
            stepId: "build",
            agentId: "build",
            status: "completed",
            attempt: 1,
            revision: 2,
            childSessionId: "ses_launcher_workflow_child",
            timeCreated: 1,
            timeCompleted: 2,
          },
        ],
      },
    },
    pageMessages: (id) => {
      if (id === "ses_launcher_workflow_child")
        return {
          items: [{ id: "msg_launcher_saved_input", type: "user", text: "Saved launcher input", time: { created: 1 } }],
        }

      if (id === "ses_launcher_artifact")
        return {
          items: [
            {
              id: "msg_launcher_artifact",
              type: "assistant",
              agent: "build",
              model: { providerID: "fixture", id: "fixture" },
              time: { created: 1, completed: 2 },
              content: [{ type: "text", text: "Saved artifact body" }],
            },
          ],
        }

      return { items: [] }
    },
  })

  const side = page.locator("#review-panel")
  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  const guide = side.getByRole("tab", { name: "New tab", exact: true })
  const launcher = side.locator('[data-component="session-panel-launcher"]')

  for (const item of [...cases, cases[0]]) {
    await page
      .locator("[data-titlebar-tab-slot]")
      .filter({ has: page.locator(`a[href="${sessionHref(item.session.id)}"]`) })
      .click()
    await expectSessionTitle(page, item.session.title)

    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()

    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await side.getByRole("button", { name: "Add tab", exact: true }).click()
    await expect(guide).toHaveAttribute("aria-selected", "true")
    await expect(guide).toHaveAttribute("data-value", "panel-launcher:new")
    await expect(guide).toHaveCount(1)

    for (const name of [...common, "Review", "Advanced management", "Workflow run", "Artifacts", ...proposals]) {
      const entry = launcher.getByRole("button", { name, exact: true })

      if (item.visible.includes(name)) {
        await expect(entry).toBeVisible()
        continue
      }

      await expect(entry).toHaveCount(0)
    }

    if (item.session.id === "ses_launcher_workflow_child") {
      await launcher.getByRole("button", { name: "Workflow run", exact: true }).click()
      const workflow = side.getByRole("region", { name: "Workflow run", exact: true })
      await expect(workflow.getByText("Saved launcher workflow", { exact: true })).toBeVisible()
      await expect(workflow.getByRole("region", { name: "Source input", exact: true })).toContainText(
        "Saved launcher input",
      )
    }

    if (item.session.id === "ses_launcher_artifact") {
      await launcher.getByRole("button", { name: "Artifacts", exact: true }).click()
      await expect(side.getByLabel("Candidate document", { exact: true })).toHaveText("Saved artifact body")
    }
  }
})

test("Chat review stays reopenable while filesystem events update its unselected tab", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })

  // SAFETY: The VCS fixture starts empty; every added entry comes from fileDiff().
  const state = { diffs: [] as ReturnType<typeof fileDiff>[] }

  const workspace = await openSession(page, {
    name: "ChatReviewAvailability",
    sessions: [{ id: "ses_chat_review_availability", title: "Chat review availability", mode: "chat" }],
    vcsDiff: () => state.diffs,
  })

  const side = page.locator("#review-panel")
  const review = side.locator("#session-side-panel-review-tab")
  const guide = side.getByRole("tab", { name: "New tab", exact: true })
  const launcher = side.locator('[data-component="session-panel-launcher"]')
  const entry = launcher.getByRole("button", { name: "Review", exact: true })
  const initial = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/vcs/diff"))

  await openSidePanel(page, "Review")
  expect((await initial).status()).toBe(200)
  await expect(side.getByText("No file changes yet", { exact: true })).toBeVisible()
  await side.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(guide).toHaveAttribute("aria-selected", "true")
  await expect(entry).toBeVisible()
  await expect(launcher.getByRole("button", { name: "Context", exact: true })).toBeVisible()

  const changed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/vcs/diff"))

  state.diffs = [fileDiff("src/chat-change.ts")]
  await workspace.push([
    {
      id: "evt_chat_review_added",
      created: 2,
      type: "filesystem.changed",
      location: { directory: workspace.directory },
      data: { file: "src/chat-change.ts", event: "change" },
    },
  ])
  expect((await changed).status()).toBe(200)
  await expect(entry).toBeVisible()
  await expect(review).toHaveText("Files Changed 1")
  await expect(guide).toHaveAttribute("aria-selected", "true")

  const removed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/vcs/diff"))

  state.diffs = []
  await workspace.push([
    {
      id: "evt_chat_review_removed",
      created: 3,
      type: "filesystem.changed",
      location: { directory: workspace.directory },
      data: { file: "src/chat-change.ts", event: "unlink" },
    },
  ])
  expect((await removed).status()).toBe(200)
  await expect(entry).toBeVisible()
  await expect(review).toHaveText("Review")
  await expect(review).toHaveAttribute("data-value", "review:changes")
  await expect(review).toHaveCount(1)
  await expect(guide).toHaveAttribute("aria-selected", "true")
  await expect(guide).toHaveCount(1)
  await expect(launcher.getByRole("button", { name: "Context", exact: true })).toBeVisible()
})

test("management panels keep singleton tabs, drafts, order, and selection through closing and visibility changes", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const sessionID = "ses_management_panels"
  await openSession(page, {
    name: "Unified management panels",
    sessions: [
      {
        id: sessionID,
        title: "Unified management panels",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_management_panels", rootSessionID: sessionID },
        workContract: {
          source: "ad-hoc",
          contractVersion: 1,
          output: {
            outputType: "markdown",
            artifact: { title: "Panel output", filename: "panel.md", relativeDir: "reports" },
          },
        },
      },
    ],
  })
  const side = page.locator("#review-panel")
  const chat = page.locator('[data-slot="session-chat-panel"]')
  const titles = ["Task delegation", "Workflow run", "Artifacts"]

  const managementTabs = side
    .getByRole("tab")
    .filter({ hasText: /^(Task delegation|Advanced management|Workflow run|Artifacts)$/ })

  for (const [title, region, shortcut] of [
    ["Task delegation", "Task delegation", "Control+Alt+Q"],
    ["Workflow run", "Workflow run", "Control+Alt+W"],
    ["Artifacts", "Work artifact", "Control+Alt+F"],
  ] as const) {
    await page.locator('[data-component="composer-editor"]').press(shortcut)
    await expect(side.getByRole("region", { name: region, exact: true })).toBeVisible()
    await expect(side.getByRole("tab", { name: title, exact: true })).toHaveCount(1)
    await expect(chat.getByRole("region", { name: region, exact: true })).toHaveCount(0)
  }

  await expect(managementTabs).toHaveText(titles)
  await openAdvanced(page)
  const meta = side.getByRole("region", { name: "Advanced management", exact: true })

  const description = meta.getByRole("textbox", {
    name: "Search project facts",
    exact: true,
  })

  const draft = `Unsent sidebar fact search 中文 ${"Long search terms remain editable. ".repeat(70)}`
  await description.fill(draft)
  await expect.poll(() => meta.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath("management-panels-wide.png") })
  const metaTab = side.getByRole("tab", { name: "Task delegation", exact: true })
  await metaTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(metaTab).toHaveCount(0)
  await openAdvanced(page)
  await expect(description).toHaveValue(draft)
  await expect(managementTabs).toHaveText(["Workflow run", "Artifacts", "Task delegation"])
  const dragStart = await metaTab.boundingBox()
  const dragEnd = await side.getByRole("tab", { name: "Workflow run", exact: true }).boundingBox()

  if (!dragStart || !dragEnd) throw new Error("Management tab drag bounds are unavailable")

  await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragStart.x + dragStart.width / 2 - 8, dragStart.y + dragStart.height / 2)
  await page.mouse.move(dragEnd.x + 8, dragEnd.y + dragEnd.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(managementTabs).toHaveText(["Task delegation", "Workflow run", "Artifacts"])
  await side.getByRole("button", { name: "Back to collaborations", exact: true }).click()

  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  await expect(settings).toBeFocused()
  await settings.getByRole("switch", { name: "Show advanced management", exact: true }).press("Space")
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Unified management panels" }).click()
  await expectSessionTitle(page, "Unified management panels")
  await expect(metaTab).toHaveCount(1)
  await expect(managementTabs).toHaveText(["Task delegation", "Workflow run", "Artifacts"])
  await side.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(
    side
      .locator('[data-component="session-panel-launcher"]')
      .getByRole("button", { name: "Advanced management", exact: true }),
  ).toHaveCount(0)
  await side
    .getByRole("tab", { name: "New tab", exact: true })
    .locator("..")
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  const collaboration = side.getByRole("tab", { name: "Task delegation", exact: true })
  await collaboration.press("Enter")
  await expect(collaboration).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Control+,")
  await expect(settings).toBeFocused()
  await settings.getByRole("switch", { name: "Show advanced management", exact: true }).press("Space")
  await page.locator("[data-titlebar-tab-slot]", { hasText: "Unified management panels" }).click()
  await expectSessionTitle(page, "Unified management panels")
  await expect(managementTabs).toHaveText(titles)
  await expect(collaboration).toHaveAttribute("aria-selected", "true")
  await page.reload()
  await expectSessionTitle(page, "Unified management panels")
  await expect(managementTabs).toHaveText(titles)
  await expect(collaboration).toHaveAttribute("aria-selected", "true")
  await openAdvanced(page)
  await expect(description).toHaveValue(draft)
  await expect(side.getByRole("tab", { name: "Advanced management", exact: true })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await openAdvanced(page)
  const narrow = page.getByRole("region", { name: "Advanced management", exact: true })
  await expect(narrow.getByRole("textbox", { name: "Search project facts", exact: true })).toHaveValue(draft)
  await expect(narrow.getByRole("textbox", { name: "Search project facts", exact: true })).toBeEditable()
  await expect
    .poll(() => narrow.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath("management-panels-narrow.png") })
  await page
    .getByRole("tablist", { name: "Session view", exact: true })
    .getByRole("tab", { name: "Session", exact: true })
    .press("Enter")
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
})

test("MP03 Goals keep drafts in the Meta right panel and submit exact revisions and evidence", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const sessionID = "ses_mp03_goal"
  const directory = "C:/AigcForge/MP03Goals"
  const count = { steps: 0, attempts: 0, recordedTokens: 0, sharedTokens: 0, unknownAttempts: 0, pendingAttempts: 0 }

  const initial: SessionGoalInfo = {
    id: "gol_mp03_goal",
    sessionID,
    metaAgentID: "mag_mp03_goal",
    agent: "meta",
    selection: { agent: "meta", event: { id: "evt_mp03_goal_agent", seq: 1 } },
    objective: "Finish the saved Goal",
    revision: 1,
    revisionCreatedAt: 1,
    status: "active",
    pauseVersion: 0,
    conditions: [
      {
        id: "command",
        kind: "command_result",
        command: "bun test",
        cwd: directory,
        exit: 0,
        outputIncludes: ["Passed"],
        operation: { sourceSessionID: sessionID, operationID: "top_mp03_goal_command" },
        producer: { sessionID, assistantMessageID: "msg_mp03_command", toolCallID: "call_mp03_command" },
        sourceSnapshot: "snp_mp03_goal",
      },
      { id: "acceptance", kind: "human_acceptance", description: "Accept the saved output" },
    ],
    taskRefs: [],
    budget: { rounds: 4 },
    rounds: [],
    attempts: [],
    evidence: [
      {
        id: "evidence_mp03_command",
        conditionID: "command",
        kind: "command_result",
        revision: 1,
        acceptedRevisions: [1, 2],
        recordedAt: 2,
        producer: {
          eventID: "evt_mp03_command",
          sessionID,
          assistantMessageID: "msg_mp03_command",
          toolCallID: "call_mp03_command",
        },
        result: {
          id: "shl_mp03_command",
          command: "bun test",
          cwd: directory,
          exit: 0,
          timeout: false,
          truncated: false,
          outputDigest: "b".repeat(64),
          started: 1,
          completed: 2,
        },
        outputIncludes: ["Passed"],
      },
    ],
    evidenceSetDigest: "a".repeat(64),
    currentEvidenceIDs: ["evidence_mp03_command"],
    satisfiedConditionIDs: ["command"],
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

  const wireCondition = (condition: typeof SessionGoal.Condition.Encoded) => {
    if (condition.kind === "command_result") return { ...condition, outputIncludes: [...condition.outputIncludes] }

    return condition
  }

  const mutations: MockGoalMutation[] = []
  const fault = { edit: true }

  const identities: NonNullable<WorkspaceInput["identities"]> = {
    [sessionID]: {
      sessionID,
      location: { directory },
      projectID: "proj_mp03_goal",
      mode: "work",
      agent: "meta",
      model: { status: "missing" },
      permission: { declaredTier: "propose", effect: "ask" },
      capability: { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
      detail: { status: "missing", reason: "mode-detail-not-projected" },
      coordination: {
        available: true,
        reasons: [],
        selection: { agent: "meta", event: { id: "evt_mp03_goal_agent", seq: 1 } },
      },
    },
  }

  const transport = await installSseTransport(page, { server: SERVER })
  await openSession(page, {
    name: "MP03 Goals",
    directory,
    goals,
    identities,
    sessions: [
      {
        id: sessionID,
        title: "Goals source",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_mp03_goal", rootSessionID: sessionID },
      },
    ],
    onGoalMutation(input) {
      mutations.push(input)

      if (input.action === "edit" && fault.edit)
        return new ConflictError({ resource: input.goalID, message: "Goal revision changed" })

      if (input.action === "set") {
        const body = Schema.encodeSync(SessionGoal.CreateInput)(input.body)

        const goal: SessionGoalInfo = {
          ...initial,
          id: body.goalID ?? "gol_mp03_new",
          objective: body.objective,
          conditions: [wireCondition(body.conditions[0]), ...body.conditions.slice(1).map(wireCondition)],
          budget: body.budget,
          evidence: [],
          currentEvidenceIDs: [],
          satisfiedConditionIDs: [],
        }

        goals.push(goal)

        return goal
      }

      const goal = goals.find((goal) => goal.id === input.goalID)

      if (!goal) return new InvalidRequestError({ message: "Goal not found" })

      if (input.action === "edit") {
        const body = Schema.encodeSync(SessionGoal.EditInput)(input.body)
        Object.assign(goal, {
          revision: 2,
          objective: body.objective ?? goal.objective,
          conditions: body.conditions
            ? [wireCondition(body.conditions[0]), ...body.conditions.slice(1).map(wireCondition)]
            : goal.conditions,
          budget: body.budget ?? goal.budget,
        })
      }

      if (input.action === "pause") Object.assign(goal, { status: "paused", pauseReason: "user", pauseVersion: 1 })

      if (input.action === "resume") Object.assign(goal, { status: "active", pauseReason: undefined })

      if (input.action === "cancel") Object.assign(goal, { status: "cancelled" })

      if (input.action === "confirm") Object.assign(goal, { status: "completed" })

      return goal
    },
  })
  await transport.waitForConnection()
  await openAdvanced(page)
  const side = page.locator("#review-panel")
  const panel = side.getByRole("region", { name: "Goals", exact: true })
  await expect(panel.getByRole("button", { name: "Finish the saved Goal", exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "New Goal", exact: true }).click()
  await panel.getByRole("textbox", { name: "Objective", exact: true }).fill("Unsent Goal draft")
  const tab = side.getByRole("tab", { name: "Task delegation", exact: true })
  await tab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await openAdvanced(page)
  await expect(panel.getByRole("textbox", { name: "Objective", exact: true })).toHaveValue("Unsent Goal draft")
  expect(mutations).toEqual([])
  await panel.getByRole("button", { name: "Cancel", exact: true }).click()
  await panel.getByRole("button", { name: "Edit Goal", exact: true }).click()
  await panel.getByRole("textbox", { name: "Objective", exact: true }).fill("Revised Goal objective")
  await panel.getByRole("button", { name: "Save revision", exact: true }).click()
  await expect(panel.getByRole("alert")).toContainText("Goal revision changed")
  await expect(panel.getByRole("textbox", { name: "Objective", exact: true })).toHaveValue("Revised Goal objective")
  expect(mutations[0]).toMatchObject({
    action: "edit",
    goalID: initial.id,
    body: { expectedRevision: 1, conditions: initial.conditions },
  })
  fault.edit = false
  await panel.getByRole("button", { name: "Save revision", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Revised Goal objective", exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Pause continuation", exact: true }).click()
  await expect(panel.getByText("Paused by the user", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Resume Goal", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Pause continuation", exact: true })).toBeEnabled()
  await panel.getByRole("button", { name: "Accept revision 2 and its evidence", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Edit Goal", exact: true })).toHaveCount(0)
  expect(mutations.at(-1)).toMatchObject({
    action: "confirm",
    goalID: initial.id,
    body: { expectedRevision: 2, evidenceIDs: ["evidence_mp03_command"], evidenceSetDigest: "a".repeat(64) },
  })
  await panel.getByRole("button", { name: "New Goal", exact: true }).click()
  await panel.getByRole("textbox", { name: "Objective", exact: true }).fill("Start the next Goal")
  await panel.getByRole("textbox", { name: "What you will accept", exact: true }).fill("Accept the next saved result")
  await panel.getByRole("button", { name: "Save and start Goal", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Start the next Goal", exact: true })).toBeVisible()
  expect(mutations.at(-1)).toMatchObject({
    action: "set",
    sessionID,
    body: { goalID: expect.stringMatching(/^gol_/), objective: "Start the next Goal" },
  })
  const selected = identities[sessionID]

  if (!selected) throw new Error("Goal identity fixture is missing")
  identities[sessionID] = {
    ...selected,
    agent: "build",
    coordination: {
      available: false,
      reasons: [{ code: "meta-not-selected", severity: "info" }],
      selection: { agent: "build", event: { id: "evt_mp03_goal_withdraw", seq: 2 } },
    },
  }
  await transport.send({
    id: "evt_mp03_goal_withdraw",
    type: "session.agent.selected",
    created: 3,
    location: { directory },
    durable: { aggregateID: sessionID, seq: 2, version: 1 },
    data: { sessionID, agent: "build", previous: "meta" },
  })
  await expect(panel.getByRole("button", { name: "New Goal", exact: true })).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Revised Goal objective", exact: true })).toBeVisible()
  await expect(page).toHaveURL(sessionHref(sessionID))
})

test("MP03 Communications retain exact replies across SSE, failed acknowledgements and reload for three Meta roots", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1600, height: 900 })
  const directory = "C:/AigcForge/MP03Communications"
  const firstID = "ses_mp03_communication_a"
  const middleID = "ses_mp03_communication_b"
  const thirdID = "ses_mp03_communication_c"
  const contentID = "ses_mp03_communication_output"

  const received: SessionCommunicationMessage = {
    id: "com_mp03_received_a",
    actor: { type: "user", sessionID: firstID },
    contentSource: { sessionID: contentID, scope: "output" },
    targetSessionID: middleID,
    body: { sessionID: middleID, inputID: "msg_mp03_received_a", digest: "a".repeat(64) },
    requestDigest: "b".repeat(64),
    delivery: "queue",
    trigger: false,
    createdAt: 1,
    text: "The complete saved Build output\nForwarded by Meta A without changing its content source.",
    state: "visible",
  }

  const third: SessionCommunicationMessage = {
    ...received,
    id: "com_mp03_received_c",
    actor: { type: "user", sessionID: thirdID },
    contentSource: { sessionID: thirdID, scope: "text" },
    body: { ...received.body, inputID: "msg_mp03_received_c" },
    createdAt: 2,
    text: "Exact message from Meta C to Meta B.",
  }

  const records = [received, third]

  const identities: NonNullable<WorkspaceInput["identities"]> = Object.fromEntries(
    [firstID, middleID, thirdID].map((sessionID) => [
      sessionID,
      {
        sessionID,
        location: { directory },
        projectID: "proj_mp03_communications",
        mode: "work",
        agent: "meta",
        model: { status: "missing" },
        permission: { declaredTier: "propose", effect: "ask" },
        capability: { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
        detail: { status: "missing", reason: "mode-detail-not-projected" },
        coordination: {
          available: true,
          reasons: [],
          selection: { agent: "meta", event: { id: `evt_mp03_selected_${sessionID}`, seq: 1 } },
        },
      },
    ]),
  )

  const capabilities: NonNullable<WorkspaceInput["communicationCapabilities"]> = Object.fromEntries(
    [firstID, middleID, thirdID].map((id) => [id, { read: true, list: true, send: true, reply: true, reasons: [] }]),
  )

  const requests: MockCommunicationMutation[] = []
  const otherWrites: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const path = new URL(request.url()).pathname

    if (path === "/api/session" || /\/(prompt|interrupt)$/.test(path) || /^\/session\/[^/]+\/task\//.test(path))
      otherWrites.push(path)
  })
  const transport = await installSseTransport(page, { server: SERVER })

  const metadata = (message: SessionCommunicationMessage) => ({
    source: "share",
    communication: { id: message.id },
    actorSessionID: message.actor.sessionID,
    contentSourceSessionID: message.contentSource.sessionID,
    sourceSessionID: message.contentSource.sessionID,
    scope: message.contentSource.scope,
  })

  const enqueue = (message: SessionCommunicationMessage, seq: number): AigcForgeEvent => ({
    id: `evt_mp03_enqueue_${message.id}`,
    type: "session.inbox.enqueued",
    created: Number(message.createdAt),
    location: { directory },
    durable: { aggregateID: message.targetSessionID, seq, version: 1 },
    data: {
      sessionID: message.targetSessionID,
      inboxID: message.body.inputID,
      communication: Schema.decodeUnknownSync(Schema.toEncoded(SessionCommunication.Record))(message),
      item: {
        type: "synthetic",
        delivery: message.delivery,
        payload: { text: message.text, metadata: metadata(message) },
      },
    },
  })

  await openSession(page, {
    name: "MP03 Communications",
    directory,
    sessionID: middleID,
    identities,
    communications: records,
    communicationCapabilities: capabilities,
    sessions: [
      {
        id: firstID,
        title: "Meta A",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_mp03_communication_a", rootSessionID: firstID },
      },
      {
        id: middleID,
        title: "Meta B",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_mp03_communication_b", rootSessionID: middleID },
      },
      {
        id: thirdID,
        title: "Meta C",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_mp03_communication_c", rootSessionID: thirdID },
      },
      { id: contentID, title: "Build output source", mode: "coding", agent: "build" },
    ],
    pageMessages: (id) => ({
      items: records
        .values()
        .filter((message) => message.targetSessionID === id && message.state === "visible")
        .map<SessionMessageInfo>((message) => ({
          id: message.body.inputID,
          type: "synthetic",
          text: message.text,
          time: { created: Number(message.createdAt) },
          metadata: metadata(message),
        }))
        .toArray(),
    }),
    onCommunicationMutation(input) {
      requests.push(input)

      if (input.action === "send") {
        const message: SessionCommunicationMessage = {
          ...received,
          id: input.body.id,
          actor: { type: "user", sessionID: firstID },
          targetSessionID: thirdID,
          body: { sessionID: thirdID, inputID: `msg_${input.body.id}`, digest: "e".repeat(64) },
          requestDigest: "f".repeat(64),
          createdAt: 11,
          state: "pending",
        }

        records.push(message)

        return { ...message, admission: "admitted", wake: "not_requested" }
      }

      if (input.action !== "reply" || input.body.content.type !== "text")
        return new InvalidRequestError({ message: "This scenario requires an exact text reply" })
      const saved = records.find((message) => message.id === input.body.id)

      if (saved) return { ...saved, state: "pending", admission: "retained", wake: "not_requested" }
      const targetSessionID = input.communicationID === received.id ? firstID : thirdID

      const message: SessionCommunicationMessage = {
        id: input.body.id,
        actor: { type: "user", sessionID: middleID },
        contentSource: { sessionID: middleID, scope: "text" },
        targetSessionID,
        replyTo: input.communicationID,
        body: { sessionID: targetSessionID, inputID: `msg_${input.body.id}`, digest: "c".repeat(64) },
        requestDigest: "d".repeat(64),
        delivery: input.body.delivery ?? "queue",
        trigger: input.body.trigger ?? false,
        createdAt: records.length + 3,
        text: input.body.content.text,
        state: "pending",
      }

      records.push(message)

      if (records.length === 3) return new InvalidRequestError({ message: "The saved reply acknowledgement was lost" })

      return { ...message, admission: "admitted", wake: "not_requested" }
    },
  })
  await transport.waitForConnection()
  const timeline = page.locator('[data-slot="session-chat-panel"] [data-slot="session-timeline-coordination"]')
  const receivedRow = timeline.filter({ has: page.getByText(received.id, { exact: true }) })
  await expect(receivedRow).toHaveCount(1)
  await expect(receivedRow.getByRole("button", { name: "Meta A", exact: true })).toBeVisible()
  await expect(receivedRow.getByRole("button", { name: "Build output source", exact: true })).toBeVisible()
  await expect(receivedRow.getByRole("button", { name: "Meta B", exact: true })).toBeVisible()
  await receivedRow.getByText("Recorded content", { exact: true }).click()
  await expect(receivedRow.locator("pre")).toHaveText(received.text)
  await receivedRow.getByRole("button", { name: "View communication details", exact: true }).click()
  const side = page.locator("#review-panel")
  const panel = side.getByRole("region", { name: "Communications", exact: true })
  const detail = panel.locator('[data-slot="communication-detail"]')
  await expect(detail.locator("pre")).toHaveText(received.text)
  await expect(detail.getByRole("button", { name: "Meta A", exact: true })).toBeVisible()
  await expect(detail.getByRole("button", { name: "Build output source", exact: true })).toBeVisible()
  await detail.getByRole("button", { name: "Reply to this communication", exact: true }).click()
  const form = panel.locator("form")
  const execution = form.getByRole("checkbox", { name: "Request target execution", exact: true })
  const text = "First exact reply paragraph\nKeep both lines through a lost acknowledgement and reload."
  await form.getByRole("textbox", { name: "Message", exact: true }).fill(text)

  if (await execution.isChecked()) await form.getByText("Request target execution", { exact: true }).click()
  await expect(execution).not.toBeChecked()

  const failed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/session/${middleID}/communication/${received.id}/reply`,
  )

  await form.getByRole("button", { name: "Reply to this communication", exact: true }).click()
  expect((await failed).status()).toBe(400)
  await expect(panel.getByRole("alert")).toContainText("The saved reply acknowledgement was lost")
  const first = requests[0]

  if (first?.action !== "reply") throw new Error("The exact reply request was not recorded")
  expect(first).toMatchObject({
    action: "reply",
    sessionID: middleID,
    communicationID: received.id,
    directory,
    body: { id: expect.stringMatching(/^com_/), content: { type: "text", text }, delivery: "queue", trigger: false },
  })
  expect(first.body).not.toHaveProperty("targetSessionID")
  const saved = records.find((message) => message.id === first.body.id)

  if (!saved) throw new Error("The lost acknowledgement did not retain its fixture reply")
  saved.state = "visible"
  const savedEvent = enqueue(saved, 1)
  await transport.send(savedEvent)
  await transport.send({
    id: "evt_mp03_reply_delivered",
    type: "session.inbox.delivered",
    created: 7,
    location: { directory },
    durable: { aggregateID: firstID, seq: 2, version: 1 },
    data: { sessionID: firstID, inboxID: saved.body.inputID },
  })
  await transport.send(savedEvent)
  const savedRow = panel.getByRole("listitem").filter({ has: page.getByText(saved.id, { exact: true }) })
  await expect(savedRow).toHaveCount(1)
  await expect(savedRow).toContainText("Visible in target history")
  await page.reload()
  await expectSessionTitle(page, "Meta B")
  await transport.waitForConnection()
  await expect(panel).toBeVisible()
  await expect(form.getByText("Saved request for exact retry", { exact: true })).toBeVisible()
  await expect(form.locator("pre")).toHaveText(text)
  await expect(form.locator('[data-slot="meta-request"]').getByText(saved.id, { exact: true })).toBeVisible()

  const retried = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/session/${middleID}/communication/${received.id}/reply`,
  )

  await form.getByRole("button", { name: "Retry the saved request", exact: true }).click()
  expect((await retried).ok()).toBe(true)
  await expect(form.getByRole("status")).toContainText("Communication saved")
  await expect(form.getByRole("status")).toContainText("Visible in target history")
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(first)
  await expect(savedRow).toHaveCount(1)

  for (const next of [
    { peer: "Meta A", parent: received, text: "Second exact reply paragraph for Meta A.", target: firstID, seq: 3 },
    { peer: "Meta C", parent: third, text: "An exact independent reply for Meta C.", target: thirdID, seq: 1 },
  ]) {
    await form.getByRole("button", { name: "Close draft", exact: true }).click()
    await panel.getByRole("button", { name: `Received from ${next.peer}`, exact: true }).click()
    await expect(detail.locator("pre")).toHaveText(next.parent.text)
    await detail.getByRole("button", { name: "Reply to this communication", exact: true }).click()
    await form.getByRole("textbox", { name: "Message", exact: true }).fill(next.text)

    if (await execution.isChecked()) await form.getByText("Request target execution", { exact: true }).click()
    await expect(execution).not.toBeChecked()

    const reply = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${middleID}/communication/${next.parent.id}/reply`,
    )

    await form.getByRole("button", { name: "Reply to this communication", exact: true }).click()
    expect((await reply).ok()).toBe(true)
    const request = requests.at(-1)

    if (request?.action !== "reply") throw new Error("The next exact reply was not recorded")
    expect(request.communicationID).toBe(next.parent.id)
    expect(request.body.id).not.toBe(first.body.id)
    const message = records.find((message) => message.id === request.body.id)

    if (!message) throw new Error("The next fixture reply is missing")
    expect(message.targetSessionID).toBe(next.target)
    message.state = "visible"
    await transport.send(enqueue(message, next.seq))
    await transport.send({
      id: `evt_mp03_delivered_${message.id}`,
      type: "session.inbox.delivered",
      created: 10,
      location: { directory },
      durable: { aggregateID: next.target, seq: next.seq + 1, version: 1 },
      data: { sessionID: next.target, inboxID: message.body.inputID },
    })
    await expect(detail.locator("pre")).toHaveText(next.text)
    await expect(detail.getByRole("button", { name: next.parent.id, exact: true })).toBeVisible()
  }

  expect(requests).toHaveLength(4)
  await expect(panel.getByRole("listitem")).toHaveCount(5)
  await expect(timeline).toHaveCount(2)
  await page.goto(sessionHref(firstID))
  await expectSessionTitle(page, "Meta A")
  await expect(timeline).toHaveCount(2)
  const replyRow = timeline.filter({ has: page.getByText(saved.id, { exact: true }) })
  await expect(replyRow.getByRole("button", { name: "Meta B", exact: true })).toHaveCount(2)
  await expect(replyRow.getByRole("button", { name: received.id, exact: true })).toBeVisible()
  await replyRow.getByText("Recorded content", { exact: true }).click()
  await expect(replyRow.locator("pre")).toHaveText(text)
  await replyRow.getByRole("button", { name: "View communication details", exact: true }).click()
  await expect(detail.locator("pre")).toHaveText(text)
  await detail.getByRole("button", { name: received.id, exact: true }).click()
  await expect(detail.locator("pre")).toHaveText(received.text)
  await panel.getByRole("button", { name: "New communication", exact: true }).click()
  await form.getByRole("textbox", { name: "Target session ID", exact: true }).fill(thirdID)
  await form.getByRole("group", { name: "Content to send", exact: true }).getByRole("button").click()
  await page.getByRole("option", { name: "Saved session content", exact: true }).click()
  await form.getByRole("textbox", { name: "Content source session ID", exact: true }).fill(contentID)
  const scope = form.getByRole("group", { name: "Selected scope", exact: true }).getByRole("button")
  await scope.click()
  await page.getByRole("option", { name: "Latest saved output", exact: true }).click()

  if (await execution.isChecked()) await form.getByText("Request target execution", { exact: true }).click()
  await expect(execution).not.toBeChecked()
  await side
    .getByRole("tab", { name: "Task delegation", exact: true })
    .locator("..")
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await openAdvanced(page)
  await expect(form.getByRole("textbox", { name: "Target session ID", exact: true })).toHaveValue(thirdID)
  await expect(form.getByRole("textbox", { name: "Content source session ID", exact: true })).toHaveValue(contentID)
  await expect(scope).toHaveText("Latest saved output")
  expect(requests).toHaveLength(4)

  const forwarded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api/session/${firstID}/communication`,
  )

  await form.getByRole("button", { name: "Send communication", exact: true }).click()
  expect((await forwarded).ok()).toBe(true)
  const send = requests.at(-1)

  if (send?.action !== "send") throw new Error("The forwarded content request was not recorded")
  expect(send).toMatchObject({
    action: "send",
    sessionID: firstID,
    directory,
    body: {
      id: expect.stringMatching(/^com_/),
      targetSessionID: thirdID,
      content: { type: "session", sessionID: contentID, scope: "output" },
      delivery: "queue",
      trigger: false,
    },
  })
  const sent = records.find((message) => message.id === send.body.id)

  if (!sent) throw new Error("The forwarded communication fixture is missing")
  sent.state = "visible"
  await transport.send(enqueue(sent, 3))
  await transport.send({
    id: "evt_mp03_forwarded_delivered",
    type: "session.inbox.delivered",
    created: 12,
    location: { directory },
    durable: { aggregateID: thirdID, seq: 4, version: 1 },
    data: { sessionID: thirdID, inboxID: sent.body.inputID },
  })
  await expect(detail.locator("pre")).toHaveText(received.text)
  await expect(detail.getByRole("button", { name: "Meta A", exact: true })).toBeVisible()
  await expect(detail.getByRole("button", { name: "Build output source", exact: true })).toBeVisible()
  await expect(detail.getByRole("button", { name: "Meta C", exact: true })).toBeVisible()
  await page.goto(sessionHref(thirdID))
  await expectSessionTitle(page, "Meta C")
  const forwardedRow = timeline.filter({ has: page.getByText(sent.id, { exact: true }) })
  await expect(forwardedRow).toHaveCount(1)
  await expect(forwardedRow.getByRole("button", { name: "Meta A", exact: true })).toBeVisible()
  await expect(forwardedRow.getByRole("button", { name: "Build output source", exact: true })).toBeVisible()
  await forwardedRow.getByText("Recorded content", { exact: true }).click()
  await expect(forwardedRow.locator("pre")).toHaveText(received.text)
  expect(requests).toHaveLength(5)
  expect(otherWrites).toEqual([])
})

test("MP03 Communication details keep the target server and the source layout through a late reply", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1600, height: 900 })
  const sourceID = "ses_mp03_communication_layout"
  const targetID = "ses_mp03_same_communication_target"
  const actorID = "ses_mp03_same_communication_actor"
  const localDirectory = "C:/AigcForge/MP03CommunicationLayout"
  const remoteDirectory = "/home/mp03-communication-target"

  const initial: SessionCommunicationMessage = {
    id: "com_mp03_same_across_servers",
    actor: { type: "user", sessionID: actorID },
    contentSource: { sessionID: actorID, scope: "text" },
    targetSessionID: targetID,
    body: { sessionID: targetID, inputID: "msg_mp03_same_across_servers", digest: "a".repeat(64) },
    requestDigest: "b".repeat(64),
    delivery: "queue",
    trigger: false,
    createdAt: 1,
    text: "Local server communication only.",
    state: "visible",
  }

  const remote = { ...initial, text: "Remote server communication only.\nKeep its exact sender and server." }
  const localRecords = [initial]
  const remoteRecords = [remote]
  const localRequests: MockCommunicationMutation[] = []
  const remoteRequests: MockCommunicationMutation[] = []
  const release = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()

  const identity = (directory: string): NonNullable<WorkspaceInput["identities"]> => ({
    [targetID]: {
      sessionID: targetID,
      location: { directory },
      projectID: "proj_mp03_communication_layout",
      mode: "work",
      agent: "meta",
      model: { status: "missing" },
      permission: { declaredTier: "propose", effect: "ask" },
      capability: { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
      detail: { status: "missing", reason: "mode-detail-not-projected" },
      coordination: { available: true, reasons: [], selection: { agent: "meta" } },
    },
  })

  const metadata = {
    source: "share",
    communication: { id: initial.id },
    actorSessionID: actorID,
    contentSourceSessionID: actorID,
    sourceSessionID: actorID,
    scope: "text",
  }

  await mockServers(page, {
    [SERVER]: {
      directory: localDirectory,
      project: project({ id: "proj_mp03_communication_layout", directory: localDirectory }),
      provider: provider(),
      sessions: [
        session({ id: sourceID, directory: localDirectory, title: "Communication source layout", agent: "build" }),
        session({
          id: targetID,
          directory: localDirectory,
          title: "Local communication target",
          mode: "work",
          agent: "meta",
          controller: { kind: "root", metaAgentID: "mag_mp03_local_target", rootSessionID: targetID },
        }),
        session({
          id: actorID,
          directory: localDirectory,
          title: "Local communication sender",
          mode: "work",
          agent: "meta",
        }),
      ],
      identities: identity(localDirectory),
      communications: localRecords,
      communicationCapabilities: { [targetID]: { read: true, list: true, send: true, reply: true, reasons: [] } },
      pageMessages: (id) => ({
        items:
          id === targetID
            ? [{ id: initial.body.inputID, type: "synthetic", text: initial.text, time: { created: 1 }, metadata }]
            : [],
      }),
      onCommunicationMutation(input) {
        localRequests.push(input)

        return new InvalidRequestError({ message: "The local communication must remain unchanged" })
      },
    },
    [REMOTE_SERVER]: {
      directory: remoteDirectory,
      project: project({ id: "proj_mp03_communication_layout", directory: remoteDirectory }),
      provider: provider(),
      sessions: [
        session({
          id: targetID,
          directory: remoteDirectory,
          title: "Remote communication target",
          mode: "work",
          agent: "meta",
          controller: { kind: "root", metaAgentID: "mag_mp03_remote_target", rootSessionID: targetID },
        }),
        session({
          id: actorID,
          directory: remoteDirectory,
          title: "Remote communication sender",
          mode: "work",
          agent: "meta",
        }),
      ],
      identities: identity(remoteDirectory),
      communications: remoteRecords,
      communicationCapabilities: { [targetID]: { read: true, list: true, send: true, reply: true, reasons: [] } },
      pageMessages: (id) => ({
        items:
          id === targetID
            ? [{ id: remote.body.inputID, type: "synthetic", text: remote.text, time: { created: 1 }, metadata }]
            : [],
      }),
      async onCommunicationMutation(input) {
        remoteRequests.push(input)
        started.resolve()
        await release.promise

        if (input.action !== "reply" || input.body.content.type !== "text")
          return new InvalidRequestError({ message: "This scenario accepts one exact remote reply" })

        const reply: SessionCommunicationMessage = {
          ...remote,
          id: input.body.id,
          actor: { type: "user", sessionID: targetID },
          contentSource: { sessionID: targetID, scope: "text" },
          targetSessionID: actorID,
          replyTo: remote.id,
          body: { sessionID: actorID, inputID: `msg_${input.body.id}`, digest: "c".repeat(64) },
          text: input.body.content.text,
          createdAt: 2,
        }

        remoteRecords.push(reply)

        return { ...reply, admission: "admitted", wake: "not_requested" }
      },
    },
  })
  await seed(page, {
    servers: [REMOTE_SERVER],
    tabs: [sourceID, targetID, { session: targetID, server: REMOTE_SERVER }],
  })
  await page.goto(sessionHref(targetID, REMOTE_SERVER))
  await expectSessionTitle(page, "Remote communication target")
  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sourceID)}"])`).click()
  await expectSessionTitle(page, "Communication source layout")
  const main = page.locator('[data-slot="session-chat-panel"]')
  await main.locator('[data-component="composer-editor"]').fill("The source layout keeps this unsent draft")

  const attach = async (server: string) => {
    await attachSession(page, {
      server,
      sessionID: targetID,
      title: server === REMOTE_SERVER ? "Remote communication target" : "Local communication target",
    })
  }

  const view = page.locator('[data-component="session-content-panel"]:visible')
  await attach(REMOTE_SERVER)

  const remoteRow = view
    .locator('[data-slot="session-timeline-coordination"]')
    .filter({ has: page.getByText(remote.id, { exact: true }) })

  await expect(remoteRow.getByRole("button", { name: "Remote communication sender", exact: true })).toHaveCount(2)
  await remoteRow.getByRole("button", { name: "View communication details", exact: true }).click()
  const panel = page.locator("#review-panel").getByRole("region", { name: "Communications", exact: true })
  const detail = panel.locator('[data-slot="communication-detail"]')
  await expect(detail.locator("pre")).toHaveText(remote.text)
  await expect(detail.getByRole("button", { name: "Remote communication sender", exact: true })).toHaveCount(2)
  await detail.getByRole("button", { name: "Reply to this communication", exact: true }).click()
  const form = panel.locator("form")
  const execution = form.getByRole("checkbox", { name: "Request target execution", exact: true })
  const replyText = "Remote reply captured before switching the sidebar target."
  await form.getByRole("textbox", { name: "Message", exact: true }).fill(replyText)

  if (await execution.isChecked()) await form.getByText("Request target execution", { exact: true }).click()
  await expect(execution).not.toBeChecked()

  const response = page.waitForResponse(
    (value) =>
      value.request().method() === "POST" &&
      new URL(value.url()).origin === REMOTE_SERVER &&
      new URL(value.url()).pathname === `/api/session/${targetID}/communication/${remote.id}/reply`,
  )

  await form.getByRole("button", { name: "Reply to this communication", exact: true }).click()
  await started.promise

  try {
    await attach(SERVER)

    const localRow = view
      .locator('[data-slot="session-timeline-coordination"]')
      .filter({ has: page.getByText(initial.id, { exact: true }) })

    await expect(localRow.getByRole("button", { name: "Local communication sender", exact: true })).toHaveCount(2)
    await localRow.getByRole("button", { name: "View communication details", exact: true }).click()
    await expect(detail.locator("pre")).toHaveText(initial.text)
    await expect(detail.getByRole("button", { name: "Local communication sender", exact: true })).toHaveCount(2)
  } finally {
    release.resolve()
  }

  expect((await response).ok()).toBe(true)
  const request = remoteRequests[0]

  if (request?.action !== "reply") throw new Error("The remote reply was not recorded")
  expect(request).toMatchObject({
    action: "reply",
    sessionID: targetID,
    communicationID: remote.id,
    directory: remoteDirectory,
    body: { content: { type: "text", text: replyText }, delivery: "queue", trigger: false },
  })
  expect(request.body).not.toHaveProperty("targetSessionID")
  await expect(detail.locator("pre")).toHaveText(initial.text)
  await expect(panel.getByText(request.body.id, { exact: true })).toHaveCount(0)
  await expect(main.locator('[data-component="composer-editor"]')).toHaveText(
    "The source layout keeps this unsent draft",
  )
  await expect(page).toHaveURL(sessionHref(sourceID))
  await attach(REMOTE_SERVER)
  await remoteRow.getByRole("button", { name: "View communication details", exact: true }).click()
  await expect(detail.locator("pre")).toHaveText(remote.text)
  await expect(form.getByRole("status")).toContainText("Communication saved")
  await expect(form.getByRole("status")).toContainText(request.body.id)
  await expect(form.getByRole("button", { name: "Retry the saved request", exact: true })).toHaveCount(0)
  expect(remoteRequests).toHaveLength(1)
  expect(localRequests).toEqual([])
})

test("MP03 Schedule keeps the saved target through revision edits and separates rule and occurrence acknowledgements", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const sessionID = "ses_mp03_schedule"
  const targetID = "ses_mp03_schedule_target"
  const directory = "C:/AigcForge/MP03Schedule"
  const dueAt = Date.parse("2026-11-14T03:00:00Z")

  const rule: ScheduleRule = {
    id: "sch_mp03_rule",
    sessionID,
    kind: "prompt",
    content: "Review the saved work",
    dueAt,
    timezone: "UTC",
    target: {
      policy: "new_once",
      template: {
        type: "new_root",
        mode: "coding",
        location: { directory, workspaceID: "wrk_mp03_schedule" },
        agent: "build",
        model: { type: "group", groupID: "schedule-route" },
      },
    },
    boundTargetSessionID: targetID,
    executionPolicy: { delivery: "queue", missed: "catch_up" },
    sourceAgent: "meta",
    revision: 3,
    status: "pending",
    nextDueAt: dueAt,
    createdAt: 1,
    updatedAt: 1,
  }

  const schedules = [rule]
  const runs: ScheduleOccurrence[] = []
  const mutations: MockScheduleMutation[] = []
  const fault = { edit: true }

  const identities: NonNullable<WorkspaceInput["identities"]> = {
    [sessionID]: {
      sessionID,
      location: { directory },
      projectID: "proj_mp03_schedule",
      mode: "work",
      agent: "meta",
      model: { status: "missing" },
      permission: { declaredTier: "propose", effect: "ask" },
      capability: { health: "degraded", reasons: [{ code: "mode-detail-not-projected", severity: "info" }] },
      detail: { status: "missing", reason: "mode-detail-not-projected" },
      coordination: { available: true, reasons: [], selection: { agent: "meta" } },
    },
  }

  await openSession(page, {
    name: "MP03 Schedule",
    directory,
    provider: provider({ id: "mp03-normal-model", name: "MP03 normal model" }),
    profiles: [CustomProfileFixture.info("build", { name: "MP03 saved profile", relativePath: "mp03-review.yaml" })],
    schedules,
    scheduleRuns: runs,
    identities,
    modelGroups: {
      targets: [],
      definitions: [],
      effective: [
        {
          groupID: "schedule-route",
          definition: {
            name: "Scheduled route",
            enabled: true,
            members: [{ providerID: "provider", id: "model" }],
            strategy: "order",
            affinity: "turn",
          },
        },
      ],
    },
    sessions: [
      {
        id: sessionID,
        title: "Schedule source",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_mp03_schedule", rootSessionID: sessionID },
      },
      { id: targetID, title: "Existing scheduled target", mode: "coding", agent: "build" },
    ],
    onScheduleMutation(input) {
      mutations.push(input)

      if (input.action === "edit" && fault.edit)
        return new InvalidRequestError({ message: "Schedule revision changed" })

      if (input.action === "edit") {
        Object.assign(rule, {
          revision: 4,
          content: input.body.content,
          dueAt: input.body.dueAt,
          recurrence: input.body.recurrence ?? undefined,
        })

        return rule
      }

      if (input.action === "pause") {
        Object.assign(rule, { status: "paused" })

        return rule
      }

      if (input.action === "resume") {
        Object.assign(rule, { status: "pending" })

        return rule
      }

      if (input.action === "cancel") {
        Object.assign(rule, { status: "cancelled" })

        return rule
      }

      if (input.action === "run") {
        const run: ScheduleOccurrence = {
          id: "sco_mp03_run",
          scheduleID: rule.id,
          sessionID,
          ruleRevision: 4,
          snapshot: structuredClone(rule),
          scheduledAt: dueAt,
          claimedAt: dueAt + 1,
          claimOwner: "fixture",
          caughtUp: false,
          status: "admitted",
          inputID: "msg_mp03_run",
          operationID: "top_mp03_run",
          targetSessionID: targetID,
          admission: {
            targetSessionID: targetID,
            inputID: "msg_mp03_run",
            operationID: "top_mp03_run",
            admittedAt: dueAt + 1,
          },
          createdAt: dueAt + 1,
          updatedAt: dueAt + 1,
        }

        runs.push(run)

        return run
      }

      return new InvalidRequestError({ message: "This scenario does not create or cancel an occurrence" })
    },
  })
  await openAdvanced(page)
  const side = page.locator("#review-panel")
  const coordination = side.getByRole("region", { name: "Main session coordination", exact: true })
  const coordinationAgent = coordination.getByRole("group", { name: "Target agent", exact: true }).getByRole("button")
  await expect(coordinationAgent).toBeEnabled()
  await coordinationAgent.click()
  await page.getByRole("option", { name: "Build", exact: true }).click()
  await expect(coordinationAgent).toContainText("Build")
  const coordinationModel = coordination.getByRole("group", { name: "Target model", exact: true }).getByRole("button")
  await expect(coordinationModel).toBeEnabled()
  await coordinationModel.click()
  await page.getByRole("option", { name: "MP03 normal model", exact: true }).click()
  await expect(coordinationModel).toContainText("MP03 normal model")
  const coordinationMode = coordination.getByRole("group", { name: "Target mode", exact: true }).getByRole("button")
  await coordinationMode.click()
  await page.getByRole("option", { name: "Custom", exact: true }).click()

  const coordinationProfile = coordination
    .getByRole("group", { name: "Saved Custom profile", exact: true })
    .getByRole("button")

  await expect(coordinationProfile).toBeEnabled()
  await coordinationProfile.click()
  await page.getByRole("option", { name: "MP03 saved profile", exact: true }).click()
  await expect(coordinationProfile).toContainText("MP03 saved profile")
  await expect(coordination.getByRole("button", { name: "Preview Custom profile", exact: true })).toBeEnabled()
  await coordinationMode.click()
  await page.getByRole("option", { name: "Coding", exact: true }).click()
  await expect(coordinationAgent).toContainText("Build")
  await expect(coordinationModel).toContainText("MP03 normal model")
  const panel = side.getByRole("region", { name: "Schedules", exact: true })
  await expect(panel.getByRole("button", { name: "Review the saved work", exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Edit schedule", exact: true }).click()
  const changeTarget = panel.getByRole("checkbox", { name: "Change the execution target", exact: true })
  await expect(changeTarget).not.toBeChecked()
  await changeTarget.focus()
  await changeTarget.press("Space")
  await expect(changeTarget).toBeChecked()
  const targetModel = panel.getByRole("group", { name: "Target model", exact: true }).getByRole("button")
  await expect(targetModel).toContainText("Group · Scheduled route")
  await expect(panel.getByRole("group", { name: "Target model variant", exact: true })).toHaveCount(0)
  const targetAgent = panel.getByRole("group", { name: "Target agent", exact: true }).getByRole("button")
  await expect(targetAgent).toBeEnabled()
  await targetAgent.click()
  await page.getByRole("option", { name: "Plan", exact: true }).click()
  await expect(targetAgent).toContainText("Plan")
  await expect(targetModel).toBeEnabled()
  await targetModel.click()
  await page.getByRole("option", { name: "MP03 normal model", exact: true }).click()
  await expect(targetModel).toContainText("MP03 normal model")
  const targetMode = panel.getByRole("group", { name: "Target mode", exact: true }).getByRole("button")
  await targetMode.click()
  await page.getByRole("option", { name: "Custom", exact: true }).click()
  const targetProfile = panel.getByRole("group", { name: "Saved Custom profile", exact: true }).getByRole("button")
  await expect(targetProfile).toBeEnabled()
  await targetProfile.click()
  await page.getByRole("option", { name: "MP03 saved profile", exact: true }).click()
  await expect(targetProfile).toContainText("MP03 saved profile")
  await expect(panel.getByRole("button", { name: "Preview Custom profile", exact: true })).toBeEnabled()
  await targetMode.click()
  await page.getByRole("option", { name: "Coding", exact: true }).click()
  await expect(targetModel).toBeEnabled()
  await targetModel.click()
  await page.getByRole("option", { name: "Group · Scheduled route", exact: true }).click()
  await expect(targetModel).toContainText("Group · Scheduled route")
  await panel.getByRole("textbox", { name: "Scheduled content", exact: true }).fill("Revised scheduled work")
  const tab = side.getByRole("tab", { name: "Task delegation", exact: true })
  await tab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await openAdvanced(page)
  await expect(panel.getByRole("textbox", { name: "Scheduled content", exact: true })).toHaveValue(
    "Revised scheduled work",
  )
  await expect(targetModel).toContainText("Group · Scheduled route")
  await changeTarget.focus()
  await changeTarget.press("Space")
  await expect(changeTarget).not.toBeChecked()
  await expect(targetModel).toHaveCount(0)
  expect(mutations).toEqual([])
  await panel.getByRole("button", { name: "Save revision", exact: true }).click()
  await expect(panel.getByRole("alert")).toContainText("Schedule revision changed")
  await expect(panel.getByRole("textbox", { name: "Scheduled content", exact: true })).toHaveValue(
    "Revised scheduled work",
  )
  expect(mutations[0]).toMatchObject({ action: "edit", id: rule.id, body: { expectedRevision: 3 } })
  const failedEdit = mutations[0]

  if (failedEdit?.action !== "edit") throw new Error("Expected a Schedule edit request")
  expect(failedEdit.body).not.toHaveProperty("target")
  fault.edit = false
  await panel.getByRole("button", { name: "Save revision", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Revised scheduled work", exact: true })).toBeVisible()
  await expect(panel.getByText("Create once, then reuse the main session", { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Pause future occurrences", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Resume schedule", exact: true })).toBeEnabled()
  await panel.getByRole("button", { name: "Resume schedule", exact: true }).click()
  await panel.getByRole("button", { name: "Run one occurrence", exact: true }).click()
  await panel.getByRole("button", { name: "Occurrence history", exact: true }).click()
  await expect(panel.getByText("Input admitted", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Pause future occurrences", exact: true })).toBeEnabled()
  await expect(panel.getByText("Completed", { exact: true })).toHaveCount(0)
  expect(mutations.at(-1)).toMatchObject({ action: "run", id: rule.id, body: { expectedRevision: 4 } })
  await expect(page).toHaveURL(sessionHref(sessionID))
  await panel.getByRole("button", { name: "Cancel schedule", exact: true }).click()
  await expect(panel.getByRole("button", { name: "Edit schedule", exact: true })).toHaveCount(0)
  await expect(panel.getByText("Input admitted", { exact: true })).toBeVisible()
})

test("Files navigation keeps durable tabs and persists explicit preview mode across reloads", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const title = "File navigation"
  const directory = "C:/AigcForge/FileNavigation"

  await openSession(page, {
    name: "FileNavigation",
    directory,
    sessions: [{ id: "ses_file_navigation", title, mode: "coding" }],
    fileList: (path) =>
      path ? [] : ["alpha.txt", "beta.txt", "gamma.txt", "delta.txt"].map((name) => fileNode(directory, name)),
    fileContent: (path) => `contents:${path}`,
    seed: { storage: { "aigcfroge.global.dat:review-panel-v2": { sidebarOpened: false } } },
  })

  const side = page.locator("#review-panel")
  const strip = side.locator(".session-review-v2-tabs-bar").getByRole("tablist")
  const navigation = strip.getByRole("tab", { name: "Open file", exact: true })
  const alpha = strip.getByRole("tab", { name: "alpha.txt", exact: true })
  const beta = strip.getByRole("tab", { name: "beta.txt", exact: true })
  const gamma = strip.getByRole("tab", { name: "gamma.txt", exact: true })
  const delta = strip.getByRole("tab", { name: "delta.txt", exact: true })
  const tree = side.locator('[data-component="session-review-v2-sidebar-root"]')
  const treeToggle = side.getByRole("button", { name: "Toggle file tree", exact: true })
  const settings = page.getByTestId("settings-screen")
  const preview = settings.getByRole("switch", { name: "Use temporary file tabs", exact: true })

  const openPreferences = async () => {
    await page.locator('[data-component="composer-editor"]').click()
    await page.keyboard.press("Control+,")
    await expect(preview).toBeVisible()
  }

  const closePreferences = async () => {
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
  }

  await openSidePanel(page, "Open file")
  await expect(navigation).toHaveAttribute("data-value", "file:open")
  await expect(side.getByRole("switch", { name: "Preview files", exact: true })).toHaveCount(0)
  await tree.getByRole("button", { name: "alpha.txt", exact: true }).click()
  await expect(alpha).toHaveAttribute("aria-selected", "true")
  await expect(side.getByText("contents:alpha.txt", { exact: true })).toBeVisible()
  await expect(navigation).toHaveCount(1)
  await navigation.click()
  await tree.getByRole("button", { name: "beta.txt", exact: true }).click()
  await expect(beta).toHaveAttribute("aria-selected", "true")
  await expect(alpha).toHaveCount(1)
  await expect(beta).toHaveCount(1)
  await expect(navigation).toHaveCount(1)
  await navigation.click()
  await tree.getByRole("button", { name: "alpha.txt", exact: true }).click()
  await expect(alpha).toHaveAttribute("aria-selected", "true")
  await expect(alpha).toHaveAttribute("data-value", "file://alpha.txt")
  await expect(alpha).toHaveCount(1)
  await expect(beta).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("files-durable-tabs.png") })
  await alpha.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(alpha).toHaveCount(0)
  await expect(strip.getByRole("tab", { selected: true })).toHaveText(/^(Open file|beta\.txt)$/)
  await beta.click()
  await beta.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(beta).toHaveCount(0)
  await expect(navigation).toHaveAttribute("aria-selected", "true")
  await expect(tree.getByRole("button", { name: "alpha.txt", exact: true })).toBeVisible()
  await tree.getByRole("button", { name: "alpha.txt", exact: true }).click()
  await expect(alpha).toHaveAttribute("aria-selected", "true")
  await expect(treeToggle).toBeEnabled()
  await expect(tree).toBeHidden()
  await treeToggle.click()
  await expect(tree).toBeVisible()
  await expect(side.getByRole("switch", { name: "Preview files", exact: true })).toHaveCount(0)
  await treeToggle.click()
  await expect(tree).toBeHidden()
  await expect(side.getByRole("switch", { name: "Preview files", exact: true })).toHaveCount(0)
  await treeToggle.click()
  await expect(tree).toBeVisible()
  await openPreferences()
  await expect(preview).not.toBeChecked()
  await preview.press("Space")
  await expect(preview).toBeChecked()
  await closePreferences()
  await tree.getByRole("button", { name: "beta.txt", exact: true }).click()
  await expect(beta).toHaveAttribute("aria-selected", "true")
  await expect(alpha).toHaveCount(1)
  await expect(navigation).toHaveCount(1)
  await tree.getByRole("button", { name: "gamma.txt", exact: true }).click()
  await expect(gamma).toHaveAttribute("aria-selected", "true")
  await expect(beta).toHaveCount(0)
  await tree.getByRole("button", { name: "gamma.txt", exact: true }).dblclick()
  await tree.getByRole("button", { name: "delta.txt", exact: true }).click()
  await expect(delta).toHaveAttribute("aria-selected", "true")
  await expect(gamma).toHaveCount(1)
  await expect(alpha).toHaveCount(1)
  await expect(navigation).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("files-preview-enabled.png") })
  await page.reload()
  await expectSessionTitle(page, title)
  await expect(alpha).toHaveCount(1)
  await expect(gamma).toHaveCount(1)
  await openSidePanel(page, "Open file")
  await openPreferences()
  await expect(preview).toBeChecked()
  await preview.press("Space")
  await expect(preview).not.toBeChecked()
  await closePreferences()
  await tree.getByRole("button", { name: "beta.txt", exact: true }).click()
  await expect(beta).toHaveAttribute("aria-selected", "true")
  await navigation.click()
  await tree.getByRole("button", { name: "delta.txt", exact: true }).click()
  await expect(delta).toHaveAttribute("aria-selected", "true")
  await expect(beta).toHaveCount(1)
  await expect(navigation).toHaveCount(1)
  await page.reload()
  await expectSessionTitle(page, title)

  for (const name of ["alpha.txt", "beta.txt", "gamma.txt", "delta.txt"]) {
    await expect(strip.getByRole("tab", { name, exact: true })).toHaveCount(1)
  }

  await openSidePanel(page, "Open file")
  await expect(navigation).toHaveAttribute("data-value", "file:open")
  await expect(side.getByRole("switch", { name: "Preview files", exact: true })).toHaveCount(0)
  await expect(tree.getByRole("button", { name: "alpha.txt", exact: true })).toBeVisible()
  await openPreferences()
  await expect(preview).not.toBeChecked()
  await closePreferences()
})

test("resource display preferences preserve file order and terminal while hidden links offer recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const title = "Resource display preferences"
  const directory = "C:/AigcForge/ResourceDisplay"

  const workspace = await openSession(page, {
    name: title,
    directory,
    sessions: [
      {
        id: "ses_resource_display",
        title,
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_resource_display", rootSessionID: "ses_resource_display" },
      },
    ],
    pty: {},
    vcsDiff: [fileDiff("note.txt")],
    fileList: (path) => (path ? [] : [fileNode(directory, "note.txt"), fileNode(directory, "preview.html")]),
    fileContent: (path) => (path === "note.txt" ? "Resource note" : "<!doctype html><title>Resource preview</title>"),
    pageMessages: () => ({
      items: [
        { id: "msg_resource_prompt", type: "user", text: "Inspect these files", time: { created: 1 } },
        {
          id: "msg_resource_result",
          type: "assistant",
          agent: "build",
          model: { providerID: "fixture", id: "fixture" },
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: "[note.txt](note.txt) · [preview.html](preview.html)" }],
        },
      ],
    }),
    seed: {
      settings: { general: { showFileTree: true } },
      storage: { "aigcfroge.global.dat:layout": { fileTree: { opened: true, width: 240, tab: "all" } } },
    },
  })

  const side = page.locator("#review-panel")
  const fileTabs = side.getByRole("tab").filter({ hasText: /^(note\.txt|preview\.html)$/ })
  await openSidePanel(page, "Review")
  await page.getByRole("link", { name: "note.txt", exact: true }).click()
  await expect(side.getByRole("tab", { name: "note.txt", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("link", { name: "preview.html", exact: true }).click()
  await expect(side.getByRole("tab", { name: "preview.html", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(fileTabs).toHaveText(["note.txt", "preview.html"])
  await page.keyboard.press("Control+Backquote")
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()
  await expect.poll(() => workspace.pty.sockets.length).toBe(1)
  const ptyID = workspace.pty.sockets[0]!.id
  await openAdvanced(page)
  await page.keyboard.press("Control+p")
  await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(page.locator("[data-dialog-layer]")).toHaveCount(0)
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()
  await page.locator('[data-component="composer-editor"]').click()
  await expect(page.locator('[data-component="composer-editor"]')).toBeFocused()
  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")

  for (const label of ["Show Files", "Show Review", "Show Browser"]) {
    await settings.getByRole("switch", { name: label, exact: true }).press("Space")
  }

  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await expect(fileTabs).toHaveCount(0)
  await expect(page.locator("#session-side-panel-review-tab")).toHaveCount(0)
  await expect(page.locator('[data-component="file-tree-v2"]')).toHaveCount(0)
  await side.getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(
    side.locator('[data-component="session-panel-launcher"]').getByRole("button", { name: "Open file", exact: true }),
  ).toHaveCount(0)
  await side
    .getByRole("tab", { name: "New tab", exact: true })
    .locator("..")
    .getByRole("button", { name: "Close tab", exact: true })
    .click()

  const draft = side
    .getByRole("region", { name: "Advanced management", exact: true })
    .getByRole("textbox", { name: "Search project facts", exact: true })

  await draft.focus()
  await page.keyboard.press("Control+p")
  await page.keyboard.type("Preserved while Files are hidden")
  await expect(draft).toHaveValue("Preserved while Files are hidden")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await openSidePanel(page, "Task delegation")
  const collaboration = side.getByRole("tab", { name: "Task delegation", exact: true })
  await page.getByRole("link", { name: "note.txt", exact: true }).click()
  await expect(page.getByText("Files are hidden", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Open settings", exact: true }).click()
  await settings.getByRole("switch", { name: "Show Files", exact: true }).press("Space")
  await settings.getByRole("switch", { name: "Show Browser", exact: true }).press("Space")
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await expect(fileTabs).toHaveText(["note.txt", "preview.html"])
  await expect(collaboration).toHaveAttribute("aria-selected", "true")
  const tree = page.locator("#file-tree-panel")
  await tree.getByRole("tab", { name: "Files Changed 1", exact: true }).click()
  await tree.getByRole("button", { name: "note.txt M", exact: true }).click()
  await expect(side.getByRole("tab", { name: "note.txt", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(side.getByText("Resource note", { exact: true })).toBeVisible()
  await page.locator('[data-component="composer-editor"]').click()
  await expect(page.locator('[data-component="composer-editor"]')).toBeFocused()
  await page.keyboard.press("Control+,")
  await settings.getByRole("switch", { name: "Show Review", exact: true }).press("Space")
  await expect(settings.getByRole("switch", { name: "Show Browser", exact: true })).toBeChecked()
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
  await expectSessionTitle(page, title)
  await expect(page.locator("#session-side-panel-review-tab")).toBeVisible()
  await expect(side.getByRole("tab", { name: "note.txt", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()
  expect(workspace.pty.created).toHaveLength(1)
  expect(workspace.pty.removed).toHaveLength(0)
  expect(workspace.pty.rejected).toHaveLength(0)
  expect(workspace.pty.sockets.every((socket) => socket.id === ptyID)).toBe(true)
  await expect.poll(() => workspace.pty.sockets.filter((socket) => !socket.closed).length).toBe(1)
})

test("review and terminal follow the session tab and stay mounted", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const a = { id: "ses_side_a", title: "Alpha session" }
  const b = { id: "ses_side_b", title: "Beta session" }

  const { directory, pty } = await openSession(page, {
    name: "SidePanels",
    sessions: [a, b],
    pty: {},
    vcsDiff: Array.from({ length: 2_740 }, (_, index) =>
      fileDiff(`src/generated-${String(index).padStart(4, "0")}.ts`),
    ),
    seed: {
      panes: { [a.id]: { sessionWidth: 580, terminalHeight: 300 }, [b.id]: { sessionWidth: 520, terminalHeight: 180 } },
      settings: { general: { terminalPlacement: "bottom" } },
    },
  })

  const chat = page.locator('[data-slot="session-chat-panel"]')
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')
  const terminalPanel = page.locator('[data-component="terminal-panel"]')

  const switchTab = async (title: string) => {
    await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
    await expectSessionTitle(page, title)
  }

  // Beta owns a Review tab whose region is closed; switching back must retain the loaded panel.
  await switchTab(b.title)
  await openSidePanel(page, "Review")
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await expect(review).toBeHidden()
  await switchTab(a.title)

  const transition = () => chat.evaluate((element) => getComputedStyle(element).transitionDuration)
  await openSidePanel(page, "Review")
  await expect.poll(transition).not.toBe("0s")
  await page.keyboard.press("Control+Backquote")
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "true")
  await expect(page.getByRole("navigation", { name: "Modes", exact: true }).getByRole("button")).toHaveCount(5)
  await expect.poll(async () => (await chat.boundingBox())?.width).toBeGreaterThanOrEqual(450)
  await expect.poll(async () => (await chat.boundingBox())?.width).toBeLessThan(580)
  await page.setViewportSize({ width: 1500, height: 900 })
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")
  await expect(page.locator("#session-side-panel-review-tab")).toHaveText("Files Changed 2740")
  await expect.poll(() => pty.sockets.length).toBe(1)
  await mark(review)
  await mark(terminal)

  await switchTab(b.title)
  await expect(review).toBeHidden()
  await expect(terminal).toBeHidden()
  await expect(terminalPanel).toHaveAttribute("data-size-animated", "false")
  await expect.poll(transition).toBe("0s")
  await expectMarked(review)
  await expectMarked(terminal)
  await openSidePanel(page, "Review")
  await page.keyboard.press("Control+Backquote")
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "520px")
  await expect(terminalPanel).toHaveCSS("height", "180px")

  await switchTab(a.title)
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")
  await expectMarked(review)
  await expectMarked(terminal)
  expect(pty.sockets).toHaveLength(1)
  expect(pty.sockets[0]!.url.searchParams.get("location[directory]")).toBe(directory)
  expect(pty.sockets[0]!.url.searchParams.get("ticket")).toBe("e2e-ticket")
  expect(pty.tokens[0]?.headers["x-aigcfroge-ticket"]).toBe("1")

  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem("aigcfroge.window.browser.dat:tabs.panes") ?? "{}")[key]?.review,
        tabKey(a.id),
      ),
    )
    .toBe(true)
  await page.reload()
  await expectSessionTitle(page, a.title)
  await expect(review).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect(chat).toHaveCSS("width", "580px")
  await expect(terminalPanel).toHaveCSS("height", "300px")

  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("button", { name: "generated-0000.ts" })).toBeVisible()
  expect(await tree.locator('[data-slot="file-tree-v2-row"]').count()).toBeLessThanOrEqual(60)
  const viewport = page.locator('#review-panel [data-slot="session-review-v2-sidebar-tree"] .scroll-view__viewport')
  await viewport.hover()
  await page.mouse.wheel(0, 100_000)
  await expect(tree.getByRole("button", { name: "generated-2739.ts" })).toBeVisible()
})

test("the selected side panel owns the resize limit and preserves the requested width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await openSession(page, {
    name: "ActivePanelWidth",
    sessions: [{ id: "ses_active_panel_width", title: "Active panel width", mode: "chat" }],
    vcsDiff: [fileDiff("changed.ts")],
    seed: { panes: { ses_active_panel_width: { sessionWidth: 450 } } },
  })

  const chat = page.locator('[data-slot="session-chat-panel"]')
  const side = page.locator("#review-panel")
  const review = page.locator("#session-side-panel-review-tab")
  const prompt = page.locator('[data-component="prompt-proposals-panel"]')
  const promptTab = page.locator("#session-side-panel-prompt-proposals-tab")

  await openSidePanel(page, "Review")
  await openSidePanel(page, "Prompt proposals")
  await expect(prompt.getByRole("heading", { name: "Prompt proposals", exact: true })).toBeVisible()
  await expect(chat).toHaveCSS("width", "450px")

  const handle = chat.locator('[data-component="resize-handle"][data-direction="horizontal"]')

  await expect(handle).toBeVisible()

  const bounds = await handle.boundingBox()

  if (!bounds) throw new Error("session resize handle has no bounding box")

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await expect(page.locator("body")).toHaveCSS("user-select", "none")
  await page.mouse.move(bounds.x + bounds.width / 2 + 150, bounds.y + bounds.height / 2)
  await page.mouse.up()
  await expect(chat).toHaveCSS("width", "600px")

  await review.click()
  await expect(review).toHaveAttribute("aria-selected", "true")
  await expect(side.getByRole("button", { name: "Split diff", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(async () => (await side.boundingBox())?.width).toBeGreaterThanOrEqual(800)
  await expect.poll(async () => (await chat.boundingBox())?.width).toBeLessThan(600)

  await side.getByRole("button", { name: "Unified diff", exact: true }).click()
  await expect(side.getByRole("button", { name: "Unified diff", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(chat).toHaveCSS("width", "600px")
  await side.getByRole("button", { name: "Split diff", exact: true }).click()
  await expect(side.getByRole("button", { name: "Split diff", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(async () => (await side.boundingBox())?.width).toBeGreaterThanOrEqual(800)

  await promptTab.click()
  await expect(prompt).toBeVisible()
  await expect(chat).toHaveCSS("width", "600px")
  await side
    .locator('[data-slot="tabs-v2-trigger-wrapper"], [data-slot="tabs-trigger-wrapper"]', { has: promptTab })
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(promptTab).toHaveCount(0)
  await expect(review).toHaveAttribute("aria-selected", "true")
  await expect.poll(async () => (await side.boundingBox())?.width).toBeGreaterThanOrEqual(800)

  await openSidePanel(page, "Prompt proposals")
  await expect(prompt.getByRole("heading", { name: "Prompt proposals", exact: true })).toBeVisible()
  await expect(promptTab).toHaveCount(1)
  await expect(chat).toHaveCSS("width", "600px")
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await expect(side).toBeHidden()
  await expect(handle).toBeHidden()
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await expect(prompt).toBeVisible()
  await expect(chat).toHaveCSS("width", "600px")
})

test("long file and management tabs keep close buttons reachable while the side panel narrows", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1680, height: 900 })
  const directory = "C:/AigcForge/LongSideTabTitles"
  const sessionID = "ses_long_side_tab_titles"
  const filename = "a-very-long-file-name-that-must-keep-its-close-button-reachable-while-the-side-panel-narrows.ts"

  await openSession(page, {
    name: "LongSideTabTitles",
    directory,
    sessions: [
      {
        id: sessionID,
        title: "Long side tab titles",
        mode: "work",
        agent: "meta",
        controller: { kind: "root", metaAgentID: "mag_long_side_tab_titles", rootSessionID: sessionID },
      },
    ],
    vcsDiff: [fileDiff("changed.ts")],
    fileContent: (path) => `contents:${path}`,
    pageMessages: () => ({
      items: [
        { id: "msg_side_titles_prompt", type: "user", text: "Inspect these files", time: { created: 1 } },
        {
          id: "msg_side_titles_result",
          type: "assistant",
          agent: "build",
          model: { providerID: "fixture", id: "fixture" },
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: `[${filename}](${filename}) · [note.txt](note.txt)` }],
        },
      ],
    }),
    seed: {
      panes: { [sessionID]: { sessionWidth: 450 } },
      storage: { "aigcfroge.global.dat:review-panel-v2": { sidebarOpened: false } },
    },
  })

  const chat = page.locator('[data-slot="session-chat-panel"]')
  const side = page.locator("#review-panel")
  const strip = side.locator(".session-review-v2-tabs-bar").getByRole("tablist")
  const review = strip.locator("#session-side-panel-review-tab")
  const fileTab = strip.getByRole("tab", { name: filename, exact: true })
  const fileTitle = fileTab.getByText(filename, { exact: true })
  const neighbor = strip.getByRole("tab", { name: "note.txt", exact: true })
  const scrollPrevious = side.getByRole("button", { name: "Scroll tabs backward", exact: true })
  const scrollNext = side.getByRole("button", { name: "Scroll tabs forward", exact: true })

  await openSidePanel(page, "Review")
  for (const name of ["Task delegation", "Workflow run"]) {
    await openSidePanel(page, name)
    await expect(strip.getByRole("tab", { name, exact: true })).toHaveCount(1)
  }

  await page.getByRole("button", { name: "View context usage", exact: true }).click()
  await expect(strip.getByRole("tab", { name: "Context", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(review).toHaveCount(1)

  // Use the Markdown file-link path exercised by the resource display preference keeper.
  await page.getByRole("link", { name: filename, exact: true }).click()
  await expect(fileTab).toHaveAttribute("aria-selected", "true")
  await expect(side.getByText(`contents:${filename}`, { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "note.txt", exact: true }).click()
  await expect(fileTab).toHaveCount(1)
  await expect(neighbor).toHaveAttribute("aria-selected", "true")
  await fileTab.click()
  await expect(fileTab).toHaveAttribute("aria-selected", "true")
  await expect(fileTitle).toBeVisible()
  await expect(chat).toHaveCSS("width", "450px")
  await expect.poll(() => strip.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
  await expect(scrollPrevious).toHaveCount(0)
  await expect(scrollNext).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("side-tab-close-wide.png") })

  const handle = chat.locator('[data-component="resize-handle"][data-direction="horizontal"]')
  const wideTitle = await fileTitle.boundingBox()
  const widePanel = await side.boundingBox()
  const bounds = await handle.boundingBox()

  if (!wideTitle || !widePanel || !bounds) throw new Error("Side panel title or resize bounds are unavailable")

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await expect(page.locator("body")).toHaveCSS("user-select", "none")
  await page.mouse.move(bounds.x + bounds.width / 2 + 450, bounds.y + bounds.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect
    .poll(async () => (await side.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
    .toBeLessThan(widePanel.width - 100)
  await expect
    .poll(async () => (await fileTitle.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
    .toBeLessThan(wideTitle.width)

  // Check the selected long title before any tab click can scroll the strip after resizing.
  for (const name of [filename, "Context", "Task delegation", "Workflow run", "note.txt", filename, "New tab"]) {
    if (name === "New tab") await side.getByRole("button", { name: "Add tab", exact: true }).click()

    const tab = strip.getByRole("tab", { name, exact: true })

    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click()

    const close = tab.locator("..").getByRole("button", { name: "Close tab", exact: true })

    await expect(close).toBeVisible()
    await expect
      .poll(async () => {
        const button = await close.boundingBox()
        const visible = await strip.boundingBox()

        if (!button || !visible) return false

        const reachable = await close.evaluate((element) => {
          const rect = element.getBoundingClientRect()

          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        })

        return (
          button.width > 0 &&
          button.height > 0 &&
          button.x >= visible.x &&
          button.y >= visible.y &&
          button.x + button.width <= visible.x + visible.width &&
          button.y + button.height <= visible.y + visible.height &&
          reachable
        )
      })
      .toBe(true)
  }

  await page.screenshot({ path: testInfo.outputPath("side-tab-close-narrow.png") })
  await expect.poll(() => strip.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0)
  await expect(scrollPrevious).toBeVisible()
  await expect(scrollNext).toBeVisible()
  const newTab = strip.getByRole("tab", { name: "New tab", exact: true })
  const beforeScroll = await strip.evaluate((element) => element.scrollLeft)
  await expect(scrollPrevious).toBeEnabled()
  await scrollPrevious.click()
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeLessThan(beforeScroll)
  await expect(newTab).toHaveAttribute("aria-selected", "true")
  const previousScroll = await strip.evaluate((element) => element.scrollLeft)
  await expect(scrollNext).toBeEnabled()
  await scrollNext.click()
  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(previousScroll)
  await expect(newTab).toHaveAttribute("aria-selected", "true")
  await strip
    .getByRole("tab", { name: "New tab", exact: true })
    .locator("..")
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(strip.getByRole("tab", { name: "New tab", exact: true })).toHaveCount(0)
  await fileTab.click()
  await fileTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(fileTab).toHaveCount(0)
  await expect(neighbor).toHaveCount(1)
  await expect(review).toHaveCount(1)

  for (const name of ["Context", "Task delegation", "Workflow run"]) {
    await expect(strip.getByRole("tab", { name, exact: true })).toHaveCount(1)
  }

  const narrowedHandle = await handle.boundingBox()

  if (!narrowedHandle) throw new Error("Side panel resize handle is unavailable")

  await page.mouse.move(narrowedHandle.x + narrowedHandle.width / 2, narrowedHandle.y + narrowedHandle.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    narrowedHandle.x + narrowedHandle.width / 2 - 450,
    narrowedHandle.y + narrowedHandle.height / 2,
    {
      steps: 12,
    },
  )
  await page.mouse.up()
  await expect.poll(() => strip.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
  await expect(scrollPrevious).toHaveCount(0)
  await expect(scrollNext).toHaveCount(0)
})

test("terminal stacks under review by default and spans the bottom when configured", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })

  // A large nested branch diff; its first file is the sentinel that proves the virtualized tree stays mounted.
  const diffs = [
    fileDiff(".github/actions/setup-bun/action.yml", { additions: 7 }),
    ...Array.from({ length: 2_739 }, (_, index) =>
      fileDiff(
        `src/branch/d${String(Math.floor(index / 100)).padStart(5, "0")}/generated-${String(index).padStart(4, "0")}.ts`,
        { additions: 100, loaded: false },
      ),
    ),
  ]

  await openSession(page, { name: "SideStack", pty: {}, vcsDiff: diffs })
  const toggle = page.getByRole("button", { name: "Toggle review" })
  const reviewPanel = page.locator("#review-panel")
  const terminalPanel = page.locator("#terminal-panel")
  const review = page.locator('[data-component="session-review-v2"]')
  const terminal = page.locator('[data-component="terminal"]')

  await openSidePanel(page, "Review")
  await expect(reviewPanel).toBeVisible()
  await expectTreeSentinel(page)

  for (const direction of ["ltr", "rtl"] as const) {
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    await expect.poll(() => sideContentOffset(page, direction)).toBeLessThanOrEqual(1)
  }

  await page.evaluate(() => (document.documentElement.dir = "ltr"))

  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeVisible()
  await expect(terminal).toBeVisible()
  await expect
    .poll(async () => {
      const top = (await reviewPanel.boundingBox())!
      const bottom = (await terminalPanel.boundingBox())!
      const gap = bottom.y - top.y - top.height

      return (
        Math.abs(top.x - bottom.x) <= 1 &&
        Math.abs(top.x + top.width - bottom.x - bottom.width) <= 1 &&
        gap >= 7 &&
        gap <= 9
      )
    })
    .toBe(true)
  await expectTreeSentinel(page)
  await mark(review)
  await mark(terminal)

  // Closing review mid-motion: the terminal grows upward with its bottom fixed and its content top-anchored.
  const stacked = await stackGeometry(page)
  await holdTransitions(page)
  await toggle.click()
  const closing = await stackGeometry(page, 0.5)
  await releaseTransitions(page)
  await expect(reviewPanel).toBeHidden()
  await expect(terminalPanel).toBeVisible()
  const alone = await stackGeometry(page)
  expect(closing.moving).toEqual(expect.arrayContaining(["session-side-region", "session-side-terminal-region"]))
  expect(closing.terminalRegion).toBeGreaterThan(stacked.terminalRegion + 1)
  expect(closing.terminalRegion).toBeLessThan(alone.terminalRegion - 1)
  expect(Math.abs(closing.terminalBottom - stacked.terminalBottom)).toBeLessThanOrEqual(1)
  expect(closing.anchor).toBeLessThanOrEqual(8)
  expect(closing.terminalGap).toBeLessThanOrEqual(1)

  await toggle.click()
  await expect(reviewPanel).toBeVisible()
  await expectMarked(review)
  await expectTreeSentinel(page)

  // Hiding the terminal mid-motion: both surfaces fill their regions and the clipped terminal keeps its size.
  const open = await stackGeometry(page)
  await holdTransitions(page)
  await page.keyboard.press("Control+Backquote")
  const hiding = await stackGeometry(page, 0.5)
  await releaseTransitions(page)
  await expect(terminalPanel).toBeHidden()
  expect(hiding.moving).toEqual(expect.arrayContaining(["session-side-region", "session-side-terminal-region"]))
  expect(hiding.terminalRegion).toBeLessThan(open.terminalRegion - 1)
  expect(hiding.terminalRegion).toBeGreaterThan(1)
  expect(hiding.reviewGap).toBeLessThanOrEqual(1)
  expect(hiding.terminalGap).toBeLessThanOrEqual(1)
  expect(Math.abs(hiding.content.width - open.content.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(hiding.content.height - open.content.height)).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-slot="side-terminal-panel-clip"]')).toHaveCSS("overflow", "clip")
  await expectMarked(terminal)
  await page.setViewportSize({ width: 1200, height: 700 })
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expectMarked(terminal)
  await expectTreeSentinel(page)
  expect(await page.evaluate(() => window.scrollX)).toBe(0)
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeHidden()

  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ ...settings, general: { ...settings.general, terminalPlacement: "bottom" } }),
    )
  })
  await page.reload()
  await expect(reviewPanel).toBeVisible()
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const review = document.querySelector("#review-panel")?.getBoundingClientRect()
        const terminal = document.querySelector("#terminal-panel")?.getBoundingClientRect()
        const chat = document.querySelector('[data-slot="session-chat-panel"]')?.getBoundingClientRect()
        const sidebar = document.querySelector('#review-panel [data-slot="session-review-v2-sidebar"]')

        // The side region appears before its lazy review content after reload.
        if (!review || !terminal || !chat || !sidebar) return false
        const gap = terminal.top - review.bottom

        return (
          Math.abs(terminal.left - chat.left) <= 1 &&
          Math.abs(terminal.right - review.right) <= 1 &&
          gap >= 7 &&
          gap <= 9 &&
          sidebar.getBoundingClientRect().width >= 240
        )
      }),
    )
    .toBe(true)
  await expectTreeSentinel(page)
  await page.keyboard.press("Control+Backquote")
  await expect(terminalPanel).toBeHidden()
  await expect(terminal).toBeAttached()
})

for (const direction of ["ltr", "rtl"] as const) {
  test(`terminal controls stay clear of the review toggle in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    const { pty } = await openSession(page, { name: "TerminalControls", pty: { prefix: "pty_review_" } })
    await page.locator("html").evaluate((element, dir) => element.setAttribute("dir", dir), direction)

    const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await page.keyboard.press("Control+Backquote")
    const terminal = page.getByRole("region", { name: "Terminal", exact: true })
    await expect(terminal.getByRole("tab", { name: "Terminal 1", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    for (const number of [2, 3, 4]) {
      await terminal.getByRole("button", { name: "New terminal", exact: true }).click()
      await expect(terminal.getByRole("tab", { name: `Terminal ${number}`, exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      )
    }

    await expect
      .poll(async () => {
        const tabs = (await terminal.getByRole("tablist").boundingBox())!
        const button = (await toggle.boundingBox())!

        return direction === "rtl" ? tabs.x >= button.x + button.width : tabs.x + tabs.width <= button.x
      })
      .toBe(true)
    await expectTerminalControlsAligned(terminal, toggle)
    await terminal
      .locator('[data-slot="tabs-trigger-wrapper"][data-value="pty_review_4"]')
      .getByRole("button", { name: "Close terminal", exact: true })
      .click()
    await expect(terminal.getByRole("tab")).toHaveText(["Terminal 1", "Terminal 2", "Terminal 3"])
    expect(pty.removed).toEqual(["pty_review_4"])
    await expect(toggle).toHaveAttribute("aria-expanded", "false")

    // The client names a new terminal with the lowest free number.
    await terminal.getByRole("button", { name: "New terminal", exact: true }).click()
    await expect(terminal.getByRole("tab", { name: "Terminal 4", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(terminal.locator('[data-slot="tabs-trigger-wrapper"][data-value="pty_review_5"]')).toHaveCount(1)
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    const position = await toggle.boundingBox()
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(page.locator("#review-panel")).toHaveAttribute("aria-hidden", "false")
    await expect.poll(() => toggle.boundingBox()).toEqual(position)
    await expect
      .poll(async () => {
        const actions = (await page.locator('[data-slot="session-side-panel-actions"]').boundingBox())!
        const button = (await toggle.boundingBox())!

        return actions.y + actions.height / 2 - (button.y + button.height / 2)
      })
      .toBe(0)
    await toggle.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(toggle).toBeFocused()
    await expect.poll(() => toggle.boundingBox()).toEqual(position)
    await expectTerminalControlsAligned(terminal, toggle)
  })
}

// A DOM mark survives only while the same node stays mounted.
function mark(locator: Locator) {
  return locator.evaluate((element) => element.setAttribute("data-e2e-mounted", "original"))
}

function expectMarked(locator: Locator) {
  return expect(locator).toHaveAttribute("data-e2e-mounted", "original")
}

async function expectTreeSentinel(page: Page) {
  const tree = page.locator('#review-panel [data-component="file-tree-v2"]')
  await expect(tree.getByRole("button", { name: "action.yml" })).toBeVisible()
  const rows = await tree.locator('[data-slot="file-tree-v2-row"]').count()
  expect(rows).toBeGreaterThan(0)
  expect(rows).toBeLessThanOrEqual(60)
}

// Pauses each CSS transition as it starts, so a real toggle can be measured mid-motion.
function holdTransitions(page: Page) {
  return page.evaluate(() => {
    const host: Window & { e2eHold?: { active: boolean } } = window

    if (!host.e2eHold) {
      const hold = { active: false }
      host.e2eHold = hold
      document.addEventListener("transitionrun", (event) => {
        if (!hold.active || !(event.target instanceof Element)) return
        event.target
          .getAnimations()
          .filter((item) => item instanceof CSSTransition && item.transitionProperty === event.propertyName)
          .forEach((item) => item.pause())
      })
    }

    host.e2eHold.active = true
  })
}

function releaseTransitions(page: Page) {
  return page.evaluate(() => {
    const host: Window & { e2eHold?: { active: boolean } } = window
    host.e2eHold!.active = false
    document
      .getAnimations()
      .filter((item) => item instanceof CSSTransition && item.playState === "paused")
      .forEach((item) => item.finish())
  })
}

// With `progress`, waits for the held region height transitions and seeks every held transition to that point first.
async function stackGeometry(page: Page, progress?: number) {
  const held = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter(
          (item) =>
            item instanceof CSSTransition && item.playState === "paused" && item.transitionProperty === "height",
        )
        .map((item) => {
          if (!(item.effect instanceof KeyframeEffect) || !(item.effect.target instanceof Element))
            throw new Error("Expected a transition on an element")

          return item.effect.target.getAttribute("data-slot")
        }),
    )

  if (progress !== undefined) {
    await expect.poll(held).toEqual(expect.arrayContaining(["session-side-region", "session-side-terminal-region"]))
  }

  return page.evaluate((progress) => {
    const transitions = document
      .getAnimations()
      .filter((item): item is CSSTransition => item instanceof CSSTransition && item.playState === "paused")

    const targets = transitions.map((item) => {
      if (!(item.effect instanceof KeyframeEffect) || !(item.effect.target instanceof Element))
        throw new Error("Expected a transition on an element")

      return item.effect.target
    })

    const region =
      transitions[targets.findIndex((target) => target.getAttribute("data-slot") === "session-side-region")]

    if (progress !== undefined) {
      const time = Number(region!.effect!.getTiming().duration) * progress
      transitions.forEach((item) => (item.currentTime = time))
    }

    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const reviewRegion = box('[data-slot="session-side-region"]')!
    const terminalRegion = box('[data-slot="session-side-terminal-region"]')!
    const review = box("#review-panel")
    const terminal = box("#terminal-panel")!
    const content = box('[data-slot="terminal-panel-content"]')!

    return {
      moving: targets.map((target) => target.getAttribute("data-slot")),
      terminalRegion: terminalRegion.height,
      terminalBottom: terminal.bottom,
      anchor: Math.abs(terminal.top - content.top),
      reviewGap: review ? Math.abs(reviewRegion.height - review.height) : 0,
      terminalGap: Math.abs(terminalRegion.height - terminal.height),
      content: { width: content.width, height: content.height },
    }
  }, progress)
}

function sideContentOffset(page: Page, direction: "ltr" | "rtl") {
  return page.evaluate((direction) => {
    const frame = document.querySelector('[data-slot="session-side-panel-presence"]')!.getBoundingClientRect()
    const content = document.querySelector('[data-slot="session-side-panel-content"]')!.getBoundingClientRect()

    return direction === "rtl" ? Math.abs(frame.right - content.right) : Math.abs(frame.left - content.left)
  }, direction)
}

async function expectTerminalControlsAligned(terminal: Locator, toggle: Locator) {
  await expect
    .poll(async () => {
      const centers = await Promise.all(
        [terminal.getByRole("button", { name: "New terminal", exact: true }), toggle].map((button) =>
          button.locator("svg").evaluate((element) => {
            if (!(element instanceof SVGSVGElement)) throw new Error("Expected a terminal control SVG")

            const path = element.getBBox()

            return new DOMPoint(path.x + path.width / 2, path.y + path.height / 2).matrixTransform(
              element.getScreenCTM()!,
            ).y
          }),
        ),
      )

      return centers[0]! - centers[1]!
    })
    .toBeCloseTo(0, 1)
}

// These scenarios exercise the real GUI/Client with scripted HTTP replies and native events.
// They do not simulate the owner's CAS algorithm or prove filesystem watcher/model consumption.
for (const item of [
  { kind: "skill", name: "Skill", assets: SkillAssets, shortcut: "Control+Alt+Shift+S" },
  { kind: "command", name: "Command", assets: CommandAssets, shortcut: "Control+Alt+Shift+C" },
  { kind: "prompt", name: "Prompt", assets: PromptAssets, shortcut: "Control+Alt+Shift+P" },
  { kind: "agent", name: "Agent", assets: AgentAssets, shortcut: "Control+Alt+Shift+A" },
  { kind: "mcp", name: "MCP", assets: McpAssets, shortcut: "Control+Alt+Shift+M" },
  { kind: "plugin", name: "Plugin", assets: PluginAssets, shortcut: "Control+Alt+Shift+E" },
  { kind: "workflow", name: "Workflow", assets: WorkflowAssets, shortcut: "Control+Alt+Shift+W" },
] as const) {
  test(`${item.name} proposal menu follows the session and reopens one tab`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const a = { id: "ses_menu_" + item.kind + "_a", title: item.name + " Alpha", mode: "coding" }
    const b = { id: "ses_menu_" + item.kind + "_b", title: item.name + " Beta", mode: "chat" }
    const target = { scope: "location" as const, root: "/proposal-menu/.aigcfroge/" + item.kind + "s" }
    const history = item.assets.history("menu_" + item.kind)

    const api = await SkillAssets.mock(page, {
      kind: item.kind,
      inspect: Match.value(item.kind).pipe(
        Match.when("command", () => (call: SkillAssets.Call) => CommandAssets.inspection(call, target)),
        Match.when("prompt", () => (call: SkillAssets.Call) => PromptAssets.inspection(call, target)),
        Match.orElse(() => undefined),
      ),
      apply: () => {
        throw new Error("Opening a proposal panel must not save an asset")
      },
    })

    await openSession(page, {
      name: "ProposalMenu" + item.name,
      directory: "/proposal-menu",
      sessions: [a, b],
      pageMessages: pageMessagesFrom({ [a.id]: history, [b.id]: [] }),
    })
    const title = item.name + " proposals"
    const panel = page.locator(`[data-component="${item.kind}-proposals-panel"]`)
    const tab = page.locator(`#session-side-panel-${item.kind}-proposals-tab`)
    const candidate = panel.locator('[data-component="skill-candidate"]')

    const composer = page.locator('[data-component="composer-editor"]')
    await expect(
      page.locator(
        `[data-timeline-row="UserMessage"][data-message-id="${history.find((message) => message.type === "user")?.id}"]`,
      ),
    ).toBeVisible()
    await composer.press(item.shortcut)
    await expect(panel).toBeVisible()
    await expect(candidate).toHaveCount(1)

    await openSidePanel(page, title)
    await expect(tab).toHaveCount(1)
    await page
      .locator('[data-slot="tabs-v2-trigger-wrapper"], [data-slot="tabs-trigger-wrapper"]', { has: tab })
      .getByRole("button", { name: "Close tab", exact: true })
      .click()
    await expect(panel).toBeHidden()

    await composer.press(item.shortcut)
    await expect(panel).toBeVisible()
    await expect(tab).toHaveCount(1)
    await expect(candidate).toHaveCount(1)

    await page.locator("[data-titlebar-tab-slot]", { hasText: b.title }).click()
    await expectSessionTitle(page, b.title)

    await composer.press(item.shortcut)
    await expect(panel).toContainText(
      `This session has no completed ${item.kind === "mcp" ? item.name : item.kind} proposals.`,
    )
    await expect(candidate).toHaveCount(0)
    await expect(tab).toHaveCount(1)

    await page.locator("[data-titlebar-tab-slot]", { hasText: a.title }).click()
    await expectSessionTitle(page, a.title)

    await composer.press(item.shortcut)
    await expect(candidate).toHaveCount(1)
    await expect(tab).toHaveCount(1)
    expect(api.calls).toHaveLength(0)
    expect(api.deletes).toHaveLength(0)
  })
}

test("SC06 asset draft freezes the exact cross-server side response and Location until the user sends", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 950 })
  const id = "ses_sc06_asset_same_id"
  const otherID = "ses_sc06_other_source"
  const unfinishedID = "ses_sc06_unfinished_source"
  const localDirectory = "/local/sc06-assets"
  const remoteDirectory = "/remote/sc06-assets"
  const location = { directory: remoteDirectory + "/nested", workspaceID: "wrk_sc06_asset_capture" }
  const model = { id: "sc06-asset-model", providerID: "aigcfroge" }
  const assistantID = "msg_sc06_remote_selected"
  const firstText = "SC06 remote captured response, first paragraph."
  const secondText = "SC06 remote captured response, final paragraph."

  const remoteAnswer = {
    id: assistantID,
    type: "assistant",
    agent: "plan",
    model,
    needsContinuation: false,
    time: { created: 5, completed: 6 },
    content: [
      { type: "text", text: firstText },
      { type: "reasoning", text: "SC06 private reasoning must stay out of the draft" },
      Object.assign(
        { type: "text" as const, text: "SC06 synthetic text must stay out of the draft" },
        { synthetic: true },
      ),
      Object.assign({ type: "text" as const, text: "SC06 ignored text must stay out of the draft" }, { ignored: true }),
      { type: "text", text: secondText },
    ],
  } satisfies SessionMessageInfo

  const remoteMessages: Record<string, SessionMessageInfo[]> = {}

  remoteMessages[id] = [
    { id: "msg_sc06_remote_old_user", type: "user", text: "Earlier remote question", time: { created: 1 } },
    {
      id: "msg_sc06_remote_other_assistant",
      type: "assistant",
      agent: "plan",
      model,
      needsContinuation: false,
      time: { created: 2, completed: 3 },
      content: [{ type: "text", text: "SC06 other assistant must stay out of the draft" }],
    },
    { id: "msg_sc06_remote_selected_user", type: "user", text: "Selected remote question", time: { created: 4 } },
    remoteAnswer,
  ]
  const creates: { server: string; body: Schema.JsonObject }[] = []
  const prompts: { server: string; sessionID: string; body: Schema.JsonObject }[] = []
  const generated: unknown[] = []
  const writes: unknown[] = []
  const remoteStatus = { [id]: { type: "idle" } }
  const localStatus = { [id]: { type: "idle" }, [otherID]: { type: "idle" }, [unfinishedID]: { type: "idle" } }
  const target = { scope: "project" as const, root: remoteDirectory + "/.aigcfroge/skills" }
  const body = SkillAssets.body("CapturedReview")

  const api = await SkillAssets.mock(page, {
    inspect: () => ({ status: 200, json: { ...SkillAssets.facts(), target } }),
    apply: () => ({ status: 200, json: { ...SkillAssets.info("a", body.content, target), name: body.name } }),
  })

  const remote = await mockRemoteServer(page, {
    name: "SC06 remote asset server",
    directory: remoteDirectory,
    project: project({ id: "proj_sc06_remote_assets", directory: remoteDirectory }),
    worktrees: [{ projectID: "proj_sc06_remote_assets", directory: location.directory, name: "nested" }],
    provider: provider({ id: model.id, name: "SC06 remote asset model" }),
    sessions: [
      session({
        id,
        directory: location.directory,
        location,
        projectID: "proj_sc06_remote_assets",
        title: "SC06 remote source",
        mode: "work",
        agent: "plan",
        model,
      }),
    ],
    pageMessages: pageMessagesFrom(remoteMessages),
    sessionStatus: remoteStatus,
    onSessionCreate: (request) => void creates.push({ server: REMOTE_SERVER, body: request }),
    onPrompt: (request) => {
      prompts.push({ server: REMOTE_SERVER, ...request })
      const userID = Schema.decodeUnknownSync(Schema.String)(request.body.id)
      const text = Schema.decodeUnknownSync(Schema.String)(request.body.text)
      remoteMessages[request.sessionID] = SkillAssets.history("sc06_sent", body, {
        ...SkillAssets.facts(),
        target,
      }).map((message) => {
        if (message.type === "user") return { ...message, id: userID, text }

        if (message.type === "assistant") return { ...message, metadata: { ...message.metadata, parentID: userID } }

        return message
      })
    },
    generate: (request) => {
      generated.push(request)

      return { text: "Unexpected generated text" }
    },
    onFileWrite: (request) => void writes.push(request),
  })

  const local = await openSession(page, {
    name: "SC06AssetCapture",
    directory: localDirectory,
    sessions: [
      { id, title: "SC06 local source", mode: "coding", agent: "build", model },
      { id: otherID, title: "SC06 other Chat source", mode: "chat", agent: "build", model },
      { id: unfinishedID, title: "SC06 unfinished source", mode: "coding", agent: "build", model },
    ],
    provider: provider({ id: model.id, name: "SC06 local asset model" }),
    pageMessages: pageMessagesFrom({
      [id]: [
        { id: "msg_sc06_local_old_user", type: "user", text: "Earlier local question", time: { created: 1 } },
        {
          id: "msg_sc06_local_old_answer",
          type: "assistant",
          agent: "build",
          model,
          needsContinuation: false,
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: "SC06 earlier local response" }],
        },
        { id: "msg_sc06_local_user", type: "user", text: "Local question", time: { created: 4 } },
        {
          id: "msg_sc06_local_answer",
          type: "assistant",
          agent: "build",
          model,
          needsContinuation: false,
          time: { created: 5, completed: 6 },
          content: [{ type: "text", text: "SC06 local response must stay on its own server" }],
        },
      ],
      [otherID]: [
        { id: "msg_sc06_chat_user", type: "user", text: "Chat question", time: { created: 1 } },
        {
          id: "msg_sc06_chat_answer",
          type: "assistant",
          agent: "build",
          model,
          needsContinuation: false,
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: "SC06 Chat response has no ordinary asset capture" }],
        },
      ],
      [unfinishedID]: [
        { id: "msg_sc06_unfinished_user", type: "user", text: "Unfinished question", time: { created: 1 } },
        {
          id: "msg_sc06_unfinished_answer",
          type: "assistant",
          agent: "build",
          model,
          time: { created: 2 },
          content: [{ type: "text", text: "SC06 unfinished response has no asset capture" }],
        },
      ],
    }),
    sessionStatus: localStatus,
    onSessionCreate: (request) => void creates.push({ server: SERVER, body: request }),
    onPrompt: (request) => void prompts.push({ server: SERVER, ...request }),
    generate: (request) => {
      generated.push(request)

      return { text: "Unexpected generated text" }
    },
    onFileWrite: (request) => void writes.push(request),
    seed: { tabs: [id, otherID, unfinishedID, { session: id, server: REMOTE_SERVER }] },
  })

  const localText = page.locator('[data-component="text-part"]', {
    hasText: "SC06 local response must stay on its own server",
  })

  await localText.hover()
  await expect(localText.getByRole("button", { name: "Save as asset", exact: true })).toBeEnabled()
  await localText.getByRole("button", { name: "Save as asset", exact: true }).click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(page.locator('[data-component="composer-editor"]')).toContainText(`Source session: ${id}`)
  await expect(page.locator('[data-component="composer-editor"]')).toContainText(
    "SC06 local response must stay on its own server",
  )
  expect(creates).toEqual([])
  expect(prompts).toEqual([])
  await page.goto(sessionHref(id))
  const earlier = page.locator('[data-component="text-part"]', { hasText: "SC06 earlier local response" })
  await earlier.hover()
  await expect(earlier.getByRole("button", { name: "Save as asset", exact: true })).toHaveCount(0)
  await attachSession(page, { server: REMOTE_SERVER, sessionID: id, title: "SC06 remote source" })
  const side = page.getByRole("region", { name: "Session views", exact: true })
  const selected = side.locator('[data-component="text-part"]', { hasText: secondText })
  await selected.hover()
  await expect(selected.getByRole("button", { name: "Save as asset", exact: true })).toBeEnabled()
  remoteStatus[id].type = "running"
  await remote.push([
    {
      id: "evt_sc06_remote_busy",
      created: 1700000000090,
      type: "session.execution.started",
      location,
      durable: { aggregateID: id, seq: 90, version: 1 },
      data: { sessionID: id },
    },
  ])
  await expect(selected.getByRole("button", { name: "Save as asset", exact: true })).toHaveCount(0)
  localStatus[id].type = "running"
  await local.push([
    {
      id: "evt_sc06_local_busy",
      created: 1700000000091,
      type: "session.execution.started",
      location: { directory: localDirectory },
      durable: { aggregateID: id, seq: 90, version: 1 },
      data: { sessionID: id },
    },
  ])
  remoteStatus[id].type = "idle"
  await remote.push([
    {
      id: "evt_sc06_remote_idle",
      created: 1700000000092,
      type: "session.execution.succeeded",
      location,
      durable: { aggregateID: id, seq: 91, version: 1 },
      data: { sessionID: id },
    },
  ])
  await selected.hover()
  await expect(selected.getByRole("button", { name: "Save as asset", exact: true })).toBeEnabled()
  expect(creates).toEqual([])
  expect(prompts).toEqual([])
  expect(generated).toEqual([])
  expect(api.calls).toEqual([])
  await selected.getByRole("button", { name: "Save as asset", exact: true }).click()
  const lateText = "SC06 new remote output after capture must not replace the saved response"
  remoteAnswer.content[4] = { type: "text", text: lateText }
  await remote.push([
    {
      id: "evt_sc06_late_remote_text",
      created: 1700000010000,
      type: "session.text.ended",
      location,
      durable: { aggregateID: id, seq: 100, version: 1 },
      data: { sessionID: id, assistantMessageID: assistantID, ordinal: 3, text: lateText },
    },
  ])
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  const draftURL = page.url()
  const editor = page.locator('[data-component="composer-editor"]')
  const expected = `Turn the captured response into a reusable asset. Choose the appropriate proposal tool: propose_skill_asset, propose_command_asset, propose_prompt_asset, propose_agent_asset, propose_mcp_asset, propose_plugin_asset, or propose_workflow_asset. Create a proposal for review.\n\nSource server: ${REMOTE_SERVER}\nSource session: ${id}\nSource assistant: ${assistantID}\nSource content: ${assistantID}:text:3\nSource Location: ${JSON.stringify(location)}\n\nCaptured response:\n${firstText}\n\n${secondText}`
  await expect(editor).toBeEditable()
  await expect(editor).toHaveJSProperty("textContent", expected)
  expect(creates).toEqual([])
  expect(prompts).toEqual([])
  expect(generated).toEqual([])
  expect(writes).toEqual([])
  expect(api.calls).toEqual([])
  await page.screenshot({ path: testInfo.outputPath("sc06-exact-remote-asset-draft.png") })
  await page.locator("[data-titlebar-tab-slot]", { hasText: "SC06 other Chat source" }).click()
  await expectSessionTitle(page, "SC06 other Chat source")

  const chatText = page.locator('[data-component="text-part"]', {
    hasText: "SC06 Chat response has no ordinary asset capture",
  })

  await chatText.hover()
  await expect(chatText.getByRole("button", { name: "Save as asset", exact: true })).toHaveCount(0)
  await page.locator("[data-titlebar-tab-slot]", { hasText: "SC06 unfinished source" }).click()
  await expectSessionTitle(page, "SC06 unfinished source")

  const unfinished = page.locator('[data-component="text-part"]', {
    hasText: "SC06 unfinished response has no asset capture",
  })

  await unfinished.hover()
  await expect(unfinished.getByRole("button", { name: "Save as asset", exact: true })).toHaveCount(0)
  await page.goto(draftURL)
  await expect(editor).toHaveJSProperty("textContent", expected)
  const edit = " User edit: create a review skill candidate for this captured response."
  const edited = expected + edit
  await editor.press("ControlOrMeta+End")
  await editor.pressSequentially(edit)

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === "/api/session",
  )

  const promptResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      /^\/api\/session\/[^/]+\/prompt$/.test(new URL(response.url()).pathname),
  )

  await editor.press("Enter")
  expect((await createResponse).status()).toBe(200)
  expect((await promptResponse).status()).toBe(200)
  expect(creates).toHaveLength(1)
  expect(creates[0]).toMatchObject({ server: REMOTE_SERVER, body: { mode: "chat", location } })
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatchObject({ server: REMOTE_SERVER, body: { text: edited } })
  const savedID = Schema.decodeUnknownSync(Schema.String)(creates[0]?.body.id)
  expect(prompts[0]?.sessionID).toBe(savedID)
  await expectPath(page, sessionHref(savedID, REMOTE_SERVER))
  await page.reload()
  await expectSessionTitle(page, "New session")
  await openSidePanel(page, "Skill proposals")
  const panel = page.locator('[data-component="skill-proposals-panel"]')
  await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(body.content)
  expect(api.calls).toEqual([])
  await panel.getByRole("button", { name: "Review save", exact: true }).click()
  const confirmation = panel.getByRole("group", { name: "Confirm skill save", exact: true })
  await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
  expect(api.calls).toEqual([])
  await confirmation.getByRole("button", { name: "Save skill", exact: true }).click()
  await expect(panel.locator('[data-component="skill-save-result"]')).toBeVisible()
  expect(api.calls).toHaveLength(1)
  expect(api.calls[0]?.sessionID).toBe(savedID)
  expect(api.calls[0]?.url.origin).toBe(REMOTE_SERVER)
  expect(api.calls[0]?.url.searchParams.get("directory")).toBe(location.directory)
  expect(api.calls[0]?.url.searchParams.get("workspace")).toBe(location.workspaceID)
  expect(prompts).toHaveLength(1)
  expect(generated).toEqual([])
  expect(writes).toEqual([])
})

test.describe("basic Skill proposal panel", () => {
  test("requires confirmation and exposes the saved native Skill through the existing composer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_skill_gui_fresh"
    const body = SkillAssets.body()
    const target = { scope: "project" as const, root: "/skill/.aigcfroge/skills" }
    const result = SkillAssets.info("a", undefined, target)

    const skills: SkillInfo[] = [
      {
        id: "Review",
        name: result.name,
        description: result.description,
        content: result.content,
        path: "/another/.aigcfroge/skills/Review.md",
      },
    ]

    const prompts: { sessionID: string; body: unknown }[] = []

    const api = await SkillAssets.mock(page, {
      inspect: () => ({ status: 200, json: { ...SkillAssets.facts(), target } }),
      apply: () => ({ status: 200, json: result }),
    })

    const workspace = await openSession(page, {
      name: "SkillGui",
      directory: "/skill/gui",
      sessions: [{ id: sessionID, title: "Skill GUI" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: SkillAssets.history("fresh", body, {
          ...SkillAssets.facts(),
          target,
          truncated: true,
          outputPath: "/tmp/skill-result.txt",
        }),
      }),
      skills: () => skills,
      onPrompt: (input) => void prompts.push(input),
    })

    const panel = page.locator('[data-component="skill-proposals-panel"]')
    await openSidePanel(page, "Skill proposals")
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-component="tool-part-wrapper"]')).toBeVisible()
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(body.content)
    await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(panel).toContainText(target.root)
    expect(api.inspections[0]?.body).toMatchObject({ scope: "project" })
    expect(api.calls).toHaveLength(0)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel.getByRole("group", { name: "Confirm skill save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(0)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save skill", exact: true }).click()
    const saved = panel.locator('[data-component="skill-save-result"]')
    await expect(saved).toBeVisible()
    await expect(saved).toContainText("Saved. This version is not yet visible in the current session.")
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(sessionID)
    expect(api.calls[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.calls[0]?.url.searchParams.has("workspace")).toBe(false)
    expect(api.calls[0]?.body).toEqual({
      candidate: { ...body, relativePath: "Review.md", triggers: [], tags: [] },
      target,
      overwrite: false,
    })

    skills[0] = {
      id: "Review",
      name: result.name,
      description: result.description,
      content: result.content,
      path: target.root + "/Review.md",
    }
    const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/skill")
    await workspace.push([
      {
        id: "evt_skill_gui_ready",
        created: 4,
        type: "skill.updated",
        location: { directory: workspace.directory },
        data: {},
      },
    ])
    expect((await refresh).status()).toBe(200)
    await expect(saved).toContainText("Available in this session as @Review. Choose it from the composer.")

    await workspace.editor.fill("@Review")
    const suggestion = page.locator('[data-component="composer-suggestions"] [data-suggestion-id="skill:Review"]')
    await expect(suggestion).toBeVisible()
    await suggestion.click()
    await workspace.editor.press("End")
    await page.keyboard.type(" Use this skill")
    await workspace.editor.press("Enter")
    await expect.poll(() => prompts.length).toBe(1)
    expect(prompts[0]?.sessionID).toBe(sessionID)
    expect(prompts[0]?.body).toMatchObject({ skills: [{ id: "Review", name: body.name }] })

    await page.reload()
    await expectSessionTitle(page, "Skill GUI")
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(body.content)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeVisible()
    await expect(panel.locator('[data-component="skill-save-confirm"]')).toHaveCount(0)
    expect(api.calls).toHaveLength(1)
  })

  test("rechecks canceled confirmations and keeps global replacement in the selected target", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_skill_gui_targets"
    const location = { directory: "/skill/targets/nested", workspaceID: "wrk_skill_targets" }
    const project = { scope: "project" as const, root: "/skill/targets/.aigcfroge/skills" }
    const shared = { scope: "global" as const, root: "/skill/config/skills" }
    const moved = { scope: "global" as const, root: "/skill/config/moved/skills" }
    const current = SkillAssets.info("b", "Current global content", moved)
    const candidate = { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] }

    const api = await SkillAssets.mock(page, {
      inspect: (_call, attempt) => ({
        status: 200,
        json: {
          ...SkillAssets.facts(),
          target: attempt <= 2 ? project : attempt <= 4 ? shared : moved,
          exists: attempt > 4,
          revision: attempt > 4 ? "a".repeat(64) : null,
          nameConflict: attempt >= 7,
        },
      }),
      catalog: () => ({ assets: [current], invalid: [], target: moved }),
      content: () => ({ status: 200, json: current }),
      apply: (_call, attempt) =>
        attempt === 1
          ? {
              status: 409,
              json: new ConflictError({ resource: "Review.md", message: "Global target changed" }),
            }
          : { status: 200, json: SkillAssets.info("c", undefined, moved) },
    })

    await openSession(page, {
      name: "SkillTargets",
      directory: location.directory,
      sessions: [{ id: sessionID, title: "Skill targets", location }],
      pageMessages: pageMessagesFrom({
        [sessionID]: SkillAssets.history("targets", SkillAssets.body(), { ...SkillAssets.facts(), target: project }),
      }),
    })
    await openSidePanel(page, "Skill proposals")
    const panel = page.locator('[data-component="skill-proposals-panel"]')
    const confirmation = panel.getByRole("group", { name: "Confirm skill save", exact: true })
    const replacement = panel.getByRole("group", { name: "Confirm skill replacement", exact: true })
    await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByText(project.root, { exact: true })).toBeVisible()
    await expect(panel.getByText("New file at the last check", { exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Legacy location", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(1)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(2)
    await panel.getByRole("button", { name: "Global", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Global", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    await expect(confirmation).toHaveCount(0)
    expect(api.inspections).toHaveLength(3)
    expect(api.calls).toHaveLength(0)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation).toContainText("Save this skill in the global directory shown above?")
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(4)
    expect(api.calls).toHaveLength(0)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
    await expect(panel.getByText(moved.root, { exact: true })).toBeVisible()
    await expect(panel.getByText(shared.root, { exact: true })).toHaveCount(0)
    await expect(panel.getByText("Existing file at the last check", { exact: true })).toBeVisible()
    expect(api.inspections).toHaveLength(5)
    expect(api.calls).toHaveLength(0)

    await confirmation.getByRole("button", { name: "Save skill", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveText(current.content)
    await expect(replacement.getByRole("button", { name: "Replace skill", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
    expect(api.reads).toHaveLength(2)
    await replacement.getByRole("button", { name: "Replace skill", exact: true }).click()
    await expect(panel.locator('[data-component="skill-save-result"]')).toContainText(
      "Saved. This version is not yet visible in the current session.",
    )
    await panel.getByRole("button", { name: "Recheck target", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(6)
    expect(api.calls).toHaveLength(2)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel).toContainText("Another file uses this skill name. Ask for a new proposal with another name.")
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeDisabled()
    await expect(confirmation).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Save skill", exact: true })).toHaveCount(0)
    expect(api.calls).toHaveLength(2)
    expect(api.calls.map((call) => call.body)).toEqual([
      { candidate, target: moved, baseRevision: "a".repeat(64), overwrite: false },
      { candidate, target: moved, baseRevision: current.revision, overwrite: true },
    ])
    expect(api.inspections.map((call) => call.body)).toEqual(
      ["project", "project", "global", "global", "global", "global", "global"].map((scope) => ({ candidate, scope })),
    )
    expect([...api.inspections, ...api.calls].every((call) => call.sessionID === sessionID)).toBe(true)
    expect(
      [...api.inspections, ...api.calls].every(
        (call) =>
          call.url.searchParams.get("directory") === location.directory &&
          call.url.searchParams.get("workspace") === location.workspaceID,
      ),
    ).toBe(true)
    expect(
      api.reads.every(
        (url) =>
          url.searchParams.get("directory") === location.directory &&
          url.searchParams.get("workspace") === location.workspaceID &&
          url.searchParams.get("scope") === "global",
      ),
    ).toBe(true)
    expect(api.reads.map((url) => url.pathname).sort()).toEqual(["/skill-asset", "/skill-asset/content"])
    expect(api.reads.find((url) => url.pathname === "/skill-asset/content")?.searchParams.get("path")).toBe("Review.md")
  })

  for (const scenario of ["project-global-project", "same-scope recheck"] as const) {
    test("does not revive a canceled confirmation after late inspect: " + scenario, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_skill_inspect_" + scenario.replaceAll(/[- ]/g, "_")
      const project = { scope: "project" as const, root: "/skill/inspect/.aigcfroge/skills" }
      const shared = { scope: "global" as const, root: "/skill/inspect/global/skills" }
      const stale = { scope: "project" as const, root: "/skill/inspect/stale/skills" }
      const current = { scope: "project" as const, root: "/skill/inspect/current/skills" }
      const late = Promise.withResolvers<SkillAssets.Reply>()
      const latest = Promise.withResolvers<SkillAssets.Reply>()
      const currentAttempt = scenario === "project-global-project" ? 4 : 3

      const fresh = {
        status: 200,
        json: { ...SkillAssets.facts(), exists: true, revision: "b".repeat(64), target: current },
      }

      const api = await SkillAssets.mock(page, {
        inspect: (_call, attempt) => {
          if (attempt === 1) return { status: 200, json: { ...SkillAssets.facts(), target: project } }

          if (attempt === 2) return late.promise

          if (attempt === currentAttempt) return latest.promise

          if (attempt > currentAttempt) return fresh

          return { status: 200, json: { ...SkillAssets.facts(), target: shared } }
        },
        apply: () => {
          throw new Error("A canceled inspection must not save")
        },
      })

      await openSession(page, {
        name: "SkillInspect",
        directory: "/skill/inspect/nested",
        sessions: [{ id: sessionID, title: "Skill inspection" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: SkillAssets.history("inspect", SkillAssets.body(), { ...SkillAssets.facts(), target: project }),
        }),
      })
      await openSidePanel(page, "Skill proposals")
      const panel = page.locator('[data-component="skill-proposals-panel"]')
      const confirmation = panel.getByRole("group", { name: "Confirm skill save", exact: true })
      await expect(panel.getByText(project.root, { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()

      try {
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect.poll(() => api.inspections.length).toBe(2)
        await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)
        await expect(panel.getByRole("button", { name: "Save skill", exact: true })).toHaveCount(0)
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)

        if (scenario === "project-global-project") {
          await panel.getByRole("button", { name: "Global", exact: true }).click()
          await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
          await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
          await panel.getByRole("button", { name: "Project", exact: true }).click()
        }

        if (scenario === "same-scope recheck")
          await panel.getByRole("button", { name: "Recheck target", exact: true }).click()

        await expect.poll(() => api.inspections.length).toBe(currentAttempt)
        await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        )
        await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)
        await expect(panel.getByRole("button", { name: "Save skill", exact: true })).toHaveCount(0)
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)
        expect(api.calls).toHaveLength(0)

        latest.resolve(fresh)
        await expect.poll(() => api.inspectionReplies.length).toBe(currentAttempt - 1)
        await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
        await expect(panel.getByText("Existing file at the last check", { exact: true })).toBeVisible()
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
        await expect(confirmation).toHaveCount(0)
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
        expect(api.inspections).toHaveLength(currentAttempt + 1)
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      } finally {
        latest.resolve(fresh)
        late.resolve({ status: 200, json: { ...SkillAssets.facts(), target: stale } })
      }

      await expect.poll(() => api.inspectionReplies.length).toBe(currentAttempt + 1)
      await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(stale.root, { exact: true })).toHaveCount(0)
      await expect(panel.getByText("Existing file at the last check", { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(confirmation).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Save skill", exact: true })).toHaveCount(0)
      expect(api.calls).toHaveLength(0)
      expect(api.inspections.map((call) => call.body)).toEqual(
        (scenario === "project-global-project"
          ? ["project", "project", "global", "project", "project"]
          : ["project", "project", "project", "project"]
        ).map((scope) => ({
          candidate: { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] },
          scope,
        })),
      )
    })
  }

  for (const scenario of ["apply", "catalog", "content"] as const) {
    test("drops a late " + scenario + " reply after selecting another skill target", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_skill_target_late_" + scenario
      const project = { scope: "project" as const, root: "/skill/late/.aigcfroge/skills" }
      const shared = { scope: "global" as const, root: "/skill/late/global/skills" }
      const current = SkillAssets.info("b", "Earlier project content", project)
      const reply = Promise.withResolvers<SkillAssets.Reply>()
      const catalog = Promise.withResolvers<SkillAssetListOutput>()

      const api = await SkillAssets.mock(page, {
        inspect: (_call, attempt) => ({
          status: 200,
          json: { ...SkillAssets.facts(), target: attempt <= 2 ? project : shared },
        }),
        catalog: () => (scenario === "catalog" ? catalog.promise : { assets: [current], invalid: [], target: project }),
        content: () => (scenario === "content" ? reply.promise : { status: 200, json: current }),
        apply: (_call, attempt) => {
          if (attempt > 1) return { status: 200, json: SkillAssets.info("c", undefined, shared) }

          if (scenario === "apply") return reply.promise

          return { status: 409, json: new ConflictError({ resource: "Review.md", message: "Project target changed" }) }
        },
      })

      await openSession(page, {
        name: "SkillTargetLate",
        directory: "/skill/late/nested",
        sessions: [{ id: sessionID, title: "Late target reply" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: SkillAssets.history("late_target", SkillAssets.body(), {
            ...SkillAssets.facts(),
            target: project,
          }),
        }),
      })
      await openSidePanel(page, "Skill proposals")
      const panel = page.locator('[data-component="skill-proposals-panel"]')
      const confirmation = panel.getByRole("group", { name: "Confirm skill save", exact: true })
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()

      try {
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await confirmation.getByRole("button", { name: "Save skill", exact: true }).click()
        await expect.poll(() => api.calls.length).toBe(1)
        await expect.poll(() => api.reads.length).toBe(scenario === "apply" ? 0 : 2)
        await expect(
          panel.getByText(scenario === "apply" ? "Saving skill…" : "Reading the current skill…", { exact: true }),
        ).toBeVisible()
        await panel.getByRole("button", { name: "Global", exact: true }).click()
        await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
        await expect(confirmation).toHaveCount(0)
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
        await expect(confirmation).toContainText("Save this skill in the global directory shown above?")
      } finally {
        reply.resolve({ status: 200, json: scenario === "apply" ? SkillAssets.info("a", undefined, project) : current })
        catalog.resolve({ assets: [current], invalid: [], target: project })
      }

      await expect.poll(() => api.replies.length).toBe(1)
      await expect.poll(() => api.readReplies.length).toBe(scenario === "apply" ? 0 : 2)
      await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(project.root, { exact: true })).toHaveCount(0)
      await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
      await expect(panel.locator('[data-component="skill-save-result"]')).toHaveCount(0)
      await expect(panel.getByRole("group", { name: "Confirm skill replacement", exact: true })).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      expect(api.inspections).toHaveLength(4)
      await confirmation.getByRole("button", { name: "Save skill", exact: true }).click()
      await expect(panel.locator('[data-component="skill-save-result"]')).toContainText(
        "Saved. This version is not yet visible in the current session.",
      )
      expect(api.calls.map((call) => call.body)).toEqual(
        [project, shared].map((target) => ({
          candidate: { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] },
          target,
          overwrite: false,
        })),
      )
      expect(
        [...api.inspections, ...api.calls].every(
          (call) =>
            call.sessionID === sessionID &&
            call.url.searchParams.get("directory") === "/skill/late/nested" &&
            !call.url.searchParams.has("workspace"),
        ),
      ).toBe(true)
      expect(
        api.reads.every(
          (url) =>
            url.searchParams.get("directory") === "/skill/late/nested" && url.searchParams.get("scope") === "project",
        ),
      ).toBe(true)
    })
  }

  test("SC06 historical tool actions locate exact candidates and retain canceled or conflicted reviews", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_skill_target_mismatch"
    const sourceID = "ses_sc06_proposal_source_a"
    const sourceTitle = "SC06 proposal source A"
    const targetTitle = "SC06 historical remote B"
    const location = { directory: "/skill/mismatch/nested", workspaceID: "wrk_sc06_historical_remote" }
    const before = { scope: "project" as const, root: "/skill/mismatch/before/skills" }
    const after = { scope: "project" as const, root: "/skill/mismatch/after/skills" }
    const recheck = Promise.withResolvers<SkillAssets.Reply>()
    const fresh = { status: 200, json: { ...SkillAssets.facts(), target: after } }

    const original = SkillAssets.history("target_mismatch", SkillAssets.body(), {
      ...SkillAssets.facts(),
      target: before,
    })

    const originalUser = original.find((message) => message.type === "user")
    const originalAssistant = original.find((message) => message.type === "assistant")
    const promptBody = { ...PromptAssets.body(), name: "HistoricalPrompt" }
    const promptTarget = { scope: "project" as const, root: "/skill/mismatch/prompts" }

    const promptAssistant = PromptAssets.history("sc06_old_prompt", promptBody, {
      ...SkillAssets.facts("HistoricalPrompt.md"),
      target: promptTarget,
    }).find((message) => message.type === "assistant")

    if (!originalUser || !originalAssistant || !promptAssistant)
      throw new Error("Completed tool proposal fixtures must include a User and both Assistants")

    const latest = SkillAssets.history(
      "sc06_latest_candidate",
      {
        ...SkillAssets.body("LatestReview"),
        content: "SC06 latest candidate must not replace the selected historical candidate",
      },
      { ...SkillAssets.facts("LatestReview.md"), target: before },
    )

    const messages: SessionMessageInfo[] = [
      originalUser,
      {
        id: "msg_sc06_historical_text",
        type: "assistant",
        metadata: { parentID: originalUser.id },
        agent: originalAssistant.agent,
        model: originalAssistant.model,
        needsContinuation: true,
        time: { created: 2, completed: 3 },
        content: [{ type: "text", text: "SC06 old response whose proposals finished in a later Assistant" }],
      },
      {
        ...originalAssistant,
        needsContinuation: false,
        time: { created: 4, completed: 5 },
        content: [...originalAssistant.content, ...promptAssistant.content].map((content) =>
          content.type === "tool" ? { ...content, time: { created: 4, completed: 5 } } : content,
        ),
      },
      ...latest.map((message) => ({
        ...message,
        time: message.type === "user" ? { created: 6 } : { created: 7, completed: 8 },
      })),
    ]

    const generated: unknown[] = []
    const used: unknown[] = []

    const promptApi = await PromptAssets.mock(page, {
      inspect: (call) => PromptAssets.inspection(call, promptTarget),
      apply: () => {
        throw new Error("Opening the Prompt candidate must not save it")
      },
    })

    const api = await SkillAssets.mock(page, {
      inspect: (_call, attempt) => {
        if (attempt === 5) return recheck.promise

        return attempt > 5 ? fresh : { status: 200, json: { ...SkillAssets.facts(), target: before } }
      },
      apply: (_call, attempt) =>
        attempt === 1
          ? {
              status: 400,
              json: new InvalidRequestError({
                message: "Project target changed",
                field: "target",
                kind: "target_mismatch",
              }),
            }
          : { status: 200, json: SkillAssets.info("b", undefined, after) },
    })

    await mockRemoteServer(page, {
      name: "SC06 historical proposal server",
      directory: "/skill/mismatch",
      provider: provider(),
      sessions: [session({ id: sessionID, title: targetTitle, directory: location.directory, location, mode: "chat" })],
      pageMessages: pageMessagesFrom({ [sessionID]: messages }),
      onPrompt: (request) => void used.push(request),
      generate: (request) => {
        generated.push(request)

        return { text: "Unexpected model work" }
      },
    })
    await openSession(page, {
      name: "SkillTargetMismatch",
      directory: "/skill/sc06/source",
      sessions: [{ id: sourceID, title: sourceTitle, mode: "coding" }],
      pageMessages: pageMessagesFrom({
        [sourceID]: [
          {
            id: "msg_sc06_proposal_source_user",
            type: "user",
            text: "SC06 source A keeps its main conversation",
            time: { created: 1 },
          },
        ],
      }),
      onPrompt: (request) => void used.push(request),
      generate: (request) => {
        generated.push(request)

        return { text: "Unexpected model work" }
      },
      seed: { tabs: [sourceID, { session: sessionID, server: REMOTE_SERVER }] },
    })
    await attachSession(page, { server: REMOTE_SERVER, sessionID, title: targetTitle })
    const side = page.getByRole("region", { name: "Session views", exact: true })

    const text = side.locator('[data-component="text-part"]', {
      hasText: "SC06 old response whose proposals finished in a later Assistant",
    })

    await text.hover()
    await expect(text.getByRole("button", { name: "Save as asset", exact: true })).toHaveCount(0)
    await text.getByRole("button", { name: "Prompt proposals", exact: true }).click()
    const promptPanel = page.locator('[data-component="prompt-proposals-panel"]')
    await expect(promptPanel.locator('[data-component="skill-candidate"] > pre')).toHaveText(promptBody.template)
    expect(promptApi.calls).toHaveLength(0)
    expect(generated).toHaveLength(0)
    expect(used).toHaveLength(0)
    await page
      .locator("#review-panel")
      .getByRole("tab", { name: `${targetTitle} · ${REMOTE_SERVER}`, exact: true })
      .click()
    await text.hover()
    await text.getByRole("button", { name: "Skill proposals", exact: true }).click()
    const panel = page.locator('[data-component="skill-proposals-panel"]')
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(SkillAssets.body().content)
    await expect(panel.getByRole("button", { name: "LatestReview", exact: true })).toBeVisible()
    await expectPath(page, sessionHref(sourceID))
    await expectSessionTitle(page, sourceTitle)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(1)
    const promptTab = page.locator("#review-panel").getByRole("tab", { name: "Prompt proposals", exact: true })
    await promptTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
    await expect(promptTab).toHaveCount(0)

    const sideTab = page.locator(
      `[id="session-side-panel-view-tab-${encodeURIComponent(`${SERVER}\n${sourceID}`)}-session-${encodeURIComponent(`${REMOTE_SERVER}\n${sessionID}`)}"]`,
    )

    await sideTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
    await expect(sideTab).toHaveCount(0)
    await expect(side).toHaveCount(0)
    const targetShell = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sessionID, REMOTE_SERVER)}"])`)
    await targetShell.getByRole("button", { name: "Close tab", exact: true }).click()
    await expect(targetShell).toHaveCount(0)
    await expectPath(page, sessionHref(sourceID))
    expect(api.calls).toHaveLength(0)
    expect(promptApi.calls).toHaveLength(0)
    expect(generated).toHaveLength(0)
    expect(used).toHaveLength(0)

    const restoredSession = page.waitForResponse((response) => {
      const url = new URL(response.url())

      return (
        response.request().method() === "GET" &&
        url.origin === REMOTE_SERVER &&
        url.pathname === `/api/session/${sessionID}`
      )
    })

    const restoredMessages = page.waitForResponse((response) => {
      const url = new URL(response.url())

      return (
        response.request().method() === "GET" &&
        url.origin === REMOTE_SERVER &&
        url.pathname === `/api/session/${sessionID}/message`
      )
    })

    await page.reload()
    expect((await restoredSession).status()).toBe(200)
    expect((await restoredMessages).status()).toBe(200)
    await expectPath(page, sessionHref(sourceID))
    await expectSessionTitle(page, sourceTitle)
    await expect(targetShell).toHaveCount(0)
    await expect(sideTab).toHaveCount(0)
    await expect(side).toHaveCount(0)
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(SkillAssets.body().content)
    await expect(panel.getByRole("button", { name: "LatestReview", exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(2)
    expect(api.calls).toHaveLength(0)
    expect(promptApi.calls).toHaveLength(0)
    expect(generated).toHaveLength(0)
    expect(used).toHaveLength(0)
    const confirmation = panel.getByRole("group", { name: "Confirm skill save", exact: true })
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(SkillAssets.body().content)
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await confirmation.getByRole("button", { name: "Save skill", exact: true }).click()
    await expect(panel).toContainText(
      "The target directory changed. Recheck the target and confirm it again before saving.",
    )
    await expect(panel.getByRole("button", { name: "Review again", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Save skill", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Recheck target", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
    expect(api.inspections).toHaveLength(4)
    expect(api.reads).toHaveLength(0)

    try {
      await panel.getByRole("button", { name: "Recheck target", exact: true }).click()
      await expect.poll(() => api.inspections.length).toBe(5)
      await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
      await expect(confirmation).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Save skill", exact: true })).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      recheck.resolve(fresh)
      await expect.poll(() => api.inspectionReplies.length).toBe(5)
      await expect(panel.getByText(after.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(before.root, { exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(confirmation).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await expect(confirmation.getByRole("button", { name: "Save skill", exact: true })).toBeEnabled()
      expect(api.inspections).toHaveLength(6)
      expect(api.calls).toHaveLength(1)
      await confirmation.getByRole("button", { name: "Save skill", exact: true }).click()
      await expect(panel.locator('[data-component="skill-save-result"]')).toContainText(
        "Saved. This version is not yet visible in the current session.",
      )
    } finally {
      recheck.resolve(fresh)
    }

    expect(api.calls.map((call) => call.body)).toEqual(
      [before, after].map((target) => ({
        candidate: { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] },
        target,
        overwrite: false,
      })),
    )
    expect(api.reads).toHaveLength(0)
    expect(
      [...api.inspections, ...api.calls].every(
        (call) =>
          call.sessionID === sessionID &&
          call.url.origin === REMOTE_SERVER &&
          call.url.searchParams.get("directory") === location.directory &&
          call.url.searchParams.get("workspace") === location.workspaceID,
      ),
    ).toBe(true)
    expect(promptApi.calls).toHaveLength(0)
    expect(used).toHaveLength(0)
    expect(generated).toHaveLength(0)
  })

  test("requires a separate replacement confirmation for every current revision", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_skill_gui_overwrite"
    const target = { scope: "location" as const, root: "/skill/overwrite/.aigcfroge/skills" }
    const current = { value: SkillAssets.info("b", "Peer content B", target) }
    const result = SkillAssets.info("e", undefined, target)

    const api = await SkillAssets.mock(page, {
      inspect: () => ({
        status: 200,
        json: { ...SkillAssets.facts(), exists: true, revision: "a".repeat(64), target },
      }),
      catalog: () => ({ assets: [current.value], invalid: [], target }),
      content: () => ({ status: 200, json: current.value }),
      apply: (_call, attempt) => {
        if (attempt === 2) current.value = SkillAssets.info("c", "Peer content C", target)

        if (attempt === 3) current.value = SkillAssets.info("d", "Peer content D", target)

        if (attempt === 4) return { status: 200, json: result }

        return {
          status: 409,
          json: new ConflictError({ resource: "Review.md", message: "Current target requires review" }),
        }
      },
    })

    await openSession(page, {
      name: "SkillOverwrite",
      directory: "/skill/overwrite",
      sessions: [{ id: sessionID, title: "Skill overwrite" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: SkillAssets.history("overwrite", SkillAssets.body(), {
          ...SkillAssets.facts(),
          exists: true,
          revision: "a".repeat(64),
        }),
      }),
    })
    await openSidePanel(page, "Skill proposals")
    const panel = page.locator('[data-component="skill-proposals-panel"]')
    const replacement = panel.getByRole("group", { name: "Confirm skill replacement", exact: true })
    await expect(panel.getByRole("button", { name: "Legacy location", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save skill", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveText("Peer content B")
    expect(api.calls).toHaveLength(1)
    await replacement.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(1)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save skill", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveText("Peer content C")
    expect(api.calls).toHaveLength(2)
    await replacement.getByRole("button", { name: "Replace skill", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveText("Peer content D")
    expect(api.calls).toHaveLength(3)

    await replacement.getByRole("button", { name: "Replace skill", exact: true }).click()
    await expect(panel.locator('[data-component="skill-save-result"]')).toContainText(
      "Saved. This version is not yet visible in the current session.",
    )
    expect(api.calls.map((call) => call.body)).toEqual([
      {
        candidate: { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] },
        baseRevision: "a".repeat(64),
        target,
        overwrite: false,
      },
      {
        candidate: { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] },
        baseRevision: "a".repeat(64),
        target,
        overwrite: false,
      },
      {
        candidate: { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] },
        baseRevision: "c".repeat(64),
        target,
        overwrite: true,
      },
      {
        candidate: { ...SkillAssets.body(), relativePath: "Review.md", triggers: [], tags: [] },
        baseRevision: "d".repeat(64),
        target,
        overwrite: true,
      },
    ])
    expect(api.calls.every((call) => call.sessionID === sessionID)).toBe(true)
    expect(api.reads.every((url) => url.searchParams.get("directory") === "/skill/overwrite")).toBe(true)
    expect(api.reads.every((url) => url.searchParams.get("scope") === "location")).toBe(true)
  })

  for (const scenario of [
    "placement",
    "placement-collision",
    "missing-content",
    "inconsistent-list",
    "name-conflict",
  ] as const) {
    test("blocks replacement after " + scenario, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })

      const sessionID =
        scenario === "placement-collision" ? "ses_collision.md" : "ses_skill_block_" + scenario.replaceAll("-", "_")

      const target = { scope: "location" as const, root: "/skill/blocked/.aigcfroge/skills" }

      const info = {
        ...SkillAssets.info("b", undefined, target),
        relativePath: scenario === "placement-collision" ? sessionID : "Review.md",
      }

      const api = await SkillAssets.mock(page, {
        apply: () => ({
          status: 409,
          json: new ConflictError({
            resource: scenario.startsWith("placement") ? sessionID : "Review.md",
            message: "Conflict",
          }),
        }),
        content: () =>
          scenario === "missing-content"
            ? {
                status: 404,
                json: new ApiNotFoundError({ name: "NotFoundError", data: { message: "Target disappeared" } }),
              }
            : { status: 200, json: info },
        catalog: () => ({
          assets:
            scenario === "name-conflict"
              ? [info, { ...info, relativePath: "Elsewhere.md" }]
              : [{ ...info, revision: scenario === "inconsistent-list" ? "c".repeat(64) : info.revision }],
          invalid: [],
          target,
        }),
      })

      await openSession(page, {
        name: "SkillBlocked",
        directory: "/skill/blocked",
        sessions: [{ id: sessionID, title: "Blocked skill" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: SkillAssets.history(scenario, SkillAssets.body(), SkillAssets.facts(info.relativePath)),
        }),
      })
      await openSidePanel(page, "Skill proposals")
      const panel = page.locator('[data-component="skill-proposals-panel"]')
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save skill", exact: true }).click()
      await expect(panel.getByRole("button", { name: "Review again", exact: true })).toBeVisible()
      await expect(panel.locator('[data-component="skill-overwrite-confirm"]')).toHaveCount(0)

      if (scenario === "placement-collision")
        await expect(panel).toContainText("Could not save this skill. Review the candidate and try again.")

      expect(api.calls).toHaveLength(1)
      expect(api.reads).toHaveLength(scenario.startsWith("placement") ? 0 : 2)
    })
  }

  test("keeps older proposals visible but ineligible to save", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_skill_gui_legacy"

    const api = await SkillAssets.mock(page, {
      apply: () => {
        throw new Error("Legacy proposal must not apply")
      },
    })

    await openSession(page, {
      name: "LegacySkill",
      sessions: [{ id: sessionID, title: "Legacy skill" }],
      pageMessages: pageMessagesFrom({ [sessionID]: SkillAssets.history("legacy", SkillAssets.body(), null) }),
    })
    await openSidePanel(page, "Skill proposals")
    const panel = page.locator('[data-component="skill-proposals-panel"]')
    await expect(panel).toContainText("This older proposal lacks target and revision facts.")
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)
    expect(api.calls).toHaveLength(0)
  })

  test("revokes confirmation on candidate selection, session change, and reload", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const a = "ses_skill_gui_a"
    const b = "ses_skill_gui_b"
    const alpha = SkillAssets.body("AlphaSkill")
    const next = SkillAssets.body("NextSkill")
    const beta = SkillAssets.body("BetaSkill")

    const api = await SkillAssets.mock(page, {
      apply: () => {
        throw new Error("This scenario never confirms a save")
      },
    })

    await openSession(page, {
      name: "SkillRoute",
      sessions: [
        { id: a, title: "Alpha skills" },
        { id: b, title: "Beta skills" },
      ],
      pageMessages: pageMessagesFrom({
        [a]: [
          ...SkillAssets.history("alpha", alpha, SkillAssets.facts("AlphaSkill.md")),
          ...SkillAssets.history("next", next, SkillAssets.facts("NextSkill.md")),
        ],
        [b]: SkillAssets.history("beta", beta, SkillAssets.facts("BetaSkill.md")),
      }),
    })
    await openSidePanel(page, "Skill proposals")
    const panel = page.locator('[data-component="skill-proposals-panel"]')
    await panel.getByRole("button", { name: "AlphaSkill", exact: true }).click()
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel.locator('[data-component="skill-save-confirm"]')).toBeVisible()
    await panel.getByRole("button", { name: "NextSkill", exact: true }).click()
    await expect(panel.locator('[data-component="skill-save-confirm"]')).toHaveCount(0)
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(next.content)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await page.locator("[data-titlebar-tab-slot]", { hasText: "Beta skills" }).click()
    await expectSessionTitle(page, "Beta skills")
    await openSidePanel(page, "Skill proposals")
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(beta.content)
    await expect(panel.locator('[data-component="skill-save-confirm"]')).toHaveCount(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()

    await page.reload()
    await expectSessionTitle(page, "Beta skills")
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(beta.content)
    await expect(panel.locator('[data-component="skill-save-confirm"]')).toHaveCount(0)
    expect(api.calls).toHaveLength(0)
  })

  test("drops a late save reply after the panel follows another session", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const a = "ses_skill_gui_pending_a"
    const b = "ses_skill_gui_pending_b"
    const reply = Promise.withResolvers<SkillAssets.Reply>()
    const target = { scope: "location" as const, root: "/skill/pending/.aigcfroge/skills" }

    const api = await SkillAssets.mock(page, {
      apply: () => reply.promise,
    })

    await openSession(page, {
      name: "SkillPending",
      directory: "/skill/pending",
      sessions: [
        { id: a, title: "Pending Alpha" },
        { id: b, title: "Pending Beta" },
      ],
      pageMessages: pageMessagesFrom({
        [a]: SkillAssets.history("pending_a"),
        [b]: SkillAssets.history("pending_b", SkillAssets.body("BetaSkill"), SkillAssets.facts("BetaSkill.md")),
      }),
    })
    const panel = page.locator('[data-component="skill-proposals-panel"]')
    await openSidePanel(page, "Skill proposals")
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save skill", exact: true }).click()

    try {
      await expect.poll(() => api.calls.length).toBe(1)
      await page.locator("[data-titlebar-tab-slot]", { hasText: "Pending Beta" }).click()
      await expectSessionTitle(page, "Pending Beta")
      await openSidePanel(page, "Skill proposals")
      await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(
        SkillAssets.body("BetaSkill").content,
      )
    } finally {
      reply.resolve({ status: 200, json: SkillAssets.info("a", undefined, target) })
    }

    await expect.poll(() => api.replies.length).toBe(1)
    await expect(panel.locator('[data-component="skill-save-result"]')).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(a)
  })
})

test.describe("Command proposal panel", () => {
  test("requires saved facts and explicit confirmation, then exposes the filename through existing slash commands", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_command_gui"
    const body = CommandAssets.body()
    const target = { scope: "location" as const, root: "/command/gui/.aigcfroge/commands" }
    const result = CommandAssets.info("a", undefined, target)
    const commands = [{ name: "review-alias", description: body.description }]
    const used: { sessionID: string; body: unknown }[] = []
    const prompts: { sessionID: string; body: unknown }[] = []

    const api = await CommandAssets.mock(page, {
      inspect: (call) => CommandAssets.inspection(call, target),
      apply: () => ({ status: 200, json: result }),
    })

    const workspace = await openSession(page, {
      name: "CommandGui",
      directory: "/command/gui",
      sessions: [{ id: sessionID, title: "Command GUI" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: [
          ...CommandAssets.history("legacy", CommandAssets.body("LegacyCommand"), null),
          ...CommandAssets.history("fresh", body),
        ],
      }),
      commands: () => commands,
      onCommand: (request) => void used.push(request),
      onPrompt: (request) => void prompts.push(request),
    })

    await openSidePanel(page, "Command proposals")
    const panel = page.locator('[data-component="command-proposals-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText(body.source)
    await expect(panel.getByRole("button", { name: "Legacy location", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(panel.getByText(target.root, { exact: true })).toBeVisible()
    await expect(panel).toContainText(
      "This older proposal uses its session's original location until you choose another target.",
    )
    await panel.getByRole("button", { name: "LegacyCommand", exact: true }).click()
    await expect(panel).toContainText("This older proposal lacks target and revision facts.")
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: body.name.trim(), exact: true }).click()
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel.getByRole("group", { name: "Confirm command save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Cancel", exact: true }).click()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save command", exact: true }).click()
    await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(sessionID)
    expect(api.calls[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.calls[0]?.body).toEqual({ candidate: { ...body, relativePath: "Review.md" }, target, overwrite: false })
    expect(api.inspections.map((call) => call.body)).toEqual(
      Array.from({ length: 4 }, () => ({ candidate: { ...body, relativePath: "Review.md" }, scope: "location" })),
    )
    expect(api.inspections.every((call) => call.url.searchParams.get("directory") === workspace.directory)).toBe(true)
    expect([...api.inspections, ...api.calls].every((call) => !call.url.searchParams.has("workspace"))).toBe(true)
    expect(used).toHaveLength(0)
    expect(prompts).toHaveLength(0)

    commands[0] = { name: "Review", description: body.description }
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/command")
    await workspace.push([
      {
        id: "evt_command_gui",
        created: 4,
        type: "command.updated",
        location: { directory: workspace.directory },
        data: {},
      },
    ])
    expect((await refreshed).status()).toBe(200)
    await expect(panel).toContainText("/Review is listed in this session. Choose it from the composer.")
    expect(used).toHaveLength(0)
    expect(prompts).toHaveLength(0)
    await workspace.editor.fill("/Rev")
    const suggestion = page.locator('[data-component="composer-suggestions"] [data-suggestion-id="custom.Review"]')
    await expect(suggestion).toBeVisible()
    await suggestion.click()
    await page.keyboard.type("actual diff")
    await workspace.editor.press("Enter")
    await expect.poll(() => used.length).toBe(1)
    expect(used[0]?.sessionID).toBe(sessionID)
    expect(used[0]?.body).toMatchObject({ name: "Review", text: "actual diff" })
    expect(prompts).toHaveLength(0)
  })

  test("uses authoritative Command source and the displayed revision for separate replacement confirmation", async ({
    page,
  }) => {
    const sessionID = "ses_command_gui_replace"
    const body = CommandAssets.body()
    const target = { scope: "location" as const, root: "/command/replace/.aigcfroge/commands" }
    const current = CommandAssets.info("b", "Peer source", target)

    const api = await CommandAssets.mock(page, {
      inspect: (call) => CommandAssets.inspection(call, target),
      apply: (_, attempt) =>
        attempt === 1
          ? { status: 409, json: new ConflictError({ resource: current.relativePath, message: "File exists" }) }
          : { status: 200, json: CommandAssets.info("c", undefined, target) },
      catalog: () => CommandAssets.catalog(current),
      content: () => ({ status: 200, json: current }),
    })

    await openSession(page, {
      name: "CommandReplace",
      directory: "/command/replace",
      sessions: [{ id: sessionID, title: "Command replacement" }],
      pageMessages: pageMessagesFrom({ [sessionID]: CommandAssets.history("replace", body) }),
    })
    await openSidePanel(page, "Command proposals")
    const panel = page.locator('[data-component="command-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save command", exact: true }).click()
    const confirm = panel.getByRole("group", { name: "Confirm command replacement", exact: true })
    await expect(confirm).toBeVisible()
    await expect(confirm.locator("pre")).toHaveText(current.source)
    expect(api.calls).toHaveLength(1)
    await confirm.getByRole("button", { name: "Replace command", exact: true }).click()
    await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.body).toEqual({
      candidate: { ...body, relativePath: "Review.md" },
      target,
      baseRevision: current.revision,
      overwrite: true,
    })
    expect(api.reads).toHaveLength(2)
    expect(api.reads.every((url) => url.searchParams.get("scope") === "location")).toBe(true)
  })

  test("requires a separate deletion confirmation and binds the saved Command revision and target", async ({
    page,
  }) => {
    const sessionID = "ses_command_gui_delete"
    const target = { scope: "location" as const, root: "/command/delete/.aigcfroge/commands" }
    const result = CommandAssets.info("a", undefined, target)

    const api = await CommandAssets.mock(page, {
      inspect: (call) => CommandAssets.inspection(call, target),
      apply: () => ({ status: 200, json: result }),
      remove: () => ({ status: 200, json: undefined }),
    })

    const workspace = await openSession(page, {
      name: "CommandDelete",
      directory: "/command/delete",
      sessions: [{ id: sessionID, title: "Command deletion" }],
      pageMessages: pageMessagesFrom({ [sessionID]: CommandAssets.history("delete") }),
    })

    await openSidePanel(page, "Command proposals")
    const panel = page.locator('[data-component="command-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save command", exact: true }).click()
    await panel.getByRole("button", { name: "Review delete", exact: true }).click()
    const confirm = panel.getByRole("group", { name: "Confirm command deletion", exact: true })
    await expect(confirm).toBeVisible()
    await expect(confirm.locator("pre")).toHaveText(result.source)
    expect(api.deletes).toHaveLength(0)
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review delete", exact: true })).toBeVisible()
    expect(api.deletes).toHaveLength(0)
    await panel.getByRole("button", { name: "Review delete", exact: true }).click()
    await confirm.getByRole("button", { name: "Delete command", exact: true }).click()
    await expect(panel).toContainText("Command file deleted.")
    expect(api.deletes).toHaveLength(1)
    expect(api.deletes[0]?.sessionID).toBe(sessionID)
    expect(api.deletes[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.deletes[0]?.body).toEqual({ relativePath: result.relativePath, baseRevision: result.revision, target })
  })

  test("rechecks Project and explicit global targets before saving and keeps replacement and deletion on the saved owner", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_command_gui_targets"
    const location = { directory: "/command/targets/nested", workspaceID: "wrk_command_targets" }
    const project = { scope: "project" as const, root: "/command/targets/.aigcfroge/commands" }
    const shared = { scope: "global" as const, root: "/command/config/commands" }
    const moved = { scope: "global" as const, root: "/command/config/moved/commands" }
    const current = CommandAssets.info("b", "Current global source\r\n$ARGUMENTS stays literal.", moved)
    const saved = CommandAssets.info("c", undefined, moved)
    const candidate = { ...CommandAssets.body(), relativePath: "Review.md" }
    const prompts: { sessionID: string; body: unknown }[] = []
    const commands: { sessionID: string; body: unknown }[] = []

    const api = await CommandAssets.mock(page, {
      inspect: (call, attempt) => ({
        ...CommandAssets.inspection(call, attempt <= 2 ? project : attempt <= 4 ? shared : moved),
        json: {
          ...CommandAssets.facts(),
          target: attempt <= 2 ? project : attempt <= 4 ? shared : moved,
          exists: attempt > 4,
          revision: attempt > 4 ? "a".repeat(64) : null,
          pathConflict: attempt > 4,
          nameConflict: attempt >= 7,
        },
      }),
      catalog: () => CommandAssets.catalog(current),
      content: () => ({ status: 200, json: current }),
      apply: (_call, attempt) =>
        attempt === 1
          ? { status: 409, json: new ConflictError({ resource: "Review.md", message: "Global target changed" }) }
          : { status: 200, json: saved },
      remove: () => ({ status: 200, json: undefined }),
    })

    await openSession(page, {
      name: "CommandTargets",
      directory: location.directory,
      sessions: [{ id: sessionID, title: "Command targets", location }],
      pageMessages: pageMessagesFrom({
        [sessionID]: CommandAssets.history("targets", CommandAssets.body(), {
          ...CommandAssets.facts(),
          target: project,
        }),
      }),
      onPrompt: (input) => void prompts.push(input),
      onCommand: (input) => void commands.push(input),
    })
    await openSidePanel(page, "Command proposals")
    const panel = page.locator('[data-component="command-proposals-panel"]')
    const confirmation = panel.getByRole("group", { name: "Confirm command save", exact: true })
    const replacement = panel.getByRole("group", { name: "Confirm command replacement", exact: true })
    await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByText(project.root, { exact: true })).toBeVisible()
    await expect(panel.getByText("New file at the last check", { exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Legacy location", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(1)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(2)
    await panel.getByRole("button", { name: "Global", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Global", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
    await expect(panel).toContainText("Shared across projects. A project command with the same name can remain active.")
    await expect(confirmation).toHaveCount(0)
    expect(api.inspections).toHaveLength(3)
    expect(api.calls).toHaveLength(0)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation).toContainText("Save this command in the global directory shown above?")
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(4)
    expect(api.calls).toHaveLength(0)

    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
    await expect(panel.getByText(moved.root, { exact: true })).toBeVisible()
    await expect(panel.getByText(shared.root, { exact: true })).toHaveCount(0)
    await expect(panel.getByText("Existing file at the last check", { exact: true })).toBeVisible()
    await expect(panel).toContainText(
      "The target file has another command name. Replacing it requires a separate confirmation.",
    )
    expect(api.inspections).toHaveLength(5)
    expect(api.calls).toHaveLength(0)
    await confirmation.getByRole("button", { name: "Save command", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveJSProperty("textContent", current.source)
    await expect(replacement.getByRole("button", { name: "Replace command", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
    await replacement.getByRole("button", { name: "Replace command", exact: true }).click()
    await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")
    expect(api.calls).toHaveLength(2)
    expect(prompts).toHaveLength(0)
    expect(commands).toHaveLength(0)

    await panel.getByRole("button", { name: "Review delete", exact: true }).click()
    const deletion = panel.getByRole("group", { name: "Confirm command deletion", exact: true })
    await expect(deletion.locator("pre")).toHaveJSProperty("textContent", saved.source)
    await expect(panel.getByText(moved.root, { exact: true })).toBeVisible()
    expect(api.deletes).toHaveLength(0)
    await deletion.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review delete", exact: true })).toBeEnabled()
    expect(api.deletes).toHaveLength(0)
    await panel.getByRole("button", { name: "Review delete", exact: true }).click()
    await deletion.getByRole("button", { name: "Delete command", exact: true }).click()
    await expect(panel).toContainText("Command file deleted.")
    expect(api.deletes.map((call) => call.body)).toEqual([
      { relativePath: saved.relativePath, baseRevision: saved.revision, target: moved },
    ])

    await panel.getByRole("button", { name: "Recheck target", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.inspections).toHaveLength(6)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel).toContainText("Another file has this command name. Ask for a different name.")
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeDisabled()
    await expect(confirmation).toHaveCount(0)
    expect(api.calls.map((call) => call.body)).toEqual([
      { candidate, target: moved, baseRevision: "a".repeat(64), overwrite: false },
      { candidate, target: moved, baseRevision: current.revision, overwrite: true },
    ])
    expect(api.inspections.map((call) => call.body)).toEqual(
      ["project", "project", "global", "global", "global", "global", "global"].map((scope) => ({ candidate, scope })),
    )
    expect(
      [...api.inspections, ...api.calls, ...api.deletes].every(
        (call) =>
          call.sessionID === sessionID &&
          call.url.searchParams.get("directory") === location.directory &&
          call.url.searchParams.get("workspace") === location.workspaceID,
      ),
    ).toBe(true)
    expect(api.reads.map((url) => url.pathname).sort()).toEqual(["/command-asset", "/command-asset/content"])
    expect(
      api.reads.every(
        (url) =>
          url.searchParams.get("directory") === location.directory &&
          url.searchParams.get("workspace") === location.workspaceID &&
          url.searchParams.get("scope") === "global",
      ),
    ).toBe(true)
    expect(api.reads.find((url) => url.pathname === "/command-asset/content")?.searchParams.get("path")).toBe(
      "Review.md",
    )
    expect(prompts).toHaveLength(0)
    expect(commands).toHaveLength(0)
  })

  for (const scenario of ["project-global-project", "same-scope recheck"] as const) {
    test("ignores a late Command inspection after " + scenario, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_command_inspect_" + scenario.replaceAll(/[- ]/g, "_")
      const project = { scope: "project" as const, root: "/command/inspect/.aigcfroge/commands" }
      const shared = { scope: "global" as const, root: "/command/inspect/global/commands" }
      const stale = { scope: "project" as const, root: "/command/inspect/stale/commands" }
      const current = { scope: "project" as const, root: "/command/inspect/current/commands" }
      const late = Promise.withResolvers<SkillAssets.Reply>()
      const latest = Promise.withResolvers<SkillAssets.Reply>()

      const currentAttempt = scenario === "project-global-project" ? 4 : 3

      const fresh = {
        status: 200,
        json: { ...CommandAssets.facts(), exists: true, revision: "b".repeat(64), target: current },
      }

      const api = await CommandAssets.mock(page, {
        inspect: (call, attempt) => {
          if (attempt === 1) return CommandAssets.inspection(call, project)

          if (attempt === 2) return late.promise

          if (attempt === currentAttempt) return latest.promise

          if (attempt > currentAttempt) return fresh

          return CommandAssets.inspection(call, shared)
        },
        apply: () => {
          throw new Error("Canceled Command inspection must not save")
        },
      })

      await openSession(page, {
        name: "CommandInspect",
        directory: "/command/inspect/nested",
        sessions: [{ id: sessionID, title: "Command inspection" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: CommandAssets.history("inspect", CommandAssets.body(), {
            ...CommandAssets.facts(),
            target: project,
          }),
        }),
      })
      await openSidePanel(page, "Command proposals")
      const panel = page.locator('[data-component="command-proposals-panel"]')
      const confirmation = panel.getByRole("group", { name: "Confirm command save", exact: true })
      await expect(panel.getByText(project.root, { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()

      try {
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect.poll(() => api.inspections.length).toBe(2)
        await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)
        await expect(panel.getByRole("button", { name: "Save command", exact: true })).toHaveCount(0)
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)

        if (scenario === "project-global-project") {
          await panel.getByRole("button", { name: "Global", exact: true }).click()
          await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
          await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
          await panel.getByRole("button", { name: "Project", exact: true }).click()
        }

        if (scenario === "same-scope recheck")
          await panel.getByRole("button", { name: "Recheck target", exact: true }).click()

        await expect.poll(() => api.inspections.length).toBe(currentAttempt)
        await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute(
          "aria-pressed",
          "true",
        )
        await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)
        expect(api.calls).toHaveLength(0)
        latest.resolve(fresh)
        await expect.poll(() => api.inspectionReplies.length).toBe(currentAttempt - 1)
        await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
        await expect(panel.getByText("Existing file at the last check", { exact: true })).toBeVisible()
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
        await expect(confirmation).toHaveCount(0)
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
        expect(api.inspections).toHaveLength(currentAttempt + 1)
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      } finally {
        latest.resolve(fresh)
        late.resolve({ status: 200, json: { ...CommandAssets.facts(), target: stale } })
      }

      await expect.poll(() => api.inspectionReplies.length).toBe(currentAttempt + 1)
      await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(stale.root, { exact: true })).toHaveCount(0)
      await expect(panel.getByText("Existing file at the last check", { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(confirmation).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Save command", exact: true })).toHaveCount(0)
      expect(api.calls).toHaveLength(0)
      expect(api.inspections.map((call) => call.body)).toEqual(
        (scenario === "project-global-project"
          ? ["project", "project", "global", "project", "project"]
          : ["project", "project", "project", "project"]
        ).map((scope) => ({ candidate: { ...CommandAssets.body(), relativePath: "Review.md" }, scope })),
      )
    })
  }

  for (const scenario of ["apply", "catalog", "content", "native refresh", "delete"] as const) {
    test("ignores a late Command " + scenario + " reply after changing target", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_command_late_" + scenario.replaceAll(" ", "_")
      const location = { directory: "/command/late/nested", workspaceID: "wrk_command_late" }
      const project = { scope: "project" as const, root: "/command/late/.aigcfroge/commands" }
      const shared = { scope: "global" as const, root: "/command/late/global/commands" }
      const current = CommandAssets.info("b", "Earlier Project source", project)
      const late = Promise.withResolvers<SkillAssets.Reply>()
      const catalog = Promise.withResolvers<CommandAssetListOutput>()
      const used: { sessionID: string; body: unknown }[] = []

      const api = await CommandAssets.mock(page, {
        inspect: (call, attempt) => CommandAssets.inspection(call, attempt <= 2 ? project : shared),
        catalog: () => (scenario === "catalog" ? catalog.promise : CommandAssets.catalog(current)),
        content: () => (scenario === "content" ? late.promise : { status: 200, json: current }),
        apply: (_call, attempt) => {
          if (attempt > 1) return { status: 200, json: CommandAssets.info("c", undefined, shared) }

          if (scenario === "apply") return late.promise

          if (scenario === "native refresh" || scenario === "delete")
            return { status: 200, json: CommandAssets.info("a", undefined, project) }

          return { status: 409, json: new ConflictError({ resource: "Review.md", message: "Project target changed" }) }
        },
        remove: () => late.promise,
      })

      await openSession(page, {
        name: "CommandLate",
        directory: location.directory,
        sessions: [{ id: sessionID, title: "Late Command reply", location }],
        pageMessages: pageMessagesFrom({
          [sessionID]: CommandAssets.history("late", CommandAssets.body(), {
            ...CommandAssets.facts(),
            target: project,
          }),
        }),
        onPrompt: (input) => void used.push(input),
        onCommand: (input) => void used.push(input),
      })
      await openSidePanel(page, "Command proposals")
      const panel = page.locator('[data-component="command-proposals-panel"]')
      const confirmation = panel.getByRole("group", { name: "Confirm command save", exact: true })
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await confirmation.getByRole("button", { name: "Save command", exact: true }).click()
      await expect.poll(() => api.calls.length).toBe(1)

      if (scenario === "native refresh" || scenario === "delete")
        await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")

      const native =
        scenario === "native refresh"
          ? await holdRoute(page, (url) => url.pathname === "/api/command", { method: "GET" })
          : undefined

      const refreshed = native
        ? page.waitForResponse((response) => new URL(response.url()).pathname === "/api/command")
        : undefined

      try {
        if (native) {
          await panel.getByRole("button", { name: "Refresh command list", exact: true }).click()
          await native.arrived
          await expect(panel.getByRole("button", { name: "Refreshing command list…", exact: true })).toBeDisabled()
        }

        if (scenario === "delete") {
          await panel.getByRole("button", { name: "Review delete", exact: true }).click()
          await panel.getByRole("button", { name: "Delete command", exact: true }).click()
          await expect.poll(() => api.deletes.length).toBe(1)
          await expect(panel.getByText("Deleting command…", { exact: true })).toBeVisible()
        }

        if (scenario === "catalog" || scenario === "content") {
          await expect.poll(() => api.reads.length).toBe(2)
          await expect(panel.getByText("Reading the current file before replacement…", { exact: true })).toBeVisible()
        }

        if (scenario === "apply") await expect(panel.getByText("Saving command…", { exact: true })).toBeVisible()

        await panel.getByRole("button", { name: "Global", exact: true }).click()
        await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
        await expect(confirmation).toHaveCount(0)
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
        await expect(confirmation).toContainText("Save this command in the global directory shown above?")
      } finally {
        late.resolve({
          status: 200,
          json: Match.value(scenario).pipe(
            Match.when("delete", () => undefined),
            Match.when("apply", () => CommandAssets.info("a", undefined, project)),
            Match.orElse(() => current),
          ),
        })
        catalog.resolve(CommandAssets.catalog(current))
        native?.release()
      }

      await expect.poll(() => api.replies.length).toBe(1)
      await expect.poll(() => api.readReplies.length).toBe(scenario === "catalog" || scenario === "content" ? 2 : 0)
      await expect.poll(() => api.deleteReplies.length).toBe(scenario === "delete" ? 1 : 0)

      if (refreshed) expect((await refreshed).status()).toBe(200)

      await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(project.root, { exact: true })).toHaveCount(0)
      await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
      await expect(panel.locator('[data-component="skill-save-result"]')).toHaveCount(0)
      await expect(panel.getByRole("group", { name: "Confirm command replacement", exact: true })).toHaveCount(0)
      await expect(panel.getByText("Command file deleted.", { exact: true })).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      expect(api.inspections).toHaveLength(4)
      expect(used).toHaveLength(0)
      await confirmation.getByRole("button", { name: "Save command", exact: true }).click()
      await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")
      expect(api.calls.map((call) => call.body)).toEqual(
        [project, shared].map((target) => ({
          candidate: { ...CommandAssets.body(), relativePath: "Review.md" },
          target,
          overwrite: false,
        })),
      )
      expect(
        [...api.inspections, ...api.calls, ...api.deletes].every(
          (call) =>
            call.sessionID === sessionID &&
            call.url.searchParams.get("directory") === location.directory &&
            call.url.searchParams.get("workspace") === location.workspaceID,
        ),
      ).toBe(true)
      expect(api.reads.every((url) => url.searchParams.get("scope") === "project")).toBe(true)

      if (scenario === "delete")
        expect(api.deletes[0]?.body).toEqual({
          relativePath: "Review.md",
          baseRevision: "a".repeat(64),
          target: project,
        })

      expect(used).toHaveLength(0)
    })
  }

  for (const change of ["proposal", "session", "server", "unmount"] as const) {
    test("ignores a late Command save after changing " + change + " owner", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const directory = "/command/owner/nested"
      const a = "ses_command_owner_" + change
      const b = change === "server" ? a : a + "_next"

      const alpha = CommandAssets.body("AlphaCommand")

      const beta =
        change === "server" ? alpha : { ...CommandAssets.body("BetaCommand"), source: "Source for the Beta owner." }

      const target = { scope: "project" as const, root: "/command/owner/.aigcfroge/commands" }
      const first = CommandAssets.history("alpha", alpha, { ...CommandAssets.facts("AlphaCommand.md"), target })

      const next = CommandAssets.history("beta", beta, {
        ...CommandAssets.facts(change === "server" ? "AlphaCommand.md" : "BetaCommand.md"),
        target,
      })

      const reply = Promise.withResolvers<SkillAssets.Reply>()
      const used: { sessionID: string; body: unknown }[] = []

      const api = await CommandAssets.mock(page, {
        inspect: (call) => CommandAssets.inspection(call, target),
        apply: () => reply.promise,
      })

      if (change === "server")
        await mockRemoteServer(page, {
          name: "Other Command server",
          directory,
          provider: provider(),
          sessions: [session({ id: b, title: "Other Command owner", directory })],
          pageMessages: pageMessagesFrom({ [b]: first }),
          onPrompt: (input) => void used.push(input),
          onCommand: (input) => void used.push(input),
        })

      const options: Parameters<typeof openSession>[1] = {
        name: "CommandOwner",
        directory,
        sessions:
          change === "server" || change === "proposal"
            ? [{ id: a, title: "Original Command owner" }]
            : [
                { id: a, title: "Original Command owner" },
                { id: b, title: "Other Command owner" },
              ],
        pageMessages: pageMessagesFrom(
          Match.value(change).pipe(
            Match.when("proposal", () => ({ [a]: [...first, ...next] })),
            Match.when("server", () => ({ [a]: first })),
            Match.orElse(() => ({ [a]: first, [b]: next })),
          ),
        ),
        onPrompt: (input) => void used.push(input),
        onCommand: (input) => void used.push(input),
      }

      if (change === "server") options.seed = { tabs: [a, { session: b, server: REMOTE_SERVER }] }

      await openSession(page, options)
      await openSidePanel(page, "Command proposals")
      const panel = page.locator('[data-component="command-proposals-panel"]')

      if (change === "proposal") await panel.getByRole("button", { name: "AlphaCommand", exact: true }).click()

      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save command", exact: true }).click()

      try {
        await expect.poll(() => api.calls.length).toBe(1)
        await expect(panel.getByText("Saving command…", { exact: true })).toBeVisible()

        if (change === "proposal") await panel.getByRole("button", { name: "BetaCommand", exact: true }).click()

        if (change === "session" || change === "server")
          await page.locator("[data-titlebar-tab-slot]", { hasText: "Other Command owner" }).click()

        if (change === "unmount") {
          await page
            .locator("[data-titlebar-tab-slot]", { hasText: "Original Command owner" })
            .getByRole("button", { name: "Close tab", exact: true })
            .click()
          await expect(page.locator("[data-titlebar-tab-slot]", { hasText: "Original Command owner" })).toHaveCount(0)
        }

        if (change !== "proposal") {
          await expectSessionTitle(page, "Other Command owner")
          await openSidePanel(page, "Command proposals")
        }

        await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveJSProperty(
          "textContent",
          beta.source,
        )
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
        await expect(panel.getByRole("group", { name: "Confirm command save", exact: true })).toHaveCount(0)
      } finally {
        reply.resolve({
          status: 200,
          json: { ...CommandAssets.info("a", undefined, target), ...alpha, relativePath: "AlphaCommand.md" },
        })
      }

      await expect.poll(() => api.replies.length).toBe(1)
      await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveJSProperty(
        "textContent",
        beta.source,
      )
      await expect(panel.locator('[data-component="skill-save-result"]')).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review delete", exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      const confirmation = panel.getByRole("group", { name: "Confirm command save", exact: true })
      await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
      expect(api.calls).toHaveLength(1)
      expect(api.calls[0]?.sessionID).toBe(a)
      expect(api.calls[0]?.body).toEqual({
        candidate: { ...alpha, relativePath: "AlphaCommand.md" },
        target,
        overwrite: false,
      })
      expect(
        [...api.inspections, ...api.calls].every((call) => call.url.searchParams.get("directory") === directory),
      ).toBe(true)

      if (change === "server") {
        expect(api.calls[0]?.url.origin).not.toBe(REMOTE_SERVER)
        expect(
          api.inspections.filter((call) => call.url.origin === REMOTE_SERVER).map((call) => call.sessionID),
        ).toEqual([a, a])
      }

      expect(used).toHaveLength(0)
    })
  }

  test("revokes a pending Command inspection across disconnection and requires a fresh confirmation after reconnecting", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_command_reconnect"
    const project = { scope: "project" as const, root: "/command/reconnect/before/commands" }
    const current = { scope: "project" as const, root: "/command/reconnect/current/commands" }
    const late = Promise.withResolvers<SkillAssets.Reply>()
    const transport = await installSseTransport(page, { server: SERVER })

    const api = await CommandAssets.mock(page, {
      inspect: (call, attempt) => {
        if (attempt === 2) return late.promise

        return CommandAssets.inspection(call, attempt === 1 ? project : current)
      },
      apply: () => {
        throw new Error("Reconnecting does not authorize a Command save")
      },
    })

    await openSession(page, {
      name: "CommandReconnect",
      directory: "/command/reconnect/nested",
      sessions: [{ id: sessionID, title: "Command reconnect" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: CommandAssets.history("reconnect", CommandAssets.body(), {
          ...CommandAssets.facts(),
          target: project,
        }),
      }),
    })
    const connection = await transport.waitForConnection()
    await openSidePanel(page, "Command proposals")
    const panel = page.locator('[data-component="command-proposals-panel"]')
    const confirmation = panel.getByRole("group", { name: "Confirm command save", exact: true })
    await expect(panel.getByText(project.root, { exact: true })).toBeVisible()

    try {
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await expect.poll(() => api.inspections.length).toBe(2)
      await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
      await transport.disconnect()
      await transport.waitForConnection({ after: connection.id })
      await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(confirmation).toHaveCount(0)
      expect(api.calls).toHaveLength(0)
    } finally {
      late.resolve({ status: 200, json: { ...CommandAssets.facts(), target: project } })
    }

    await expect.poll(() => api.inspectionReplies.length).toBe(api.inspections.length)
    await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
    await expect(panel.getByText(project.root, { exact: true })).toHaveCount(0)
    await expect(confirmation).toHaveCount(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    expect(api.calls).toHaveLength(0)
  })

  test("requires reinspection and another Command confirmation after target_mismatch", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_command_target_mismatch"
    const before = { scope: "project" as const, root: "/command/mismatch/before/commands" }
    const after = { scope: "project" as const, root: "/command/mismatch/after/commands" }
    const recheck = Promise.withResolvers<SkillAssets.Reply>()
    const fresh = { status: 200, json: { ...CommandAssets.facts(), target: after } }

    const api = await CommandAssets.mock(page, {
      inspect: (call, attempt) => {
        if (attempt === 3) return recheck.promise

        return attempt > 3 ? fresh : CommandAssets.inspection(call, before)
      },
      apply: (_call, attempt) =>
        attempt === 1
          ? {
              status: 400,
              json: new InvalidRequestError({
                message: "Project target changed",
                field: "target",
                kind: "target_mismatch",
              }),
            }
          : { status: 200, json: CommandAssets.info("b", undefined, after) },
    })

    await openSession(page, {
      name: "CommandTargetMismatch",
      directory: "/command/mismatch/nested",
      sessions: [{ id: sessionID, title: "Command target mismatch" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: CommandAssets.history("mismatch", CommandAssets.body(), {
          ...CommandAssets.facts(),
          target: before,
        }),
      }),
    })
    await openSidePanel(page, "Command proposals")
    const panel = page.locator('[data-component="command-proposals-panel"]')
    const confirmation = panel.getByRole("group", { name: "Confirm command save", exact: true })
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await confirmation.getByRole("button", { name: "Save command", exact: true }).click()
    await expect(panel).toContainText(
      "The target directory changed. Recheck the target and confirm it again before saving.",
    )
    await expect(panel.getByRole("button", { name: "Review again", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Save command", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Recheck target", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
    expect(api.inspections).toHaveLength(2)
    expect(api.reads).toHaveLength(0)

    try {
      await panel.getByRole("button", { name: "Recheck target", exact: true }).click()
      await expect.poll(() => api.inspections.length).toBe(3)
      await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
      await expect(confirmation).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      recheck.resolve(fresh)
      await expect(panel.getByText(after.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(before.root, { exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(confirmation).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await expect(confirmation.getByRole("button", { name: "Save command", exact: true })).toBeEnabled()
      expect(api.inspections).toHaveLength(4)
      expect(api.calls).toHaveLength(1)
      await confirmation.getByRole("button", { name: "Save command", exact: true }).click()
      await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")
    } finally {
      recheck.resolve(fresh)
    }

    expect(api.calls.map((call) => call.body)).toEqual(
      [before, after].map((target) => ({
        candidate: { ...CommandAssets.body(), relativePath: "Review.md" },
        target,
        overwrite: false,
      })),
    )
    expect(api.reads).toHaveLength(0)
    expect(api.inspections.every((call) => call.url.searchParams.get("directory") === "/command/mismatch/nested")).toBe(
      true,
    )
  })

  test("requires a separate Command replacement confirmation for every current global revision", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_command_revisions"
    const project = { scope: "project" as const, root: "/command/revisions/.aigcfroge/commands" }
    const target = { scope: "global" as const, root: "/command/revisions/global/commands" }
    const current = { value: CommandAssets.info("b", "Peer source B\r\n$ARGUMENTS", target) }
    const candidate = { ...CommandAssets.body(), relativePath: "Review.md" }

    const api = await CommandAssets.mock(page, {
      inspect: (call, attempt) => {
        if (attempt === 1) return CommandAssets.inspection(call, project)

        return { status: 200, json: { ...CommandAssets.facts(), exists: true, revision: "a".repeat(64), target } }
      },
      catalog: () => CommandAssets.catalog(current.value),
      content: () => ({ status: 200, json: current.value }),
      apply: (_call, attempt) => {
        if (attempt === 2) current.value = CommandAssets.info("c", "Peer source C\r\n$ARGUMENTS", target)

        if (attempt === 3) current.value = CommandAssets.info("d", "Peer source D\r\n$ARGUMENTS", target)

        if (attempt === 4) return { status: 200, json: CommandAssets.info("e", undefined, target) }

        return {
          status: 409,
          json: new ConflictError({ resource: "Review.md", message: "Current target requires review" }),
        }
      },
    })

    await openSession(page, {
      name: "CommandRevisions",
      directory: "/command/revisions/nested",
      sessions: [{ id: sessionID, title: "Command revisions" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: CommandAssets.history("revisions", CommandAssets.body(), {
          ...CommandAssets.facts(),
          target: project,
        }),
      }),
    })
    await openSidePanel(page, "Command proposals")
    const panel = page.locator('[data-component="command-proposals-panel"]')
    const replacement = panel.getByRole("group", { name: "Confirm command replacement", exact: true })
    await expect(panel.getByText(project.root, { exact: true })).toBeVisible()
    await panel.getByRole("button", { name: "Global", exact: true }).click()
    await expect(panel.getByText(target.root, { exact: true })).toBeVisible()
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save command", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveJSProperty("textContent", "Peer source B\r\n$ARGUMENTS")
    expect(api.calls).toHaveLength(1)
    await replacement.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save command", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveJSProperty("textContent", "Peer source C\r\n$ARGUMENTS")
    expect(api.calls).toHaveLength(2)
    await replacement.getByRole("button", { name: "Replace command", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveJSProperty("textContent", "Peer source D\r\n$ARGUMENTS")
    expect(api.calls).toHaveLength(3)
    await replacement.getByRole("button", { name: "Replace command", exact: true }).click()
    await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")
    expect(api.calls.map((call) => call.body)).toEqual([
      { candidate, target, baseRevision: "a".repeat(64), overwrite: false },
      { candidate, target, baseRevision: "a".repeat(64), overwrite: false },
      { candidate, target, baseRevision: "c".repeat(64), overwrite: true },
      { candidate, target, baseRevision: "d".repeat(64), overwrite: true },
    ])
    expect(api.reads).toHaveLength(6)
    expect(
      api.reads.every(
        (url) =>
          url.searchParams.get("scope") === "global" &&
          url.searchParams.get("directory") === "/command/revisions/nested",
      ),
    ).toBe(true)
  })

  for (const scenario of [
    "placement",
    "placement-collision",
    "missing-content",
    "inconsistent-list",
    "wrong-root",
    "wrong-scope",
    "missing-target",
    "name-conflict",
  ] as const) {
    test("blocks Command replacement after " + scenario, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })

      const sessionID =
        scenario === "placement-collision"
          ? "ses_command_collision.md"
          : "ses_command_block_" + scenario.replaceAll("-", "_")

      const target = { scope: "project" as const, root: "/command/blocked/.aigcfroge/commands" }

      const responseTarget = Match.value(scenario).pipe(
        Match.when("wrong-scope", () => ({ ...target, scope: "global" as const })),
        Match.when("wrong-root", () => ({ ...target, root: "/command/other/.aigcfroge/commands" })),
        Match.orElse(() => target),
      )

      const info = {
        ...CommandAssets.info("b", "Peer source", scenario === "missing-target" ? undefined : responseTarget),
        relativePath: scenario === "placement-collision" ? sessionID : "Review.md",
      }

      const api = await CommandAssets.mock(page, {
        inspect: (call) => CommandAssets.inspection(call, target),
        apply: () => ({
          status: 409,
          json: new ConflictError({
            resource: scenario.startsWith("placement") ? sessionID : "Review.md",
            message: "Conflict",
          }),
        }),
        content: () =>
          scenario === "missing-content"
            ? {
                status: 404,
                json: new ApiNotFoundError({ name: "NotFoundError", data: { message: "Target disappeared" } }),
              }
            : { status: 200, json: info },
        catalog: () => {
          const catalog = CommandAssets.catalog(info)

          return {
            ...catalog,
            assets:
              scenario === "name-conflict"
                ? catalog.assets.flatMap((entry) => [entry, { ...entry, relativePath: "Elsewhere.md" }])
                : catalog.assets.map((entry) => ({
                    ...entry,
                    revision: scenario === "inconsistent-list" ? "c".repeat(64) : entry.revision,
                  })),
          }
        },
      })

      await openSession(page, {
        name: "CommandBlocked",
        directory: "/command/blocked/nested",
        sessions: [{ id: sessionID, title: "Blocked Command" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: CommandAssets.history(scenario, CommandAssets.body(), {
            ...CommandAssets.facts(info.relativePath),
            target,
          }),
        }),
      })
      await openSidePanel(page, "Command proposals")
      const panel = page.locator('[data-component="command-proposals-panel"]')
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save command", exact: true }).click()
      await expect(panel.getByRole("button", { name: "Review again", exact: true })).toBeVisible()
      await expect(panel.getByRole("group", { name: "Confirm command replacement", exact: true })).toHaveCount(0)

      if (scenario === "placement-collision")
        await expect(panel).toContainText("Could not confirm the save. Review the current file before trying again.")

      if (scenario === "wrong-root" || scenario === "wrong-scope" || scenario === "missing-target")
        await expect(panel).toContainText("Could not read a consistent current file. Ask for a new proposal.")

      expect(api.calls).toHaveLength(1)
      expect(api.reads).toHaveLength(scenario.startsWith("placement") ? 0 : 2)
      expect(api.reads.every((url) => url.searchParams.get("scope") === "project")).toBe(true)
    })
  }

  for (const failure of ["target_mismatch", "stale_revision"] as const) {
    test("does not claim the Command file is unchanged or retry deletion after " + failure, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_command_delete_" + failure
      const location = { directory: "/command/delete/nested", workspaceID: "wrk_command_delete" }
      const target = { scope: "project" as const, root: "/command/delete/.aigcfroge/commands" }
      const changed = { scope: "project" as const, root: "/command/delete/changed/commands" }
      const saved = CommandAssets.info("a", undefined, target)

      const api = await CommandAssets.mock(page, {
        inspect: (call, attempt) => CommandAssets.inspection(call, attempt <= 2 ? target : changed),
        apply: () => ({ status: 200, json: saved }),
        remove: () =>
          failure === "target_mismatch"
            ? {
                status: 400,
                json: new InvalidRequestError({ message: "Target moved", field: "target", kind: "target_mismatch" }),
              }
            : { status: 409, json: new ConflictError({ resource: "Review.md", message: "The file changed" }) },
      })

      await openSession(page, {
        name: "CommandDeleteFailure",
        directory: location.directory,
        sessions: [{ id: sessionID, title: "Command deletion failure", location }],
        pageMessages: pageMessagesFrom({
          [sessionID]: CommandAssets.history("delete_failure", CommandAssets.body(), {
            ...CommandAssets.facts(),
            target,
          }),
        }),
      })
      await openSidePanel(page, "Command proposals")
      const panel = page.locator('[data-component="command-proposals-panel"]')
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save command", exact: true }).click()
      await panel.getByRole("button", { name: "Review delete", exact: true }).click()
      await panel.getByRole("button", { name: "Delete command", exact: true }).click()
      await expect(panel).toContainText("Could not confirm deletion. Check the current file before another action.")
      await expect(panel.getByText("Command file deleted.", { exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Delete command", exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review delete", exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review again", exact: true })).toHaveCount(0)
      expect(api.deletes).toHaveLength(1)
      expect(api.deletes[0]?.body).toEqual({ relativePath: saved.relativePath, baseRevision: saved.revision, target })
      expect(api.deletes[0]?.sessionID).toBe(sessionID)
      expect(api.deletes[0]?.url.searchParams.get("directory")).toBe(location.directory)
      expect(api.deletes[0]?.url.searchParams.get("workspace")).toBe(location.workspaceID)
      await panel.getByRole("button", { name: "Recheck target", exact: true }).click()
      await expect(panel.getByText(changed.root, { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(panel.getByRole("button", { name: "Review delete", exact: true })).toHaveCount(0)
      expect(api.deletes).toHaveLength(1)
      expect(api.calls).toHaveLength(1)
    })
  }

  for (const scheme of ["light", "dark"] as const) {
    test(
      "keeps the complete Command source and global confirmation usable on a narrow " + scheme + " screen",
      async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 600, height: 900 })
        const sessionID = "ses_command_narrow_" + scheme
        const project = { scope: "project" as const, root: "/command/narrow/.aigcfroge/commands" }
        const target = { scope: "global" as const, root: "/command/narrow/config/commands" }
        const source = "\uFEFF# Literal command\r\n\r\n" + "Keep $ARGUMENTS, $HOME and 中文 exactly.\r\n".repeat(70)
        const body = { ...CommandAssets.body(), args: "", source }

        const api = await CommandAssets.mock(page, {
          inspect: (call, attempt) => CommandAssets.inspection(call, attempt === 1 ? project : target),
          apply: () => ({ status: 200, json: { ...CommandAssets.info("a", source, target), args: "" } }),
        })

        await openSession(page, {
          name: "CommandNarrow" + scheme,
          directory: "/command/narrow/nested",
          sessions: [{ id: sessionID, title: "Narrow Command" }],
          pageMessages: pageMessagesFrom({
            [sessionID]: CommandAssets.history("narrow", body, { ...CommandAssets.facts(), target: project }),
          }),
          seed: { theme: { id: "oc-2", scheme } },
        })
        await page
          .locator('[data-slot="session-mobile-view-tabs"]')
          .getByRole("tab", { name: "More...", exact: true })
          .click()
        await page
          .locator('[data-slot="session-mobile-view-options"]')
          .getByRole("button", { name: "Command proposals", exact: true })
          .click()
        const panel = page.locator('[data-component="command-proposals-panel"]')
        const content = panel.locator('[data-component="skill-candidate"] > pre')
        await expect(content).toHaveJSProperty("textContent", source)
        await expect(panel.getByText(project.root, { exact: true })).toBeVisible()
        await panel.getByRole("button", { name: "Global", exact: true }).press("Enter")
        await expect(panel.getByText(target.root, { exact: true })).toBeVisible()
        await panel.getByRole("button", { name: "Review save", exact: true }).press("Enter")
        const confirmation = panel.getByRole("group", { name: "Confirm command save", exact: true })
        await expect(confirmation).toContainText("Save this command in the global directory shown above?")
        await expect(content).toHaveJSProperty("textContent", source)
        await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme)
        await confirmation.getByRole("button", { name: "Save command", exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath("command-global-" + scheme + ".png") })
        expect(api.calls).toHaveLength(0)
        await confirmation.getByRole("button", { name: "Save command", exact: true }).press("Enter")
        await expect(panel).toContainText("Saved. The command name is not yet listed in this session.")
        expect(api.calls.map((call) => call.body)).toEqual([
          { candidate: { ...body, relativePath: "Review.md" }, target, overwrite: false },
        ])
      },
    )
  }
})

test.describe("Prompt proposal panel", () => {
  test("rechecks the Project target before saving and inserts its literal template only after confirmation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_prompt_gui"
    const body = PromptAssets.body()
    const target = PromptAssets.target("project", "/prompt/project/.aigcfroge/prompts")
    const result = PromptAssets.info("a", undefined, target)
    const used: { sessionID: string; body: unknown }[] = []
    const commands: unknown[] = []
    const writes: { path: string; directory: string; body: string }[] = []
    const content = Promise.withResolvers<SkillAssets.Reply>()

    const api = await PromptAssets.mock(page, {
      inspect: (call) => PromptAssets.inspection(call, target),
      apply: () => ({ status: 200, json: result }),
      content: () => content.promise,
    })

    const workspace = await openSession(page, {
      name: "PromptGui",
      directory: "/prompt/project/nested",
      sessions: [{ id: sessionID, title: "Prompt GUI" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: PromptAssets.history("fresh", body, { ...SkillAssets.facts(), target }),
      }),
      onPrompt: (request) => void used.push(request),
      onCommand: (request) => void commands.push(request),
      onFileWrite: (request) => void writes.push(request),
    })

    await workspace.editor.fill("Before  After")
    const chooser = page.waitForEvent("filechooser")
    await workspace.editor.press("ControlOrMeta+u")
    await (
      await chooser
    ).setFiles({ name: "prompt-note.txt", mimeType: "text/plain", buffer: Buffer.from("Keep this attachment") })
    await expect
      .poll(() => writes)
      .toEqual([
        {
          path: expect.stringMatching(/\/uploads\/[0-9a-f-]{36}\/prompt-note\.txt$/),
          directory: workspace.directory,
          body: "Keep this attachment",
        },
      ])
    await expect(page.locator('[data-component="composer-attachments"]')).toContainText("prompt-note.txt")

    const mention = await page.evaluateHandle(() => {
      const transfer = new DataTransfer()
      transfer.setData("text/plain", "file:src/keep.ts")

      return transfer
    })

    await workspace.editor.press("Home")
    await page.locator('[data-component="composer"]').dispatchEvent("drop", { dataTransfer: mention })
    await expect(workspace.editor.locator('[data-mention="file"]')).toHaveText("@src/keep.ts")
    await expect.poll(() => workspace.editor.innerText()).toBe("@src/keep.ts Before  After")

    for (const key of ["End", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft"])
      await workspace.editor.press(key)
    await openSidePanel(page, "Prompt proposals")
    const panel = page.locator('[data-component="prompt-proposals-panel"]')
    await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByText(target.root, { exact: true })).toBeVisible()
    await expect(panel.getByRole("button", { name: "Legacy location", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(await panel.locator('[data-component="skill-candidate"] > pre').textContent()).toBe(body.template)
    expect(api.inspections).toHaveLength(1)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel.getByRole("group", { name: "Confirm prompt save", exact: true })).toBeVisible()
    expect(api.inspections).toHaveLength(2)
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save prompt", exact: true }).click()
    await expect(panel).toContainText("Saved. Insert the template into your message when you are ready.")
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(sessionID)
    expect(api.calls[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.calls[0]?.body).toEqual({ candidate: { ...body, relativePath: "Review.md" }, overwrite: false, target })
    expect(api.inspections.map((call) => call.body)).toEqual(
      Array.from({ length: 3 }, () => ({ candidate: { ...body, relativePath: "Review.md" }, scope: "project" })),
    )
    await expect.poll(() => workspace.editor.innerText()).toBe("@src/keep.ts Before  After")
    expect(used).toHaveLength(0)
    await panel.getByRole("button", { name: "Insert into message", exact: true }).click()

    try {
      await expect(panel.getByRole("button", { name: "Reading saved template…", exact: true })).toBeDisabled()
      await workspace.editor.pressSequentially("During ")
      await expect.poll(() => workspace.editor.innerText()).toBe("@src/keep.ts Before During  After")
    } finally {
      content.resolve({ status: 200, json: result })
    }

    await expect.poll(() => workspace.editor.innerText()).toBe("@src/keep.ts Before During " + body.template + " After")
    await expect(workspace.editor.locator('[data-mention="file"]')).toHaveText("@src/keep.ts")
    await expect(page.locator('[data-component="composer-attachments"]')).toContainText("prompt-note.txt")
    await workspace.editor.pressSequentially("!")
    const text = "@src/keep.ts Before During " + body.template + "! After"
    await expect.poll(() => workspace.editor.innerText()).toBe(text)
    expect(api.reads).toHaveLength(1)
    expect(api.reads[0]?.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.reads[0]?.searchParams.get("path")).toBe("Review.md")
    expect(api.reads[0]?.searchParams.get("scope")).toBe("project")
    expect(api.inspections.every((call) => call.url.searchParams.get("directory") === workspace.directory)).toBe(true)
    expect([...api.inspections, ...api.calls].every((call) => !call.url.searchParams.has("workspace"))).toBe(true)
    await expect(panel.getByRole("button", { name: /delete/i })).toHaveCount(0)
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
    expect(commands).toHaveLength(0)
    await workspace.editor.press("Enter")
    await expect.poll(() => used.length).toBe(1)
    expect(used[0]?.sessionID).toBe(sessionID)
    expect(used[0]?.body).toMatchObject({
      text: text + "\nAttached file: `" + writes[0]?.path + "`",
      files: [
        {
          uri: "file:///prompt/project/nested/src/keep.ts",
          name: "keep.ts",
          mention: { start: 0, end: 12, text: "@src/keep.ts" },
        },
      ],
      metadata: {
        displayText: text,
        attachments: [{ name: "prompt-note.txt", mime: "text/plain", path: writes[0]?.path }],
      },
    })
  })

  test("restores the middle caret after inserting a saved Prompt while the editor is inactive", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_prompt_inactive_caret"
    const body = PromptAssets.body()
    const target = PromptAssets.target("project", "/prompt/inactive/.aigcfroge/prompts")
    const result = PromptAssets.info("a", undefined, target)
    const used: unknown[] = []
    const content = Promise.withResolvers<SkillAssets.Reply>()

    const api = await PromptAssets.mock(page, {
      inspect: (call) => PromptAssets.inspection(call, target),
      apply: () => ({ status: 200, json: result }),
      content: () => content.promise,
    })

    const workspace = await openSession(page, {
      name: "PromptInactiveCaret",
      directory: "/prompt/inactive/nested",
      sessions: [{ id: sessionID, title: "Prompt inactive caret" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: PromptAssets.history("inactive", body, { ...SkillAssets.facts(), target }),
      }),
      onPrompt: (request) => void used.push(request),
      onCommand: (request) => void used.push(request),
    })

    await workspace.editor.fill("Before  After")

    for (const key of ["End", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowLeft"])
      await workspace.editor.press(key)
    await openSidePanel(page, "Prompt proposals")
    const panel = page.locator('[data-component="prompt-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save prompt", exact: true }).click()
    await expect(panel).toContainText("Saved. Insert the template into your message when you are ready.")
    await panel.getByRole("button", { name: "Insert into message", exact: true }).click()

    try {
      await expect(panel.getByRole("button", { name: "Reading saved template…", exact: true })).toBeDisabled()
      await expect(workspace.editor).not.toBeFocused()
      await expect.poll(() => workspace.editor.innerText()).toBe("Before  After")
    } finally {
      content.resolve({ status: 200, json: result })
    }

    await expect.poll(() => workspace.editor.innerText()).toBe("Before " + body.template + " After")
    await expect(workspace.editor).not.toBeFocused()
    expect(api.calls).toHaveLength(1)
    expect(api.reads).toHaveLength(1)
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
    await workspace.editor.focus()
    await workspace.editor.pressSequentially("!")
    await expect.poll(() => workspace.editor.innerText()).toBe("Before " + body.template + "! After")
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
  })

  test("uses the displayed Prompt revision for replacement through the narrow dark keyboard flow", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    const sessionID = "ses_prompt_replace"
    const target = PromptAssets.target("location", "/prompt/legacy/.aigcfroge/prompts")
    const current = PromptAssets.info("b", "Peer template", target)
    const used: unknown[] = []

    const api = await PromptAssets.mock(page, {
      inspect: (call) => PromptAssets.inspection(call, target),
      apply: (_, attempt) =>
        attempt === 1
          ? { status: 409, json: new ConflictError({ resource: current.relativePath, message: "File exists" }) }
          : { status: 200, json: PromptAssets.info("c", undefined, target) },
      catalog: () => PromptAssets.catalog(current),
      content: () => ({ status: 200, json: current }),
    })

    const workspace = await openSession(page, {
      name: "PromptReplace",
      directory: "/prompt/legacy",
      sessions: [{ id: sessionID, title: "Prompt replacement" }],
      pageMessages: pageMessagesFrom({ [sessionID]: PromptAssets.history("replace") }),
      seed: { theme: { id: "oc-2", scheme: "dark" } },
      onPrompt: (request) => void used.push(request),
      onCommand: (request) => void used.push(request),
    })

    await workspace.editor.fill("Keep legacy draft")

    await page
      .locator('[data-slot="session-mobile-view-tabs"]')
      .getByRole("tab", { name: "More...", exact: true })
      .click()
    await page
      .locator('[data-slot="session-mobile-view-options"]')
      .getByRole("button", { name: "Prompt proposals", exact: true })
      .click()
    const panel = page.locator('[data-component="prompt-proposals-panel"]')
    await expect(panel.getByRole("button", { name: "Legacy location", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await panel.getByRole("button", { name: "Review save", exact: true }).press("Enter")
    await panel.getByRole("button", { name: "Save prompt", exact: true }).press("Enter")
    const confirm = panel.getByRole("group", { name: "Confirm prompt replacement", exact: true })
    await expect(confirm).toBeVisible()
    await expect(confirm.locator("pre")).toHaveText(current.template)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    expect(api.calls).toHaveLength(1)
    await confirm.getByRole("button", { name: "Replace prompt", exact: true }).press("Enter")
    await expect(panel).toContainText("Saved. Insert the template into your message when you are ready.")
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.body).toEqual({
      candidate: { ...PromptAssets.body(), relativePath: "Review.md" },
      baseRevision: current.revision,
      overwrite: true,
      target,
    })
    expect(api.inspections.every((call) => call.url.searchParams.get("directory") === workspace.directory)).toBe(true)
    expect(api.reads).toHaveLength(2)
    expect(api.reads.every((url) => url.searchParams.get("scope") === "location")).toBe(true)
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
  })

  test("keeps explicit global saves, each CAS review, and insertion on the same Prompt target", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_prompt_global_revisions"
    const location = { directory: "/prompt/global/nested", workspaceID: "wrk_prompt_global" }
    const project = PromptAssets.target("project", "/prompt/global/.aigcfroge/prompts")
    const target = PromptAssets.target("global", "/prompt/config/prompts")
    const saved = PromptAssets.info("e", undefined, target)
    const current = { value: PromptAssets.info("b", "Peer template B\r\n$ARGUMENTS", target) }
    const candidate = { ...PromptAssets.body(), relativePath: "Review.md" }
    const used: unknown[] = []

    const api = await PromptAssets.mock(page, {
      inspect: (call, attempt) =>
        PromptAssets.inspection(
          call,
          attempt <= 2 ? project : target,
          attempt <= 2 ? undefined : PromptAssets.info("a", undefined, target),
        ),
      catalog: () => PromptAssets.catalog(current.value),
      content: () => ({ status: 200, json: current.value }),
      apply: (_call, attempt) => {
        if (attempt === 2) current.value = PromptAssets.info("c", "Peer template C\r\n$ARGUMENTS", target)

        if (attempt === 3) current.value = PromptAssets.info("d", "Peer template D\r\n$ARGUMENTS", target)

        if (attempt === 4) {
          current.value = saved

          return { status: 200, json: saved }
        }

        return {
          status: 409,
          json: new ConflictError({ resource: "Review.md", message: "Current Prompt requires review" }),
        }
      },
    })

    const workspace = await openSession(page, {
      name: "PromptGlobalRevisions",
      directory: location.directory,
      sessions: [{ id: sessionID, title: "Prompt global revisions", location }],
      pageMessages: pageMessagesFrom({
        [sessionID]: PromptAssets.history("global", PromptAssets.body(), { ...SkillAssets.facts(), target: project }),
      }),
      onPrompt: (request) => void used.push(request),
      onCommand: (request) => void used.push(request),
    })

    await workspace.editor.fill("Keep global draft: ")
    await workspace.editor.press("End")
    await openSidePanel(page, "Prompt proposals")
    const panel = page.locator('[data-component="prompt-proposals-panel"]')
    const confirmation = panel.getByRole("group", { name: "Confirm prompt save", exact: true })
    const replacement = panel.getByRole("group", { name: "Confirm prompt replacement", exact: true })
    await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute("aria-pressed", "true")
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save prompt", exact: true })).toBeEnabled()
    await panel.getByRole("button", { name: "Global", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Global", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(panel.getByText(target.root, { exact: true })).toBeVisible()
    await expect(panel).toContainText("Shared across projects. Insertion uses the saved template from this directory.")
    await expect(confirmation).toHaveCount(0)
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation).toContainText("Save this prompt in the global directory shown above?")
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await confirmation.getByRole("button", { name: "Save prompt", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveJSProperty("textContent", "Peer template B\r\n$ARGUMENTS")
    await replacement.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await confirmation.getByRole("button", { name: "Save prompt", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveJSProperty("textContent", "Peer template C\r\n$ARGUMENTS")
    expect(api.calls).toHaveLength(2)
    await replacement.getByRole("button", { name: "Replace prompt", exact: true }).click()
    await expect(replacement.locator("pre")).toHaveJSProperty("textContent", "Peer template D\r\n$ARGUMENTS")
    expect(api.calls).toHaveLength(3)
    await replacement.getByRole("button", { name: "Replace prompt", exact: true }).click()
    await expect(panel).toContainText("Saved. Insert the template into your message when you are ready.")
    expect(api.calls.map((call) => call.body)).toEqual([
      { candidate, target, baseRevision: "a".repeat(64), overwrite: false },
      { candidate, target, baseRevision: "a".repeat(64), overwrite: false },
      { candidate, target, baseRevision: "c".repeat(64), overwrite: true },
      { candidate, target, baseRevision: "d".repeat(64), overwrite: true },
    ])
    expect(api.inspections.map((call) => call.body)).toEqual(
      ["project", "project", "global", "global", "global", "global"].map((scope) => ({ candidate, scope })),
    )
    await expect(workspace.editor).toHaveJSProperty("textContent", "Keep global draft: ")
    expect(used).toHaveLength(0)
    await panel.getByRole("button", { name: "Insert into message", exact: true }).click()
    await expect.poll(() => workspace.editor.innerText()).toBe("Keep global draft: " + saved.template)
    expect(api.reads).toHaveLength(7)
    expect(
      api.reads.filter((url) => url.pathname === "/prompt-asset/content").map((url) => url.searchParams.get("path")),
    ).toEqual(Array.from({ length: 4 }, () => "Review.md"))
    expect(
      api.reads.every(
        (url) =>
          url.searchParams.get("scope") === "global" &&
          url.searchParams.get("directory") === location.directory &&
          url.searchParams.get("workspace") === location.workspaceID,
      ),
    ).toBe(true)
    expect(
      [...api.inspections, ...api.calls].every(
        (call) =>
          call.sessionID === sessionID &&
          call.url.searchParams.get("directory") === location.directory &&
          call.url.searchParams.get("workspace") === location.workspaceID,
      ),
    ).toBe(true)
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
  })

  test("requires a fresh Prompt inspection and confirmation after target_mismatch", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_prompt_target_mismatch"
    const before = PromptAssets.target("project", "/prompt/mismatch/before/prompts")
    const after = PromptAssets.target("project", "/prompt/mismatch/after/prompts")
    const recheck = Promise.withResolvers<void>()
    const used: unknown[] = []

    const api = await PromptAssets.mock(page, {
      inspect: async (call, attempt) => {
        if (attempt === 3) await recheck.promise

        return PromptAssets.inspection(call, attempt <= 2 ? before : after)
      },
      apply: (_call, attempt) =>
        attempt === 1
          ? {
              status: 400,
              json: new InvalidRequestError({
                message: "Prompt target changed",
                field: "target",
                kind: "target_mismatch",
              }),
            }
          : { status: 200, json: PromptAssets.info("a", undefined, after) },
    })

    const workspace = await openSession(page, {
      name: "PromptMismatch",
      sessions: [{ id: sessionID, title: "Prompt mismatch" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: PromptAssets.history("mismatch", PromptAssets.body(), { ...SkillAssets.facts(), target: before }),
      }),
      onPrompt: (request) => void used.push(request),
      onCommand: (request) => void used.push(request),
    })

    await workspace.editor.fill("Keep mismatch draft")
    await openSidePanel(page, "Prompt proposals")
    const panel = page.locator('[data-component="prompt-proposals-panel"]')
    const confirmation = panel.getByRole("group", { name: "Confirm prompt save", exact: true })
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await confirmation.getByRole("button", { name: "Save prompt", exact: true }).click()
    await expect(panel).toContainText("The target directory changed. Recheck it and confirm the save again.")
    await expect(panel.getByRole("button", { name: "Review again", exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toHaveCount(0)
    await expect(confirmation).toHaveCount(0)
    expect(api.reads).toHaveLength(0)
    expect(api.calls).toHaveLength(1)

    try {
      await panel.getByRole("button", { name: "Recheck target", exact: true }).click()
      await expect.poll(() => api.inspections.length).toBe(3)
      await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
      await expect(confirmation).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      recheck.resolve()
      await expect(panel.getByText(after.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(before.root, { exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(confirmation).toHaveCount(0)
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await expect(confirmation.getByRole("button", { name: "Save prompt", exact: true })).toBeEnabled()
      expect(api.inspections).toHaveLength(4)
      expect(api.calls).toHaveLength(1)
      await confirmation.getByRole("button", { name: "Save prompt", exact: true }).click()
      await expect(panel).toContainText("Saved. Insert the template into your message when you are ready.")
    } finally {
      recheck.resolve()
    }

    expect(api.calls.map((call) => call.body)).toEqual(
      [before, after].map((target) => ({
        candidate: { ...PromptAssets.body(), relativePath: "Review.md" },
        overwrite: false,
        target,
      })),
    )
    await expect(workspace.editor).toHaveText("Keep mismatch draft")
    expect(api.reads).toHaveLength(0)
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
  })

  for (const scenario of ["catalog-target", "content-target", "content-revision"] as const) {
    test("blocks Prompt replacement after inconsistent " + scenario, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_prompt_cas_" + scenario
      const target = PromptAssets.target("project", "/prompt/cas/.aigcfroge/prompts")
      const wrong = PromptAssets.target("project", "/prompt/other/.aigcfroge/prompts")
      const current = PromptAssets.info("b", "Peer template", target)
      const used: unknown[] = []

      const api = await PromptAssets.mock(page, {
        inspect: (call) => PromptAssets.inspection(call, target),
        apply: () => ({ status: 409, json: new ConflictError({ resource: "Review.md", message: "Prompt changed" }) }),
        catalog: () =>
          PromptAssets.catalog(
            scenario === "catalog-target" ? PromptAssets.info("b", current.template, wrong) : current,
          ),
        content: () => ({
          status: 200,
          json: Match.value(scenario).pipe(
            Match.when("content-target", () => PromptAssets.info("b", current.template, wrong)),
            Match.when("content-revision", () => PromptAssets.info("c", current.template, target)),
            Match.orElse(() => current),
          ),
        }),
      })

      const workspace = await openSession(page, {
        name: "PromptCAS",
        sessions: [{ id: sessionID, title: "Prompt CAS" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: PromptAssets.history("cas", PromptAssets.body(), { ...SkillAssets.facts(), target }),
        }),
        onPrompt: (request) => void used.push(request),
        onCommand: (request) => void used.push(request),
      })

      await workspace.editor.fill("Keep CAS draft")
      await openSidePanel(page, "Prompt proposals")
      const panel = page.locator('[data-component="prompt-proposals-panel"]')
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save prompt", exact: true }).click()
      await expect(panel).toContainText(
        scenario === "content-revision"
          ? "The saved template changed. Review the current file before replacing or inserting it."
          : "Could not read a consistent current template. Ask for a new proposal.",
      )
      await expect(panel.getByRole("group", { name: "Confirm prompt replacement", exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Replace prompt", exact: true })).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
      expect(api.reads).toHaveLength(2)
      expect(api.reads.every((url) => url.searchParams.get("scope") === "project")).toBe(true)
      await expect(workspace.editor).toHaveText("Keep CAS draft")
      expect(api.deletes).toHaveLength(0)
      expect(used).toHaveLength(0)
    })
  }

  for (const scenario of [
    "unavailable",
    "changed",
    "same-sha-wrong-root",
    "same-sha-wrong-scope",
    "missing-target",
    "wrong-template",
  ] as const) {
    test("blocks insertion when the saved readback is " + scenario, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_prompt_read_" + scenario
      const target = PromptAssets.target("project", "/prompt/readback/.aigcfroge/prompts")
      const used: unknown[] = []

      const api = await PromptAssets.mock(page, {
        inspect: (call) => PromptAssets.inspection(call, target),
        apply: () => ({ status: 200, json: PromptAssets.info("a", undefined, target) }),
        content: () =>
          Match.value(scenario).pipe(
            Match.when("unavailable", () => ({
              status: 404,
              json: new ApiNotFoundError({ name: "NotFoundError", data: { message: "Gone" } }),
            })),
            Match.when("changed", () => ({ status: 200, json: PromptAssets.info("b", undefined, target) })),
            Match.when("same-sha-wrong-root", () => ({
              status: 200,
              json: PromptAssets.info("a", undefined, PromptAssets.target("project", "/other/.aigcfroge/prompts")),
            })),
            Match.when("same-sha-wrong-scope", () => ({
              status: 200,
              json: PromptAssets.info("a", undefined, PromptAssets.target("global", target.root)),
            })),
            Match.when("missing-target", () => ({ status: 200, json: PromptAssets.info("a") })),
            Match.when("wrong-template", () => ({
              status: 200,
              json: PromptAssets.info("a", "Unreviewed template", target),
            })),
            Match.exhaustive,
          ),
      })

      const workspace = await openSession(page, {
        name: "PromptReadback",
        sessions: [{ id: sessionID, title: "Prompt readback" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: PromptAssets.history(scenario, PromptAssets.body(), { ...SkillAssets.facts(), target }),
        }),
        onPrompt: (request) => void used.push(request),
        onCommand: (request) => void used.push(request),
      })

      await workspace.editor.fill("Keep this draft")
      await openSidePanel(page, "Prompt proposals")
      const panel = page.locator('[data-component="prompt-proposals-panel"]')
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save prompt", exact: true }).click()
      await panel.getByRole("button", { name: "Insert into message", exact: true }).click()
      await expect(panel).toContainText(
        scenario === "unavailable"
          ? "Could not read this saved version. Reconnect and try again."
          : "The saved template changed. Review the current file before replacing or inserting it.",
      )
      await expect(workspace.editor).toHaveText("Keep this draft")
      expect(api.reads).toHaveLength(1)
      expect(api.reads[0]?.searchParams.get("path")).toBe("Review.md")
      expect(api.reads[0]?.searchParams.get("scope")).toBe("project")
      expect(api.reads[0]?.searchParams.get("directory")).toBe(workspace.directory)
      expect(api.deletes).toHaveLength(0)
      expect(used).toHaveLength(0)
    })
  }

  for (const scenario of ["project-global-project", "same-scope recheck"] as const) {
    test("ignores a late Prompt inspection after " + scenario, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_prompt_inspect_" + scenario.replaceAll(/[- ]/g, "_")
      const project = PromptAssets.target("project", "/prompt/inspect/.aigcfroge/prompts")
      const shared = PromptAssets.target("global", "/prompt/inspect/global/prompts")
      const stale = PromptAssets.target("project", "/prompt/inspect/stale/prompts")
      const current = PromptAssets.target("project", "/prompt/inspect/current/prompts")
      const late = Promise.withResolvers<void>()
      const latest = Promise.withResolvers<void>()
      const currentAttempt = scenario === "project-global-project" ? 4 : 3
      const used: unknown[] = []

      const api = await PromptAssets.mock(page, {
        inspect: async (call, attempt) => {
          if (attempt === 2) {
            await late.promise

            return PromptAssets.inspection(call, stale)
          }

          if (attempt === currentAttempt) await latest.promise

          if (attempt >= currentAttempt)
            return PromptAssets.inspection(call, current, PromptAssets.info("b", undefined, current))

          return PromptAssets.inspection(call, attempt === 1 ? project : shared)
        },
        apply: () => {
          throw new Error("Canceled Prompt inspection must not save")
        },
      })

      const workspace = await openSession(page, {
        name: "PromptInspect",
        sessions: [{ id: sessionID, title: "Prompt inspection" }],
        pageMessages: pageMessagesFrom({
          [sessionID]: PromptAssets.history("inspect", PromptAssets.body(), {
            ...SkillAssets.facts(),
            target: project,
          }),
        }),
        onPrompt: (request) => void used.push(request),
        onCommand: (request) => void used.push(request),
      })

      await workspace.editor.fill("Keep inspection draft")
      await openSidePanel(page, "Prompt proposals")
      const panel = page.locator('[data-component="prompt-proposals-panel"]')
      const confirmation = panel.getByRole("group", { name: "Confirm prompt save", exact: true })
      await expect(panel.getByText(project.root, { exact: true })).toBeVisible()

      try {
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect.poll(() => api.inspections.length).toBe(2)
        await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)

        if (scenario === "project-global-project") {
          await panel.getByRole("button", { name: "Global", exact: true }).click()
          await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
          await panel.getByRole("button", { name: "Project", exact: true }).click()
        }

        if (scenario === "same-scope recheck")
          await panel.getByRole("button", { name: "Recheck target", exact: true }).click()
        await expect.poll(() => api.inspections.length).toBe(currentAttempt)
        await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)
        latest.resolve()
        await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
        await expect(panel.getByText("Existing file at the last check", { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect(confirmation.getByRole("button", { name: "Save prompt", exact: true })).toBeEnabled()
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      } finally {
        latest.resolve()
        late.resolve()
      }

      await expect.poll(() => api.inspectionReplies.length).toBe(currentAttempt + 1)
      await expect(panel.getByText(current.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(stale.root, { exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Project", exact: true })).toHaveAttribute("aria-pressed", "true")
      await expect(confirmation).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      expect(api.inspections.map((call) => call.body)).toEqual(
        (scenario === "project-global-project"
          ? ["project", "project", "global", "project", "project"]
          : ["project", "project", "project", "project"]
        ).map((scope) => ({ candidate: { ...PromptAssets.body(), relativePath: "Review.md" }, scope })),
      )
      await expect(workspace.editor).toHaveText("Keep inspection draft")
      expect(api.calls).toHaveLength(0)
      expect(api.deletes).toHaveLength(0)
      expect(used).toHaveLength(0)
    })
  }

  for (const scenario of ["apply", "catalog", "content", "insert"] as const) {
    test("ignores a late Prompt " + scenario + " reply after changing target", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_prompt_late_" + scenario
      const location = { directory: "/prompt/late/nested", workspaceID: "wrk_prompt_late" }
      const project = PromptAssets.target("project", "/prompt/late/.aigcfroge/prompts")
      const shared = PromptAssets.target("global", "/prompt/late/global/prompts")
      const current = PromptAssets.info("b", "Earlier Project template", project)
      const late = Promise.withResolvers<SkillAssets.Reply>()
      const catalog = Promise.withResolvers<PromptAssetListOutput>()
      const used: unknown[] = []

      const api = await PromptAssets.mock(page, {
        inspect: (call, attempt) => PromptAssets.inspection(call, attempt <= 2 ? project : shared),
        catalog: () => (scenario === "catalog" ? catalog.promise : PromptAssets.catalog(current)),
        content: () =>
          scenario === "content" || scenario === "insert" ? late.promise : { status: 200, json: current },
        apply: (_call, attempt) => {
          if (attempt > 1) return { status: 200, json: PromptAssets.info("c", undefined, shared) }

          if (scenario === "apply") return late.promise

          if (scenario === "insert") return { status: 200, json: PromptAssets.info("a", undefined, project) }

          return { status: 409, json: new ConflictError({ resource: "Review.md", message: "Project Prompt changed" }) }
        },
      })

      const workspace = await openSession(page, {
        name: "PromptLate",
        directory: location.directory,
        sessions: [{ id: sessionID, title: "Late Prompt reply", location }],
        pageMessages: pageMessagesFrom({
          [sessionID]: PromptAssets.history("late", PromptAssets.body(), { ...SkillAssets.facts(), target: project }),
        }),
        onPrompt: (request) => void used.push(request),
        onCommand: (request) => void used.push(request),
      })

      await workspace.editor.fill("Keep target draft")
      await openSidePanel(page, "Prompt proposals")
      const panel = page.locator('[data-component="prompt-proposals-panel"]')
      const confirmation = panel.getByRole("group", { name: "Confirm prompt save", exact: true })
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await confirmation.getByRole("button", { name: "Save prompt", exact: true }).click()

      try {
        await expect.poll(() => api.calls.length).toBe(1)

        if (scenario === "apply") await expect(panel.getByText("Saving prompt…", { exact: true })).toBeVisible()

        if (scenario === "catalog" || scenario === "content") {
          await expect.poll(() => api.reads.length).toBe(2)
          await expect(panel.getByText("Reading the current template…", { exact: true })).toBeVisible()
        }

        if (scenario === "insert") {
          await panel.getByRole("button", { name: "Insert into message", exact: true }).click()
          await expect.poll(() => api.reads.length).toBe(1)
          await expect(panel.getByRole("button", { name: "Reading saved template…", exact: true })).toBeDisabled()
        }

        await panel.getByRole("button", { name: "Global", exact: true }).click()
        await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
        await expect(confirmation).toHaveCount(0)
        await panel.getByRole("button", { name: "Review save", exact: true }).click()
        await expect(confirmation.getByRole("button", { name: "Save prompt", exact: true })).toBeEnabled()
      } finally {
        late.resolve({
          status: 200,
          json: scenario === "apply" || scenario === "insert" ? PromptAssets.info("a", undefined, project) : current,
        })
        catalog.resolve(PromptAssets.catalog(current))
      }

      await expect.poll(() => api.replies.length).toBe(1)
      await expect
        .poll(() => api.readReplies.length)
        .toBe(scenario === "catalog" || scenario === "content" ? 2 : scenario === "insert" ? 1 : 0)
      await expect(panel.getByText(shared.root, { exact: true })).toBeVisible()
      await expect(panel.getByText(project.root, { exact: true })).toHaveCount(0)
      await expect(panel.locator('[data-component="skill-save-result"]')).toHaveCount(0)
      await expect(panel.getByRole("group", { name: "Confirm prompt replacement", exact: true })).toHaveCount(0)
      await expect(confirmation.getByRole("button", { name: "Save prompt", exact: true })).toBeEnabled()
      await expect(workspace.editor).toHaveText("Keep target draft")
      expect(used).toHaveLength(0)
      await confirmation.getByRole("button", { name: "Save prompt", exact: true }).click()
      await expect(panel).toContainText("Saved. Insert the template into your message when you are ready.")
      expect(api.calls.map((call) => call.body)).toEqual(
        [project, shared].map((target) => ({
          candidate: { ...PromptAssets.body(), relativePath: "Review.md" },
          target,
          overwrite: false,
        })),
      )
      expect(
        [...api.inspections, ...api.calls].every(
          (call) =>
            call.sessionID === sessionID &&
            call.url.searchParams.get("directory") === location.directory &&
            call.url.searchParams.get("workspace") === location.workspaceID,
        ),
      ).toBe(true)
      expect(api.reads.every((url) => url.searchParams.get("scope") === "project")).toBe(true)
      expect(api.deletes).toHaveLength(0)
      expect(used).toHaveLength(0)
    })
  }

  for (const change of ["proposal", "session", "server", "unmount"] as const) {
    test("ignores a late Prompt save after changing " + change + " owner", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const directory = "/prompt/owner/nested"
      const a = "ses_prompt_owner_" + change
      const b = change === "server" ? a : a + "_next"
      const target = PromptAssets.target("project", "/prompt/owner/.aigcfroge/prompts")
      const alpha = PromptAssets.body()

      const beta =
        change === "server"
          ? alpha
          : { ...alpha, name: "OtherPrompt", template: "Template for the other Prompt owner." }

      const first = PromptAssets.history("alpha", alpha, { ...SkillAssets.facts(), target })

      const next = PromptAssets.history("beta", beta, {
        ...SkillAssets.facts(change === "server" ? "Review.md" : "OtherPrompt.md"),
        target,
      })

      const reply = Promise.withResolvers<SkillAssets.Reply>()
      const used: unknown[] = []

      const api = await PromptAssets.mock(page, {
        inspect: (call) => PromptAssets.inspection(call, target),
        apply: () => reply.promise,
      })

      if (change === "server")
        await mockRemoteServer(page, {
          name: "Other Prompt server",
          directory,
          provider: provider(),
          sessions: [session({ id: b, title: "Other Prompt owner", directory })],
          pageMessages: pageMessagesFrom({ [b]: first }),
          onPrompt: (request) => void used.push(request),
          onCommand: (request) => void used.push(request),
        })

      const options: Parameters<typeof openSession>[1] = {
        name: "PromptOwner",
        directory,
        sessions:
          change === "server" || change === "proposal"
            ? [{ id: a, title: "Original Prompt owner" }]
            : [
                { id: a, title: "Original Prompt owner" },
                { id: b, title: "Other Prompt owner" },
              ],
        pageMessages: pageMessagesFrom(
          Match.value(change).pipe(
            Match.when("proposal", () => ({ [a]: [...first, ...next] })),
            Match.when("server", () => ({ [a]: first })),
            Match.orElse(() => ({ [a]: first, [b]: next })),
          ),
        ),
        onPrompt: (request) => void used.push(request),
        onCommand: (request) => void used.push(request),
      }

      if (change === "server") options.seed = { tabs: [a, { session: b, server: REMOTE_SERVER }] }

      const workspace = await openSession(page, options)
      await workspace.editor.fill("Original Prompt draft")
      await openSidePanel(page, "Prompt proposals")
      const panel = page.locator('[data-component="prompt-proposals-panel"]')

      if (change === "proposal") await panel.getByRole("button", { name: "Review", exact: true }).click()
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save prompt", exact: true }).click()

      try {
        await expect.poll(() => api.calls.length).toBe(1)
        await expect(panel.getByText("Saving prompt…", { exact: true })).toBeVisible()

        if (change === "proposal") await panel.getByRole("button", { name: "OtherPrompt", exact: true }).click()

        if (change === "session" || change === "server")
          await page.locator("[data-titlebar-tab-slot]", { hasText: "Other Prompt owner" }).click()

        if (change === "unmount") {
          await page
            .locator("[data-titlebar-tab-slot]", { hasText: "Original Prompt owner" })
            .getByRole("button", { name: "Close tab", exact: true })
            .click()
          await expect(page.locator("[data-titlebar-tab-slot]", { hasText: "Original Prompt owner" })).toHaveCount(0)
        }

        if (change !== "proposal") {
          await expectSessionTitle(page, "Other Prompt owner")
          await openSidePanel(page, "Prompt proposals")
        }

        await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveJSProperty(
          "textContent",
          beta.template,
        )
        await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
        await expect(panel.getByRole("group", { name: "Confirm prompt save", exact: true })).toHaveCount(0)
        await workspace.editor.fill("Other Prompt draft")
      } finally {
        reply.resolve({ status: 200, json: PromptAssets.info("a", undefined, target) })
      }

      await expect.poll(() => api.replies.length).toBe(1)
      await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveJSProperty(
        "textContent",
        beta.template,
      )
      await expect(panel.locator('[data-component="skill-save-result"]')).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Insert into message", exact: true })).toHaveCount(0)
      await expect(workspace.editor).toHaveText("Other Prompt draft")
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      const confirmation = panel.getByRole("group", { name: "Confirm prompt save", exact: true })
      await expect(confirmation.getByRole("button", { name: "Save prompt", exact: true })).toBeEnabled()
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
      expect(api.calls).toHaveLength(1)
      expect(api.calls[0]?.sessionID).toBe(a)
      expect(api.calls[0]?.body).toEqual({
        candidate: { ...alpha, relativePath: "Review.md" },
        target,
        overwrite: false,
      })
      expect(
        [...api.inspections, ...api.calls].every((call) => call.url.searchParams.get("directory") === directory),
      ).toBe(true)

      if (change === "server") {
        expect(api.calls[0]?.url.origin).not.toBe(REMOTE_SERVER)
        expect(
          api.inspections.filter((call) => call.url.origin === REMOTE_SERVER).map((call) => call.sessionID),
        ).toEqual([a, a])
      }

      expect(api.deletes).toHaveLength(0)
      expect(used).toHaveLength(0)
    })
  }

  test("revokes a pending Prompt inspection across disconnect and reconnect", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_prompt_reconnect"
    const before = PromptAssets.target("project", "/prompt/reconnect/before/prompts")
    const after = PromptAssets.target("project", "/prompt/reconnect/after/prompts")
    const late = Promise.withResolvers<void>()
    const used: unknown[] = []
    const transport = await installSseTransport(page, { server: SERVER })

    const api = await PromptAssets.mock(page, {
      inspect: async (call, attempt) => {
        if (attempt === 2) await late.promise

        return PromptAssets.inspection(call, attempt <= 2 ? before : after)
      },
      apply: () => {
        throw new Error("Reconnecting does not authorize a Prompt save")
      },
    })

    const workspace = await openSession(page, {
      name: "PromptReconnect",
      sessions: [{ id: sessionID, title: "Prompt reconnect" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: PromptAssets.history("reconnect", PromptAssets.body(), { ...SkillAssets.facts(), target: before }),
      }),
      onPrompt: (request) => void used.push(request),
      onCommand: (request) => void used.push(request),
    })

    await workspace.editor.fill("Keep reconnect draft")
    const connection = await transport.waitForConnection()
    await openSidePanel(page, "Prompt proposals")
    const panel = page.locator('[data-component="prompt-proposals-panel"]')
    const confirmation = panel.getByRole("group", { name: "Confirm prompt save", exact: true })
    await expect(panel.getByText(before.root, { exact: true })).toBeVisible()

    try {
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await expect.poll(() => api.inspections.length).toBe(2)
      await expect(panel.getByText("Checking the selected target…", { exact: true })).toBeVisible()
      await transport.disconnect()
      await transport.waitForConnection({ after: connection.id })
      await expect(panel.getByText(after.root, { exact: true })).toBeVisible()
      await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
      await expect(confirmation).toHaveCount(0)
    } finally {
      late.resolve()
    }

    await expect.poll(() => api.inspectionReplies.length).toBe(api.inspections.length)
    await expect(panel.getByText(after.root, { exact: true })).toBeVisible()
    await expect(panel.getByText(before.root, { exact: true })).toHaveCount(0)
    await expect(confirmation).toHaveCount(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirmation.getByRole("button", { name: "Save prompt", exact: true })).toBeEnabled()
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(workspace.editor).toHaveText("Keep reconnect draft")
    expect(api.calls).toHaveLength(0)
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
  })

  test("discards a pending content read after navigation instead of editing the next Session", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const a = "ses_prompt_pending_a"
    const b = "ses_prompt_pending_b"
    const target = PromptAssets.target("project", "/prompt/pending/.aigcfroge/prompts")
    const reply = Promise.withResolvers<SkillAssets.Reply>()
    const used: unknown[] = []

    const api = await PromptAssets.mock(page, {
      inspect: (call) => PromptAssets.inspection(call, target),
      apply: () => ({ status: 200, json: PromptAssets.info("a", undefined, target) }),
      content: () => reply.promise,
    })

    const workspace = await openSession(page, {
      name: "PromptPending",
      sessions: [
        { id: a, title: "Prompt Alpha" },
        { id: b, title: "Prompt Beta" },
      ],
      pageMessages: pageMessagesFrom({
        [a]: PromptAssets.history("pending", PromptAssets.body(), { ...SkillAssets.facts(), target }),
      }),
      onPrompt: (request) => void used.push(request),
      onCommand: (request) => void used.push(request),
    })

    await workspace.editor.fill("Alpha draft")
    await openSidePanel(page, "Prompt proposals")
    const panel = page.locator('[data-component="prompt-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save prompt", exact: true }).click()
    await panel.getByRole("button", { name: "Insert into message", exact: true }).click()

    try {
      await expect.poll(() => api.reads.length).toBe(1)
      await expect(panel.getByRole("button", { name: "Reading saved template…", exact: true })).toBeDisabled()
      await page.locator("[data-titlebar-tab-slot]", { hasText: "Prompt Beta" }).click()
      await expectSessionTitle(page, "Prompt Beta")
      await workspace.editor.fill("Beta draft")
    } finally {
      reply.resolve({ status: 200, json: PromptAssets.info("a", undefined, target) })
    }

    await expect.poll(() => api.readReplies.length).toBe(1)
    await expect(workspace.editor).toHaveText("Beta draft")
    await page.locator("[data-titlebar-tab-slot]", { hasText: "Prompt Alpha" }).click()
    await expectSessionTitle(page, "Prompt Alpha")
    await expect(workspace.editor).toHaveText("Alpha draft")
    expect(api.reads[0]?.searchParams.get("scope")).toBe("project")
    expect(api.reads[0]?.searchParams.get("path")).toBe("Review.md")
    expect(api.deletes).toHaveLength(0)
    expect(used).toHaveLength(0)
  })
})

test.describe("Agent proposal panel", () => {
  test("reviews full configuration, instructions and warnings before saving without submitting the draft", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_agent_gui"
    const body = AgentAssets.body()
    const used: unknown[] = []

    const api = await AgentAssets.mock(page, {
      apply: () => ({ status: 200, json: { asset: AgentAssets.info("a"), warnings: AgentAssets.warnings() } }),
    })

    const workspace = await openSession(page, {
      name: "AgentGui",
      sessions: [{ id: sessionID, title: "Agent GUI" }],
      pageMessages: pageMessagesFrom({ [sessionID]: AgentAssets.history("fresh") }),
      onPrompt: (request) => void used.push(request),
    })

    await workspace.editor.fill("Keep this draft")
    await openSidePanel(page, "Agent proposals")
    const panel = page.locator('[data-component="agent-proposals-panel"]')
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveText([body.config, body.source])
    const warning = panel.getByRole("region", { name: "Permission warnings", exact: true })
    await expect(warning).toContainText("Broad permission allowed: read for *.")
    await expect(warning).toContainText("Sensitive action allowed: bash for *.")
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel.getByRole("group", { name: "Confirm agent save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Cancel", exact: true }).click()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save agent", exact: true }).click()
    const saved = panel.locator('[data-component="skill-save-result"]')
    await expect(saved).toContainText("Agent file saved.")
    await expect(saved.getByRole("region", { name: "Permission warnings", exact: true })).toContainText(
      "Sensitive action allowed: bash for *.",
    )
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(sessionID)
    expect(api.calls[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.calls[0]?.body).toEqual({ candidate: { ...body, relativePath: "Review.md" }, overwrite: false })
    await expect(workspace.editor).toHaveText("Keep this draft")
    expect(used).toHaveLength(0)
    await expect(saved.getByRole("button")).toHaveCount(0)
  })

  test("replaces only the displayed Agent revision through the narrow keyboard flow", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 })
    const sessionID = "ses_agent_replace"
    const current = AgentAssets.info("b", "mode: subagent", "Existing instructions")

    await openSession(page, {
      name: "AgentReplace",
      sessions: [{ id: sessionID, title: "Agent replacement" }],
      pageMessages: pageMessagesFrom({ [sessionID]: AgentAssets.history("replace") }),
      seed: { theme: { id: "oc-2", scheme: "dark" } },
    })

    const api = await AgentAssets.mock(page, {
      apply: (_, attempt) =>
        attempt === 1
          ? { status: 409, json: new ConflictError({ resource: current.relativePath, message: "File exists" }) }
          : { status: 200, json: { asset: AgentAssets.info("c"), warnings: AgentAssets.warnings() } },
      catalog: () => ({ assets: [current], invalid: [] }),
      content: () => ({ status: 200, json: current }),
    })

    await page
      .locator('[data-slot="session-mobile-view-tabs"]')
      .getByRole("tab", { name: "More...", exact: true })
      .click()
    await page
      .locator('[data-slot="session-mobile-view-options"]')
      .getByRole("button", { name: "Agent proposals", exact: true })
      .click()
    const panel = page.locator('[data-component="agent-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).press("Enter")
    await panel.getByRole("button", { name: "Save agent", exact: true }).press("Enter")
    const confirm = panel.getByRole("group", { name: "Confirm agent replacement", exact: true })
    await expect(confirm).toBeVisible()
    await expect(confirm.locator("pre")).toHaveText([current.config, current.source])
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    expect(api.calls).toHaveLength(1)
    await confirm.getByRole("button", { name: "Replace agent", exact: true }).press("Enter")
    await expect(panel).toContainText("Agent file saved.")
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.body).toEqual({
      candidate: { ...AgentAssets.body(), relativePath: "Review.md" },
      baseRevision: current.revision,
      overwrite: true,
    })
  })

  test("shows current handoffs and blocks a replacement that cannot preserve them", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_agent_handoffs"

    const current = {
      ...AgentAssets.info("b"),
      handoffs: [{ label: "Build", agent: "build", prompt: "Implement the plan", send: false }],
    }

    await openSession(page, {
      name: "AgentHandoffs",
      sessions: [{ id: sessionID, title: "Agent handoffs" }],
      pageMessages: pageMessagesFrom({ [sessionID]: AgentAssets.history("handoffs") }),
    })

    const api = await AgentAssets.mock(page, {
      apply: () => ({
        status: 409,
        json: new ConflictError({ resource: current.relativePath, message: "File exists" }),
      }),
      catalog: () => ({ assets: [current], invalid: [] }),
      content: () => ({ status: 200, json: current }),
    })

    await openSidePanel(page, "Agent proposals")
    const panel = page.locator('[data-component="agent-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save agent", exact: true }).click()
    const confirm = panel.getByRole("group", { name: "Confirm agent replacement", exact: true })
    await expect(confirm).toBeVisible()
    await expect(confirm.locator("pre")).toHaveText([
      current.config,
      JSON.stringify(current.handoffs, null, 2),
      current.source,
    ])
    await expect(confirm).toContainText(
      "This agent has handoffs. Replacement is unavailable until they can be preserved.",
    )
    await expect(confirm.getByRole("button", { name: "Replace agent", exact: true })).toBeDisabled()
    expect(api.calls).toHaveLength(1)
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(1)
  })
})

test.describe("MCP proposal panel", () => {
  test("reviews complete configuration and restores its tab without sending or connecting", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_mcp_gui"
    const body = McpAssets.body()
    const used: unknown[] = []
    const connections: string[] = []
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname

      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        /(?:\/api\/experimental\/mcp|\/mcp)(?:\/|$)/.test(path)
      )
        connections.push(path)
    })
    const api = await McpAssets.mock(page, { apply: () => ({ status: 200, json: McpAssets.info("a") }) })

    const workspace = await openSession(page, {
      name: "McpGui",
      sessions: [{ id: sessionID, title: "MCP GUI" }],
      pageMessages: pageMessagesFrom({ [sessionID]: McpAssets.history("fresh") }),
      onPrompt: (request) => void used.push(request),
    })

    await workspace.editor.fill("Keep this MCP draft")
    await openSidePanel(page, "MCP proposals")
    const panel = page.locator('[data-component="mcp-proposals-panel"]')
    await expect(panel.getByText(body.command, { exact: true })).toBeVisible()
    await expect(panel.getByText(body.command, { exact: true })).toHaveCSS("white-space", "pre-wrap")
    await expect(panel.getByText(body.command, { exact: true })).toHaveJSProperty("textContent", body.command)
    await expect(panel.locator("pre")).toHaveText([
      body.command,
      JSON.stringify(body.args, null, 2),
      JSON.stringify(body.env, null, 2),
      body.configJson,
    ])
    await expect(panel).toContainText("Environment values are saved as plain text in this file.")
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(panel.getByRole("group", { name: "Confirm MCP save", exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Cancel", exact: true }).click()
    expect(api.calls).toHaveLength(0)
    await page.reload()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    await expect(panel.getByRole("group", { name: "Confirm MCP save", exact: true })).toHaveCount(0)
    await expect(workspace.editor).toHaveText("Keep this MCP draft")
    await page.screenshot({ path: testInfo.outputPath("mcp-review-desktop.png") })
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save MCP file", exact: true }).click()
    const saved = panel.locator('[data-component="skill-save-result"]')
    await expect(saved).toHaveText("MCP file saved.")
    await expect(saved.getByRole("button")).toHaveCount(0)
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(sessionID)
    expect(api.calls[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.calls[0]?.body).toEqual({ candidate: { ...body, relativePath: "Review.md" }, overwrite: false })
    await expect(workspace.editor).toHaveText("Keep this MCP draft")
    expect(used).toHaveLength(0)
    expect(connections).toHaveLength(0)
  })

  test("reviews the current MCP fields and replaces its revision through the narrow keyboard flow", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 600, height: 900 })
    const sessionID = "ses_mcp_replace"

    const current = McpAssets.info("b", {
      ...McpAssets.body(),
      command: "old-runner",
      args: ["old-server.cjs", "--old"],
      env: { OLD_LABEL: "Existing environment" },
      configJson: '{ "old": true }\n',
    })

    const api = await McpAssets.mock(page, {
      apply: (_, attempt) =>
        attempt === 1
          ? { status: 409, json: new ConflictError({ resource: current.relativePath, message: "File exists" }) }
          : { status: 200, json: McpAssets.info("c") },
      catalog: () => ({ assets: [current], invalid: [] }),
      content: () => ({ status: 200, json: current }),
    })

    await openSession(page, {
      name: "McpReplace",
      sessions: [{ id: sessionID, title: "MCP replacement" }],
      pageMessages: pageMessagesFrom({ [sessionID]: McpAssets.history("replace") }),
      seed: { theme: { id: "oc-2", scheme: "dark" } },
    })
    await page
      .locator('[data-slot="session-mobile-view-tabs"]')
      .getByRole("tab", { name: "More...", exact: true })
      .click()
    await page
      .locator('[data-slot="session-mobile-view-options"]')
      .getByRole("button", { name: "MCP proposals", exact: true })
      .click()
    const panel = page.locator('[data-component="mcp-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).press("Enter")
    await panel.getByRole("button", { name: "Save MCP file", exact: true }).press("Enter")
    const confirm = panel.getByRole("group", { name: "Confirm MCP replacement", exact: true })
    await expect(confirm).toBeVisible()
    await expect(confirm.getByText(current.command, { exact: true })).toBeVisible()
    await expect(confirm.locator("pre")).toHaveText([
      current.command,
      JSON.stringify(current.args, null, 2),
      JSON.stringify(current.env, null, 2),
      current.configJson,
    ])
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    await confirm.getByRole("button", { name: "Replace MCP file", exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath("mcp-replacement-narrow.png") })
    expect(api.calls).toHaveLength(1)
    await confirm.getByRole("button", { name: "Replace MCP file", exact: true }).press("Enter")
    await expect(panel).toContainText("MCP file saved.")
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.body).toEqual({
      candidate: { ...McpAssets.body(), relativePath: "Review.md" },
      baseRevision: current.revision,
      overwrite: true,
    })
  })

  test("shows a failed confirmation when the server drops reviewed environment fields", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_mcp_readback"

    const api = await McpAssets.mock(page, {
      apply: () => ({ status: 200, json: { ...McpAssets.info("a"), env: {} } }),
    })

    await openSession(page, {
      name: "McpReadback",
      sessions: [{ id: sessionID, title: "MCP readback" }],
      pageMessages: pageMessagesFrom({ [sessionID]: McpAssets.history("readback") }),
    })
    await openSidePanel(page, "MCP proposals")
    const panel = page.locator('[data-component="mcp-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save MCP file", exact: true }).click()
    await expect(panel).toContainText(
      "The response does not match the reviewed MCP configuration. Check the current file.",
    )
    await expect(panel.getByText("MCP file saved.", { exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review again", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
  })
})

test.describe("Plugin proposal panel", () => {
  test("reviews original YAML and reload risk before saving without sending the draft", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_plugin_gui"
    const body = PluginAssets.body()
    const used: unknown[] = []
    const runtimeWrites: string[] = []
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname

      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        /(?:\/api\/(?:experimental\/mcp|plugin)|\/mcp)(?:\/|$)/.test(path)
      )
        runtimeWrites.push(path)
    })
    const api = await PluginAssets.mock(page, { apply: () => ({ status: 200, json: PluginAssets.info("a") }) })

    const workspace = await openSession(page, {
      name: "PluginGui",
      sessions: [{ id: sessionID, title: "Plugin GUI" }],
      pageMessages: pageMessagesFrom({ [sessionID]: PluginAssets.history("fresh") }),
      onPrompt: (request) => void used.push(request),
    })

    await workspace.editor.fill("Keep this plugin draft")
    await openSidePanel(page, "Plugin proposals")
    const panel = page.locator('[data-component="plugin-proposals-panel"]')
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveJSProperty(
      "textContent",
      body.content,
    )
    await expect(panel).toContainText("Changes in the shared plugin directory may reload existing plugins.")
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    const confirm = panel.getByRole("group", { name: "Confirm plugin declaration save", exact: true })
    await expect(confirm).toContainText("Changing the shared plugin directory may reload existing plugins.")
    expect(api.calls).toHaveLength(0)
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
    expect(api.calls).toHaveLength(0)
    await page.reload()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    await expect(confirm).toHaveCount(0)
    await expect(workspace.editor).toHaveText("Keep this plugin draft")
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await page.screenshot({ path: testInfo.outputPath("plugin-review-desktop.png") })
    await confirm.getByRole("button", { name: "Save declaration", exact: true }).click()
    const saved = panel.locator('[data-component="skill-save-result"]')
    await expect(saved).toHaveText("Plugin declaration file saved.")
    await expect(saved.getByRole("button")).toHaveCount(0)
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(sessionID)
    expect(api.calls[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.calls[0]?.body).toEqual({ candidate: { ...body, relativePath: "Review.plugin.yaml" }, overwrite: false })
    await expect(workspace.editor).toHaveText("Keep this plugin draft")
    expect(used).toHaveLength(0)
    expect(runtimeWrites).toHaveLength(0)
  })

  test("shows current YAML with a source object and replaces only its reviewed revision on narrow screens", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 600, height: 900 })
    const sessionID = "ses_plugin_replace"
    const current = PluginAssets.info("b", PluginAssets.body().content.replace("extra: preserved", "extra: current"))

    const api = await PluginAssets.mock(page, {
      apply: (_, attempt) =>
        attempt === 1
          ? { status: 409, json: new ConflictError({ resource: current.relativePath, message: "File exists" }) }
          : { status: 200, json: PluginAssets.info("c") },
      catalog: () => ({ assets: [{ ...current, source: "mcp", toolCount: 0 }], invalid: [], bridged: [] }),
      content: () => ({ status: 200, json: current }),
    })

    await openSession(page, {
      name: "PluginReplace",
      sessions: [{ id: sessionID, title: "Plugin replacement" }],
      pageMessages: pageMessagesFrom({ [sessionID]: PluginAssets.history("replace") }),
      seed: { theme: { id: "oc-2", scheme: "dark" } },
    })
    await page
      .locator('[data-slot="session-mobile-view-tabs"]')
      .getByRole("tab", { name: "More...", exact: true })
      .click()
    await page
      .locator('[data-slot="session-mobile-view-options"]')
      .getByRole("button", { name: "Plugin proposals", exact: true })
      .click()
    const panel = page.locator('[data-component="plugin-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).press("Enter")
    await panel.getByRole("button", { name: "Save declaration", exact: true }).press("Enter")
    const confirm = panel.getByRole("group", { name: "Confirm plugin declaration replacement", exact: true })
    await expect(confirm.locator("pre")).toHaveJSProperty("textContent", current.content)
    await expect(confirm).toContainText("Changing the shared plugin directory may reload existing plugins.")
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    expect(api.calls).toHaveLength(1)
    await confirm.getByRole("button", { name: "Replace declaration", exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath("plugin-replacement-narrow.png") })
    await confirm.getByRole("button", { name: "Replace declaration", exact: true }).press("Enter")
    await expect(panel).toContainText("Plugin declaration file saved.")
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.body).toEqual({
      candidate: { ...PluginAssets.body(), relativePath: "Review.plugin.yaml" },
      baseRevision: current.revision,
      overwrite: true,
    })
  })

  test("rejects a successful reply that drops the reviewed BOM or comments", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_plugin_readback"

    const api = await PluginAssets.mock(page, {
      apply: () => ({
        status: 200,
        json: PluginAssets.info("a", PluginAssets.body().content.replace("\uFEFF# Keep this comment\n", "")),
      }),
    })

    await openSession(page, {
      name: "PluginReadback",
      sessions: [{ id: sessionID, title: "Plugin readback" }],
      pageMessages: pageMessagesFrom({ [sessionID]: PluginAssets.history("readback") }),
    })
    await openSidePanel(page, "Plugin proposals")
    const panel = page.locator('[data-component="plugin-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await panel.getByRole("button", { name: "Save declaration", exact: true }).click()
    await expect(panel).toContainText("The response does not match the reviewed declaration. Check the current file.")
    await expect(panel.getByText("Plugin declaration file saved.", { exact: true })).toHaveCount(0)
    await expect(panel.getByRole("button", { name: "Review again", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(1)
  })
})

test.describe("Workflow proposal panel", () => {
  test("reviews original YAML, resets confirmation on reload and saves only the Workflow declaration", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const sessionID = "ses_workflow_gui"
    const body = WorkflowAssets.body()
    const result = WorkflowAssets.info("a")
    const prompts: unknown[] = []
    const runtimeWrites: string[] = []
    const api = await WorkflowAssets.mock(page, { apply: () => ({ status: 200, json: result }) })
    const plugins = await PluginAssets.mock(page, { apply: () => ({ status: 200, json: PluginAssets.info("a") }) })

    const workspace = await openSession(page, {
      name: "WorkflowGui",
      sessions: [{ id: sessionID, title: "Workflow GUI" }],
      pageMessages: pageMessagesFrom({
        [sessionID]: [...PluginAssets.history("same-shape"), ...WorkflowAssets.history("same-shape")],
      }),
      onPrompt: (request) => void prompts.push(request),
      seed: { theme: { id: "oc-2", scheme: "light" } },
    })

    page.on("request", (request) => {
      const path = new URL(request.url()).pathname

      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        (path === "/api/session" || /\/session\/[^/]+\/(?:prompt|workflow|fork)(?:\/|$)/.test(path))
      )
        runtimeWrites.push(path)
    })
    await workspace.editor.fill("Keep this workflow draft")
    await openSidePanel(page, "Plugin proposals")
    await expect(
      page.locator('[data-component="plugin-proposals-panel"] [data-component="skill-candidate"] > pre'),
    ).toHaveJSProperty("textContent", PluginAssets.body().content)
    await openSidePanel(page, "Workflow proposals")
    const panel = page.locator('[data-component="workflow-proposals-panel"]')
    await expect(panel.locator('[data-component="skill-candidate"]')).toHaveCount(1)
    await expect(panel.locator('[data-component="skill-candidate"] > pre')).toHaveJSProperty(
      "textContent",
      body.content,
    )
    await expect(panel).toContainText("Review.plugin.yaml")
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    const confirm = panel.getByRole("group", { name: "Confirm workflow declaration save", exact: true })
    await expect(confirm.getByRole("button", { name: "Save declaration", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(0)
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(confirm).toBeVisible()
    await page.reload()
    await expect(panel.getByRole("button", { name: "Review save", exact: true })).toBeEnabled()
    await expect(confirm).toHaveCount(0)
    await expect(workspace.editor).toHaveText("Keep this workflow draft")
    expect(api.calls).toHaveLength(0)
    await panel.getByRole("button", { name: "Review save", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    await page.screenshot({ path: testInfo.outputPath("workflow-review-desktop.png") })
    await confirm.getByRole("button", { name: "Save declaration", exact: true }).click()
    const saved = panel.locator('[data-component="skill-save-result"]')
    await expect(saved.getByText("Workflow declaration file saved.", { exact: true })).toBeVisible()
    await expect(saved.getByRole("button")).toHaveCount(0)
    const declaration = saved.locator("dl").filter({ has: page.getByText("Version", { exact: true }) })
    await expect(declaration).toContainText("Version")
    await expect(declaration.getByText(result.version, { exact: true })).toBeVisible()
    await expect(
      declaration.getByText("Triggers", { exact: true }).locator("xpath=following-sibling::dd[1]/pre"),
    ).toHaveJSProperty("textContent", JSON.stringify(result.triggers, null, 2))
    await expect(
      declaration.getByText("Steps", { exact: true }).locator("xpath=following-sibling::dd[1]/pre"),
    ).toHaveJSProperty("textContent", JSON.stringify(result.steps, null, 2))
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]?.sessionID).toBe(sessionID)
    expect(api.calls[0]?.url.searchParams.get("directory")).toBe(workspace.directory)
    expect(api.calls[0]?.body).toEqual({ candidate: { ...body, relativePath: "Review.plugin.yaml" }, overwrite: false })
    expect(plugins.calls).toHaveLength(0)
    expect(prompts).toHaveLength(0)
    expect(runtimeWrites).toHaveLength(0)
    await expect(workspace.editor).toHaveText("Keep this workflow draft")
  })

  test("shows complete current steps and requires a new CAS confirmation after each conflict on narrow screens", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 600, height: 900 })
    const sessionID = "ses_workflow_replace"

    const current = {
      value: WorkflowAssets.info("b", WorkflowAssets.body().content.replace("extra: preserved", "extra: B")),
    }

    await openSession(page, {
      name: "WorkflowReplace",
      sessions: [{ id: sessionID, title: "Workflow replacement" }],
      pageMessages: pageMessagesFrom({ [sessionID]: WorkflowAssets.history("replace") }),
      seed: { theme: { id: "oc-2", scheme: "dark" } },
    })
    const api = await WorkflowAssets.mock(page, {
      apply: (_, attempt) => {
        if (attempt === 2)
          current.value = WorkflowAssets.info(
            "c",
            WorkflowAssets.body().content.replace("extra: preserved", "extra: C"),
          )

        if (attempt === 3) return { status: 200, json: WorkflowAssets.info("d") }

        return {
          status: 409,
          json: new ConflictError({
            resource: current.value.relativePath,
            message: "Current declaration requires review",
          }),
        }
      },
      catalog: () => ({ assets: [current.value], invalid: [] }),
      content: () => ({ status: 200, json: current.value }),
    })

    await page
      .locator('[data-slot="session-mobile-view-tabs"]')
      .getByRole("tab", { name: "More...", exact: true })
      .click()
    await page
      .locator('[data-slot="session-mobile-view-options"]')
      .getByRole("button", { name: "Workflow proposals", exact: true })
      .click()
    const panel = page.locator('[data-component="workflow-proposals-panel"]')
    await panel.getByRole("button", { name: "Review save", exact: true }).press("Enter")
    await panel.getByRole("button", { name: "Save declaration", exact: true }).press("Enter")
    const confirm = panel.getByRole("group", { name: "Confirm workflow declaration replacement", exact: true })
    await expect(confirm.locator(":scope > pre")).toHaveJSProperty("textContent", current.value.content)
    await expect(
      confirm.getByText("Triggers", { exact: true }).locator("xpath=following-sibling::dd[1]/pre"),
    ).toHaveJSProperty("textContent", JSON.stringify(current.value.triggers, null, 2))
    await expect(
      confirm.getByText("Steps", { exact: true }).locator("xpath=following-sibling::dd[1]/pre"),
    ).toHaveJSProperty("textContent", JSON.stringify(current.value.steps, null, 2))
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
    expect(api.calls).toHaveLength(1)
    await confirm.getByRole("button", { name: "Replace declaration", exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath("workflow-replacement-narrow.png") })
    await confirm.getByRole("button", { name: "Replace declaration", exact: true }).press("Enter")
    await expect(confirm.locator(":scope > pre")).toHaveJSProperty(
      "textContent",
      WorkflowAssets.body().content.replace("extra: preserved", "extra: C"),
    )
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]?.body).toEqual({
      candidate: { ...WorkflowAssets.body(), relativePath: "Review.plugin.yaml" },
      baseRevision: "b".repeat(64),
      overwrite: true,
    })
    await expect(confirm.getByRole("button", { name: "Replace declaration", exact: true })).toBeEnabled()
    await confirm.getByRole("button", { name: "Replace declaration", exact: true }).press("Enter")
    await expect(panel.getByText("Workflow declaration file saved.", { exact: true })).toBeVisible()
    expect(api.calls).toHaveLength(3)
    expect(api.calls[2]?.body).toEqual({
      candidate: { ...WorkflowAssets.body(), relativePath: "Review.plugin.yaml" },
      baseRevision: "c".repeat(64),
      overwrite: true,
    })
    expect(api.reads.filter((url) => url.pathname === "/workflow-asset/content")).toHaveLength(2)
  })

  for (const failure of ["changed original YAML", "wrong asset kind"]) {
    test("rejects a successful Workflow reply with " + failure, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      const sessionID = "ses_workflow_readback"

      const api = await WorkflowAssets.mock(page, {
        apply: () => ({
          status: 200,
          json:
            failure === "changed original YAML"
              ? WorkflowAssets.info(
                  "a",
                  WorkflowAssets.body().content.replace("\uFEFF# Keep the original workflow declaration\r\n", ""),
                )
              : { ...WorkflowAssets.info("a"), kind: "plugin" },
        }),
      })

      await openSession(page, {
        name: "WorkflowReadback",
        sessions: [{ id: sessionID, title: "Workflow readback" }],
        pageMessages: pageMessagesFrom({ [sessionID]: WorkflowAssets.history("readback") }),
      })
      await openSidePanel(page, "Workflow proposals")
      const panel = page.locator('[data-component="workflow-proposals-panel"]')
      await panel.getByRole("button", { name: "Review save", exact: true }).click()
      await panel.getByRole("button", { name: "Save declaration", exact: true }).click()
      await expect(panel).toContainText("The response does not match the reviewed declaration. Check the current file.")
      await expect(panel.getByText("Workflow declaration file saved.", { exact: true })).toHaveCount(0)
      await expect(panel.getByRole("button", { name: "Review again", exact: true })).toBeEnabled()
      expect(api.calls).toHaveLength(1)
    })
  }
})
