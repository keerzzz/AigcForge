/**
 * S9B E4: real ScheduleService seed -> backend daemon -> HTTP inbox -> Assistant
 * panel -> mark-read POST -> reload. No network interception or manual tick.
 *
 * Coverage boundary: ScheduleApi has list/pending/cancel, but no create endpoint;
 * the UI also has no reminder form. Seed through the existing service API in a
 * separate, isolated Bun process, NOT a fabricated POST /schedule or raw SQL.
 * This does not exercise natural-language confirmation or reminder_create (which
 * rejects past dueAt values). The seed is a short-future, one-shot reminder.
 *
 * Schedule.Delivery omits isRead and DeliveryList has no read/unread decoration.
 * Verify the real UI POST/refetch and persistent state via the existing
 * DeliveryService.countUnread, reopening its database connection for each read.
 * Do not claim a visual read-state transition or a live inbox push before reload.
 */
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

test("Assistant reminder: daemon delivery and inbox read persist across reload", async ({ page, request }) => {
  const runtime = e4()
  const headers = { "x-aigcfroge-directory": runtime.workspaceDir }
  const query = `?directory=${encodeURIComponent(runtime.workspaceDir)}`
  const health = await request.get(`${runtime.backendUrl}/global/health`)
  expect(health.ok()).toBeTruthy()
  expect(await health.json()).toMatchObject({ healthy: true, version: runtime.backendVersion })

  const response = await request.post(`${runtime.backendUrl}/session${query}`, {
    headers,
    data: {
      title: "E4 Assistant scheduler",
      mode: "assistant",
      model: { id: "gpt-test", providerID: "aigcfroge" },
    },
  })
  expect(response.ok(), `Assistant session create: ${await response.text()}`).toBeTruthy()
  const session: unknown = await response.json()
  if (!isRecord(session) || typeof session.id !== "string") throw new Error("Assistant session has no id")
  expect(session.mode).toBe("assistant")

  const sessionID = session.id
  const inboxPath = `/delivery/${sessionID}`
  const inboxURL = `${runtime.backendUrl}${inboxPath}${query}`
  const scheduleURL = `${runtime.backendUrl}/schedule/${sessionID}${query}`
  expect(await records(await request.get(inboxURL, { headers }))).toEqual([])
  expect(await records(await request.get(scheduleURL, { headers }))).toEqual([])

  const content = `E4 Assistant reminder ${sessionID}`
  const reminder = await scheduleService(runtime, { operation: "create", sessionID, content })
  if (!isRecord(reminder)) throw new Error("ScheduleService.create returned an invalid reminder")
  if (
    typeof reminder.id !== "string" ||
    typeof reminder.deliveryKey !== "string" ||
    typeof reminder.dueAt !== "number" ||
    typeof reminder.createdAt !== "number"
  )
    throw new Error("ScheduleService.create returned an invalid reminder")
  expect(reminder).toMatchObject({ sessionID, kind: "reminder", content, timezone: "UTC", status: "pending" })
  expect(reminder.dueAt).toBeGreaterThan(reminder.createdAt)

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

  await pinEnglishUI(page)
  seedRealBackend(page, runtime.backendUrl)
  await page.setViewportSize({ width: 1400, height: 900 })
  const fromInbox = (incoming: Response) =>
    incoming.request().method() === "GET" &&
    new URL(incoming.url()).origin === runtime.backendUrl &&
    new URL(incoming.url()).pathname === inboxPath
  const [opened] = await Promise.all([
    page.waitForResponse(fromInbox),
    page.goto(`/server/${base64Encode(runtime.backendUrl)}/session/${sessionID}`),
  ])
  expect(await records(opened)).toEqual(inbox)
  await expect(page.getByRole("heading", { name: "E4 Assistant scheduler", exact: true })).toBeVisible()

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
  // mark-read route answers 204 with no body, which CDP cannot fetch.
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

async function records(response: APIResponse | Response) {
  expect(response.ok(), `${response.url()}: ${await response.text()}`).toBeTruthy()
  const body: unknown = await response.json()
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
  input: { operation: "create" | "unread"; sessionID: string; content?: string },
): Promise<unknown> {
  expect(runtime.dbPath, "service seed must use only the isolated E4 database").toBe(
    path.join(runtime.runDir, "e4.sqlite"),
  )
  const result = await promisify(execFile)(
    "bun",
    [
      "--no-env-file",
      "--eval",
      `const { DateTime, Effect } = await import("effect")
       const { ScheduleService } = await import("@aigcfroge/core/session/schedule-service")
       const { SessionSchema } = await import("@aigcfroge/core/session/schema")
       const sessionID = SessionSchema.ID.make(process.env.E4_ASSISTANT_SESSION_ID)
       const result = process.env.E4_ASSISTANT_OPERATION === "create"
         ? await Effect.runPromise(
             Effect.gen(function* () {
               const schedules = yield* ScheduleService.Service
               return yield* schedules.create({
                 sessionID,
                 kind: "reminder",
                 content: process.env.E4_ASSISTANT_CONTENT,
                 dueAt: (yield* DateTime.nowAsDate).getTime() + 2_000,
                 timezone: "UTC",
                 deliveryKey: "e4-assistant-reminder:" + sessionID,
               })
             }).pipe(Effect.provide(ScheduleService.defaultLayer)),
           )
         : await Effect.runPromise(
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
        E4_ASSISTANT_CONTENT: input.content ?? "",
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
