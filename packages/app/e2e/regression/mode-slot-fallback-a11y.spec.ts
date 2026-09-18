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

  // Located by its stable id, not by an aria-label regex: the label is translated, and a
  // regex listing en + zh-Hans made the traditional-Chinese presentation project fail with
  // "element(s) not found" in ten cases. The accessible NAME is asserted separately (the
  // "has an entry and an accessible name" case), so this does not weaken that requirement.
  const toggle = page.locator(MODE_PANEL_TOGGLE)
  await expect(toggle).toBeVisible()
  return toggle
}

test("the mode panel has an entry and an accessible name at 390px", { tag: "@a11y" }, async ({ page }) => {
  await page.setViewportSize(NARROW)
  const toggle = await openSessionWithPanel(page)

  // Entry: reachable and announces its state (the primary sidebar toggle already did this;
  // the secondary one did not until S7).
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")

  const panel = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
  await expect(panel).toBeVisible()

  // No orphan region references. This is a WEAKER check than it looks — it only walks
  // aria-controls that are present, so a missing attribute passes it (the toggle has no
  // aria-controls to the panel unless S7 binds them; that relation is asserted separately
  // by "the toggle and the panel are bound by aria-controls").
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

  const mainWidth = await page.evaluate(() =>
    Math.round(document.querySelector("main")?.getBoundingClientRect().width ?? 0),
  )
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

  // Focus must actually LEAVE the toggle first, or "returns focus" is unfalsifiable: the
  // previous version of this case pressed Escape without moving focus, so it passed even
  // while the restore selector matched nothing (measured: focus landed on BODY).
  await panel.getByRole("button").first().focus()
  await expect(panel.getByRole("button").first()).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toggle).toBeFocused()
})

test(
  "the toggle and the panel are bound by aria-controls while the panel exists",
  { tag: "@a11y" },
  async ({ page }) => {
    await page.setViewportSize(NARROW)
    const toggle = await openSessionWithPanel(page)

    // Closed: the panel is unmounted, so an emitted IDREF would be unresolvable. The attribute
    // therefore follows the mount rather than the preference (review finding: it used to be
    // emitted with no target, which is invalid at any time).
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(await toggle.getAttribute("aria-controls"), "no reference may point at an unmounted panel").toBeNull()
    expect(await page.locator("#secondary-sidebar-panel").count(), "the panel is not mounted while closed").toBe(0)

    // Open: the relation resolves at both ends.
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-controls", "secondary-sidebar-panel")
    await expect(page.locator("#secondary-sidebar-panel")).toHaveCount(1)
    await expect(page.locator("#secondary-sidebar-panel")).toHaveAttribute("role", "complementary")

    // Closed again: the reference goes away with the target, so no dangling IDREF is left behind.
    await toggle.click()
    await expect(page.locator("#secondary-sidebar-panel")).toHaveCount(0)
    expect(await toggle.getAttribute("aria-controls"), "closing must drop the reference too").toBeNull()
  },
)

test("Escape follows the breakpoint in both directions", { tag: "@a11y" }, async ({ page }) => {
  // Wide first: open, shrink, then Escape must dismiss (the listener has to exist for the
  // width we are at NOW, not the one we started at).
  await page.setViewportSize({ width: 1280, height: 720 })
  const toggle = await openSessionWithPanel(page)
  await toggle.click()
  const panel = page.getByRole("complementary", { name: /Project list|项目列表|專案列表/i })
  await expect(panel).toBeVisible()

  await page.setViewportSize(NARROW)
  await expect(panel).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)

  // Narrow first: reopen, then grow. Escape is a NARROW-ONLY affordance — the listener is
  // gated on the same breakpoint as the floating behaviour — so at desktop width Escape must
  // leave the docked panel alone (that is the desktop behaviour that existed before S7, and
  // this is the case that pins it). Shrinking again must re-arm it.
  await toggle.click()
  await expect(panel).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(panel).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(panel, "Escape must not dismiss the docked panel at desktop width").toBeVisible()

  await page.setViewportSize(NARROW)
  await page.keyboard.press("Escape")
  await expect(panel, "shrinking back must re-arm Escape").toHaveCount(0)
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

  const mainWidth = await page.evaluate(() =>
    Math.round(document.querySelector("main")?.getBoundingClientRect().width ?? 0),
  )
  expect(mainWidth, `main is ${mainWidth}px wide with the panel open at 720x450`).toBeGreaterThanOrEqual(USABLE_MAIN_PX)
  await expect(page.locator('[data-component="session-composer"]')).toBeVisible()
})

