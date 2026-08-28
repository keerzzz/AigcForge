import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/Aigcfroge/ApprovalCenterRegression"
const projectID = "proj_approval_center_regression"
const sessionID = "ses_approval_center_regression"
const title = "Approval center regression"
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-aigcfroge-directory,x-aigcfroge-workspace",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}

type Pending = {
  id: string
  sessionID: string
  action: string
  resources: string[]
}

type Write = {
  path: string
  body: unknown
}

type ApprovalWire = {
  pending: Pending[]
  pendingStatus?: number
  waitForPending?: Promise<void>
  reads: string[]
  replies: Write[]
  grants: Write[]
  legacyWrites: Write[]
}

function pending(id: string, action: string, resources: string[]): Pending {
  return { id, sessionID, action, resources }
}

function session() {
  return {
    id: sessionID,
    slug: "approval-center-regression",
    projectID,
    directory,
    title,
    mode: "chat",
    agent: "meta",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "approval-center-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function provider() {
  return {
    all: [
      {
        id: "aigcfroge",
        name: "Aigcfroge",
        models: {
          "approval-model": { id: "approval-model", name: "Approval Model", limit: { context: 200_000 } },
        },
      },
    ],
    connected: ["aigcfroge"],
    default: { providerID: "aigcfroge", modelID: "approval-model" },
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: cors,
    body: JSON.stringify(body),
  })
}

async function mockApprovalRoutes(page: Page, wire: ApprovalWire) {
  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const isPending = path === "/api/permission/request"
    const decision = path.match(/^\/api\/session\/[^/]+\/permission\/[^/]+\/(reply|grant)$/)
    const legacy = path.match(/^\/session\/[^/]+\/permissions\/[^/]+$/)

    if (!isPending && !decision && !legacy) return route.fallback()
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })

    if (legacy && method === "POST") {
      wire.legacyWrites.push({ path, body: request.postDataJSON() })
      return fulfillJson(route, {})
    }

    if (isPending && method === "GET") {
      wire.reads.push(request.url())
      await wire.waitForPending
      if (wire.pendingStatus && wire.pendingStatus !== 200) {
        return fulfillJson(route, { message: "pending bootstrap failed" }, wire.pendingStatus)
      }
      return fulfillJson(route, {
        location: { directory },
        data: wire.pending,
      })
    }

    if (!decision || method !== "POST") return route.fallback()
    const write = { path, body: request.postDataJSON() }
    if (decision[1] === "reply") {
      wire.replies.push(write)
      return route.fulfill({ status: 204, headers: cors, body: "" })
    }
    wire.grants.push(write)
    return fulfillJson(route, {})
  })
}

async function mountApp(page: Page, wire: ApprovalWire, href: string) {
  await mockAigcfrogeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [] }),
  })
  // Playwright resolves routes last-in-first-out. Register the narrow V2 routes
  // after the shared catch-all so the test exercises the generated SDK URLs.
  await mockApprovalRoutes(page, wire)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(href)
}

