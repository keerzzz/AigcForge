/**
 * Real page zoom evidence (not emulation): the browser is launched with a profile that
 * already carries a 200% zoom entry for `127.0.0.1`, so it starts zoomed exactly as it
 * would after a user pressed Ctrl+=.
 *
 * Two tests, and the pair is the point:
 *
 * 1. CONTROL — a clean profile must measure an UNZOOMED window. If Chrome ever stops
 *    honouring the seeded `Preferences` (a `chrome-headless-shell` fallback, a viewport
 *    override creeping back in, a pref rename), the control goes red and the "200%" test
 *    can no longer produce a false green.
 * 2. 200% — a seeded profile must measure the zoomed window, and only then is the product
 *    contract asserted: at real 200% page zoom the mode-specific panels stay reachable.
 *
 * The product half is EXPECTED RED today. The panels live behind
 * `packages/app/src/pages/session/session-side-panel.tsx:170`'s
 * `<Show when={isDesktop() && !!params.id}>`, where `isDesktop` is
 * `createMediaQuery("(min-width: 768px)")`. A real 200% zoom on a 1440x900 window leaves a
 * 720px layout viewport, so the media query flips false and every mode panel unmounts —
 * exactly for the user who needs the room most. The failure is the deliverable.
 */
import { writeFileSync } from "node:fs"
import { expect, test, type Page, type TestInfo } from "./fixtures"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"
import { expectAppVisible } from "../utils/waits"
import { CLEAN_WINDOW, DESKTOP_MEDIA_QUERY, WINDOW_SIZE, ZOOMED_WINDOW, ZOOM_HOST } from "./zoom-profile"

/** A 1200px-wide block fits a 1440px viewport and cannot fit a 720px one. */
const REFLOW_PROBE_WIDTH = 1200

/**
 * The certificate is measured on a document served AT the seeded host — never on
 * `about:blank`.
 *
 * Measured while writing this suite: `about:blank` reports innerWidth 1440 / DPR 1 /
 * mq768 true in a CORRECTLY seeded browser, because per-host zoom is keyed by the
 * document's host and `about:blank` has none. A certificate taken there would report
 * "not zoomed" for a working seed (and would have gone red for the wrong reason).
 *
 * The document itself is fulfilled by a route, so the measurement depends on the
 * browser profile and nothing else. The URL's host — what Chrome keys zoom on — is
 * still the dev server's `127.0.0.1`:PORT origin.
 */
const CERTIFICATE_PATH = "/zoom-certificate.html"
const CERTIFICATE_HTML =
  "<!doctype html><html><head><meta charset='utf-8'><title>zoom certificate</title></head><body></body></html>"

interface WindowCertificate {
  innerWidth: number
  innerHeight: number
  outerWidth: number
  outerHeight: number
  devicePixelRatio: number
  mq768: boolean
  visualViewportWidth: number | undefined
  screenWidth: number
  screenHeight: number
}

async function measureWindow(page: Page): Promise<WindowCertificate> {
  return page.evaluate((query) => {
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
      mq768: window.matchMedia(query).matches,
      visualViewportWidth: window.visualViewport?.width,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    }
  }, DESKTOP_MEDIA_QUERY)
}

/**
 * The reflow certificate: a zoomed layout viewport has to reflow its content, which is
 * what separates a real page zoom from a pinned/emulated one. A fixed-width block that
 * fits at 100% must overflow at 200%.
 */