/**
 * S7: the mode-specific CONTENT panel at narrow widths — the half the first S7 batch did not
 * deliver. Everything above this line is the secondary sidebar (left navigation).
 *
 * `pages/session/session-side-panel.tsx` gates every mode panel behind
 * `<Show when={isDesktop() && !!params.id}>` (`:170`, 768px), so at 390x844 a Work session has
 * no Artifact panel and an Assistant session has no Assistant panel: they are not hidden,
 * they are never mounted. The manifest entry is `narrow-mode-content-panels`.
 *
 * Locators here are ids and structural markers rather than English accessible names, because
 * this file is tagged `@a11y` and therefore also runs under chromium-dark/zh/zht — where
 * `work.artifact.tab` and `assistant.panel.title` are translated. Naming them in English
 * would either fail those rows or force a locale pin that made them dishonest.
 */
const modeDirectory = "C:/Aigcfroge/ModeContentPanel"
const modeProjectID = "proj_mode_content_panel"
const modeWorkSessionID = "ses_mode_content_work"
const modeAssistantSessionID = "ses_mode_content_assistant"
const modeCodingSessionID = "ses_mode_content_coding"
const modeCustomSessionID = "ses_mode_content_custom"
const modeServer = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const modeSessionPath = (sessionID: string) => `/server/${base64Encode(modeServer)}/session/${sessionID}`

const MODE_PANEL_TOGGLE = "#session-mode-panel-toggle"
const modePanel = (page: Page, mode: string) =>
  page.locator(`[data-component="session-mode-panel"][data-mode="${mode}"]`)

