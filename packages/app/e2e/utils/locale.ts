import type { Page } from "@playwright/test"

/**
 * Pin the UI to English for specs that locate controls by English labels.
 *
 * The zh/zht presentation projects select their locale through the project
 * storage state; this init script runs after that restore on every
 * navigation, so those projects still boot the app under their own locale
 * data while the spec asserts against stable English labels. Specs without
 * English-label assertions must not pin, so the matrix keeps genuine
 * localized runs.
 */
export function pinEnglishUI(page: Page) {
  return page.addInitScript(() => {
    localStorage.setItem("aigcfroge.global.dat:language", JSON.stringify({ locale: "en" }))
  })
}
