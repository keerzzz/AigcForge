/**
 * S6 E4 consumption chain: the status bar and composer read the real backend's
 * projection — no `page.route`, no mock. This is the spec that proves the App
 * consumption surface works against production behaviour, including the
 * refresh path (the bar must re-read after a reload rather than keep stale state).
 *
 * The permission tier is set through the session-create payload, which is the
 * remaining supported write path after the resident selector was deleted.
 */
import { expect, test } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { createAigcfrogeClient } from "@aigcfroge/sdk/v2/client"
import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { e4, seedRealBackend } from "./fixture"
import { isRecord } from "./manifest"
import { pinEnglishUI } from "../utils/locale"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const agentPicker = (page: import("@playwright/test").Page) => page.locator('[data-action="prompt-agent"]')
const permissionChip = (page: import("@playwright/test").Page) =>
  page.locator('[data-component="status-bar-permission"]')
const productHeader = (page: import("@playwright/test").Page) =>
  page.locator('[data-component="session-product-header"]')

test.skip(() => e4().v2Runtime, "consumer chain runs against the default backend")

test("the bar reads the real projection for a full-tier session and survives reload", async ({ page, request }) => {
  test.skip(!!e4().peer, "The single-backend consumer chain runs in the default topology")
  const e4m = e4()

  const created = await request.post(`${e4m.backendUrl}/session?directory=${encodeURIComponent(e4m.workspaceDir)}`, {
    headers: { "x-aigcfroge-directory": e4m.workspaceDir },
    data: {
      location: { directory: e4m.workspaceDir },
      title: "S6 identity consumers",
      agent: "build",
      model: { id: "gpt-test", providerID: "aigcfroge" },
      permissionTier: "full",
    },
  })
  expect(created.ok(), `session create: ${await created.text()}`).toBeTruthy()
  const body: unknown = await created.json()
  if (!isRecord(body) || typeof body.id !== "string") throw new Error("session create response has no id")

  seedRealBackend(page, e4m.backendUrl)
  const path = `/server/${base64Encode(e4m.backendUrl)}/session/${body.id}`
  await page.goto(path)

  // The bar's chip comes from `session.identity` against the real backend.
  const chip = permissionChip(page)
  await expectAppVisible(chip)
  await expect(chip).toHaveAttribute("data-kind", "full")

  // Reload re-reads it: a cached/stale chip would be indistinguishable here only
  // if it disagreed with the server, so assert the server's own answer too.
  const identity = await request.get(
    `${e4m.backendUrl}/session/${body.id}/identity?directory=${encodeURIComponent(e4m.workspaceDir)}`,
    { headers: { "x-aigcfroge-directory": e4m.workspaceDir } },
  )
  expect(identity.ok(), `identity: ${await identity.text()}`).toBeTruthy()
  const projected: unknown = await identity.json()
  if (!isRecord(projected) || !isRecord(projected.permission)) throw new Error("identity has no permission block")
  expect(projected.permission.declaredTier).toBe("full")
  if (
    typeof projected.mode !== "string" ||
    typeof projected.agent !== "string" ||
    !isRecord(projected.location) ||
    typeof projected.location.directory !== "string" ||
    !isRecord(projected.model) ||
    projected.model.status !== "ready" ||
    !isRecord(projected.model.value) ||
    typeof projected.model.value.providerID !== "string" ||
    typeof projected.model.value.modelID !== "string" ||
    !isRecord(projected.capability) ||
    typeof projected.capability.health !== "string"
  )
    throw new Error("identity has no complete common Header projection")

  const header = productHeader(page)
  await expectAppVisible(header)
  await expect(header).toHaveAttribute("data-mode", projected.mode)
  await expect(header).toHaveAttribute("data-health", projected.capability.health)
  await expect(header.locator('[data-field="location"]')).toHaveAttribute("title", projected.location.directory)
  await expect(header.locator('[data-field="agent"]')).toHaveText(projected.agent)
  await expect(header.locator('[data-field="model"]')).toHaveText(
    `${projected.model.value.providerID}/${projected.model.value.modelID}`,
  )

  await page.reload()
  await expectAppVisible(chip)
  await expect(chip).toHaveAttribute("data-kind", "full")
  await expectAppVisible(productHeader(page))
  await expect(productHeader(page)).toHaveAttribute("data-mode", projected.mode)
})

