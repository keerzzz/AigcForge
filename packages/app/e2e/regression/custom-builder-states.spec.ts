import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

/**
 * Custom Builder request and failure states (S6 / S8).
 *
 * These cover the three things the unit tests for P2-10, P2-12 and P2-14 explicitly
 * cannot reach, because each is only observable by rendering the workspace:
 *
 *   - a hidden mode slot issues no asset requests (P2-14). The unit test pins
 *     `whenActive`; only a browser shows that the six gated sites actually stay quiet.
 *   - a partially failed asset read renders an error with Retry instead of an empty
 *     project, and withholds the "create starter agent" prompt (P2-10 / P2-13).
 *   - Start stays disabled when the plan request fails (P2-12). `evaluateStartGate`
 *     pins the decision; this pins that the button is wired to it.
 */
const directory = "C:/Aigcfroge/CustomBuilderStates"
const projectID = "proj_custom_builder_states"
const sessionID = "ses_custom_builder_states"
const sessionTitle = "Custom builder states"
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-aigcfroge-directory,x-aigcfroge-workspace",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}

const ASSET_PATHS = ["agent-asset", "prompt-asset", "skill-asset", "command-asset", "workflow-asset"] as const
type AssetPath = (typeof ASSET_PATHS)[number]

type Wire = {
  /**
   * False until the mode route is reached. The session visit that resolves the
   * directory also loads assets, and answering those with a 500 breaks the session
   * page before the mode route is ever seen — so failures are armed afterwards, and
   * the counters below only describe the mode route.
   */
  armed: boolean
  /** Per-endpoint hit counts, so "issued no request" is a measurement not an inference. */
  hits: Record<string, number>
  /** Endpoints answered with a 500 instead of a list. */
  fail: Set<AssetPath>
  /** Plan outcome: a body, or a status to drive the failure branch. */
  planStatus?: number
  planMessage?: string
}

const wire = (over: Partial<Wire> = {}): Wire => ({ armed: false, hits: {}, fail: new Set(), ...over })

const plan = {
  version: 2,
  valid: true,
  digest: "c".repeat(64),
  input: { source: "temporary", agents: [], bindings: {}, presentation: "native", requestedCapabilities: [] },
  agents: [],
  instructions: [],
  skills: [],
  commands: [],
  capabilities: [],
  diagnostics: [],
}

const agentAsset = {
  name: "reviewer",
  description: "Reviews code",
  relativePath: "reviewer.md",
  revision: "a".repeat(64),
}

async function mockBuilderRoutes(page: Page, state: Wire) {
  for (const path of ASSET_PATHS) {
    await page.route(`**/${path}?*`, async (route: Route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
      if (state.armed) state.hits[path] = (state.hits[path] ?? 0) + 1
      if (state.armed && state.fail.has(path)) {
        return route.fulfill({
          status: 500,
          headers: { "content-type": "application/json", ...cors },
          body: JSON.stringify({ message: `${path} exploded` }),
        })
      }
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", ...cors },
        body: JSON.stringify({ assets: path === "agent-asset" ? [agentAsset] : [], invalid: [] }),
      })
    })
  }
  await page.route("**/custom-composition/plan*", async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" })
    if (state.armed) state.hits["plan"] = (state.hits["plan"] ?? 0) + 1
    if (state.armed && state.planStatus && state.planStatus !== 200) {
      return route.fulfill({
        status: state.planStatus,
        headers: { "content-type": "application/json", ...cors },
        body: JSON.stringify({ message: state.planMessage ?? "plan failed" }),
      })
    }
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", ...cors },
      body: JSON.stringify(plan),
    })
  })
}

/**
 * Lands on a mode route with a resolved directory.
 *
 * The session visit is not decoration: `useModeDirectory` resolves the directory from
 * the persisted last-session placement first and only then from the opened-project
 * list, which a fresh browser profile does not have. Without it `dirSdk` stays
 * undefined, no request is ever issued, and every assertion below would pass against
 * an empty panel.
 */
async function openMode(page: Page, state: Wire, mode: "chat" | "custom", sessionMode = "custom") {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "custom-builder-states",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "custom-builder-states",
        projectID,
        directory,
        title: sessionTitle,
        mode: sessionMode,
        agent: "meta",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  // Registered after the catch-all: Playwright resolves routes last-in-first-out.
  await mockBuilderRoutes(page, state)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: sessionTitle }))
  state.armed = true
  await page.goto(`/mode/${mode}`)
}

// Scoped to the Custom slot: the banner is now the shared `AssetLoadError`, and the Chat
// workbench renders one too. Both are present here because `ModeWorkspace`'s own asset
// list is not slot-gated (it lives in the parent, which is why P2-14 never covered it),
// so an unscoped locator matches two elements.
const loadError = (page: Page) => page.locator('[data-mode-sidebar="custom"] [data-slot="asset-load-error"]')
const emptyStarter = (page: Page) => page.locator('[data-slot="custom-asset-empty-starter"]')
const assetsTitle = (page: Page) => page.getByText("Project Assets", { exact: true })
const startButton = (page: Page) => page.getByRole("button", { name: "Start Session" })

