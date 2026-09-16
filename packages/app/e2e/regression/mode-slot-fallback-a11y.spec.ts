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

test.describe("regression: mode slot fallback is reachable narrow and by keyboard", { tag: "@a11y" }, () => {
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

/**
 * S7: narrow-width entry to the mode-specific panel, measured rather than assumed.
 *
 * Probe values at the time these were written (chromium, `--project=chromium-narrow`):
 * with the secondary sidebar open at 390x844 the sidebar is 256px wide at x=65 and the
 * session `<main>` is left **68px** — the composer and timeline are unusable in it. At the
 * 200%-zoom-equivalent 720x450 the same panel leaves `<main>` 398px, so this is a
 * narrow-viewport defect, not a zoom/reflow one.
 *
 * The requirement asserted here is the user-visible one (the session area stays usable with
 * the panel open), not an implementation choice: whether the fix is an overlay/drawer at
 * narrow widths or a smaller docked column is S7's design call.
 */
const USABLE_MAIN_PX = 200

async function openSessionWithPanel(page: Page) {
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
    sessions: [
      {
        id: "ses_slot_fallback_narrow_panel",
        slug: "slot-fallback-narrow-panel",
        projectID,
        directory,
        title: "Narrow panel",
        mode: "chat",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: () => ({ items: [] }),
    events: () => [],
    eventRetry: 16,
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/ses_slot_fallback_narrow_panel`)
  await expectAppVisible(page.getByRole("heading", { name: "Narrow panel" }))

  const toggle = page.getByRole("button", { name: /Show sidebar|Hide sidebar|显示侧边栏|隐藏侧边栏/i })
  await expect(toggle).toBeVisible()
  return toggle
}

test("the mode panel has an entry, an accessible name, and matched aria relationships at 390px", { tag: "@a11y" }, async ({ page }) => {
  await page.setViewportSize(NARROW)
  const toggle = await openSessionWithPanel(page)

  // Entry: reachable and announces its state (the primary sidebar toggle already did this;
  // the secondary one did not until S7).
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  const panel = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
  await expect(panel).toBeVisible()

  // No orphan region references: every aria-controls points at an element that exists.
  const orphans = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-controls]"))
      .map((node) => node.getAttribute("aria-controls") ?? "")
      .filter((id) => id.length > 0 && !document.getElementById(id)),
  )
  expect(orphans).toEqual([])
})

// Was RED: the panel docked as a 256px column at every width and left the session area 68px at
// 390px. `pages/layout.tsx` now floats it below `lg` and docks it from `lg` up, so this passes
// with the measured floor of 200px. The remaining interaction half (Escape/back, focus restore,
// resize round-trip) is registered in packages/app/e2e/coverage-manifest.json.
test("the session area stays usable with the mode panel open at 390px", { tag: "@a11y" }, async ({ page }) => {
  await page.setViewportSize(NARROW)
  const toggle = await openSessionWithPanel(page)
  await toggle.click()
  await expect(page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })).toBeVisible()

  const mainWidth = await page.evaluate(() => Math.round(document.querySelector("main")?.getBoundingClientRect().width ?? 0))
  expect(mainWidth, `main is ${mainWidth}px wide with the panel open at 390px`).toBeGreaterThanOrEqual(USABLE_MAIN_PX)
  await expect(page.locator('[data-component="session-composer"]')).toBeVisible()
})

/**
 * S7: the floating narrow panel owes a keyboard user the same affordances an overlay does —
 * Escape dismisses it, focus returns to the control that opened it — and a desktop→narrow→
 * desktop round trip must not lose the panel's own state (plan §10's acceptance for this
 * surface). Below `lg` the panel floats (pages/layout.tsx); these cases pin that contract.
 */
test("the floating panel closes on Escape and returns focus to its toggle", { tag: "@a11y" }, async ({ page }) => {
  await page.setViewportSize(NARROW)
  const toggle = await openSessionWithPanel(page)
  await toggle.click()

  const panel = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
  await expect(panel).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  // Focus must not be left on a control that no longer exists.
  await expect(toggle).toBeFocused()
})

test("a desktop to narrow round trip keeps the panel's active section", { tag: "@a11y" }, async ({ page }) => {
  await page.setViewportSize(NARROW)
  const toggle = await openSessionWithPanel(page)
  await toggle.click()

  const panel = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
  await expect(panel).toBeVisible()
  const skills = panel.getByRole("button", { name: /^Skills(?:\s+\d+)?$/ })
  await skills.click()
  await expect(skills).toHaveAttribute("data-selected", "")

  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(panel).toBeVisible()
  await page.setViewportSize(NARROW)
  await expect(panel).toBeVisible()
  // The selection is component state, not a DOM remnant: it has to survive both resizes.
  await expect(panel.getByRole("button", { name: /^Skills(?:\s+\d+)?$/ })).toHaveAttribute("data-selected", "")
})

/**
 * An existing precedent for the 200% condition is `settings-dialog.spec.ts:226-229`, which
 * represents browser zoom with the equivalent halved CSS viewport — 720x450 for a 1440x900
 * window. Plan §10 requires the panel's reachability to hold at 200% too, and the
 * observation run measured this case: with the panel open, `<main>` keeps 398px docked and
 * ~654px once it floats.
 *
 * This is a guard for the contract, not a discriminator for the floating fix: 398px already
 * satisfied the floor before the panel learned to float, so the 390x844 case above is the one
 * that catches a squeeze. Both are kept because the plan asks for both conditions.
 */
test("the session area stays usable with the mode panel open at 200% zoom", { tag: "@a11y" }, async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 })
  const toggle = await openSessionWithPanel(page)
  await toggle.click()
  await expect(page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })).toBeVisible()

  const mainWidth = await page.evaluate(() => Math.round(document.querySelector("main")?.getBoundingClientRect().width ?? 0))
  expect(mainWidth, `main is ${mainWidth}px wide with the panel open at 720x450`).toBeGreaterThanOrEqual(USABLE_MAIN_PX)
  await expect(page.locator('[data-component="session-composer"]')).toBeVisible()
})
