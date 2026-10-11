/** Default Assistant: UI draft/first send -> confirmed conversation -> canonical tool -> daemon -> inbox/read/reload. */
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { expect, test, type APIResponse, type Response } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { Environment } from "./environment"
import { e4, seedRealBackend } from "./fixture"
import { isRecord, type E4Manifest } from "./manifest"
import { pinEnglishUI } from "../utils/locale"
import { sessionTitle } from "../../src/utils/session-title"

test("Assistant reminder: new chat first send, daemon delivery and inbox read persist across reload", async ({
  page,
  request,
}, testInfo) => {
  const runtime = e4()
  expect(runtime.v2Runtime).toBe(false)
  const headers = { "x-aigcfroge-directory": runtime.workspaceDir }
  const query = `?directory=${encodeURIComponent(runtime.workspaceDir)}`
  const health = await request.get(`${runtime.backendUrl}/global/health`)
  expect(health.ok()).toBeTruthy()
  expect(await health.json()).toMatchObject({ healthy: true, version: runtime.backendVersion })

  await pinEnglishUI(page)
  seedRealBackend(page, runtime.backendUrl)
  await page.setViewportSize({ width: 1400, height: 900 })
  const creations: unknown[] = []
  page.on("request", (incoming) => {
    const url = new URL(incoming.url())
    if (incoming.method() === "POST" && url.origin === runtime.backendUrl && url.pathname === "/session") {
      creations.push(incoming.postDataJSON())
    }
  })
  await page.goto("/mode/assistant")
  await expect(page.getByRole("heading", { name: "Assistant Dashboard", exact: true })).toBeVisible()
  const location = page.locator('[data-mode-location="assistant"]')
  await location.getByRole("button", { name: "Add project", exact: true }).click()
  const directoryPicker = page.getByRole("dialog")
  await directoryPicker.getByPlaceholder("Search folders").fill(runtime.workspaceDir)
  await directoryPicker
    .locator('[data-slot="list-item"]')
    .filter({ has: page.getByText(path.basename(runtime.workspaceDir), { exact: true }) })
    .click()
  await expect(directoryPicker).toBeHidden()
  await expect(location.getByRole("button", { name: "New session", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "New assistant chat", exact: true }).click()
  await expect(page).toHaveURL(/\/new-session\?draftId=[^&#]+$/)
  await expect(page.locator('[data-component="session-new-composer"]')).toBeVisible()
  const composer = page.locator('[data-component="session-prompt-dock"] [data-component="prompt-input"]')
  await expect(composer).toBeVisible()
  await expect(page.locator('[data-action="prompt-agent"]')).toContainText("assistant-orchestrator")
  await expect(page.locator('[data-action="prompt-model"]')).toContainText("E4 Deterministic")
  expect(creations, "opening an Assistant draft must not create a durable Session").toEqual([])
  await testInfo.attach("assistant-entry-navigation", {
    body: JSON.stringify(
      await page.evaluate(() => performance.getEntriesByType("navigation").map((entry) => entry.toJSON())),
    ),
    contentType: "application/json",
  })
  const content = `E4 Assistant reminder ${path.basename(runtime.runDir)}`
  const dueAt = Date.now() + 45_000
  const providerURL = `http://127.0.0.1:${runtime.providerPort}`
  const configure = await request.post(
    `${providerURL}/e4/provider-failures?mode=reminder-confirm&count=1&content=${encodeURIComponent(content)}&dueAt=${dueAt}`,
  )
  expect(configure.ok()).toBeTruthy()
  await composer.fill(
    `Remind me: ${content}, at ${new Date(dueAt).toISOString()}, timezone UTC. Please show the details for confirmation first.`,
  )
  const [created, firstAdmission] = await Promise.all([
    page.waitForResponse(
      (incoming) =>
        incoming.request().method() === "POST" &&
        new URL(incoming.url()).origin === runtime.backendUrl &&
        new URL(incoming.url()).pathname === "/session",
    ),
    page.waitForResponse(
      (incoming) =>
        incoming.request().method() === "POST" &&
        new URL(incoming.url()).origin === runtime.backendUrl &&
        /^\/session\/[^/]+\/prompt_async$/.test(new URL(incoming.url()).pathname),
    ),
    composer.press("Enter"),
  ])
  expect(created.ok(), "Assistant draft first send creates a Session").toBeTruthy()
  expect(creations).toEqual([{ mode: "assistant", agent: "assistant-orchestrator" }])
  const session: unknown = await created.json()
  if (!isRecord(session) || typeof session.id !== "string") throw new Error("Assistant session has no id")
  expect(session).toMatchObject({
    directory: runtime.workspaceDir,
    mode: "assistant",
    agent: "assistant-orchestrator",
  })
  const sessionID = session.id
  expect(firstAdmission.status()).toBe(204)
  expect(new URL(firstAdmission.url()).pathname).toBe(`/session/${sessionID}/prompt_async`)
  const firstPrompt: unknown = firstAdmission.request().postDataJSON()
  if (!isRecord(firstPrompt) || typeof firstPrompt.messageID !== "string") throw new Error("First prompt has no id")
  expect(firstPrompt).toMatchObject({
    agent: "assistant-orchestrator",
    model: { providerID: "e4-real", modelID: "e4-deterministic" },
  })
  await expect(page).toHaveURL(`/server/${base64Encode(runtime.backendUrl)}/session/${sessionID}`)
  const persistedResponse = await request.get(`${runtime.backendUrl}/session/${sessionID}${query}`, { headers })
  expect(persistedResponse.ok()).toBeTruthy()
  const persisted: unknown = await persistedResponse.json()
  expect(persisted).toMatchObject({
    id: sessionID,
    directory: runtime.workspaceDir,
    mode: "assistant",
    agent: "assistant-orchestrator",
    model: { id: "e4-deterministic", providerID: "e4-real" },
  })
  await testInfo.attach("assistant-first-send", {
    body: JSON.stringify({
      creation: creations[0],
      session: persisted,
      prompt: firstPrompt,
    }),
    contentType: "application/json",
  })
  const inboxPath = `/delivery/${sessionID}`
  const inboxURL = `${runtime.backendUrl}${inboxPath}${query}`
  const scheduleURL = `${runtime.backendUrl}/schedule/${sessionID}${query}`
  expect(await records(await request.get(inboxURL, { headers }))).toEqual([])
  expect(await records(await request.get(scheduleURL, { headers }))).toEqual([])

  const providerCalls = async () =>
    (await records(await request.get(`${providerURL}/e4/provider-requests`), "requests")).filter(
      (row) => typeof row.path === "string" && row.path.endsWith("/chat/completions"),
    )
  await expect.poll(async () => (await providerCalls()).length).toBe(1)
  const first = (await providerCalls())[0]
  await testInfo.attach("assistant-provider-before-confirmation", {
    body: JSON.stringify(first),
    contentType: "application/json",
  })
  expect(first).toMatchObject({ model: "e4-deterministic", authenticated: true })
  expect(first?.toolNames).toContain("reminder_create")
  for (const name of ["bash", "edit", "task"]) expect(first?.toolNames).not.toContain(name)
  await expect(
    page
      .getByText(
        `Please confirm: ${content}; ${new Date(dueAt).toISOString()}; timezone UTC. If offline, delivery will catch up when the app is next online.`,
        { exact: true },
      )
      .first(),
  ).toBeVisible()
  expect(await records(await request.get(scheduleURL, { headers }))).toEqual([])
  expect(await records(await request.get(inboxURL, { headers }))).toEqual([])
  expect((await request.post(`${providerURL}/e4/provider-failures?mode=reminder-create&count=1`)).ok()).toBeTruthy()
  await composer.fill("I confirm those exact reminder details. Create it now.")
  const [confirmation] = await Promise.all([
    page.waitForResponse(
      (incoming) =>
        incoming.request().method() === "POST" &&
        new URL(incoming.url()).origin === runtime.backendUrl &&
        new URL(incoming.url()).pathname === `/session/${sessionID}/prompt_async`,
    ),
    composer.press("Enter"),
  ])
  expect(confirmation.status()).toBe(204)
  const confirmationPrompt: unknown = confirmation.request().postDataJSON()
  if (!isRecord(confirmationPrompt) || typeof confirmationPrompt.messageID !== "string")
    throw new Error("Confirmation prompt has no id")
  expect(confirmationPrompt).toMatchObject({
    agent: "assistant-orchestrator",
    model: { providerID: "e4-real", modelID: "e4-deterministic" },
  })
  expect(creations).toHaveLength(1)
  await expect.poll(async () => (await records(await request.get(scheduleURL, { headers }))).length).toBe(1)
  const reminder = (await records(await request.get(scheduleURL, { headers })))[0]
  if (
    !reminder ||
    typeof reminder.id !== "string" ||
    typeof reminder.deliveryKey !== "string" ||
    typeof reminder.dueAt !== "number" ||
    typeof reminder.createdAt !== "number"
  )
    throw new Error("Reminder tool did not persist a valid schedule")
  expect(reminder).toMatchObject({ sessionID, kind: "reminder", content, dueAt, timezone: "UTC" })
  expect(reminder.dueAt).toBeGreaterThan(reminder.createdAt)
  await expect
    .poll(async () =>
      (await providerCalls()).some(
        (row) => Array.isArray(row.toolResultIDs) && row.toolResultIDs.includes("call_e4_read_workspace"),
      ),
    )
    .toBe(true)
  const admissions = await records(await request.get(`${providerURL}/e4/admission?sessionID=${sessionID}`), "rows")
  expect(admissions).toHaveLength(2)
  expect(admissions.map((row) => row.id)).toEqual([firstPrompt.messageID, confirmationPrompt.messageID])
  expect(
    admissions.every((row) => typeof row.promoted_seq === "number" && row.promoted_seq >= Number(row.admitted_seq)),
  ).toBe(true)
  await expect(page.getByText("E4 deterministic response", { exact: true }).first()).toBeVisible()
  await testInfo.attach("assistant-admissions", { body: JSON.stringify(admissions), contentType: "application/json" })
  await testInfo.attach("assistant-provider-calls", {
    body: JSON.stringify(await providerCalls()),
    contentType: "application/json",
  })
  const messages = await request.get(`${runtime.backendUrl}/api/session/${sessionID}/message${query}`, { headers })
  expect(messages.ok()).toBeTruthy()
  const projected: unknown = await messages.json()
  if (!isRecord(projected) || !Array.isArray(projected.data)) throw new Error("Invalid canonical message page")
  expect(
    projected.data
      .flatMap((message: unknown) => (isRecord(message) && Array.isArray(message.content) ? message.content : []))
      .some(
        (part: unknown) =>
          isRecord(part) &&
          part.name === "reminder_create" &&
          isRecord(part.state) &&
          part.state.status === "completed",
      ),
  ).toBe(true)

  // SchedulerCore.daemon scans/ticks once per minute. Cross-process service
  // events need not wake its EventV2 instance, so wait for its own DB rescan.
  // The existing 120s E4 test budget is unchanged; no sleep, clock shim, restart,
  // direct delivery insert or test-owned daemon can satisfy this assertion.
  await expect
    .poll(
      async () => {
        const [schedules, inbox] = await Promise.all([
          request.get(scheduleURL, { headers }).then(records),
          request.get(inboxURL, { headers }).then(records),
        ])
        return {
          status: schedules.find((item) => item.id === reminder.id)?.status,
          deliveryKeys: inbox.map((item) => item.deliveryKey),
        }
      },
      {
        message: "real daemon completes the reminder and delivers it exactly once",
        timeout: 70_000,
        intervals: [250, 500, 1_000],
      },
    )
    .toEqual({ status: "completed", deliveryKeys: [reminder.deliveryKey] })

  const inbox = await records(await request.get(inboxURL, { headers }))
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toMatchObject({
    deliveryKey: reminder.deliveryKey,
    scheduleID: reminder.id,
    sessionID,
    kind: "reminder",
    content,
    caughtUp: false,
  })
  if (typeof inbox[0]?.deliveredAt !== "number") throw new Error("Inbox delivery has no deliveredAt")
  expect(inbox[0].deliveredAt).toBeGreaterThanOrEqual(reminder.dueAt)
  expect(await scheduleService(runtime, { operation: "unread", sessionID })).toBe(1)

  const fromInbox = (incoming: Response) =>
    incoming.request().method() === "GET" &&
    new URL(incoming.url()).origin === runtime.backendUrl &&
    new URL(incoming.url()).pathname === inboxPath
  const [opened] = await Promise.all([page.waitForResponse(fromInbox), page.reload()])
  expect(await records(opened)).toEqual(inbox)
  const reloadedResponse = await request.get(`${runtime.backendUrl}/session/${sessionID}${query}`, { headers })
  expect(reloadedResponse.ok()).toBeTruthy()
  const reloaded: unknown = await reloadedResponse.json()
  if (!isRecord(reloaded) || typeof reloaded.title !== "string") throw new Error("Assistant session has no title")
  expect(reloaded).toMatchObject({
    id: sessionID,
    mode: "assistant",
    agent: "assistant-orchestrator",
    model: { id: "e4-deterministic", providerID: "e4-real" },
  })
  expect(reloaded.title).toBe(session.title)
  await expect(
    page.getByRole("heading", { name: sessionTitle(reloaded.title) ?? "New session", exact: true }),
  ).toBeVisible()

  const panel = page.locator('#review-panel[aria-label="Assistant panel"]')
  const history = panel.locator("section").filter({
    has: page.getByRole("heading", { name: "Delivery history", exact: true }),
  })
  const delivery = history.getByText(content, { exact: true })
  const markRead = history.getByRole("button", { name: "Mark as read", exact: true })
  await expect(panel).toBeVisible()
  await expect(delivery).toBeVisible()
  await expect(delivery).toHaveCount(1)
  await expect(markRead).toHaveCount(1)

  // Reload before reading: a fresh HTTP inbox and a fresh service connection
  // must both retain the delivery, and merely opening the panel must not read it.
  const [unreadReload] = await Promise.all([page.waitForResponse(fromInbox), page.reload()])
  expect(await records(unreadReload)).toEqual(inbox)
  await expect(delivery).toBeVisible()
  expect(await scheduleService(runtime, { operation: "unread", sessionID })).toBe(1)

  // Compute the read path outside the predicate: TypeScript does not carry a
  // property narrowing of `reminder` into a nested callback, so deriving the
  // string here keeps the check meaningful without a cast.
  const readPath = `/delivery/${encodeURIComponent(reminder.deliveryKey)}/read`
  const [read, refetched] = await Promise.all([
    page.waitForResponse(
      (incoming) =>
        incoming.request().method() === "POST" &&
        new URL(incoming.url()).origin === runtime.backendUrl &&
        new URL(incoming.url()).pathname === readPath,
    ),
    page.waitForResponse(fromInbox),
    markRead.click(),
  ])
  // Assert on status only: the message argument is evaluated before expect(),
  // so reading the body here would fail even when the response is OK. The
  // mark-read route answers 200 with an empty body.
  expect(read.ok(), "mark delivery read").toBeTruthy()
  expect(await records(refetched)).toEqual(inbox)
  expect(await scheduleService(runtime, { operation: "unread", sessionID })).toBe(0)

  // Read state is deliberately observed through its owner, not an invented
  // `isRead` response field or a CSS change the production UI does not provide.
  const [readReload] = await Promise.all([page.waitForResponse(fromInbox), page.reload()])
  expect(await records(readReload)).toEqual(inbox)
  await expect(delivery).toBeVisible()
  await expect(delivery).toHaveCount(1)
  expect(await scheduleService(runtime, { operation: "unread", sessionID })).toBe(0)
  expect(await records(await request.get(inboxURL, { headers }))).toEqual(inbox)
  expect(await records(await request.get(scheduleURL, { headers }))).toMatchObject([
    { id: reminder.id, status: "completed", deliveryKey: reminder.deliveryKey },
  ])
})

async function records(response: APIResponse | Response, field?: string) {
  expect(response.ok(), `${response.url()}: ${await response.text()}`).toBeTruthy()
  const parsed: unknown = await response.json()
  const body = field && isRecord(parsed) ? parsed[field] : parsed
  if (!Array.isArray(body)) throw new Error(`${response.url()}: expected a JSON array`)
  const rows: unknown[] = body
  if (!rows.every(isRecord)) throw new Error(`${response.url()}: expected object records`)
  return rows
}

/**
 * Bun is required by the backend's real service dependencies. Keep their import
 * (including Global's filesystem initialization) out of the Playwright process.
 * Use the same environment allowlist as E4 and an explicit manifest DB path;
 * this child is only a service client, never an additional backend or daemon.
 */
async function scheduleService(
  runtime: E4Manifest,
  input: { operation: "unread"; sessionID: string },
): Promise<unknown> {
  expect(runtime.dbPath, "read probe must use only the isolated E4 database").toBe(
    path.join(runtime.runDir, "e4.sqlite"),
  )
  const result = await promisify(execFile)(
    "bun",
    [
      "--no-env-file",
      "--eval",
      `const { Effect } = await import("effect")
       const { ScheduleService } = await import("@aigcfroge/core/session/schedule-service")
       const { SessionSchema } = await import("@aigcfroge/core/session/schema")
       const sessionID = SessionSchema.ID.make(process.env.E4_ASSISTANT_SESSION_ID)
       const result = await Effect.runPromise(
             Effect.gen(function* () {
               const deliveries = yield* ScheduleService.DeliveryService
               return yield* deliveries.countUnread(sessionID)
             }).pipe(Effect.provide(ScheduleService.deliveryDefaultLayer)),
           )
       console.log("E4_ASSISTANT_RESULT:" + JSON.stringify(result))`,
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      env: {
        ...Environment.create(runtime.runDir, process.env),
        AIGCFROGE_DB: runtime.dbPath,
        E4_ASSISTANT_OPERATION: input.operation,
        E4_ASSISTANT_SESSION_ID: input.sessionID,
      },
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    },
  )
  const output = result.stdout.split("\n").find((line) => line.startsWith("E4_ASSISTANT_RESULT:"))
  if (!output)
    throw new Error(`ScheduleService ${input.operation} produced no result: ${result.stdout} ${result.stderr}`)
  return JSON.parse(output.slice("E4_ASSISTANT_RESULT:".length))
}
