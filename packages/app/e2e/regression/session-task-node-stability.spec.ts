import { expect, test, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { createTimelineSseTransport } from "../performance/timeline/session-timeline-sse"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockAigcfrogeServer } from "../utils/mock-server"
import { snapshotMisses, trackPageErrors } from "../utils/errors"
import { pinEnglishUI } from "../utils/locale"
import { expectSessionTitle } from "../utils/waits"

type EventPayload = { directory: string; payload: Record<string, unknown> }

const sessionID = fixture.sourceID
const draft = "Keep this unsent draft across Task updates."
const selectors = {
  content: "[data-timeline-virtual-content]",
  strip: '[data-component="session-todo-progress"]',
  stats: '[data-component="session-todo-progress-stats"]',
  first: '[data-component="session-todo-progress-node"][data-key="tsk_stability_a"]',
  second: '[data-component="session-todo-progress-node"][data-key="tsk_stability_b"]',
  editor: '[data-component="prompt-input"]',
  scroller: ".scroll-view__viewport:has([data-timeline-row])",
}
const panelSelector = '[data-component="session-todo-progress-panel"]'
const tasks = [
  {
    id: "tsk_stability_a",
    sessionID,
    agentID: "build",
    content: "audit",
    status: "completed",
    priority: "high",
    revision: 1,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "tsk_stability_b",
    sessionID,
    agentID: "build",
    content: "review",
    status: "pending",
    priority: "medium",
    revision: 1,
    createdAt: 1700000000001,
    updatedAt: 1700000000001,
  },
]