async function measureReflow(page: Page) {
  return page.evaluate((width) => {
    const probe = document.createElement("div")
    probe.style.cssText = `width:${width}px;height:10px`
    document.body.appendChild(probe)
    const measured = {
      elementWidth: width,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
    probe.remove()
    return measured
  }, REFLOW_PROBE_WIDTH)
}

const raw = (value: unknown) => JSON.stringify(value)

/**
 * Written to a real file and attached by path: an inline `body` attachment is kept in
 * the report only for the run that produced it, so the certificate files must exist
 * next to the failing test's artifacts to be reviewable afterwards.
 */
async function attachCertificate(testInfo: TestInfo, name: string, value: unknown) {
  const file = testInfo.outputPath(`${name}.json`)
  writeFileSync(file, JSON.stringify(value, null, 2))
  await testInfo.attach(name, { path: file, contentType: "application/json" })
}

/**
 * Load the certificate document on the seeded host and measure it.
 *
 * The document is fulfilled locally, so this touches no app UI and does not depend on
 * the dev server beyond its origin being the seeded one.
 */
async function measureCertificate(page: Page, testInfo: TestInfo, name: string) {
  const baseURL = testInfo.project.use.baseURL
  if (!baseURL) throw new Error("e2e/zoom requires a baseURL")
  const url = new URL(CERTIFICATE_PATH, baseURL)
  await page.route(url.toString(), (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: CERTIFICATE_HTML }),
  )
  await page.goto(url.toString())

  const location = new URL(page.url())
  const window = await measureWindow(page)
  const reflow = await measureReflow(page)
  const certificate = {
    url: url.toString(),
    host: location.host,
    hostname: location.hostname,
    window,
    reflow,
  }
  await attachCertificate(testInfo, name, certificate)

  // about:blank and every other hostless/unseeded page is never zoomed; the
  // measurement is only meaningful on the seeded host.
  expect(certificate.hostname, `the certificate must be measured on ${ZOOM_HOST}: ${raw(certificate)}`).toBe(ZOOM_HOST)
  return certificate
}

test.describe("control: the seed is what zooms, not the window", () => {
  test.use({ seedZoom: false })

  test("a clean profile measures an unzoomed window at 1440x900", async ({ page }, testInfo) => {
    const { window, reflow } = await measureCertificate(page, testInfo, "window-certificate-control")

    expect(window.innerWidth, `clean profile, ${WINDOW_SIZE.width}x${WINDOW_SIZE.height} window: ${raw(window)}`).toBe(
      CLEAN_WINDOW.innerWidth,
    )
    expect(window.outerWidth, `clean profile window width: ${raw(window)}`).toBe(CLEAN_WINDOW.outerWidth)
    expect(window.devicePixelRatio, `clean profile DPR: ${raw(window)}`).toBe(CLEAN_WINDOW.devicePixelRatio)
    expect(window.mq768, `clean profile ${DESKTOP_MEDIA_QUERY}: ${raw(window)}`).toBe(true)

    // The same probe that overflows at 200% must NOT overflow here, or the reflow
    // certificate in the zoomed test would not discriminate.
    expect(reflow.overflows, `a ${REFLOW_PROBE_WIDTH}px block must fit a 1440px viewport: ${raw(reflow)}`).toBe(false)
  })
})