async function openSession(page: Page, wire: ApprovalWire) {
  await mountApp(page, wire, `/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: title }))
}

// `/mode/:mode` sits outside SDKProvider/DirectoryDataProvider, so the approval
// surface only appears there if ModeWorkspace passes its resolved directory
// accessors in. Before that wiring the route rendered no trigger at all while
// the server still counted the App's global SSE stream as an available
// responder, so an `ask` parked for the full TTL with nothing to answer it.
//
// The session route is visited first on purpose: that is both how a user reaches
// the workspace (open a session, navigate back while the agent keeps working)
// and what lets `useModeDirectory()` resolve a directory, matching
// builder-mcp-health.spec.ts.
async function openModeWorkspace(page: Page, wire: ApprovalWire, mode: string) {
  await openSession(page, wire)
  await page.goto(`/mode/${mode}`)
  await expectAppVisible(page.locator("[data-mode-workspace]"))
}

// `/` is the default landing route and had the same gap as `/mode/:mode`: the
// portal target exists there, but nothing mounted the surface, so a user idling
// on the home overview could not answer an approval while the server still
// counted them as a responder. Same two-step entry, for the same reason.
async function openHomeOverview(page: Page, wire: ApprovalWire) {
  await openSession(page, wire)
  await page.goto("/")
  await expectAppVisible(page.locator('[data-component="home-overview"]'))
}

function wire(overrides: Partial<ApprovalWire> = {}): ApprovalWire {
  return {
    pending: [],
    reads: [],
    replies: [],
    grants: [],
    legacyWrites: [],
    ...overrides,
  }
}

const trigger = (page: Page) => page.locator('[data-slot="approval-center-trigger"]')
const dialog = (page: Page) => page.locator('[data-component="dialog-v2"]')

test.describe("regression: Location approval center", () => {
  test("shows the current Location count and sends Once through the V2 reply endpoint", async ({ page }) => {
    const state = wire({
      pending: [
        pending("req_2", "write", ["C:/Aigcfroge/ApprovalCenterRegression/second.ts"]),
        pending("req_1", "bash", ["bun test", "C:/Aigcfroge/ApprovalCenterRegression/package.json"]),
      ],
    })
    await openSession(page, state)

    await expect(trigger(page)).toHaveAttribute("aria-label", "Pending approvals: 2")
    await expect(trigger(page)).toContainText("2")
    expect(state.reads).toHaveLength(1)
    const pendingUrl = new URL(state.reads[0]!)
    expect(pendingUrl.searchParams.get("location[directory]")).toBe(directory)

    await trigger(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).locator('[data-slot="approval-center-action"]')).toHaveText("bash")
    await expect(dialog(page).locator('[data-slot="approval-center-resources"]')).toContainText("bun test")
    await expect(dialog(page).locator('[data-slot="approval-center-resources"]')).toContainText(
      "C:/Aigcfroge/ApprovalCenterRegression/package.json",
    )

    await dialog(page).locator('[data-slot="approval-center-once"]').click()
    await expect.poll(() => state.replies.length).toBe(1)
    expect(state.replies[0]).toEqual({
      path: `/api/session/${sessionID}/permission/req_1/reply`,
      body: { reply: "once" },
    })
    expect(state.grants).toEqual([])
    expect(state.legacyWrites).toEqual([])
  })

  for (const level of ["session", "location"] as const) {
    test(`sends ${level} approval through the scoped grant endpoint`, async ({ page }) => {
      const state = wire({ pending: [pending(`req_${level}`, "write", ["src/index.ts"])] })
      await openSession(page, state)

      await expectAppVisible(trigger(page))
      await trigger(page).click()
      await expect(dialog(page)).toBeVisible()
      await dialog(page).locator(`[data-slot="approval-center-${level}-scope"]`).click()

      await expect.poll(() => state.grants.length).toBe(1)
      expect(state.grants[0]).toEqual({
        path: `/api/session/${sessionID}/permission/req_${level}/grant`,
        body: { level },
      })
      expect(state.replies).toEqual([])
      expect(state.legacyWrites).toEqual([])
    })
  }

  test("does not render an empty state as a pending approval", async ({ page }) => {
    const state = wire()
    await openSession(page, state)

    await expect.poll(() => state.reads.length).toBe(1)
    await expect(trigger(page)).toHaveCount(0)
    await expect(dialog(page)).toHaveCount(0)
  })

  test("does not claim pending approvals while the Location bootstrap is loading", async ({ page }) => {
    let release!: () => void
    const waitForPending = new Promise<void>((resolve) => {
      release = resolve
    })
    const state = wire({
      pending: [pending("req_loading", "bash", ["bun test"])],
      waitForPending,
    })

    try {
      await openSession(page, state)
      await expect.poll(() => state.reads.length).toBe(1)
      await expect(trigger(page)).toHaveCount(0)
    } finally {
      release()
    }

    await expect(trigger(page)).toHaveAttribute("aria-label", "Pending approvals: 1")
  })

  test("fails closed when the Location pending bootstrap errors", async ({ page }) => {
    const state = wire({ pendingStatus: 500 })
    const failedRead = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/permission/request" &&
        response.request().method() === "GET" &&
        response.status() === 500,
    )
    await openSession(page, state)
    await failedRead

    await expect(trigger(page)).toHaveCount(0)
    await expect(dialog(page)).toHaveCount(0)
    expect(state.replies).toEqual([])
    expect(state.grants).toEqual([])
    expect(state.legacyWrites).toEqual([])
  })

  // Custom mode is the primary source of V2 approvals and its home route is
  // /mode/custom, so this route carrying the surface is the load-bearing case.
  for (const mode of ["custom", "chat"] as const) {
    test(`answers a pending approval from the ${mode} mode workspace route`, async ({ page }) => {
      const state = wire({ pending: [pending("req_mode", "bash", ["bun test"])] })
      await openModeWorkspace(page, state, mode)

      await expect(trigger(page)).toHaveAttribute("aria-label", "Pending approvals: 1")
      expect(new URL(state.reads[0]!).searchParams.get("location[directory]")).toBe(directory)

      await trigger(page).click()
      await expect(dialog(page)).toBeVisible()
      await expect(dialog(page).locator('[data-slot="approval-center-action"]')).toHaveText("bash")

      await dialog(page).locator('[data-slot="approval-center-once"]').click()
      await expect.poll(() => state.replies.length).toBe(1)
      expect(state.replies[0]).toEqual({
        path: `/api/session/${sessionID}/permission/req_mode/reply`,
        body: { reply: "once" },
      })
      expect(state.legacyWrites).toEqual([])
    })
  }

  test("answers a pending approval from the global home overview route", async ({ page }) => {
    const state = wire({ pending: [pending("req_home", "write", ["src/index.ts"])] })
    await openHomeOverview(page, state)

    await expect(trigger(page)).toHaveAttribute("aria-label", "Pending approvals: 1")

    await trigger(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).locator('[data-slot="approval-center-action"]')).toHaveText("write")

    await dialog(page).locator('[data-slot="approval-center-location-scope"]').click()
    await expect.poll(() => state.grants.length).toBe(1)
    expect(state.grants[0]).toEqual({
      path: `/api/session/${sessionID}/permission/req_home/grant`,
      body: { level: "location" },
    })
    expect(state.replies).toEqual([])
    expect(state.legacyWrites).toEqual([])
  })

  test("does not render a trigger on the mode workspace when nothing is pending", async ({ page }) => {
    const state = wire()
    await openModeWorkspace(page, state, "custom")

    await expect(trigger(page)).toHaveCount(0)
    await expect(dialog(page)).toHaveCount(0)
  })
})
