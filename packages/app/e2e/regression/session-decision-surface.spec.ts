import { expect, test, type Page } from "@playwright/test"
import type { PermissionV2Request, QuestionV2Request } from "@aigcfroge/sdk/v2/client"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"

const directory = "C:/Aigcfroge/DecisionSurfaceRegression"
const projectID = "proj_decision_surface_regression"
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-aigcfroge-directory,x-aigcfroge-workspace",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}
const questionDock = (page: Page) => page.locator('[data-component="dock-prompt"][data-kind="question"]')
const permissionDock = (page: Page) => page.locator('[data-component="dock-prompt"][data-kind="permission"]')
const editor = (page: Page) => page.locator('[data-component="prompt-input"]')
const customInput = (page: Page) => questionDock(page).locator('[data-slot="question-custom-input"]')
const activeCustomControl = (page: Page) =>
  questionDock(page).locator(
    'textarea[data-slot="question-custom-input"], button[data-slot="question-option"][data-custom="true"]',
  )
const requestPicker = (page: Page) => page.locator('[data-component="session-request-picker"]')
const requestTrigger = (page: Page, count: number) =>
  requestPicker(page).getByRole("button", { name: new RegExp(`Pending requests: ${count}`) })
const requestListbox = (page: Page) => page.getByRole("listbox")
const href = (id: string) => `/${base64Encode(directory)}/session/${id}`

async function openRequestPicker(page: Page, count: number) {
  const trigger = requestTrigger(page, count)
  await expect(requestPicker(page)).toBeVisible()
  await expect(trigger).toBeVisible()
  await trigger.click()
  await expect(requestListbox(page)).toBeVisible()
  await expect(requestListbox(page).getByRole("option")).toHaveCount(count)
}

async function chooseRequest(page: Page, count: number, name: string | RegExp) {
  await openRequestPicker(page, count)
  await requestListbox(page).getByRole("option", { name }).click()
}

