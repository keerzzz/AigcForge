/**
 * Synthetic V1 history enters the real Assistant UI through canonical reads.
 * Provider metadata proves dispatch and historical tool IDs; exact provider-body
 * ordering is covered by httpapi-assistant-history.test.ts. Restart occurs only
 * after the new turn completes, so this does not claim crash-continuation recovery.
 */
import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { Environment } from "./environment"
import { e4, seedRealBackend } from "./fixture"
import { isRecord, stringField, type E4Manifest } from "./manifest"
import { pinEnglishUI } from "../utils/locale"

test.skip(() => e4().v2Runtime, "Default Assistant history contract")

test("Assistant Shell submits through canonical admission and preserves its output on reload", async ({
  page,
  request,
}, testInfo) => {
  const runtime = e4()
  const headers = { "x-aigcfroge-directory": runtime.workspaceDir }
  const created = await request.post(`${runtime.backendUrl}/session`, {
    headers,
    data: { location: { directory: runtime.workspaceDir }, title: "Canonical Shell", mode: "assistant" },
  })
  expect(created.ok()).toBeTruthy()
  const body: unknown = await created.json()
  if (!isRecord(body)) throw new Error("Session creation returned no object")
  const sessionID = stringField(body, "id", "Shell session")
  try {
    await pinEnglishUI(page)
    seedRealBackend(page, runtime.backendUrl)
    await page.goto(`/server/${base64Encode(runtime.backendUrl)}/session/${sessionID}`)
    const composer = page.locator('[data-component="session-prompt-dock"] [data-component="prompt-input"]')
    await expect(composer).toBeVisible()
    await expect(page.locator('[data-action="prompt-model"]')).toContainText("E4 Deterministic")
    await composer.press("!")
    await composer.fill("echo E4_SHELL_RESULT")
    const [admission] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api/session/${sessionID}/shell`,
      ),
      composer.press("Enter"),
    ])
    expect(admission.status()).toBe(200)
    expect(admission.request().postDataJSON()).toEqual({ command: "echo E4_SHELL_RESULT" })
    await expect
      .poll(
        async () => (await canonicalMessages(request, sessionID)).find((message) => message.type === "shell")?.output,
      )
      .toContain("E4_SHELL_RESULT")
    const completed = await canonicalMessages(request, sessionID)
    const tool = page.locator('[data-component="tool-part-wrapper"]')
    await expect(tool).toHaveCount(1)
    await expect(tool).toContainText("Completed")
    const trigger = tool.locator('[data-slot="collapsible-trigger"]').first()
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()
    await expect(tool.locator('[data-slot="bash-pre"]')).toContainText("E4_SHELL_RESULT")
    await page.reload()
    await expect(tool).toHaveCount(1)
    await expect(tool).toContainText("Completed")
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click()
    await expect(tool.locator('[data-slot="bash-pre"]')).toContainText("E4_SHELL_RESULT")
    expect(await canonicalMessages(request, sessionID)).toEqual(completed)
    await testInfo.attach("canonical-shell", { body: await page.screenshot(), contentType: "image/png" })
  } finally {
    expect((await request.delete(`${runtime.backendUrl}/session/${sessionID}`, { headers })).ok()).toBeTruthy()
  }
})

test("imported Assistant history survives a browser turn, reload and completed-turn backend restart", async ({
  page,
  request,
}, testInfo) => {
  const runtime = e4()
  const seeded = await historyFixture(runtime, "seed")
  const sessionID = stringField(seeded, "sessionID", "seeded history")
  const historicalIDs = [
    stringField(seeded, "userID", "seeded history"),
    stringField(seeded, "assistantID", "seeded history"),
  ]
  const headers = { "x-aigcfroge-directory": runtime.workspaceDir }
  const providerURL = new URL(runtime.providerBaseURL).origin
  try {
    expect(seeded.source).toMatchObject({ messages: 2, parts: 4 })
    expect(seeded.events).toEqual([])
    expect(seeded.inputs).toEqual([])
    expect(seeded.replayFiles).toEqual({ completed: false, pending: false })
    expect((await request.post(`${providerURL}/e4/provider-failures?count=0`)).ok()).toBeTruthy()
    const callsBefore = await providerCalls(request)

    await pinEnglishUI(page)
    seedRealBackend(page, runtime.backendUrl)
    await page.setViewportSize({ width: 1400, height: 900 })
    const [opened] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).origin === runtime.backendUrl &&
          new URL(response.url()).pathname === `/api/session/${sessionID}/message`,
      ),
      page.goto(`/server/${base64Encode(runtime.backendUrl)}/session/${sessionID}`),
    ])
    expect(opened.status()).toBe(200)
    await visibleHistory(page)
    const history = await canonicalMessages(request, sessionID)
    expect(history.map((message) => message.id)).toEqual(historicalIDs)
    expect(history[0]).toMatchObject({ type: "user", text: "Historical question." })
    expect(history[1]).toMatchObject({ type: "assistant", cost: 2, tokens: { input: 10, output: 5 } })
    const imported = await historyFixture(runtime, "inspect", sessionID)
    expect(imported.source).toEqual(seeded.source)
    expect(imported.usage).toEqual(seeded.usage)
    expect(records(imported.events).map((event) => event.type)).toEqual([
      "session.next.history.imported.1",
      "session.next.history.imported.1",
    ])
    expect(imported.inputs).toEqual([])
    expect(await providerCalls(request)).toEqual(callsBefore)

    const prompt = "Continue from this imported Assistant history in the browser."
    const composer = page.locator('[data-component="session-prompt-dock"] [data-component="prompt-input"]')
    await expect(composer).toBeVisible()
    await expect(page.locator('[data-action="prompt-model"]')).toContainText("E4 Deterministic")
    await composer.fill(prompt)
    const [admission] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).origin === runtime.backendUrl &&
          new URL(response.url()).pathname === `/session/${sessionID}/prompt_async`,
      ),
      composer.press("Enter"),
    ])
    expect(admission.status()).toBe(204)
    const submitted: unknown = admission.request().postDataJSON()
    if (!isRecord(submitted)) throw new Error("Assistant admission has no payload")
    const inputID = stringField(submitted, "messageID", "Assistant admission")
    await expect
      .poll(async () => {
        const current = await canonicalMessages(request, sessionID)
        return { length: current.length, finish: current.at(-1)?.finish }
      })
      .toEqual({ length: 5, finish: "stop" })
    const completed = await canonicalMessages(request, sessionID)
    expect(completed.map((message) => message.type)).toEqual([
      "user",
      "assistant",
      "model-switched",
      "user",
      "assistant",
    ])
    expect(completed.slice(0, 2)).toEqual(history)
    expect(completed[2]).toMatchObject({ model: { id: "e4-deterministic", providerID: "e4-real" } })
    expect(completed[3]).toMatchObject({ id: inputID, type: "user", text: prompt })
    expect(completed[4]).toMatchObject({
      type: "assistant",
      agent: "assistant-orchestrator",
      finish: "stop",
      content: [{ type: "text", text: "E4 deterministic response" }],
    })
    await visibleHistory(page, prompt)
    await expect.poll(async () => (await providerCalls(request)).length).toBe(callsBefore.length + 1)
    const calls = await providerCalls(request)
    expect(calls.at(-1)).toMatchObject({ model: "e4-deterministic", authenticated: true })
    expect(calls.at(-1)?.toolResultIDs).toEqual(["history-completed-call", "history-pending-call"])

    const after = await historyFixture(runtime, "inspect", sessionID)
    expect(after.source).toEqual(seeded.source)
    expect(records(after.events).filter((event) => event.type === "session.next.history.imported.1")).toEqual(
      imported.events,
    )
    expect(records(after.events).filter((event) => event.type === "session.next.step.started.1")).toHaveLength(1)
    expect(records(after.events).filter((event) => String(event.type).startsWith("session.next.tool."))).toEqual([])
    expect(records(after.inputs)).toHaveLength(1)
    expect(records(after.inputs)[0]).toMatchObject({ id: inputID, sessionID })
    expect(records(after.inputs)[0]?.promotedSeq).toEqual(expect.any(Number))
    expect(after.replayFiles).toEqual({ completed: false, pending: false })
    await page.reload()
    await visibleHistory(page, prompt)
    expect(await canonicalMessages(request, sessionID)).toEqual(completed)
    expect(await historyFixture(runtime, "inspect", sessionID)).toEqual(after)

    const logPath = path.join(runtime.runDir, "orchestrator.log")
    const logOffset = readFileSync(logPath).length
    expect((await request.post(`${providerURL}/e4/restart-backend`)).status()).toBe(202)
    await expect
      .poll(
        async () => {
          const probe = await request.get(`${providerURL}/e4/backend-health`, { timeout: 5_000 }).catch(() => undefined)
          const health: unknown = probe?.ok() ? await probe.json() : undefined
          const log = readFileSync(logPath).subarray(logOffset).toString("utf8")
          return {
            completed: log.includes(`[E4] backend restarted and healthy (version ${runtime.backendVersion})`),
            healthy: isRecord(health) && health.healthy === true,
            restarting: isRecord(health) ? health.restarting : undefined,
            version: isRecord(health) ? health.version : undefined,
          }
        },
        { timeout: 45_000, intervals: [250, 500, 1_000] },
      )
      .toEqual({ completed: true, healthy: true, restarting: false, version: runtime.backendVersion })

    await page.reload()
    await visibleHistory(page, prompt)
    expect(await canonicalMessages(request, sessionID)).toEqual(completed)
    expect(await historyFixture(runtime, "inspect", sessionID)).toEqual(after)
    expect(await providerCalls(request)).toEqual(calls)
    await testInfo.attach("assistant-history-browser-restart", {
      body: JSON.stringify(
        {
          sessionID,
          runtime: { v2: runtime.v2Runtime, backendVersion: runtime.backendVersion, dbPath: runtime.dbPath },
          canonicalMessages: completed,
          source: seeded.source,
          usage: { before: seeded.usage, afterImport: imported.usage },
          persisted: after,
          provider: {
            beforeCount: callsBefore.length,
            afterCount: calls.length,
            requests: calls.slice(callsBefore.length),
          },
          restart: {
            logOffset,
            completion: readFileSync(logPath)
              .subarray(logOffset)
              .toString("utf8")
              .split("\n")
              .filter((line) => line.startsWith("[E4] backend restarted and healthy")),
          },
        },
        null,
        2,
      ),
      contentType: "application/json",
    })
  } finally {
    // Only the Session created by this spec is removed. Process cleanup remains
    // with execFile's child timeout and the existing E4 orchestrator teardown.
    await request
      .delete(`${runtime.backendUrl}/session/${sessionID}`, { headers, timeout: 5_000 })
      .catch(() => undefined)
  }
})

async function visibleHistory(page: Page, prompt?: string) {
  await expect(page.getByText("Historical question.", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Historical answer.", { exact: true }).first()).toBeVisible()
  if (!prompt) return
  await expect(page.getByText(prompt, { exact: true }).first()).toBeVisible()
  await expect(page.getByText("E4 deterministic response", { exact: true }).first()).toBeVisible()
}

async function canonicalMessages(request: APIRequestContext, sessionID: string) {
  const response = await request.get(`${e4().backendUrl}/api/session/${sessionID}/message?order=asc`)
  expect(response.status()).toBe(200)
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error("Canonical messages response is not an object")
  return records(body.data)
}

async function providerCalls(request: APIRequestContext) {
  const response = await request.get(`${new URL(e4().providerBaseURL).origin}/e4/provider-requests`)
  expect(response.status()).toBe(200)
  const body: unknown = await response.json()
  if (!isRecord(body)) throw new Error("Provider evidence is not an object")
  return records(body.requests)
    .filter((row) => typeof row.path === "string" && row.path.endsWith("/chat/completions"))
    .map((row) => ({
      path: row.path,
      model: row.model,
      authenticated: row.authenticated,
      toolResultIDs: row.toolResultIDs,
    }))
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error("Expected an array of records")
  return value
}

async function historyFixture(runtime: E4Manifest, operation: "seed" | "inspect", sessionID?: string) {
  expect(runtime.dbPath).toBe(path.join(runtime.runDir, "e4.sqlite"))
  expect(runtime.workspaceDir).toBe(path.join(runtime.runDir, "workspace"))
  const result = await promisify(execFile)(
    "bun",
    [
      "--no-env-file",
      fileURLToPath(new URL("../../../aigcfroge/test/lib/legacy-history-e4.ts", import.meta.url)),
      operation,
      runtime.runDir,
      ...(sessionID ? [sessionID] : []),
    ],
    {
      cwd: runtime.workspaceDir,
      env: {
        ...Environment.create(runtime.runDir, process.env),
        AIGCFROGE_DB: runtime.dbPath,
        AIGCFROGE_CONFIG_DIR: runtime.configDir,
        AIGCFROGE_DISABLE_PROJECT_CONFIG: "true",
        AIGCFROGE_DISABLE_AUTOUPDATE: "true",
        AIGCFROGE_DISABLE_MODELS_FETCH: "true",
      },
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    },
  )
  const output = result.stdout.split("\n").find((line) => line.startsWith("E4_HISTORY_RESULT:"))
  if (!output) throw new Error(`Isolated history ${operation} returned no result`)
  const parsed: unknown = JSON.parse(output.slice("E4_HISTORY_RESULT:".length))
  if (!isRecord(parsed)) throw new Error(`Isolated history ${operation} returned an invalid result`)
  return parsed
}
