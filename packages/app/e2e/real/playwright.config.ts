/**
 * Real-backend E4 config — deliberately standalone. It does NOT import the root
 * `playwright.config.ts` (that inheritance would pull in `reuseExistingServer`,
 * `retries: CI ? 2 : 0`, and a dev-server webServer, all wrong for E4).
 *
 * Every E4 run gets three fresh loopback ports (deterministic provider, real
 * backend, production preview) and a temp run dir; the orchestrator started as
 * the single webServer command owns backend, preview, and provider lifecycle.
 * The app talks to the real backend through the localStorage registry seeded by
 * the fixture — the production build itself carries no port.
 */
import { fileURLToPath } from "node:url"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { defineConfig, devices } from "@playwright/test"
import { freePortSync } from "./ports"

const here = path.dirname(fileURLToPath(import.meta.url))

// Playwright workers re-import this config, so allocation must be idempotent:
// the main process allocates once and publishes via env; workers inherit the
// env and skip straight to the same ports. A fresh allocation inside a worker
// would desync it from the orchestrator's webServer.
const providerPort = Number(process.env.E4_PROVIDER_PORT) || freePortSync()
const backendPort = Number(process.env.E4_BACKEND_PORT) || freePortSync()
const previewPort = Number(process.env.E4_PREVIEW_PORT) || freePortSync()
const runDir = process.env.E4_RUN_DIR || mkdtempSync(path.join(tmpdir(), "aigcfroge-e4-"))
const env = {
  E4_V2_RUNTIME: process.env.E4_V2_RUNTIME ?? "",
  E4_PROVIDER_PORT: String(providerPort),
  E4_BACKEND_PORT: String(backendPort),
  E4_PREVIEW_PORT: String(previewPort),
  E4_RUN_DIR: runDir,
}
// The specs and global teardown run in this process — env is their channel to
// the orchestrator's runtime manifest.
Object.assign(process.env, env)

export default defineConfig({
  testDir: here,
  outputDir: path.join(here, "test-results"),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  globalTeardown: path.join(here, "global-teardown.ts"),
  reporter: [["html", { outputFolder: path.join(here, "playwright-report"), open: "never" }], ["line"]],
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-real",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `bun ${path.join(here, "orchestrator.ts")}`,
    url: `http://127.0.0.1:${previewPort}`,
    reuseExistingServer: false,
    // Without `gracefulShutdown`, Playwright skips SIGTERM entirely and
    // SIGKILLs the process group — the orchestrator's teardown report would
    // never be written. SIGTERM + 30s is what the orchestrator's signal
    // handler (stop children → probe ports → write report) is built for.
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
    // Worst case on a cold win_data mount: full vite build + cold bun
    // transpile of the backend (measured >240s once). Warm runs finish in
    // ~2-4 minutes; the budget is a ceiling, readiness is still polled.
    timeout: 900_000,
    env,
  },
})