function session(id: string, title = id, parentID?: string) {
  return {
    id,
    parentID,
    slug: id,
    projectID,
    directory,
    title,
    mode: "coding",
    agent: "build",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function question(
  id: string,
  sessionID: string,
  content: {
    header?: string
    question?: string
    options?: { label: string; description: string }[]
  } = {},
): QuestionV2Request {
  return {
    id,
    sessionID,
    questions: [
      {
        header: content.header ?? "Choice",
        question: content.question ?? `Pick one for ${sessionID}`,
        options: content.options ?? [
          { label: "Yes", description: "Proceed" },
          { label: "No", description: "Do not proceed" },
        ],
        multiple: false,
        custom: true,
      },
    ],
  }
}

function permission(id: string, sessionID: string): PermissionV2Request {
  return { id, sessionID, action: "bash", resources: ["echo hi"] }
}

type EventPayload = { directory: string; payload: { type: string; properties: Record<string, unknown> } }
type Write = { path: string; body: unknown }

function decisionWire(sessions: ReturnType<typeof session>[]) {
  return {
    sessions,
    questions: [] as QuestionV2Request[],
    permissions: [] as PermissionV2Request[],
    events: [] as EventPayload[],
    questionReplies: [] as Write[],
    questionRejects: [] as Write[],
    permissionReplies: [] as Write[],
    completedPermissions: [] as string[],
    completedQuestions: [] as string[],
    questionReplyOwners: [] as string[],
    promptWrites: [] as string[],
    questionStatus: 204,
    revision: 0,
    waitPermission: undefined as ((sessionID: string) => Promise<void> | undefined) | undefined,
    waitQuestionReply: undefined as ((requestID: string) => Promise<void> | undefined) | undefined,
  }
}

type DecisionWire = ReturnType<typeof decisionWire>

function asked(wire: DecisionWire, requests: { questions?: QuestionV2Request[]; permissions?: PermissionV2Request[] }) {
  wire.questions.push(...(requests.questions ?? []))
  wire.permissions.push(...(requests.permissions ?? []))
  wire.events.push(
    ...(requests.permissions ?? []).map((request) => ({
      directory,
      payload: { type: "permission.v2.asked", properties: request },
    })),
    ...(requests.questions ?? []).map((request) => ({
      directory,
      payload: { type: "question.v2.asked", properties: request },
    })),
  )
}

// A visible session.updated event acknowledges that the real reducer processed
// the preceding request events. Negative assertions never depend on a sleep.
async function delivered(page: Page, wire: DecisionWire, sessionID: string) {
  const current = wire.sessions.find((item) => item.id === sessionID)
  if (!current) throw new Error(`Unknown fixture session: ${sessionID}`)
  current.title = `${current.slug} revision ${++wire.revision}`
  wire.events.push({ directory, payload: { type: "session.updated", properties: { info: current } } })
  await expectSessionTitle(page, current.title)
}

async function install(
  page: Page,
  wire: DecisionWire,
  pageMessages: MockServerConfig["pageMessages"] = () => ({ items: [] }),
) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "decision-surface",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "aigcfroge",
          name: "Aigcfroge",
          models: { "decision-model": { id: "decision-model", name: "Model", limit: { context: 200_000 } } },
        },
      ],
      connected: ["aigcfroge"],
      default: { providerID: "aigcfroge", modelID: "decision-model" },
    },
    agents: [
      { name: "build", mode: "primary", native: true, hidden: false, options: {}, permission: [] },
      { name: "reviewer", mode: "subagent", native: true, hidden: false, options: {}, permission: [] },
    ],
    sessions: wire.sessions,
    pageMessages,
    events: () => wire.events.splice(0),
    eventRetry: 100,
  })
  // Pending GETs and the SSE stream describe the same fixture state, including
  // after navigation; a one-shot event queue alone cannot test restoration.
  await page.route("**/*", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const questionWrite = path.match(/^\/api\/session\/([^/]+)\/question\/([^/]+)\/(reply|reject)$/)
    const permissionWrite = path.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/)
    const promptWrite = /^\/session\/[^/]+\/prompt_async$/.test(path)
    if (
      !["/api/question/request", "/api/permission/request", "/find/file"].includes(path) &&
      !questionWrite &&
      !permissionWrite &&
      !promptWrite
    )
      return route.fallback()
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
    if (path === "/api/question/request")
      return route.fulfill({ json: { location: { directory }, data: wire.questions }, headers: cors })
    if (path === "/api/permission/request")
      return route.fulfill({ json: { location: { directory }, data: wire.permissions }, headers: cors })
    if (path === "/find/file") return route.fulfill({ json: ["src/example.ts"], headers: cors })
    if (promptWrite) {
      wire.promptWrites.push(path)
      return route.fulfill({ json: {}, headers: cors })
    }
    if (permissionWrite) {
      wire.permissionReplies.push({ path, body: request.postDataJSON() })
      await wire.waitPermission?.(permissionWrite[1])
      wire.permissions = wire.permissions.filter(
        (item) => item.sessionID !== permissionWrite[1] || item.id !== permissionWrite[2],
      )
      wire.events.push({
        directory,
        payload: {
          type: "permission.v2.replied",
          properties: { sessionID: permissionWrite[1], requestID: permissionWrite[2], reply: "once" },
        },
      })
      wire.completedPermissions.push(permissionWrite[1])
      return route.fulfill({ status: 204, headers: cors, body: "" })
    }
    if (!questionWrite) return route.fallback()
    const write = { path, body: request.postData() ? request.postDataJSON() : undefined }
    const rejecting = questionWrite[3] === "reject"
    ;(rejecting ? wire.questionRejects : wire.questionReplies).push(write)
    if (!rejecting && wire.questionStatus !== 204)
      return route.fulfill({
        status: wire.questionStatus,
        json: { message: "Answer could not be saved" },
        headers: cors,
      })
    const answered = wire.questions.find((item) => item.sessionID === questionWrite[1] && item.id === questionWrite[2])
    if (!answered) return route.fulfill({ status: 404, json: { message: "Question request not found" }, headers: cors })
    if (!rejecting) {
      wire.questionReplyOwners.push(answered.sessionID)
      await wire.waitQuestionReply?.(answered.id)
    }
    wire.questions = wire.questions.filter((item) => item !== answered)
    wire.events.push({
      directory,
      payload: {
        type: rejecting ? "question.v2.rejected" : "question.v2.replied",
        properties: { sessionID: answered.sessionID, requestID: answered.id },
      },
    })
    wire.completedQuestions.push(answered.id)
    return route.fulfill({ status: 204, headers: cors, body: "" })
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
}

async function open(page: Page, wire: DecisionWire, id: string) {
  await page.goto(href(id))
  const current = wire.sessions.find((item) => item.id === id)
  if (!current) throw new Error(`Unknown fixture session: ${id}`)
  await expectSessionTitle(page, current.title)
  await expectAppVisible(editor(page))
}

async function switchTab(page: Page, wire: DecisionWire, id: string) {
  const current = wire.sessions.find((item) => item.id === id)
  if (!current) throw new Error(`Unknown fixture session: ${id}`)
  await page.getByRole("link").filter({ hasText: current.title }).click()
  await expect(page).toHaveURL(new RegExp(`/session/${id}$`))
  await expectSessionTitle(page, current.title)
}

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.tags.includes("@localized")) return
  await pinEnglishUI(page)
})

