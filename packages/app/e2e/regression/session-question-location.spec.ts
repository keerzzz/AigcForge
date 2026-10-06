import { expect, test, type Page } from "@playwright/test"
import type {
  AssistantMessage,
  GlobalEvent,
  Part,
  QuestionV2Request,
  Session,
  ToolPart,
  UserMessage,
} from "@aigcfroge/sdk/v2"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"

const directory = "C:/Aigcfroge/QuestionLocationRegression"
const projectID = "proj_question_location"
const sessionID = "ses_question_location"
const messageID = "msg_question_location_assistant"
const created = 1700000000000
const title = "Question location regression"
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-aigcfroge-directory,x-aigcfroge-workspace",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}
const dock = (page: Page) => page.locator('[data-component="dock-prompt"][data-kind="question"]')
const customInput = (page: Page) => dock(page).locator('[data-slot="question-custom-input"]')
const customButton = (page: Page) => dock(page).locator('button[data-slot="question-option"][data-custom="true"]')
const row = (page: Page, part: ToolPart) => page.locator(`[data-timeline-part-id="${part.id}"]`)
const locate = (page: Page, part: ToolPart) => row(page, part).locator('button[data-slot="question-locate"]')

function call(id: string): ToolPart {
  return {
    id: `prt_question_${id}`,
    sessionID,
    messageID,
    type: "tool",
    tool: "question",
    callID: `call_question_${id}`,
    state: {
      status: "running",
      input: { questions: [{ header: id, question: `Question ${id}`, options: [], custom: true }] },
      time: { start: created + 100 },
    },
  }
}

function request(id: string, part: ToolPart): QuestionV2Request {
  return {
    id,
    sessionID: part.sessionID,
    tool: { messageID: part.messageID, callID: part.callID },
    questions: [{ header: id, question: `Pending ${id}`, options: [], custom: true }],
  }
}

async function install(page: Page, parts: ToolPart[], questions: QuestionV2Request[]) {
  await pinEnglishUI(page)
  const writes: string[] = []
  const events: GlobalEvent[] = []
  const current = {
    id: sessionID,
    slug: sessionID,
    projectID,
    directory,
    title,
    mode: "coding",
    agent: "build",
    version: "dev",
    time: { created, updated: created },
  } satisfies Session
  const user = {
    id: "msg_question_location_user",
    sessionID,
    role: "user",
    time: { created },
    agent: "build",
    model: { providerID: "aigcfroge", modelID: "question-model" },
  } satisfies UserMessage
  const assistant = {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: user.id,
    time: { created: created + 100 },
    modelID: "question-model",
    providerID: "aigcfroge",
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  } satisfies AssistantMessage
  const history: Part[] = [
    {
      id: "prt_question_location_text",
      sessionID,
      messageID,
      type: "text",
      text: "Question tool history is loaded",
    },
    ...parts,
  ]
  const messages = [
    {
      info: user,
      parts: [{ id: "prt_question_location_user", sessionID, messageID: user.id, type: "text", text: "Ask me" }],
    },
    { info: assistant, parts: history },
  ]
  const pageMessages: MockServerConfig["pageMessages"] = (id) => ({ items: id === sessionID ? messages : [] })
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      name: "Question location",
      vcs: "git",
      time: { created },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "aigcfroge",
          name: "Aigcfroge",
          models: { "question-model": { id: "question-model", name: "Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["aigcfroge"],
      default: { aigcfroge: "question-model" },
    },
    sessions: [
      current,
      { ...current, id: "ses_question_location_child", parentID: sessionID, title: "Child question" },
    ],
    pageMessages,
    events: () => events.splice(0),
    eventRetry: 100,
  })
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname
    const pending = path === "/api/question/request" || path === "/api/permission/request"
    const write = /^\/api\/session\/[^/]+\/question\/[^/]+\/(reply|reject)$/.test(path)
    if (!pending && !write) return route.fallback()
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
    if (pending)
      return route.fulfill({
        json: { location: { directory }, data: path === "/api/question/request" ? questions : [] },
        headers: cors,
      })
    writes.push(path)
    return route.fulfill({ status: 204, headers: cors, body: "" })
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await expect(
    page.locator('[data-component="session-turn"]').getByText("Question tool history is loaded", { exact: true }),
  ).toBeVisible()
  return { writes, events, history, current }
}

