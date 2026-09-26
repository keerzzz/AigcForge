import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { expectAppVisible, gotoWhenReady } from "../utils/waits"

/**
 * S7 — the composer's identity controls at a narrow width.
 *
 * plan §9.2 requires the agent picker and the permission state to stay keyboard-reachable and
 * fully readable at narrow widths, and a long agent list to scroll rather than squeeze the model
 * and submit controls. S6's E3 coverage for these controls runs at the default viewport only,
 * which is what left this open (manifest: `identity-narrow-viewport-controls`).
 *
 * Only the agent picker is asserted here. The permission half rides on the StatusBar projection
 * and is registered separately; claiming it without a measurement would be the same
 * observation-as-evidence mistake the plan calls out for `closed:false`.
 *
 * Locators are structural (`data-action` markers the composer already emits) rather than
 * accessible names, because `@a11y` runs under chromium-zh too and English names would
 * either fail those rows or force a locale pin that made them dishonest.
 */
const directory = "C:/Aigcfroge/NarrowComposerControls"
const projectID = "proj_narrow_composer_controls"
const sessionID = "ses_narrow_composer_controls"
const created = 1700000000000
const NARROW = { width: 390, height: 844 }

/** Comfortably past the picker's 12rem list ceiling (`packages/ui/src/components/select.css:107`). */
const AGENT_COUNT = 30
const agents = Array.from({ length: AGENT_COUNT }, (_, index) => ({
  name: `agent-${String(index + 1).padStart(2, "0")}`,
  mode: "primary",
  primaryModes: ["chat", "coding", "work", "assistant", "custom"],
}))

const AGENT_TRIGGER = '[data-action="prompt-agent"]'
const MODEL_CONTROL = '[data-action="prompt-model"]'
const SUBMIT = '[data-action="prompt-submit"]'

/**
 * A connected provider with a selectable model. Without one the composer renders an empty model
 * control and the app reaches a code path that throws (`Cannot read properties of undefined
 * (reading 'map')`, measured in the failure screenshot), which is a property of the fixture
 * rather than of the product — the real server does not serve `providers: []`.
 */
const provider = {
  all: [
    {
      id: "narrow-provider",
      name: "Narrow Provider",
      source: "config",
      env: [],
      options: {},
      models: {
        "narrow-model": {
          id: "narrow-model",
          name: "Narrow Model",
          family: "narrow",
          release_date: "2026-09-01",
          status: "active",
          options: {},
          headers: {},
          limit: { context: 200_000, output: 16_000 },
        },
      },
    },
  ],
  connected: ["narrow-provider"],
  default: { "narrow-provider": "narrow-model" },
}

const CODING_SESSION_ID = "ses_narrow_composer_coding"

async function setup(page: Page, options: { permissionTier?: "propose" | "full" } = {}) {
  await mockAigcfrogeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "narrow-composer-controls",
      time: { created, updated: created },
      sandboxes: [],
    },
    provider,
    agents,
    sessions: [
      {
        id: sessionID,
        slug: "narrow-composer-controls",
        projectID,
        directory,
        title: "Narrow composer",
        mode: "work",
        agent: "agent-01",
        model: { providerID: "narrow-provider", modelID: "narrow-model" },
        permissionTier: options.permissionTier ?? "propose",
        version: "dev",
        time: { created, updated: created },
      },
      {
        id: CODING_SESSION_ID,
        slug: "narrow-composer-coding",
        projectID,
        directory,
        title: "Narrow composer coding",
        mode: "coding",
        agent: "agent-01",
        model: { providerID: "narrow-provider", modelID: "narrow-model" },
        permissionTier: options.permissionTier ?? "propose",
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
  await gotoWhenReady(page, `/${base64Encode(directory)}/session/${sessionID}`)
  await expectAppVisible(page.getByRole("heading", { name: "Narrow composer" }))
}

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`${selector} has no box`)
  return box
}

/**
 * The composer dock re-composes while its async parts land — on a narrow session the permission
 * banner appears only after the identity query settles (measured: that alone moves the model
 * control by 280px). Geometry is therefore sampled once it has stopped moving, or the comparison
 * would be about the fixture's timing rather than about the picker.
 */
async function settledBox(page: Page, selector: string) {
  let previous = await boxOf(page, selector)
  await expect
    .poll(
      async () => {
        const next = await boxOf(page, selector)
        const stable = Math.abs(next.y - previous.y) < 1 && Math.abs(next.width - previous.width) < 1
        previous = next
        return stable
      },
      { timeout: 15_000, intervals: [200, 400, 800] },
    )
    .toBe(true)
  return previous
}

/** Fully inside the 390px viewport, not merely present in the DOM. */
function expectInsideViewport(box: { x: number; width: number }, label: string) {
  expect(box.x, `${label} starts inside the viewport (x=${box.x})`).toBeGreaterThanOrEqual(0)
  expect(
    Math.round(box.x + box.width),
    `${label} ends inside the viewport (right=${box.x + box.width})`,
  ).toBeLessThanOrEqual(NARROW.width)
}

