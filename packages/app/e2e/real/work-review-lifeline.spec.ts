/**
 * S07 R05/R06: a real provider turn becomes a file through the production Work UI,
 * then the canonical review survives browser reload and the harness-owned restart.
 * No business API interception, transcript seed, metadata write, or frontend hash.
 * Hashes below are independent evidence only; commands use the GET-provided binding.
 *
 * Default-runtime coverage only. The separate V2 defect pin is not a Custom pass.
 * Keep this file serial: the provider and restart endpoint belong to the whole run.
 */
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test"
import {
  createAigcfrogeClient,
  type WorkReviewBinding,
  type WorkReviewCommand,
  type WorkReviewReadResult,
  type WorkReviewState,
} from "@aigcfroge/sdk/v2/client"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs"
import path from "node:path"
import { backup, DatabaseSync } from "node:sqlite"
import { e4, seedRealBackend } from "./fixture"
import { isRecord } from "./manifest"
import { pinEnglishUI } from "../utils/locale"
import { expectSessionTitle } from "../utils/waits"

const providerText = "E4 deterministic response"
const panel = (page: Page) => page.getByRole("region").and(page.locator('[data-component="work-review-panel"]'))

type Work = {
  client: ReturnType<typeof createAigcfrogeClient>
  sessionID: string
  directory: string
  title: string
}

test.skip(() => e4().v2Runtime, "Default Work product chain; V2/Custom requires separate positive execution evidence")

test("AI-TDD-S07-R06/R07: provider → UI apply → six review actions add no provider turns or Session policy changes", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000)
  await withWork(page, request, testInfo, async (work) => {
    const produced = await produceArtifact(work, page, request, testInfo)
    const before = await checkpoint(work, produced.binding, testInfo, "before-review")
    const calls = await providerCalls(request)
    const receipts: WorkReviewReadResult[] = []
    const mutations: { method: string; path: string }[] = []
    page.on("request", (event) => {
      const url = new URL(event.url())
      if (url.origin !== new URL(e4().backendUrl).origin || ["GET", "HEAD", "OPTIONS"].includes(event.method())) return
      mutations.push({ method: event.method(), path: url.pathname })
    })

    await openReview(page)
    await expectReviewFields(page, before.review)
    for (const step of [
      { action: "submit", state: "open", revision: 1 },
      { action: "request_changes", state: "fix_requested", revision: 2 },
      { action: "respond", state: "responded", revision: 3 },
      { action: "re_review", state: "open", revision: 4 },
      { action: "approve", state: "resolved", revision: 5 },
      { action: "reopen", state: "open", revision: 6 },
    ] as const) {
      receipts.push(
        await test.step(step.action, async () => {
          const result = await transition(work, page, produced.binding, step)
          const stored = await checkpoint(work, produced.binding, testInfo, step.action)
          expect(stored.review).toEqual(result)
          expect(stored.sqlite.policy).toEqual(before.sqlite.policy)
          expect(await providerCalls(request)).toEqual(calls)
          return result
        }),
      )
    }

    await panel(page).locator('button[data-action="work-review-close"]').click()
    await expect(panel(page)).toBeHidden()
    await openReview(page)
    await refreshReview(work, page)
    const after = await checkpoint(work, produced.binding, testInfo, "reopened-readback")
    expect(after.review).toEqual(receipts.at(-1))
    expect(after.review).toMatchObject({ review: { state: "open", revision: 6, reopenedFrom: "resolved" } })
    expect(after.sqlite.policy).toEqual(before.sqlite.policy)
    expect(await providerCalls(request)).toEqual(calls)
    await expectReviewFields(page, after.review)
    expect(mutations).toEqual(
      receipts.map(() => ({ method: "POST", path: `/api/session/${work.sessionID}/work-review` })),
    )
    await testInfo.attach("e4-review-lifecycle", {
      body: JSON.stringify({ sessionID: work.sessionID, receipts, mutations, providerCalls: calls }, null, 2),
      contentType: "application/json",
    })
  })
})

