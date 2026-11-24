import type { Page } from "@playwright/test"
import { base64Encode } from "@omnixa/util/encode"
import { mockOmnixaServer } from "../../utils/mock-server"
import { expectSessionTitle } from "../../utils/waits"
import { benchmark, benchmarkDiagnostics, expect } from "../benchmark"
import { fixture, installStressSessionTabs, installTimelineSettings } from "../../utils/session-fixture"
import { seed, sessionHref } from "../../utils/app"
import { expected, messages } from "../../utils/markdown-sessions"
import { workload } from "./session-tab-switch.fixture"
import { createReviewDiffs } from "./timeline-test-helpers"
import { measureSessionSwitch, waitForStableTimeline } from "./session-tab-switch-probe"

const scenarios = [
  { cache: "cold", review: "closed" },
  { cache: "cold", review: "open" },
  { cache: "warm", review: "closed" },
  { cache: "warm", review: "open" },
  { cache: "warm", review: "resized" },
] as const

const viewport = { width: 1440, height: 900 }
const resizedViewport = { width: 1096, height: 900 }

const reviewDiffs = createReviewDiffs()

benchmark.use({ viewport, video: "off", trace: "off", serviceWorkers: "block", traceScope: "interaction" })

scenarios.forEach((scenario) => {
  benchmark(`tab switch: ${scenario.cache}, review ${scenario.review}`, async ({ page, report }, testInfo) => {
    const reviewOpen = scenario.review !== "closed"
    const requests = await prepareSessionTabs(page, reviewOpen)
    const chat = page.locator('[data-slot="session-chat-panel"]')
    const initialTimelineWidth = await chat.evaluate((panel) => panel.getBoundingClientRect().width)

    if (scenario.cache === "warm") {
      await switchSession(page, fixture.targetID, fixture.expected.targetTitle)
      await expectReviewPane(page, reviewOpen)
      await expectReadyTimeline(page, fixture.targetID)
      expect(await chat.evaluate((panel) => panel.getBoundingClientRect().width)).toBeCloseTo(initialTimelineWidth, 1)
      await switchSession(page, fixture.sourceID, fixture.expected.sourceTitle)
    }

    if (scenario.review === "resized") {
      // Both cached sessions retain Review; resize while the destination is inactive.
      await page.setViewportSize(resizedViewport)
      await expect
        .poll(() => chat.evaluate((panel) => panel.getBoundingClientRect().width))
        .toBeLessThan(initialTimelineWidth)
    }
    await expectReviewPane(page, reviewOpen)
    await expectReadyTimeline(page, fixture.sourceID)
    const switchedTimelineWidth = await chat.evaluate((panel) => panel.getBoundingClientRect().width)
    await benchmarkDiagnostics(page).startTrace()
    const requestsBefore = requests.length

    const result = await measureSessionSwitch(page, {
      destinationIDs: messages[fixture.targetID].map((message) => message.id),
      sourceIDs: messages[fixture.sourceID].map((message) => message.id),
      lastID: expected[fixture.targetID].lastID,
      requiredPartID: expected[fixture.targetID].answerID,
      href: sessionHref(fixture.targetID),
      switch: async () => {
        await switchSession(page, fixture.targetID, fixture.expected.targetTitle)
        await expectReviewPane(page, reviewOpen)
      },
    })

    expect(result.firstCorrectObservedMs).not.toBeNull()
    expect(result.stableObservedMs).not.toBeNull()
    expect(requests).toHaveLength(requestsBefore + (scenario.cache === "cold" ? 1 : 0))
    await expectReadyTimeline(page, fixture.targetID)
    expect(await chat.evaluate((panel) => panel.getBoundingClientRect().width)).toBeCloseTo(switchedTimelineWidth, 1)
    report(
      {
        ...result,
        messageRequestsDuringSwitch: requests.length - requestsBefore,
        rendererMemory: process.env.OMNIXA_PERFORMANCE_MEMORY === "1" ? await retainedRendererMemory(page) : undefined,
      },
      {
        ...scenario,
        ...workload,
        viewport: page.viewportSize(),
        preparedViewport: viewport,
        warmedTimelineWidth: scenario.cache === "warm" ? initialTimelineWidth : undefined,
        switchedTimelineWidth,
        browserVersion: page.context().browser()!.version(),
        serviceWorkers: "blocked",
        reviewFiles: scenario.review === "closed" ? 0 : reviewDiffs.length,
        data: scenario.cache === "cold" ? "on-demand" : "cached",
        transport: process.env.OMNIXA_PERFORMANCE_HTTP_FIXTURE === "1" ? "http" : "playwright-route",
        inputEvent: "mousedown",
        requireReadyAnswer: true,
      },
    )

    if (testInfo.repeatEachIndex === 0) {
      await page.screenshot({ path: testInfo.outputPath("destination.png") })
      await testInfo.attach("destination", { path: testInfo.outputPath("destination.png"), contentType: "image/png" })
    }
  })
})

