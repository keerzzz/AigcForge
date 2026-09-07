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
 * The parallel-worker cold-start timeouts the 2026-09-03 run recorded were contention on route
 * compilation, which this does not remove. What it removes is spending the whole budget to find
 * out the server was never there.
 */
export async function expectDevServerReady(page: Page) {
  await expect(async () => {
    const response = await page.request.get("/@vite/client")
    expect(response.status(), "dev server is not answering yet").toBe(200)
  }).toPass({ timeout: APP_READY_TIMEOUT, intervals: [250, 500, 1_000, 2_000] })
}

/** `page.goto` behind {@link expectDevServerReady}. */
export async function gotoWhenReady(page: Page, path: string, options?: Parameters<Page["goto"]>[1]) {
  await expectDevServerReady(page)
  await page.goto(path, options)
}
