import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"

// English-label spec — pin the UI language so the zh projects stay green (see utils/locale.ts).
test.beforeEach(({ page }) => pinEnglishUI(page))

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
        body: JSON.stringify(
          wire.tierPutStatus === 200 ? {} : { error: "Permission tier is only available for root sessions" },
        ),
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

// Child sessions render the child-disabled block instead of `PromptInput`,
// so the default `session-composer` anchor (which PromptInput owns) never
// appears for them. `ready` lets a child-session case anchor on the composer
// region wrapper instead — a real readiness signal, not a relaxed assertion.
async function openSession(
  page: Page,
  wire: PermissionWire,
  sessionData: ReturnType<typeof session>,
  ready = '[data-component="session-composer"]',
  extraSessions: ReturnType<typeof session>[] = [],
) {
  await mockAigcfrogeServer(page, {
    directory,
    project,
    provider,
    sessions: [sessionData, ...extraSessions],
    pageMessages: () => ({ items: [] }),
  })
  await mockPermissionRoutes(page, wire)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionData.id}`)
  const composer = page.locator(ready)
  await expectAppVisible(composer)
  return composer
}

// Plan §9.2 / O-4.1: the resident tier selector is deleted. Permission state is
// projected in the global status bar now (see session-identity-consumers.spec.ts
// for the propose-silent / full-warning assertions), and the tier's remaining write
// path is the session-create payload, covered end to end in
// e2e/real/session-identity-consumers.spec.ts. What this file still guards is that
// the resident control does not come back, for the two session shapes that used to
// differ, plus the override control's own lifecycle below.
test("chat meta session no longer carries a resident tier selector", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_chat_default", mode: "chat", agent: "meta" }))

  await expect(page.locator('[data-slot="permission-tier-selector"]')).toHaveCount(0)
  // A control that silently returned to the composer would re-introduce the noise
  // §9.2 removed; the assertion above is the guard.
})

test("coding session carries no resident tier selector either", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_coding_hidden", mode: "coding", agent: "meta" }))

  await expect(page.locator('[data-slot="permission-tier-selector"]')).toHaveCount(0)
})

test("work session carries no resident tier selector either", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_work_visible", mode: "work", agent: "meta" }))

  await expect(page.locator('[data-slot="permission-tier-selector"]')).toHaveCount(0)
})

test("override control requires acknowledgement before enabling and round-trips enable/disable", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_override_flow", mode: "chat", agent: "meta" }))

  // 初始：GET 返回 enabled:false → 显示启用按钮
  await expectAppVisible(page.locator('[data-slot="permission-override-enable"]'))
  await page.locator('[data-slot="permission-override-enable"]').click()

  // 二次确认：勾选前「启用」禁用（ui Dialog 无 role=dialog，用 data-slot 定位）
  const ack = page.locator('[data-slot="permission-override-acknowledge"]')
  await expectAppVisible(ack)
  const confirm = page.locator('[data-slot="permission-override-confirm-actions"] button').filter({ hasText: "Enable" })
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
  await expect.poll(() => wire.overrideDeletes, { timeout: 10_000 }).toBeGreaterThan(0)
  await expectAppVisible(page.locator('[data-slot="permission-override-enable"]'))
})

test("unattended session hides the override control", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_unattended", mode: "chat", agent: "meta", attended: false }))

  await expect(page.locator('[data-slot="permission-override-control"]')).toHaveCount(0)
})

// S12 shared permission control surface (plan 6.8): the tier mutation entry
// rides the same owner as the break-glass lease. It is a deliberate control
// (`permission-tier-control`), NOT the resident selector that 9.2/O-4.1 removed
// (asserted above), and it round-trips PATCH /session/:id { permissionTier }.
test("tier mutation entry round-trips through the shared permission owner", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_entry_roundtrip", mode: "chat", agent: "meta" }))

  await expectAppVisible(page.locator('[data-slot="permission-tier-control"]'))
  await page.locator('[data-slot="permission-tier-toggle"]').click()

  await expect.poll(() => wire.tierPuts.length, { timeout: 10_000 }).toBeGreaterThan(0)
  expect(wire.tierPuts[0]?.permissionTier).toBe("full")
})

test("tier mutation entry is hidden for child sessions", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  // Two facts decide this case's anchors, both measured:
  // 1. A child route with no parent renders the parent-not-found guard, so the
  //    parent must exist in the mock for the child-disabled path to render.
  // 2. A child does not render `PromptInput`, so `session-composer` never
  //    appears for it; the always-rendered composer wrapper is the readiness
  //    signal. Asserting the tier control is absent is the actual contract.
  await openSession(
    page,
    wire,
    session({ id: "ses_tier_entry_child", mode: "chat", agent: "meta", parentID: "ses_parent" }),
    '[data-component="session-prompt-dock"]',
    [session({ id: "ses_parent", mode: "chat", agent: "meta" })],
  )

  await expect(page.locator('[data-slot="permission-tier-control"]')).toHaveCount(0)
})