test.describe("S7: composer identity controls at 390px", { tag: "@a11y" }, () => {
  test("the agent picker is keyboard reachable and names its current agent in full", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await setup(page)

    const trigger = page.locator(AGENT_TRIGGER)
    await expect(trigger).toBeVisible()

    // Keyboard reach: focus lands on the control, and Enter (not a pointer) opens it.
    await trigger.focus()
    await expect(trigger).toBeFocused()
    await page.keyboard.press("Enter")

    const list = page.locator('[data-slot="select-select-content-list"]')
    await expect(list).toBeVisible()

    // The current agent's name is complete for assistive tech even though the trigger
    // truncates it visually with CSS — a clipped accessible name would be a different string.
    const name = (await trigger.innerText()).trim()
    expect(name, "the trigger names the current agent").toBe("agent-01")
    await expect(list.getByRole("option").first()).toBeVisible()
  })

  test("a long agent list scrolls instead of squeezing the model and submit controls", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await setup(page)

    const shield = page.locator('[data-slot="permission-override-control"] button')
    await expect(shield).toBeVisible()
    const before = {
      model: await settledBox(page, MODEL_CONTROL),
      submit: await settledBox(page, SUBMIT),
    }
    expectInsideViewport(before.model, "the model before opening the picker")
    expectInsideViewport(before.submit, "the submit button before opening the picker")
    expectInsideViewport(await boxOf(page, '[data-slot="permission-override-control"] button'), "the shield")

    await page.locator(AGENT_TRIGGER).click()
    const list = page.locator('[data-slot="select-select-content-list"]')
    await expect(list).toBeVisible()

    // Bounded and scrollable: the ceiling is the existing contract, so this pins the
    // behaviour at 390px rather than inventing a new one.
    const metrics = await list.evaluate((node) => ({
      client: node.clientHeight,
      scroll: node.scrollHeight,
    }))
    expect(metrics.scroll, "the list overflows its box, so it must scroll").toBeGreaterThan(metrics.client)
    expect(metrics.client, "the list stays within its 12rem ceiling").toBeLessThanOrEqual(200)

    // "Not squeezed" is a claim about the controls, so it is asserted on the controls: the open
    // list must not narrow them, and must not push them out of the viewport. Their vertical
    // position is deliberately NOT compared — the dock re-composes for reasons that have nothing
    // to do with this picker (see `settledBox`).
    const after = {
      model: await boxOf(page, MODEL_CONTROL),
      submit: await boxOf(page, SUBMIT),
    }
    for (const key of ["model", "submit"] as const) {
      expect(after[key].width, `${key} keeps its width with the list open`).toBeCloseTo(before[key].width, 0)
      expectInsideViewport(after[key], key)
      await expect(page.locator(key === "model" ? MODEL_CONTROL : SUBMIT).first()).toBeVisible()
    }

    // And the whole list is reachable by keyboard, not just scrollable by wheel.
    await page.keyboard.press("ArrowDown")
    await expect(list.getByRole("option").nth(1)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(list).toBeHidden()
    await page.locator(MODEL_CONTROL).click()
    await expect(page.locator(`${MODEL_CONTROL}[aria-expanded="true"]`)).toBeVisible()
  })

  /**
   * plan §9.2's other half: the permission state has to stay readable at a narrow width.
   *
   * The chip is asserted on the state the projection actually produces, which is the documented
   * precedence rather than the declared tier: `permission-display.ts` lets a degraded or blocked
   * capability outrank the tier, and the mock's projection reports a non-coding session's mode
   * detail as `mode-detail-not-projected`. A coding session has its detail projected, so it is
   * the case where the declared `full` tier is what shows. Both are checked, because asserting
   * only the tier would pin a state the product is right to override.
   */
  test("the permission state stays readable at 390px, in both its tier and degraded forms", async ({ page }) => {
    await page.setViewportSize(NARROW)
    await setup(page, { permissionTier: "full" })

    const chip = page.locator('[data-component="status-bar-permission"]')
    await expect(chip).toBeVisible()
    await expect(chip, "a degraded capability outranks the declared tier").toHaveAttribute("data-kind", "degraded")
    const degradedName = await chip.getAttribute("aria-label")
    expect(degradedName?.trim().length ?? 0, "the degraded state has an accessible name").toBeGreaterThan(0)
    expectInsideViewport(await boxOf(page, '[data-component="status-bar-permission"]'), "the degraded chip")

    // Coding projects its mode detail, so here the declared tier is the state on screen.
    await gotoWhenReady(page, `/${base64Encode(directory)}/session/${CODING_SESSION_ID}`)
    await expectAppVisible(page.getByRole("heading", { name: "Narrow composer coding" }))
    await expect(chip).toHaveAttribute("data-kind", "full")
    const fullName = await chip.getAttribute("aria-label")
    expect(fullName?.trim().length ?? 0, "the full tier has an accessible name").toBeGreaterThan(0)
    expectInsideViewport(await boxOf(page, '[data-component="status-bar-permission"]'), "the full chip")
  })
})
