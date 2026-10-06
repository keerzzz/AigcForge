import { expect, test, type Locator, type Page } from "@playwright/test"
import type {
  AssistantMessage,
  EventMessagePartUpdated,
  EventMessageUpdated,
  Part,
  SessionTaskInfo,
  ToolPart,
  UserMessage,
} from "@aigcfroge/sdk/v2"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { expectSessionTitle, gotoWhenReady } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"
import { PRESENTATION_EXPECTED } from "../presentation-matrix"
// Both harnesses export test; this alias distinguishes the real-zoom fixture.
import { test as zoomTest } from "../zoom/fixtures"
import { WINDOW_SIZE, ZOOMED_WINDOW, ZOOM_HOST } from "../zoom/zoom-profile"

const directory = "C:/Aigcfroge/ToolRowRegression"
const projectID = "proj_tool_row_regression"
const sessionID = "ses_tool_row_regression"
const assistantID = "msg_assistant_tool_row"
const title = "Tool row regression"
const created = 1700000000000
const model = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }
const href = (id: string) => `/${base64Encode(directory)}/session/${id}`

const snapshot = {
  id: "tsk_tool_row_snapshot",
  sessionID,
  content: "Audit the original tool invocation",
  status: "pending",
  priority: "high",
  revision: 1,
  createdAt: created,
  updatedAt: created,
} satisfies SessionTaskInfo

function call(
  tool: string,
  input: Record<string, unknown> = {},
  output = "",
  metadata: Record<string, unknown> = {},
): ToolPart {
  return {
    id: `prt_tool_row_${tool}`,
    sessionID,
    messageID: assistantID,
    type: "tool",
    callID: `call_tool_row_${tool}`,
    tool,
    state: {
      status: "completed",
      input,
      output,
      title: tool,
      metadata,
      time: { start: created + 100, end: created + 200 },
    },
  }
}

function session(id = sessionID, name = title) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title: name,
    mode: "coding",
    agent: "build",
    version: "dev",
    time: { created, updated: created },
  }
}

async function install(page: Page, parts: Part[], overrides: Partial<MockServerConfig> = {}) {
  const events: Array<{ directory: string; payload: Record<string, unknown> }> = []
  const streaming = parts.some(
    (part) =>
      (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) ||
      (part.type === "reasoning" && part.time.end === undefined),
  )
  const user = {
    id: "msg_user_tool_row",
    sessionID,
    role: "user",
    time: { created },
    agent: "build",
    model,
  } satisfies UserMessage
  const assistant: AssistantMessage = {
    id: assistantID,
    sessionID,
    role: "assistant",
    parentID: user.id,
    time: streaming ? { created: created + 100 } : { created: created + 100, completed: created + 200 },
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const messages = [
    {
      info: user,
      parts: [
        {
          id: "prt_user_tool_row",
          sessionID,
          messageID: user.id,
          type: "text",
          text: "Show tool history",
        } satisfies Part,
      ],
    },
    { info: assistant, parts },
  ]
  const config: MockServerConfig = {
    directory,
    project: { id: projectID, worktree: directory, name: "Tool rows", vcs: "git", time: { created }, sandboxes: [] },
    provider: {
      all: [
        {
          id: model.providerID,
          name: "AigcForge",
          models: { [model.modelID]: { id: model.modelID, name: "Claude Opus 4.6", limit: { context: 200_000 } } },
        },
      ],
      default: { [model.providerID]: model.modelID },
      connected: [model.providerID],
    },
    sessions: [session()],
    sessionStatus: streaming ? { [sessionID]: { type: "busy" } } : undefined,
    pageMessages: (id) => ({ items: id === sessionID ? messages : [] }),
    events: () => events.splice(0),
    eventRetry: 100,
    ...overrides,
  }
  await mockAigcfrogeServer(page, config)
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, showReasoningSummaries: true } }),
    )
  })
  return { config, events, parts, assistant, sequence: 0 }
}

function publishPart(fixture: Awaited<ReturnType<typeof install>>, part: Part, completed = false) {
  const index = fixture.parts.findIndex((item) => item.id === part.id)
  if (index < 0) throw new Error(`Unknown fixture part: ${part.id}`)
  fixture.parts[index] = part
  fixture.sequence += 1
  const time = created + 300 + fixture.sequence
  fixture.events.push({
    directory,
    payload: {
      id: `evt_s05_part_${fixture.sequence}`,
      type: "message.part.updated",
      properties: { sessionID: part.sessionID, part, time },
    } satisfies EventMessagePartUpdated,
  })
  if (!completed) return
  fixture.assistant.time.completed = time
  fixture.config.sessionStatus = { [sessionID]: { type: "idle" } }
  fixture.events.push(
    {
      directory,
      payload: {
        id: `evt_s05_message_${fixture.sequence}`,
        type: "message.updated",
        properties: { sessionID, info: fixture.assistant },
      } satisfies EventMessageUpdated,
    },
    {
      directory,
      payload: {
        id: `evt_s05_idle_${fixture.sequence}`,
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      },
    },
  )
}