test("the agent picker renders against the real backend's agent list", async ({ page, request }) => {
  test.skip(!!e4().peer, "The single-backend picker runs in the default topology")
  const e4m = e4()
  const created = await request.post(`${e4m.backendUrl}/session?directory=${encodeURIComponent(e4m.workspaceDir)}`, {
    headers: { "x-aigcfroge-directory": e4m.workspaceDir },
    data: {
      location: { directory: e4m.workspaceDir },
      title: "S6 picker",
      agent: "build",
      model: { id: "gpt-test", providerID: "aigcfroge" },
    },
  })
  const body: unknown = await created.json()
  if (!isRecord(body) || typeof body.id !== "string") throw new Error("session create response has no id")

  seedRealBackend(page, e4m.backendUrl)
  await page.goto(`/server/${base64Encode(e4m.backendUrl)}/session/${body.id}`)

  // The picker's visibility no longer depends on a setting, and its options come
  // from the server's `primaryModes` projection.
  await expectAppVisible(agentPicker(page))
})

test("AI-TDD-S08: historical identity and review stay with their backend for a shared Session ID", async ({
  page,
  request,
}, testInfo) => {
  const manifest = e4()
  const peer = manifest.peer
  test.skip(!peer, "Requires E4_DUAL_BACKEND=1")
  if (!peer) throw new Error("The dual-backend manifest is missing its peer")
  expect(peer.backendUrl).not.toBe(manifest.backendUrl)
  expect(peer.dbPath).not.toBe(manifest.dbPath)
  expect(peer.workspaceDir).not.toBe(manifest.workspaceDir)

  const first = createAigcfrogeClient({
    baseUrl: manifest.backendUrl,
    directory: manifest.workspaceDir,
    throwOnError: true,
  })
  const second = createAigcfrogeClient({ baseUrl: peer.backendUrl, directory: peer.workspaceDir, throwOnError: true })
  const created = await first.session.create({
    title: "E4 current identity",
    mode: "work",
    agent: "work-orchestrator",
    model: { providerID: "e4-real", id: "e4-deterministic" },
    permissionTier: "full",
  })
  expect(created.response.status).toBe(200)
  if (!created.data) throw new Error("Session creation returned no body")
  const sessionID = created.data.id
  const historical = await second.v2.session.create({
    id: sessionID,
    location: { directory: peer.workspaceDir },
    mode: "work",
    agent: "work-orchestrator",
  })
  expect(historical.response.status).toBe(200)
  expect(historical.data?.data.id).toBe(sessionID)
  await second.session.update({ sessionID, title: "E4 historical identity" })

  // Reproduce the persisted pre-identity shape in this owned fixture only. This
  // tests reads of old data, not execution of a historical database migration.
  seedHistoricalIdentity(peer.dbPath, sessionID)

  const artifactPath = path.join(manifest.workspaceDir, "identity-evidence.md")
  expect(existsSync(artifactPath)).toBe(false)
  try {
    const applied = await first.workArtifact.apply({
      sessionID,
      title: "identity-evidence.md",
      relativePath: "identity-evidence.md",
      content: "Synthetic artifact owned by the first backend.",
      overwrite: false,
    })
    expect(applied.response.status).toBe(200)
    const unreviewed = await first.v2.session.workReview.get({ sessionID })
    if (unreviewed.data?.data.status !== "none" || !unreviewed.data.data.artifact) {
      throw new Error("The applied artifact has no review binding")
    }
    const binding = unreviewed.data.data.artifact
    for (const [index, action] of ["submit", "approve"].entries()) {
      const response = await request.post(`${manifest.backendUrl}/api/session/${sessionID}/work-review`, {
        data: {
          action,
          expectedReviewRevision: index,
          artifactID: binding.artifactID,
          expectedArtifactRevision: binding.artifactRevision,
        },
      })
      expect(response.status()).toBe(200)
    }
    const approved = await first.v2.session.workReview.get({ sessionID })
    expect(approved.data?.data).toMatchObject({
      status: "ready",
      current: true,
      review: { state: "resolved", revision: 2 },
    })
    expect((await second.v2.session.workReview.get({ sessionID })).data?.data).toEqual({ status: "none" })

    const currentIdentity = await first.session.identity({ sessionID })
    const oldIdentity = await second.session.identity({ sessionID })
    expect(currentIdentity.data).toMatchObject({
      sessionID,
      location: { directory: manifest.workspaceDir },
      model: { status: "ready", value: { providerID: "e4-real", modelID: "e4-deterministic" } },
      permission: { declaredTier: "full" },
    })
    expect(oldIdentity.data).toMatchObject({
      sessionID,
      location: { directory: peer.workspaceDir },
      model: { status: "missing" },
      permission: { declaredTier: "propose" },
      detail: {
        status: "ready",
        detail: { source: "work", contract: { source: "ad-hoc" }, artifact: { status: "missing" } },
      },
    })

    await pinEnglishUI(page)
    seedRealBackend(page, manifest.backendUrl, [peer.backendUrl])
    const panel = page.locator('[data-component="work-review-panel"]')
    const openReview = async () => {
      if (!(await panel.isVisible())) await page.locator('button[data-action="work-review-open"]').click()
      await expect(panel).toBeVisible()
    }
    await page.goto(`/server/${base64Encode(manifest.backendUrl)}/session/${sessionID}`)
    await expectSessionTitle(page, "E4 current identity")
    await expect(permissionChip(page)).toHaveAttribute("data-kind", "full")
    await expect(productHeader(page).locator('[data-field="model"]')).toHaveText("e4-real/e4-deterministic")
    await openReview()
    await expect(panel.locator('[data-slot="approved"]')).toBeVisible()
    await expect(panel.locator('[data-field="current-artifact-id"]')).toHaveText(binding.artifactID)

    await page.goto(`/server/${base64Encode(peer.backendUrl)}/session/${sessionID}`)
    await expectSessionTitle(page, "E4 historical identity")
    await expect(permissionChip(page)).toHaveCount(0)
    await expect(productHeader(page).locator('[data-field="model"]')).toHaveText("Missing")
    await expect(productHeader(page).locator('[data-field="location"]')).toHaveAttribute("title", peer.workspaceDir)
    await openReview()
    await expect(panel).toHaveAttribute("data-review-status", "none")
    await expect(panel.locator('[data-slot="approved"]')).toHaveCount(0)
    await expect(panel.locator('[data-field="current-artifact-id"]')).toHaveCount(0)
    await page.reload()
    await expectSessionTitle(page, "E4 historical identity")
    await expect(productHeader(page).locator('[data-field="model"]')).toHaveText("Missing")
    await expect(permissionChip(page)).toHaveCount(0)
    await openReview()
    await expect(panel).toHaveAttribute("data-review-status", "none")

    await page.locator("html").evaluate((element) => element.setAttribute("data-e4-spa", "historical-identity"))
    const switchBackend = async (title: string, backendUrl: string) => {
      await page.locator('[data-slot="titlebar-tabs"]').getByRole("link").filter({ hasText: title }).click()
      await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(backendUrl)}/session/${sessionID}$`))
      await expectSessionTitle(page, title)
      await expect(page.locator("html")).toHaveAttribute("data-e4-spa", "historical-identity")
    }
    await switchBackend("E4 current identity", manifest.backendUrl)
    await expect(permissionChip(page)).toHaveAttribute("data-kind", "full")
    await expect(productHeader(page).locator('[data-field="model"]')).toHaveText("e4-real/e4-deterministic")
    await openReview()
    await expect(panel.locator('[data-slot="approved"]')).toBeVisible()
    await expect(panel.locator('[data-field="current-artifact-id"]')).toHaveText(binding.artifactID)
    await switchBackend("E4 historical identity", peer.backendUrl)
    await expect(permissionChip(page)).toHaveCount(0)
    await openReview()
    await expect(panel).toHaveAttribute("data-review-status", "none")
    await expect(panel.locator('[data-slot="approved"]')).toHaveCount(0)

    seedHistoricalIdentity(peer.dbPath, sessionID, true)
    const rejected = await request.get(`${peer.backendUrl}/session/${sessionID}/identity`)
    expect(rejected.status()).toBe(400)
    expect(await rejected.json()).toMatchObject({
      _tag: "InvalidRequestError",
      message: `Session ${sessionID} has no resolvable agent`,
    })
    await page.reload()
    await expectSessionTitle(page, "E4 historical identity")
    await expect(productHeader(page)).toHaveAttribute("data-state", "unavailable")
    await expect(permissionChip(page)).toHaveAttribute("data-kind", "degraded")
    expect((await first.session.identity({ sessionID })).data).toEqual(currentIdentity.data)
    expect((await first.v2.session.workReview.get({ sessionID })).data).toEqual(approved.data)
    expect((await second.v2.session.workReview.get({ sessionID })).data?.data).toEqual({ status: "none" })
    await testInfo.attach("e4-historical-identity-scope", {
      body: JSON.stringify(
        {
          sessionID,
          current: currentIdentity.data,
          historical: oldIdentity.data,
          rejectedStatus: rejected.status(),
          review: approved.data,
        },
        null,
        2,
      ),
      contentType: "application/json",
    })
  } finally {
    // Only remove the artifact created by this test in the owned harness workspace.
    rmSync(artifactPath, { force: true })
  }
})

function seedHistoricalIdentity(dbPath: string, sessionID: string, missingAgent = false) {
  const database = new DatabaseSync(dbPath, { timeout: 5_000 })
  try {
    const statement = missingAgent
      ? "UPDATE session SET agent = NULL WHERE id = ?"
      : "UPDATE session SET model = NULL, metadata = json_remove(metadata, '$.workContract') WHERE id = ?"
    expect(database.prepare(statement).run(sessionID).changes).toBe(1)
  } finally {
    database.close()
  }
}
