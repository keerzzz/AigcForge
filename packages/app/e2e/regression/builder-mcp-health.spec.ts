import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * Builder MCP health surface (M3 Phase F4b).
 *
 * The kill switch is server-side only — the app decides "disabled" from the
 * plan endpoint's error text (`custom-preview-column.tsx`), so a mocked plan is
 * enough and no AIGCFROGE_CUSTOM_MODE is needed in the browser.
 *
 * What this pins is the one thing source-level assertions cannot: that a server
 * the resolver denied is actually legible to a user as denied, with its reason,
 * rather than silently absent or indistinguishable from a healthy one.
 */
const directory = "C:/Aigcfroge/BuilderMcpRegression"
const projectID = "proj_builder_mcp_regression"
const sessionID = "ses_builder_mcp_regression"
const sessionTitle = "Builder MCP regression"
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-aigcfroge-directory,x-aigcfroge-workspace",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}

type PlanWire = {
  /** Plan body, or a status+message to drive the error branch. */
  plan?: unknown
  status?: number
  message?: string
  /** Held so the loading branch is observable before the plan resolves. */
  gate?: Promise<void>
  requests: number
}

const mcpRef = (relativePath: string) => ({
  kind: "mcp" as const,
  relativePath,
  revision: "b".repeat(64),
})

function planWith(input: {
  effective?: Array<Record<string, unknown>>
  denied?: Array<Record<string, unknown>>
  diagnostics?: Array<Record<string, unknown>>
  requested?: Array<Record<string, unknown>>
}) {
  const requested =
    input.requested ??
    [...(input.effective ?? []), ...(input.denied ?? [])].map((server) => ({
      serverName: server.serverName,
      ref: server.ref,
    }))
  return {
    version: 2,
    valid: (input.denied ?? []).length === 0,
    digest: "c".repeat(64),
    agents: [],
    instructions: [],
    skills: [],
    commands: [],
    capabilities: [],
    diagnostics: input.diagnostics ?? [],
    mcp: { requested, effective: input.effective ?? [], denied: input.denied ?? [] },
  }
}

async function mockPlanRoute(page: Page, wire: PlanWire) {
  await page.route("**/custom-composition/plan*", async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors, body: "" })
    }
    wire.requests += 1
    if (wire.requests > 1) await wire.gate
    if (wire.status && wire.status !== 200) {
      return route.fulfill({
        status: wire.status,
        headers: { "content-type": "application/json", ...cors },
        body: JSON.stringify({ message: wire.message ?? "plan failed" }),
      })
    }
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", ...cors },
      body: JSON.stringify(wire.plan ?? planWith({})),
    })
  })
}

async function openBuilder(page: Page, wire: PlanWire) {
  // `useModeDirectory` resolves the directory from the last session or the first
  // project's worktree (mode-workspace-context.ts:62-66). Without one, `dirSdk`
  // stays undefined and the plan is never requested — the builder renders but
  // every MCP assertion would silently pass against an empty panel.
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "builder-mcp-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "builder-mcp-regression",
        projectID,
        directory,
        title: sessionTitle,
        mode: "custom",
        agent: "meta",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  // Playwright resolves routes last-in-first-out, so the narrow plan route must
  // be registered after the shared catch-all to win.
  await mockPlanRoute(page, wire)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  // `directory()` resolves from the persisted last-session directory first, and
  // only then from the opened-project list — and that list is client-side state a
  // fresh browser profile does not have (`context/server.tsx:73`). Visiting the
  // session once records the directory through the app's own placement store, so
  // the mode route then has a directory and `dirSdk` can request a plan. Without
  // this the builder still renders and every MCP assertion passes against an
  // empty panel.
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: sessionTitle }))
  await page.goto("/mode/custom")
  await expectAppVisible(mcpTab(page))
}

/** The sidebar carries its own hidden "MCP" text node; the tab role is unambiguous. */
const mcpTab = (page: Page) => page.getByRole("tab", { name: "MCP" })
const openMcpTab = async (page: Page) => {
  await mcpTab(page).click()
}

const effective = (page: Page) => page.locator('[data-slot="mcp-effective-server"]')
const denied = (page: Page) => page.locator('[data-slot="mcp-denied-server"]')
const diagnostics = (page: Page) => page.locator('[data-slot="mcp-diagnostic"]')

function wire(overrides: Partial<PlanWire> = {}): PlanWire {
  return { requests: 0, ...overrides }
}