test("R01/R02: one active form, with the waiting question preserved after permission resolution", async ({ page }) => {
  const wire = decisionWire([session("ses_coexist")])
  await install(page, wire)
  await open(page, wire, "ses_coexist")
  asked(wire, { questions: [question("que_q1", "ses_coexist")], permissions: [permission("p1", "ses_coexist")] })
  await delivered(page, wire, "ses_coexist")
  await expect(permissionDock(page)).toBeVisible()
  await expect(questionDock(page)).toHaveCount(0)
  await permissionDock(page).getByRole("button", { name: "Allow once", exact: true }).click()
  await expect(questionDock(page)).toBeVisible()
  await expect(permissionDock(page)).toHaveCount(0)
  expect(wire.permissionReplies).toEqual([
    { path: "/api/session/ses_coexist/permission/p1/reply", body: { reply: "once" } },
  ])
  await questionDock(page).getByRole("radio", { name: /^Yes/ }).click()
  await questionDock(page).getByRole("button", { name: "Submit", exact: true }).click()
  await expect(editor(page)).toBeVisible()
  expect(wire.questionReplies).toEqual([
    { path: "/api/session/ses_coexist/question/que_q1/reply", body: { answers: [["Yes"]] } },
  ])
})

test("R02: arrivals do not remount the active question or steal its editing focus", async ({ page }) => {
  const wire = decisionWire([session("ses_sticky")])
  await install(page, wire)
  await open(page, wire, "ses_sticky")
  asked(wire, { questions: [question("que_q-z", "ses_sticky")] })
  await delivered(page, wire, "ses_sticky")
  await questionDock(page)
    .getByRole("radio", { name: /Type your own/ })
    .click()
  await customInput(page).fill("Keep editing this answer")
  await customInput(page).evaluate((element) => element.setAttribute("data-e2e-instance", "original"))
  asked(wire, { questions: [question("que_q-a", "ses_sticky")], permissions: [permission("p1", "ses_sticky")] })
  await delivered(page, wire, "ses_sticky")
  await expect(customInput(page)).toHaveValue("Keep editing this answer")
  await expect(customInput(page)).toHaveAttribute("data-e2e-instance", "original")
  await expect(customInput(page)).toBeFocused()
  await expect(permissionDock(page)).toHaveCount(0)
  expect(wire.questionReplies).toEqual([])
})

test("R03: same-ID questions keep separate drafts across SPA session switches", async ({ page }) => {
  const wire = decisionWire([session("ses_a"), session("ses_b")])
  await install(page, wire)
  await open(page, wire, "ses_b")
  await open(page, wire, "ses_a")
  asked(wire, { questions: [question("que_shared", "ses_a"), question("que_shared", "ses_b")] })
  await delivered(page, wire, "ses_a")
  await questionDock(page)
    .getByRole("radio", { name: /Type your own/ })
    .click()
  await customInput(page).fill("Answer for A")
  await switchTab(page, wire, "ses_b")
  await expect(questionDock(page)).toBeVisible()
  await expect(questionDock(page)).not.toContainText("Answer for A")
  await questionDock(page)
    .getByRole("radio", { name: /Type your own/ })
    .click()
  await customInput(page).fill("Answer for B")
  await switchTab(page, wire, "ses_a")
  await expect(questionDock(page)).toContainText("Answer for A")
  await expect(questionDock(page)).not.toContainText("Answer for B")
})

test("R03: in-flight permissions stay isolated when visiting both sessions again", async ({ page }) => {
  const wire = decisionWire([session("ses_a"), session("ses_b")])
  const a = Promise.withResolvers<void>()
  const b = Promise.withResolvers<void>()
  wire.waitPermission = (id) => (id === "ses_a" ? a.promise : b.promise)
  await install(page, wire)
  await open(page, wire, "ses_b")
  await open(page, wire, "ses_a")
  asked(wire, { permissions: [permission("que_shared", "ses_a"), permission("que_shared", "ses_b")] })
  await delivered(page, wire, "ses_a")
  const allow = permissionDock(page).getByRole("button", { name: "Allow once", exact: true })
  try {
    await allow.click()
    await expect.poll(() => wire.permissionReplies.length).toBe(1)
    await switchTab(page, wire, "ses_b")
    await expect(allow).toBeEnabled()
    await allow.click()
    await expect.poll(() => wire.permissionReplies.length).toBe(2)
    await switchTab(page, wire, "ses_a")
    await expect(allow).toBeDisabled()
    await switchTab(page, wire, "ses_b")
    a.resolve()
    await expect.poll(() => wire.completedPermissions).toContain("ses_a")
    await delivered(page, wire, "ses_b")
    await expect(allow).toBeDisabled()
    expect(wire.permissionReplies).toHaveLength(2)
    b.resolve()
    await expect(editor(page)).toBeVisible()
  } finally {
    a.resolve()
    b.resolve()
  }
})