async function mockModeContentServer(page: Page, options: { messages?: unknown[] } = {}) {
  await mockAigcfrogeServer(page, {
    directory: modeDirectory,
    project: {
      id: modeProjectID,
      worktree: modeDirectory,
      vcs: "git",
      name: "mode-content-panel",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider: { providers: [], default: {} },
    sessions: [
      {
        id: modeWorkSessionID,
        slug: "mode-content-work",
        projectID: modeProjectID,
        directory: modeDirectory,
        title: "Mode content Work session",
        mode: "work",
        agent: "meta",
        version: "dev",
        time: { created, updated: created },
      },
      {
        id: modeAssistantSessionID,
        slug: "mode-content-assistant",
        projectID: modeProjectID,
        directory: modeDirectory,
        title: "Mode content Assistant session",
        mode: "assistant",
        agent: "assistant-orchestrator",
        version: "dev",
        time: { created, updated: created },
      },
      {
        id: modeCodingSessionID,
        slug: "mode-content-coding",
        projectID: modeProjectID,
        directory: modeDirectory,
        title: "Mode content Coding session",
        mode: "coding",
        agent: "build",
        version: "dev",
        time: { created, updated: created },
      },
      {
        id: modeCustomSessionID,
        slug: "mode-content-custom",
        projectID: modeProjectID,
        directory: modeDirectory,
        title: "Mode content Custom session",
        mode: "custom",
        agent: "meta",
        version: "dev",
        time: { created, updated: created },
      },
    ],
    pageMessages: () => ({ items: options.messages ?? [] }),
    events: () => [],
    eventRetry: 16,
  })
  for (const path of ["agent-asset", "prompt-asset", "skill-asset", "command-asset", "workflow-asset"]) {
    await page.route(`**/${path}?*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ assets: [], invalid: [] }),
      }),
    )
  }
  for (const path of ["schedule/pending", "delivery/recent", "memory", "kb", "kb/dangling"]) {
    await page.route(`**/${path}*`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    )
  }
  // Custom's kill switch is off by default, so the panel is asserted in its typed-blocked form —
  // the same shape `mode-detail-personas.spec.ts` serves — rather than the mock's catch-all `{}`.
  await page.route("**/custom-composition/plan*", (route) =>
    route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({
        name: "UnsupportedProductModeError",
        message: "Custom mode is disabled on this server.",
      }),
    }),
  )
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, modeDirectory)
}

async function openModeContentSession(page: Page, sessionID: string, title: string) {
  await gotoWhenReady(page, modeSessionPath(sessionID))
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 120_000 })
}

/**
 * S7: the scroll half of plan §10's round trip, which the tab assertion above cannot cover.
 *
 * `pages/session.tsx` keeps the session column MOUNTED and only marks it `inert` while the narrow
 * panel floats (`:2030-2036`, and the comment at `:306-308` states the intent: "so the overlay
 * cannot reset the timeline's scroll position"). That is a claim about behaviour, so it is
 * asserted rather than read: the timeline is actually scrolled, the overlay is opened and closed,
 * and the offset must be identical afterwards.
 *
 * Two things make this a real assertion rather than a vacuous one:
 * - the mock now serves enough turns to overflow, and the test FAILS if the viewport does not
 *   actually overflow, so "unchanged" cannot be satisfied by there being nothing to scroll;
 * - the scroll is produced by a real wheel gesture over the viewport, not by assigning
 *   `scrollTop`, because the timeline treats a programmatic write as not-a-user-scroll and
 *   re-anchors to the bottom.
 *
 * The element identity is checked too. A remount would leave the locator pointing at a fresh
 * element whose offset happens to match, which the offset assertion alone cannot see.
 */
const SCROLL_TURNS = 40
const scrollModel = { providerID: "aigcfroge", modelID: "claude-opus-4-6", variant: "max" }
const scrollMessages = Array.from({ length: SCROLL_TURNS }, (_, index) => {
  const messageID = `msg_scroll_${index}`
  return {
    info: {
      id: messageID,
      sessionID: modeWorkSessionID,
      role: "user",
      time: { created: created + index * 1_000 },
      summary: { diffs: [] },
      agent: "meta",
      model: scrollModel,
    },
    parts: [
      {
        id: `prt_scroll_${index}`,
        sessionID: modeWorkSessionID,
        messageID,
        type: "text",
        text: `Scroll fixture turn ${index}. ${"Padding so the row occupies real height. ".repeat(3)}`,
      },
    ],
  }
})

/** The timeline's own scroll container, identified by its content rather than by position. */
const timelineViewport = (page: Page) => page.locator(".scroll-view__viewport:has([data-timeline-row])")

test("opening and closing the floating panel leaves the timeline's scroll offset alone", async ({ page }) => {
  await page.setViewportSize(NARROW)
  await mockModeContentServer(page, { messages: scrollMessages })
  await openModeContentSession(page, modeWorkSessionID, "Mode content Work session")

  const viewport = timelineViewport(page)
  await expect(viewport).toHaveCount(1)
  await expect(page.locator("[data-timeline-row]").first()).toBeVisible()

  // Guard: a fixture that does not overflow would make the assertion below vacuous, so it is a
  // failure of the test rather than a pass.
  const overflow = await viewport.evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(overflow, "the fixture must produce a timeline that can actually scroll").toBeGreaterThan(0)

  // A real gesture: the timeline anchors to the bottom on load (measured: `scrollTop` equals
  // `scrollHeight - clientHeight` once the turns arrive), and a wheel scroll away from it is what
  // a user does.
  //
  // The offset is POLLED rather than read once, because the wheel is applied asynchronously —
  // measured on the probe run: `scrollTop` was unchanged immediately after `mouse.wheel` and had
  // moved by exactly the wheel delta by +400ms, then stayed put. A single read here would have
  // asserted against the pre-scroll value and failed for a reason that has nothing to do with the
  // contract. This is a readiness signal, not a sleep: it waits for the state to change.
  await viewport.hover()
  await page.mouse.wheel(0, -800)
  await expect
    .poll(() => viewport.evaluate((el) => Math.round(el.scrollTop)), { timeout: 10_000 })
    .toBeLessThan(overflow)

  const scrolled = await viewport.evaluate((el) => Math.round(el.scrollTop))
  expect(scrolled, "the wheel gesture must move the timeline off its bottom anchor").toBeGreaterThan(0)
  expect(scrolled, "the offset must land inside the range, not be clamped at either end").toBeLessThan(overflow)

  // Stamp the element so a remount is distinguishable from a preserved offset.
  await viewport.evaluate((el) => {
    el.dataset.scrollProbe = "s7"
  })

  const toggle = page.locator(MODE_PANEL_TOGGLE)
  await toggle.click()
  await expect(modePanel(page, "work")).toBeVisible()

  // The premise of the contract: the body stepped aside rather than unmounting. `inert` is set on
  // the session COLUMN (`pages/session.tsx:2035`), which is an ancestor of the timeline viewport,
  // so it is found by walking up rather than assumed to be on the viewport itself.
  const inertWhileOpen = await viewport.evaluate((el) => el.closest("[inert]") !== null)
  expect(inertWhileOpen, "the floating panel must mark the session body inert, not remove it").toBe(true)
  await expect(viewport).toHaveCount(1)

  await page.keyboard.press("Escape")
  await expect(modePanel(page, "work")).toBeHidden()
  expect(
    await viewport.evaluate((el) => el.closest("[inert]") !== null),
    "closing the panel must hand the body back",
  ).toBe(false)

  await expect(viewport, "the same scroll container must still be mounted").toHaveAttribute("data-scroll-probe", "s7")
  expect(await viewport.evaluate((el) => el.scrollTop), "the overlay must not reset the timeline scroll").toBe(scrolled)
})

test.describe("S7: the mode content panel is reachable at narrow widths", { tag: "@a11y" }, () => {
  test.beforeEach(async ({ page }) => {
    await mockModeContentServer(page)
  })

  test("a Work session reaches its Artifact panel at 390px, by keyboard", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await openModeContentSession(page, modeWorkSessionID, "Mode content Work session")

    const work = modePanel(page, "work")
    await expect(work, "the content panel is not docked at 390px until it is asked for").toBeHidden()

    const toggle = page.locator(MODE_PANEL_TOGGLE)
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")

    // A pointer-only entry is not an entry for a keyboard user, and the state has to be
    // announced rather than merely rendered.
    await toggle.focus()
    await expect(toggle).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(work).toBeVisible()

    const name = await work.locator("#review-panel").getAttribute("aria-label")
    expect(name?.trim().length ?? 0, "the panel must keep a non-empty accessible name").toBeGreaterThan(0)

    // Focus has to LEAVE the toggle first, or "Escape returns focus" is unfalsifiable.
    await work.locator("button").first().focus()
    await page.keyboard.press("Escape")
    await expect(work).toBeHidden()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(toggle).toBeFocused()
  })

  test("an Assistant session reaches its panel at 390px", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await openModeContentSession(page, modeAssistantSessionID, "Mode content Assistant session")

    const assistant = modePanel(page, "assistant")
    await expect(assistant).toBeHidden()

    await page.locator(MODE_PANEL_TOGGLE).click()
    await expect(assistant).toBeVisible()
    await expect(assistant.locator("#review-panel")).toHaveAttribute("aria-label", /\S/)
  })

  /**
   * The third mode the manifest names for this contract. Custom is gated by a kill switch that is
   * off by default, so what is asserted is reachability of the panel — which the mock serves in
   * its disabled/blocked form — not that a composition runs.
   */
  test("a Custom session reaches its panel at 390px", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await openModeContentSession(page, modeCustomSessionID, "Mode content Custom session")

    const custom = modePanel(page, "custom")
    await expect(custom).toBeHidden()
    await page.locator(MODE_PANEL_TOGGLE).click()
    await expect(custom).toBeVisible()
  })

  test("desktop keeps the panel docked and offers no narrow toggle", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openModeContentSession(page, modeWorkSessionID, "Mode content Work session")

    // A guard, not a new capability: this is the desktop behaviour S7 must leave alone, so it
    // is asserted on the surface that exists today rather than on the narrow-only marker.
    const docked = page.locator("#review-panel:visible")
    await expect(docked).toHaveCount(1)
    const name = await docked.getAttribute("aria-label")
    expect(name?.trim().length ?? 0, "the docked panel keeps an accessible name").toBeGreaterThan(0)

    // The narrow entry is absent rather than present-and-dead.
    await expect(page.locator(MODE_PANEL_TOGGLE)).toHaveCount(0)
  })

  test("a coding session offers no narrow entry, because its owner is already reachable", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await openModeContentSession(page, modeCodingSessionID, "Mode content Coding session")

    // Pins the exclusion rather than leaving it implicit: coding's content owner is the
    // review/files surface, and a narrow coding session reaches it through its own tabs, so a
    // second floating copy would be a duplicate presentation of the same owner.
    await expect(page.locator(MODE_PANEL_TOGGLE)).toHaveCount(0)
    await expect(page.locator('[data-component="session-mode-panel"]')).toHaveCount(0)
  })

  test("a desktop to narrow to desktop round trip keeps the panel's active tab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openModeContentSession(page, modeWorkSessionID, "Mode content Work session")

    // Which tab the panel opens on belongs to the panel owner, not to this spec, so it is read
    // rather than assumed (`work-artifact-panel.tsx` defaults it to Artifact). What S7 owes is
    // that a selection made here survives the presentation change, so the other tab is chosen
    // and then required to persist — a reset to the default would fail that.
    // `data-value` is the trigger's stable hook (`ui/src/v2/components/tabs-v2.tsx:85`); the
    // labels are translated, so matching them by English name only worked in the en project.
    const artifact = page.locator('[data-slot="tabs-v2-trigger"][data-value="artifact"]')
    const context = page.locator('[data-slot="tabs-v2-trigger"][data-value="context"]')
    const selected = (await context.getAttribute("data-selected")) === "" ? context : artifact
    const other = selected === context ? artifact : context
    await other.click()
    await expect(other).toHaveAttribute("data-selected", "")
    await expect(selected).not.toHaveAttribute("data-selected", "")

    // Narrow: the panel is closed by default, so what must survive is the panel's OWN state
    // across the wrapper's presentation change, not a DOM remnant of an open panel.
    await page.setViewportSize(NARROW)
    await expect(modePanel(page, "work")).toBeHidden()
    await page.locator(MODE_PANEL_TOGGLE).click()
    await expect(other, "the selected tab must survive the move to narrow").toHaveAttribute("data-selected", "")

    // And back again. This is the assertion that would fail if the narrow presentation had been
    // built as a second, separately-mounted copy of the owner instead of a re-boxing of it.
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect(modePanel(page, "work")).toBeVisible()
    await expect(other, "the selected tab must survive the round trip").toHaveAttribute("data-selected", "")
  })
})