async function open(page: Page) {
  await gotoWhenReady(page, href(sessionID))
  await expectSessionTitle(page, title)
}

function row(page: Page, part: Part) {
  return page.locator(`[data-component="tool-part-wrapper"][data-timeline-part-id="${part.id}"]`)
}

async function expand(container: Locator) {
  const trigger = container.locator('[data-slot="collapsible-trigger"]').first()
  await expect(trigger).toBeVisible()
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
}

test.describe("AI-TDD-S05 production tool rows", () => {
  test.beforeEach(({ page }) => pinEnglishUI(page))

  test("R01 real registry routes shell, task, skill and unknown calls to their semantic glyphs", async ({ page }) => {
    const cases = [
      { part: call("bash", { command: "printf hello" }, "hello"), icon: "console" },
      { part: call("task", { subagent_type: "explore", description: "Inspect source" }), icon: "task" },
      { part: call("skill", { name: "review" }), icon: "brain" },
      { part: call("unknown_tool", { description: "Safe fallback" }), icon: "mcp" },
    ]
    await install(
      page,
      cases.map((item) => item.part),
    )
    await open(page)
    for (const item of cases) {
      const icon = row(page, item.part).locator('[data-slot="basic-tool-tool-indicator"] svg')
      await expect(icon).toHaveAttribute("aria-hidden", "true")
      await expect(icon.locator("use")).toHaveAttribute("href", `#aigcfroge-icon-${item.icon}`)
    }
  })

  test("R02 empty unknown output is a static row, not an expansion button", async ({ page }) => {
    const part = call("unknown_empty", { description: "Nothing to expand" })
    await install(page, [part])
    await open(page)
    await expect(row(page, part)).toBeVisible()
    await expect(row(page, part).locator("button, [role=button], [aria-expanded]")).toHaveCount(0)
  })

  test("R02 errors keep their reason visible before expansion and their full detail after it", async ({ page }) => {
    const part = {
      ...call("bash"),
      state: {
        status: "error",
        input: { command: "run build" },
        error: "Permission denied: shell invocation\nRequest was not authorized",
        time: { start: created + 100, end: created + 200 },
      },
    } satisfies ToolPart
    await install(page, [part])
    await open(page)
    const tool = row(page, part)
    await expect(tool.locator('[data-slot="basic-tool-tool-subtitle"]')).toContainText("Permission denied")
    await expand(tool)
    await expect(tool.locator('[data-slot="tool-error-card-content"]')).toContainText("Request was not authorized")
  })

  test("R02 an actual interrupted tool error is not presented as an ordinary failure", async ({ page }) => {
    const part = {
      ...call("bash"),
      state: {
        status: "error",
        input: { command: "run build" },
        error: "Tool execution interrupted",
        time: { start: created + 100, end: created + 200 },
      },
    } satisfies ToolPart
    await install(page, [part])
    await open(page)
    await expect(row(page, part)).toContainText("Interrupted")
    await expand(row(page, part))
    await expect(row(page, part)).toContainText("Tool execution interrupted")
  })

  test("R03 shell output survives keyboard expansion and keeps its first and last lines", async ({ page }) => {
    const output = Array.from({ length: 180 }, (_, index) => `line ${index}: preserved output`).join("\n")
    const part = call("bash", { command: "print report" }, `\u001b[32m${output}\u001b[0m`)
    await install(page, [part])
    await open(page)
    const trigger = row(page, part).locator('[data-slot="collapsible-trigger"]').first()
    if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click()
    await trigger.focus()
    await trigger.press("Enter")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(row(page, part).locator('[data-slot="bash-pre"]')).toHaveText(`$ print report\n\n${output}`)
    await expect(row(page, part).getByRole("button", { name: "Copy", exact: true })).toBeVisible()
    await trigger.focus()
    await trigger.press("Space")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
  })

  test("R03 the production deferred Diff remains readable after collapse and reopening", async ({ page }) => {
    const part = call("edit", { filePath: "src/tool-row.ts" }, "Edited src/tool-row.ts", {
      filediff: {
        file: "src/tool-row.ts",
        additions: 1,
        deletions: 1,
        before: "export const beforeMarker = 1\n",
        after: "export const afterMarker = 2\n",
      },
    })
    await install(page, [part])
    await open(page)
    const tool = row(page, part)
    await expand(tool)
    const diff = tool.locator('[data-component="edit-content"] [data-component="file"]')
    await expect(diff).toBeVisible()
    await expect(diff).toContainText("beforeMarker")
    await expect(diff).toContainText("afterMarker")
    await tool.locator('[data-slot="collapsible-trigger"]').first().click()
    await expand(tool)
    await expect(diff).toContainText("afterMarker")
  })

  const taskInput = { id: snapshot.id, content: snapshot.content, status: snapshot.status, priority: snapshot.priority }
  const taskCalls = [
    { tool: "taskwrite", input: { tasks: [taskInput], expectedRevision: 0 }, metadata: { tasks: [snapshot] } },
    { tool: "task_create", input: { tasks: [taskInput] }, metadata: { tasks: [snapshot] } },
    { tool: "task_update", input: { id: snapshot.id, content: snapshot.content }, metadata: { task: snapshot } },
    { tool: "task_delete", input: { id: "tsk_previously_deleted" }, metadata: { tasks: [snapshot] } },
    { tool: "task_reorder", input: { ids: [snapshot.id], expectedRevision: 1 }, metadata: { tasks: [snapshot] } },
  ]
  taskCalls.forEach((item) => {
    test(`R04 ${item.tool} starts compact and exposes only this call's readonly snapshot`, async ({ page }) => {
      const output = JSON.stringify(item.tool === "task_update" ? snapshot : [snapshot])
      const part = call(item.tool, item.input, output, item.metadata)
      const writes: string[] = []
      page.on("request", (request) => {
        if (request.method() !== "PATCH") return
        if (new URL(request.url()).pathname.includes(`/session/${sessionID}/task`)) writes.push(request.url())
      })
      await install(page, [part], {
        tasks: [{ ...snapshot, content: "Current task has already changed", revision: 2 }],
      })
      await open(page)
      const tool = row(page, part)
      await expect(tool.locator('[data-slot="basic-tool-tool-indicator"] use')).toHaveAttribute(
        "href",
        "#aigcfroge-icon-checklist",
      )
      await expect(tool.locator('[data-slot="collapsible-trigger"]').first()).toHaveAttribute("aria-expanded", "false")
      await expand(tool)
      await expect(tool.locator('[data-slot="collapsible-content"]').first()).toContainText(snapshot.content)
      await expect(tool).not.toContainText("Current task has already changed")
      await expect(tool.locator("form, textarea, [contenteditable=true]")).toHaveCount(0)
      expect(writes).toEqual([])
    })
  })

  test("R04/R06 later authoritative Task updates change current progress, not expanded history", async ({ page }) => {
    const part = call("taskwrite", { tasks: [snapshot] }, JSON.stringify([snapshot]), { tasks: [snapshot] })
    const fixture = await install(page, [part], {
      tasks: [snapshot],
      sessionStatus: { [sessionID]: { type: "busy" } },
    })
    await open(page)
    const tool = row(page, part)
    await expand(tool)
    await expect(tool).toContainText(snapshot.content)
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("0/1")
    fixture.config.tasks = [{ ...snapshot, content: "A later task revision", status: "completed", revision: 2 }]
    fixture.events.push({
      directory,
      payload: { type: "task.updated", properties: { sessionID, tasks: fixture.config.tasks } },
    })
    await expect(page.locator('[data-component="session-todo-progress-stats"]')).toHaveText("1/1")
    await expect(tool).toContainText(snapshot.content)
    await expect(tool).not.toContainText("A later task revision")
    await page.reload()
    await expectSessionTitle(page, title)
    await expand(tool)
    await expect(tool).toContainText(snapshot.content)
    await expect(tool).not.toContainText("A later task revision")
  })

  test("R06 read and search render in their real context group, not invented standalone rows", async ({ page }) => {
    const parts = [
      call("read", { filePath: "src/example.ts" }, "file content"),
      call("grep", { pattern: "required_symbol" }, "src/example.ts:1:required_symbol"),
      call("glob", { path: "src", pattern: "**/*.ts" }, "src/example.ts"),
      call("list", { path: "src" }, "example.ts"),
    ]
    await install(page, parts)
    await open(page)
    const group = page.locator("[data-timeline-part-ids]").filter({ hasText: "Explored" })
    await expect(group).toHaveCount(1)
    await expand(group)
    await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(4)
    await expect(group).toContainText("example.ts")
    await expect(group).toContainText("required_symbol")
    await expect(group).toContainText("**/*.ts")
    await expect(group.locator('[data-kind="tool-error-card"]')).toHaveCount(0)
  })

  test("R06 thinking is rendered from a real reasoning part", async ({ page }) => {
    const part = {
      id: "prt_tool_row_reasoning",
      sessionID,
      messageID: assistantID,
      type: "reasoning",
      text: "Compare the existing registry before changing the tool row.",
      time: { start: created + 100, end: created + 200 },
    } satisfies Part
    await install(page, [part])
    await open(page)
    await expect(page.locator('[data-component="reasoning-part"]')).toContainText(part.text)
  })

  test("R03/R06 a subagent's real session link survives a no-details row", async ({ page }) => {
    const childID = "ses_tool_row_child"
    const part = call("task", { subagent_type: "explore", description: "Inspect the source" }, "", {
      sessionId: childID,
    })
    await install(page, [part], { sessions: [session(), session(childID, "Child tool session")] })
    await open(page)
    const action = row(page, part).getByRole("link", { name: "Open sub-agent session" })
    await expect(action).toHaveAttribute("href", new RegExp(`/session/${childID}$`))
    await action.focus()
    await action.press("Enter")
    await expect(page).toHaveURL(new RegExp(`/session/${childID}$`))
    await expectSessionTitle(page, "Child tool session")
  })

  test("R06 external CLI delegation keeps its output summary", async ({ page }) => {
    const part = call(
      "task",
      { execution_type: "external-cli", cli_target: "claude-code", description: "Review changes" },
      "<task_result>External review snapshot</task_result>",
      { execution_type: "external-cli", cli: "claude-code", status: "success" },
    )
    await install(page, [part])
    await open(page)
    await expect(row(page, part).locator('[data-slot="basic-tool-tool-indicator"] use')).toHaveAttribute(
      "href",
      "#aigcfroge-icon-terminal",
    )
    await expand(row(page, part))
    await expect(row(page, part).locator('[data-component="task-tool-cli-summary"]')).toHaveText(
      "External review snapshot",
    )
  })
  ;["mcp_docs_search", "unregistered_tool"].forEach((name) => {
    test(`R06 ${name} keeps full output as text without interpreting markup`, async ({ page }) => {
      const output =
        'first line\n<img src="invalid" onerror="document.title=\'unsafe\'">\n<script>unsafe()</script>\nlast line'
      const part = call(name, { query: "Find relevant docs" }, output)
      await install(page, [part])
      await open(page)
      await expand(row(page, part))
      await expect(row(page, part).locator('[data-slot="collapsible-content"]').first()).toHaveText(output)
      await expect(row(page, part).locator("img, script, iframe")).toHaveCount(0)
    })
  })

  test("R06 historical todowrite stays retired rather than becoming an online task writer", async ({ page }) => {
    const retired = call("todowrite", { tasks: [snapshot] }, JSON.stringify([snapshot]), { tasks: [snapshot] })
    const skill = call("skill", { name: "review" })
    await install(page, [retired, skill])
    await open(page)
    await expect(row(page, retired)).toHaveCount(0)
    await expect(row(page, skill)).toBeVisible()
    await expect(row(page, skill).locator("button, [aria-expanded]")).toHaveCount(0)
  })
})