test.describe("200% page zoom", () => {
  test("a seeded profile zooms, reflows, and must keep the mode panels reachable", async ({ page }, testInfo) => {
    await test.step("the browser is really zoomed (asserted before any app UI)", async () => {
      const { window, reflow } = await measureCertificate(page, testInfo, "window-certificate-200")

      expect(window.innerWidth, `200% page zoom shrinks the layout viewport: ${raw(window)}`).toBe(
        ZOOMED_WINDOW.innerWidth,
      )
      expect(window.outerWidth, `the OS window must not change when the page zooms: ${raw(window)}`).toBe(
        ZOOMED_WINDOW.outerWidth,
      )
      expect(window.devicePixelRatio, `200% page zoom doubles DPR: ${raw(window)}`).toBe(ZOOMED_WINDOW.devicePixelRatio)
      expect(window.mq768, `768px media query must reflow at a 720px layout viewport: ${raw(window)}`).toBe(false)
      expect(reflow.overflows, `a ${REFLOW_PROBE_WIDTH}px block cannot fit a 720px viewport: ${raw(reflow)}`).toBe(true)
    })

    const reachability = await test.step("the product contract: mode panels at real 200% zoom", async () => {
      await pinEnglishUI(page)
      await seedAppState(page)
      await mockAigcfrogeServer(page, {
        directory,
        project,
        provider,
        sessions,
        pageMessages: () => ({ items: [] }),
        events: () => [],
        eventRetry: 16,
      })

      // The app page must genuinely be the zoomed one, or the measurement below would
      // be about a different browser state than the certificate above.
      const appWindow = await openSession(page, testInfo, workSessionID, WORK_TITLE)
      const work = await measureArtifactPanel(page)

      await openSession(page, testInfo, assistantSessionID, ASSISTANT_TITLE)
      const assistant = await measureAssistantPanel(page)

      const measured = { appWindow, work, assistant }
      await attachCertificate(testInfo, "mode-panel-reachability-200", measured)
      return measured
    })

    // `expect.soft` so BOTH modes are reported in one run instead of the first failure
    // hiding the second. The panel is closed by default at a 720px layout viewport, so
    // reachability means the narrow entry exists AND reveals it — asserting the panel
    // without the entry would pass for a panel nothing can open.
    expect
      .soft(
        reachability.work.entryVisible,
        `Work: no narrow entry to the mode panel at real 200% page zoom. The panel is presented ` +
          `floating below 768px (packages/app/src/pages/session/session-side-panel.tsx), so the ` +
          `titlebar entry is what makes it reachable. Measured: ${raw(reachability)}`,
      )
      .toBe(true)
    expect
      .soft(
        reachability.work.artifactTabVisible,
        `Work: the Artifact panel is NOT reachable at real 200% page zoom, even through the narrow ` +
          `entry. Measured: ${raw(reachability)}`,
      )
      .toBe(true)
    expect
      .soft(
        reachability.assistant.entryVisible,
        `Assistant: no narrow entry to the mode panel at real 200% page zoom. Measured: ${raw(reachability)}`,
      )
      .toBe(true)
    expect
      .soft(
        reachability.assistant.panelVisible,
        `Assistant: the Assistant panel is NOT reachable at real 200% page zoom, even through the ` +
          `narrow entry. Measured: ${raw(reachability)}`,
      )
      .toBe(true)
  })
})

/* ---------------------------------------------------------------------------------------
 * App-facing setup. Mocked-but-real session data through the existing E3 helpers, copied
 * from `e2e/regression/mode-detail-personas.spec.ts` — the spec that already pins what
 * these two mode panels look like at desktop width.
 * ------------------------------------------------------------------------------------- */

