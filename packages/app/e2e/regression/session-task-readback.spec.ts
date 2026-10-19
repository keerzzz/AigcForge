import { expect, test, type Page, type Request, type Response, type TestInfo } from "@playwright/test"
import type { SessionStatus, SessionTaskInfo } from "@aigcfroge/sdk/v2"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { createTimelineSseTransport } from "../performance/timeline/session-timeline-sse"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockAigcfrogeServer, type MockServerConfig } from "../utils/mock-server"
import { pinEnglishUI } from "../utils/locale"

type EventPayload = { directory: string; payload: Record<string, unknown> }
type Transport = Awaited<ReturnType<typeof createTimelineSseTransport<EventPayload>>>
type ReadReply = { kind: "ok"; tasks: SessionTaskInfo[] } | { kind: "error" } | { kind: "abort" }
type HeldRead = {
  label: string
  path?: string
  afterStart?: () => void
  request?: Request
  response?: Response
  capturedTasks?: NonNullable<MockServerConfig["tasks"]>
  failure?: string
  reply: ReturnType<typeof Promise.withResolvers<ReadReply>>
  released: boolean
}

const taskPath = `/session/${fixture.sourceID}/task`
const selectors = {
  strip: '[data-component="session-todo-progress"]',
  node: '[data-component="session-todo-progress-node"]',
  stats: '[data-component="session-todo-progress-stats"]',
  panel: '[data-component="session-todo-progress-panel"]',
}

function task(revision: number): SessionTaskInfo {
  return {
    id: "tsk_fe01_readback",
    sessionID: fixture.sourceID,
    agentID: "build",
    content: `FE-01 revision ${revision}`,
    status: revision > 1 ? "completed" : "pending",
    priority: "medium",
    revision,
    createdAt: 1700000000000,
    updatedAt: 1700000000000 + revision,
  }
}

for (const empty of [false, true]) {
  test(`FE-01: later ${empty ? "empty" : "newer"} GET wins after A renders`, async ({ page }, info) => {
    await withReadback(page, info, async (scenario) => {
      const reads = await scenario.overlap(empty ? [] : [task(2)])
      await scenario.finish(reads.a, { kind: "ok", tasks: [task(1)] })
      // Reachability witness, not a copied arbitration function: B has already
      // started and the real Task strip must show A before B is released.
      await scenario.expectTasks([task(1)], "A-rendered-while-B-held")
      await scenario.finish(reads.b, { kind: "ok", tasks: empty ? [] : [task(2)] })
      await scenario.expectTasks(empty ? [] : [task(2)], "B-is-authoritative")
      expect(scenario.started()).toEqual(["A", "B"])
      if (empty) {
        scenario.publishTasks([task(3)])
        await scenario.expectTasks([task(3)], "empty-result-positive-control")
        return
      }
      await scenario.expectWriteRevision(2)
    })
  })

  test(`FE-01: earlier GET cannot replace B-first ${empty ? "clear" : "data"}`, async ({ page }, info) => {
    await withReadback(page, info, async (scenario) => {
      const reads = await scenario.overlap(empty ? [] : [task(2)])
      await scenario.finish(reads.b, { kind: "ok", tasks: empty ? [] : [task(2)] })
      await scenario.expectTasks(empty ? [] : [task(2)], "B-rendered-before-A")
      await scenario.finish(reads.a, { kind: "ok", tasks: [task(1)] })
      await scenario.renderBarrier("A-body-finished")
      await scenario.expectTasks(empty ? [] : [task(2)], "late-A-does-not-replace-B")
      expect(scenario.started()).toEqual(["A", "B"])
    })
  })

  test(`FE-01: task.updated ${empty ? "clear" : "update"} invalidates both held GETs`, async ({ page }, info) => {
    await withReadback(page, info, async (scenario) => {
      const reads = await scenario.overlap()
      scenario.publishTasks(empty ? [] : [task(3)])
      await scenario.expectTasks(empty ? [] : [task(3)], "SSE-rendered-before-GETs")
      await scenario.finish(reads.a, { kind: "ok", tasks: [task(1)] })
      await scenario.finish(reads.b, { kind: "ok", tasks: [task(2)] })
      await scenario.renderBarrier("both-old-bodies-finished")
      await scenario.expectTasks(empty ? [] : [task(3)], "SSE-remains-authoritative")
      expect(scenario.started()).toEqual(["A", "B"])
    })
  })
}