function longTask() {
  return call(
    "task",
    {
      subagent_type: "explore",
      description:
        "Review the existing implementation and preserve every essential action. 审阅既有实现并保留全部关键操作。".repeat(
          12,
        ),
    },
    "",
    { sessionId: "ses_tool_row_child" },
  )
}

async function expectReachableAction(page: Page, part: ToolPart) {
  const action = row(page, part).locator('[data-component="task-tool-action"]')
  await expect(action).toHaveAccessibleName(/.+/)
  await action.focus()
  await expect(action).toBeFocused()
  await expect(action).toHaveCSS("opacity", "1")
  const bounds = await action.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      width: rect.width,
      height: rect.height,
      insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      hit: point !== null && (element === point || element.contains(point)),
    }
  })
  expect(bounds.width).toBeGreaterThan(0)
  expect(bounds.height).toBeGreaterThan(0)
  expect(bounds.insideViewport).toBe(true)
  expect(bounds.hit).toBe(true)
}

test(
  "AI-TDD-S05-R07 long EN/ZH rows retain named keyboard actions across presentation projects",
  { tag: ["@presentation", "@a11y"] },
  async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    const part = longTask()
    const failure = {
      ...call("read"),
      state: {
        status: "error",
        input: { filePath: "src/必须保留错误原因与键盘入口.ts" },
        error:
          "Cannot read the requested source / 无法读取请求的源文件\n" + "Detailed failure / 完整错误详情 ".repeat(12),
        time: { start: created + 100, end: created + 200 },
      },
    } satisfies ToolPart
    await install(page, [part, failure], { sessions: [session(), session("ses_tool_row_child", "Child tool session")] })
    await open(page)
    const presentation = PRESENTATION_EXPECTED[testInfo.project.name]
    if (!presentation) throw new Error("This test requires a registered presentation project")
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", presentation.colorScheme)
    await expect(page.locator("html")).toHaveAttribute("lang", presentation.lang)
    await expect(row(page, part)).toContainText("审阅既有实现")
    await expectReachableAction(page, part)
    await expect(row(page, part).locator('[data-slot="basic-tool-tool-indicator"] svg')).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true)
    const group = page.locator("[data-timeline-part-ids]")
    const trigger = group.locator('[data-slot="collapsible-trigger"]').first()
    await expect(group.locator('[data-slot="context-tool-group-errors"]')).toBeVisible()
    await expect(trigger).toHaveAccessibleName(/.+/)
    await trigger.focus()
    await expect(trigger).toBeFocused()
    await trigger.press("Enter")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(row(page, failure)).toBeVisible()
    await expand(row(page, failure))
    await expect(row(page, failure).locator('[data-slot="tool-error-card-content"]')).toBeVisible()
    await expect(row(page, failure).locator('[data-slot="tool-error-card-content"]')).toContainText(failure.state.error)
  },
)

