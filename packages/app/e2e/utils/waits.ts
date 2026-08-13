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