async function prepareSessionTabs(page: Page, reviewOpen: boolean) {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "GET") return
    const match = new URL(request.url()).pathname.match(/^\/api\/session\/([^/]+)\/message$/)

    if (match) requests.push(decodeURIComponent(match[1]))
  })

  if (process.env.OMNIXA_PERFORMANCE_HTTP_FIXTURE !== "1")
    await mockOmnixaServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      // Return the full history so every scenario exercises a long loaded timeline.
      pageMessages: (sessionID) => ({ items: messages[sessionID] ?? [] }),
      vcsDiff: reviewDiffs,
    })
  await installTimelineSettings(page)
  await installStressSessionTabs(page)
  await seed(page, {
    panes: Object.fromEntries([fixture.sourceID, fixture.targetID].map((id) => [id, { review: reviewOpen }])),
    storage: {
      "omnixa.global.dat:layout": {
        sessionTabs: Object.fromEntries(
          [fixture.sourceID, fixture.targetID].map((id) => [
            `local\u0000${base64Encode(fixture.directory)}/${id}`,
            reviewOpen ? { all: ["review:changes"], active: "review:changes" } : { all: [] },
          ]),
        ),
      },
    },
  })
  await page.goto(sessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await expectReviewPane(page, reviewOpen)
  await expectReadyTimeline(page, fixture.sourceID)
  await expect(page.locator(`[data-timeline-part-id="${expected[fixture.targetID].answerID}"]`)).toHaveCount(0)
  expect(requests).toEqual([fixture.sourceID])

  return requests
}

async function expectReadyTimeline(page: Page, sessionID: string) {
  const answer = page.locator(`[data-timeline-part-id="${expected[sessionID].answerID}"]`)
  await expect(answer.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
  await expect(answer.getByRole("table")).toHaveCount(1)
  await expect(answer.locator("pre")).toHaveCount(4)
  await expect
    .poll(() => answer.evaluate((element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })))
    .toBe(true)
  await waitForStableTimeline(page, expected[sessionID].lastID)
  await expect(page.locator('[data-timeline-key] [data-component="markdown"]:not([data-markdown-ready])')).toHaveCount(
    0,
  )
}

async function switchSession(page: Page, sessionID: string, title: string) {
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${sessionHref(sessionID)}"]`)
  await expect(tab).toHaveCount(1)
  await tab.click()
  await expectSessionTitle(page, title)
}

async function expectReviewPane(page: Page, open: boolean) {
  await expect(page.getByRole("button", { name: "Toggle review", exact: true })).toHaveAttribute(
    "aria-expanded",
    String(open),
  )
  const review = page.locator("#session-side-panel-review-tabpanel")
  if (!open) {
    await expect(review).toBeHidden()
    return
  }
  await expect(page.locator("#session-side-panel-review-tab")).toHaveAttribute("aria-selected", "true")
  await expect(review).toBeVisible()
  await expect(review).toContainText("generated-000.ts")
  await expect(review).toContainText("+3")
  await expect(review.locator('[data-component="file"][data-mode="diff"]')).toBeVisible()
  await page.locator('[data-slot="session-chat-panel"]').evaluate(async (panel) => {
    await Promise.all(panel.getAnimations().map((animation) => animation.finished))
  })
}

async function retainedRendererMemory(page: Page) {
  const cdp = await page.context().newCDPSession(page)

  try {
    await cdp.send("HeapProfiler.collectGarbage")

    return {
      heap: await cdp.send("Runtime.getHeapUsage"),
      dom: await cdp.send("Memory.getDOMCounters"),
    }
  } finally {
    await cdp.detach()
  }
}
