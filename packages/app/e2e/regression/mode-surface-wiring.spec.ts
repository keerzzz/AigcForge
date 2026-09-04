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

async function openWorkspace(page: Page) {
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
        mode: "chat",
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
      // Measured while the response is held (stable from ~3s to at least 25s): `main`
      // exists and is empty, and neither work slot is in the DOM. Recorded because it
      // constrains the fix — during a pending route the slot is not mounted, so a
      // slot-local fallback cannot be the whole answer.
      await expect(page.locator('[data-mode-main="work"]')).toHaveCount(0)
      await expect(page.locator('[data-mode-sidebar="work"]')).toHaveCount(0)

      // The defect: nothing tells the user anything. `role="status"` / `role="progressbar"`
      // is the semantics a screen reader needs during the wait and what DESIGN.md requires
      // of new UI, so a spinner without a role would leave the same gap and must not pass.
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
