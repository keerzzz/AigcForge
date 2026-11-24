import { expect, test, type Locator, type Page } from "@playwright/test"
import { Schema } from "effect"
import { NO_PROVIDER, SERVER, T0, provider, sessionHref } from "../utils/app"
import { mockWorkspace, openDraft, openSession } from "../utils/workspace"
import { attachSession } from "../utils/side-panel"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

test("SC03 keeps a target draft and attachments after its Shell closes and restores its final released view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sourceID = "ses_sc03_source"
  const targetID = "ses_sc03_target"
  const otherSourceID = "ses_sc03_other_source"
  const targetDirectory = "/home/sc03-target"

  const targetLocation = { directory: targetDirectory }

  const writes: { path: string; directory: string; body: string }[] = []
  const uploads: URL[] = []
  const prompts: { sessionID: string; body: unknown }[] = []
  const effects: string[] = []
  const transport = await installSseTransport(page, { server: SERVER })
  page.on("request", (request) => {
    if (request.method() !== "POST") return

    const url = new URL(request.url())
    const path = url.pathname

    if (path === "/api/session" || path.endsWith("/interrupt")) effects.push(path)

    if (path === "/api/experimental/fs/write") uploads.push(url)
  })

  const workspace = await openSession(page, {
    name: "SC03 target memory",
    sessions: [
      { id: sourceID, title: "Source A", model: { providerID: "omnixa", id: "source-model" } },
      {
        id: targetID,
        title: "Target B",
        directory: targetDirectory,
        location: targetLocation,
        model: { providerID: "omnixa", id: "target-model" },
      },
      { id: otherSourceID, title: "Source C", model: { providerID: "omnixa", id: "source-model" } },
    ],
    provider: provider({ id: "source-model", name: "Source model" }, { id: "target-model", name: "Target model" }),
    pageMessages: (id) => ({
      items: [{ id: `msg_${id}`, type: "user", text: `History ${id}`, time: { created: T0 } }],
    }),
    onFileWrite: (write) => void writes.push(write),
    onPrompt: (prompt) => void prompts.push(prompt),
  })

  await transport.waitForConnection()
  const main = page.locator('[data-slot="session-chat-panel"]')
  const side = page.locator('[data-component="session-content-panel"]')

  const sideTab = page.locator(
    `[id="session-side-panel-view-tab-${encodeURIComponent(`${SERVER}\n${sourceID}`)}-session-${encodeURIComponent(`${SERVER}\n${targetID}`)}"]`,
  )

  await main.locator('[data-component="composer-editor"]').fill("Source draft stays A")

  const attach = async () => {
    await attachSession(page, { server: SERVER, sessionID: targetID, title: "Target B" })
    await expect(side.locator('[data-component="composer-editor"]')).toBeEditable()
  }

  await attach()
  await expect(page).toHaveURL(sessionHref(sourceID))
  await expect(main).toContainText(`History ${sourceID}`)
  await expect(side).toContainText(`History ${targetID}`)
  await side.locator('[data-component="composer-editor"]').fill("Target draft B")

  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(["Target attachment"], "target.txt", { type: "text/plain" }))

    return value
  })

  await side.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(side.locator('[data-component="composer-attachments"]')).toContainText("target.txt")
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: expect.stringMatching(/\/uploads\/[0-9a-f-]{36}\/target\.txt$/),
        directory: targetDirectory,
        body: "Target attachment",
      },
    ])

  expect(uploads).toHaveLength(1)
  expect(uploads[0]?.searchParams.get("location[directory]")).toBe(targetLocation.directory)
  await expect(main.locator('[data-component="composer-attachments"]')).toHaveCount(0)

  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(otherSourceID)}"])`).click()
  await expectSessionTitle(page, "Source C")
  await attach()
  await expect(side.locator('[data-component="composer-editor"]')).toHaveText("Target draft B")
  await side.locator('[data-component="composer-editor"]').fill("Shared target draft B")
  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sourceID)}"])`).click()
  await expect(main.locator('[data-component="composer-editor"]')).toHaveText("Source draft stays A")
  await expect(side.locator('[data-component="composer-editor"]')).toHaveText("Shared target draft B")
  await expect(side.locator('[data-component="composer-attachments"]')).toContainText("target.txt")

  await page
    .locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(targetID)}"])`)
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(page).toHaveURL(sessionHref(sourceID))
  await expect(side.locator('[data-component="composer-editor"]')).toBeEditable()
  await side.locator('[data-component="composer-editor"]').fill("Final target draft B")
  expect(prompts).toEqual([])
  expect(effects).toEqual([])
  await sideTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(otherSourceID)}"])`).click()
  await expect(side.locator('[data-component="composer-editor"]')).toHaveText("Final target draft B")
  const otherTab = page.locator("#review-panel").getByRole("tab").filter({ hasText: "Target B" })
  await otherTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(side).toHaveCount(0)
  expect((await transport.connections()).filter((connection) => connection.endedAt === undefined)).toHaveLength(1)

  await page.goto(sessionHref(targetID))
  await expectSessionTitle(page, "Target B")
  await expect(main.locator('[data-component="composer-editor"]')).toHaveText("Final target draft B")
  await expect(main.locator('[data-component="composer-attachments"]')).toContainText("target.txt")
  await expect(main.locator('[data-action="composer-model"]')).toHaveText("Target model")
  await expect(main.locator('[data-action="composer-submit"]')).toBeEnabled()
  await main.locator('[data-component="composer-editor"]').press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]).toMatchObject({
    sessionID: targetID,
    body: {
      text: `Final target draft B\nAttached file: \`${writes[0]?.path}\``,
      metadata: {
        displayText: "Final target draft B",
        model: { providerID: "omnixa", modelID: "target-model" },
      },
    },
  })
  expect(effects).toEqual([])
  expect(workspace.directory).not.toBe(targetDirectory)
})