test("AI-TDD-S07-R05: unsubmitted artifact binding and resolved review survive reload and a proven backend restart", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(480_000)
  await withWork(page, request, testInfo, async (work) => {
    const produced = await produceArtifact(work, page, request, testInfo)
    const unreviewed = await checkpoint(work, produced.binding, testInfo, "unreviewed-before-reload")
    expect(unreviewed.review.status).toBe("none")

    // Applying is not submitting. A cold UI must obtain the existing artifact's exact
    // identity from None.artifact, without applying again or deriving a client hash.
    await page.reload()
    await expectSessionTitle(page, work.title)
    await openReview(page)
    const reloaded = await checkpoint(work, produced.binding, testInfo, "unreviewed-after-reload")
    expect(reloaded).toEqual(unreviewed)
    await expectReviewFields(page, reloaded.review)
    await transition(work, page, produced.binding, { action: "submit", state: "open", revision: 1 })
    await transition(work, page, produced.binding, { action: "approve", state: "resolved", revision: 2 })
    const approved = await checkpoint(work, produced.binding, testInfo, "approved-before-reload")
    const calls = await providerCalls(request)

    await page.reload()
    await expectSessionTitle(page, work.title)
    await openReview(page)
    expect(await checkpoint(work, produced.binding, testInfo, "approved-after-reload")).toEqual(approved)
    await expectReviewFields(page, approved.review)

    const logPath = path.join(e4().runDir, "orchestrator.log")
    const logOffset = readFileSync(logPath).length
    const restarted = await request.post(`${new URL(e4().providerBaseURL).origin}/e4/restart-backend`)
    expect(restarted.status()).toBe(202)
    // A health response alone can still come from the old child after the 202.
    // Require this restart's completion marker AND the real backend's version.
    await expect
      .poll(
        async () => {
          const log = readFileSync(logPath).subarray(logOffset).toString("utf8")
          const probe = await request
            .get(`${new URL(e4().providerBaseURL).origin}/e4/backend-health`, { timeout: 10_000 })
            .catch(() => undefined)
          const health: unknown = probe?.ok() ? await probe.json() : undefined
          return {
            restarted: log.includes(`[E4] backend restarted and healthy (version ${e4().backendVersion})`),
            healthy: !!probe?.ok() && isRecord(health) && health.healthy === true,
            version: isRecord(health) ? health.version : undefined,
          }
        },
        { timeout: 300_000, intervals: [500, 1_000, 2_000] },
      )
      .toEqual({ restarted: true, healthy: true, version: e4().backendVersion })
    await testInfo.attach("e4-backend-restart", {
      body: JSON.stringify(
        {
          backendUrl: e4().backendUrl,
          backendVersion: e4().backendVersion,
          dbPath: e4().dbPath,
          logOffset,
          completion: readFileSync(logPath)
            .subarray(logOffset)
            .toString("utf8")
            .split("\n")
            .filter((line) => line.startsWith("[E4] backend restarted and healthy")),
        },
        null,
        2,
      ),
      contentType: "application/json",
    })

    const cold = {
      ...work,
      client: createAigcfrogeClient({ baseUrl: e4().backendUrl, directory: work.directory, throwOnError: true }),
    }
    await page.reload()
    await expectSessionTitle(page, work.title)
    await openReview(page)
    await refreshReview(cold, page)
    const recovered = await checkpoint(cold, produced.binding, testInfo, "approved-after-backend-restart")
    expect(recovered).toEqual(approved)
    await expectReviewFields(page, recovered.review)
    expect((await completedAssistant(cold))?.info.id).toBe(produced.messageID)
    expect(await providerCalls(request)).toEqual(calls)
  })
})