zoomTest(
  "AI-TDD-S05-R07 real 200% page zoom keeps the production history action reachable",
  async ({ page }, testInfo) => {
    const base = testInfo.project.use.baseURL
    if (!base || new URL(base).hostname !== ZOOM_HOST) throw new Error("The real-zoom fixture requires its seeded host")
    await pinEnglishUI(page)
    const part = longTask()
    await install(page, [part], { sessions: [session(), session("ses_tool_row_child", "Child tool session")] })
    await open(page)
    const certificate = await page.evaluate(() => ({
      innerWidth,
      outerWidth,
      devicePixelRatio,
      scale: visualViewport?.scale,
    }))
    expect(certificate.innerWidth).toBe(ZOOMED_WINDOW.innerWidth)
    expect(certificate.outerWidth).toBe(WINDOW_SIZE.width)
    expect(certificate.devicePixelRatio).toBe(ZOOMED_WINDOW.devicePixelRatio)
    expect(certificate.scale).toBe(1)
    await testInfo.attach("tool-row-real-zoom.json", {
      body: JSON.stringify(certificate),
      contentType: "application/json",
    })
    await expectReachableAction(page, part)
  },
)

test.describe("AI-TDD-S05-R06 production streaming transitions", () => {
  test.beforeEach(({ page }) => pinEnglishUI(page))

  test("read/search move from Exploring to Explored in the existing context group", async ({ page }) => {
    const readInput = { filePath: "src/live-context.ts" }
    const searchInput = { pattern: "live_symbol" }
    const read = {
      ...call("read"),
      state: { status: "pending", input: readInput, raw: JSON.stringify(readInput) },
    } satisfies ToolPart
    const search = {
      ...call("grep"),
      state: { status: "running", input: searchInput, time: { start: created + 100 } },
    } satisfies ToolPart
    const fixture = await install(page, [read, search])
    await open(page)
    const group = page.locator("[data-timeline-part-ids]")
    const status = group.locator('[data-component="tool-status-title"]')
    await expect(status).toHaveAttribute("aria-label", "Exploring")
    await expand(group)
    publishPart(fixture, call("read", readInput, "export const live_symbol = true"))
    publishPart(fixture, call("grep", searchInput, "src/live-context.ts:1:live_symbol"), true)
    await expect(status).toHaveAttribute("aria-label", "Explored")
    await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(2)
    await expect(group).toContainText("live-context.ts")
    await expect(group).toContainText("live_symbol")
    await expect(row(page, read)).toHaveCount(0)
  })

  test("streaming reasoning settles without dropping its final text", async ({ page }) => {
    const part = {
      id: "prt_tool_row_live_reasoning",
      sessionID,
      messageID: assistantID,
      type: "reasoning",
      text: "Inspect the current owner first.",
      time: { start: created + 100 },
    } satisfies Part
    const fixture = await install(page, [part])
    await open(page)
    const reasoning = page.locator(`[data-component="reasoning-part"][data-timeline-part-id="${part.id}"]`)
    await expect(reasoning).toContainText(part.text)
    const final = {
      ...part,
      text: `${part.text} Reuse its lifecycle and preserve the final reasoning marker.`,
      time: { start: created + 100, end: created + 200 },
    } satisfies Part
    publishPart(fixture, final, true)
    await expect(reasoning).toContainText(final.text)
    await page.reload()
    await expectSessionTitle(page, title)
    await expect(reasoning).toContainText(final.text)
  })

  test("a running edit becomes a real deferred Diff rather than losing the settled result", async ({ page }) => {
    const input = { filePath: "src/live-diff.ts", oldString: "beforeStep", newString: "afterStep" }
    const part = {
      ...call("edit"),
      state: { status: "running", input, time: { start: created + 100 } },
    } satisfies ToolPart
    const fixture = await install(page, [part])
    await open(page)
    await expect(row(page, part)).toBeVisible()
    publishPart(
      fixture,
      call("edit", input, "Edited src/live-diff.ts", {
        filediff: {
          file: input.filePath,
          additions: 1,
          deletions: 1,
          before: "export const beforeStep = 1\n",
          after: "export const afterStep = 2\n",
        },
      }),
      true,
    )
    await expect(row(page, part)).toContainText("live-diff.ts")
    await expand(row(page, part))
    const diff = row(page, part).locator('[data-component="edit-content"] [data-component="file"]')
    await expect(diff).toBeVisible()
    await expect(diff).toContainText("beforeStep")
    await expect(diff).toContainText("afterStep")
  })
})

