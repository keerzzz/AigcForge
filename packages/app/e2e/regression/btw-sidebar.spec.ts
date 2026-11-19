import { createHash } from "node:crypto"
import { expect, test } from "@playwright/test"
import type { SessionMessageInfo } from "@aigcfroge/client/promise"
import { InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Session } from "@aigcfroge/schema/session"
import { SessionConsultation } from "@aigcfroge/schema/session-consultation"
import { SessionInbox } from "@aigcfroge/schema/session-inbox"
import { Schema } from "effect"
import { base64Encode } from "@aigcfroge/util/encode"
import { pageMessagesFrom, provider, SERVER, session, sessionHref, T0, workspaceKey } from "../utils/app"
import type { MockAnswer, MockServerConfig } from "../utils/mock-server"
import { MockNotFound } from "../utils/mock-api"
import { openSidePanel } from "../utils/side-panel"
import { installSseTransport } from "../utils/sse-transport"
import { openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const model = { id: "sc07-model", providerID: "aigcfroge" }

const sourceAnswer = "SC07 source answer whose completed boundary must be captured."

type ConsultationRequest = Parameters<NonNullable<MockServerConfig["onConsultation"]>>[0]

function sourceHistory(sessionID: string, agent = "build"): SessionMessageInfo[] {
  return [
    { id: `msg_${sessionID}_question`, type: "user", text: "Explain this saved source.", time: { created: T0 } },
    {
      id: `msg_${sessionID}_answer`,
      type: "assistant",
      agent,
      model,
      time: { created: T0 + 1, completed: T0 + 2 },
      needsContinuation: false,
      completion: { id: `evt_${sessionID}_completed`, seq: 3 },
      content: [{ type: "text", text: sourceAnswer }],
    },
  ]
}

function consultation(request: ConsultationRequest, directory: string, projectID: string, text: string) {
  const material = `Saved server reference for ${request.sourceSessionID} through ${request.body.boundary.messageID}.`

  const reference = {
    sourceSessionID: request.sourceSessionID,
    boundary: request.body.boundary,
    boundarySeq: 3,
    sourceMessageIDs: [request.body.boundary.messageID],
    digest: createHash("sha256").update(material).digest("hex"),
    omissions: [],
    file: {
      data: Buffer.from(material).toString("base64"),
      mime: "text/plain",
      source: { type: "inline" },
      name: "saved-source-reference.txt",
    },
  } satisfies Schema.Codec.Encoded<typeof SessionConsultation.Reference>

  const user = {
    id: request.body.prompt.id,
    type: "user",
    text: request.body.prompt.text,
    files: [
      ...(request.body.prompt.files ?? []).map((file) => ({
        name: file.name,
        data: Buffer.from(decodeURIComponent(file.uri.slice("data:text/plain;charset=utf-8,".length))).toString(
          "base64",
        ),
        mime: "text/plain",
        source: { type: "inline" as const },
      })),
      reference.file,
    ],
    time: { created: T0 + 10 },
  } satisfies SessionMessageInfo

  const info = Schema.encodeSync(Session.Info)(
    Schema.decodeUnknownSync(Session.Info)({
      id: request.body.id,
      projectID,
      mode: "chat",
      agent: request.body.agent,
      model: request.body.model ?? model,
      title: request.body.title ?? request.body.prompt.text,
      metadata: { consultation: { sourceSessionID: request.sourceSessionID, firstMessageID: request.body.prompt.id } },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      location: { directory },
      time: { created: T0 + 10, updated: T0 + 12 },
    }),
  )

  const messages: SessionMessageInfo[] = [
    user,
    {
      id: `msg_${request.body.id}_answer`,
      type: "assistant",
      agent: request.body.agent,
      model,
      metadata: { parentID: user.id },
      time: { created: T0 + 11, completed: T0 + 12 },
      needsContinuation: false,
      completion: { id: `evt_${request.body.id}_completed`, seq: 3 },
      content: [{ type: "text", text }],
    },
  ]

  return {
    data: { session: info, reference, admission: { state: "promoted", input: user } } satisfies Schema.Codec.Encoded<
      typeof SessionConsultation.Data
    >,
    messages,
  }
}

test.use({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] })

