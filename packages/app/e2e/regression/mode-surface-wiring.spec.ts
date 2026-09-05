import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { APP_READY_TIMEOUT, expectAppVisible } from "../utils/waits"

/**
 * Mode → surface wiring (S8).
 *
 * Replaces the source-string assertions S0.5 deleted from
 * `location-owner-contract.test.tsx`, which read `mode-workspace-slots.tsx` as text and
 * checked things like `mode="work"`. Those could not fail for any behaviour reason and
 * could not be written any other way: the components reach `@solidjs/router` through
 * `@/context/tabs`, so importing them in a bun test throws "Client-only API called on
 * the server side".
 *
 * What actually needs pinning is that each mode route shows its own sidebar and hides
 * the other four — `ModeWorkspace` mounts all five at once and switches with
 * `display:none`, so "the wrong one is on screen" is a one-character mistake in a
 * ternary. `data-mode-sidebar` / `data-mode-main` name the slots, and a marker inside
 * each visible sidebar proves `MODE_SURFACES` maps the slot to the component the
 * deleted test named. Work and Assistant both render `ModeLocationNewSession`, which is
 * why it carries `data-mode-location`: nothing else in their sidebars differs.
 */
const directory = "C:/Aigcfroge/ModeSurfaceWiring"
const projectID = "proj_mode_surface_wiring"
const sessionID = "ses_mode_surface_wiring"
const sessionTitle = "Mode surface wiring"

const MODES = ["chat", "coding", "work", "assistant", "custom"] as const
type Mode = (typeof MODES)[number]

/** One locator per mode that is only satisfiable by the component MODE_SURFACES names. */
const sidebarMarker: Record<Mode, (page: Page) => ReturnType<Page["locator"]>> = {
  // ChatFeatureSidebar owns the feature tree; `chat.feature.title`.
  chat: (page) => page.locator('[data-mode-sidebar="chat"]').getByText("Features", { exact: true }),
  // CodingProjectColumnSidebar renders HomeProjectColumn; `home.projects`.
  coding: (page) => page.locator('[data-mode-sidebar="coding"]').getByText("Projects", { exact: true }),
  // WorkProjectColumnSidebar renders ModeLocationNewSession with mode="work".
  work: (page) => page.locator('[data-mode-sidebar="work"] [data-mode-location="work"]'),
  // AssistantSidebar renders AssistantNavTree alongside its own ModeLocationNewSession.
  assistant: (page) => page.locator('[data-mode-sidebar="assistant"] [data-nav-section]').first(),
  // CustomProjectColumnSidebar; `custom.sidebar.assetsTitle`.
  custom: (page) => page.locator('[data-mode-sidebar="custom"]').getByText("Project Assets", { exact: true }),
}

const slot = (page: Page, mode: Mode) => page.locator(`[data-mode-sidebar="${mode}"]`)
const mainSlot = (page: Page, mode: Mode) => page.locator(`[data-mode-main="${mode}"]`)

async function openWorkspace(page: Page, sessionMode: Mode = "chat") {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "mode-surface-wiring",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "mode-surface-wiring",
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
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  // Visiting the session first records the directory through the app's own placement
  // store; `useModeDirectory` resolves from it, and a fresh profile has no opened
  // project list. Without this the sidebars still render but against no Location.
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: sessionTitle }))
}

test.describe("regression: mode surface wiring", () => {
  for (const mode of MODES) {
    test(`/mode/${mode} shows only the ${mode} sidebar, and it is the ${mode} owner`, async ({ page }) => {
      await openWorkspace(page)
      await page.goto(`/mode/${mode}`)

      await expectAppVisible(slot(page, mode))
      await expectAppVisible(sidebarMarker[mode](page))
      await expect(mainSlot(page, mode)).toBeVisible()

      for (const other of MODES.filter((candidate) => candidate !== mode)) {
        await expect(slot(page, other)).toBeHidden()
        await expect(mainSlot(page, other)).toBeHidden()
        // Mounted but hidden: this is render-all, so absence would mean the slot was
        // dropped rather than switched, and the mode's UI state would not survive.
        await expect(slot(page, other)).toHaveCount(1)
      }
    })
  }

  test("switching modes moves the visible slot without unmounting the others", async ({ page }) => {
    await openWorkspace(page)
    await page.goto("/mode/chat")
    await expectAppVisible(sidebarMarker.chat(page))
    await expect(slot(page, "custom")).toBeHidden()

    await page.goto("/mode/custom")
    await expectAppVisible(sidebarMarker.custom(page))
    await expect(slot(page, "chat")).toBeHidden()
    await expect(slot(page, "chat")).toHaveCount(1)
  })
})

