import { expect, test, type APIRequestContext, type CDPSession, type Page } from "@playwright/test"
import { createAigcfrogeClient } from "@aigcfroge/sdk/v2/client"
import { base64Encode } from "@aigcfroge/core/util/encode"
import { e4, seedRealBackend } from "./fixture"
import { pinEnglishUI } from "../utils/locale"
import { expectSessionTitle } from "../utils/waits"

const questionDock = (page: Page) => page.locator('[data-component="dock-prompt"][data-kind="question"]')
const permissionDock = (page: Page) => page.locator('[data-component="dock-prompt"][data-kind="permission"]')
const customInput = (page: Page) => questionDock(page).locator('[data-slot="question-custom-input"]')

type Scope = Awaited<ReturnType<typeof createScopes>>[number]

async function createScopes(kind: "question" | "permission") {
  const manifest = e4()
  if (!manifest.peer) throw new Error("Run the scope matrix with E4_DUAL_BACKEND=1")
  expect(manifest.peer.backendUrl).not.toBe(manifest.backendUrl)
  expect(manifest.peer.dbPath).not.toBe(manifest.dbPath)
  const scopes = []
  for (const [server, backend] of [manifest, manifest.peer].entries()) {
    for (const [location, directory] of [manifest.workspaceDir, manifest.peer.workspaceDir].entries()) {
      const client = createAigcfrogeClient({ baseUrl: backend.backendUrl, directory, throwOnError: true })
      const title = `E4 ${kind} server ${server} location ${location}`
      const created = await client.session.create({ title, directory, mode: "coding", agent: "build" })
      if (!created.data) throw new Error("Session creation returned no body")
      scopes.push({ client, directory, title, sessionID: created.data.id, backendUrl: backend.backendUrl })
    }
  }
  return scopes
}

async function questions(scope: Scope) {
  const response = await scope.client.v2.question.request.list({ location: { directory: scope.directory } })
  if (!response.data) throw new Error("Question list returned no body")
  expect(response.data.location.directory).toBe(scope.directory)
  expect(response.data.data.every((item) => item.sessionID === scope.sessionID)).toBe(true)
  return response.data.data
}

async function permissions(scope: Scope) {
  const response = await scope.client.permission.list({ directory: scope.directory })
  if (!response.data) throw new Error("Permission list returned no body")
  expect(response.data.every((item) => item.sessionID === scope.sessionID)).toBe(true)
  return response.data
}

async function admit(scope: Scope, request: APIRequestContext, kind: "question" | "permission") {
  const armed = await request.post(`${new URL(e4().providerBaseURL).origin}/e4/provider-failures?mode=${kind}&count=1`)
  expect(armed.status()).toBe(200)
  await scope.client.session.promptAsync({
    sessionID: scope.sessionID,
    agent: "build",
    model: { providerID: "e4-real", modelID: "e4-deterministic" },
    parts: [{ type: "text", text: "Exercise the isolated E4 decision tool." }],
  })
  await expect
    .poll(async () => (kind === "question" ? questions(scope) : permissions(scope)).then((items) => items.length))
    .toBe(1)
    .catch(async (error: unknown) => {
      const messages = await scope.client.session.messages({ sessionID: scope.sessionID })
      const tools = messages.data
        ?.flatMap((message) => message.parts)
        .flatMap((part) =>
          part.type === "tool"
            ? [
                {
                  tool: part.tool,
                  status: part.state.status,
                  error:
                    part.state.status === "error"
                      ? part.state.error
                      : part.tool === "invalid" && part.state.status === "completed"
                        ? part.state.output
                        : undefined,
                },
              ]
            : [],
        )
      await test.info().attach("decision-admission-diagnostic", {
        body: JSON.stringify({ kind, sessionID: scope.sessionID, tools }, null, 2),
        contentType: "application/json",
      })
      throw error
    })
}

async function openScopes(page: Page, scopes: Scope[]) {
  const first = scopes[0]
  if (!first) throw new Error("Scope matrix is empty")
  seedRealBackend(
    page,
    first.backendUrl,
    [...new Set(scopes.map((scope) => scope.backendUrl))].filter((url) => url !== first.backendUrl),
  )
  for (const scope of scopes) {
    await page.goto(`/server/${base64Encode(scope.backendUrl)}/session/${scope.sessionID}`)
    await expectSessionTitle(page, scope.title)
  }
  await page.locator("html").evaluate((element) => element.setAttribute("data-e4-spa", "scope-matrix"))
}

async function switchScope(page: Page, scope: Scope) {
  await page.locator('[data-slot="titlebar-tabs"]').getByRole("link").filter({ hasText: scope.title }).click()
  await expect(page).toHaveURL(new RegExp(`/server/${base64Encode(scope.backendUrl)}/session/${scope.sessionID}$`))
  await expectSessionTitle(page, scope.title)
  await expect(page.locator("html")).toHaveAttribute("data-e4-spa", "scope-matrix")
}