test("SC07 reads legacy BTW records without executing and explicitly continues them in a new Chat root", async ({
  page,
}, testInfo) => {
  const sourceID = "ses_sc07_legacy_source"
  const directory = "/sc07/legacy"
  const legacyID = "legacy-success"
  const question = "Original client question"
  const answer = "Original client answer remains readable."
  const creates: ConsultationRequest[] = []
  const ordinaryCreates: Schema.JsonObject[] = []
  const generations: unknown[] = []
  const prompts: { sessionID: string; body: Schema.JsonObject }[] = []
  const writes: { path: string; directory: string; body: string }[] = []
  const continuedAnswer = "Explicit continuation belongs to a new Chat root."
  const messages: Record<string, SessionMessageInfo[]> = {}
  const saved = new Map<string, ReturnType<typeof consultation>>()

  messages[sourceID] = sourceHistory(sourceID, "review-user")

  const workspace = await openSession(page, {
    name: "SC07 legacy records",
    directory,
    sessions: [{ id: sourceID, title: "Legacy source", mode: "custom", agent: "review-user", model }],
    agents: [
      {
        id: "review-user",
        name: "Review user",
        mode: "primary",
        hidden: false,
        originKind: "user",
        ordinaryModes: ["custom"],
        originRelativePath: "review-user.md",
        originRevision: "a".repeat(64),
        request: { settings: {}, headers: {}, body: {} },
        permissions: [],
        handoffs: [],
      },
      {
        id: "build",
        name: "Build",
        mode: "all",
        hidden: false,
        originKind: "builtin",
        ordinaryModes: ["chat", "coding", "work", "assistant", "custom"],
        request: { settings: {}, headers: {}, body: {} },
        permissions: [],
        handoffs: [],
      },
    ],
    provider: provider({ id: model.id, name: "SC07 model" }),
    pageMessages: pageMessagesFrom(messages),
    generate: (request) => {
      generations.push(request)

      return { text: "Unexpected legacy generation" }
    },
    onPrompt: (request) => void prompts.push(request),
    onSessionCreate: (body) => void ordinaryCreates.push(body),
    onFileWrite: (write) => void writes.push(write),
    onConsultation: (request) => {
      creates.push(request)
      const result = consultation(request, directory, workspace.projectID, continuedAnswer)
      result.messages.push({
        id: `msg_${request.body.id}_tool_only`,
        type: "assistant",
        agent: request.body.agent,
        model,
        metadata: { parentID: request.body.prompt.id },
        time: { created: T0 + 13, completed: T0 + 14 },
        needsContinuation: false,
        completion: { id: `evt_${request.body.id}_tool_only_completed`, seq: 4 },
        content: [
          {
            type: "tool",
            id: "tool_sc07_following_read",
            name: "read",
            time: { created: T0 + 13, ran: T0 + 13, completed: T0 + 14 },
            state: {
              status: "completed",
              input: { path: "saved-source.txt" },
              content: [{ type: "text", text: "Following tool output" }],
            },
          },
        ],
      })
      saved.set(request.body.id, result)
      messages[request.body.id] = result.messages
      workspace.sessions.push(session({ ...result.data.session, directory }))

      return { status: 200, body: { data: result.data } }
    },
    onConsultationRead: (sessionID) => {
      const result = saved.get(sessionID)

      if (!result)
        return {
          status: 404,
          body: Schema.encodeSync(MockNotFound)(new MockNotFound({ message: "Saved consultation not found" })),
        }

      return { status: 200, body: { data: { reference: result.data.reference, admission: result.data.admission } } }
    },
    seed: {
      storage: {
        [workspaceKey(base64Encode(directory), "extension.btw.chats").replace(":workspace:", `:session:${sourceID}:`)]:
          {
            chats: [
              { id: legacyID, question, answer },
              { id: "legacy-failure", question: "Original failed client question" },
            ],
          },
      },
    },
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  await workspace.editor.press("Control+Alt+B")
  await expect(page.locator("#review-panel").getByRole("tab", { name: "Side chats", exact: true })).toHaveCount(1)
  expect(creates).toHaveLength(0)
  await page.locator("#review-panel").getByRole("button", { name: question, exact: true }).click()
  await expect(panel.getByText(answer, { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Copy answer", exact: true })).toBeVisible()
  await expect(panel.locator('[data-component="composer-editor"]')).toHaveCount(0)
  await page.reload()
  await expect(panel.getByText(answer, { exact: true })).toBeVisible()
  expect(creates).toHaveLength(0)
  expect(generations).toHaveLength(0)
  expect(prompts).toHaveLength(0)

  await panel.getByRole("button", { name: "Continue side chat", exact: true }).click()
  const firstQuestion = panel.getByRole("textbox", { name: "Side question", exact: true })
  await expect(firstQuestion).toHaveValue(question)
  await firstQuestion.fill("Continue this saved client material")
  expect(creates).toHaveLength(0)
  await panel.getByRole("button", { name: "Start side chat", exact: true }).click()
  await expect(panel.getByText(continuedAnswer, { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Copy answer", exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(continuedAnswer)
  expect(creates).toHaveLength(1)
  expect(creates[0]?.sourceSessionID).toBe(sourceID)
  expect(creates[0]?.body.agent).toBe("build")
  expect(creates[0]?.body.id).not.toBe(legacyID)
  expect(creates[0]?.body.prompt.text).toBe("Continue this saved client material")
  const legacyFile = creates[0]?.body.prompt.files?.find((file) => file.name === `legacy-btw-${legacyID}.txt`)
  expect(legacyFile).toBeDefined()
  expect(legacyFile?.uri).toMatch(/^data:text\/plain;charset=utf-8,/)
  const material = decodeURIComponent(legacyFile?.uri.slice("data:text/plain;charset=utf-8,".length) ?? "")
  expect(material).toContain("Legacy BTW client material")
  expect(material).toContain(question)
  expect(material).toContain(answer)
  const main = page.locator('[data-slot="session-chat-panel"]')
  const sourceEditor = main.locator('[data-component="composer-editor"]')
  await sourceEditor.fill("Existing source draft")

  const sourceFile = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(["Retained source attachment"], "source-kept.txt", { type: "text/plain" }))

    return transfer
  })

  await main.dispatchEvent("drop", { dataTransfer: sourceFile })
  await expect(main.locator('[data-component="composer-attachments"]')).toContainText("source-kept.txt")
  await sourceEditor.press("Home")
  await panel.getByRole("button", { name: "Insert into source draft", exact: true }).click()
  await expect(sourceEditor).toHaveText(continuedAnswer + "Existing source draft")
  await sourceEditor.pressSequentially("!")
  await expect(sourceEditor).toHaveText(continuedAnswer + "!Existing source draft")
  await expect(main.locator('[data-component="composer-attachments"]')).toContainText("source-kept.txt")
  await expect(page).toHaveURL(sessionHref(sourceID))
  await expectSessionTitle(page, "Legacy source")
  expect(writes).toHaveLength(1)
  expect(writes[0]?.directory).toBe(directory)
  expect(ordinaryCreates).toHaveLength(0)
  expect(prompts).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath("sc07-legacy-explicit-continuation.png") })
  await openSidePanel(page, "Side chats")
  await page
    .locator("#review-panel")
    .getByRole("button", { name: "Original failed client question", exact: true })
    .click()
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Continue side chat", exact: true })).toBeEnabled()
  expect(creates).toHaveLength(1)
  expect(generations).toHaveLength(0)
  expect(prompts).toHaveLength(0)

  messages[sourceID] = []
  await page.reload()
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toBeVisible()
  expect(creates).toHaveLength(1)
  expect(ordinaryCreates).toHaveLength(0)
  expect(prompts).toHaveLength(0)
  expect(generations).toHaveLength(0)
  await openSidePanel(page, "Side chats")
  await page.locator("#review-panel").getByRole("button", { name: question, exact: true }).click()
  await expect(panel.getByText(answer, { exact: true })).toBeVisible()
  await panel.getByRole("button", { name: "Continue side chat", exact: true }).click()
  await expect(firstQuestion).toHaveValue(question)
  await firstQuestion.fill("Continue saved client material without source history")
  await panel.getByRole("button", { name: "Start side chat", exact: true }).click()
  await expect.poll(() => ordinaryCreates.length).toBe(1)
  await expect.poll(() => prompts.length).toBe(1)
  await expect(panel.locator('[data-component="composer-editor"]')).toBeEditable()
  expect(ordinaryCreates[0]).toMatchObject({ mode: "chat", agent: "build", location: { directory } })
  expect(ordinaryCreates[0]?.parentID).toBeUndefined()
  expect(prompts[0]?.sessionID).toBe(ordinaryCreates[0]?.id)
  const fallbackPrompt = Schema.decodeUnknownSync(SessionConsultation.Prompt)(prompts[0]?.body)
  expect(fallbackPrompt.text).toBe("Continue saved client material without source history")
  const fallbackFile = fallbackPrompt.files?.find((file) => file.name === `legacy-btw-${legacyID}.txt`)
  expect(fallbackFile).toBeDefined()
  expect(fallbackFile?.uri).toMatch(/^data:text\/plain;charset=utf-8,/)
  const fallbackMaterial = decodeURIComponent(fallbackFile?.uri.slice("data:text/plain;charset=utf-8,".length) ?? "")
  expect(fallbackMaterial).toContain("Legacy BTW client material")
  expect(fallbackMaterial).toContain(question)
  expect(fallbackMaterial).toContain(answer)
  await openSidePanel(page, "Side chats")
  await page.locator("#review-panel").getByRole("button", { name: question, exact: true }).click()
  await expect(panel.getByText(answer, { exact: true })).toBeVisible()
  expect(creates).toHaveLength(1)
  expect(ordinaryCreates).toHaveLength(1)
  expect(prompts).toHaveLength(1)
  expect(generations).toHaveLength(0)
})

test("SC07 keeps two persistent side roots independent through attachments, token updates, stop and closed-view restoration", async ({
  page,
}, testInfo) => {
  const sourceID = "ses_sc07_two_source"
  const otherID = "ses_sc07_two_other"
  const directory = "/sc07/two"
  const firstQuestion = "First persistent question"
  const secondQuestion = "Second persistent question"
  const creates: ConsultationRequest[] = []
  const prompts: { sessionID: string; body: Schema.JsonObject }[] = []
  const writes: { path: string; directory: string; body: string }[] = []
  const stops: string[] = []
  const generations: unknown[] = []
  const deletes: string[] = []
  const messages: Record<string, SessionMessageInfo[]> = {}
  const saved = new Map<string, ReturnType<typeof consultation>>()
  const status: Record<string, { type: string }> = {}
  const transport = await installSseTransport(page, { server: SERVER })

  messages[sourceID] = sourceHistory(sourceID, "plan")
  messages[otherID] = sourceHistory(otherID)
  status[sourceID] = { type: "running" }

  page.on("request", (request) => {
    if (request.method() !== "DELETE") return
    const url = new URL(request.url())

    if (/^\/api\/session\/[^/]+$/.test(url.pathname)) deletes.push(url.pathname)
  })

  const workspace = await openSession(page, {
    name: "SC07 two persistent roots",
    directory,
    sessions: [
      { id: sourceID, title: "Streaming source", agent: "plan", model },
      { id: otherID, title: "Another source", model },
    ],
    provider: provider({ id: model.id, name: "SC07 model" }),
    pageMessages: pageMessagesFrom(messages),
    sessionStatus: () => status,
    onFileWrite: (write) => void writes.push(write),
    onPrompt: (request) => void prompts.push(request),
    onInterrupt: (sessionID) => {
      stops.push(sessionID)
      status[sessionID] = { type: "idle" }

      return { interrupted: true }
    },
    generate: (request) => {
      generations.push(request)

      return { text: "Unexpected one-shot generation" }
    },
    onConsultation: (request) => {
      creates.push(request)

      const result = consultation(
        request,
        directory,
        workspace.projectID,
        creates.length === 1 ? "First saved side answer." : "Second saved side answer.",
      )

      saved.set(request.body.id, result)
      messages[request.body.id] = result.messages
      workspace.sessions.push(session({ ...result.data.session, directory }))

      return { status: 200, body: { data: result.data } }
    },
    onConsultationRead: (sessionID) => {
      const result = saved.get(sessionID)

      if (!result)
        return {
          status: 404,
          body: Schema.encodeSync(MockNotFound)(new MockNotFound({ message: "Saved consultation not found" })),
        }

      return { status: 200, body: { data: { reference: result.data.reference, admission: result.data.admission } } }
    },
  })

  await transport.waitForConnection()
  const main = page.locator('[data-slot="session-chat-panel"]')
  const panel = page.locator('[data-slot="session-btw-panel"]')
  const sourceEditor = main.locator('[data-component="composer-editor"]')
  await sourceEditor.fill(`/btw ${firstQuestion}`)
  await sourceEditor.press("Enter")
  await expect(panel.getByText("First saved side answer.", { exact: true })).toBeVisible()
  await expect(panel.locator('[data-component="composer-editor"]')).toBeEditable()
  const firstID = creates[0]?.body.id

  if (!firstID) throw new Error("The first side question must reserve a Session ID")
  await sourceEditor.fill(`/btw ${secondQuestion}`)
  await sourceEditor.press("Enter")
  await expect(panel.getByText("Second saved side answer.", { exact: true })).toBeVisible()
  const secondID = creates[1]?.body.id

  if (!secondID) throw new Error("The second side question must reserve a Session ID")
  expect(firstID).not.toBe(secondID)
  expect(creates.every((request) => request.sourceSessionID === sourceID)).toBe(true)
  expect(creates.map((request) => request.body.agent)).toEqual(["plan", "plan"])
  expect(creates.map((request) => request.body.boundary)).toEqual([
    { type: "through", messageID: `msg_${sourceID}_answer` },
    { type: "through", messageID: `msg_${sourceID}_answer` },
  ])

  const firstTab = page
    .locator("#review-panel")
    .getByRole("tab")
    .filter({ has: page.getByText(firstQuestion, { exact: true }) })

  const secondTab = page.locator("#review-panel").getByRole("tab", { name: secondQuestion, exact: true })
  await firstTab.click()
  const targetEditor = panel.locator('[data-component="composer-editor"]')
  await expect(targetEditor).toBeEditable()
  await targetEditor.fill("Follow up on the first side question")

  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(["First side attachment"], "first-side.txt", { type: "text/plain" }))

    return value
  })

  await panel.locator("[data-session-content]").dispatchEvent("drop", { dataTransfer: transfer })
  await expect(panel.locator('[data-component="composer-attachments"]')).toContainText("first-side.txt")
  await expect.poll(() => writes.length).toBe(1)
  await targetEditor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]).toMatchObject({
    sessionID: firstID,
    body: { metadata: { displayText: "Follow up on the first side question" } },
  })
  expect(prompts[0]?.body.text).toContain(writes[0]?.path)
  await secondTab.click()
  await expect(panel.locator('[data-component="composer-attachments"]')).toHaveCount(0)
  await panel.locator('[data-component="composer-editor"]').fill("Only the second side draft")
  await firstTab.click()
  await expect(targetEditor).toHaveText("")
  await secondTab.click()

  const assistantID = `msg_${firstID}_stream`
  status[firstID] = { type: "running" }
  await transport.send({
    id: "evt_sc07_first_running",
    created: T0 + 30,
    type: "session.execution.started",
    location: { directory },
    durable: { aggregateID: firstID, seq: 4, version: 1 },
    data: { sessionID: firstID },
  })
  await transport.send({
    id: "evt_sc07_first_step",
    created: T0 + 31,
    type: "session.step.started",
    location: { directory },
    durable: { aggregateID: firstID, seq: 5, version: 1 },
    data: { sessionID: firstID, assistantMessageID: assistantID, started: T0 + 31, agent: "plan", model },
  })
  await transport.send({
    id: "evt_sc07_first_text",
    created: T0 + 32,
    type: "session.text.started",
    location: { directory },
    durable: { aggregateID: firstID, seq: 6, version: 1 },
    data: { sessionID: firstID, assistantMessageID: assistantID, ordinal: 0 },
  })
  await transport.send({
    id: "evt_sc07_first_delta",
    created: T0 + 33,
    type: "session.text.delta",
    location: { directory },
    data: {
      sessionID: firstID,
      assistantMessageID: assistantID,
      ordinal: 0,
      delta: "First side streams independently.",
    },
  })
  await expect(firstTab.locator("..").getByRole("status", { name: "Unread messages", exact: true })).toBeVisible()
  await expect(panel.locator('[data-component="composer-editor"]')).toHaveText("Only the second side draft")
  await firstTab.click()
  await expect(panel.getByText("First side streams independently.", { exact: true })).toBeVisible()
  await expect(firstTab.locator("..").getByRole("status", { name: "Unread messages", exact: true })).toHaveCount(0)
  await panel.getByRole("button", { name: "Stop", exact: true }).click()
  await expect.poll(() => stops).toEqual([firstID])
  await transport.send({
    id: "evt_sc07_first_stopped",
    created: T0 + 34,
    type: "session.execution.interrupted",
    location: { directory },
    durable: { aggregateID: firstID, seq: 7, version: 1 },
    data: { sessionID: firstID, reason: "user" },
  })
  await expect(main.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  await secondTab.click()
  await expect(panel.locator('[data-component="composer-editor"]')).toHaveText("Only the second side draft")
  await firstTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(firstTab).toHaveCount(0)
  await page.reload()
  await expect(secondTab).toBeVisible()
  await expect(panel.locator('[data-component="composer-editor"]')).toHaveText("Only the second side draft")
  expect(creates).toHaveLength(2)
  expect(prompts).toHaveLength(1)
  expect(generations).toHaveLength(0)
  expect(deletes).toHaveLength(0)
  await openSidePanel(page, "Side chats")
  await page.locator("#review-panel").getByRole("button", { name: firstQuestion, exact: true }).click()
  await expect(panel.getByText("First saved side answer.", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(sessionHref(sourceID))
  expect(creates).toHaveLength(2)
  expect(prompts).toHaveLength(1)
  expect(stops).toEqual([firstID])
  expect(generations).toHaveLength(0)
  expect(deletes).toHaveLength(0)
  await expect(firstTab).toBeVisible()
  await expect(secondTab).toBeVisible()
  await expect(main.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(panel.locator('[data-component="composer-editor"]')).toBeEditable()
  await page.screenshot({ path: testInfo.outputPath("sc07-two-side-roots.png") })
})

test("SC07 recovers a reserved first question only on explicit retry and records a closed view's late creation ACK", async ({
  page,
}, testInfo) => {
  const sourceID = "ses_sc07_reserved_source"
  const directory = "/sc07/reserved"
  const failedQuestion = "Retry this reserved first question"
  const lateQuestion = "Keep this late side root"
  const creates: ConsultationRequest[] = []
  const prompts: { sessionID: string; body: Schema.JsonObject }[] = []
  const reads: string[] = []
  const generations: unknown[] = []
  const stops: string[] = []
  const messages: Record<string, SessionMessageInfo[]> = {}
  const saved = new Map<string, ReturnType<typeof consultation>>()
  const reserved = new Set<string>()
  const held = Promise.withResolvers<MockAnswer>()

  messages[sourceID] = sourceHistory(sourceID)

  const workspace = await openSession(page, {
    name: "SC07 reserved recovery",
    directory,
    sessions: [{ id: sourceID, title: "Reserved source", model }],
    provider: provider({ id: model.id, name: "SC07 model" }),
    pageMessages: pageMessagesFrom(messages),
    onPrompt: (request) => void prompts.push(request),
    generate: (request) => {
      generations.push(request)

      return { text: "Unexpected reserved generation" }
    },
    onInterrupt: (sessionID) => {
      stops.push(sessionID)

      return { interrupted: false }
    },
    onConsultation: (request, attempt) => {
      creates.push(request)
      const existing = saved.get(request.body.id)

      const result =
        existing ??
        consultation(
          request,
          directory,
          workspace.projectID,
          attempt === 3
            ? "A late acknowledgement retained this Chat root."
            : "The reserved first question was explicitly retried.",
        )

      if (!existing) {
        saved.set(request.body.id, result)
        workspace.sessions.push(session({ ...result.data.session, directory }))
      }

      if (attempt === 1) {
        reserved.add(request.body.id)
        messages[request.body.id] = []

        return {
          status: 400,
          body: Schema.encodeSync(InvalidRequestError)(
            new InvalidRequestError({
              field: "prompt",
              kind: "invalid_request",
              message: "SC07 first-question preparation failed after the Chat root was reserved.",
            }),
          ),
        }
      }

      reserved.delete(request.body.id)
      messages[request.body.id] = result.messages

      if (attempt === 3) return held.promise

      return { status: 200, body: { data: result.data } }
    },
    onConsultationRead: (sessionID) => {
      reads.push(sessionID)
      const result = saved.get(sessionID)

      if (!result)
        return {
          status: 404,
          body: Schema.encodeSync(MockNotFound)(new MockNotFound({ message: "Saved consultation not found" })),
        }

      return {
        status: 200,
        body: {
          data: {
            reference: result.data.reference,
            admission: reserved.has(sessionID)
              ? { state: "reserved", id: result.data.admission.input.id }
              : result.data.admission,
          },
        },
      }
    },
  })

  const main = page.locator('[data-slot="session-chat-panel"]')
  const panel = page.locator('[data-slot="session-btw-panel"]')
  const firstQuestion = panel.getByRole("textbox", { name: "Side question", exact: true })
  await main.getByText(sourceAnswer, { exact: true }).hover()
  await main.getByRole("button", { name: "Side chat", exact: true }).click()
  await expect(firstQuestion).toHaveValue("")
  await firstQuestion.fill("中文输入法中的首问 العربية")
  await firstQuestion.dispatchEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true, isComposing: true })
  await expect(firstQuestion).toBeEditable()
  await expect(firstQuestion).toHaveValue("中文输入法中的首问 العربية")
  expect(creates).toHaveLength(0)
  await firstQuestion.fill(failedQuestion)
  expect(creates).toHaveLength(0)
  await panel.getByRole("button", { name: "Start side chat", exact: true }).click()
  const retry = panel.getByRole("button", { name: "Retry first question", exact: true })
  await expect(retry).toBeEnabled()
  expect(creates).toHaveLength(1)
  const firstID = creates[0]?.body.id

  if (!firstID) throw new Error("The failed first question must retain its reserved Session ID")
  await panel.getByRole("button", { name: "View reference", exact: true }).click()
  const frozenReference = "Saved server reference for " + sourceID + " through msg_" + sourceID + "_answer."
  await expect(panel.getByText(frozenReference, { exact: true })).toBeVisible()
  expect(reads).toContain(firstID)
  expect(prompts).toHaveLength(0)
  expect(generations).toHaveLength(0)
  await page.reload()
  await expect(retry).toBeEnabled()
  expect(creates).toHaveLength(1)
  expect(prompts).toHaveLength(0)
  expect(generations).toHaveLength(0)
  await retry.click()
  await expect(panel.getByText("The reserved first question was explicitly retried.", { exact: true })).toBeVisible()
  expect(creates).toHaveLength(2)
  expect(creates[1]).toEqual(creates[0])
  const firstTab = page.locator("#review-panel").getByRole("tab", { name: failedQuestion, exact: true })
  await firstTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(firstTab).toHaveCount(0)
  await expect(panel).toHaveCount(0)

  const lateAck = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/session/" + sourceID + "/consultation",
  )

  const sourceEditor = main.locator('[data-component="composer-editor"]')
  await sourceEditor.fill("/btw " + lateQuestion)
  await sourceEditor.press("Enter")
  await expect.poll(() => creates.length).toBe(3)
  const lateID = creates[2]?.body.id

  if (!lateID) throw new Error("The delayed first question must retain its reserved Session ID")
  const lateTab = page.locator("#review-panel").getByRole("tab", { name: lateQuestion, exact: true })
  await expect(lateTab).toBeVisible()
  await lateTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(lateTab).toHaveCount(0)
  const late = saved.get(lateID)

  if (!late) throw new Error("The controlled server must retain the late Chat root")
  held.resolve({ status: 200, body: { data: late.data } })
  await lateAck
  await expect(lateTab).toHaveCount(0)
  await expect(panel).toHaveCount(0)
  await expectSessionTitle(page, "Reserved source")
  await page.reload()
  await expectSessionTitle(page, "Reserved source")
  await expect(panel).toHaveCount(0)
  expect(creates).toHaveLength(3)
  expect(prompts).toHaveLength(0)
  expect(generations).toHaveLength(0)
  expect(stops).toHaveLength(0)
  await openSidePanel(page, "Side chats")
  await page.locator("#review-panel").getByRole("button", { name: lateQuestion, exact: true }).click()
  await expect(panel.getByText("A late acknowledgement retained this Chat root.", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(sessionHref(sourceID))
  expect(creates).toHaveLength(3)
  expect(prompts).toHaveLength(0)
  expect(generations).toHaveLength(0)
  expect(stops).toHaveLength(0)
  await page.screenshot({ path: testInfo.outputPath("sc07-reserved-and-late-ack.png") })
})

test("SC07 cancels the pending first question, reopens its saved reference and continues with a new message ID", async ({
  page,
}, testInfo) => {
  const sourceID = "ses_sc07_cancel_source"
  const directory = "/sc07/cancel"
  const firstQuestion = "Cancel this pending first question"
  const nextQuestion = "Use the saved reference for a new question"
  const creates: ConsultationRequest[] = []
  const prompts: { sessionID: string; body: Schema.JsonObject }[] = []
  const changes: { sessionID: string; inboxID: string; action: "cancel" | "steer" | "queue" }[] = []
  const reads: string[] = []
  const generations: unknown[] = []
  const inbox: Schema.Codec.Encoded<typeof SessionInbox.User>[] = []
  const messages: Record<string, SessionMessageInfo[]> = {}
  const saved = new Map<string, ReturnType<typeof consultation>>()
  const cancelled = new Set<string>()
  const transport = await installSseTransport(page, { server: SERVER })

  messages[sourceID] = sourceHistory(sourceID)

  const workspace = await openSession(page, {
    name: "SC07 cancelled first question",
    directory,
    sessions: [{ id: sourceID, title: "Cancellation source", model }],
    provider: provider({ id: model.id, name: "SC07 model" }),
    pageMessages: pageMessagesFrom(messages),
    inbox: () => inbox,
    onPrompt: (request) => {
      prompts.push(request)
      const result = saved.get(request.sessionID)

      if (!result) throw new Error("A new side question must target the retained consultation root")
      const prompt = Schema.decodeUnknownSync(SessionConsultation.Prompt)(request.body)
      inbox.push({
        id: prompt.id,
        sessionID: request.sessionID,
        time: { created: T0 + 40 },
        type: "user",
        payload: { text: prompt.text, files: [result.data.reference.file] },
        delivery: prompt.delivery ?? "steer",
      })
    },
    generate: (request) => {
      generations.push(request)

      return { text: "Unexpected cancelled-question generation" }
    },
    onInboxChange: (change) => {
      changes.push(change)

      if (change.action !== "cancel") return
      const input = inbox.find((item) => item.sessionID === change.sessionID && item.id === change.inboxID)

      if (!input) return
      cancelled.add(input.id)
      inbox.splice(inbox.indexOf(input), 1)
    },
    onConsultation: (request) => {
      creates.push(request)
      const result = consultation(request, directory, workspace.projectID, "This pending first question has not run.")
      saved.set(request.body.id, result)
      workspace.sessions.push(session({ ...result.data.session, directory }))
      messages[request.body.id] = []

      const input = {
        id: request.body.prompt.id,
        sessionID: request.body.id,
        time: { created: T0 + 10 },
        type: "user",
        payload: {
          text: request.body.prompt.text,
          files: [result.data.reference.file],
        },
        delivery: "steer",
      } satisfies Schema.Codec.Encoded<typeof SessionInbox.User>

      inbox.push(input)

      return {
        status: 200,
        body: {
          data: {
            session: result.data.session,
            reference: result.data.reference,
            admission: { state: "pending", input },
          },
        },
      }
    },
    onConsultationRead: (sessionID) => {
      reads.push(sessionID)
      const result = saved.get(sessionID)

      if (!result)
        return {
          status: 404,
          body: Schema.encodeSync(MockNotFound)(new MockNotFound({ message: "Saved consultation not found" })),
        }

      if (cancelled.has(result.data.admission.input.id)) {
        return {
          status: 200,
          body: {
            data: {
              reference: result.data.reference,
              admission: { state: "cancelled", id: result.data.admission.input.id },
            },
          },
        }
      }

      const input = inbox.find((item) => item.sessionID === sessionID && item.id === result.data.admission.input.id)

      if (!input) throw new Error("The controlled pending first question must have an inbox carrier")

      return {
        status: 200,
        body: { data: { reference: result.data.reference, admission: { state: "pending", input } } },
      }
    },
  })

  await transport.waitForConnection()
  const main = page.locator('[data-slot="session-chat-panel"]')
  const panel = page.locator('[data-slot="session-btw-panel"]')
  const sourceEditor = main.locator('[data-component="composer-editor"]')
  await sourceEditor.fill("/btw " + firstQuestion)
  await sourceEditor.press("Enter")
  await expect.poll(() => creates.length).toBe(1)
  const targetID = creates[0]?.body.id
  const firstID = creates[0]?.body.prompt.id

  if (!targetID || !firstID) throw new Error("The pending first question must have stable Session and message IDs")

  const row = panel.locator(`[data-timeline-row="UserMessage"][data-message-id="${firstID}"]`)
  await expect(row.getByText(firstQuestion, { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Resume first question", exact: true })).toBeEnabled()

  const cancellation = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      new URL(response.url()).pathname === "/api/session/" + targetID + "/inbox/" + firstID,
  )

  await row.hover()
  await row.getByRole("button", { name: "Delete", exact: true }).click()
  await cancellation
  expect(changes).toEqual([{ sessionID: targetID, inboxID: firstID, action: "cancel" }])
  await transport.send({
    id: "evt_sc07_first_cancelled",
    created: T0 + 20,
    type: "session.inbox.cancelled",
    location: { directory },
    durable: { aggregateID: targetID, seq: 4, version: 1 },
    data: { sessionID: targetID, inboxID: firstID },
  })
  await expect(row).toHaveCount(0)
  const tab = page.locator("#review-panel").getByRole("tab", { name: firstQuestion, exact: true })
  await tab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(tab).toHaveCount(0)
  await page.reload()
  await expectSessionTitle(page, "Cancellation source")
  await expect(panel).toHaveCount(0)
  expect(creates).toHaveLength(1)
  expect(prompts).toHaveLength(0)
  expect(generations).toHaveLength(0)
  await openSidePanel(page, "Side chats")
  await page.locator("#review-panel").getByRole("button", { name: firstQuestion, exact: true }).click()
  await expect(panel.getByText("First question cancelled", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Retry first question", exact: true })).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Resume first question", exact: true })).toHaveCount(0)
  await panel.getByRole("button", { name: "View reference", exact: true }).click()
  const frozenReference = "Saved server reference for " + sourceID + " through msg_" + sourceID + "_answer."
  await expect(panel.getByText(frozenReference, { exact: true })).toBeVisible()
  expect(reads).toContain(targetID)
  await panel.getByRole("button", { name: "Close reference", exact: true }).click()
  const targetEditor = panel.locator('[data-component="composer-editor"]')
  await expect(targetEditor).toBeEditable()
  await targetEditor.fill(nextQuestion)
  await targetEditor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.sessionID).toBe(targetID)
  expect(prompts[0]?.body.files ?? []).toEqual([])
  expect(prompts[0]?.body.id).not.toBe(firstID)
  expect(prompts[0]?.body).toMatchObject({ text: nextQuestion, metadata: { displayText: nextQuestion } })
  const nextID = Schema.decodeUnknownSync(SessionConsultation.Prompt)(prompts[0]?.body).id

  const continued = panel.locator(`[data-timeline-row="UserMessage"][data-message-id="${nextID}"]`)
  await expect(continued.getByText(nextQuestion, { exact: true })).toBeVisible()
  await page.reload()
  await expect(panel.getByText("First question cancelled", { exact: true })).toBeVisible()
  await expect(
    continued
      .locator('[data-slot="user-message-attachments"]')
      .getByText("saved-source-reference.txt", { exact: true }),
  ).toHaveCount(1)
  await expect(row).toHaveCount(0)
  await panel.getByRole("button", { name: "View reference", exact: true }).click()
  await expect(panel.getByText(frozenReference, { exact: true })).toBeVisible()
  await expect(page).toHaveURL(sessionHref(sourceID))
  expect(creates).toHaveLength(1)
  expect(prompts).toHaveLength(1)
  expect(generations).toHaveLength(0)
  expect(changes).toEqual([{ sessionID: targetID, inboxID: firstID, action: "cancel" }])
  await page.screenshot({ path: testInfo.outputPath("sc07-cancelled-reference-new-question.png") })
})