/** Own one fresh Location under the harness workspace, not another test's file. */
async function withWork(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  use: (work: Work) => Promise<void>,
) {
  const directory = mkdtempSync(path.join(e4().workspaceDir, "e4-work-review-"))
  try {
    const health = await request.get(`${e4().backendUrl}/global/health`)
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({ healthy: true, version: e4().backendVersion })
    const disarmed = await request.post(`${new URL(e4().providerBaseURL).origin}/e4/provider-failures?count=0`)
    expect(disarmed.status()).toBe(200)
    const client = createAigcfrogeClient({ baseUrl: e4().backendUrl, directory, throwOnError: true })
    const title = `E4 Work review ${testInfo.title.includes("R05") ? "recovery" : "lifecycle"}`
    const created = await client.session.create({
      directory,
      mode: "work",
      agent: "work-orchestrator",
      model: { providerID: "e4-real", id: "e4-deterministic" },
      title,
    })
    expect(created.response.status).toBe(200)
    if (!created.data) throw new Error("Work Session creation returned no body")
    const work = { client, directory, title, sessionID: created.data.id }
    const persisted = await client.session.get({ sessionID: work.sessionID })
    expect(persisted.data).toMatchObject({
      id: work.sessionID,
      directory,
      mode: "work",
      agent: "work-orchestrator",
      workContract: { source: "ad-hoc", contractVersion: 1 },
    })
    expect(await readReview(work)).toEqual({ status: "none" })
    await pinEnglishUI(page)
    seedRealBackend(page, e4().backendUrl)
    await page.goto(`/server/${base64Encode(e4().backendUrl)}/session/${work.sessionID}`)
    await expectSessionTitle(page, title)
    await use(work)
  } finally {
    try {
      const file = path.join(directory, "work-draft.md")
      if (existsSync(file)) {
        await testInfo.attach("e4-provider-artifact", { path: file, contentType: "text/markdown" })
        await testInfo.attach("e4-provider-artifact-sha256", {
          body: createHash("sha256").update(readFileSync(file)).digest("hex"),
          contentType: "text/plain",
        })
      }
      // SQLite's backup API captures committed WAL contents; copying only e4.sqlite
      // while the backend is alive could silently omit the very review being tested.
      const db = new DatabaseSync(e4().dbPath, { readOnly: true, timeout: 5_000 })
      const snapshot = testInfo.outputPath("e4-work-review.sqlite")
      try {
        expect(await backup(db, snapshot)).toBeGreaterThan(0)
      } finally {
        db.close()
      }
      await testInfo.attach("e4-work-review-sqlite", { path: snapshot, contentType: "application/vnd.sqlite3" })
      await testInfo.attach("e4-runtime-manifest", {
        path: path.join(e4().runDir, "manifest.json"),
        contentType: "application/json",
      })
    } finally {
      // Only this mkdtemp-created Location is removed. Retain the harness DB and
      // its Session/review rows; never remove another spec's workspace or evidence.
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

async function produceArtifact(work: Work, page: Page, request: APIRequestContext, testInfo: TestInfo) {
  const before = await providerCalls(request)
  const prompt = page.locator('[data-component="session-composer"] [data-component="prompt-input"]')
  await expect(prompt).toBeVisible()
  await prompt.fill("Draft a short document for this isolated Work review lifeline.")
  const [admitted] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/session/${work.sessionID}/prompt_async`,
    ),
    prompt.press("Enter"),
  ])
  expect(admitted.status()).toBe(204)
  await expect(page.getByText(providerText, { exact: true }).first()).toBeVisible({ timeout: 90_000 })
  await expect.poll(async () => (await completedAssistant(work))?.info.id, { timeout: 90_000 }).toBeTruthy()
  await expect
    .poll(async () => {
      const response = await work.client.session.status({ directory: work.directory })
      if (!response.data) throw new Error("Session status returned no body")
      return response.data[work.sessionID]?.type ?? "idle"
    })
    .toBe("idle")
  const completed = await completedAssistant(work)
  if (!completed) throw new Error("The completed provider turn disappeared")
  expect(completed.info).toMatchObject({
    providerID: "e4-real",
    modelID: "e4-deterministic",
    agent: "work-orchestrator",
  })
  const calls = await providerCalls(request)
  expect(calls.length).toBeGreaterThan(before.length)
  await testInfo.attach("e4-provider-turn", {
    body: JSON.stringify(
      { sessionID: work.sessionID, messageID: completed.info.id, calls: calls.slice(before.length) },
      null,
      2,
    ),
    contentType: "application/json",
  })

  await showArtifactTab(page)
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/session/${work.sessionID}/work-artifact/apply`,
    ),
    page.getByRole("button", { name: "Apply to project", exact: true }).click(),
  ])
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({
    title: "work-draft.md",
    relativePath: "work-draft.md",
    content: providerText,
    overwrite: false,
  })
  const artifact: unknown = await response.json()
  const read = await readReview(work)
  if (read.status !== "none" || !read.artifact) throw new Error("Unreviewed artifact GET did not return its binding")
  expect(artifact).toMatchObject({
    id: read.artifact.artifactID,
    sessionID: work.sessionID,
    relativePath: "work-draft.md",
  })
  return { binding: read.artifact, messageID: completed.info.id }
}