test("R05: Esc on an option never rejects the business request", async ({ page }) => {
  const wire = decisionWire([session("ses_keys")])
  await install(page, wire)
  await open(page, wire, "ses_keys")
  asked(wire, { questions: [question("que_q1", "ses_keys")] })
  await delivered(page, wire, "ses_keys")
  await questionDock(page).getByRole("radio", { name: /^Yes/ }).press("Escape")
  await delivered(page, wire, "ses_keys")
  expect(wire.questionRejects).toEqual([])
  await expect(questionDock(page)).toBeVisible()
})

test("R05: Ctrl+Enter requires an explicit answer and composition keys never submit", async ({ page }) => {
  const wire = decisionWire([session("ses_ime")])
  await install(page, wire)
  await open(page, wire, "ses_ime")
  asked(wire, { questions: [question("que_q1", "ses_ime")] })
  await delivered(page, wire, "ses_ime")
  await questionDock(page).getByRole("radio", { name: /^Yes/ }).press("Control+Enter")
  await delivered(page, wire, "ses_ime")
  expect(wire.questionReplies).toEqual([])
  await expect(questionDock(page).getByRole("button", { name: "Submit", exact: true })).toBeDisabled()
  await questionDock(page)
    .getByRole("radio", { name: /Type your own/ })
    .click()
  await customInput(page).fill("中文 ")
  await customInput(page).pressSequentially("123")
  await customInput(page).dispatchEvent("compositionstart")
  await customInput(page).dispatchEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })
  await customInput(page).dispatchEvent("keydown", { key: "Enter", isComposing: false, bubbles: true })
  await expect(customInput(page)).toBeVisible()
  await expect(customInput(page)).toHaveValue("中文 123")
  await customInput(page).dispatchEvent("compositionend")
  await customInput(page).press("Escape")
  await delivered(page, wire, "ses_ime")
  expect(wire.questionReplies).toEqual([])
  expect(wire.questionRejects).toEqual([])
  await expect(questionDock(page)).toContainText("中文 123")
})

for (const viewport of [
  { name: "desktop", width: 1280, height: 720 },
  { name: "narrow", width: 390, height: 844 },
]) {
  for (const history of ["empty", "scrolled"] as const) {
    test(`R04/mouse: ${viewport.name} file completion owns pointer hits with ${history} history`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      const wire = decisionWire([session("ses_mouse")])
      const messages = Array.from({ length: history === "empty" ? 0 : 24 }, (_, index) => ({
        info: {
          id: `msg_mouse_${String(index).padStart(3, "0")}`,
          sessionID: "ses_mouse",
          role: "user",
          time: { created: 1700000000000 + index },
          agent: "build",
          model: { providerID: "aigcfroge", modelID: "decision-model" },
        },
        parts: [
          {
            id: `prt_mouse_${index}`,
            sessionID: "ses_mouse",
            messageID: `msg_mouse_${String(index).padStart(3, "0")}`,
            type: "text",
            text: `Historical prompt ${index}.`,
          },
        ],
      }))
      await install(page, wire, () => ({ items: messages }))
      await open(page, wire, "ses_mouse")
      const scroller = page.locator(".scroll-view__viewport").filter({ has: page.locator("[data-session-title]") })
      const jump = page
        .locator("button")
        .filter({ has: page.locator('use[href="#aigcfroge-icon-arrow-down-to-line"]') })
      if (history === "scrolled") {
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
          .toBeGreaterThan(viewport.height)
        await scroller.hover()
        await page.mouse.wheel(0, -2000)
        await expect
          .poll(() => jump.evaluate((element) => getComputedStyle(element.parentElement ?? element).opacity))
          .toBe("1")
      }
      const scrollTop = await scroller.evaluate((element) => element.scrollTop)
      await editor(page).fill("Keep this draft @reviewer")
      await expect(page.getByRole("button", { name: /^@reviewer(?:\s|$)/ })).toBeVisible()
      await editor(page).press("Enter")
      await editor(page).pressSequentially(" @example")
      const option = page.getByRole("button", { name: /example\.ts/ })
      await expect(option).toBeVisible()
      const hit = await option.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        const target = document.elementFromPoint(x, y)
        const describe = (node: Element) => ({
          tag: node.tagName,
          component: node.getAttribute("data-component"),
          href: node.getAttribute("href"),
          class: node.getAttribute("class"),
          opacity: getComputedStyle(node).opacity,
          pointerEvents: getComputedStyle(node).pointerEvents,
          zIndex: getComputedStyle(node).zIndex,
          inert: node.hasAttribute("inert"),
        })
        const ancestors = (node: Element | null): ReturnType<typeof describe>[] =>
          node ? [describe(node), ...ancestors(node.parentElement)] : []
        return {
          x,
          y,
          optionReceivesPointer: !!target && element.contains(target),
          stack: document.elementsFromPoint(x, y).slice(0, 8).map(describe),
          ancestors: ancestors(target),
        }
      })
      const pointer = await option.evaluateHandle((element) => {
        const result = { trusted: false, optionReceivesPointer: false, target: "" }
        document.addEventListener(
          "pointerdown",
          (event) => {
            result.trusted = event.isTrusted
            result.optionReceivesPointer = event.target instanceof Node && element.contains(event.target)
            result.target = event.target instanceof Element ? event.target.outerHTML.slice(0, 1000) : ""
          },
          { once: true, capture: true },
        )
        return result
      })
      await testInfo.attach("file-completion-hit-test", {
        body: JSON.stringify(hit, null, 2),
        contentType: "application/json",
      })
      await testInfo.attach("file-completion-before-pointer", {
        body: await page.screenshot(),
        contentType: "image/png",
      })
      await page.mouse.click(hit.x, hit.y)
      const received = await pointer.jsonValue()
      await pointer.dispose()
      await testInfo.attach("file-completion-pointer-event", {
        body: JSON.stringify(received, null, 2),
        contentType: "application/json",
      })
      expect(received.trusted, "The test must use a browser-dispatched pointer event").toBe(true)
      expect(hit.optionReceivesPointer, "The visible completion must own its pointer hit target").toBe(true)
      expect(received.optionReceivesPointer, "The real pointer must reach the completion").toBe(true)
      await expect(editor(page).locator('[data-type="file"][data-path="src/example.ts"]')).toBeVisible()
      await expect(editor(page).locator('[data-type="agent"][data-name="reviewer"]')).toBeVisible()
      await expect(editor(page)).toContainText("Keep this draft")
      await expect(editor(page)).toBeFocused()
      await editor(page).pressSequentially(" continued")
      await expect(editor(page)).toContainText("continued")
      expect(wire.promptWrites).toEqual([])
      if (history === "empty") {
        // The jump button immediately precedes the scroll region in DOM tab order.
        await scroller.focus()
        await expect(scroller).toBeFocused()
        await page.keyboard.press("Shift+Tab")
        await expect(jump).not.toBeFocused()
      }
      if (history === "scrolled") {
        expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollTop, 0)
        await jump.click()
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
          .toBeLessThanOrEqual(2)
      }
    })
  }
}