for (const [scheme, width] of [
  ["light", 390],
  ["light", 1440],
  ["dark", 390],
  ["dark", 1440],
] as const) {
  test(`keeps a ${scheme} ${width}px draft editable and Send disabled until its model configuration is ready`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: scheme })
    const started = Promise.withResolvers<void>()
    const configuration = Promise.withResolvers<void>()
    const creates: Schema.JsonObject[] = []
    const prompts: { sessionID: string; body: unknown }[] = []

    try {
      const view = await openDraft(page, {
        name: "Composer readiness",
        provider: provider({ id: "ready-model", name: "Ready model" }),
        beforeConfigResponse: () => {
          started.resolve()

          return configuration.promise
        },
        onSessionCreate: (body) => void creates.push(body),
        onPrompt: (prompt) => void prompts.push(prompt),
      })

      await started.promise
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme)
      await view.editor.fill("Keep this draft while loading")
      await expect(page.locator('[data-action="composer-model"]')).toBeHidden()
      await expect(page.locator('[data-action="composer-submit"]')).toBeDisabled()
      await view.editor.press("Enter")
      await expect(view.editor).toHaveText("Keep this draft while loading")
      expect(creates).toEqual([])
      expect(prompts).toEqual([])
      await page.screenshot({ path: testInfo.outputPath("composer-loading.png") })
      configuration.resolve()
      await expect(page.locator('[data-action="composer-model"]')).toHaveText("Ready model")
      await expect(page.locator('[data-action="composer-submit"]')).toBeEnabled()
      await page.screenshot({ path: testInfo.outputPath("composer-ready.png") })
      await view.editor.press("Enter")
      await expect.poll(() => prompts.length).toBe(1)
      expect(creates).toHaveLength(1)
      expect(prompts[0]?.sessionID).toBe(creates[0]?.id)
      expect(prompts[0]).toMatchObject({
        body: {
          text: "Keep this draft while loading",
          metadata: { model: { providerID: "omnixa", modelID: "ready-model" } },
        },
      })
    } finally {
      configuration.resolve()
    }
  })
}

