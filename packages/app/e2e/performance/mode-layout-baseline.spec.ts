import { expect, benchmark } from "./benchmark"
import { fixture, pageMessages } from "./timeline/session-timeline-stress.fixture"
import { mockAigcfrogeServer } from "../utils/mock-server"

const modes = ["chat", "coding", "work", "assistant"] as const
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 640, height: 900 },
] as const

benchmark("records Product Mode workspace geometry", async ({ page, report }, testInfo) => {
  await mockAigcfrogeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    events: () => [],
  })

  const results = []
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    for (const mode of modes) {
      await page.goto(`/mode/${mode}`)
      await expect(page.locator("[data-mode-workspace]")).toBeVisible()
      results.push({
        mode,
        viewport: viewport.name,
        ...(await page.evaluate(readGeometry)),
      })
    }
  }

  report({ browser: testInfo.project.name, viewports, results })
  expect(results).toHaveLength(modes.length * viewports.length)
})

function readGeometry() {
  const workspace = document.querySelector<HTMLElement>("[data-mode-workspace]")
  const grid = workspace?.firstElementChild
  const sidebar = grid?.firstElementChild
  const main = grid?.querySelector<HTMLElement>('section[aria-label="Main content"]')
  if (!(workspace && grid instanceof HTMLElement && sidebar instanceof HTMLElement && main)) {
    throw new Error("ModeWorkspace geometry nodes were not found")
  }

  const box = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
    }
  }

  return {
    gridTemplateColumns: getComputedStyle(grid).gridTemplateColumns,
    workspace: box(workspace),
    grid: box(grid),
    sidebar: box(sidebar),
    main: box(main),
  }
}