// The legacy route.fulfill fixture reconnects after every finite SSE body.
// Compare it with the existing persistent transport, not a fake event handler.
;(
  [
    { kind: "persistent", reload: false },
    { kind: "reconnecting", reload: false },
    { kind: "persistent", reload: true },
  ] as const
).forEach((scenario) => {
  const kind = scenario.kind
  const title = scenario.reload
    ? "Server reconnect preserves the open Task checkbox focus and DOM identity"
    : `Task updates preserve DOM identity, local expansion, scroll and draft (${kind} SSE)`
  test(title, async ({ page }, info) => {
    const errors = trackPageErrors(page, snapshotMisses(fixture.directory, [sessionID]))
    const events: EventPayload[] = []
    const requests: { path: string; method: string; at: number }[] = []
    const observations: unknown[] = []
    const server = {
      directory: fixture.directory,
      project: fixture.project,
      provider: fixture.provider,
      sessions: fixture.sessions,
      pageMessages,
      tasks: tasks.map((task) => ({ ...task })),
      sessionStatus: { [sessionID]: { type: "busy" } },
      events: () => [
        {
          directory: fixture.directory,
          payload: { type: "session.status", properties: { sessionID, status: { type: "busy" } } },
        },
        ...events.splice(0, 1),
      ],
      eventRetry: 16,
    }
    const transport =
      kind === "persistent" ? await createTimelineSseTransport<EventPayload>({ batch: 1, intervalMs: 16 }) : undefined
    const enqueue = (values: EventPayload[]) => {
      observations.push({ phase: "enqueue", events: values })
      if (transport) return transport.enqueue(values)
      events.push(...values)
    }
    const publishTask = (revision: number) => {
      const event = taskUpdate(revision)
      // A later authoritative GET must read the same state the backend just
      // published, including after the real checkbox PATCH in this test.
      server.tasks = event.payload.properties.tasks
      enqueue([event])
    }
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname
      if (path !== "/event" && path !== "/global/event" && !path.startsWith("/session")) return
      requests.push({ path, method: request.method(), at: Date.now() })
    })

    try {
      await pinEnglishUI(page)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.addInitScript(() => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { showSessionProgressBar: true } }))
      })
      await mockAigcfrogeServer(page, server)
      if (transport) {
        await page.route(/\/(?:global\/)?event(?:\?.*)?$/, (route) => route.continue({ url: transport.url }))
      }
      await page.goto(`/${base64Encode(fixture.directory)}/session/${sessionID}`)
      await expectSessionTitle(page, fixture.expected.sourceTitle)
      const stats = page.locator(selectors.stats)
      const editor = page.locator(selectors.editor)
      const scroller = page.locator(selectors.scroller)
      await expect(stats).toHaveText("1/2")
      await expect(page.locator(selectors.first)).toHaveAttribute("title", "audit")
      await expect(page.locator(selectors.second)).toHaveAttribute("title", "review")

      observations.push({ phase: "draft-pointer", ...(await pointerClick(page, editor)) })
      await page.keyboard.type(draft)
      await expect(editor).toHaveText(draft)
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
        .toBeLessThanOrEqual(1)
      const bottom = await scroller.evaluate((element) => element.scrollTop)
      expect(bottom).toBeGreaterThan(300)
      const point = await scroller.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.left + rect.width / 3, y: rect.top + rect.height / 2 }
      })
      await page.mouse.move(point.x, point.y)
      await page.mouse.wheel(0, -240)
      await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(bottom - 100)
      await expect.poll(() => stableScroll(scroller)).toBe(true)

      observations.push({ phase: "open-pointer", ...(await pointerClick(page, stats)) })
      await expect(stats).toHaveAttribute("aria-expanded", "true")
      await expect(page.locator(panelSelector)).toBeVisible()
      await expect(stats).toBeFocused()
      // Exercise B1's real checkbox pointer path before the update burst. The
      // response is just an action-completion signal, not an HTTP contract test.
      const writeback = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/session/${sessionID}/task/tsk_stability_b` &&
          response.request().method() === "PATCH",
      )
      observations.push({
        phase: "checkbox-pointer",
        ...(await pointerClick(page, page.locator(panelSelector).locator('[data-slot="checkbox-v2-control"]').nth(1))),
      })
      const response = await writeback
      observations.push({ phase: "checkbox-response", status: response.status() })
      expect(response.ok()).toBe(true)
      await expect(stats).toHaveAttribute("aria-expanded", "true")
      await expect(page.locator(panelSelector).getByRole("checkbox").nth(1)).toBeFocused()
      const folded = await captureIdentity(page, {
        ...selectors,
        panel: panelSelector,
        checkbox: `${panelSelector} > div:nth-child(2) [data-slot="checkbox-v2-input"]`,
      })
      try {
        const before = await folded.evaluate(readIdentity)
        observations.push({ phase: "fold-before", ...before })
        await info.attach("fold-before", { body: await page.screenshot(), contentType: "image/png" })
        const connections = transport?.connectionCount()
        const reconnects = requests.filter((request) => /\/(?:global\/)?event$/.test(request.path)).length
        Array.from({ length: 8 }, (_, index) => index + 2).forEach(publishTask)
        await expect(page.locator(selectors.second)).toHaveAttribute("title", "review revision 9")
        if (transport) {
          await expect.poll(transport.pendingCount).toBe(0)
          expect(transport.connectionCount()).toBe(connections)
        }
        if (!transport) {
          await expect
            .poll(() => requests.filter((request) => /\/(?:global\/)?event$/.test(request.path)).length)
            .toBeGreaterThanOrEqual(reconnects + 8)
        }
        const after = await folded.evaluate(readIdentity)
        observations.push({ phase: "fold-after", connections, ...after })
        await info.attach("fold-after", { body: await page.screenshot(), contentType: "image/png" })
        expect(after.identity).toEqual(before.identity)
        expect(after.removals).toEqual([])
        expect(after.focusPreserved).toBe(true)
        expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1)
        await expect(stats).toHaveAttribute("aria-expanded", "true")
        await expect(page.locator(panelSelector)).toBeVisible()
        await expect(page.locator(panelSelector)).toContainText("review revision 9")
        await expect(editor).toHaveText(draft)

        if (scenario.reload) {
          // A finite SSE response does not itself emit server.connected. Deliver
          // that real wire event separately and observe the directory reload,
          // rather than assuming the historical fixture exercised cache cleanup.
          const refreshed = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname === "/session/status" && response.request().method() === "GET",
          )
          enqueue([{ directory: "global", payload: { type: "server.connected", properties: {} } }])
          publishTask(10)
          const authoritative = await refreshed
          expect(authoritative.ok()).toBe(true)
          await expect(page.locator(selectors.second)).toHaveAttribute("title", "review revision 10")
          const reloaded = await folded.evaluate(readIdentity)
          observations.push({ phase: "directory-reloaded", response: authoritative.url(), ...reloaded })
          expect(reloaded.identity).toEqual(before.identity)
          expect(reloaded.removals).toEqual([])
          expect(reloaded.focusPreserved).toBe(true)
          expect(Math.abs(reloaded.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1)
          await expect(stats).toHaveAttribute("aria-expanded", "true")
          await expect(page.locator(panelSelector)).toBeVisible()
        }
      } finally {
        await folded.evaluate((probe) => probe.dispose())
        await folded.dispose()
      }

      // A real outside pointer intentionally dismisses the fold. It must not be
      // confused with task.updated dismissing it or replacing the input node.
      observations.push({ phase: "resume-draft-pointer", ...(await pointerClick(page, editor)) })
      await expect(stats).toHaveAttribute("aria-expanded", "false")
      await page.keyboard.press("End")
      const typing = await captureIdentity(page, selectors)
      try {
        const before = await typing.evaluate(readIdentity)
        observations.push({ phase: "typing-before", ...before })
        publishTask(11)
        await expect(page.locator(selectors.second)).toHaveAttribute("title", "review revision 11")
        const after = await typing.evaluate(readIdentity)
        observations.push({ phase: "typing-after", ...after })
        expect(after.identity).toEqual(before.identity)
        expect(after.removals).toEqual([])
        expect(after.focusPreserved).toBe(true)
        expect(after.selection).toEqual(before.selection)
        expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1)
        await expect(editor).toBeFocused()
        await page.keyboard.type(" Still typing.")
        await expect(editor).toHaveText(`${draft} Still typing.`)
        await expect(stats).toHaveAttribute("aria-expanded", "false")
      } finally {
        await typing.evaluate((probe) => probe.dispose())
        await typing.dispose()
      }
      // Positive control for the identity probe: an actually empty Task list
      // removes the strip. This must be detected without replacing DOM by hand
      // or mutating production code; message content and the draft stay mounted.
      const cleared = await captureIdentity(page, selectors)
      try {
        server.tasks = []
        enqueue([
          { directory: fixture.directory, payload: { type: "task.updated", properties: { sessionID, tasks: [] } } },
        ])
        await expect(page.locator(selectors.strip)).toHaveCount(0)
        const removed = await cleared.evaluate(readIdentity)
        observations.push({ phase: "empty-list-control", ...removed })
        expect(removed.identity.strip).toEqual({ connected: false, same: false })
        expect(removed.removals).toEqual(expect.arrayContaining(["strip", "stats", "first", "second"]))
        expect(removed.identity.content).toEqual({ connected: true, same: true })
        expect(removed.identity.editor).toEqual({ connected: true, same: true })
        await expect(editor).toHaveText(`${draft} Still typing.`)
        publishTask(12)
        await expect(page.locator(selectors.second)).toHaveAttribute("title", "review revision 12")
        const restored = await cleared.evaluate(readIdentity)
        observations.push({ phase: "restored-list-control", ...restored })
        expect(restored.identity.strip).toEqual({ connected: false, same: false })
        await expect(page.locator(selectors.strip)).toBeVisible()
      } finally {
        await cleared.evaluate((probe) => probe.dispose())
        await cleared.dispose()
      }
      expect(errors).toEqual([])
    } finally {
      await info.attach("task-node-stability", {
        body: JSON.stringify(
          { kind, observations, requests, errors, connections: transport?.connectionCount() },
          null,
          2,
        ),
        contentType: "application/json",
      })
      if (!page.isClosed()) await info.attach("final-dom", { body: await page.screenshot(), contentType: "image/png" })
      await transport?.close()
    }
  })
})

test("Explicit Agent selection still changes the choice and restores Composer focus", async ({ page }, info) => {
  const errors = trackPageErrors(page, snapshotMisses(fixture.directory, [sessionID]))
  const observations: unknown[] = []
  await pinEnglishUI(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockAigcfrogeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    provider: fixture.provider,
    sessions: fixture.sessions,
    pageMessages,
    tasks: tasks.map((task) => ({ ...task })),
    agents: ["build", "plan"].map((name) => ({ name, mode: "primary", primaryModes: ["coding"] })),
  })
  await page.goto(`/${base64Encode(fixture.directory)}/session/${sessionID}`)
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  const editor = page.locator(selectors.editor)
  const trigger = page.locator('[data-action="prompt-agent"]')
  await expect(trigger).toHaveText("build")
  observations.push({ phase: "draft-pointer", ...(await pointerClick(page, editor)) })
  await page.keyboard.type(draft)
  await expect(editor).toHaveText(draft)
  const original = await editor.elementHandle()
  if (!original) throw new Error("Missing Composer node before explicit Agent selection")
  try {
    await test.step("Choose plan with a real pointer", async () => {
      observations.push({ phase: "agent-trigger-pointer", ...(await pointerClick(page, trigger)) })
      const option = page.getByRole("option", { name: "plan", exact: true })
      await option.click({ trial: true })
      observations.push({ phase: "plan-pointer", ...(await pointerClick(page, option)) })
      await expect(trigger).toHaveText("plan")
      await expect(page.getByRole("listbox")).toBeHidden()
      await expect(editor).toBeFocused()
      expect(await editor.evaluate((node, previous) => node.isSameNode(previous), original)).toBe(true)
      await expect(editor).toHaveText(draft)
      await page.keyboard.type(" Planning.")
      await expect(editor).toHaveText(`${draft} Planning.`)
      observations.push({
        phase: "plan-selected",
        selected: await trigger.textContent(),
        focused: await editor.evaluate((node) => node === document.activeElement),
      })
      await info.attach("explicit-plan-selected", { body: await page.screenshot(), contentType: "image/png" })
    })
    await test.step("Choose build again without suppressing a genuine change", async () => {
      observations.push({ phase: "reopen-agent-pointer", ...(await pointerClick(page, trigger)) })
      await expect(page.getByRole("option", { name: "plan", exact: true })).toHaveAttribute("aria-selected", "true")
      const option = page.getByRole("option", { name: "build", exact: true })
      await option.click({ trial: true })
      observations.push({ phase: "build-pointer", ...(await pointerClick(page, option)) })
      await expect(trigger).toHaveText("build")
      await expect(page.getByRole("listbox")).toBeHidden()
      await expect(editor).toBeFocused()
      expect(await editor.evaluate((node, previous) => node.isSameNode(previous), original)).toBe(true)
      await page.keyboard.type(" Building.")
      await expect(editor).toHaveText(`${draft} Planning. Building.`)
      observations.push({
        phase: "build-selected",
        selected: await trigger.textContent(),
        focused: await editor.evaluate((node) => node === document.activeElement),
      })
      await info.attach("explicit-build-selected", { body: await page.screenshot(), contentType: "image/png" })
    })
    expect(errors).toEqual([])
  } finally {
    await original.dispose()
    await info.attach("explicit-agent-selection", {
      body: JSON.stringify({ observations, errors }, null, 2),
      contentType: "application/json",
    })
  }
})

function taskUpdate(revision: number) {
  return {
    directory: fixture.directory,
    payload: {
      type: "task.updated",
      properties: {
        sessionID,
        tasks: tasks.map((task) => ({
          ...task,
          content: `${task.content} revision ${revision}`,
          status: task.id === "tsk_stability_b" && revision % 2 === 0 ? "in_progress" : task.status,
          revision,
          updatedAt: task.updatedAt + revision,
        })),
      },
    },
  }
}

async function pointerClick(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  const hit = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const target = document.elementFromPoint(x, y)
    return { x, y, inside: !!target && element.contains(target), target: target?.outerHTML.slice(0, 800) }
  })
  await test.info().attach("pointer-hit-target", { body: JSON.stringify(hit), contentType: "application/json" })
  expect(hit, "The real pointer must hit the requested control, not an overlay").toMatchObject({ inside: true })
  await page.mouse.click(hit.x, hit.y)
  return hit
}

function stableScroll(scroller: Locator) {
  return scroller.evaluate((element) => {
    const top = element.scrollTop
    const height = element.scrollHeight
    return new Promise<boolean>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve(element.scrollTop === top && element.scrollHeight === height)),
      ),
    )
  })
}

function captureIdentity(page: Page, targets: Record<string, string>) {
  return page.evaluateHandle((targets) => {
    const nodes = Object.fromEntries(
      Object.entries(targets).map(([name, selector]) => {
        const node = document.querySelector(selector)
        if (!(node instanceof HTMLElement)) throw new Error(`Missing DOM identity target: ${name}`)
        return [name, node] as const
      }),
    )
    const removals: string[] = []
    const focusChanges: { type: string; target: string | undefined; stack: string | undefined }[] = []
    const recordFocus = (event: FocusEvent) => {
      focusChanges.push({
        type: event.type,
        target: event.target instanceof Element ? event.target.outerHTML.slice(0, 900) : undefined,
        stack: new Error("DOM focus changed").stack,
      })
    }
    document.addEventListener("focusin", recordFocus)
    document.addEventListener("focusout", recordFocus)
    const observer = new MutationObserver((records) => {
      Object.entries(nodes).forEach(([name, node]) => {
        if (records.some((record) => [...record.removedNodes].some((removed) => removed.contains(node)))) {
          removals.push(name)
        }
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return {
      nodes,
      targets,
      removals,
      focusChanges,
      focus: document.activeElement,
      dispose() {
        observer.disconnect()
        document.removeEventListener("focusin", recordFocus)
        document.removeEventListener("focusout", recordFocus)
      },
    }
  }, targets)
}

function readIdentity(probe: {
  nodes: Record<string, HTMLElement>
  targets: Record<string, string>
  removals: string[]
  focus: Element | null
  focusChanges: { type: string; target: string | undefined; stack: string | undefined }[]
}) {
  const selection = document.getSelection()
  return {
    identity: Object.fromEntries(
      Object.entries(probe.nodes).map(([name, node]) => [
        name,
        { connected: node.isConnected, same: node.isSameNode(document.querySelector(probe.targets[name])) },
      ]),
    ),
    removals: probe.removals,
    focusPreserved: probe.focus === document.activeElement,
    focusBefore: probe.focus?.outerHTML.slice(0, 900),
    focusAfter: document.activeElement?.outerHTML.slice(0, 900),
    focusChanges: probe.focusChanges,
    scrollTop: probe.nodes.scroller.scrollTop,
    selection: selection
      ? { anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset, text: selection.toString() }
      : null,
  }
}