test.describe("AI-TDD-S05-R02/R06 context error groups", () => {
  test.beforeEach(({ page }) => pinEnglishUI(page))

  // sortParts in context/sync.tsx orders durable IDs before groupParts sees them.
  const tools = [
    { tool: "glob", input: { path: "src", pattern: "**/*.ts" } },
    { tool: "grep", input: { path: "src", pattern: "context_symbol" } },
    { tool: "list", input: { path: "src" } },
    { tool: "read", input: { filePath: "src/context.ts" } },
  ]

  test("all four failed tools retain their collapsed reasons and the real error-card details", async ({ page }) => {
    const parts = tools.map(
      (item) =>
        ({
          ...call(item.tool, item.input),
          state: {
            status: "error",
            input: item.input,
            error: `Permission denied: ${item.tool} interrupted-report.txt\n${item.tool} request was not authorized`,
            metadata: { interrupted: false },
            time: { start: created + 100, end: created + 200 },
          },
        }) satisfies ToolPart,
    )
    await install(page, parts)
    await open(page)
    const group = page.locator("[data-timeline-part-ids]")
    const trigger = group.locator('[data-slot="collapsible-trigger"]').first()
    await expect(group).toHaveCount(1)
    await expect(group).toHaveAttribute("data-timeline-part-ids", parts.map((part) => part.id).join(","))
    await expect(group.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", "Failed")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    for (const part of parts) {
      await expect(trigger).toContainText(`Permission denied: ${part.tool} interrupted-report.txt`)
    }
    await expand(group)
    await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(4)
    for (const part of parts) {
      const tool = row(page, part)
      await expect(group.locator(`[data-timeline-part-id="${part.id}"]`)).toHaveCount(1)
      await expect(tool.locator('[data-kind="tool-error-card"]')).toHaveCount(1)
      await expect(tool.locator('[data-slot="basic-tool-tool-title"]')).not.toHaveText("Interrupted")
      await expect(tool.locator('[data-slot="basic-tool-tool-subtitle"]')).toContainText(
        `Permission denied: ${part.tool} interrupted-report.txt`,
      )
      await expand(tool)
      await expect(tool.locator('[data-slot="tool-error-card-content"]')).toContainText(
        `${part.tool} request was not authorized`,
      )
    }
  })
  ;[
    { name: "exact V2 interruption", error: "Tool execution interrupted", metadata: {} },
    { name: "exact abort without metadata", error: "Tool execution aborted", metadata: {} },
    { name: "legacy cleanup marker", error: "Tool execution aborted", metadata: { interrupted: true } },
  ].forEach((item) => {
    test(`${item.name} remains Interrupted for all four context tools, never Explored`, async ({ page }) => {
      const parts = tools.map(
        (tool) =>
          ({
            ...call(tool.tool, tool.input),
            state: {
              status: "error",
              input: tool.input,
              error: item.error,
              metadata: item.metadata,
              time: { start: created + 100, end: created + 200 },
            },
          }) satisfies ToolPart,
      )
      await install(page, parts)
      await open(page)
      const group = page.locator("[data-timeline-part-ids]")
      const trigger = group.locator('[data-slot="collapsible-trigger"]').first()
      await expect(group).toHaveCount(1)
      await expect(group).toHaveAttribute("data-timeline-part-ids", parts.map((part) => part.id).join(","))
      await expect(group.locator('[data-component="tool-status-title"]')).toHaveAttribute("aria-label", "Interrupted")
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await expect(trigger).toContainText(item.error)
      await expand(group)
      await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(4)
      for (const part of parts) {
        const tool = row(page, part)
        await expect(group.locator(`[data-timeline-part-id="${part.id}"]`)).toHaveCount(1)
        await expect(tool.locator('[data-kind="tool-error-card"]')).toHaveCount(1)
        await expect(tool.locator('[data-slot="basic-tool-tool-title"]')).toHaveText("Interrupted")
        await expand(tool)
        await expect(tool.locator('[data-slot="tool-error-card-content"]')).toContainText(item.error)
      }
    })
  })
  ;(
    [
      { status: "pending", expanded: false },
      { status: "pending", expanded: true },
      { status: "running", expanded: false },
      { status: "running", expanded: true },
    ] as const
  ).forEach((item) => {
    test(`${item.status} to error events keep the ${item.expanded ? "open" : "closed"} group identity and focus`, async ({
      page,
    }) => {
      const parts = tools.map(
        (tool) =>
          ({
            ...call(tool.tool, tool.input),
            state:
              item.status === "pending"
                ? { status: "pending", input: tool.input, raw: JSON.stringify(tool.input) }
                : { status: "running", input: tool.input, time: { start: created + 100 } },
          }) satisfies ToolPart,
      )
      const fixture = await install(page, parts)
      await open(page)
      const group = page.locator("[data-timeline-part-ids]")
      const trigger = group.locator('[data-slot="collapsible-trigger"]').first()
      const status = group.locator('[data-component="tool-status-title"]')
      const ids = parts.map((part) => part.id).join(",")
      await expect(group).toHaveCount(1)
      await expect(status).toHaveAttribute("aria-label", "Exploring")
      if (item.expanded) await expand(group)
      await trigger.focus()
      const originalGroup = await group.elementHandle()
      const originalTrigger = await trigger.elementHandle()
      if (!originalGroup || !originalTrigger) throw new Error("Expected the real context group and its trigger")
      const controls = await trigger.getAttribute("aria-controls")
      if (item.expanded && !controls) throw new Error("Expected the open context disclosure to name its content")
      for (const [index, part] of parts.entries()) {
        const error = `Permission denied: ${part.tool} context access\n${part.tool} terminal detail`
        publishPart(
          fixture,
          {
            ...part,
            state: {
              status: "error",
              input: part.state.input,
              error,
              time: { start: created + 100, end: created + 300 + index },
            },
          },
          index === parts.length - 1,
        )
        await expect(trigger).toContainText(`Permission denied: ${part.tool} context access`)
        await expect(status).toHaveAttribute("aria-label", index === parts.length - 1 ? "Failed" : "Exploring")
        await expect(group).toHaveCount(1)
        await expect(group).toHaveAttribute("data-timeline-part-ids", ids)
        await expect(trigger).toHaveAttribute("aria-expanded", String(item.expanded))
        expect(await trigger.getAttribute("aria-controls")).toBe(controls)
        await expect(trigger).toBeFocused()
        expect(await group.evaluate((element, previous) => element === previous, originalGroup)).toBe(true)
        expect(await trigger.evaluate((element, previous) => element === previous, originalTrigger)).toBe(true)
      }
      await expand(group)
      await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(4)
      for (const part of parts) {
        await expect(group.locator(`[data-timeline-part-id="${part.id}"]`)).toHaveCount(1)
        await expand(row(page, part))
        await expect(row(page, part).locator('[data-slot="tool-error-card-content"]')).toContainText(
          `${part.tool} terminal detail`,
        )
      }
      await originalGroup.dispose()
      await originalTrigger.dispose()
    })
  })

  test("mixed success, running, failure and interruption keep the existing error disclosure on sibling completion", async ({
    page,
  }) => {
    const parts = tools.map((item) => {
      const part = call(item.tool, item.input, "src/context.ts")
      if (item.tool === "list")
        return {
          ...part,
          state: { status: "running", input: item.input, time: { start: created + 100 } },
        } satisfies ToolPart
      if (item.tool === "read") return part
      return {
        ...part,
        state: {
          status: "error",
          input: item.input,
          error: item.tool === "grep" ? "Tool execution interrupted" : "Permission denied: glob\nGlob full detail",
          time: { start: created + 100, end: created + 200 },
        },
      } satisfies ToolPart
    })
    const fixture = await install(page, parts)
    await open(page)
    const group = page.locator("[data-timeline-part-ids]")
    const trigger = group.locator('[data-slot="collapsible-trigger"]').first()
    const status = group.locator('[data-component="tool-status-title"]')
    await expect(group).toHaveCount(1)
    await expect(status).toHaveAttribute("aria-label", "Exploring")
    await expect(trigger).toContainText("Permission denied: glob")
    await expect(trigger).toContainText("Tool execution interrupted")
    await expand(group)
    await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(4)
    await expect(group.locator('[data-kind="tool-error-card"]')).toHaveCount(2)
    const failed = row(page, call("glob"))
    const failureTrigger = failed.locator('[data-slot="collapsible-trigger"]')
    await expand(failed)
    await failureTrigger.focus()
    const original = await failureTrigger.elementHandle()
    if (!original) throw new Error("Expected the existing grouped error disclosure")
    const controls = await failureTrigger.getAttribute("aria-controls")
    if (!controls) throw new Error("Expected the error disclosure to name its content")
    publishPart(fixture, call("list", { path: "src" }, "context.ts"), true)
    await expect(status).toHaveAttribute("aria-label", "Failed")
    await expect(group).toHaveAttribute("data-timeline-part-ids", parts.map((part) => part.id).join(","))
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(failureTrigger).toHaveAttribute("aria-expanded", "true")
    await expect(failureTrigger).toHaveAttribute("aria-controls", controls)
    await expect(failureTrigger).toBeFocused()
    expect(await failureTrigger.evaluate((element, previous) => element === previous, original)).toBe(true)
    await expect(failed.locator('[data-slot="tool-error-card-content"]')).toContainText("Glob full detail")
    await expect(row(page, call("grep")).locator('[data-slot="basic-tool-tool-title"]')).toHaveText("Interrupted")
    await expect(group.locator('[data-slot="context-tool-group-item"]')).toHaveCount(4)
    await expect(group.locator('[data-kind="tool-error-card"]')).toHaveCount(2)
    await original.dispose()
  })
})

