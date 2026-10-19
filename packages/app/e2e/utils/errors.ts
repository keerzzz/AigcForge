import { expect, type Page } from "@playwright/test"

export function trackPageErrors(page: Page, expected: Array<{ url: string; status: number }> = []) {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() !== "error") return
    const url = message.location().url
    const detail = url ? `${message.text()} (${url})` : message.text()
    const match = expected.some(
      (item) =>
        item.url === url &&
        message.text() === `Failed to load resource: the server responded with a status of ${item.status} (Not Found)`,
    )
    if (match) {
      console.log(`[expected-browser-error] ${detail}`)
      return
    }
    errors.push(detail)
  })
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  return errors
}

/** Accepted non-Custom composition-read debt (§15.56/§15.76). Only named
 * Session URLs qualify; other 404s, statuses and application errors still fail.
 * The shared mock's typed 404 body is verified by mock-server-projections.spec.ts. */
export function snapshotMisses(directory: string, sessionIDs: string[]) {
  const host = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
  const port = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  return sessionIDs.map((id) => ({
    url: `http://${host}:${port}/session/${id}/composition?directory=${encodeURIComponent(directory)}`,
    status: 404,
  }))
}

export function expectNoSmokeErrors(consoleErrors: string[], toastErrors: string[], forbiddenText: string[]) {
  expect({ consoleErrors, toastErrors, forbiddenText }).toEqual({
    consoleErrors: [],
    toastErrors: [],
    forbiddenText: [],
  })
}