// Pause the real POST, not its CORS preflight. Every byte still comes from the real backend.
async function pausePost(protocol: CDPSession, url: string) {
  const paused = Promise.withResolvers<{ requestId: string; request: { url: string; method: string } }>()
  const onPaused = (event: { requestId: string; request: { url: string; method: string } }) => {
    if (event.request.method === "POST") {
      protocol.off("Fetch.requestPaused", onPaused)
      paused.resolve(event)
      return
    }
    void protocol.send("Fetch.continueRequest", { requestId: event.requestId }).catch(paused.reject)
  }
  protocol.on("Fetch.requestPaused", onPaused)
  await protocol.send("Fetch.enable", { patterns: [{ urlPattern: url, requestStage: "Request" }] })
  return { request: paused.promise }
}

async function cleanup(scopes: Scope[]) {
  for (const scope of scopes) {
    await scope.client.session.abort({ sessionID: scope.sessionID })
    await scope.client.session.delete({ sessionID: scope.sessionID })
  }
}

test.beforeEach(async ({ page }) => pinEnglishUI(page))

for (const kind of ["question", "permission"] as const) {
  test(`R06: aborting a real waiting ${kind} clears its owner and visible form without deciding another scope`, async ({
    page,
    request,
  }, testInfo) => {
    const scopes = await createScopes(kind)
    const first = scopes[0]
    if (!first) throw new Error("Scope matrix is empty")
    const pending = kind === "question" ? questions : permissions
    const dock = kind === "question" ? questionDock : permissionDock
    try {
      for (const scope of scopes) await admit(scope, request, kind)
      await openScopes(page, scopes)
      await switchScope(page, first)
      await expect(dock(page)).toBeVisible()
      const before = await pending(first)
      await first.client.session.abort({ sessionID: first.sessionID })
      await expect.poll(async () => (await pending(first)).length).toBe(0)
      await expect(dock(page)).toHaveCount(0)
      for (const other of scopes.slice(1)) {
        expect(await pending(other)).toHaveLength(1)
        await switchScope(page, other)
        await expect(dock(page)).toBeVisible()
      }
      await testInfo.attach(`real-${kind}-cancellation`, {
        body: JSON.stringify(
          {
            sessionID: first.sessionID,
            cancelled: before.map((item) => item.id),
            otherScopesPending: scopes.length - 1,
          },
          null,
          2,
        ),
        contentType: "application/json",
      })
    } finally {
      await cleanup(scopes)
    }
  })
}

test("R03: two real backends × two Locations preserve question drafts through every directed SPA switch", async ({
  page,
  request,
}, testInfo) => {
  const scopes = await createScopes("question")
  try {
    for (const scope of scopes) await admit(scope, request, "question")
    await openScopes(page, scopes)
    for (const scope of scopes) {
      await switchScope(page, scope)
      await questionDock(page)
        .getByRole("radio", { name: /Type your own/ })
        .click()
      await customInput(page).fill(`Answer for ${scope.title}`)
    }
    const transitions = []
    for (const source of scopes) {
      for (const target of scopes.filter((scope) => scope !== source)) {
        await switchScope(page, source)
        await expect(
          questionDock(page).locator('button[data-custom="true"] [data-slot="option-description"]'),
        ).toHaveText(`Answer for ${source.title}`)
        await switchScope(page, target)
        await expect(
          questionDock(page).locator('button[data-custom="true"] [data-slot="option-description"]'),
        ).toHaveText(`Answer for ${target.title}`)
        await expect(questionDock(page).getByRole("button", { name: "Submit", exact: true })).toBeEnabled()
        transitions.push({ from: source.title, to: target.title })
      }
    }
    expect(transitions).toHaveLength(12)
    for (const scope of scopes) expect(await questions(scope)).toHaveLength(1)
    await testInfo.attach("real-scope-transitions", {
      body: JSON.stringify(transitions, null, 2),
      contentType: "application/json",
    })
  } finally {
    await cleanup(scopes)
  }
})

