import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

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