for (const outcome of ["reply", "reject", "failure"] as const) {
  test(`R04/R05: prompt text, image, file/agent pills and selection survive question ${outcome}`, async ({ page }) => {
    const wire = decisionWire([session("ses_draft")])
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await install(page, wire)
    await open(page, wire, "ses_draft")
    await editor(page).fill("Keep this draft @reviewer")
    await expect(page.getByRole("button", { name: /^@reviewer(?:\s|$)/ })).toBeVisible()
    await editor(page).press("Enter")
    await editor(page).pressSequentially(" @example")
    await expect(page.getByRole("button", { name: /example\.ts/ })).toBeVisible()
    await editor(page).press("Enter")
    await editor(page).pressSequentially(" 123")
    await page.locator('[data-component="session-composer"] input[type="file"]').setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
        "base64",
      ),
    })
    await expect(page.getByRole("img", { name: "pixel.png" })).toBeVisible()
    await expect(editor(page).locator('[data-type="agent"][data-name="reviewer"]')).toBeVisible()
    await expect(editor(page).locator('[data-type="file"][data-path="src/example.ts"]')).toBeVisible()
    await editor(page).evaluate((element) => {
      if (!(element instanceof HTMLElement)) throw new Error("Expected an editable HTML element")
      const text = element.firstChild
      if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error("Expected leading prompt text")
      const selection = window.getSelection()
      if (!selection) throw new Error("Selection is unavailable")
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 4)
      element.focus()
      selection.removeAllRanges()
      selection.addRange(range)
    })
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Keep")
    asked(wire, { questions: [question("que_q1", "ses_draft")] })
    await delivered(page, wire, "ses_draft")
    await expect(questionDock(page)).toBeVisible()
    if (outcome === "reject") {
      await questionDock(page).getByRole("button", { name: "Dismiss", exact: true }).click()
    } else {
      await questionDock(page).getByRole("radio", { name: /^Yes/ }).click()
      if (outcome === "failure") wire.questionStatus = 500
      await questionDock(page).getByRole("button", { name: "Submit", exact: true }).click()
      if (outcome === "failure") {
        await expect(page.getByText("Answer could not be saved", { exact: true })).toBeVisible()
        await expect(questionDock(page).getByRole("radio", { name: /^Yes/ })).toBeChecked()
        await questionDock(page).getByRole("button", { name: "Dismiss", exact: true }).click()
      }
    }
    await expect(editor(page)).toBeVisible()
    await expect(editor(page)).toContainText("Keep this draft")
    await expect(editor(page)).toContainText("123")
    await expect(editor(page).locator('[data-type="agent"][data-name="reviewer"]')).toBeVisible()
    await expect(editor(page).locator('[data-type="file"][data-path="src/example.ts"]')).toBeVisible()
    await expect(page.getByRole("img", { name: "pixel.png" })).toBeVisible()
    await expect(editor(page)).toBeFocused()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("Keep")
    expect(wire.promptWrites).toEqual([])
    expect(errors).toEqual([])
  })
}