test("FE-01: a failed B preserves A and does not poison the next read", async ({ page }, info) => {
  await withReadback(page, info, async (scenario) => {
    const reads = await scenario.overlap()
    await scenario.finish(reads.a, { kind: "ok", tasks: [task(1)] })
    await scenario.expectTasks([task(1)], "A-rendered-before-B-failure")
    await scenario.finish(reads.b, { kind: "error" })
    await scenario.renderBarrier("B-error-body-finished")
    await scenario.expectTasks([task(1)], "failed-B-does-not-clear")
    const recovery = await scenario.begin("C", { type: "busy" }, [task(3)])
    scenario.publishStatus({ type: "idle" })
    await scenario.renderBarrier("C-started")
    await scenario.finish(recovery, { kind: "ok", tasks: [task(3)] })
    await scenario.expectTasks([task(3)], "next-explicit-read-recovers")
    expect(scenario.started()).toEqual(["A", "B", "C"])
  })
})

test("FE-01: cold strip seed and Page recovery share the same read order", async ({ page }, info) => {
  await withReadback(
    page,
    info,
    async (scenario) => {
      const reads = await scenario.coldOverlap()
      await scenario.finish(reads.a, { kind: "ok", tasks: [task(1)] })
      await scenario.expectTasks([task(1)], "cold-seed-rendered")
      await scenario.finish(reads.b, { kind: "ok", tasks: [task(2)] })
      await scenario.expectTasks([task(2)], "Page-read-replaces-cold-seed")
      expect(scenario.started()).toEqual(["cold-strip", "Page"])
    },
    { prime: false },
  )
})

for (const hubFirst of [false, true]) {
  test(`FE-01: Hub and Page full-list reads share ordering (hubFirst=${hubFirst})`, async ({ page }, info) => {
    await withReadback(page, info, async (scenario) => {
      const a = hubFirst
        ? await scenario.beginHub("A", [task(1)])
        : await scenario.begin("A", { type: "busy" }, [task(1)])
      const b = hubFirst ? await scenario.begin("B", { type: "busy" }, []) : await scenario.beginHub("B", [])
      scenario.publishStatus({ type: "idle" })
      await scenario.finish(b, { kind: "ok", tasks: [] })
      await scenario.expectTasks([], "newer-cross-reader-clear-rendered")
      await scenario.finish(a, { kind: "ok", tasks: [task(1)] })
      await scenario.renderBarrier("cross-reader-old-body-finished")
      await scenario.expectTasks([], "old-cross-reader-cannot-revive")
      expect(scenario.started()).toEqual(["A", "B"])
    })
  })
}

test("FE-01: Composer stop clears tasks and neither held read can revive them", async ({ page }, info) => {
  await withReadback(page, info, async (scenario) => {
    const reads = await scenario.overlap([task(2)], false)
    const abort = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === `/session/${fixture.sourceID}/abort` && request.method() === "POST",
    )
    await page.getByRole("button", { name: "Stop", exact: true }).click()
    await abort
    await scenario.expectTasks([], "Composer-explicit-clear")
    scenario.publishStatus({ type: "idle" })
    await scenario.finish(reads.a, { kind: "ok", tasks: [task(1)] })
    await scenario.finish(reads.b, { kind: "ok", tasks: [task(2)] })
    await scenario.renderBarrier("post-abort-old-bodies-finished")
    await scenario.expectTasks([], "explicit-clear-remains")
  })
})