test.describe("regression: Custom Builder request and failure states", () => {
  test("a hidden mode slot issues no asset requests, and issues them once shown", async ({ page }) => {
    // P2-14. ModeWorkspace mounts every mode's slots at once and hides the inactive
    // ones with display:none, so before the gate the Custom sidebar's five list calls
    // and the Builder's plan call went out while the user was looking at Chat.
    // The seeded session is a CHAT session on purpose. Landing on a custom-mode
    // session first would make `ResolvedTargetSessionRoute` set the current mode to
    // custom, so the custom slot would be legitimately active for the instant before
    // the mode route switches it — a real but different situation from the one P2-14
    // is about, which is a slot that is hidden the whole time.
    const state = wire()
    await openMode(page, state, "chat", "chat")
    // Wait for a Chat-side surface so the workspace has definitely mounted and its
    // slots have had their chance to fetch; otherwise a zero count proves nothing.
    await expectAppVisible(page.getByText("Project", { exact: true }).first())
    await expect(assetsTitle(page)).toBeHidden()

    // The composition plan is the discriminator: only the Custom Main slot requests
    // it. The five asset lists cannot serve here — measured, not assumed: Chat fetches
    // seven lists of its own (`mode-workspace.tsx`'s workbench list and
    // `ChatFeatureSidebar`'s kind counts), and Custom's five are a subset of them, so
    // a nonzero `/agent-asset` count on Chat is Chat's own traffic.
    expect(state.hits["plan"] ?? 0).toBe(0)

    await page.goto("/mode/custom")
    await expectAppVisible(assetsTitle(page))

    await expect.poll(() => state.hits["plan"] ?? 0).toBeGreaterThan(0)
  })

  test("a partly failed asset read shows an error with Retry, not an empty project", async ({ page }) => {
    // P2-10: every list call used to be wrapped in `.catch(() => ({assets: []}))`, so
    // this rendered as a project with no assets — no message, no retry.
    const state = wire({ fail: new Set(["skill-asset", "command-asset"]) })
    await openMode(page, state, "custom")
    await expectAppVisible(assetsTitle(page))

    await expectAppVisible(loadError(page))
    await expect(loadError(page)).toContainText("skills")
    await expect(loadError(page)).toContainText("commands")
    await expect(loadError(page).getByRole("button", { name: "Retry" })).toBeVisible()
    // The kinds that succeeded are still listed.
    await expect(page.getByText("reviewer", { exact: false }).first()).toBeVisible()

    const before = state.hits["skill-asset"] ?? 0
    state.fail.clear()
    await loadError(page).getByRole("button", { name: "Retry" }).click()

    await expect.poll(() => state.hits["skill-asset"] ?? 0).toBeGreaterThan(before)
    await expect(loadError(page)).toBeHidden()
  })

  test("a failed asset read does not offer the starter-agent prompt", async ({ page }) => {
    // P2-13: the zero-agents branch offers "create starter agent", which adds a draft
    // ref with an empty revision. Offering it after a failed read invited the user to
    // paper over a server error with a fake asset.
    const state = wire({ fail: new Set([...ASSET_PATHS]) })
    await openMode(page, state, "custom")
    await expectAppVisible(assetsTitle(page))

    await expectAppVisible(loadError(page))
    await expect(loadError(page)).toContainText("Could not load project assets")
    await expect(emptyStarter(page)).toBeHidden()
  })

  test("Start stays disabled when the plan request fails", async ({ page }) => {
    // P2-12: `canStart` consulted only the disabled/unsupported flags, never the
    // generic error that every other failure produces, so Start was clickable against
    // a server that had planned nothing.
    //
    // This asserts the outcome, not which internal blocker produced it — verified by
    // experiment: removing the `plan-failed` branch does NOT redden this, because a
    // failed plan also has no digest, so `no-digest` catches it. The two are not
    // independently observable at the button; only `custom-plan-state.test.ts`
    // distinguishes them. The test below is what stops this passing vacuously.
    const state = wire({ planStatus: 500, planMessage: "resolver exploded" })
    await openMode(page, state, "custom")
    await expectAppVisible(assetsTitle(page))

    await expectAppVisible(startButton(page))
    await expect.poll(() => state.hits["plan"] ?? 0).toBeGreaterThan(0)
    await expect(startButton(page)).toBeDisabled()
  })

  test("Start becomes enabled once an agent is picked and a valid plan settles", async ({ page }) => {
    // The positive control for the test above: without it, a Start button that were
    // permanently disabled would satisfy every assertion here.
    //
    // It also covers S6 RED 4 end to end. Picking the agent happens in the SIDEBAR
    // slot and enabling Start is decided in the MAIN slot, so the button only moves if
    // both observe the same draft store — which is now structural, one
    // `CustomDraftProvider` in `ModeWorkspace`, rather than a module-level cache.
    const state = wire()
    await openMode(page, state, "custom")
    await expectAppVisible(assetsTitle(page))
    await expect(startButton(page)).toBeDisabled()

    await page.getByText("reviewer", { exact: true }).first().click()

    await expect(startButton(page)).toBeEnabled()
  })
})