/**
 * S0 baseline for P1-MODE-MOUNT — what `<main>` shows while a mode surface is still
 * resolving.
 *
 * `pages/layout.tsx:42-44` wraps the whole routed area in a fallback-less boundary:
 *
 *   <main class="flex-1 min-h-0 ...">
 *     <Suspense>{props.children}</Suspense>
 *   </main>
 *
 * so every pending resource inside any mode slot renders as nothing. The reported symptom
 * (`report.md` BUG-MODE-REENTRY: "URL 已是 /mode/work，但主区只有顶栏", main visible after
 * ~10s) is that blank window, which in dev is dominated by Vite's on-demand route compile.
 *
 * Waiting on a real cold compile would be a timing race, so the pending window is made
 * deterministic instead: the Work main slot reads `workflowAsset.list()`
 * (`mode-workspace-slots.tsx:668-676`, gated by `whenActive`) → `GET /workflow-asset`.
 * Holding that response open holds the resource pending, which is the same state a cold
 * compile produces. `mode-workspace.tsx:68-76` only settles *rejected* asset lists, so a
 * pending one still suspends to the boundary above.
 *
 * The assertion is an accessible loading indicator, not a class name: `role="status"` /
 * `role="progressbar"` is what a screen reader needs during the wait, and DESIGN.md
 * requires new UI to carry that semantics. A spinner without a role would leave the same
 * gap for assistive tech and should not pass.
 */
test.describe("regression: mode surface pending representation", () => {
  test("cold /mode/work shows a loading indication in main before the surface is ready", async ({ page }) => {
    await openWorkspace(page)

    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    // Matched by exact pathname on the API port, not by glob. Measured: a
    // `**/workflow-asset**` glob also swallowed dev-server module requests and the app
    // never booted at all — a blank page for the wrong reason.
    await page.route(
      (url) => url.port === (process.env.PLAYWRIGHT_SERVER_PORT ?? "4096") && url.pathname === "/workflow-asset",
      async (route) => {
        await held
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ assets: [] }),
        })
      },
    )

    // `waitUntil: "commit"` because the held response keeps the default `load` wait from
    // resolving — measured: it hit the 180s test timeout on this line.
    await page.goto("/mode/work", { waitUntil: "commit" })

    const main = page.locator("main")
    await expect(main).toHaveCount(1, { timeout: APP_READY_TIMEOUT })

    try {
      // S0 measured the opposite here and recorded it as a constraint: while the response was
      // held, `main` was empty and neither work slot was in the DOM, so a slot-local fallback
      // could not be the whole answer. Adding the per-slot boundary is what changed that — the
      // workspace and all five slot containers now mount, and only the waiting slot's content
      // is replaced. Kept as an assertion so a regression back to the blank window is caught.
      await expect(page.locator('[data-mode-main="work"]')).toHaveCount(1)
      await expect(page.locator('[data-surface-pending="slot"]').first()).toBeVisible({ timeout: 15_000 })

      // The user-facing invariant, whichever boundary answers: `main` is never silently empty.
      // `role="status"` is the semantics a screen reader needs during the wait and what
      // DESIGN.md requires, so a spinner without a role would leave the same gap.
      await expect(main.getByRole("status").or(main.getByRole("progressbar")).first()).toBeVisible({ timeout: 15_000 })
    } finally {
      // Always release, so a failing assertion cannot leave the route handler parked.
      release?.()
    }

    // Recovery half: once the held response lands, the Work surface itself must appear —
    // so a fallback added later cannot become a permanent replacement for the content.
    await expectAppVisible(sidebarMarker.work(page))
  })
})