test("SC03 recovers target history and keeps source Find and root navigation isolated", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const sourceID = "ses_sc03_recovery_source"
  const failedID = "ses_sc03_recovery_a"
  const targetID = "ses_sc03_recovery_b"
  const sourceHistory = "sourceprobe stays in the source timeline"
  const failedHistory = "Recovered target A history"
  const targetHistory = "targetprobe stays in target B"
  const faults = { history: true }
  const failedReads: string[] = []
  await mockWorkspace(page, {
    name: "SC03 target recovery and search",
    sessions: [
      { id: sourceID, title: "Recovery source S" },
      { id: failedID, title: "Recovery target A" },
      { id: targetID, title: "Recovery target B" },
    ],
    pageMessages: (id) => ({
      items: [
        {
          id: `msg_${id}`,
          type: "user",
          text: id === sourceID ? sourceHistory : id === failedID ? failedHistory : targetHistory,
          time: { created: T0 },
        },
      ],
    }),
  })
  await page.route(`**/api/session/${failedID}/message?*`, async (route) => {
    if (faults.history) {
      failedReads.push(route.request().url())
      await route.fulfill({ status: 500, json: { message: "Target A history unavailable" } })

      return
    }

    await route.fallback()
  })
  await page.goto(sessionHref(sourceID))
  await expectSessionTitle(page, "Recovery source S")
  const main = page.locator('[data-slot="session-chat-panel"]')
  await expect(main).toContainText(sourceHistory)
  await expect(main.locator('[data-component="composer-editor"]')).toBeEditable()
  const sourceKey = encodeURIComponent(`${SERVER}\n${sourceID}`)
  const failedKey = `${sourceKey}-session-${encodeURIComponent(`${SERVER}\n${failedID}`)}`
  const targetKey = `${sourceKey}-session-${encodeURIComponent(`${SERVER}\n${targetID}`)}`
  const failedTab = page.locator(`[id="session-side-panel-view-tab-${failedKey}"]`)
  const targetTab = page.locator(`[id="session-side-panel-view-tab-${targetKey}"]`)

  const failed = page
    .locator(`[id="session-side-panel-view-tabpanel-${failedKey}"]`)
    .locator('[data-component="session-content-panel"]')

  const target = page
    .locator(`[id="session-side-panel-view-tabpanel-${targetKey}"]`)
    .locator('[data-component="session-content-panel"]')

  const mainSearch = main.locator('[data-component="timeline-search-bar"]').getByRole("searchbox")
  const targetSearch = target.locator('[data-component="timeline-search-bar"]').getByRole("searchbox")

  const mainHighlights = () =>
    main.evaluate((root) => {
      const hits = [
        ...Array.from(CSS.highlights.get("timeline-search-hit") ?? []),
        ...Array.from(CSS.highlights.get("timeline-search-hit-active") ?? []),
      ]

      return {
        count: hits.length,
        local: hits.every((range) => root.contains(range.startContainer) && root.contains(range.endContainer)),
      }
    })

  const targetHighlights = () =>
    target.evaluate((root) =>
      Array.from(CSS.highlights).some(
        ([name, hits]) =>
          name.startsWith("timeline-search-hit-") &&
          name !== "timeline-search-hit-active" &&
          hits.size === 1 &&
          Array.from(hits).every((range) => root.contains(range.startContainer) && root.contains(range.endContainer)),
      ),
    )

  const attach = async (sessionID: string) => {
    await attachSession(page, {
      server: SERVER,
      sessionID,
      title: sessionID === failedID ? "Recovery target A" : "Recovery target B",
    })
  }

  await page.keyboard.press("ControlOrMeta+f")
  await expect(mainSearch).toBeFocused()
  await mainSearch.fill("sourceprobe")
  await expect(main.locator('[data-slot="timeline-search-count"]')).toHaveText("1/1")
  await expect.poll(mainHighlights).toEqual({ count: 1, local: true })

  await attach(failedID)
  await expect.poll(() => failedReads.length).toBeGreaterThan(0)
  await expect(failed.getByRole("alert")).toBeVisible()
  await expect(failed.getByRole("button", { name: "Try again", exact: true })).toBeEnabled()
  await attach(targetID)
  await expect(targetTab).toHaveAttribute("aria-selected", "true")
  await expect(target).toContainText(targetHistory)
  await expect(target.getByRole("alert")).toHaveCount(0)
  await expect(target.getByRole("button", { name: "Find...", exact: true }).locator("svg")).toBeVisible()
  await expect(target.getByRole("button", { name: "Find...", exact: true })).toHaveText("")
  await page.screenshot({ path: testInfo.outputPath("sc03-target-search-ready.png") })
  await expect(page).toHaveURL(sessionHref(sourceID))
  await target.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("ControlOrMeta+f")
  await expect(mainSearch).toBeFocused()
  await expect(mainSearch).toHaveValue("sourceprobe")
  await expect(targetSearch).toHaveCount(0)
  await expect.poll(mainHighlights).toEqual({ count: 1, local: true })

  await failedTab.click()
  await expect(failed.getByRole("alert")).toBeVisible()

  const retried = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/session/${failedID}/message` && response.ok(),
  )

  faults.history = false
  await failed.getByRole("button", { name: "Try again", exact: true }).click()
  await retried
  await expect(failed).toContainText(failedHistory)
  await expect(failed.getByRole("alert")).toHaveCount(0)
  await targetTab.click()
  await expect(target).toContainText(targetHistory)
  await target.getByRole("button", { name: "Find...", exact: true }).click()
  await expect(targetSearch).toBeFocused()
  await targetSearch.fill("targetprobe")
  await expect(target.locator('[data-slot="timeline-search-count"]')).toHaveText("1/1")
  await expect(mainSearch).toHaveValue("sourceprobe")
  await expect.poll(mainHighlights).toEqual({ count: 1, local: true })
  await expect.poll(targetHighlights).toBe(true)

  const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(target).toBeHidden()
  await main.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("ControlOrMeta+f")
  await expect(mainSearch).toBeFocused()
  await expect(mainSearch).toHaveValue("sourceprobe")
  await expect.poll(mainHighlights).toEqual({ count: 1, local: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(target).toContainText(targetHistory)
  await target.getByRole("button", { name: "Find...", exact: true }).click()
  await expect(targetSearch).toBeFocused()
  await targetSearch.fill("targetprobe")
  await expect(target.locator('[data-slot="timeline-search-count"]')).toHaveText("1/1")
  await expect.poll(targetHighlights).toBe(true)

  await targetTab.hover()
  await targetTab.locator("..").getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(target).toHaveCount(0)
  await expect.poll(mainHighlights).toEqual({ count: 1, local: true })
  await main.locator('[data-component="composer-editor"]').click()
  await page.keyboard.press("ControlOrMeta+f")
  await expect(mainSearch).toBeFocused()
  await expect(mainSearch).toHaveValue("sourceprobe")

  await attach(targetID)
  await expect(target).toContainText(targetHistory)
  await target.getByRole("button", { name: "Open as main session", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(targetID))
  await expectSessionTitle(page, "Recovery target B")
  const sourceTab = page.locator(`[data-titlebar-tab-slot]:has(a[href="${sessionHref(sourceID)}"])`)
  await expect(sourceTab).toHaveCount(1)
  await expect(sourceTab.locator("a")).toHaveAttribute("href", sessionHref(sourceID))
  await sourceTab.click()
  await expect(page).toHaveURL(sessionHref(sourceID))
  await expect(main).toContainText(sourceHistory)
})

async function draft(page: Page) {
  const { editor } = await openDraft(page, { name: "ComposerDraft", provider: NO_PROVIDER })
  await editor.click()

  return editor
}

async function expectCaretVisible(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const selection = window.getSelection()

        if (!selection?.isCollapsed || !selection.rangeCount || !element.contains(selection.anchorNode)) return false
        const caret = selection.getRangeAt(0).getBoundingClientRect()
        const viewport = (element.closest("[data-scrollable]") ?? element).getBoundingClientRect()

        return caret.height > 0 && caret.top >= viewport.top - 1 && caret.bottom <= viewport.bottom + 1
      }),
    )
    .toBe(true)
}

test("MP03 Session chips preserve mixed drafts and follow rename, deletion and connection state after typing", async ({
  page,
}) => {
  const sourceID = "ses_mp03_chip_source"
  const targetID = "ses_mp03_chip_target"
  const cachedID = "ses_mp03_chip_cached"
  const directory = "C:/Omnixa/MP03SessionChips"
  const reads: string[] = []
  const writes: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    const path = new URL(request.url()).pathname

    if (path === "/api/session" || /\/(prompt|interrupt|communication)$/.test(path)) writes.push(path)
  })
  const transport = await installSseTransport(page, { server: SERVER, retry: 60_000 })

  const workspace = await openSession(page, {
    name: "MP03 Session chips",
    directory,
    sessions: [
      { id: sourceID, title: "Session chip source", mode: "coding", agent: "build" },
      { id: targetID, title: "Original target", mode: "coding", agent: "build" },
      { id: cachedID, title: "Cached target", mode: "coding", agent: "build" },
    ],
    pageMessages(id) {
      reads.push(id)

      return { items: [] }
    },
  })

  await transport.waitForConnection()
  const editor = page.locator('[data-slot="session-chat-panel"] [data-component="composer-editor"]')
  const text = `Ask ${targetID} with ${cachedID} while keeping this text.`
  await page.evaluate((text) => navigator.clipboard.writeText(text), text)
  await editor.press("ControlOrMeta+v")
  const target = editor.getByTitle(new RegExp(`^${targetID} ·`))
  const cached = editor.getByTitle(new RegExp(`^${cachedID} ·`))
  await expect(editor.getByRole("link")).toHaveCount(2)
  await expect(target).toHaveText("Original target")
  await expect(cached).toHaveText("Cached target")
  await expect(editor).toHaveText("Ask Original target with Cached target while keeping this text.")
  expect(reads).not.toContain(targetID)
  expect(reads).not.toContain(cachedID)
  await expect
    .poll(async () => {
      const values = await page.evaluate(async () => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("omnixa-drafts", 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })

        try {
          const transaction = database.transaction("documents", "readonly")
          const request = transaction.objectStore("documents").getAll()

          const values = await new Promise<unknown[]>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })

          return values
        } finally {
          database.close()
        }
      })

      return Schema.decodeUnknownSync(Schema.Array(Schema.String))(values).some(
        (value) => value.includes(targetID) && value.includes('"type":"session"'),
      )
    })
    .toBe(true)
  await page.reload()
  await expectSessionTitle(page, "Session chip source")
  await transport.waitForConnection()
  await expect(editor.getByRole("link")).toHaveCount(2)
  await expect(target).toHaveText("Original target")
  await expect(cached).toHaveText("Cached target")
  await editor.press("ControlOrMeta+End")
  await editor.pressSequentially(" Extra draft")
  await expect(editor).toHaveText("Ask Original target with Cached target while keeping this text. Extra draft")
  await transport.send({
    id: "evt_mp03_chip_renamed",
    type: "session.renamed",
    created: T0 + 1,
    location: { directory },
    durable: { aggregateID: targetID, seq: 1, version: 1 },
    data: { sessionID: targetID, title: "Renamed target" },
  })
  await expect(target).toHaveText("Renamed target")
  await expect(target).toHaveAttribute("data-reference-status", "ready")
  await expect(editor).toBeFocused()
  await editor.pressSequentially(" Still at the end.")
  await expect(editor).toHaveText(
    "Ask Renamed target with Cached target while keeping this text. Extra draft Still at the end.",
  )
  workspace.sessions.splice(
    0,
    workspace.sessions.length,
    ...workspace.sessions.filter((session) => session.id !== targetID),
  )
  await transport.send({
    id: "evt_mp03_chip_deleted",
    type: "session.deleted",
    created: T0 + 2,
    location: { directory },
    durable: { aggregateID: targetID, seq: 2, version: 2 },
    data: { sessionID: targetID },
  })
  await expect(target).toHaveAttribute("data-reference-status", "missing")
  await expect(target).toHaveAttribute("title", /Session unavailable$/)
  await transport.disconnect()
  await expect(cached).toHaveAttribute("data-reference-status", "offline")
  await expect(cached).toHaveText("Cached target")
  await expect(cached).toHaveAttribute("title", /Server unavailable$/)
  await expect(target).toHaveAttribute("data-reference-status", "missing")
  expect(writes).toEqual([])
})

test("keeps a 25000-line crash report editable in a new session", async ({ page }) => {
  const input = await draft(page)
  const text = "Thread 0 Crashed:\n" + "0   Example  0x0000000100000000 frame + 32\n".repeat(25000) + "End of report"
  await page.evaluate((text) => navigator.clipboard.writeText(text), text)

  const events = await input.evaluateHandle((element) => {
    const events = { count: 0 }
    element.addEventListener("input", () => events.count++)

    return events
  })

  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(async () => (await input.innerText()) === text).toBe(true)
  expect(await events.evaluate((events) => events.count)).toBe(1)
  await expect(input).toBeFocused()
  await expectCaretVisible(input)
  const scroll = page.locator('[data-component="composer-scroll"]')
  await expect(scroll.locator(".scroll-view__viewport")).toHaveCSS("scrollbar-width", "none")
  await expect(scroll.locator(".scroll-view__thumb")).toBeVisible()
  await page.keyboard.type("!")
  await expect.poll(async () => (await input.innerText()) === text + "!").toBe(true)
  await expectCaretVisible(input)
  const thumb = await scroll.locator(".scroll-view__thumb").boundingBox()
  const bounds = await scroll.boundingBox()

  if (!thumb || !bounds) throw new Error("Missing composer scrollbar bounds")
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
  await page.mouse.down()
  await page.mouse.move(thumb.x + thumb.width / 2, bounds.y + 8 + thumb.height / 2)
  await page.mouse.up()
  await expect(scroll.locator(".scroll-view__viewport")).toHaveJSProperty("scrollTop", 0)
  await expect(input).toBeFocused()
  await page.keyboard.press("ControlOrMeta+Home")
  await page.keyboard.press("ControlOrMeta+End")
  await expectCaretVisible(input)
})

test("a key-up never moves the caret back after later navigation", async ({ page }) => {
  const input = await draft(page)
  await input.pressSequentially("first line")
  await expect(input).toHaveText("first line")

  // Navigation can land before the next frame; the cursor a key-up recorded must not overwrite it there.
  const offset = await input.evaluate(async (element) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!
    const selection = window.getSelection()!
    selection.collapse(text, 0)
    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Home", bubbles: true }))
    selection.collapse(text, text.textContent!.length)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    return selection.anchorOffset
  })

  expect(offset).toBe("first line".length)
})

for (const [width, direction] of [
  [390, "rtl"],
  [1280, "ltr"],
] as const) {
  test(`reveals a multiline paste in the middle at ${width}px in ${direction}`, async ({ page }) => {
    const input = await draft(page)
    await page.setViewportSize({ width, height: 800 })
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    const suffix = "\nExisting trailing content".repeat(100)
    await input.fill("Before " + suffix)
    await input.press("ControlOrMeta+Home")
    await input.press("ArrowRight")
    const text = "Pasted line /tmp/example.ts 123 \u0645\u0631\u062d\u0628\u0627\n".repeat(100) + "End of paste"
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    await expect.poll(() => input.innerText()).toBe("B" + text + "efore " + suffix)
    await expectCaretVisible(input)
    await page.keyboard.type("!")
    await expect.poll(() => input.innerText()).toBe("B" + text + "!efore " + suffix)
    await expectCaretVisible(input)
  })
}

test("pastes plain text without markup and keeps native undo", async ({ page }) => {
  const input = await draft(page)

  for (const text of [
    "single line <b> &amp;",
    "first\nsecond",
    "\n\n  indented\ttext  \n\nlast\n\n",
    'literal <b>bold</b> &amp; & < > "quotes"\n<script>not code</script>\n<img src="example">',
    "first\r\nsecond\rthird",
  ]) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), text)
    await page.keyboard.press("ControlOrMeta+V")
    const expected = text.replace(/\r\n?/g, "\n")
    await expect.poll(() => input.innerText()).toBe(expected)
    await expect(input.locator("b, script, img")).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
    await page.keyboard.press("ControlOrMeta+Shift+Z")
    await expect.poll(() => input.innerText()).toBe(expected)
    await page.keyboard.press("ControlOrMeta+Z")
    await expect(input).toBeEmpty()
  }
})

test("replaces only the selected text and leaves the caret after the paste", async ({ page }) => {
  const input = await draft(page)
  await page.evaluate(() => navigator.clipboard.writeText("one\ntwo"))
  await page.keyboard.type("before replace after")
  await expect(input).toHaveText("before replace after")
  await page.evaluate(() => document.fonts.ready)

  const word = await input.evaluate((element) => {
    const range = document.createRange()
    range.setStart(element.firstChild!, 7)
    range.setEnd(element.firstChild!, 14)
    const rect = range.getBoundingClientRect()

    return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width }
  })

  await page.mouse.move(word.x, word.y)
  await page.mouse.down()
  await page.mouse.move(word.x + word.width, word.y, { steps: 5 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe("replace")
  await page.keyboard.press("ControlOrMeta+V")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.press("ControlOrMeta+Z")
  await expect(input).toHaveText("before replace after")
  await page.keyboard.press("ControlOrMeta+Shift+Z")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo after")
  await page.keyboard.type("!")
  await expect.poll(() => input.innerText()).toBe("before one\ntwo! after")
})

test("shows the dropzone and attaches a dropped file", async ({ page }) => {
  const writes: { path: string; directory: string; body: string }[] = []
  await openDraft(page, {
    name: "ComposerDraft",
    provider: NO_PROVIDER,
    onFileWrite: (write) => void writes.push(write),
  })
  const surface = page.locator('[data-component="new-session"]')
  const dropzone = page.locator('[data-component="session-dropzone"]')

  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer()
    value.items.add(new File(["Dropzone fixture"], "dropzone.txt", { type: "text/plain" }))

    return value
  })

  await expect(dropzone).toHaveCount(0)
  await surface.dispatchEvent("dragover", { dataTransfer: transfer })
  await expect(dropzone).toHaveAttribute("data-visible", "true")
  await expect(dropzone).toContainText("Drop files to add")

  await surface.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
  await expect(dropzone).toHaveCount(0)
  // The file is uploaded to its own directory in the server's temporary directory, then attached by path.
  await expect
    .poll(() => writes)
    .toEqual([
      {
        path: expect.stringMatching(/\/uploads\/[0-9a-f-]{36}\/dropzone\.txt$/),
        directory: "C:/Omnixa/ComposerDraft",
        body: "Dropzone fixture",
      },
    ])
  await expect(page.locator('[data-component="upload-progress"]')).toHaveCount(0)
  await expect(page.locator('[data-component="composer-attachments"]')).toContainText("dropzone.txt")
})

test("keeps a narrow session composer contained when invoking a built-in", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  const { editor } = await openSession(page, { name: "ComposerCommand", provider: NO_PROVIDER })
  const composer = page.locator('[data-component="composer"]')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await editor.fill("keep me")
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Commands" }).click()
  await page.locator('[data-suggestion-id="model.choose"]').click()

  const dialog = page.getByRole("dialog", { name: "Select model", exact: true })
  const search = dialog.getByRole("searchbox", { name: "Search models", exact: true })
  await expect(search).toBeFocused()
  await expect(editor).toHaveText("keep me")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  await editor.fill("/model")
  await expect(page.locator('[data-suggestion-id="model.choose"]')).toHaveAttribute("data-active", "")
  await editor.press("Enter")
  await expect(search).toBeFocused()
  await expect(editor).toBeEmpty()
})

test("lists slash commands in their built-in order", async ({ page }) => {
  const { editor } = await openSession(page, {
    name: "ComposerSlash",
    provider: NO_PROVIDER,
    commands: [
      { name: "init", description: "Create AGENTS.md" },
      { name: "review", description: "Review changes" },
    ],
    // A sent message enables /undo, /compact and /fork.
    pageMessages: () => ({ items: [{ id: "msg_slash", type: "user", text: "Hello", time: { created: T0 } }] }),
  })

  await editor.fill("/")
  await expect(page.locator('[data-component="composer-suggestions"] [data-suggestion-id] bdi')).toHaveText([
    "/init",
    "/review",
    "/new",
    "/undo",
    "/compact",
    "/fork",
    "/export",
    "/open",
    "/terminal",
    "/mcp",
    "/model",
    "/connect",
    "/agent",
    "/btw",
  ])
})

const followUp = "Add follow-up, / for commands, @ for context…"

for (const row of [
  { state: "an idle", copy: "Ask anything, / for commands, @ for context…" },
  { state: "a running", copy: followUp, sessionStatus: { ses_placeholder: { type: "running" } } },
  {
    state: "an idle queued",
    copy: followUp,
    inbox: [
      {
        id: "inb_placeholder",
        sessionID: "ses_placeholder",
        time: { created: T0 },
        type: "user",
        payload: { text: "Queued follow-up" },
        delivery: "queue",
      },
    ],
  },
]) {
  test(`shows the placeholder for ${row.state} session and the shell example in shell mode`, async ({ page }) => {
    const { editor } = await openSession(page, {
      name: "ComposerPlaceholder",
      sessions: [{ id: "ses_placeholder", title: "Placeholder" }],
      sessionStatus: row.sessionStatus,
      inbox: row.inbox,
    })

    const scroll = page.locator('[data-component="composer-scroll"]')
    await expect(scroll).toHaveText(row.copy)
    await editor.pressSequentially("!")
    await expect(scroll).toHaveText("Enter shell command… git status")
  })
}

test("shows thinking on hover or a non-default selection while preserving keyboard access", async ({ page }) => {
  const { editor: input } = await openSession(page, {
    name: "ComposerThinking",
    provider: provider({ id: "thinking-model", name: "Thinking Model", variants: { high: {} } }),
    sessions: [
      {
        id: "ses_composerthinking",
        title: "ComposerThinking",
        model: { id: "thinking-model", providerID: "omnixa" },
      },
    ],
  })

  const composer = page.locator('[data-component="composer"]')
  const control = composer.getByRole("button", { name: "Choose model variant" })
  const option = (name: string) => page.getByRole("menuitemradio", { name, exact: true })

  await expect(composer.locator('[data-action="composer-model"]')).toHaveText("Thinking Model")
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("Default")
  await expect(control).toHaveCSS("opacity", "0")
  await expect(control).toHaveCSS("pointer-events", "none")

  await input.hover()
  await expect(control).toHaveCSS("opacity", "1")

  // The menu keeps the control visible after the pointer leaves.
  await control.click()
  await expect(option("high")).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(control).toHaveAttribute("aria-expanded", "true")
  await expect(control).toHaveCSS("opacity", "1")
  await option("high").click()

  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("high")
  await expect(control).toHaveCSS("opacity", "1")

  await control.click()
  await option("Default").click()
  await input.click()
  await page.mouse.move(0, 0)
  await expect(control).toHaveText("Default")
  await expect(control).toHaveCSS("opacity", "0")

  // The agent control stays between Add and Model in the composer toolbar.
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Add images and files" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Choose agent", exact: true })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(composer.getByRole("button", { name: "Thinking Model" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Enter")
  await expect(option("Default")).toBeFocused()
  await expect(control).toHaveCSS("opacity", "1")
  await page.keyboard.press("Escape")
  await expect(control).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(control).toHaveCSS("opacity", "0")
})
