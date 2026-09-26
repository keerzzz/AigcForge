import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { pinEnglishUI } from "../utils/locale"
import { PRESENTATION_EXPECTED } from "../presentation-matrix"

// Business cases use English labels; presentation cases must retain the matrix locale.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.tags.includes("@presentation")) return
  await pinEnglishUI(page)
})

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
  overrideFailure?: "PUT" | "DELETE"
  overrideGets?: number
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
  await page.route("**/session/*/permission-override*", async (route: Route) => {
    const method = route.request().method()
    if (method === wire.overrideFailure) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "Override update failed" }),
      })
    }
    if (method === "GET") {
      wire.overrideGets = (wire.overrideGets ?? 0) + 1
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

test("break-glass override control round-trips enable/disable via the composer shield", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_override_flow", mode: "chat", agent: "meta" }))

  // Remove resident permission text while retaining the reversible shield control.
  await expect(page.locator('[data-slot="permission-control-surface"]')).toHaveCount(0)

  await expectAppVisible(page.locator('[data-slot="permission-override-enable"]'))
  await page.locator('[data-slot="permission-override-enable"]').click()

  const ack = page.locator('[data-slot="permission-override-acknowledge"]')
  await expectAppVisible(ack)
  const confirm = page.locator('[data-slot="permission-override-confirm-actions"] button').filter({ hasText: "Enable" })
  await expect(confirm).toBeDisabled()
  await ack.check()
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect
    .poll(() => wire.overridePuts.filter((body) => body.acknowledged === true).length, { timeout: 10_000 })
    .toBeGreaterThan(0)
  await expectAppVisible(page.locator('[data-slot="permission-override-disable"]'))

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

// Plan §9.2/O-4.1 + opencode parity: the resident tier mutation entry
// ("提议 / 更改权限档位") was reintroduced above the composer by a01dc6eb5
// and is the noise this file now guards against. The tier write path survives via
// the session-create payload (e2e/real/session-identity-consumers.spec.ts) and the
// permission owner (src/context/permission-override.test.ts); it is not resident here.
test("no resident tier mutation entry above the composer (opencode parity)", async ({ page }) => {
  const wire: PermissionWire = {
    tierPuts: [],
    overridePuts: [],
    overrideDeletes: 0,
    enabled: false,
    tierPutStatus: 200,
  }
  await openSession(page, wire, session({ id: "ses_tier_entry_roundtrip", mode: "chat", agent: "meta" }))

  await expect(page.locator('[data-slot="permission-tier-control"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="permission-tier-toggle"]')).toHaveCount(0)
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

test(
  "composer permission shield stays beside attach and turns critical when enabled",
  { tag: "@presentation" },
  async ({ page }, testInfo) => {
    const wire: PermissionWire = {
      tierPuts: [],
      overridePuts: [],
      overrideDeletes: 0,
      enabled: false,
      tierPutStatus: 200,
    }
    await openSession(page, wire, session({ id: "ses_shield_presentation", mode: "chat", agent: "meta" }))
    const presentation = PRESENTATION_EXPECTED[testInfo.project.name]
    if (!presentation) throw new Error(`Unexpected presentation project: ${testInfo.project.name}`)
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", presentation.colorScheme)
    await expect(page.locator("html")).toHaveAttribute("lang", presentation.lang)

    const attach = page.locator('[data-action="prompt-attach"]')
    const shield = page.locator('[data-slot="permission-override-enable"]')
    await expect(attach).toBeVisible()
    await expect(shield).toBeVisible()
    const attachBox = await attach.boundingBox()
    const shieldBox = await shield.boundingBox()
    if (!attachBox || !shieldBox) throw new Error("Composer controls have no visible bounds")
    expect(shieldBox.x).toBeGreaterThanOrEqual(attachBox.x + attachBox.width)
    expect(shieldBox.x - attachBox.x - attachBox.width).toBeLessThan(attachBox.width)
    expect(shieldBox.y).toBeLessThan(attachBox.y + attachBox.height)
    expect(attachBox.y).toBeLessThan(shieldBox.y + shieldBox.height)
    await expect(shield).toHaveText("")
    await expect(page.locator('[data-slot="permission-control-surface"]')).toHaveCount(0)
    await attach.focus()
    await page.keyboard.press("Tab")
    await expect(shield).toBeFocused()
    await page.keyboard.press("Enter")
    const confirm = page.locator('[data-slot="permission-override-confirm-actions"] button').last()
    await expect(confirm).toBeDisabled()
    await page.locator('[data-slot="permission-override-acknowledge"]').check()
    await confirm.click()

    const active = page.locator('[data-slot="permission-override-disable"]')
    await expect(active).toBeVisible()
    const critical = await active.evaluate((button) => {
      const probe = document.createElement("span")
      probe.style.color = "var(--icon-critical-base)"
      button.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    })
    // Assert the SVG's computed color, not a class on its parent: IconButton styles the SVG directly.
    await expect(active.locator('[data-slot="icon-svg"]')).toHaveCSS("color", critical)
    await expect(active.locator('[data-slot="icon-svg"]')).toHaveCSS("fill", critical)
    await expect(active).toHaveAttribute("aria-pressed", "true")
    await page.screenshot({ path: testInfo.outputPath("permission-shield-active.png") })
    await active.focus()
    await page.keyboard.press("Enter")
    await expect(shield).toBeVisible()
    await expect(shield).toHaveAttribute("aria-pressed", "false")
    expect(wire.overrideDeletes).toBe(1)
  },
)

for (const method of ["PUT", "DELETE"] as const) {
  test(`failed override ${method} preserves permission state and reports the error`, async ({ page }) => {
    const wire: PermissionWire = {
      tierPuts: [],
      overridePuts: [],
      overrideDeletes: 0,
      enabled: method === "DELETE",
      tierPutStatus: 200,
      overrideFailure: method,
    }
    await openSession(page, wire, session({ id: `ses_override_failure_${method}`, mode: "work", agent: "build" }))
    const control = page.locator(`[data-slot="permission-override-${method === "PUT" ? "enable" : "disable"}"]`)
    await expect.poll(() => wire.overrideGets ?? 0).toBeGreaterThan(0)
    await expect(control).toBeVisible()
    await control.click()
    if (method === "PUT") {
      await page.locator('[data-slot="permission-override-acknowledge"]').check()
      await page.locator('[data-slot="permission-override-confirm-actions"] button').last().click()
    }
    await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
    await expect(control).toBeVisible()
    expect(wire.enabled).toBe(method === "DELETE")
  })
}