/**
 * S4 RED — what a hidden mode slot is allowed to put on the wire.
 *
 * `ModeWorkspace` mounts all five slots and hides four with `display:none`, so every
 * mode's resources keep running unless something gates them. Six groups are gated
 * through `mode-slot-active.ts`; two are not, and this is the accounting for both.
 *
 * 1. `assistant-dashboard.tsx` has five `useQuery` calls (`:41` pending, `:53` recent,
 *    `:62` memory, `:92` kb, `:157` sessionLoad) and imports nothing from
 *    `mode-slot-active.ts`, so opening Coding also asks the server for the Assistant's
 *    reminders, memory and knowledge base. That is the report's observation verbatim.
 *
 * 2. `mode-workspace.tsx:57-90` and `:160-164` hoist `chatDirSdk` / `chatAssetList` /
 *    `chatSystemData` above every slot, so no slot gate can reach them. The call graph
 *    settles what they are: `ModeWorkspaceAssetCtx` has exactly one consumer,
 *    `ChatAssetWorkbenchMain` (`mode-workspace-slots.tsx:433`) — the Chat main slot.
 *    They are Chat-exclusive resources that happen to be declared one level too high,
 *    not a shared prewarm, so the seven asset lists belong behind the same gate.
 *
 * The fixture's session is Coding, because visiting a session syncs `currentMode`
 * (`app.tsx:159`) and a Chat session would make Chat active before the assertion runs.
 * Counting handlers are registered after the mock server so they win the match, and each
 * falls through with `route.fallback()` so the mock still answers.
 */
// Measured, and it corrects what this test first assumed. `/schedule/pending` has a
// legitimately global owner: `mode-switcher.tsx:24-31` polls it every 60s for the pending
// badge on the Assistant nav item, which only means anything while you are in another mode.
// So it is a shared call with a named owner, not a hidden-slot leak, and it is accounted for
// separately below instead of being gated away.
const ASSISTANT_SLOT_PATHS = ["/delivery/recent", "/memory", "/kb", "/kb/dangling"] as const
const ASSISTANT_BADGE_PATH = "/schedule/pending"
const CHAT_ASSET_PATHS = [
  "/prompt-asset",
  "/skill-asset",
  "/mcp-asset",
  "/command-asset",
  "/agent-asset",
  "/workflow-asset",
  "/plugin-asset",
] as const

async function countPaths(page: Page, paths: readonly string[]) {
  const counts = new Map<string, number>(paths.map((path) => [path, 0]))
  const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  await page.route(
    (url) => url.port === apiPort && paths.includes(url.pathname),
    async (route) => {
      const path = new URL(route.request().url()).pathname
      counts.set(path, (counts.get(path) ?? 0) + 1)
      await route.fallback()
    },
  )
  return () => Object.fromEntries([...counts].filter(([, hits]) => hits > 0))
}

test.describe("regression: hidden mode slots stay off the wire", () => {
  test("coding does not fetch the assistant dashboard's data", async ({ page }) => {
    await openWorkspace(page, "coding")
    const slotOwned = await countPaths(page, ASSISTANT_SLOT_PATHS)
    const badge = await countPaths(page, [ASSISTANT_BADGE_PATH])

    await page.goto("/mode/coding")
    await expectAppVisible(sidebarMarker.coding(page))
    // The Assistant slot is mounted and hidden — that is render-all working as designed.
    await expect(slot(page, "assistant")).toHaveCount(1)
    await expect(slot(page, "assistant")).toBeHidden()

    // Nothing the Assistant slot owns: the dashboard's five queries and the nav tree's four.
    expect(slotOwned()).toEqual({})
    // The badge is allowed, and is asked once rather than once per component that shows it —
    // the dashboard, the nav tree and the switcher share one query key, so it is deduped.
    expect(badge()).toEqual({ [ASSISTANT_BADGE_PATH]: 1 })
  })

  test("the assistant dashboard still loads its data once it is the visible slot", async ({ page }) => {
    // The half that must not be lost: gating is only correct if the feature still works.
    await openWorkspace(page, "coding")
    const slotOwned = await countPaths(page, ASSISTANT_SLOT_PATHS)

    await page.goto("/mode/assistant")
    await expectAppVisible(sidebarMarker.assistant(page))

    await expect.poll(() => Object.keys(slotOwned()).length, { timeout: 15_000 }).toBeGreaterThan(0)
  })

  test("a workspace that never showed chat does not fetch chat's asset lists", async ({ page }) => {
    await openWorkspace(page, "coding")
    const chat = await countPaths(page, CHAT_ASSET_PATHS)

    await page.goto("/mode/coding")
    await expectAppVisible(sidebarMarker.coding(page))
    await expect(slot(page, "chat")).toHaveCount(1)
    await expect(slot(page, "chat")).toBeHidden()

    expect(chat()).toEqual({})
  })

  test("chat's asset lists load once chat is the visible slot", async ({ page }) => {
    await openWorkspace(page, "coding")
    const chat = await countPaths(page, CHAT_ASSET_PATHS)

    await page.goto("/mode/chat")
    await expectAppVisible(sidebarMarker.chat(page))

    await expect.poll(() => Object.keys(chat()).length, { timeout: 15_000 }).toBeGreaterThan(0)
  })
})