test.describe("AI-TDD-S05-R07 actual completion motion", () => {
  test.beforeEach(({ page }) => pinEnglishUI(page))
  ;["no-preference", "reduce"].forEach((motion) => {
    test(`shell completion honors ${motion} at insertion and its first animation frame`, async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: motion === "reduce" ? "reduce" : "no-preference" })
      const input = { command: "printf phase" }
      const part = {
        ...call("bash"),
        state: { status: "running", input, metadata: { output: "phase" }, time: { start: created + 100 } },
      } satisfies ToolPart
      const fixture = await install(page, [part])
      await open(page)
      const tool = row(page, part)
      await expect(tool.locator('[data-component="text-shimmer-v2"][data-active="true"]').first()).toBeVisible()
      if (motion === "reduce") {
        const shimmer = tool.locator('[data-slot="text-shimmer-v2-shimmer"]').first()
        await expect(shimmer).toHaveCSS("animation-name", "none")
        await expect(shimmer).toHaveCSS("transition-duration", "0s")
        await expect(tool.locator('[data-slot="text-shimmer-v2-base"]').first()).toHaveCSS("opacity", "1")
      }

      // Observe the actual DOM before completion. Sampling only after an animation
      // finishes would falsely pass even if reduce briefly hides or blurs the text.
      await tool.evaluate((element) => {
        const observer = new MutationObserver(() => {
          const width = element.querySelector<HTMLElement>('[data-slot="shell-submessage-width"]')
          const value = element.querySelector<HTMLElement>('[data-slot="shell-submessage-value"]')
          if (!width || !value) return
          observer.disconnect()
          const sample = (phase: string) => {
            const style = getComputedStyle(value)
            element.setAttribute(`data-s05-${phase}-opacity`, style.opacity)
            element.setAttribute(
              `data-s05-${phase}-clear`,
              String(style.filter === "none" || /^blur\(0(?:px)?\)$/.test(style.filter)),
            )
            element.setAttribute(`data-s05-${phase}-width`, String(width.getBoundingClientRect().width > 0))
            element.setAttribute(
              `data-s05-${phase}-animations`,
              String(
                width
                  .getAnimations({ subtree: true })
                  .filter((animation) => animation.playState === "running" || animation.pending).length,
              ),
            )
          }
          sample("initial")
          requestAnimationFrame(() => {
            sample("frame")
            element.setAttribute("data-s05-motion-sampled", "true")
          })
        })
        observer.observe(element, { childList: true, subtree: true })
      })
      publishPart(fixture, call("bash", input, "phase\nFinal motion marker"), true)
      await expect(tool).toHaveAttribute("data-s05-motion-sampled", "true")
      const observed = await tool.evaluate((element) => ({
        initialOpacity: element.getAttribute("data-s05-initial-opacity"),
        initialClear: element.getAttribute("data-s05-initial-clear"),
        initialWidth: element.getAttribute("data-s05-initial-width"),
        frameOpacity: element.getAttribute("data-s05-frame-opacity"),
        frameClear: element.getAttribute("data-s05-frame-clear"),
        frameWidth: element.getAttribute("data-s05-frame-width"),
        frameAnimations: element.getAttribute("data-s05-frame-animations"),
      }))
      await testInfo.attach(`tool-row-motion-${motion}.json`, {
        body: JSON.stringify(observed),
        contentType: "application/json",
      })
      if (motion === "no-preference") {
        expect(observed.initialOpacity).toBe("0")
        expect(observed.initialClear).toBe("false")
        return
      }
      expect(observed.initialOpacity).toBe("1")
      expect(observed.initialClear).toBe("true")
      expect(observed.initialWidth).toBe("true")
      expect(observed.frameOpacity).toBe("1")
      expect(observed.frameClear).toBe("true")
      expect(observed.frameWidth).toBe("true")
      expect(observed.frameAnimations).toBe("0")
      await expand(tool)
      await expect(tool.locator('[data-slot="bash-pre"]')).toContainText("Final motion marker")
    })
  })
})

