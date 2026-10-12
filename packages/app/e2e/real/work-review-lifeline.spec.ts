/**
 * S07 R05/R06: a real provider turn becomes a file through the production Work UI,
 * then the canonical review survives browser reload and the harness-owned restart.
 * No fabricated API response, transcript seed, metadata write, or frontend hash.
 * Hashes below are independent evidence only; commands use the GET-provided binding.
 *
 * Default-runtime coverage only; canonical-runtime.spec.ts owns V2/Custom execution.
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
import { isRecord, type E4Backend } from "./manifest"
import { pinEnglishUI } from "../utils/locale"
import { expectSessionTitle } from "../utils/waits"

const providerText = "E4 deterministic response"
const panel = (page: Page) => page.getByRole("region").and(page.locator('[data-component="work-review-panel"]'))

type Work = {
  client: ReturnType<typeof createAigcfrogeClient>
  sessionID: string
  directory: string
  title: string
  backend: E4Backend
}

test.skip(() => e4().v2Runtime, "Default Work product chain; V2/Custom requires separate positive execution evidence")

test("AI-TDD-S07-R06/R07: provider → UI apply → six review actions add no provider turns or Session policy changes", async ({
  page,
  request,
}, testInfo) => {
  test.skip(!!e4().peer, "The single-backend lifecycle runs in the default E4 topology")
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
  test.skip(!!e4().peer, "The single-backend restart runs in the default E4 topology")
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
            healthy: !!probe?.ok() && isRecord(health) && health.healthy === true && health.restarting === false,
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

test("AI-TDD-S08: a stale review command stays on its real backend when two servers share a Session ID", async ({
  page,
  request,
}, testInfo) => {
  const peer = e4().peer
  test.skip(!peer, "Requires E4_DUAL_BACKEND=1")
  if (!peer) throw new Error("The dual-backend manifest is missing its peer")
  test.setTimeout(240_000)
  expect(peer.backendUrl).not.toBe(e4().backendUrl)
  expect(peer.dbPath).not.toBe(e4().dbPath)

  await withWork(
    page,
    request,
    testInfo,
    async (first) => {
      const firstArtifact = await produceArtifact(first, page, request, testInfo)
      await openReview(page)
      await transition(first, page, firstArtifact.binding, { action: "submit", state: "open", revision: 1 })
      await transition(first, page, firstArtifact.binding, { action: "approve", state: "resolved", revision: 2 })
      const firstBefore = await checkpoint(first, firstArtifact.binding, testInfo, "first-before-switch")

      await withWork(
        page,
        request,
        testInfo,
        async (second) => {
          expect(second.sessionID).toBe(first.sessionID)
          expect(second.directory).not.toBe(first.directory)
          const secondArtifact = await produceArtifact(second, page, request, testInfo)
          expect(secondArtifact.binding.artifactID).not.toBe(firstArtifact.binding.artifactID)
          expect(secondArtifact.binding.artifactRevision).toBe(firstArtifact.binding.artifactRevision)
          await openReview(page)
          await transition(second, page, secondArtifact.binding, { action: "submit", state: "open", revision: 1 })
          const secondBefore = await checkpoint(second, secondArtifact.binding, testInfo, "second-before-conflict")
          if (secondBefore.review.status !== "ready") throw new Error("The second backend has no submitted review")
          const calls = await providerCalls(request)
          await page.locator("html").evaluate((element) => element.setAttribute("data-e4-spa", "work-review-scope"))

          const protocol = await page.context().newCDPSession(page)
          const reviewUrl = `${second.backend.backendUrl}/api/session/${second.sessionID}/work-review`
          const paused = Promise.withResolvers<{
            requestId: string
            request: { url: string; method: string; postData?: string }
          }>()
          const onPaused = (event: {
            requestId: string
            request: { url: string; method: string; postData?: string }
          }) => {
            if (event.request.method === "POST") {
              paused.resolve(event)
              return
            }
            void protocol.send("Fetch.continueRequest", { requestId: event.requestId }).catch(paused.reject)
          }
          protocol.on("Fetch.requestPaused", onPaused)
          try {
            // Pause delivery only. The eventual status and body still come from the real server.
            await protocol.send("Fetch.enable", { patterns: [{ urlPattern: reviewUrl, requestStage: "Request" }] })
            await panel(page).locator('button[data-action="work-review-approve"]').click()
            const held = await paused.promise
            expect(held.request.url).toBe(reviewUrl)
            expect(JSON.parse(held.request.postData ?? "{}")).toEqual({
              action: "approve",
              expectedReviewRevision: 1,
              artifactID: secondArtifact.binding.artifactID,
              expectedArtifactRevision: secondArtifact.binding.artifactRevision,
            })

            // A new artifact with identical bytes must not inherit the old artifact's review.
            const applied = await second.client.workArtifact.apply({
              sessionID: second.sessionID,
              title: "work-draft.md",
              relativePath: "work-draft.md",
              content: providerText,
              overwrite: true,
            })
            expect(applied.response.status).toBe(200)
            if (!applied.data) throw new Error("The replacement artifact response is empty")
            const stale = await readReview(second)
            if (stale.status !== "ready") throw new Error("The previous review was not retained")
            expect(stale.artifact.artifactID).toBe(applied.data.id)
            expect(stale.artifact.artifactID).not.toBe(secondArtifact.binding.artifactID)
            expect(stale.artifact.artifactRevision).toBe(secondArtifact.binding.artifactRevision)
            expect(stale.current).toBe(false)
            expect(stale.review).toEqual(secondBefore.review.review)

            await switchWork(page, first)
            await openReview(page)
            await expectReviewFields(page, firstBefore.review)
            await expect(panel(page).locator('[data-slot="approved"]')).toBeVisible()
            const response = page.waitForResponse(
              (response) => response.url() === reviewUrl && response.request().method() === "POST",
            )
            await protocol.send("Fetch.continueRequest", { requestId: held.requestId })
            const rejected = await response
            await protocol.send("Fetch.disable")
            expect(rejected.status()).toBe(409)
            expect(await rejected.json()).toMatchObject({ _tag: "ConflictError", resource: "work-artifact" })
            expect(await checkpoint(first, firstArtifact.binding, testInfo, "first-after-peer-conflict")).toEqual(
              firstBefore,
            )
            await expectReviewFields(page, firstBefore.review)
            await expect(panel(page).locator('[data-slot="approved"]')).toBeVisible()
            await expect(panel(page).locator('[data-slot="notice"]')).toHaveCount(0)

            await switchWork(page, second)
            await openReview(page)
            const recovered = await checkpoint(second, stale.artifact, testInfo, "second-stale-readback")
            expect(recovered.review).toEqual(stale)
            expect(recovered.sqlite.policy).toEqual(secondBefore.sqlite.policy)
            await expectReviewFields(page, recovered.review)
            await expect(panel(page).locator('[data-slot="stale"]')).toBeVisible()
            await expect(panel(page).locator('[data-slot="approved"]')).toHaveCount(0)
            await transition(second, page, stale.artifact, { action: "re_review", state: "open", revision: 2 })
            await transition(second, page, stale.artifact, { action: "approve", state: "resolved", revision: 3 })
            const approved = await checkpoint(second, stale.artifact, testInfo, "second-rebound-approved")
            await page.reload()
            await expectSessionTitle(page, second.title)
            await openReview(page)
            await expectReviewFields(page, approved.review)
            await expect(panel(page).locator('[data-slot="approved"]')).toBeVisible()
            expect(await checkpoint(second, stale.artifact, testInfo, "second-after-reload")).toEqual(approved)
            expect(await checkpoint(first, firstArtifact.binding, testInfo, "first-after-peer-recovery")).toEqual(
              firstBefore,
            )
            expect(await providerCalls(request)).toEqual(calls)
            await testInfo.attach("e4-cross-backend-review", {
              body: JSON.stringify(
                {
                  sessionID: first.sessionID,
                  firstBackend: first.backend.backendUrl,
                  secondBackend: second.backend.backendUrl,
                  rejectedStatus: rejected.status(),
                  oldBinding: secondArtifact.binding,
                  currentBinding: stale.artifact,
                  providerCalls: calls,
                },
                null,
                2,
              ),
              contentType: "application/json",
            })
          } finally {
            protocol.off("Fetch.requestPaused", onPaused)
            await protocol.send("Fetch.disable")
            await protocol.detach()
          }
        },
        { backend: peer, sessionID: first.sessionID, title: "E4 Work review second backend" },
      )
    },
    { title: "E4 Work review first backend" },
  )
})

async function switchWork(page: Page, work: Work) {
  await page.locator('[data-slot="titlebar-tabs"]').getByRole("link").filter({ hasText: work.title }).click()
  await expect(page).toHaveURL(
    new RegExp(`/server/${base64Encode(work.backend.backendUrl)}/session/${work.sessionID}$`),
  )
  await expectSessionTitle(page, work.title)
  await expect(page.locator("html")).toHaveAttribute("data-e4-spa", "work-review-scope")
}

/** Own one fresh Location under the harness workspace, not another test's file. */
async function withWork(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  use: (work: Work) => Promise<void>,
  options?: { backend?: E4Backend; sessionID?: string; title?: string },
) {
  const manifest = e4()
  const backend = options?.backend ?? manifest
  const suffix = backend.backendUrl === manifest.backendUrl ? "" : "-peer"
  const directory = mkdtempSync(path.join(backend.workspaceDir, "e4-work-review-"))
  try {
    const health = await request.get(`${backend.backendUrl}/global/health`)
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({ healthy: true, version: backend.backendVersion })
    const disarmed = await request.post(`${new URL(e4().providerBaseURL).origin}/e4/provider-failures?count=0`)
    expect(disarmed.status()).toBe(200)
    const client = createAigcfrogeClient({ baseUrl: backend.backendUrl, directory, throwOnError: true })
    const title = options?.title ?? `E4 Work review ${testInfo.title.includes("R05") ? "recovery" : "lifecycle"}`
    const sessionID = await (async () => {
      if (options?.sessionID) {
        const created = await client.v2.session.create({
          id: options.sessionID,
          location: { directory },
          mode: "work",
          agent: "work-orchestrator",
          model: { providerID: "e4-real", id: "e4-deterministic" },
        })
        expect(created.response.status).toBe(200)
        expect(created.data?.data.id).toBe(options.sessionID)
        await client.session.update({ sessionID: options.sessionID, title })
        return options.sessionID
      }
      const created = await client.session.create({
        directory,
        mode: "work",
        agent: "work-orchestrator",
        model: { providerID: "e4-real", id: "e4-deterministic" },
        title,
      })
      expect(created.response.status).toBe(200)
      if (!created.data) throw new Error("Work Session creation returned no body")
      return created.data.id
    })()
    const work = { client, directory, title, sessionID, backend }
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
    seedRealBackend(page, manifest.backendUrl, manifest.peer ? [manifest.peer.backendUrl] : [])
    await page.goto(`/server/${base64Encode(backend.backendUrl)}/session/${work.sessionID}`)
    await expectSessionTitle(page, title)
    await use(work)
  } finally {
    try {
      const file = path.join(directory, "work-draft.md")
      if (existsSync(file)) {
        await testInfo.attach(`e4-provider-artifact${suffix}`, { path: file, contentType: "text/markdown" })
        await testInfo.attach(`e4-provider-artifact-sha256${suffix}`, {
          body: createHash("sha256").update(readFileSync(file)).digest("hex"),
          contentType: "text/plain",
        })
      }
      // SQLite's backup API captures committed WAL contents; copying only e4.sqlite
      // while the backend is alive could silently omit the very review being tested.
      const db = new DatabaseSync(backend.dbPath, { readOnly: true, timeout: 5_000 })
      const snapshot = testInfo.outputPath(`e4-work-review${suffix}.sqlite`)
      try {
        expect(await backup(db, snapshot)).toBeGreaterThan(0)
      } finally {
        db.close()
      }
      await testInfo.attach(`e4-work-review-sqlite${suffix}`, {
        path: snapshot,
        contentType: "application/vnd.sqlite3",
      })
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
        new URL(response.url()).origin === work.backend.backendUrl &&
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
      {
        backendUrl: work.backend.backendUrl,
        sessionID: work.sessionID,
        messageID: completed.info.id,
        calls: calls.slice(before.length),
      },
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
        new URL(response.url()).origin === work.backend.backendUrl &&
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
        new URL(response.url()).origin === work.backend.backendUrl &&
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
        new URL(response.url()).origin === work.backend.backendUrl &&
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
  const db = new DatabaseSync(work.backend.dbPath, { readOnly: true, timeout: 5_000 })
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
    const file = statSync(work.backend.dbPath)
    const evidence = {
      review,
      sqlite: {
        path: realpathSync(work.backend.dbPath),
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
      backendVersion: work.backend.backendVersion,
      backendUrl: work.backend.backendUrl,
    }
    await testInfo.attach(`e4-${label}`, { body: JSON.stringify(evidence, null, 2), contentType: "application/json" })
    return evidence
  } finally {
    db.close()
  }
}