async function completedAssistant(work: Work) {
  const response = await work.client.session.messages({ sessionID: work.sessionID })
  if (!response.data) throw new Error("Session messages returned no body")
  return response.data.find(
    (message) =>
      message.info.role === "assistant" &&
      message.info.time.completed !== undefined &&
      message.info.error === undefined &&
      message.parts.some((part) => part.type === "text" && part.text === providerText),
  )
}

async function providerCalls(request: APIRequestContext) {
  const response = await request.get(`${new URL(e4().providerBaseURL).origin}/e4/provider-requests`)
  expect(response.status()).toBe(200)
  const body: unknown = await response.json()
  if (!isRecord(body) || !Array.isArray(body.requests)) throw new Error("Provider evidence has no request records")
  return body.requests.flatMap((entry: unknown) => {
    if (
      !isRecord(entry) ||
      entry.method !== "POST" ||
      typeof entry.path !== "string" ||
      !entry.path.endsWith("/chat/completions")
    )
      return []
    if (typeof entry.receivedAt !== "number") throw new Error("Provider completion record has no receive timestamp")
    return [
      {
        method: entry.method,
        path: entry.path,
        receivedAt: entry.receivedAt,
        responseStartedAt: typeof entry.responseStartedAt === "number" ? entry.responseStartedAt : undefined,
        scenario: typeof entry.scenario === "string" ? entry.scenario : undefined,
      },
    ]
  })
}

async function showArtifactTab(page: Page) {
  const toggle = page.locator('button[aria-controls="review-panel"]')
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await page.getByRole("tab", { name: "Artifact", exact: true }).click()
}

async function openReview(page: Page) {
  await showArtifactTab(page)
  if (!(await panel(page).isVisible())) await page.locator('button[data-action="work-review-open"]').click()
  await expect(panel(page)).toBeVisible()
}

async function refreshReview(work: Work, page: Page) {
  const [refreshed] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === `/api/session/${work.sessionID}/work-review`,
    ),
    panel(page).locator('button[data-action="work-review-refresh"]').click(),
  ])
  expect(refreshed.status()).toBe(200)
}

async function readReview(work: Work) {
  const response = await work.client.v2.session.workReview.get({ sessionID: work.sessionID })
  expect(response.response.status).toBe(200)
  if (!response.data) throw new Error("WorkReview GET returned no body")
  return response.data.data
}

async function expectReviewFields(page: Page, result: WorkReviewReadResult) {
  if (result.status === "unavailable" || !result.artifact) throw new Error("Expected an available artifact binding")
  await expect(panel(page)).toHaveAttribute("data-review-status", result.status)
  await expect(panel(page).locator('[data-field="current-artifact-id"]')).toHaveText(result.artifact.artifactID)
  await expect(panel(page).locator('[data-field="current-artifact-revision"]')).toHaveText(
    result.artifact.artifactRevision,
  )
  if (result.status === "none") return
  await expect(panel(page).locator('[data-field="review-revision"]')).toHaveText(String(result.review.revision))
  await expect(panel(page).locator('[data-field="reviewed-artifact-id"]')).toHaveText(result.review.artifactID)
  await expect(panel(page).locator('[data-field="reviewed-artifact-revision"]')).toHaveText(
    result.review.artifactRevision,
  )
}