test("FE-01: a delayed Task event cannot undo an authoritative clear", async ({ page }, info) => {
  await withReadback(page, info, async (scenario) => {
    scenario.publishTasks([])
    await scenario.expectTasks([], "authoritative-clear")
    const before = scenario.eventReads()
    scenario.publishTasks([task(1)], [])
    await scenario.renderBarrier("delayed-data-event-after-clear")
    await expect.poll(scenario.eventReads).toBeGreaterThan(before)
    await scenario.expectTasks([], "stale-event-reloads-current-empty-list")
  })
})

test("FE-01: reconnect invalidates held Session reads before a new full snapshot", async ({ page }, info) => {
  await withReadback(page, info, async (scenario) => {
    const reads = await scenario.overlap()
    await scenario.reconnect([])
    await scenario.expectTasks([], "reconnected-authoritative-clear")
    await scenario.finish(reads.b, { kind: "ok", tasks: [task(2)] })
    await scenario.finish(reads.a, { kind: "ok", tasks: [task(1)] })
    await scenario.renderBarrier("old-generation-bodies-finished")
    await scenario.expectTasks([], "old-connection-reads-rejected")
  })
})

test("FE-01: leaving and reopening the Session does not admit a previous visit's read", async ({ page }, info) => {
  await withReadback(
    page,
    info,
    async (scenario) => {
      const a = await scenario.begin("A", { type: "busy" }, [task(1)])
      scenario.publishStatus({ type: "idle" })
      await scenario.visitOtherSession()
      await scenario.returnToSource()
      await scenario.finishAborted(a)
      await scenario.renderBarrier("previous-visit-request-settled")
      await scenario.expectTasks([task(0)], "previous-visit-does-not-overwrite-cache")
    },
    { navigation: true },
  )
})

async function withReadback(
  page: Page,
  info: TestInfo,
  run: (scenario: ReturnType<typeof createReadbackScenario>) => Promise<void>,
  options: { prime?: boolean; navigation?: boolean } = {},
) {
  const transport = await createTimelineSseTransport<EventPayload>({ batch: 1, intervalMs: 16 })
  const scenario = createReadbackScenario(page, transport)
  try {
    await scenario.open(options)
    await run(scenario)
    await scenario.finishEventReads()
    expect(scenario.unexpectedReads).toEqual([])
    expect(scenario.pageErrors).toEqual([])
  } finally {
    scenario.releasePending()
    try {
      if (!page.isClosed()) {
        scenario.observations.push({
          phase: "final-DOM",
          nodes: await page.locator(selectors.node).evaluateAll((elements) =>
            elements.map((element) => ({
              id: element.getAttribute("data-key"),
              content: element.getAttribute("title"),
            })),
          ),
        })
      }
      await info.attach("fe01-readback-sequence", {
        body: JSON.stringify(
          {
            bundle: process.env.TASK_TIMELINE_BUNDLE ?? null,
            observations: scenario.observations,
            unexpectedReads: scenario.unexpectedReads,
            pageErrors: scenario.pageErrors,
            consoleErrors: scenario.consoleErrors,
            connections: transport.connectionCount(),
          },
          null,
          2,
        ),
        contentType: "application/json",
      })
    } finally {
      await transport.close()
    }
  }
}