test.describe("regression: Builder MCP health", () => {
  test("shows a ready server with its health, credential status and tools", async ({ page }) => {
    const state = wire({
      plan: planWith({
        effective: [
          {
            serverName: "project-search",
            ref: mcpRef("project-search.md"),
            credentialRef: "cred_" + "a".repeat(32),
            credentialStatus: "available",
            health: "ready",
            tools: ["mcp_project_search_search", "mcp_project_search_index"],
          },
        ],
      }),
    })
    await openBuilder(page, state)
    await openMcpTab(page)

    // The plan must actually have been fetched — an empty panel would satisfy
    // every count-zero assertion below on its own.
    expect(state.requests).toBeGreaterThan(0)
    await expect(effective(page)).toHaveCount(1)
    await expect(effective(page).locator('[data-slot="mcp-server-name"]')).toHaveText("project-search")
    await expect(effective(page).locator('[data-slot="mcp-health"]')).toHaveText("ready")
    await expect(effective(page).locator('[data-slot="mcp-credential-status"]')).toHaveText("available")
    await expect(denied(page)).toHaveCount(0)
  })

  test("shows a revoked server as denied with its reason, not as a healthy one", async ({ page }) => {
    const state = wire({
      plan: planWith({
        denied: [
          {
            serverName: "revoked-search",
            ref: mcpRef("revoked-search.md"),
            credentialRef: "cred_" + "d".repeat(32),
            credentialStatus: "revoked",
            health: "revoked",
            reason: "not_ready",
          },
        ],
        diagnostics: [
          {
            severity: "blocking",
            code: "mcp_not_ready",
            message: "MCP server 'revoked-search' is revoked",
            path: "revoked-search.md",
            asset: mcpRef("revoked-search.md"),
          },
        ],
      }),
    })
    await openBuilder(page, state)
    await openMcpTab(page)

    // The whole point: a revoked server must never read as usable.
    await expect(effective(page)).toHaveCount(0)
    await expect(denied(page)).toHaveCount(1)
    await expect(denied(page).locator('[data-slot="mcp-server-name"]')).toHaveText("revoked-search")
    await expect(denied(page).locator('[data-slot="mcp-health"]')).toHaveText("revoked")
    await expect(denied(page).locator('[data-slot="mcp-reason"]')).toHaveText("not_ready")
    await expect(diagnostics(page)).toHaveCount(1)
    await expect(diagnostics(page).locator('[data-slot="mcp-diagnostic-code"]')).toHaveText("[mcp_not_ready]")
  })

  test("separates a degraded server from a ready one in the same plan", async ({ page }) => {
    const state = wire({
      plan: planWith({
        effective: [
          {
            serverName: "ready-one",
            ref: mcpRef("ready-one.md"),
            credentialStatus: "not-required",
            health: "ready",
            tools: ["mcp_ready_one_ping"],
          },
        ],
        denied: [
          {
            serverName: "degraded-one",
            ref: mcpRef("degraded-one.md"),
            credentialStatus: "available",
            health: "degraded",
            reason: "not_ready",
          },
        ],
      }),
    })
    await openBuilder(page, state)
    await openMcpTab(page)

    await expect(effective(page).locator('[data-slot="mcp-server-name"]')).toHaveText("ready-one")
    await expect(denied(page).locator('[data-slot="mcp-server-name"]')).toHaveText("degraded-one")
    await expect(denied(page).locator('[data-slot="mcp-health"]')).toHaveText("degraded")
  })

  test("renders the empty state rather than an MCP server card", async ({ page }) => {
    await openBuilder(page, wire({ plan: planWith({}) }))
    await openMcpTab(page)

    await expect(page.getByText("No MCP servers requested by this composition")).toBeVisible()
    await expect(effective(page)).toHaveCount(0)
    await expect(denied(page)).toHaveCount(0)
  })

  // A loading-state case is deliberately absent, and the reason is a finding
  // rather than an omission: holding the FIRST plan request suspends the whole
  // mode workspace, so the tab never renders and there is nothing to assert
  // against; and gating a Recalculate refetch never surfaces
  // `custom.builder.mcp.loading` either, so `McpTab`'s `loading` prop appears not
  // to be true during a refetch. Both are current-behaviour observations about
  // the preview column, not about MCP health, and are reported separately.

  test("fails closed when the plan request errors", async ({ page }) => {
    await openBuilder(page, wire({ status: 500, message: "plan blew up" }))
    await openMcpTab(page)

    await expect(effective(page)).toHaveCount(0)
    await expect(denied(page)).toHaveCount(0)
    await expect(diagnostics(page)).toHaveCount(0)
  })
})
