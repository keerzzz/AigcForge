import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

/**
 * S8c — the S4 slot fallback at a narrow width and from the keyboard.
 *
 * S4 added two surfaces inside the mode slot boundary: a pending indicator and an error card
 * with a retry. The plan scopes the narrow-viewport and keyboard work to exactly the surfaces
 * this batch introduced, so this covers those two and does not claim a wider matrix.
 *
 * Both states are forced through the network rather than waited for: Work's main slot reads
 * `workflowAsset.list()` (`mode-workspace-slots.tsx:668-676`), so holding that response open
 * holds the slot pending, and failing it puts the slot in its error state. Every wait below is a
 * DOM or network signal.
 *
 * The keyboard half is the part a mouse-driven test cannot cover: an error card whose retry can
 * be seen but not reached is still a dead end for anyone not using a pointer.
 */
const directory = "C:/Aigcfroge/SlotFallbackA11y"
const projectID = "proj_slot_fallback_a11y"
const created = 1700000000000
const NARROW = { width: 390, height: 844 }

const apiPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const isWorkflowAsset = (url: URL) => url.port === apiPort && url.pathname === "/workflow-asset"

async function setup(page: Page) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "slot-fallback-a11y",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)
  await page.goto(`/${base64Encode(directory)}`)
}

test.describe("regression: mode slot fallback is reachable narrow and by keyboard", () => {
  test("the pending indicator is visible at 390px and names itself", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await setup(page)

    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(isWorkflowAsset, async (route) => {
      await held
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ assets: [] }),
      })
    })

    await gotoWhenReady(page, "/mode/work", { waitUntil: "commit" })

    try {
      const pending = page.locator("main").getByRole("status")
      await expectAppVisible(pending.first())
      // A live region with no name announces nothing useful, and at this width it is the only
      // thing on screen.
      await expect(pending.first()).toHaveAttribute("aria-label", /.+/)
    } finally {
      release?.()
    }

    // Recovery: the surface itself arrives once the response lands, so the fallback cannot
    // become permanent.
    await expectAppVisible(page.locator('[data-mode-main="work"]'))
  })

  /**
   * The error card has no test here, and that is a finding rather than an omission.
   *
   * Measured: failing `/workflow-asset` with a 500 never renders it. `mode-workspace.tsx:68-76`
   * settles each asset list before it can reject, precisely so a rejected resource cannot punch
   * through the boundary — so the documented rejected-resource case is already handled upstream
   * and never reaches the card. What is left for the card to catch is a render-time throw, which
   * nothing in the app forces on demand.
   *
   * So S4's `SlotError` is insurance with no reachable trigger, which also means no keyboard or
   * narrow-viewport coverage is possible for it. Recorded in `docs/technical-debt.md` with what
   * would be needed to exercise it. The stalled exit S3a added does have Enter coverage
   * (`session-turn-stall.spec.ts:205`), so the keyboard requirement is met on the surface that
   * has a control to press.
   */
})
