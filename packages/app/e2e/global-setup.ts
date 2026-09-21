/**
 * E3/E2 global setup — warm the dev server before the round.
 *
 * WHY THIS EXISTS (docs/technical-debt.md §8, `e2e-readiness-predicate-flake`):
 * the cold first case of a round pays for Vite compiling the whole route module graph on the
 * server's single event loop, so even a static `GET /@vite/client` queues behind it and
 * `expectDevServerReady` spends its 120s budget. Warming that round from the harness — instead
 * of leaving a scratch script outside it, which is what S7 did — is the ledger's first option.
 *
 * ORDERING FACT (playwright@1.59.1, verified in `node_modules/playwright/lib/runner/`):
 * `testRunner.js:331/372` pushes `webServerPluginsForConfig(config)` into `config.plugins`, and
 * `tasks.js:105` runs `createPluginSetupTasks(config)` — which starts and health-checks the
 * webServer — BEFORE `config.globalSetups`. So the server is already answering when this runs.
 *
 * WHAT "WARM" MEANS HERE: Vite compiles modules on request, so the thing to force is the module
 * graph, not a successful render. These routes are visited with no backend mock installed
 * (global setup runs before any spec's `page.route`), so the app may show its own empty/error
 * state — that is fine and expected. The navigation is still what makes Vite compile and cache
 * `pages/session.tsx`, the mode-surface registry, and the session panels, which is exactly the
 * work the first real case would otherwise pay for inside its readiness budget.
 *
 * The timeout is deliberately large and its failure is NOT fatal: if warming cannot reach a
 * route on a loaded host, the case that needs it still has its own budget. Warming is an
 * optimisation of the cold round, never a new gate that can fail a suite.
 */
import { chromium, type Browser } from "@playwright/test"

// Shell routes plus the two module graphs the mode content panels hang off: `/mode/:mode`
// (the shared ModeWorkspace and every mode's slot) and a session-detail URL (the session page
// and its side panels). The session URL needs no real session to compile its modules.
const ROUTES = [
  "/",
  "/mode/chat",
  "/mode/coding",
  "/mode/work",
  "/mode/assistant",
  "/mode/custom",
  "/server/warmup/session/warmup",
] as const

// Generous because a cold route on a loaded host is exactly the cost being paid; the per-case
// budget stays where it is, so this cannot silently widen a real failure.
const ROUTE_TIMEOUT = 180_000

/**
 * The signal is network activity, not a timer.
 *
 * Vite compiles a module when it is first requested, so "the compile burst is over" is
 * observable as "this page has stopped issuing dev-server requests". `networkidle` is
 * Playwright's own readiness predicate for exactly that (no in-flight connections for a quiet
 * window); the module-response counter below is what proves the graph was actually requested,
 * so a route that answered `domcontentloaded` without ever importing anything cannot pass as
 * warmed. There is no fixed sleep: a fast route finishes as soon as its graph settles.
 */
async function warmRoute(browser: Browser, base: string, route: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const started = Date.now()
  let modules = 0
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname
    if (response.status() >= 200 && response.status() < 400 && /\/(src|@fs|node_modules\/\.vite)\//.test(path)) {
      modules += 1
    }
  })
  try {
    await page.goto(new URL(route, base).toString(), { waitUntil: "domcontentloaded", timeout: ROUTE_TIMEOUT })
    // Wait for the module graph to stop fetching. `networkidle` is a network predicate, and the
    // timeout is a ceiling for a genuinely stuck route, not a per-route cost.
    await page.waitForLoadState("networkidle", { timeout: ROUTE_TIMEOUT })
    console.log(`[warmup] ${route} ${Date.now() - started}ms modules=${modules}`)
  } catch (error) {
    // Not fatal: see the module note. A route that could not be warmed keeps paying its own
    // cold cost inside the case that needs it.
    const reason = error instanceof Error ? error.message : String(error)
    console.log(`[warmup] ${route} failed after ${Date.now() - started}ms modules=${modules}: ${reason}`)
  } finally {
    await context.close().catch(() => {})
  }
}

export default async function globalSetup() {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`
  const browser = await chromium.launch()
  try {
    for (const route of ROUTES) await warmRoute(browser, base, route)
  } finally {
    await browser.close().catch(() => {})
  }
}
