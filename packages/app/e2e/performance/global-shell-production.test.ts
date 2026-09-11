import { expect, benchmark } from "./benchmark"
import { fixture, pageMessages } from "./timeline/session-timeline-stress.fixture"
import { mockAigcfrogeServer } from "../utils/mock-server"

benchmark("production global shell omits development diagnostics", async ({ page, report }) => {
  await mockAigcfrogeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    events: () => [],
  })

  await page.goto("/")
  await expect(page.locator("header")).toBeVisible()
  await expect(page.locator('[data-component="status-bar"]')).toBeVisible()
  await expect(page.locator('[data-component="debug-bar"]')).toHaveCount(0)
  report({ shellVisible: true, debugBarCount: 0 })
})