async function transition(
  work: Work,
  page: Page,
  binding: WorkReviewBinding,
  step: { action: WorkReviewCommand["action"]; state: WorkReviewState; revision: number },
) {
  const command: WorkReviewCommand =
    step.action === "respond"
      ? { action: step.action, expectedReviewRevision: step.revision - 1 }
      : {
          action: step.action,
          expectedReviewRevision: step.revision - 1,
          artifactID: binding.artifactID,
          expectedArtifactRevision: binding.artifactRevision,
        }
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/session/${work.sessionID}/work-review`,
    ),
    panel(page).locator(`button[data-action="work-review-${step.action}"]`).click(),
  ])
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual(command)
  const result = await readReview(work)
  expect(await response.json()).toEqual({ data: result })
  expect(result).toMatchObject({
    status: "ready",
    current: true,
    artifact: binding,
    review: { ...binding, state: step.state, revision: step.revision, contractVersion: 1 },
  })
  await expectReviewFields(page, result)
  return result
}

async function checkpoint(work: Work, binding: WorkReviewBinding, testInfo: TestInfo, label: string) {
  const review = await readReview(work)
  if (review.status === "unavailable") throw new Error(`Artifact unavailable at ${label}: ${review.reason}`)
  expect(review.artifact).toEqual(binding)
  const session = await work.client.session.get({ sessionID: work.sessionID })
  expect(session.response.status).toBe(200)
  if (!session.data || session.data.id !== work.sessionID) {
    throw new Error(`Session GET returned no matching body at ${label}`)
  }
  expect(session.data).toMatchObject({
    id: work.sessionID,
    directory: work.directory,
    mode: "work",
    agent: "work-orchestrator",
  })
  expect(session.data.workReview).toEqual(review.status === "ready" ? review.review : undefined)
  expect(Object.hasOwn(session.data, "workReview")).toBe(review.status === "ready")
  const content = await work.client.file.read({ directory: work.directory, path: "work-draft.md" })
  expect(content.response.status).toBe(200)
  expect(content.data).toMatchObject({ type: "text", content: providerText })
  const bytes = readFileSync(path.join(work.directory, "work-draft.md"))
  expect(bytes.toString("utf8")).toBe(providerText)
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(binding.artifactRevision)
  const db = new DatabaseSync(e4().dbPath, { readOnly: true, timeout: 5_000 })
  try {
    const row = db
      .prepare("SELECT id, directory, mode, agent, permission, permission_tier, metadata FROM session WHERE id = ?")
      .get(work.sessionID)
    if (!row || typeof row.metadata !== "string") throw new Error("Persisted Work Session metadata is missing")
    const metadata: unknown = JSON.parse(row.metadata)
    if (!isRecord(metadata)) throw new Error("Persisted Work Session metadata is not an object")
    expect(row).toMatchObject({
      id: work.sessionID,
      directory: work.directory,
      mode: "work",
      agent: "work-orchestrator",
    })
    expect(metadata.workReview).toEqual(review.status === "ready" ? review.review : undefined)
    expect(metadata.workArtifact).toMatchObject({
      artifact: {
        id: binding.artifactID,
        sessionID: work.sessionID,
        relativePath: "work-draft.md",
        status: "available",
      },
      revision: binding.artifactRevision,
    })
    const file = statSync(e4().dbPath)
    const evidence = {
      review,
      sqlite: {
        path: realpathSync(e4().dbPath),
        device: file.dev,
        inode: file.ino,
        sessionID: row.id,
        directory: row.directory,
        policy: { mode: row.mode, agent: row.agent, permission: row.permission, permissionTier: row.permission_tier },
        workContract: metadata.workContract,
        workArtifact: metadata.workArtifact,
        workReview: metadata.workReview,
      },
      artifact: {
        path: path.join(work.directory, "work-draft.md"),
        sha256: binding.artifactRevision,
        bytes: bytes.length,
      },
      backendVersion: e4().backendVersion,
    }
    await testInfo.attach(`e4-${label}`, { body: JSON.stringify(evidence, null, 2), contentType: "application/json" })
    return evidence
  } finally {
    db.close()
  }
}