test("AI-TDD-S05-R05 locating the exact pending question preserves drafts and refocuses without remounting", async ({
  page,
}) => {
  const first = call("first")
  const second = call("second")
  const wire = await install(page, [first, second], [request("que_01", first), request("que_02", second)])
  await expect(dock(page)).toHaveCount(1)
  await expect(dock(page)).toContainText("Pending que_01")
  await customButton(page).click()
  await customInput(page).fill("Draft for the first question")

  await expect(locate(page, second)).toHaveAccessibleName(/.+/)
  await locate(page, second).click()
  await expect(dock(page)).toContainText("Pending que_02")
  await expect(customButton(page)).toBeFocused()
  await customButton(page).click()
  await customInput(page).fill("Draft for the second question")
  const originalInput = await customInput(page).elementHandle()
  if (!originalInput) throw new Error("Expected the real Question dock textarea")

  await locate(page, second).click()
  await expect(customInput(page)).toBeFocused()
  await expect(customInput(page)).toHaveValue("Draft for the second question")
  expect(await customInput(page).evaluate((element, previous) => element === previous, originalInput)).toBe(true)

  await locate(page, first).click()
  await expect(dock(page)).toContainText("Pending que_01")
  await expect(customButton(page)).toContainText("Draft for the first question")
  await customButton(page).click()
  await expect(customInput(page)).toHaveValue("Draft for the first question")
  await expect(dock(page)).toHaveCount(1)
  await expect(row(page, first).locator("textarea, input, form")).toHaveCount(0)
  await expect(row(page, second).locator("textarea, input, form")).toHaveCount(0)
  expect(wire.writes).toEqual([])
})

test("AI-TDD-S05-R05 unknown, mismatched and ambiguous pending identities expose read-only waiting, not a fake locate action", async ({
  page,
}) => {
  const unknown = call("unknown")
  const owner = call("owner")
  const message = call("message")
  const tool = call("tool")
  const ambiguous = call("ambiguous")
  const wire = await install(
    page,
    [unknown, owner, message, tool, ambiguous],
    [
      { ...request("que_owner", owner), sessionID: "ses_question_location_child" },
      { ...request("que_message", message), tool: { messageID: "msg_different", callID: message.callID } },
      { ...request("que_tool", tool), tool: { messageID, callID: "call_different" } },
      request("que_ambiguous_a", ambiguous),
      request("que_ambiguous_b", ambiguous),
    ],
  )
  for (const part of [unknown, owner, message, tool, ambiguous]) {
    await expect(row(page, part)).toBeVisible()
    await expect(row(page, part)).toContainText(/Waiting/i)
    await expect(locate(page, part)).toHaveCount(0)
    await expect(row(page, part).locator("textarea, input, form")).toHaveCount(0)
  }
  await expect(dock(page)).toHaveCount(1)
  expect(wire.writes).toEqual([])
})

test("AI-TDD-S05-R05 an answered question replaces locate with read-only answers and never another submitter", async ({
  page,
}) => {
  const part = call("answered")
  const pending = request("que_answered", part)
  const questions = [pending]
  const wire = await install(page, [part], questions)
  await expect(locate(page, part)).toBeVisible()
  questions.splice(0)
  const completed: ToolPart = {
    ...part,
    state: {
      status: "completed",
      input: { questions: pending.questions },
      output: "Approved answer",
      title: "Question answered",
      metadata: { answers: [["Approved answer"]] },
      time: { start: created + 100, end: created + 200 },
    },
  }
  wire.history.splice(1, 1, completed)
  wire.current.title = "Question answer acknowledged"
  wire.events.push(
    {
      directory,
      payload: {
        id: "evt_question_location_reply",
        type: "question.v2.replied",
        properties: { sessionID, requestID: pending.id, answers: [["Approved answer"]] },
      },
    },
    {
      directory,
      payload: {
        id: "evt_question_location_part",
        type: "message.part.updated",
        properties: { sessionID, part: completed, time: created + 200 },
      },
    },
    {
      directory,
      payload: {
        id: "evt_question_location_session",
        type: "session.updated",
        properties: { sessionID, info: wire.current },
      },
    },
  )
  await expectSessionTitle(page, wire.current.title)
  await expect(dock(page)).toHaveCount(0)
  await expect(locate(page, part)).toHaveCount(0)
  const trigger = row(page, part).locator('button[data-slot="collapsible-trigger"]')
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()
  await expect(row(page, part).getByText("Approved answer", { exact: true })).toBeVisible()
  await expect(row(page, part).locator("textarea, input, form")).toHaveCount(0)
  expect(wire.writes).toEqual([])
  await page.reload()
  await expectSessionTitle(page, wire.current.title)
  await expect(locate(page, part)).toHaveCount(0)
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()
  await expect(row(page, part).getByText("Approved answer", { exact: true })).toBeVisible()
})
