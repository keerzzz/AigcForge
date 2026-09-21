import { expect, type Locator, type Page } from "@playwright/test"

// Long enough for the app dev server to cold-compile a route under CI load.
// The app bundle grew with the assistant dashboard (imported by the app-wide
// mode-surface registry), and Vite compiles routes on demand — a fresh CI
// runner with parallel e2e workers routinely exceeds 60s for the first page.
export const APP_READY_TIMEOUT = 120_000

export async function expectAppVisible(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: APP_READY_TIMEOUT })
}

export async function expectSessionTitle(page: Page, title: string) {
  await expectAppVisible(page.getByRole("heading", { name: title }))
}

/**
 * Wait until the dev server actually answers, then navigate.
 *
 * The 120s budget above is a backstop for a genuinely slow cold compile; it is not a readiness
 * signal, and a server that is not up at all also spends it before failing with a navigation
 * timeout that says nothing about why. `/@vite/client` is served by the dev server itself, so a
 * 200 from it is proof the server is listening and past its own startup — polled, not slept,
 * and reported as a server problem rather than an app problem when it never arrives.
 *
 * The probe is a Node-side `fetch`, deliberately NOT `page.request`: the latter shares the
 * browser context, and every spec that installs a `page.route` mock before navigating routes
 * this request through that mock. Four occurrences in one session had it time out at 120s
 * while the same URL answered in ~25ms from a shell on the same host, and it blocked both a
 * single spec and a 12-test matrix run. Node's fetch cannot be intercepted, so the signal now
 * means what it says. (Registered in docs/technical-debt.md §8; this is that row's unlock.)
 *
 * The parallel-worker cold-start timeouts the 2026-09-03 run recorded were contention on route
 * compilation, which this does not remove. What it removes is spending the whole budget to find
 * out the server was never there.
 */
export async function expectDevServerReady() {
  const port = process.env.PLAYWRIGHT_PORT ?? "3000"
  const base = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
  await expect(async () => {
    const response = await fetch(new URL("/@vite/client", base))
    expect(response.status, "dev server is not answering yet").toBe(200)
  }).toPass({ timeout: APP_READY_TIMEOUT, intervals: [250, 500, 1_000, 2_000] })
}

/**
 * `page.goto` behind {@link expectDevServerReady}.
 *
 * The cold first round of a dev server can spend this whole budget on module compilation — the
 * long-lived, FUSE-backed server queues even static paths while it compiles — and the case that
 * pays for it is the FIRST of the round. That is a known, measured environment property with an
 * owner, not a product signal: `docs/technical-debt.md` §8 records the mechanism and prescribes
 * warming the server (hit the target route until first paint) or re-running the case warm
 * (~28s) rather than enlarging this budget, which would also slow down catching a server that is
 * genuinely down.
 */
export async function gotoWhenReady(page: Page, path: string, options?: Parameters<Page["goto"]>[1]) {
  await expectDevServerReady()
  await page.goto(path, options)
}
