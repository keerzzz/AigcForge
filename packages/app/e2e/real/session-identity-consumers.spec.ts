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
import { e4, seedRealBackend } from "./fixture"
import { isRecord } from "./manifest"
import { expectAppVisible } from "../utils/waits"

const agentPicker = (page: import("@playwright/test").Page) => page.locator('[data-action="prompt-agent"]')
const permissionChip = (page: import("@playwright/test").Page) =>
  page.locator('[data-component="status-bar-permission"]')
const productHeader = (page: import("@playwright/test").Page) =>
  page.locator('[data-component="session-product-header"]')

test.skip(() => e4().v2Runtime, "consumer chain runs against the default backend")

test("the bar reads the real projection for a full-tier session and survives reload", async ({ page, request }) => {
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
