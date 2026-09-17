/**
 * The seeded persistent context this suite runs in.
 *
 * The standard `browser`/`context` fixtures cannot express the proven recipe: a
 * profile has to be written BEFORE the browser launches (`use: { ... }` is applied
 * after launch), and `use.viewport` would send `Emulation.setDeviceMetricsOverride`,
 * which pins the layout viewport and nullifies the seed. So `context` is built here
 * with `chromium.launchPersistentContext` and `page` is the persistent context's own
 * first page.
 *
 * Both halves of the recipe are load-bearing and both are asserted by the control
 * test in `narrow-real-zoom.spec.ts`:
 *
 * - `channel: "chromium"` — the default `chrome-headless-shell` has no zoom subsystem
 *   at all; a seeded profile there measures an unzoomed window.
 * - `viewport: null` — with an explicit viewport, a seeded profile still measured
 *   1280px inner width on a 1280x720 window instead of 640.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { chromium, test as base, type BrowserContext, type Page, type TestInfo } from "@playwright/test"
import { seedZoomProfile, WINDOW_SIZE, ZOOM_HOST, ZOOM_LEVEL_200 } from "./zoom-profile"

// Re-exported so specs import their whole test surface from one module.
export { expect } from "@playwright/test"
export type { BrowserContext, Page, TestInfo } from "@playwright/test"

export interface ZoomFixtures {
  /** Seed 200% page zoom for {@link ZOOM_HOST} into the profile before launch. */
  seedZoom: boolean
  context: BrowserContext
  page: Page
}

export const test = base.extend<ZoomFixtures>({
  // Default on: every test that does not opt out is measuring the zoomed browser.
  // The control test opts out with `test.use({ seedZoom: false })`.
  seedZoom: [true, { option: true }],

  context: async ({ seedZoom }, use, testInfo) => {
    // A fresh profile per test: the zoom entry is per-host, so a shared profile
    // would leak zoom into the control test.
    const profile = mkdtempSync(path.join(tmpdir(), "aigcfroge-zoom-"))
    if (seedZoom) seedZoomProfile(profile, ZOOM_HOST, ZOOM_LEVEL_200)

    const context = await chromium.launchPersistentContext(profile, {
      // `chromium` is Chrome for Testing ("Chromium new headless"), the only
      // Playwright-launched browser with a zoom subsystem.
      channel: "chromium",
      headless: true,
      // No `Emulation.setDeviceMetricsOverride`: the page must stay tied to the real
      // window so a page zoom can shrink the layout viewport.
      viewport: null,
      baseURL: testInfo.project.use.baseURL,
      args: [`--window-size=${WINDOW_SIZE.width},${WINDOW_SIZE.height}`],
    })

    try {
      await use(context)
    } finally {
      await context.close()
      rmSync(profile, { recursive: true, force: true })
    }
  },

  page: async ({ context }, use, testInfo) => {
    // The persistent context is created with exactly one about:blank page. The
    // certificate is NOT measured here: `about:blank` has no host, and per-host zoom
    // never applies to it (see `measureCertificate` in the spec).
    const page = context.pages()[0] ?? (await context.newPage())
    await use(page)
    await captureFailureScreenshot(testInfo, page)
  },
})

async function captureFailureScreenshot(testInfo: TestInfo, page: Page) {
  if (testInfo.status === testInfo.expectedStatus) return
  // Overriding `context` opts out of Playwright's built-in artifact collection
  // (tracing/screenshots live in the base `context` fixture), so the evidence for a
  // red run is attached by hand at the same point.
  const screenshot = await page.screenshot().catch(() => undefined)
  if (screenshot) await testInfo.attach("failure-screenshot", { body: screenshot, contentType: "image/png" })
}
