import { fileURLToPath } from "node:url"
import { defineConfig, devices } from "@playwright/test"
import { PRESENTATION_GREP } from "./e2e/presentation-matrix"

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const command = `bun run dev -- --host 0.0.0.0 --port ${port}`
const reuse = !process.env.CI
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? 5 : 0)) || undefined

// Presentation matrix storage state is derived from baseURL so the origin
// never drifts from the dev server (a hardcoded port here would silently stop
// applying theme/locale the day the port moves). Raw values, not JSON-wrapped:
// `aigcfroge-color-scheme` is read as the bare "dark"/"light" string
// (ui/src/theme/context.tsx:264) and `aigcfroge.global.dat:language` is the
// persisted `{ locale }` blob (app/src/context/language.tsx:186).
const origin = new URL(baseURL).origin
const storageState = (entries: Array<[string, string]>) => ({
  cookies: [],
  origins: [{ origin, localStorage: entries.map(([name, value]) => ({ name, value })) }],
})

export default defineConfig({
  testDir: "./e2e",
  // Warm the cold route graph before the round — see e2e/global-setup.ts and
  // docs/technical-debt.md §8 (`e2e-readiness-predicate-flake`). The dev server is already
  // up here: webServer plugins run in the plugin-setup phase, before globalSetup.
  globalSetup: fileURLToPath(new URL("./e2e/global-setup.ts", import.meta.url)),
  // `performance/**` belongs to the production-bench config; `real/**` belongs
  // to the real-backend E4 config (e2e/real/playwright.config.ts); `zoom/**`
  // belongs to the real-page-zoom config (e2e/zoom/playwright.config.ts), which
  // needs a seeded persistent profile this config cannot express. None is
  // collected by this E3/E2 presentation config.
  testIgnore: [
    "unit/**",
    ...(process.env.AIGCFROGE_PERFORMANCE === "1"
      ? ["performance/**/*.test.ts"]
      : ["performance/**", "real/**", "zoom/**"]),
  ],
  outputDir: "./e2e/test-results",
  // Generous per-test budget: the Vite dev server cold-compiles routes on
  // demand, and the branch's assistant dashboard (imported by the app-wide
  // mode-surface registry) grew the first-page bundle — 60s routinely timed
  // out on slow CI runners mid-suite.
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  webServer: {
    command,
    url: baseURL,
    reuseExistingServer: reuse,
    timeout: 120_000,
    env: {
      VITE_AIGCFROGE_SERVER_HOST: serverHost,
      VITE_AIGCFROGE_SERVER_PORT: serverPort,
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Business suite: everything runs here. The other four projects filter on
      // `PRESENTATION_GREP` — see e2e/presentation-matrix.ts for why.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-dark",
      grep: PRESENTATION_GREP,
      use: {
        ...devices["Desktop Chrome"],
        storageState: storageState([["aigcfroge-color-scheme", "dark"]]),
      },
    },
    {
      name: "chromium-zh",
      grep: PRESENTATION_GREP,
      use: {
        ...devices["Desktop Chrome"],
        storageState: storageState([["aigcfroge.global.dat:language", '{"locale":"zh"}']]),
      },
    },
    {
      name: "chromium-zht",
      grep: PRESENTATION_GREP,
      use: {
        ...devices["Desktop Chrome"],
        storageState: storageState([["aigcfroge.global.dat:language", '{"locale":"zht"}']]),
      },
    },
    {
      name: "chromium-narrow",
      grep: PRESENTATION_GREP,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})
