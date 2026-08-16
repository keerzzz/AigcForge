import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/Aigcfroge/PermissionTierRegression"
const projectID = "proj_permission_tier_regression"

const provider = {
  all: [
    {
      id: "aigcfroge",
      name: "Aigcfroge",
      models: {
        "tier-model": { id: "tier-model", name: "Tier Model", limit: { context: 200_000 } },
      },
    },
  ],
  connected: ["aigcfroge"],
  default: { providerID: "aigcfroge", modelID: "tier-model" },
}

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "permission-tier-regression",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

function session(overrides: Record<string, unknown> & { id: string }) {
  return {
    slug: "permission-tier-regression",
    projectID,
    directory,
    title: "Permission tier regression",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
    ...overrides,
  }
}

interface PermissionWire {
  tierPuts: Record<string, unknown>[]
  overridePuts: Record<string, unknown>[]
  overrideDeletes: number
  enabled: boolean
  tierPutStatus: number
}

// 在 mockAigcfrogeServer 之后注册（Playwright 后注册路由优先）：捕获
// session.update 的档位 payload 与 permission-override 的启用/关闭往返。
async function mockPermissionRoutes(page: Page, wire: PermissionWire) {
  await page.route("**/session/*", async (route: Route) => {
    const url = new URL(route.request().url())
    // session.update 走 PATCH /session/:id（sdk.gen），非 PATCH 交回 mock server。
    if (url.pathname.match(/^\/session\/[^/]+$/) && route.request().method() === "PATCH") {
      wire.tierPuts.push(route.request().postDataJSON() ?? {})
      return route.fulfill({
        status: wire.tierPutStatus,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(wire.tierPutStatus === 200 ? {} : { error: "Permission tier is only available for root sessions" }),
      })
    }
    return route.fallback()
  })
  await page.route("**/session/*/permission-override", async (route: Route) => {
    const method = route.request().method()
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ enabled: wire.enabled }),
      })
    }
    if (method === "PUT") {
      wire.overridePuts.push(route.request().postDataJSON() ?? {})
      wire.enabled = true
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ enabled: true }),
      })
    }
    if (method === "DELETE") {
      wire.overrideDeletes += 1
      wire.enabled = false
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({}),
      })
    }
    return route.fallback()
  })
}

async function openSession(page: Page, wire: PermissionWire, sessionData: ReturnType<typeof session>) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [sessionData],
    pageMessages: () => ({ items: [] }),
  })
  await mockPermissionRoutes(page, wire)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionData.id}`)
  const composer = page.locator('[data-component="session-composer"]')
  await expectAppVisible(composer)
  return composer
}

test("chat meta session shows the tier selector with propose active by default", async ({ page }) => {
  const wire: PermissionWire = { tierPuts: [], overridePuts: [], overrideDeletes: 0, enabled: false, tierPutStatus: 200 }
  await openSession(page, wire, session({ id: "ses_tier_chat_default", mode: "chat", agent: "meta" }))

  const selector = page.locator('[data-slot="permission-tier-selector"]')
  await expectAppVisible(selector)
  await expect(selector).toContainText("Permission tier")
  await expect(selector.locator('[data-slot="permission-tier-option"][data-value="propose"]')).toHaveAttribute(
    "data-active",
    "true",
  )
  await expect(selector.locator('[data-slot="permission-tier-option"][data-value="full"]')).toHaveAttribute(
    "data-active",
    "false",
  )
})

test("coding session hides the tier selector", async ({ page }) => {
  const wire: PermissionWire = { tierPuts: [], overridePuts: [], overrideDeletes: 0, enabled: false, tierPutStatus: 200 }
  await openSession(page, wire, session({ id: "ses_tier_coding_hidden", mode: "coding", agent: "meta" }))

  await expect(page.locator('[data-slot="permission-tier-selector"]')).toHaveCount(0)
})

test("work session shows the tier selector", async ({ page }) => {
  const wire: PermissionWire = { tierPuts: [], overridePuts: [], overrideDeletes: 0, enabled: false, tierPutStatus: 200 }
  await openSession(page, wire, session({ id: "ses_tier_work_visible", mode: "work", agent: "meta" }))

  await expectAppVisible(page.locator('[data-slot="permission-tier-selector"]'))
})

test("switching to full sends permissionTier through the session update", async ({ page }) => {
  const wire: PermissionWire = { tierPuts: [], overridePuts: [], overrideDeletes: 0, enabled: false, tierPutStatus: 200 }
  await openSession(page, wire, session({ id: "ses_tier_switch_full", mode: "chat", agent: "meta" }))

  await page.locator('[data-slot="permission-tier-option"][data-value="full"]').click()
  await expect
    .poll(() => wire.tierPuts.filter((body) => body.permissionTier === "full").length, { timeout: 10_000 })
    .toBeGreaterThan(0)
})

test("override control requires acknowledgement before enabling and round-trips enable/disable", async ({ page }) => {
  const wire: PermissionWire = { tierPuts: [], overridePuts: [], overrideDeletes: 0, enabled: false, tierPutStatus: 200 }
  await openSession(page, wire, session({ id: "ses_tier_override_flow", mode: "chat", agent: "meta" }))

  // 初始：GET 返回 enabled:false → 显示启用按钮
  await expectAppVisible(page.locator('[data-slot="permission-override-enable"]'))
  await page.locator('[data-slot="permission-override-enable"]').click()

  // 二次确认：勾选前「启用」禁用（ui Dialog 无 role=dialog，用 data-slot 定位）
  const ack = page.locator('[data-slot="permission-override-acknowledge"]')
  await expectAppVisible(ack)
  const confirm = page
    .locator('[data-slot="permission-override-confirm-actions"] button')
    .filter({ hasText: "Enable" })
  await expect(confirm).toBeDisabled()
  await ack.check()
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // 首次启用必须带 acknowledged:true，成功后按钮翻转为关闭
  await expect
    .poll(() => wire.overridePuts.filter((body) => body.acknowledged === true).length, { timeout: 10_000 })
    .toBeGreaterThan(0)
  await expectAppVisible(page.locator('[data-slot="permission-override-disable"]'))

  // 关闭：DELETE 一次，回到启用按钮
  await page.locator('[data-slot="permission-override-disable"]').click()
  await expect
    .poll(() => wire.overrideDeletes, { timeout: 10_000 })
    .toBeGreaterThan(0)
  await expectAppVisible(page.locator('[data-slot="permission-override-enable"]'))
})

test("unattended session hides the override control", async ({ page }) => {
  const wire: PermissionWire = { tierPuts: [], overridePuts: [], overrideDeletes: 0, enabled: false, tierPutStatus: 200 }
  await openSession(page, wire, session({ id: "ses_tier_unattended", mode: "chat", agent: "meta", attended: false }))

  await expect(page.locator('[data-slot="permission-override-control"]')).toHaveCount(0)
})