/**
 * S4 RED 3 — a slot whose own resource is still pending must not take the workspace with it.
 *
 * Reachable because of render-all: all five slots are mounted from the start, but a gated
 * resource only starts when its slot becomes active (`mode-slot-active.ts`). So arriving at
 * Work from Coding starts `workflowAsset.list()` while the Work slot is already in the DOM —
 * a mounted slot with a pending resource, which is a different state from the cold-route case
 * above, where no slot exists yet.
 *
 * What must hold: the four other slots are untouched, and the workspace does not go blank. If
 * the pending read escapes to the boundary in `layout.tsx`, every slot disappears behind the
 * route fallback and switching modes would throw away the other modes' UI state — the thing
 * render-all exists to protect.
 */
test.describe("regression: one slot's pending resource stays that slot's problem", () => {
  test("arriving at work with its asset list held open keeps the other slots mounted", async ({ page }) => {
    await openWorkspace(page, "coding")

    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    await page.route(
      (url) => url.port === apiPort && url.pathname === "/workflow-asset",
      async (route) => {
        await held
        await route.fallback()
      },
    )

    await page.goto("/mode/coding")
    await expectAppVisible(sidebarMarker.coding(page))

    // Client-side navigation, so the workspace is not rebuilt: this is the mode switch a user
    // performs, not a reload. The rail's items are `IconButtonV2` with an `aria-label` from the
    // mode's `labelKey` (`mode-switcher.tsx:46-53`), not links.
    await page.getByRole("navigation").getByRole("button", { name: "Work", exact: true }).click()

    try {
      await expect(slot(page, "work")).toBeVisible()
      // Every slot survives the wait, so no mode loses its state to another mode's request.
      for (const mode of MODES) {
        await expect(slot(page, mode)).toHaveCount(1)
      }
      // And the workspace is not replaced by the route-level fallback.
      // The slot says it is waiting; the route boundary must not have replaced the workspace.
      await expect(page.locator('[data-surface-pending="slot"]').first()).toBeVisible()
      await expect(page.locator('[data-surface-pending="route"]')).toHaveCount(0)
    } finally {
      release?.()
    }

    await expectAppVisible(sidebarMarker.work(page))
  })
})

/**
 * S4 RED 3, the rejected half — one failing endpoint must not blank the workspace.
 *
 * `mode-workspace.tsx:68-90` and `mode-surfaces.tsx:88-94` already settle their asset lists
 * per kind, with comments saying why: reading a rejected resource throws to the nearest
 * boundary, and that used to be the fallback-less one in `layout.tsx`, so a single 500 blanked
 * every mode. This asserts that protection rather than assuming it, and now also covers the
 * slot boundary added above, which is where such a throw lands instead.
 */
test.describe("regression: one failing endpoint stays one failing endpoint", () => {
  test("a 500 from the work asset list leaves the work surface usable", async ({ page }) => {
    await openWorkspace(page, "coding")
    const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    await page.route(
      (url) => url.port === apiPort && url.pathname === "/workflow-asset",
      (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    )

    await page.goto("/mode/work")

    // Measured in three states, and the assertion tracks the last one. Before any boundary:
    // this reached the app's top-level `ErrorBoundary` and the whole application became
    // "Something went wrong". With the slot boundary: contained, but recovering meant
    // remounting the slot. Now the resource settles it, so the surface stays up and the failure
    // is reported next to the assets it belongs to.
    await expectAppVisible(sidebarMarker.work(page))
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0)
    await expect(page.locator('[data-slot="asset-load-error"]').first()).toBeVisible()
    // The slot's own boundary is the net for an unexpected throw, and this is not one.
    await expect(page.locator('[data-component="mode-slot-error"]')).toHaveCount(0)
    // The workspace and every other slot survive it.
    await expect(page.locator("[data-mode-workspace]")).toHaveCount(1)
    for (const mode of MODES) {
      await expect(slot(page, mode)).toHaveCount(1)
    }
    // And the error carries a way out, not just a statement.
    await expect(page.getByRole("button", { name: "Retry" }).first()).toBeEnabled()
  })
})