test("R03: a cancelled parent question cannot seed a same-ID child question draft", async ({ page }) => {
  const wire = decisionWire([session("ses_parent"), session("ses_child", "ses_child", "ses_parent")])
  await install(page, wire)
  await open(page, wire, "ses_parent")
  asked(wire, { questions: [question("que_shared", "ses_parent"), question("que_shared", "ses_child")] })
  await delivered(page, wire, "ses_parent")
  await expect(questionDock(page)).toContainText("Pick one for ses_parent")
  await questionDock(page)
    .getByRole("radio", { name: /Type your own/ })
    .click()
  await customInput(page).fill("Parent-only draft")
  wire.questions = wire.questions.filter((item) => item.sessionID !== "ses_parent")
  wire.events.push({
    directory,
    payload: { type: "question.v2.rejected", properties: { sessionID: "ses_parent", requestID: "que_shared" } },
  })
  await delivered(page, wire, "ses_parent")
  await expect(questionDock(page)).toContainText("Pick one for ses_child")
  await expect(questionDock(page)).not.toContainText("Parent-only draft")
  expect(wire.questionReplies).toEqual([])
  expect(wire.questionRejects).toEqual([])
})

test("R01/picker: all pending requests are discoverable and choosing one does not decide it", async ({ page }) => {
  const wire = decisionWire([session("ses_picker")])
  await install(page, wire)
  await open(page, wire, "ses_picker")
  asked(wire, {
    questions: [
      question("que_q-hidden", "ses_picker", {
        header: "Hidden question",
        question: "Which hidden path?",
        options: [
          { label: "Hidden yes", description: "Choose the hidden path" },
          { label: "Hidden no", description: "Skip the hidden path" },
        ],
      }),
      question("que_q-visible", "ses_picker", {
        header: "Visible question",
        question: "Which visible path?",
        options: [
          { label: "Visible yes", description: "Choose the visible path" },
          { label: "Visible no", description: "Skip the visible path" },
        ],
      }),
    ],
    permissions: [permission("p-visible", "ses_picker")],
  })
  await delivered(page, wire, "ses_picker")

  await expect(permissionDock(page)).toBeVisible()
  await expect(questionDock(page)).toHaveCount(0)
  await openRequestPicker(page, 3)
  await expect(
    page.getByRole("option", { name: /Hidden question[\s\S]*q-hidden|q-hidden[\s\S]*Hidden question/ }),
  ).toBeVisible()
  await expect(
    page.getByRole("option", { name: /Visible question[\s\S]*q-visible|q-visible[\s\S]*Visible question/ }),
  ).toBeVisible()
  await expect(page.getByRole("option", { name: /bash[\s\S]*p-visible|p-visible[\s\S]*bash/i })).toBeVisible()
  await page.getByRole("option", { name: /Hidden question[\s\S]*q-hidden|q-hidden[\s\S]*Hidden question/ }).click()

  await expect(questionDock(page)).toHaveCount(1)
  await expect(permissionDock(page)).toHaveCount(0)
  await expect(questionDock(page).getByRole("radio", { name: /^Hidden yes/ })).toBeVisible()
  expect(wire.questionReplies).toEqual([])
  expect(wire.questionRejects).toEqual([])
  expect(wire.permissionReplies).toEqual([])
  expect(wire.promptWrites).toEqual([])

  asked(wire, { permissions: [permission("p-new", "ses_picker")] })
  await delivered(page, wire, "ses_picker")
  await expect(requestTrigger(page, 4)).toBeVisible()
  await expect(questionDock(page).getByRole("radio", { name: /^Hidden yes/ })).toBeVisible()
  await expect(permissionDock(page)).toHaveCount(0)
  expect(wire.questionReplies).toEqual([])
  expect(wire.questionRejects).toEqual([])
  expect(wire.permissionReplies).toEqual([])
  expect(wire.promptWrites).toEqual([])
})

