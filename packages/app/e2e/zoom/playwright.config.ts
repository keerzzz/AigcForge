/**
 * Real-browser-zoom evidence suite — deliberately standalone, like the E4 config.
 *
 * It cannot inherit the shared E3 config: that config's `use.viewport` (and every
 * project in it) pins the layout viewport, which nullifies a seeded page zoom, and
 * this suite needs a persistent profile seeded BEFORE launch. See `zoom-profile.ts`
 * for the proven recipe and `fixtures.ts` for the launcher.
 *
 * The dev server is expected to already be running on `PLAYWRIGHT_PORT` (a warm
 * `bun run dev` on the 127.0.0.1:3000 default). `reuseExistingServer` is
 * unconditional and the command is `--strictPort`: this suite must never kill or
 * compete with the server other suites share.
 */
import { defineConfig } from "@playwright/test"
import { DESKTOP_BREAKPOINT, ZOOM_HOST } from "./zoom-profile"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)

// The host MUST be the literal `127.0.0.1`: the seed is keyed by the bare host
// string, and `localhost` is a different key that is not zoomed. A `localhost`
// baseURL would silently turn the "200%" test into an unzoomed one.
if (process.env.PLAYWRIGHT_BASE_URL) {
  const hostname = new URL(process.env.PLAYWRIGHT_BASE_URL).hostname
  if (hostname !== ZOOM_HOST) {
    throw new Error(
      `e2e/zoom requires a baseURL on ${ZOOM_HOST} (got ${hostname}); the seeded zoom entry is keyed by the bare host, ` +
        `and "localhost" is a different key that is not zoomed`,
    )
  }
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${ZOOM_HOST}:${port}`

export default defineConfig({
  testDir: ".",
  // One browser, one seeded profile at a time: the profile seed and the window
  // measurement are machine-level facts, and vite on this mount is slow.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // The zoom questions are answered by a failing run; re-running a red product
  // contract must not turn into "flaky".
  forbidOnly: !!process.env.CI,
  // The product half of the 200% test has to wait out the dev-server stalls measured
  // on this mount (see `DEV_SERVER_BUDGET_MS` in the spec), which is minutes, not
  // seconds — the certificate half needs only a few.
  timeout: 480_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  reporter: [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    // Tracing/video are not available here: they are wired by the base `context`
    // fixture, which `fixtures.ts` replaces with the launching one. Failures attach
    // a screenshot from the fixture instead.
    trace: "off",
  },
  projects: [
    {
      // No `...devices[...]`: device descriptors carry a viewport, and any viewport
      // (including `userAgent`/`deviceScaleFactor` overrides) is exactly the thing
      // that would nullify the seed. Everything the browser needs is in the fixture.
      name: `chromium-real-zoom-${DESKTOP_BREAKPOINT}`,
    },
  ],
  webServer: {
    command: `bun run dev -- --host 0.0.0.0 --port ${port} --strictPort`,
    url: baseURL,
    // Never start a competing server: if this URL is already answering (it is, by
    // design — the shared warm dev server), Playwright reuses it and never runs the
    // command. `--strictPort` keeps a start that does happen from drifting ports.
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
