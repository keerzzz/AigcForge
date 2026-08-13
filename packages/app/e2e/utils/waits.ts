import { expect, type Locator, type Page } from "@playwright/test"

// Long enough for the app dev server to cold-compile the route under CI load
// (a full 47-test e2e run can leave the server slow late in the order).
export const APP_READY_TIMEOUT = 60_000

export async function expectAppVisible(locator: Locator) {
  await expect(locator).toBeVisible({ timeout: APP_READY_TIMEOUT })
}

export async function expectSessionTitle(page: Page, title: string) {
  await expectAppVisible(page.getByRole("heading", { name: title }))
}