test("R02/R03/picker: same-ID owner drafts stay distinct and arrivals do not remount the selected question", async ({
  page,
}) => {
  const wire = decisionWire([session("ses_parent", "Parent owner"), session("ses_child", "Child owner", "ses_parent")])
  await install(page, wire)
  await open(page, wire, "ses_parent")
  asked(wire, {
    questions: [
      question("que_shared", "ses_parent", { header: "Parent draft", question: "Parent draft question" }),
      question("que_shared", "ses_child", { header: "Child draft", question: "Child draft question" }),
    ],
  })
  await delivered(page, wire, "ses_parent")

  await questionDock(page)
    .getByRole("radio", { name: /Type your own/ })
    .click()
  await customInput(page).fill("Parent draft answer")
  await openRequestPicker(page, 2)
  await expect(page.getByRole("option", { name: /Parent owner|ses_parent/ })).toBeVisible()
  await expect(page.getByRole("option", { name: /Child owner|ses_child/ })).toBeVisible()
  await page.getByRole("option", { name: /Child draft/ }).click()

  await questionDock(page)
    .getByRole("radio", { name: /Type your own/ })
    .click()
  await customInput(page).fill("Child draft answer")
  await chooseRequest(page, 2, /Parent draft/)
  await expect(activeCustomControl(page)).toBeFocused()
  if (await activeCustomControl(page).evaluate((element) => element.tagName === "BUTTON"))
    await activeCustomControl(page).click()
  await expect(customInput(page)).toHaveValue("Parent draft answer")
  await expect(customInput(page)).toBeFocused()
  await customInput(page).evaluate((element) => element.setAttribute("data-e2e-instance", "parent-original"))

  asked(wire, { permissions: [permission("p-new", "ses_parent")] })
  await delivered(page, wire, "ses_parent")
  await expect(requestTrigger(page, 3)).toBeVisible()
  await expect(customInput(page)).toHaveValue("Parent draft answer")
  await expect(customInput(page)).toHaveAttribute("data-e2e-instance", "parent-original")
  await expect(customInput(page)).toBeFocused()
  await expect(permissionDock(page)).toHaveCount(0)
  expect(wire.questionReplies).toEqual([])
  expect(wire.questionRejects).toEqual([])
  expect(wire.permissionReplies).toEqual([])
  expect(wire.promptWrites).toEqual([])
})

test("R03/picker: in-flight replies stay scoped while switching and completing", async ({ page }) => {
  const wire = decisionWire([session("ses_inflight")])
  const a = Promise.withResolvers<void>()
  const b = Promise.withResolvers<void>()
  wire.waitQuestionReply = (id) => (id === "que_q-a" ? a.promise : id === "que_q-b" ? b.promise : undefined)
  await install(page, wire)
  await open(page, wire, "ses_inflight")
  asked(wire, {
    questions: [
      question("que_q-a", "ses_inflight", {
        header: "In-flight A",
        question: "Answer the in-flight A request",
        options: [{ label: "A yes", description: "Answer A" }],
      }),
      question("que_q-b", "ses_inflight", {
        header: "In-flight B",
        question: "Answer the in-flight B request",
        options: [{ label: "B yes", description: "Answer B" }],
      }),
    ],
  })
  await delivered(page, wire, "ses_inflight")
  const submit = () => questionDock(page).getByRole("button", { name: "Submit", exact: true })

  try {
    await questionDock(page)
      .getByRole("radio", { name: /^A yes/ })
      .click()
    await submit().click()
    await expect.poll(() => wire.questionReplies.length).toBe(1)
    await chooseRequest(page, 2, /In-flight B/)
    await expect(questionDock(page).getByRole("radio", { name: /^B yes/ })).toBeVisible()
    await questionDock(page)
      .getByRole("radio", { name: /^B yes/ })
      .click()
    await submit().click()
    await expect.poll(() => wire.questionReplies.length).toBe(2)

    await chooseRequest(page, 2, /In-flight A/)
    await expect(questionDock(page).getByRole("radio", { name: /^A yes/ })).toBeChecked()
    await expect(submit()).toBeDisabled()

    a.resolve()
    await expect.poll(() => wire.completedQuestions).toContain("que_q-a")
    await delivered(page, wire, "ses_inflight")
    await expect(requestPicker(page)).toHaveCount(0)
    await expect(questionDock(page).getByRole("radio", { name: /^B yes/ })).toBeChecked()
    await expect(submit()).toBeDisabled()

    b.resolve()
    await expect.poll(() => wire.completedQuestions).toContain("que_q-b")
    await delivered(page, wire, "ses_inflight")
    await expect(editor(page)).toBeVisible()
    expect(wire.questionReplies.map((write) => write.path)).toEqual([
      "/api/session/ses_inflight/question/que_q-a/reply",
      "/api/session/ses_inflight/question/que_q-b/reply",
    ])
    expect(wire.questionReplyOwners).toEqual(["ses_inflight", "ses_inflight"])
  } finally {
    a.resolve()
    b.resolve()
  }
})