test("AI-TDD-S05-R07 enabling reduced motion mid-animation settles the existing command text", async ({
  page,
}, testInfo) => {
  await pinEnglishUI(page)
  await page.emulateMedia({ reducedMotion: "no-preference" })
  const input = { command: "printf 'Keep this completed command readable after changing motion preferences'" }
  const part = {
    ...call("bash"),
    state: { status: "running", input, metadata: { output: "phase" }, time: { start: created + 100 } },
  } satisfies ToolPart
  const fixture = await install(page, [part])
  await open(page)
  const tool = row(page, part)
  await expect(tool.locator('[data-component="text-shimmer-v2"][data-active="true"]').first()).toBeVisible()
  // Gate the real native animation before changing the OS media preference. This
  // avoids a wall-clock sleep that could miss the transition on a slower runner.
  await tool.evaluate((element) => {
    const capture = () => {
      if (!element.isConnected) return
      const value = element.querySelector('[data-slot="shell-submessage-value"]')
      const animation = value?.getAnimations().find((item) => item.effect instanceof KeyframeEffect)
      const duration = animation?.effect?.getTiming().duration
      if (!animation || typeof duration !== "number" || duration <= 0) {
        requestAnimationFrame(capture)
        return
      }
      animation.pause()
      animation.currentTime = duration / 2
      value?.setAttribute("data-s05-same-motion-value", "true")
      element.setAttribute("data-s05-motion-paused", "true")
    }
    requestAnimationFrame(capture)
  })
  publishPart(fixture, call("bash", input, "Final mid-animation marker"), true)
  await expect(tool).toHaveAttribute("data-s05-motion-paused", "true")
  const value = tool.locator('[data-slot="shell-submessage-value"]')
  const partial = await value.evaluate((element) => ({
    opacity: Number(getComputedStyle(element).opacity),
    filter: getComputedStyle(element).filter,
  }))
  expect(partial.opacity).toBeGreaterThan(0)
  expect(partial.opacity).toBeLessThan(1)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(tool).toHaveAttribute("data-s05-motion-paused", "true")
  await expect(value).toHaveAttribute("data-s05-same-motion-value", "true")
  await expect(value).toHaveCSS("opacity", "1")
  await expect(value).toHaveCSS("filter", /^(none|blur\(0px\))$/)
  await testInfo.attach("tool-row-mid-animation-motion.json", {
    body: JSON.stringify({ partial, final: await value.evaluate((element) => getComputedStyle(element).opacity) }),
    contentType: "application/json",
  })
  await expand(tool)
  await expect(tool.locator('[data-slot="bash-pre"]')).toContainText("Final mid-animation marker")
})
