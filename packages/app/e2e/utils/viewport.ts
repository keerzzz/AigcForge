import type { Page } from "@playwright/test"

/**
 * Pin the desktop viewport for specs whose assertions assume desktop geometry.
 *
 * The chromium-narrow presentation project runs at 390x844, where the app
 * renders its mobile layout (hidden sidebars, mobile tab branch — the same
 * phenomenon documented in markdown-sanitize.spec.ts). Pinned specs still boot
 * under the narrow project but assert against desktop geometry; specs that
 * genuinely test narrow layouts (mode-slot-fallback-a11y.spec.ts) set their
 * own viewport deliberately and must not pin.
 */
export function pinDesktopViewport(page: Page) {
  return page.setViewportSize({ width: 1280, height: 720 })
}