test("R02/R05/picker: external closure falls back by priority and menu Esc does not reject", async ({ page }) => {
  const wire = decisionWire([session("ses_external")])
  await install(page, wire)
  await open(page, wire, "ses_external")
  asked(wire, {
    questions: [
      question("que_q-selected", "ses_external", {
        header: "Selected question",
        question: "Selected question body",
        options: [{ label: "Selected yes", description: "Answer the selected question" }],
      }),
      question("que_q-other", "ses_external", {
        header: "Other question",
        question: "Other question body",
        options: [{ label: "Other yes", description: "Answer the other question" }],
      }),
    ],
    permissions: [permission("p-priority", "ses_external")],
  })
  await delivered(page, wire, "ses_external")

  await chooseRequest(page, 3, /Selected question/)
  await expect(questionDock(page).getByRole("radio", { name: /^Selected yes/ })).toBeVisible()
  await openRequestPicker(page, 3)
  await expect(page.getByRole("listbox")).toBeVisible()
  await requestTrigger(page, 3).press("Escape")
  await expect(page.getByRole("listbox")).toHaveCount(0)
  await expect(questionDock(page).getByRole("radio", { name: /^Selected yes/ })).toBeVisible()
  expect(wire.questionReplies).toEqual([])
  expect(wire.questionRejects).toEqual([])
  expect(wire.permissionReplies).toEqual([])
  expect(wire.promptWrites).toEqual([])

  wire.questions = wire.questions.filter((item) => item.id !== "que_q-selected")
  wire.events.push({
    directory,
    payload: {
      type: "question.v2.rejected",
      properties: { sessionID: "ses_external", requestID: "que_q-selected" },
    },
  })
  await delivered(page, wire, "ses_external")
  await expect(permissionDock(page)).toBeVisible()
  await expect(requestTrigger(page, 2)).toBeVisible()

  await chooseRequest(page, 2, /Other question/)
  await expect(questionDock(page).getByRole("radio", { name: /^Other yes/ })).toBeVisible()
  wire.questions = wire.questions.filter((item) => item.id !== "que_q-other")
  wire.events.push({
    directory,
    payload: {
      type: "question.v2.replied",
      properties: { sessionID: "ses_external", requestID: "que_q-other" },
    },
  })
  await delivered(page, wire, "ses_external")
  await expect(permissionDock(page)).toBeVisible()
  await expect(requestPicker(page)).toHaveCount(0)
  expect(wire.questionReplies).toEqual([])
  expect(wire.questionRejects).toEqual([])
  expect(wire.permissionReplies).toEqual([])
  expect(wire.promptWrites).toEqual([])
})

for (const presentation of [
  { locale: "en", scheme: "light", label: "Pending requests: 2" },
  { locale: "zh", scheme: "dark", label: "待处理请求：2" },
] as const) {
  test(
    `R01/R05/presentation: narrow ${presentation.locale}/${presentation.scheme} picker supports keyboard selection`,
    { tag: "@localized" },
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.addInitScript(({ locale, scheme }) => {
        localStorage.setItem("aigcfroge.global.dat:language", JSON.stringify({ locale }))
        localStorage.setItem("aigcfroge-color-scheme", scheme)
      }, presentation)
      const wire = decisionWire([session("ses_presentation")])
      await install(page, wire)
      await open(page, wire, "ses_presentation")
      asked(wire, {
        questions: [
          question("que_q-first", "ses_presentation", {
            header: "First pending request 首条待处理请求",
            question: "Review the first pending request before continuing",
          }),
          question("que_q-last", "ses_presentation", {
            header: "Last pending request 末条待处理请求",
            question: "Review the last pending request before continuing",
          }),
        ],
      })
      await delivered(page, wire, "ses_presentation")
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", presentation.scheme)
      await expect(requestPicker(page).getByText(presentation.label, { exact: true })).toBeVisible()
      const trigger = requestPicker(page).getByRole("button", { name: new RegExp(presentation.label) })
      await expect(trigger).toBeVisible()
      await trigger.focus()
      await trigger.press("Enter")
      await expect(requestListbox(page)).toBeVisible()
      await expect(requestListbox(page).getByRole("option")).toHaveCount(2)
      for (const control of [trigger, requestListbox(page)]) {
        const bounds = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, viewport: window.innerWidth }
        })
        expect(bounds.left).toBeGreaterThanOrEqual(0)
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1)
      }
      await testInfo.attach(`pending-picker-${presentation.locale}-${presentation.scheme}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      })
      await page.keyboard.press("End")
      await page.keyboard.press("Enter")
      await expect(requestListbox(page)).toBeHidden()
      await expect(trigger).toContainText("Last pending request 末条待处理请求")
      await expect(questionDock(page)).toContainText("Review the last pending request before continuing")
      await trigger.focus()
      await trigger.press("Enter")
      await expect(requestListbox(page)).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(requestListbox(page)).toBeHidden()
      await expect(trigger).toBeFocused()
      expect(wire.questionReplies).toEqual([])
      expect(wire.questionRejects).toEqual([])
      expect(wire.permissionReplies).toEqual([])
      expect(wire.promptWrites).toEqual([])
    },
  )
}