const directory = "C:/Aigcfroge/RealZoom"
const projectID = "proj_real_zoom"
const workSessionID = "ses_real_zoom_work"
const assistantSessionID = "ses_real_zoom_assistant"
const WORK_TITLE = "Real zoom Work session"
const ASSISTANT_TITLE = "Real zoom Assistant session"
const server = `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const canonicalPath = (sessionID: string) => `/server/${base64Encode(server)}/session/${sessionID}`

const provider = {
  all: [
    {
      id: "zoom-provider",
      name: "Zoom Provider",
      source: "config",
      env: [],
      options: {},
      models: {
        "zoom-model": {
          id: "zoom-model",
          name: "Zoom Model",
          family: "zoom",
          release_date: "2026-09-01",
          status: "active",
          options: {},
          headers: {},
          limit: { context: 200_000, output: 16_000 },
        },
      },
    },
  ],
  connected: ["zoom-provider"],
  default: { "zoom-provider": "zoom-model" },
}

const project = {
  id: projectID,
  worktree: directory,
  vcs: "git",
  name: "real-zoom",
  time: { created: 1700000000000, updated: 1700000000000 },
  sandboxes: [],
}

const sessions = [
  {
    id: workSessionID,
    slug: "real-zoom-work",
    projectID,
    directory,
    title: WORK_TITLE,
    mode: "work",
    agent: "meta",
    permissionTier: "propose",
    presetCategoryId: null,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  },
  {
    id: assistantSessionID,
    slug: "real-zoom-assistant",
    projectID,
    directory,
    title: ASSISTANT_TITLE,
    mode: "assistant",
    agent: "assistant-orchestrator",
    permissionTier: "propose",
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  },
]

async function seedAppState(page: Page) {
  await page.addInitScript((worktree: string) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "aigcfroge.global.dat:server",
      JSON.stringify({ list: [], projects: { local: [{ worktree, expanded: true }] }, lastProject: {} }),
    )
  }, directory)
}

/**
 * Dev-server readiness with a longer budget than `APP_READY_TIMEOUT` (120s) in
 * `e2e/utils/waits.ts`.
 *
 * Measured on this repo's FUSE mount (4 of 4 Playwright runs, 2026-09-17): the shared
 * vite dev server stops answering for ~2-3 minutes once a Playwright run is underway,
 * while answering in ~10ms before and after. `expectDevServerReady` spent its whole
 * 120s budget inside such a window twice in a row, so the app-facing assertions below
 * wait the stall out rather than fail on it. This is the same probe, with the budget
 * that this environment actually needs.
 */
const DEV_SERVER_BUDGET_MS = 420_000

async function gotoApp(page: Page, baseURL: string, path: string) {
  await expect(async () => {
    const response = await fetch(new URL("/@vite/client", baseURL), { signal: AbortSignal.timeout(15_000) })
    expect(response.status, "dev server is not answering yet").toBe(200)
  }).toPass({ timeout: DEV_SERVER_BUDGET_MS, intervals: [500, 1_000, 2_000, 5_000] })
  await page.goto(path, { waitUntil: "commit", timeout: 60_000 })
}

/** Opens the session and returns the app page's own zoomed window certificate. */
async function openSession(page: Page, testInfo: TestInfo, sessionID: string, title: string) {
  const baseURL = testInfo.project.use.baseURL
  if (!baseURL) throw new Error("e2e/zoom requires a baseURL")
  await gotoApp(page, baseURL, canonicalPath(sessionID))
  await expectAppVisible(page.getByRole("heading", { name: title }))
  const window = await measureWindow(page)
  const appWindow = { sessionID, title, url: page.url(), ...window }
  // The session must actually be rendered, or "the panel is missing" would be
  // indistinguishable from "the page never loaded".
  expect(appWindow.innerWidth, `app page at 200% zoom should still be 720px wide: ${raw(appWindow)}`).toBe(
    ZOOMED_WINDOW.innerWidth,
  )
  expect(appWindow.mq768, `app page media query at 200% zoom: ${raw(appWindow)}`).toBe(false)
  return appWindow
}

/**
 * Open the session's mode content panel through the narrow entry.
 *
 * At 200% zoom the layout viewport is 720px, so the panel is in its narrow presentation and
 * closed by default; the entry is what makes it reachable. Returns whether the entry existed,
 * so a missing entry is reported as a missing entry rather than as a missing panel.
 */
async function openModePanel(page: Page) {
  const entry = page.locator("#session-mode-panel-toggle")
  const entryCount = await entry.count()
  const entryVisible = entryCount > 0 ? await entry.isVisible() : false
  if (entryVisible) await entry.click()
  return { entryCount, entryVisible }
}

async function measureArtifactPanel(page: Page) {
  const entry = await openModePanel(page)
  const tab = page.getByRole("tab", { name: "Artifact", exact: true })
  const panel = page.locator('#review-panel[aria-label="Artifact"]')
  return {
    ...entry,
    artifactTabCount: await tab.count(),
    artifactTabVisible: await tab.isVisible(),
    reviewPanelCount: await panel.count(),
    composerVisible: await page.locator('[data-component="session-composer"]').isVisible(),
  }
}

async function measureAssistantPanel(page: Page) {
  const entry = await openModePanel(page)
  const panel = page.locator('#review-panel[aria-label="Assistant panel"]')
  return {
    ...entry,
    panelCount: await panel.count(),
    panelVisible: await panel.isVisible(),
    composerVisible: await page.locator('[data-component="session-composer"]').isVisible(),
  }
}