function createReadbackScenario(page: Page, transport: Transport) {
  const original = fixture.sessions.find((session) => session.id === fixture.sourceID)
  if (!original) throw new Error("Task readback fixture has no source Session")
  const source = { ...original, time: { ...original.time }, title: "FE-01 Task readback" }
  const other = {
    ...original,
    id: fixture.targetID,
    title: "FE-01 other Session",
    directory: `${fixture.directory}/other`,
  }
  const config: MockServerConfig = {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: [source, other],
    pageMessages,
    tasks: [],
    sessionStatus: { [source.id]: { type: "idle" } },
  }
  const reads: HeldRead[] = []
  const eventReadPermits: string[] = []
  const eventRequests = new Set<Request>()
  const eventResponses = new Map<Request, Response>()
  const hold = (label: string, path = taskPath) => {
    const read: HeldRead = { label, path, reply: Promise.withResolvers<ReadReply>(), released: false }
    reads.push(read)
    return read
  }
  const observations: Record<string, unknown>[] = []
  const unexpectedReads: string[] = []
  const pageErrors: string[] = []
  const consoleErrors: { text: string; url: string }[] = []
  const record = (phase: string, data: Record<string, unknown> = {}) => {
    observations.push({ sequence: observations.length, at: Date.now(), phase, ...data })
  }

  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message))
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url })
  })
  page.on("response", (response) => {
    if (eventRequests.has(response.request())) {
      eventResponses.set(response.request(), response)
      record("event-GET-response", { status: response.status() })
    }
    const read = reads.find((item) => item.request === response.request())
    if (!read) return
    read.response = response
    record("GET-response", { label: read.label, status: response.status() })
  })
  page.on("requestfailed", (request) => {
    const read = reads.find((item) => item.request === request)
    if (!read) return
    read.failure = request.failure()?.errorText ?? "Request failed without an error description"
    record("GET-failed", { label: read.label, error: read.failure })
  })

  const publishStatus = (status: SessionStatus) => {
    config.sessionStatus = { [source.id]: status }
    record("publish-status", { status })
    transport.enqueue({
      directory: fixture.directory,
      payload: { type: "session.status", properties: { sessionID: source.id, status } },
    })
  }
  const publishTasks = (tasks: SessionTaskInfo[], authoritative = tasks) => {
    config.tasks = authoritative
    eventReadPermits.push(`task.updated-${observations.length}`)
    record("publish-tasks", { tasks, authoritative })
    transport.enqueue({
      directory: fixture.directory,
      payload: { type: "task.updated", properties: { sessionID: source.id, tasks } },
    })
  }
  const expectTasks = async (tasks: SessionTaskInfo[], phase: string) => {
    record("expect-task-list", { step: phase, expected: tasks })
    await expect(page).toHaveURL(new RegExp(`/session/${source.id}$`))
    await expect(page.getByRole("heading", { name: source.title, exact: true })).toBeVisible()
    await expect(page.locator(selectors.node)).toHaveCount(tasks.length)
    if (tasks.length === 0) await expect(page.locator(selectors.strip)).toHaveCount(0)
    for (const item of tasks) {
      await expect(page.locator(`${selectors.node}[data-key="${item.id}"]`)).toHaveAttribute("title", item.content)
    }
    record(phase, {
      nodes: await page
        .locator(selectors.node)
        .evaluateAll((elements) =>
          elements.map((element) => ({ id: element.getAttribute("data-key"), content: element.getAttribute("title") })),
        ),
    })
  }
  const renderBarrier = async (label: string) => {
    // A real SSE title update acknowledges the UI event queue after an HTTP
    // body has finished. It does not trigger another status/blocked Task read.
    source.title = `FE-01 ${label} ${observations.length}`
    transport.enqueue({
      directory: fixture.directory,
      payload: { type: "session.updated", properties: { info: source } },
    })
    await expect(page.getByRole("heading", { name: source.title, exact: true })).toBeVisible()
    record("render-barrier", { label, title: source.title })
  }
  const begin = async (label: string, status: SessionStatus, tasks: SessionTaskInfo[]) => {
    // Advance only the mocked server snapshot, deliberately without task.updated:
    // these GETs exercise recovery from a missed event, not a second UI store.
    config.tasks = tasks
    record("server-snapshot-without-SSE", { label, tasks })
    const read = hold(label)
    publishStatus(status)
    await expect
      .poll(() => read.request !== undefined, { message: `${label} must reach the actual Task GET route` })
      .toBe(true)
    return read
  }

  return {
    observations,
    unexpectedReads,
    pageErrors,
    consoleErrors,
    publishStatus,
    publishTasks,
    expectTasks,
    renderBarrier,
    begin,
    started: () => reads.filter((read) => read.request !== undefined).map((read) => read.label),
    eventReads: () => eventRequests.size,
    async finishEventReads() {
      await expect.poll(() => eventResponses.size).toBe(eventRequests.size)
      for (const response of eventResponses.values()) {
        expect(response.status()).toBe(200)
        expect(await response.finished()).toBeNull()
      }
      record("event-GET-bodies-finished", { count: eventResponses.size })
    },
    async open(options: { prime?: boolean; navigation?: boolean }) {
      await pinEnglishUI(page)
      await page.addInitScript((server: string) => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { showSessionProgressBar: true } }))
        localStorage.setItem(
          "aigcfroge.global.dat:server",
          JSON.stringify({ list: [{ type: "http", http: { url: server } }], projects: {}, lastProject: {} }),
        )
      }, fixture.serverKey)
      if (options.navigation) {
        // Reuse the persisted titlebar-tab setup from session-timeline.spec.ts;
        // the default fixture deliberately starts with its sidebar closed.
        await page.addInitScript(
          (tabs) => {
            localStorage.setItem("aigcfroge.global.dat:tabs", JSON.stringify(tabs))
          },
          [source, other].map((session) => ({
            type: "session",
            server: fixture.serverKey,
            dirBase64: base64Encode(session.directory),
            sessionId: session.id,
          })),
        )
      }
      await mockAigcfrogeServer(page, config)
      await page.route(/\/(?:global\/)?event(?:\?.*)?$/, (route) => route.continue({ url: transport.url }))
      await page.route(
        (url) => url.pathname === taskPath || url.pathname === "/agent-task",
        async (route) => {
          if (route.request().method() !== "GET") return route.fallback()
          const path = new URL(route.request().url()).pathname
          const read = reads.find((item) => !item.request && item.path === path)
          if (!read) {
            const permit = eventReadPermits.shift()
            if (permit) {
              eventRequests.add(route.request())
              record("event-GET-started", { permit, path, tasks: structuredClone(config.tasks) })
              return route.fallback()
            }
            unexpectedReads.push(route.request().url())
            return route.fallback()
          }
          read.request = route.request()
          read.capturedTasks = structuredClone(config.tasks ?? [])
          const url = new URL(read.request.url())
          expect(url.origin).toBe(new URL(fixture.serverKey).origin)
          expect(url.searchParams.get("directory")).toBe(fixture.directory)
          record("GET-started", {
            label: read.label,
            url: url.toString(),
            directory: url.searchParams.get("directory"),
          })
          read.afterStart?.()
          const reply = await read.reply.promise
          if (reply.kind === "abort") return route.abort("aborted")
          await route.fulfill({
            status: reply.kind === "error" ? 503 : 200,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(reply.kind === "error" ? { message: "FE-01 controlled read failure" } : reply.tasks),
          })
        },
      )
      await page.goto(`/server/${base64Encode(fixture.serverKey)}/session/${source.id}`)
      await expect(page.getByRole("heading", { name: source.title, exact: true })).toBeVisible()
      await expect.poll(transport.connectionCount).toBeGreaterThan(0)
      // Prime through the real reducer before starting reads. An idle Session
      // with Task data mounts the actual strip without its cold GET racing setup.
      if (options.prime !== false) {
        publishTasks([task(0)])
        await expectTasks([task(0)], "real-task-strip-primed")
      }
      expect(unexpectedReads, "setup must not hide an unaccounted Task GET").toEqual([])
    },
    async overlap(newer: SessionTaskInfo[] = [task(2)], idle = true) {
      const a = await begin("A", { type: "busy" }, [task(1)])
      const b = await begin("B", { type: "retry", attempt: 1, message: "FE-01 second read", next: Date.now() }, newer)
      if (idle) publishStatus({ type: "idle" })
      await renderBarrier("both-GETs-started")
      expect(reads.filter((read) => read.request).map((read) => read.label)).toEqual(["A", "B"])
      expect(unexpectedReads).toEqual([])
      expect(pageErrors).toEqual([])
      return { a, b }
    },
    async coldOverlap() {
      config.tasks = [task(1)]
      const a = hold("cold-strip")
      const b = hold("Page")
      a.afterStart = () => {
        config.tasks = [task(2)]
      }
      publishStatus({ type: "busy" })
      await expect.poll(() => [!!a.request, !!b.request]).toEqual([true, true])
      return { a, b }
    },
    async beginHub(label: string, tasks: SessionTaskInfo[]) {
      config.tasks = tasks
      const read = hold(label, "/agent-task")
      await page.locator('[data-session-title] [aria-label="More options"]').click()
      await page.getByText("My agents", { exact: true }).click()
      await expect(page.locator('[data-component="agent-task-hub"]')).toBeVisible()
      await expect.poll(() => !!read.request).toBe(true)
      return read
    },
    async reconnect(tasks: SessionTaskInfo[]) {
      config.tasks = tasks
      eventReadPermits.push("server.connected")
      transport.enqueue({ directory: "global", payload: { type: "server.connected", properties: {} } })
      await renderBarrier("new-server-generation")
    },
    async visitOtherSession() {
      const tab = page.locator(`[data-slot="titlebar-tabs"] a[href$="/session/${other.id}"]`).first()
      await expect(tab).toBeVisible()
      await tab.click()
      await expect(page).toHaveURL(new RegExp(`/session/${other.id}$`))
      await expect(page.getByRole("heading", { name: other.title, exact: true })).toBeVisible()
      await expect(page.locator(selectors.node)).toHaveCount(0)
      record("other-Session-and-Location-visible", { sessionID: other.id, directory: other.directory })
    },
    async returnToSource() {
      const tab = page.locator(`[data-slot="titlebar-tabs"] a[href$="/session/${source.id}"]`).first()
      await expect(tab).toBeVisible()
      await tab.click()
      await expectTasks([task(0)], "source-reopened")
    },
    async finishAborted(read: HeldRead) {
      await expect.poll(() => read.failure).toContain("ERR_ABORTED")
      read.released = true
      read.reply.resolve({ kind: "abort" })
      record("previous-visit-GET-aborted", { label: read.label, failure: read.failure })
    },
    async finish(read: HeldRead, reply: Exclude<ReadReply, { kind: "abort" }>) {
      if (!read.request || read.released) throw new Error(`Cannot release Task GET ${read.label}`)
      if (reply.kind === "ok") expect(reply.tasks).toEqual(read.capturedTasks)
      read.released = true
      record("release-GET", { label: read.label, reply })
      read.reply.resolve(reply)
      await expect
        .poll(() => !!read.response || !!read.failure, { message: `${read.label} must settle on the browser` })
        .toBe(true)
      if (read.failure) throw new Error(`${read.label}: ${read.failure}`)
      const response = read.response
      if (!response) throw new Error(`${read.label} completed without an HTTP response`)
      expect(response.status()).toBe(reply.kind === "error" ? 503 : 200)
      expect(await response.finished()).toBeNull()
      expect(unexpectedReads).toEqual([])
      record("GET-body-finished", { label: read.label })
    },
    async expectWriteRevision(revision: number) {
      await page.locator(selectors.stats).click()
      await expect(page.locator(selectors.panel)).toBeVisible()
      const write = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === `${taskPath}/${task(revision).id}` && request.method() === "PATCH",
      )
      await page.locator(selectors.panel).locator('[data-slot="checkbox-v2-control"]').click()
      expect((await write).postDataJSON()).toEqual(
        expect.objectContaining({ expectedRevision: revision, status: "pending" }),
      )
      record("writeback-retains-revision", { revision })
    },
    releasePending() {
      reads
        .filter((read) => !read.released)
        .forEach((read) => {
          read.released = true
          read.reply.resolve({ kind: "abort" })
        })
    },
  }
}