test("R03/S03: pending question submission stays with its captured server and Location until the real reply arrives", async ({
  page,
  request,
}, testInfo) => {
  const scopes = await createScopes("question")
  const protocol = await page.context().newCDPSession(page)
  try {
    for (const scope of scopes) await admit(scope, request, "question")
    await openScopes(page, scopes)
    for (const scope of scopes) {
      await switchScope(page, scope)
      await questionDock(page)
        .getByRole("radio", { name: /^Continue/ })
        .click()
    }
    const writes = []
    for (const [index, scope] of scopes.entries()) {
      const target = scopes[(index + 1) % scopes.length]
      if (!target) throw new Error("Missing next scope")
      const pending = (await questions(scope))[0]
      if (!pending) throw new Error("Missing pending question")
      await switchScope(page, scope)
      await questionDock(page)
        .getByRole("radio", { name: /^Continue/ })
        .click()
      const url = `${scope.backendUrl}/api/session/${scope.sessionID}/question/${pending.id}/reply`
      const paused = await pausePost(protocol, url)
      await questionDock(page).getByRole("button", { name: "Submit", exact: true }).click()
      const held = await paused.request
      expect(held.request.url).toBe(url)
      expect(held.request.method).toBe("POST")
      const targetPending = await questions(target)
      await switchScope(page, target)
      if (targetPending.length > 0) {
        await expect(questionDock(page).getByRole("button", { name: "Submit", exact: true })).toBeEnabled()
      }
      if (targetPending.length === 0) await expect(questionDock(page)).toHaveCount(0)
      await switchScope(page, scope)
      await expect(questionDock(page).getByRole("button", { name: "Submit", exact: true })).toBeDisabled()
      expect(await questions(scope)).toHaveLength(1)
      await protocol.send("Fetch.continueRequest", { requestId: held.requestId })
      await protocol.send("Fetch.disable")
      await expect.poll(async () => (await questions(scope)).length).toBe(0)
      await expect(questionDock(page)).toHaveCount(0)
      const duplicate = await request.post(url, { data: { answers: [["Continue"]] } })
      expect(duplicate.status()).toBe(404)
      writes.push({ sessionID: scope.sessionID, requestID: pending.id, url, duplicateStatus: duplicate.status() })
    }
    await testInfo.attach("real-question-decisions", {
      body: JSON.stringify(writes, null, 2),
      contentType: "application/json",
    })
  } finally {
    await protocol.send("Fetch.disable")
    await protocol.detach()
    await cleanup(scopes)
  }
})

test("R03/S03: permission clicks settle only the owning real backend and Location", async ({
  page,
  request,
}, testInfo) => {
  const scopes = await createScopes("permission")
  const protocol = await page.context().newCDPSession(page)
  try {
    for (const scope of scopes) await admit(scope, request, "permission")
    await openScopes(page, scopes)
    const decisions = []
    for (const [index, scope] of scopes.entries()) {
      const target = scopes[(index + 1) % scopes.length]
      if (!target) throw new Error("Missing next scope")
      const pending = (await permissions(scope))[0]
      if (!pending) throw new Error("Missing pending permission")
      for (const other of scopes.filter((item) => item !== scope)) {
        const response = await request.post(
          `${other.backendUrl}/session/${other.sessionID}/permissions/${pending.id}`,
          {
            headers: { "x-aigcfroge-directory": other.directory },
            data: { response: "once" },
          },
        )
        expect(response.status()).toBe(404)
      }
      expect(await permissions(scope)).toHaveLength(1)
      await switchScope(page, scope)
      const url = `${scope.backendUrl}/session/${scope.sessionID}/permissions/${pending.id}`
      const paused = await pausePost(protocol, url)
      await permissionDock(page).getByRole("button", { name: "Allow once", exact: true }).click()
      const held = await paused.request
      expect(held.request.url).toBe(url)
      const targetPending = await permissions(target)
      await switchScope(page, target)
      if (targetPending.length > 0) {
        await expect(permissionDock(page).getByRole("button", { name: "Allow once", exact: true })).toBeEnabled()
      }
      if (targetPending.length === 0) await expect(permissionDock(page)).toHaveCount(0)
      await switchScope(page, scope)
      await expect(permissionDock(page).getByRole("button", { name: "Allow once", exact: true })).toBeDisabled()
      expect(await permissions(scope)).toHaveLength(1)
      await protocol.send("Fetch.continueRequest", { requestId: held.requestId })
      await protocol.send("Fetch.disable")
      await expect.poll(async () => (await permissions(scope)).length).toBe(0)
      await expect(permissionDock(page)).toHaveCount(0)
      await expect
        .poll(async () => {
          const completed = await scope.client.session.messages({ sessionID: scope.sessionID })
          return completed.data
            ?.flatMap((message) => message.parts)
            .some((part) => part.type === "tool" && part.state.status === "completed")
        })
        .toBe(true)
      decisions.push({
        sessionID: scope.sessionID,
        requestID: pending.id,
        backendUrl: scope.backendUrl,
        directory: scope.directory,
      })
    }
    await testInfo.attach("real-permission-decisions", {
      body: JSON.stringify(decisions, null, 2),
      contentType: "application/json",
    })
  } finally {
    await protocol.send("Fetch.disable")
    await protocol.detach()
    await cleanup(scopes)
  }
})
