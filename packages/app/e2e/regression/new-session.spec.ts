import { expect, test, type Locator, type Page, type Request } from "@playwright/test"
import type { OmnixaEvent, SessionMessageInfo, WorktreeDirectory } from "@omnixa/client/promise"
import { Schema } from "effect"
import {
  REMOTE_SERVER,
  SERVER,
  draftHref,
  expectPath,
  holdRoute,
  project,
  provider,
  seed,
  session,
  sessionHref,
} from "../utils/app"
import { mockServers, type MockAnswer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"
import { openDraft, openSession, openWorktreeDraft, type WorkspaceInput } from "../utils/workspace"
import { attachSession } from "../utils/side-panel"

const directory = "C:/Omnixa/WorkspacePending"

const workspace = "C:/Omnixa/pending-workspace"

const projectID = "proj_workspace_pending"

const draftID = "draft_workspace_pending"

const otherID = "ses_workspace_pending_other"

const text = "Create the workspace, then explain the pending session."

const followUp = "Then explain the setup scripts.\nInclude the install command."

const headers = { "access-control-allow-origin": "*" }

const editor = (page: Page) => page.locator('[data-component="composer-editor"]')

const submit = (page: Page) => page.locator('[data-action="composer-submit"]')

const mode = (page: Page) =>
  page.locator('[data-component="new-session"]').getByRole("button", { name: /^Session mode(?: |$)/ })

const tabLink = (page: Page, sessionID: string) =>
  page.locator(`[data-titlebar-tab-link][href="${sessionHref(sessionID)}"]`)

// A draft on the local project (C:/Omnixa/WorkspacePending) beside one other session tab.
const pendingDraft = {
  name: "WorkspacePending",
  draftID,
  project: { id: projectID, name: "workspace-pending" },
  provider: provider({ id: "pending-model", name: "Pending Model" }),
  sessions: [{ id: otherID, title: "Other session" }],
  createdSessionTitle: "Created workspace session",
} satisfies WorkspaceInput & { draftID: string }

const failFirstCreate = (
  _input: Parameters<NonNullable<WorkspaceInput["onSessionCreate"]>>[0],
  attempt: number,
): MockAnswer | undefined =>
  attempt === 1 ? { status: 500, body: { message: "Session creation failed in the fixture" } } : undefined

test("SC05 response Fork captures main and cross-server side targets without prompting", async ({ page }, testInfo) => {
  const id = "ses_response_fork_same_id"
  const metaChildID = "ses_response_fork_meta_child"
  const localDirectory = "C:/Omnixa/ResponseFork"
  const remoteDirectory = "/remote/response-fork"
  const model = { id: "response-fork-model", providerID: "omnixa" }

  const localSessions = [
    session({ id, directory: localDirectory, title: "Local response source", mode: "coding", agent: "build", model }),
  ]

  const remoteSessions = [
    session({ id, directory: remoteDirectory, title: "Remote response source", mode: "coding", agent: "plan", model }),
    session({
      id: metaChildID,
      directory: remoteDirectory,
      title: "Meta child response",
      mode: "coding",
      agent: "build",
      model,
      parentID: id,
      controller: {
        kind: "child",
        rootSessionID: id,
        metaAgentID: "mag_response_fork",
        executor: { agent: "build", model, source: "tool" },
        source: { kind: "subagent", assistantMessageID: "msg_remote_a1_suffix", toolCallID: "tool_remote_suffix" },
      },
    }),
  ]

  const gate = Promise.withResolvers<void>()
  const arrived = Promise.withResolvers<void>()
  const mutations: string[] = []
  const requests: { server: string; body: unknown }[] = []

  const messages = (source: string): SessionMessageInfo[] => [
    { id: `msg_${source}_u1`, type: "user", text: `First ${source} question`, time: { created: 1 } },
    {
      id: `msg_${source}_a1`,
      type: "assistant",
      agent: "build",
      model,
      needsContinuation: true,
      time: { created: 2, completed: 3 },
      content: [{ type: "text", text: `First ${source} answer` }],
    },
    {
      id: `msg_${source}_a1_suffix`,
      type: "assistant",
      agent: "build",
      model,
      needsContinuation: false,
      time: { created: 4, completed: 5 },
      content: [
        {
          id: `tool_${source}_suffix`,
          type: "tool",
          name: "read",
          time: { created: 4, completed: 5 },
          state: {
            status: "completed",
            input: { filePath: "suffix.ts" },
            metadata: {},
            content: [{ type: "text", text: "settled tool result" }],
          },
        },
      ],
    },
    { id: `msg_${source}_u2`, type: "user", text: `Second ${source} question`, time: { created: 6 } },
    {
      id: `msg_${source}_a2`,
      type: "assistant",
      agent: "build",
      model,
      needsContinuation: false,
      time: { created: 7, completed: 8 },
      content: [{ type: "text", text: `Second ${source} answer` }],
    },
  ]

  page.on("request", (request) => {
    const url = new URL(request.url())

    if (request.method() !== "POST") return

    if (url.pathname === "/api/session" || /^\/api\/session\/[^/]+\/(prompt|interrupt)$/.test(url.pathname))
      mutations.push(request.url())
  })

  const servers = await mockServers(page, {
    [SERVER]: {
      directory: localDirectory,
      project: project({ id: "proj_response_fork_local", directory: localDirectory }),
      provider: provider({ id: model.id, name: "Response Fork Model" }),
      sessions: localSessions,
      pageMessages: (sessionID) => ({ items: sessionID === id ? messages("local") : [] }),
      onSessionFork: (input) => void requests.push({ server: SERVER, body: input }),
    },
    [REMOTE_SERVER]: {
      directory: remoteDirectory,
      project: project({ id: "proj_response_fork_remote", directory: remoteDirectory }),
      provider: provider({ id: model.id, name: "Remote Fork Model" }),
      sessions: remoteSessions,
      pageMessages: (sessionID) => ({
        items: sessionID === id ? messages("remote") : sessionID === metaChildID ? messages("meta_child") : [],
      }),
      onSessionFork: async (input) => {
        requests.push({ server: REMOTE_SERVER, body: input })
        arrived.resolve()
        await gate.promise
      },
    },
  })

  await seed(page, {
    servers: [{ url: REMOTE_SERVER, name: "Remote response server" }],
    projects: {
      local: [{ worktree: localDirectory, expanded: true }],
      [REMOTE_SERVER]: [{ worktree: remoteDirectory, expanded: true }],
    },
    lastProject: { local: localDirectory, [REMOTE_SERVER]: remoteDirectory },
    tabs: [id, { session: id, server: REMOTE_SERVER }],
  })
  await page.goto(sessionHref(id))
  await expectSessionTitle(page, "Local response source")
  const first = page.locator('[data-component="text-part"]', { hasText: "First local answer" })
  await first.hover()
  await expect(first.getByRole("button", { name: "Fork from message", exact: true })).toBeVisible()

  const localResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === SERVER &&
      new URL(response.url()).pathname === `/api/session/${id}/fork`,
  )

  await first.getByRole("button", { name: "Fork from message", exact: true }).click()
  const local = await localResponse
  expect(local.status()).toBe(200)
  expect(local.request().postDataJSON()).toEqual({ through: "msg_local_a1_suffix" })
  await expect.poll(() => localSessions.length).toBe(2)
  await expectPath(page, sessionHref(localSessions[1].id))
  await expect(editor(page)).toHaveText("")
  expect(mutations).toEqual([])

  await tabLink(page, id).click()
  await expectSessionTitle(page, "Local response source")
  await attachSession(page, { server: REMOTE_SERVER, sessionID: id, title: "Remote response source" })
  const side = page.getByRole("region", { name: "Session views", exact: true })
  await expect(side.getByText("First remote answer", { exact: true })).toBeVisible()
  const sideFirst = side.locator('[data-component="text-part"]', { hasText: "First remote answer" })
  await sideFirst.hover()

  const remoteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === REMOTE_SERVER &&
      new URL(response.url()).pathname === `/api/session/${id}/fork`,
  )

  await sideFirst.getByRole("button", { name: "Fork from message", exact: true }).click()
  await arrived.promise
  expect(requests).toEqual([
    { server: SERVER, body: { sessionID: id, through: "msg_local_a1_suffix" } },
    { server: REMOTE_SERVER, body: { sessionID: id, through: "msg_remote_a1_suffix" } },
  ])
  await expect(sideFirst.getByRole("button", { name: "Fork from message", exact: true })).toBeDisabled()

  const mounts = await sideFirst
    .getByRole("button", { name: "Fork from message", exact: true })
    .evaluateHandle((node) => {
      const state = { node, added: 0, removed: 0 }

      const observer = new MutationObserver((records) =>
        records.forEach((record) => {
          state.added += [...record.addedNodes].filter((item) => item === node || item.contains(node)).length
          state.removed += [...record.removedNodes].filter((item) => item === node || item.contains(node)).length
        }),
      )

      observer.observe(document.body, { childList: true, subtree: true })

      return { state, observer }
    })

  await servers[REMOTE_SERVER].transport.burst([
    {
      id: "evt_response_fork_execution",
      created: 1700000010000,
      type: "session.execution.started",
      location: { directory: remoteDirectory },
      durable: { aggregateID: id, seq: 100, version: 1 },
      data: { sessionID: id },
    },
    {
      id: "evt_response_fork_step",
      created: 1700000010001,
      type: "session.step.started",
      location: { directory: remoteDirectory },
      durable: { aggregateID: id, seq: 101, version: 1 },
      data: { sessionID: id, assistantMessageID: "msg_remote_a3", agent: "plan", model, started: 1700000010001 },
    },
    {
      id: "evt_response_fork_text",
      created: 1700000010002,
      type: "session.text.started",
      location: { directory: remoteDirectory },
      durable: { aggregateID: id, seq: 102, version: 1 },
      data: { sessionID: id, assistantMessageID: "msg_remote_a3", ordinal: 0 },
    },
  ])

  for (const [index, delta] of ["Stream", "ing ", "while ", "Fork waits"].entries()) {
    await servers[REMOTE_SERVER].transport.send({
      id: `evt_response_fork_delta_${index}`,
      created: 1700000010003 + index,
      type: "session.text.delta",
      location: { directory: remoteDirectory },
      data: { sessionID: id, assistantMessageID: "msg_remote_a3", ordinal: 0, delta },
    })
  }

  await expect(side.getByText("Streaming while Fork waits", { exact: true })).toBeVisible()

  const observed = await mounts.evaluate(({ state, observer }) => {
    observer.disconnect()

    return { initial: 1, added: state.added, removed: state.removed, connected: state.node.isConnected }
  })

  await mounts.dispose()
  await testInfo.attach("SC05 response button mounts", {
    body: JSON.stringify(observed),
    contentType: "application/json",
  })
  expect(observed).toEqual({ initial: 1, added: 0, removed: 0, connected: true })
  gate.resolve()
  const remote = await remoteResponse
  expect(remote.status()).toBe(200)
  expect(remote.request().postDataJSON()).toEqual({ through: "msg_remote_a1_suffix" })
  await expect.poll(() => remoteSessions.length).toBe(3)
  await expectPath(page, sessionHref(remoteSessions[2].id, REMOTE_SERVER))
  await expect(editor(page)).toHaveText("")
  expect(mutations).toEqual([])
  expect(localSessions).toHaveLength(2)
  expect(remoteSessions).toHaveLength(3)
  await page.goto(sessionHref(metaChildID, REMOTE_SERVER))
  const child = page.locator('[data-component="text-part"]', { hasText: "First meta_child answer" })
  await expect(child.getByRole("button", { name: "Copy response", exact: true })).toBeVisible()
  await expect(child.getByRole("button", { name: "Fork from message", exact: true })).toHaveCount(0)
  expect(requests).toHaveLength(2)
  expect(mutations).toEqual([])
})

test("managed fork previews the legacy source without a saved delegation preference", async ({ page }) => {
  const view = await openSession(page, {
    name: "ManagedFork",
    provider: provider({ id: "fork-model", name: "Fork Model" }),
    sessions: [
      {
        id: "ses_managed_fork",
        title: "Legacy fork source",
        mode: "coding",
        agent: "build",
        model: { id: "fork-model", providerID: "omnixa", variant: "default" },
      },
    ],
    pageMessages: () => ({
      items: [{ id: "msg_managed_fork", type: "user", text: "Fork this exact prompt.", time: { created: 1 } }],
    }),
  })

  await expect(page.locator('[data-slot="user-message-text"]')).toHaveText("Fork this exact prompt.")
  await page.keyboard.press("ControlOrMeta+Shift+P")
  const palette = page.getByRole("dialog")
  await expect(palette.getByRole("textbox")).toBeFocused()
  await palette.getByRole("textbox").fill("Fork from message")
  await palette.getByRole("option", { name: /Fork from message/ }).click()
  const dialog = page.getByRole("dialog")

  const previewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).origin === view.server &&
      new URL(response.url()).pathname === "/api/session/ses_managed_fork",
  )

  await dialog.getByRole("button", { name: /Fork this exact prompt/ }).click()
  const preview: unknown = await (await previewResponse).json()

  if (!Schema.is(Schema.JsonObject)(preview) || !Schema.is(Schema.JsonObject)(preview.data))
    throw new Error("Legacy fork source Info is unavailable")
  const source = preview.data
  expect(source).toMatchObject({
    id: "ses_managed_fork",
    mode: "coding",
    agent: "build",
    model: { id: "fork-model", providerID: "omnixa", variant: "default" },
    location: { directory: view.directory },
  })
  expect(source.controller).toBeUndefined()
  expect(source.executorPreference).toBeUndefined()
  await expect(dialog.getByText("Legacy fork source", { exact: true })).toBeVisible()
  const managed = dialog.getByRole("checkbox", { name: "Use Meta orchestration" })
  await expect(managed).not.toBeChecked()
  await managed.check()
  await expect(dialog.getByText("omnixa / fork-model / default", { exact: true })).toHaveCount(1)
  await expect(dialog.getByText("Use the default delegated Agent", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Use the initial model configuration", { exact: true })).toBeVisible()

  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).origin === view.server &&
      new URL(response.url()).pathname === "/api/session/ses_managed_fork/fork",
  )

  await dialog.getByRole("button", { name: "Confirm fork", exact: true }).click()
  const acknowledged = await response
  expect(acknowledged.status()).toBe(200)
  expect(acknowledged.request().postDataJSON()).toEqual({
    before: "msg_managed_fork",
    control: "meta",
    model: { id: "fork-model", providerID: "omnixa", variant: "default" },
    expectedSource: {
      sourceSessionID: source.id,
      mode: source.mode,
      agent: source.agent,
      model: source.model,
    },
  })
  await expect
    .poll(() => view.sessions.find((session) => session.id !== "ses_managed_fork"))
    .toMatchObject({
      agent: "meta",
      controller: { kind: "root" },
      model: { id: "fork-model", providerID: "omnixa", variant: "default" },
    })
  const forked = view.sessions.find((session) => session.id !== "ses_managed_fork")!
  await expectPath(page, sessionHref(forked.id))

  const readback: unknown = await page.evaluate(
    async ({ server, sessionID }) => {
      const response = await fetch(server + "/api/session/" + sessionID)

      if (response.status !== 200) throw new Error("Legacy fork canonical GET failed")

      return response.json()
    },
    { server: view.server, sessionID: forked.id },
  )

  if (!Schema.is(Schema.JsonObject)(readback) || !Schema.is(Schema.JsonObject)(readback.data))
    throw new Error("Legacy fork canonical Info is unavailable")
  expect(readback.data).toMatchObject({ id: forked.id, mode: source.mode, agent: "meta", model: source.model })
  expect(readback.data.controller).toEqual({
    kind: "root",
    rootSessionID: forked.id,
    metaAgentID: expect.any(String),
  })
  expect(readback.data.executorPreference).toBeUndefined()
  expect(view.sessions).toHaveLength(2)
  await expect(editor(page)).toHaveText("Fork this exact prompt.")
  await page.reload()
  await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Fork Model$/)
})

for (const agent of ["build", "plan"]) {
  test(`ordinary ${agent} fork remains ordinary with Meta unchecked`, async ({ page }) => {
    const calls: unknown[] = []

    const view = await openSession(page, {
      name: "OrdinaryFork" + agent,
      provider: provider({ id: "fork-model", name: "Fork Model" }),
      sessions: [
        {
          id: "ses_ordinary_fork_" + agent,
          title: "Ordinary " + agent + " source",
          mode: "coding",
          agent,
          model: { id: "fork-model", providerID: "omnixa", variant: "default" },
        },
      ],
      pageMessages: () => ({
        items: [{ id: "msg_ordinary_fork", type: "user", text: "Fork this ordinary prompt.", time: { created: 1 } }],
      }),
      onSessionFork: (input) => {
        calls.push(input)
      },
    })

    await expect(page.locator('[data-slot="user-message-text"]')).toHaveText("Fork this ordinary prompt.")
    await page.keyboard.press("ControlOrMeta+Shift+P")
    const palette = page.getByRole("dialog")
    await expect(palette.getByRole("textbox")).toBeFocused()
    await palette.getByRole("textbox").fill("Fork from message")
    await palette.getByRole("option", { name: /Fork from message/ }).click()
    const dialog = page.getByRole("dialog")

    const captured = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).origin === view.server &&
        new URL(response.url()).pathname === "/api/session/" + view.session.id,
    )

    await dialog.getByRole("button", { name: /Fork this ordinary prompt/ }).click()
    const preview: unknown = await (await captured).json()

    if (!Schema.is(Schema.JsonObject)(preview) || !Schema.is(Schema.JsonObject)(preview.data))
      throw new Error("Ordinary fork source Info is unavailable")
    const source = preview.data
    expect(source).toMatchObject({
      id: view.session.id,
      mode: "coding",
      agent,
      model: { id: "fork-model", providerID: "omnixa", variant: "default" },
      location: { directory: view.directory },
    })
    expect(source.controller).toBeUndefined()
    expect(source.executorPreference).toBeUndefined()
    await expect(dialog.getByText(`${source.id} · ${source.mode} · ${source.agent}`, { exact: true })).toBeVisible()
    const managed = dialog.getByRole("checkbox", { name: "Use Meta orchestration" })
    await expect(managed).not.toBeChecked()
    await expect(managed).toBeEnabled()
    await expect(dialog.getByText("Session model", { exact: true })).toBeVisible()
    await expect(dialog.getByText("omnixa / fork-model / default", { exact: true })).toHaveCount(1)
    await expect(dialog.getByText("Delegated Agent", { exact: true })).toHaveCount(0)
    await expect(dialog.getByText("Delegated model", { exact: true })).toHaveCount(0)
    await expect(dialog.getByText("Use the default delegated Agent", { exact: true })).toHaveCount(0)
    await expect(dialog.getByText("Use the initial model configuration", { exact: true })).toHaveCount(0)
    await expect(dialog.getByRole("button", { name: "Confirm fork", exact: true })).toBeEnabled()

    const response = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).origin === view.server &&
        new URL(response.url()).pathname === "/api/session/" + view.session.id + "/fork",
    )

    await dialog.getByRole("button", { name: "Confirm fork", exact: true }).click()
    const acknowledged = await response
    expect(acknowledged.status()).toBe(200)
    const request: unknown = acknowledged.request().postDataJSON()

    if (!Schema.is(Schema.JsonObject)(request)) throw new Error("Ordinary fork request is unavailable")
    expect(request).toEqual({
      before: "msg_ordinary_fork",
      expectedSource: {
        sourceSessionID: source.id,
        mode: source.mode,
        agent: source.agent,
        model: source.model,
      },
    })
    expect(request.control).toBeUndefined()
    expect(request.model).toBeUndefined()
    expect(request.executorPreference).toBeUndefined()
    expect(calls).toHaveLength(1)
    const result: unknown = await acknowledged.json()

    if (
      !Schema.is(Schema.JsonObject)(result) ||
      !Schema.is(Schema.JsonObject)(result.data) ||
      !Schema.is(Schema.String)(result.data.id)
    )
      throw new Error("Ordinary fork result is unavailable")
    await expectPath(page, sessionHref(result.data.id))

    const readback: unknown = await page.evaluate(
      async ({ server, sessionID }) => {
        const response = await fetch(server + "/api/session/" + sessionID)

        if (response.status !== 200) throw new Error("Ordinary fork canonical GET failed")

        return response.json()
      },
      { server: view.server, sessionID: result.data.id },
    )

    if (!Schema.is(Schema.JsonObject)(readback) || !Schema.is(Schema.JsonObject)(readback.data))
      throw new Error("Ordinary fork canonical Info is unavailable")
    expect(readback.data).toMatchObject({
      id: result.data.id,
      mode: source.mode,
      agent: source.agent,
      model: source.model,
      location: source.location,
    })
    expect(readback.data.controller).toBeUndefined()
    expect(readback.data.executorPreference).toBeUndefined()
    await expect(editor(page)).toHaveText("Fork this ordinary prompt.")
  })
}

for (const agent of ["meta", "build", "plan"]) {
  for (const useMeta of agent === "meta" ? [true] : [false, true]) {
    test(`saved Meta source selected as ${agent} forks ${useMeta ? "with Meta" : "ordinarily"}`, async ({ page }) => {
      const calls: unknown[] = []

      const view = await openSession(page, {
        name: "SavedMetaFork",
        provider: provider(
          { id: "session-model", name: "Session Model" },
          { id: "executor-model", name: "Executor Model" },
        ),
        sessions: [
          {
            id: "ses_saved_meta_setup",
            title: "Meta fork setup",
            mode: "coding",
            agent: "build",
            model: { id: "session-model", providerID: "omnixa" },
          },
        ],
        pageMessages: (id) => ({
          items:
            id === "ses_saved_meta_fork"
              ? [{ id: "msg_saved_meta_fork", type: "user", text: "Fork the saved Meta source.", time: { created: 1 } }]
              : [],
        }),
        onSessionFork: (input) => {
          calls.push(input)
        },
      })

      const saved: unknown = await page.evaluate(
        async ({ server, directory, agent }) => {
          const created = await fetch(server + "/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: "ses_saved_meta_fork",
              title: "Saved Meta fork source",
              location: { directory },
              mode: "coding",
              agent: "meta",
              model: { id: "session-model", providerID: "omnixa" },
            }),
          })

          if (created.status !== 200) throw new Error("Meta source creation failed")

          const selected = await fetch(server + "/api/session/ses_saved_meta_fork/executor", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agent: "build", model: { id: "executor-model", providerID: "omnixa" } }),
          })

          if (selected.status !== 200) throw new Error("Meta executor selection failed")

          if (agent !== "meta") {
            const switched = await fetch(server + "/api/session/ses_saved_meta_fork/agent", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ agent }),
            })

            if (switched.status !== 204) throw new Error("Historical Meta Agent switch failed")
          }

          const response = await fetch(server + "/api/session/ses_saved_meta_fork")

          if (response.status !== 200) throw new Error("Saved Meta source canonical GET failed")

          return response.json()
        },
        { server: view.server, directory: view.directory, agent },
      )

      if (
        !Schema.is(Schema.JsonObject)(saved) ||
        !Schema.is(Schema.JsonObject)(saved.data) ||
        !Schema.is(Schema.JsonObject)(saved.data.controller)
      )
        throw new Error("Saved Meta source Info is unavailable")
      const retained = saved.data
      const controller = saved.data.controller
      expect(retained).toMatchObject({
        id: "ses_saved_meta_fork",
        mode: "coding",
        agent,
        model: { id: "session-model", providerID: "omnixa" },
        location: { directory: view.directory },
      })
      expect(controller).toEqual({
        kind: "root",
        rootSessionID: "ses_saved_meta_fork",
        metaAgentID: expect.any(String),
      })
      expect(retained.executorPreference).toEqual({
        agent: "build",
        model: { id: "executor-model", providerID: "omnixa" },
      })
      await page.goto(sessionHref("ses_saved_meta_fork"))
      await expectSessionTitle(page, "Saved Meta fork source")
      await expect(editor(page)).toBeEditable()
      await expect(page.locator('[data-slot="user-message-text"]')).toHaveText("Fork the saved Meta source.")
      await page.keyboard.press("ControlOrMeta+Shift+P")
      const palette = page.getByRole("dialog")
      await expect(palette.getByRole("textbox")).toBeFocused()
      await palette.getByRole("textbox").fill("Fork from message")
      await palette.getByRole("option", { name: /Fork from message/ }).click()
      const dialog = page.getByRole("dialog")

      const captured = page.waitForResponse(
        (response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).origin === view.server &&
          new URL(response.url()).pathname === "/api/session/ses_saved_meta_fork",
      )

      await dialog.getByRole("button", { name: /Fork the saved Meta source/ }).click()
      const preview: unknown = await (await captured).json()

      if (!Schema.is(Schema.JsonObject)(preview) || !Schema.is(Schema.JsonObject)(preview.data))
        throw new Error("Saved Meta fork preview Info is unavailable")
      const source = preview.data
      expect(source).toMatchObject({
        id: retained.id,
        mode: retained.mode,
        agent: retained.agent,
        model: retained.model,
        controller,
        executorPreference: retained.executorPreference,
        location: retained.location,
      })
      await expect(dialog.getByText(`${source.id} · ${source.mode} · ${source.agent}`, { exact: true })).toBeVisible()
      const managed = dialog.getByRole("checkbox", { name: "Use Meta orchestration" })

      if (agent === "meta") {
        await expect(managed).toBeChecked()
        await expect(managed).toBeDisabled()
      }

      if (agent !== "meta") {
        await expect(managed).not.toBeChecked()
        await expect(managed).toBeEnabled()
        await expect(dialog.getByText("Delegated Agent", { exact: true })).toHaveCount(0)
        await expect(dialog.getByText("Delegated model", { exact: true })).toHaveCount(0)
        await expect(dialog.getByText("omnixa / executor-model / Implicit variant", { exact: true })).toHaveCount(0)

        if (useMeta) await managed.check()
      }

      await expect(dialog.getByText("Session model", { exact: true })).toBeVisible()
      await expect(dialog.getByText("omnixa / session-model / Implicit variant", { exact: true })).toHaveCount(1)

      if (useMeta) {
        await expect(managed).toBeChecked()
        await expect(dialog.getByText("Delegated Agent", { exact: true })).toBeVisible()
        await expect(dialog.getByText("build", { exact: true })).toBeVisible()
        await expect(dialog.getByText("Delegated model", { exact: true })).toBeVisible()
        await expect(dialog.getByText("omnixa / executor-model / Implicit variant", { exact: true })).toHaveCount(1)
      }

      if (!useMeta) {
        await expect(managed).not.toBeChecked()
        await expect(dialog.getByText("Delegated Agent", { exact: true })).toHaveCount(0)
        await expect(dialog.getByText("Delegated model", { exact: true })).toHaveCount(0)
      }

      await expect(dialog.getByText("Use the default delegated Agent", { exact: true })).toHaveCount(0)
      await expect(dialog.getByText("Use the initial model configuration", { exact: true })).toHaveCount(0)
      await expect(dialog.getByRole("button", { name: "Confirm fork", exact: true })).toBeEnabled()

      const response = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).origin === view.server &&
          new URL(response.url()).pathname === "/api/session/ses_saved_meta_fork/fork",
      )

      await dialog.getByRole("button", { name: "Confirm fork", exact: true }).click()
      const acknowledged = await response
      expect(acknowledged.status()).toBe(200)
      const request: unknown = acknowledged.request().postDataJSON()

      if (!Schema.is(Schema.JsonObject)(request)) throw new Error("Saved Meta fork request is unavailable")
      expect(request).toEqual(
        useMeta
          ? {
              before: "msg_saved_meta_fork",
              expectedSource: {
                sourceSessionID: source.id,
                mode: source.mode,
                agent: source.agent,
                controller: source.controller,
                model: source.model,
              },
              control: "meta",
              model: source.model,
              executorPreference: source.executorPreference,
            }
          : {
              before: "msg_saved_meta_fork",
              expectedSource: {
                sourceSessionID: source.id,
                mode: source.mode,
                agent: source.agent,
                controller: source.controller,
                model: source.model,
              },
            },
      )

      if (!useMeta) {
        expect(request.control).toBeUndefined()
        expect(request.model).toBeUndefined()
        expect(request.executorPreference).toBeUndefined()
      }

      expect(calls).toHaveLength(1)
      const result: unknown = await acknowledged.json()

      if (
        !Schema.is(Schema.JsonObject)(result) ||
        !Schema.is(Schema.JsonObject)(result.data) ||
        !Schema.is(Schema.String)(result.data.id)
      )
        throw new Error("Saved Meta fork result is unavailable")
      await expectPath(page, sessionHref(result.data.id))

      const readback: unknown = await page.evaluate(
        async ({ server, sessionID }) => {
          const forked = await fetch(server + "/api/session/" + sessionID)

          if (forked.status !== 200) throw new Error("Saved Meta fork canonical GET failed")
          const source = await fetch(server + "/api/session/ses_saved_meta_fork")

          if (source.status !== 200) throw new Error("Saved Meta source readback failed")

          return { forked: await forked.json(), source: await source.json() }
        },
        { server: view.server, sessionID: result.data.id },
      )

      if (
        !Schema.is(Schema.JsonObject)(readback) ||
        !Schema.is(Schema.JsonObject)(readback.forked) ||
        !Schema.is(Schema.JsonObject)(readback.forked.data) ||
        !Schema.is(Schema.JsonObject)(readback.source) ||
        !Schema.is(Schema.JsonObject)(readback.source.data)
      )
        throw new Error("Saved Meta canonical readback Info is unavailable")
      const forked = readback.forked.data
      expect(forked).toMatchObject({
        id: result.data.id,
        mode: source.mode,
        agent: useMeta ? "meta" : source.agent,
        model: source.model,
        location: source.location,
      })

      if (useMeta) {
        expect(forked.controller).toEqual({
          kind: "root",
          rootSessionID: forked.id,
          metaAgentID: controller.metaAgentID,
        })
        expect(forked.executorPreference).toEqual(source.executorPreference)
      }

      if (!useMeta) {
        expect(forked.controller).toBeUndefined()
        expect(forked.executorPreference).toBeUndefined()
      }

      expect(readback.source.data).toMatchObject({
        id: source.id,
        mode: source.mode,
        agent: source.agent,
        model: source.model,
        controller,
        executorPreference: source.executorPreference,
        location: source.location,
      })
      await expect(editor(page)).toHaveText("Fork the saved Meta source.")
    })
  }
}

test("managed fork rejects a changed source and requires another preview", async ({ page }) => {
  const arrived = Promise.withResolvers<void>()
  const gate = Promise.withResolvers<void>()

  const view = await openSession(page, {
    name: "ForkSourceConflict",
    provider: provider({ id: "fork-model", name: "Fork Model" }),
    sessions: [
      {
        id: "ses_fork_conflict",
        title: "Fork source conflict",
        mode: "coding",
        agent: "build",
        model: { providerID: "omnixa", id: "fork-model" },
      },
    ],
    pageMessages: () => ({
      items: [{ id: "msg_fork_conflict", type: "user", text: "Preview this source.", time: { created: 1 } }],
    }),
    onSessionFork: async () => {
      arrived.resolve()
      await gate.promise
    },
  })

  await page.keyboard.press("ControlOrMeta+Shift+P")
  const palette = page.getByRole("dialog")
  await expect(palette.getByRole("textbox")).toBeFocused()
  await palette.getByRole("textbox").fill("Fork from message")
  await palette.getByRole("option", { name: /Fork from message/ }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: /Preview this source/ }).click()
  const managed = dialog.getByRole("checkbox", { name: "Use Meta orchestration" })
  await managed.check()

  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/session/ses_fork_conflict/fork",
  )

  await dialog.getByRole("button", { name: "Confirm fork", exact: true }).click()
  await arrived.promise
  Object.assign(view.session, { model: { id: "fork-model", variant: "default", providerID: "omnixa" } })
  gate.resolve()
  const rejected = await response
  expect(rejected.status()).toBe(400)
  const failure: unknown = await rejected.json()
  expect(failure).toHaveProperty("_tag", "InvalidRequestError")
  expect(failure).toMatchObject({
    field: "expectedSource",
    kind: "fork_source_conflict",
  })
  await expect(dialog.getByRole("button", { name: /Preview this source/ })).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Confirm fork", exact: true })).toHaveCount(0)
  expect(view.sessions).toHaveLength(1)
  await expectPath(page, sessionHref(view.session.id))
  await dialog.getByRole("button", { name: /Preview this source/ }).click()
  await expect(managed).not.toBeChecked()
  await managed.check()
  await expect(dialog.getByText("omnixa / fork-model / default", { exact: true })).toHaveCount(1)
  await expect(dialog.getByText("Use the default delegated Agent", { exact: true })).toBeVisible()
  await expect(dialog.getByText("Use the initial model configuration", { exact: true })).toBeVisible()
})

for (const result of ["success", "failure"] as const) {
  test(`closed fork dialog ignores its late ${result} after changing Session`, async ({ page }) => {
    const arrived = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const calls: unknown[] = []

    const view = await openSession(page, {
      name: "ForkLateOwner",
      provider: provider({ id: "fork-model", name: "Fork Model" }),
      sessionID: "ses_fork_late",
      sessions: [
        {
          id: "ses_fork_late",
          title: "Old fork owner",
          mode: "coding",
          agent: "build",
          model: { id: "fork-model", providerID: "omnixa" },
        },
        {
          id: "ses_fork_current",
          title: "Current fork owner",
          mode: "coding",
          agent: "build",
          model: { id: "fork-model", providerID: "omnixa" },
        },
      ],
      pageMessages: (id) => ({
        items:
          id === "ses_fork_late"
            ? [{ id: "msg_fork_late", type: "user", text: "Keep this fork separate.", time: { created: 1 } }]
            : [],
      }),
      onSessionFork: async (input) => {
        calls.push(input)
        arrived.resolve()
        await gate.promise

        if (result === "failure") throw new Error("Old fork failed")
      },
    })

    await page.keyboard.press("ControlOrMeta+Shift+P")
    const palette = page.getByRole("dialog")
    await expect(palette.getByRole("textbox")).toBeFocused()
    await palette.getByRole("textbox").fill("Fork from message")
    await palette.getByRole("option", { name: /Fork from message/ }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: /Keep this fork separate/ }).click()
    await expect(dialog.getByRole("button", { name: "Confirm fork", exact: true })).toBeEnabled()

    const response = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/session/ses_fork_late/fork",
    )

    await dialog.getByRole("button", { name: "Confirm fork", exact: true }).click()
    await arrived.promise
    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await tabLink(page, "ses_fork_current").click()
    await expectPath(page, sessionHref("ses_fork_current"))
    await expect(editor(page)).toBeEditable()
    gate.resolve()
    const completed = await response
    expect(completed.status()).toBe(result === "success" ? 200 : 500)
    await completed.body()
    await editor(page).fill("Keep the current owner selection.")
    await expect(editor(page)).toHaveText("Keep the current owner selection.")
    await expectPath(page, sessionHref("ses_fork_current"))
    await expect(page.getByText("Request failed", { exact: true })).toHaveCount(0)
    expect(calls).toHaveLength(1)
    expect(view.sessions).toHaveLength(result === "success" ? 3 : 2)
    const durable = view.sessions.find((session) => !["ses_fork_late", "ses_fork_current"].includes(session.id))

    if (durable) await expect(tabLink(page, durable.id)).toHaveCount(0)
  })
}

test.use({
  serviceWorkers: "block",
  viewport: { width: 1280, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
})

test("the new session screen does not show session details", async ({ page }, testInfo) => {
  const root = "C:/Omnixa/Summary"

  const prompt = "Keep this draft while inspecting project, worktree, and branch controls."

  const inventory = Array.from({ length: 10 }, (_, index) => ({
    directory: `${root}/.worktrees/check-${String(index + 1).padStart(2, "0")}`,
    strategy: "git" as const,
  }))

  const draft = await openDraft(page, {
    name: "Summary",
    project: { vcs: "git" },
    worktrees: () => [{ directory: root }, ...inventory],
  })

  await expect(page.getByRole("button", { name: "Session details", exact: true })).toHaveCount(0)
  await draft.editor.fill(prompt)

  const projectTrigger = page.locator('[data-component="new-session"] [data-action="prompt-project"]')
  await projectTrigger.click()
  const projectMenu = page.locator("#prompt-project-menu")
  const projectSearch = projectMenu.getByPlaceholder("Search projects", { exact: true })

  await expect(projectSearch).toBeFocused()
  await projectSearch.fill("missing-project")
  await expect(projectMenu.getByRole("menuitemradio")).toHaveCount(0)
  await projectMenu.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(projectSearch).toHaveValue("")
  await expect(projectSearch).toBeFocused()
  await expect(projectMenu.getByRole("menuitemradio", { name: /Summary/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("new-session-project-search.png") })
  await projectSearch.press("Escape")
  await expect(projectMenu).toBeHidden()
  await expect(projectTrigger).toBeFocused()
  await draft.editor.click()

  const local = page.getByRole("button", { name: "Local", exact: true })
  await local.click()
  const existing = page.getByRole("menuitem", { name: "Worktree", exact: true })
  await existing.press("ArrowRight")
  const worktreeSearch = page.getByRole("textbox", { name: "Search worktrees", exact: true })
  const worktreeMenu = page.getByRole("menu").filter({ has: worktreeSearch })

  await expect(worktreeSearch).toBeFocused()
  await worktreeSearch.fill("check-07")
  await expect(worktreeMenu.getByRole("menuitem", { name: "check-07", exact: true })).toBeVisible()
  await expect(worktreeMenu.getByRole("menuitem", { name: "check-01", exact: true })).toHaveCount(0)
  await worktreeSearch.clear()
  await expect(worktreeSearch).toHaveValue("")
  await expect(worktreeSearch).toBeFocused()
  await expect(worktreeMenu.getByRole("menuitem", { name: "check-01", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("new-session-worktree-search.png") })
  await worktreeSearch.press("Escape")
  await expect(worktreeSearch).toBeHidden()
  await expect(local).toHaveAttribute("aria-expanded", "false")
  await expect(local).toBeFocused()
  await draft.editor.click()
  await expect(draft.editor).toBeFocused()

  await local.click()
  await page.getByRole("menuitem", { name: "New worktree", exact: true }).click()
  await expect(draft.editor).toBeFocused()
  const branchTrigger = page.getByRole("button", { name: "from main", exact: true })
  await branchTrigger.click()
  const branchSearch = page.getByRole("textbox", { name: "Search branches", exact: true })
  const branchMenu = page.getByRole("menu").filter({ has: branchSearch })

  await expect(branchSearch).toBeFocused()
  await branchSearch.fill("mai")
  await branchMenu.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(branchSearch).toHaveValue("")
  await expect(branchSearch).toBeFocused()
  await expect(branchMenu.getByRole("menuitemradio", { name: "main", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("new-session-branch-search.png") })
  await branchSearch.press("Escape")
  await expect(branchSearch).toBeHidden()
  await expect(branchTrigger).toBeFocused()
  await draft.editor.click()
  await expect(draft.editor).toBeFocused()
  await expect(draft.editor).toHaveText(prompt)
})

test("the dark new session panel exposes no lighter background at its rounded corners", async ({ page }) => {
  await page.setViewportSize({ width: 935, height: 522 })
  await openDraft(page, { name: "PanelCorner", seed: { theme: { id: "oc-2", scheme: "dark" } } })
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const box = await page.locator('[data-component="new-session"]').boundingBox()

  if (!box) throw new Error("New-session panel bounds are unavailable")
  const screenshot = await page.screenshot()

  // Sample the four corner pixels, which lie outside the rounded panel.
  const corners = await page.evaluate(
    async ({ source, points }) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")!
      context.drawImage(image, 0, 0)

      return points.map((point) => Array.from(context.getImageData(point.x, point.y, 1, 1).data))
    },
    {
      source: `data:image/png;base64,${screenshot.toString("base64")}`,
      points: [
        { x: Math.floor(box.x), y: Math.floor(box.y) },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.floor(box.y) },
        { x: Math.floor(box.x), y: Math.ceil(box.y + box.height) - 1 },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.ceil(box.y + box.height) - 1 },
      ],
    },
  )

  expect(corners.filter(([red, green, blue, alpha]) => red > 8 || green > 8 || blue > 8 || alpha !== 255)).toEqual([])
})

for (const row of [
  { mode: "chat", label: "Chat" },
  { mode: "coding", label: "Coding" },
  { mode: "work", label: "Work" },
  { mode: "assistant", label: "Assistant" },
] as const) {
  test(`titlebar New preserves ${row.mode} from a session and its draft through submission`, async ({ page }) => {
    const creates: Parameters<NonNullable<WorkspaceInput["onSessionCreate"]>>[0][] = []
    await openSession(page, {
      name: "SourceMode",
      provider: provider({ id: "source-model", name: "Source Model" }),
      sessions: [
        {
          id: "ses_source_mode",
          title: "Source mode session",
          mode: row.mode,
          agent: "plan",
          model: { id: "source-model", providerID: "omnixa" },
        },
      ],
      onSessionCreate: (body) => {
        creates.push(body)
      },
    })
    await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Source Model$/)
    await page.getByRole("button", { name: "New session", exact: true }).click()
    await expect(editor(page)).toBeEditable()
    await expect(mode(page)).toHaveText(row.label)
    await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Source Model$/)
    const first = new URL(page.url()).searchParams.get("draftId")
    expect(first).toBeTruthy()
    await page.getByRole("button", { name: "New session", exact: true }).click()
    await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).not.toBe(first)
    await expect(editor(page)).toBeEditable()
    await expect(mode(page)).toHaveText(row.label)
    await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Source Model$/)
    expect(creates).toEqual([])
    await page.locator('[data-component="composer"]').getByRole("button", { name: "Choose agent", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "build", exact: true }).click()
    await editor(page).fill(`Submit inherited ${row.mode} mode.`)
    await submit(page).click()
    await expect
      .poll(() => creates)
      .toEqual([
        expect.objectContaining({
          id: expect.any(String),
          mode: row.mode,
          agent: "build",
          model: expect.objectContaining({ id: "source-model", providerID: "omnixa" }),
        }),
      ])
    const created = creates[0]

    if (!created) throw new Error("Missing inherited mode creation")
    expect(created.executorPreference).toBeUndefined()
    await expectPath(page, sessionHref(String(created.id)))
    await expect(page.locator('[data-slot="user-message-text"]')).toHaveText(`Submit inherited ${row.mode} mode.`)
  })

  test(`persists ${row.mode} on the draft and creates it only on explicit submit`, async ({ page }) => {
    const creates: Parameters<NonNullable<WorkspaceInput["onSessionCreate"]>>[0][] = []
    const apiWrites = recordApiMutations(page)

    const draft = await openDraft(page, {
      name: "ModePicker",
      provider: provider({ id: "mode-model", name: "Mode Model" }),
      sessions: [{ id: otherID, title: "Other mode session" }],
      onSessionCreate: (body) => {
        creates.push(body)
      },
    })

    await page.locator('[data-component="composer"]').getByRole("button", { name: "Choose agent", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "build", exact: true }).click()

    await expect(mode(page)).toHaveText("Coding")
    await mode(page).press("Enter")
    const choices = page.getByRole("listbox")
    await expect(choices.getByRole("option")).toHaveText(["Chat", "Coding", "Work", "Assistant"])
    await choices.getByRole("option", { name: row.label, exact: true }).click()
    await expect(mode(page)).toHaveText(row.label)
    await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Mode Model$/)
    expect(apiWrites.writes).toEqual([])
    apiWrites.inventoryRefreshes.forEach((request) =>
      expect(request.postData()).toBe(JSON.stringify({ projectID: draft.projectID })),
    )

    await tabLink(page, otherID).click()
    await expectPath(page, sessionHref(otherID))
    await page.locator(`[data-titlebar-tab-link][href="${draftHref(draft.draftID)}"]`).click()
    await expectPath(page, draftHref(draft.draftID))
    await expect(mode(page)).toHaveText(row.label)
    await page.reload()
    await expect(editor(page)).toBeEditable()
    await expect(mode(page)).toHaveText(row.label)
    await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Mode Model$/)
    expect(apiWrites.writes).toEqual([])
    apiWrites.inventoryRefreshes.forEach((request) =>
      expect(request.postData()).toBe(JSON.stringify({ projectID: draft.projectID })),
    )

    await editor(page).fill(`Create a ${row.mode} session.`)
    await submit(page).click()
    await expect
      .poll(() => creates)
      .toEqual([
        expect.objectContaining({
          id: expect.any(String),
          mode: row.mode,
          agent: "build",
          model: expect.objectContaining({ id: "mode-model", providerID: "omnixa" }),
        }),
      ])
    const createdRequest = creates[0]

    if (!createdRequest) throw new Error("Session create request is unavailable")
    expect(createdRequest.control).toBeUndefined()
    expect(createdRequest.executorPreference).toBeUndefined()
    await expectPath(page, sessionHref(String(createdRequest.id)))
    await expect(page.locator('[data-slot="user-message-text"]')).toHaveText(`Create a ${row.mode} session.`)

    const readback: unknown = await page.evaluate(
      async ({ server, sessionID }) => {
        const response = await fetch(server + "/api/session/" + sessionID)

        if (response.status !== 200) throw new Error("Created Session canonical GET failed")

        return response.json()
      },
      { server: draft.server, sessionID: String(createdRequest.id) },
    )

    if (!Schema.is(Schema.JsonObject)(readback) || !Schema.is(Schema.JsonObject)(readback.data))
      throw new Error("Created Session canonical Info is unavailable")
    expect(readback.data).toMatchObject({
      id: createdRequest.id,
      agent: "build",
      mode: row.mode,
      model: { id: "mode-model", providerID: "omnixa" },
    })
    expect(readback.data.controller).toBeUndefined()
    expect(readback.data.executorPreference).toBeUndefined()
    await page.reload()
    await expect(editor(page)).toBeEditable()
    await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Mode Model$/)
  })
}

for (const row of [
  { name: "custom", mode: "custom" },
  { name: "unknown", mode: "future-mode" },
  { name: "null", mode: null },
  { name: "object", mode: { id: "chat" } },
]) {
  test(`blocks a persisted ${row.name} mode before preparing a worktree and allows explicit recovery`, async ({
    page,
  }) => {
    const apiWrites = recordApiMutations(page)

    const mock = await openWorktreeDraft(page, {
      ...pendingDraft,
      seed: {
        storage: {
          "omnixa.window.browser.dat:tabs": [
            { type: "draft", draftID, directory, server: SERVER, mode: row.mode },
            { type: "session", server: SERVER, sessionId: otherID },
          ],
        },
      },
    })

    const alert = page.locator('[data-component="new-session"]').getByRole("alert")
    await expect(mode(page)).toHaveText("Choose a session mode")
    await expect(alert).toHaveText("This draft uses an unsupported session mode. Select a mode to continue.")
    await editor(page).fill(text)
    await submit(page).click()
    await expect(page.getByText("Failed to create session", { exact: true })).toBeVisible()
    await expectPath(page, draftHref(draftID))
    await expect(editor(page)).toHaveText(text)
    expect(apiWrites.writes).toEqual([])
    apiWrites.inventoryRefreshes.forEach((request) =>
      expect(request.postData()).toBe(JSON.stringify({ projectID: mock.projectID })),
    )
    expect(mock.calls).toEqual([])

    await mode(page).click()
    await page.getByRole("option", { name: "Work", exact: true }).click()
    await expect(mode(page)).toHaveText("Work")
    await expect(alert).toHaveCount(0)
    await page.locator('[data-component="composer"]').getByRole("button", { name: "Choose agent", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "build", exact: true }).click()
    expect(apiWrites.writes).toEqual([])
    apiWrites.inventoryRefreshes.forEach((request) =>
      expect(request.postData()).toBe(JSON.stringify({ projectID: mock.projectID })),
    )
    const pending = await submitPending(page, mock)
    mock.worktree.resolve({ status: 200, json: { directory: workspace } })
    await expect
      .poll(() => mock.creates)
      .toEqual([expect.objectContaining({ id: pending.sessionID, mode: "work", agent: "build" })])
    const createdRequest = mock.creates[0]

    if (!createdRequest) throw new Error("Session create request is unavailable")
    expect(createdRequest.control).toBeUndefined()
    expect(createdRequest.executorPreference).toBeUndefined()
    await expect
      .poll(() => mock.prompts)
      .toEqual([{ sessionID: pending.sessionID, body: expect.objectContaining({ text }) }])
    await expectPath(page, sessionHref(pending.sessionID))

    const readback: unknown = await page.evaluate(
      async ({ server, sessionID }) => {
        const response = await fetch(server + "/api/session/" + sessionID)

        if (response.status !== 200) throw new Error("Recovered Session canonical GET failed")

        return response.json()
      },
      { server: mock.server, sessionID: pending.sessionID },
    )

    if (!Schema.is(Schema.JsonObject)(readback) || !Schema.is(Schema.JsonObject)(readback.data))
      throw new Error("Recovered Session canonical Info is unavailable")
    expect(readback.data).toMatchObject({ id: pending.sessionID, mode: "work", agent: "build" })
    expect(readback.data.controller).toBeUndefined()
    expect(readback.data.executorPreference).toBeUndefined()
  })
}

test("captures the submitted mode before MCP preparation while the draft selector remains editable", async ({
  page,
}) => {
  const directory = "C:/Omnixa/ModeCapture"
  const draftID = "draft_mode_capture"
  const creates: Parameters<NonNullable<WorkspaceInput["onSessionCreate"]>>[0][] = []
  const apiWrites = recordApiMutations(page)

  const draft = await openDraft(page, {
    name: "ModeCapture",
    draftID,
    directory,
    provider: provider({ id: "capture-model", name: "Capture Model" }),
    mcp: [{ name: "mode-mcp", status: { status: "connected" } }],
    seed: {
      storage: {
        "omnixa.window.browser.dat:tabs": [
          {
            type: "draft",
            draftID,
            directory,
            server: SERVER,
            mode: "work",
            mcp: { target: JSON.stringify([SERVER, directory, "main"]), states: { "mode-mcp": true } },
          },
        ],
      },
    },
    onSessionCreate: (body) => {
      creates.push(body)
    },
  })

  await page.locator('[data-component="composer"]').getByRole("button", { name: "Choose agent", exact: true }).click()
  await page.getByRole("menuitemradio", { name: "build", exact: true }).click()

  await expect(mode(page)).toHaveText("Work")
  const prepare = await holdRoute(page, (url) => url.pathname === "/api/mcp", { method: "GET" })
  await editor(page).fill("Keep this submitted mode.")
  await submit(page).click()
  await prepare.arrived
  await expect(mode(page)).toHaveText("Work")
  await mode(page).click()
  await page.getByRole("option", { name: "Chat", exact: true }).click()
  await expect(mode(page)).toHaveText("Chat")
  expect(creates).toEqual([])
  expect(apiWrites.writes).toEqual([])
  apiWrites.inventoryRefreshes.forEach((request) =>
    expect(request.postData()).toBe(JSON.stringify({ projectID: draft.projectID })),
  )
  prepare.release()
  await expect
    .poll(() => creates)
    .toEqual([expect.objectContaining({ id: expect.any(String), mode: "work", agent: "build" })])
  const createdRequest = creates[0]

  if (!createdRequest) throw new Error("Session create request is unavailable")
  expect(createdRequest.control).toBeUndefined()
  expect(createdRequest.executorPreference).toBeUndefined()
  await expectPath(page, sessionHref(String(createdRequest.id)))
  await expect(page.locator('[data-slot="user-message-text"]')).toHaveText("Keep this submitted mode.")

  const readback: unknown = await page.evaluate(
    async ({ server, sessionID }) => {
      const response = await fetch(server + "/api/session/" + sessionID)

      if (response.status !== 200) throw new Error("Captured Session canonical GET failed")

      return response.json()
    },
    { server: draft.server, sessionID: String(createdRequest.id) },
  )

  if (!Schema.is(Schema.JsonObject)(readback) || !Schema.is(Schema.JsonObject)(readback.data))
    throw new Error("Captured Session canonical Info is unavailable")
  expect(readback.data).toMatchObject({ id: createdRequest.id, mode: "work", agent: "build" })
  expect(readback.data.controller).toBeUndefined()
  expect(readback.data.executorPreference).toBeUndefined()
})

test("a new Session stops an old model selection response after SSH sign-in and admits the current owner's explicit retry", async ({
  page,
}) => {
  const server = "ssh:box"
  const directory = "/home/box/new-session-owner"
  const firstText = "Submit this only for the original SSH owner."
  const nextText = "The current SSH owner can submit this."
  const creates: Parameters<NonNullable<WorkspaceInput["onSessionCreate"]>>[0][] = []
  const prompts: Parameters<NonNullable<WorkspaceInput["onPrompt"]>>[0][] = []

  const sessions = [
    session({
      id: "ses_new_session_owner_source",
      directory,
      title: "SSH owner source",
      agent: "build",
      model: { id: "owner-model", providerID: "omnixa" },
    }),
  ]

  const config = {
    directory,
    project: project({ id: "proj_new_session_owner", directory }),
    provider: provider({ id: "owner-model", name: "Owner Model" }),
    sessions,
    pageMessages: () => ({ items: [] }),
  }

  // Accept both fixture credentials so this case isolates submission ownership from authentication failures.
  await mockServers(page, {
    [SERVER]: { ...config, sessions: [] },
    [REMOTE_SERVER]: {
      ...config,
      createdSessionTitle: "SSH owner submission",
      onSessionCreate: (body) => {
        creates.push(body)
      },
      onPrompt: (input) => {
        prompts.push(input)
      },
    },
  })
  await page.goto(
    "/e2e/utils/settings-wsl.html?" +
      new URLSearchParams({
        server: SERVER,
        mode: "ready",
        ssh: REMOTE_SERVER,
        path: sessionHref(sessions[0]!.id, server),
      }),
  )
  await expectSessionTitle(page, sessions[0]!.title)
  await page.getByRole("button", { name: "New session", exact: true }).click()
  await expect(editor(page)).toBeEditable()
  const activeLink = page.locator('[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-link]')
  await expect(activeLink).toHaveAttribute("href", /^\/new-session\?draftId=/)
  const draft = await activeLink.getAttribute("href")
  await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Owner Model$/)

  const modelChange = await holdRoute(
    page,
    (url) => url.origin === REMOTE_SERVER && /^\/api\/session\/[^/]+\/model$/.test(url.pathname),
    { method: "POST" },
  )

  try {
    await editor(page).fill(firstText)
    await editor(page).press("Enter")
    const attempted = await modelChange.arrived
    await expect
      .poll(() => creates)
      .toEqual([
        expect.objectContaining({
          id: expect.any(String),
          location: { directory },
          agent: "build",
          model: expect.objectContaining({ id: "owner-model", providerID: "omnixa" }),
        }),
      ])
    const createdRequest = creates[0]

    if (!createdRequest) throw new Error("Original owner create request is unavailable")
    expect(createdRequest.control).toBeUndefined()
    expect(createdRequest.executorPreference).toBeUndefined()
    const sessionID = String(createdRequest.id)
    expect(new URL(attempted.url()).pathname).toBe("/api/session/" + sessionID + "/model")
    expect(await attempted.headerValue("authorization")).toBe("Basic " + btoa("omnixa:ssh-1"))
    await expectSessionTitle(page, "SSH owner submission")
    await expect(activeLink).toHaveAttribute("href", sessionHref(sessionID, server))

    const readback: unknown = await page.evaluate(
      async ({ server, sessionID }) => {
        const response = await fetch(server + "/api/session/" + sessionID)

        if (response.status !== 200) throw new Error("Original owner Session canonical GET failed")

        return response.json()
      },
      { server: REMOTE_SERVER, sessionID },
    )

    if (!Schema.is(Schema.JsonObject)(readback) || !Schema.is(Schema.JsonObject)(readback.data))
      throw new Error("Original owner Session canonical Info is unavailable")
    expect(readback.data).toMatchObject({
      id: sessionID,
      agent: "build",
      model: { id: "owner-model", providerID: "omnixa" },
      location: { directory },
    })
    expect(readback.data.controller).toBeUndefined()
    expect(readback.data.executorPreference).toBeUndefined()
    await expect(page.locator('[data-titlebar-tab-link][href="' + draft + '"]')).toHaveCount(0)
    await expect(editor(page)).toHaveText("")
    await editor(page).fill(nextText)

    await page.getByRole("button", { name: "Require SSH sign-in", exact: true }).click()
    await expect(page.getByLabel("SSH connects")).toHaveText("1")
    await expect(editor(page)).toBeEditable()
    await expect(editor(page)).toHaveText(nextText)
    await expect(page.locator('[data-action="composer-model"]')).toHaveText(/^Owner Model$/)

    const completed = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url() === attempted.url(),
    )

    modelChange.release()
    const acknowledgement = await completed
    expect(acknowledgement.status()).toBe(204)
    await expect(page.getByText("Failed to send prompt", { exact: true })).toHaveCount(0)
    await expect(editor(page)).toHaveText(nextText)
    await expect(submit(page)).toBeEnabled()
    expect(prompts).toEqual([])
    expect(creates).toHaveLength(1)
    await expect(activeLink).toHaveAttribute("href", sessionHref(sessionID, server))

    const retried = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).origin === REMOTE_SERVER &&
        new URL(request.url()).pathname === "/api/session/" + sessionID + "/prompt",
    )

    await editor(page).press("Enter")
    expect(await (await retried).headerValue("authorization")).toBe("Basic " + btoa("omnixa:ssh-2"))
    await expect
      .poll(() => prompts)
      .toEqual([
        {
          sessionID,
          body: expect.objectContaining({
            text: nextText,
            metadata: expect.objectContaining({
              agent: "build",
              model: expect.objectContaining({ modelID: "owner-model", providerID: "omnixa" }),
            }),
          }),
        },
      ])
    const currentCreate = creates[0]

    if (!currentCreate) throw new Error("Current owner create request is unavailable")
    expect(currentCreate.control).toBeUndefined()
    expect(currentCreate.executorPreference).toBeUndefined()

    const currentReadback: unknown = await page.evaluate(
      async ({ server, sessionID }) => {
        const response = await fetch(server + "/api/session/" + sessionID)

        if (response.status !== 200) throw new Error("Current owner Session canonical GET failed")

        return response.json()
      },
      { server: REMOTE_SERVER, sessionID },
    )

    if (!Schema.is(Schema.JsonObject)(currentReadback) || !Schema.is(Schema.JsonObject)(currentReadback.data))
      throw new Error("Current owner Session canonical Info is unavailable")
    expect(currentReadback.data).toMatchObject({
      id: sessionID,
      agent: "build",
      model: { id: "owner-model", providerID: "omnixa" },
      location: { directory },
    })
    expect(currentReadback.data.controller).toBeUndefined()
    expect(currentReadback.data.executorPreference).toBeUndefined()
    const prompt = prompts[0]

    if (!prompt) throw new Error("Current owner prompt is unavailable")
    const metadata = prompt.body.metadata

    if (!Schema.is(Schema.JsonObject)(metadata)) throw new Error("Current owner prompt metadata is unavailable")
    expect(metadata.executorPreference).toBeUndefined()
    await expect(page.locator('[data-slot="user-message-text"]')).toHaveText(nextText)
    await expect(editor(page)).toHaveText("")
    await expect(activeLink).toHaveAttribute("href", sessionHref(sessionID, server))
    expect(creates).toHaveLength(1)
  } finally {
    modelChange.release()
  }
})

test("a pending worktree session shows immediately, keeps its draft, and hands off to the created session", async ({
  page,
}) => {
  const mock = await openWorktreeDraft(page, { ...pendingDraft, createdSessionTitle: "" })
  const label = page.locator('[data-titlebar-tab-slot][data-active="true"] [data-titlebar-tab-title]')
  await expect(label).toHaveText("Session")
  const pending = await submitPending(page, mock)
  const spinner = tabLink(page, pending.sessionID).locator('[data-component="session-progress-indicator-v2"]')
  await expect(spinner).toBeVisible()
  await expect(label).toHaveText("Session")

  await draftFollowUp(page)
  await expect(submit(page)).toBeDisabled()
  await editor(page).press("Enter")
  await editor(page).press("ControlOrMeta+Enter")
  await page.locator('[data-component="composer"]').dispatchEvent("submit")
  await expect(editor(page)).toHaveText(followUp)
  expect(mock.worktreeRequests.map((request) => request.body)).toEqual([expect.objectContaining({ from: directory })])

  await tabLink(page, otherID).click()
  await expectPath(page, sessionHref(otherID))
  await expect(pending.shimmer).toBeHidden()
  await expect(spinner).toBeVisible()
  await tabLink(page, pending.sessionID).click()
  await expect(page).toHaveURL(pending.url)
  await expect(pending.message).toHaveAttribute("data-timeline-part-id", `${pending.messageID}:text:0`)
  await expect(pending.shimmer).toHaveAttribute("data-active", "true")
  await expect(editor(page)).toHaveText(followUp)

  await tabLink(page, otherID).click()
  await expectPath(page, sessionHref(otherID))
  await editor(page).fill("Keep focus in this other session")
  await expect(editor(page)).toBeFocused()
  expect(mock.calls).toEqual(["worktree"])
  mock.worktree.resolve({ status: 200, json: { directory: workspace } })
  await expect
    .poll(() => mock.prompts)
    .toEqual([{ sessionID: pending.sessionID, body: expect.objectContaining({ id: pending.messageID, text }) }])
  expect(mock.creates).toEqual([expect.objectContaining({ id: pending.sessionID, location: { directory: workspace } })])
  expect(mock.calls).toEqual(["worktree", "session", "prompt"])
  await expectPath(page, sessionHref(otherID))
  await expect(editor(page)).toHaveText("Keep focus in this other session")
  await expect(editor(page)).toBeFocused()

  await tabLink(page, pending.sessionID).click()
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(editor(page)).toHaveText(followUp)
  await expect(label).toHaveText("Session")
  await submit(page).click()
  await expect
    .poll(() => mock.prompts)
    .toEqual([
      { sessionID: pending.sessionID, body: expect.objectContaining({ id: pending.messageID, text }) },
      { sessionID: pending.sessionID, body: expect.objectContaining({ text: followUp }) },
    ])

  await mock.push([renamed(pending.sessionID)])
  await expect(label).toHaveText("Generated session title")
})

test("a pending worktree session keeps Session as its mobile title until the generated title arrives", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const mock = await openWorktreeDraft(page, { ...pendingDraft, createdSessionTitle: "" })
  const label = page.locator('[data-slot="mobile-tab-title"]')
  await expect(label).toHaveText("Session")
  const pending = await submitPending(page, mock)
  await expect(
    page.locator('[data-slot="mobile-tabs-trigger"] [data-component="session-progress-indicator-v2"]'),
  ).toBeVisible()
  mock.worktree.resolve({ status: 200, json: { directory: workspace } })
  await expect(pending.shimmer).toHaveCount(0)
  await expect(submit(page)).toBeEnabled()
  await expect(label).toHaveText("Session")
  await mock.push([renamed(pending.sessionID)])
  await expect(label).toHaveText("Generated session title")
})

test("the title and message stay stable through worktree creation", async ({ page }) => {
  const mock = await openWorktreeDraft(page, pendingDraft)
  const pending = await submitPending(page, mock)
  await draftFollowUp(page)
  await editor(page).press("ControlOrMeta+Home")
  const title = page.locator("[data-session-title]").getByRole("heading", { level: 1 })
  const before = await title.boundingBox()
  const messageBefore = await pending.message.boundingBox()

  // Observe painted frames during the handoff, without using frame counts to wait for readiness.
  const observation = await page.evaluateHandle(() => {
    const frames: { title: string | null; message: boolean; spinner: boolean; draft: string | null }[] = []
    let frame = 0

    const visible = (element: Element | null) =>
      !!element?.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })

    const sample = () => {
      const title = document.querySelector<HTMLElement>("[data-session-title] h1")
      const editor = document.querySelector('[data-component="composer-editor"]')
      frames.push({
        title: visible(title) ? title!.textContent : null,
        message: visible(document.querySelector('[data-component="user-message"]')),
        spinner: visible(
          document.querySelector(
            '[data-titlebar-tab-slot][data-active="true"] [data-component="session-progress-indicator-v2"]',
          ),
        ),
        draft: visible(editor) ? editor!.textContent : null,
      })
      frame = requestAnimationFrame(sample)
    }

    sample()

    return {
      // A frame painted after the synchronous first sample that already shows the created session's title.
      handedOff: () => frames.slice(1).some((frame) => frame.title === "Created workspace session"),
      stop: () => {
        cancelAnimationFrame(frame)

        return frames
      },
    }
  })

  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expect(title).toHaveText("Created workspace session")
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(editor(page)).toHaveText(followUp)
  await expect(editor(page)).toBeFocused()
  // The DOM can reach the final state before the sampler's next frame; wait until a sample has observed it.
  await expect.poll(() => observation.evaluate((observation) => observation.handedOff())).toBe(true)
  const frames = await observation.evaluate((observation) => observation.stop())
  await observation.dispose()
  // At least one painted frame after the handoff, beyond the synchronous first sample.
  expect(frames.slice(1).some((frame) => frame.title === "Created workspace session")).toBe(true)
  expect(
    frames.filter(
      (frame) =>
        !frame.message ||
        !frame.spinner ||
        frame.draft !== followUp ||
        !["Session", "Created workspace session"].includes(frame.title ?? ""),
    ),
  ).toEqual([])
  const after = await title.boundingBox()
  expect(after?.y).toBe(before?.y)
  expect(after?.height).toBe(before?.height)
  expect(await pending.message.boundingBox()).toEqual(messageBefore)
  await editor(page).pressSequentially("Also: ")
  await expect(editor(page)).toHaveText(`Also: ${followUp}`)
  await expect.poll(() => mock.calls).toEqual(["worktree", "session", "prompt"])
})

for (const row of [
  { failure: "worktree", followUp: true, calls: ["worktree"] },
  { failure: "session", followUp: true, calls: ["worktree", "session"] },
  { failure: "prompt", followUp: true, calls: ["worktree", "session", "prompt", "prompt"] },
  { failure: "worktree", followUp: false, calls: ["worktree"] },
]) {
  test(`a ${row.failure} failure restores the draft (follow-up: ${row.followUp})`, async ({ page }) => {
    const mock = await openWorktreeDraft(page, {
      ...pendingDraft,
      onSessionCreate: row.failure === "session" ? failFirstCreate : undefined,
    })

    const pending = await submitPending(page, mock)

    if (row.followUp) await draftFollowUp(page)

    if (row.failure === "prompt")
      await page.route(`**/api/session/${pending.sessionID}/prompt`, (route) =>
        route.fulfill({ status: 500, json: { message: "Prompt admission failed" }, headers }),
      )

    mock.worktree.resolve(
      row.failure === "worktree"
        ? { status: 500, json: { message: "Worktree creation failed" } }
        : { status: 200, json: { directory: workspace } },
    )

    if (row.failure !== "prompt") await expectPath(page, draftHref(draftID))
    await expect(editor(page)).toHaveText(row.followUp ? `${text}\n\n${followUp}` : text)
    await expect(submit(page)).toBeEnabled()
    await expect(pending.shimmer).toHaveCount(0)
    await expect.poll(() => mock.calls).toEqual(row.calls)
    expect(mock.prompts).toEqual([])

    if (row.followUp) return
    await expect(page.getByText("Failed to create worktree", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "New worktree", exact: true })).toBeVisible()
    await expect(pending.message).toHaveCount(0)
    await expect(tabLink(page, pending.sessionID)).toHaveCount(0)
    expect(mock.creates).toEqual([])
  })
}

test("retains the draft and reuses the created workspace after session creation fails", async ({ page }) => {
  const mock = await openWorktreeDraft(page, { ...pendingDraft, onSessionCreate: failFirstCreate })
  await mode(page).click()
  await page.getByRole("option", { name: "Work", exact: true }).click()
  await expect(mode(page)).toHaveText("Work")
  const pending = await submitPending(page, mock)

  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expectPath(page, draftHref(draftID))
  await expect(page.getByText("Failed to create session", { exact: true })).toBeVisible()
  await expect(editor(page)).toHaveText(text)
  await expect(submit(page)).toBeEnabled()
  await expect(page.getByRole("button", { name: "pending-workspace", exact: true })).toBeVisible()
  await expect(mode(page)).toHaveText("Work")
  await expect(pending.shimmer).toHaveCount(0)
  await expect(pending.message).toHaveCount(0)
  expect(mock.creates).toEqual([
    expect.objectContaining({ id: pending.sessionID, mode: "work", location: { directory: workspace } }),
  ])
  expect(mock.calls).toEqual(["worktree", "session"])
  expect(mock.prompts).toEqual([])

  await mode(page).click()
  await page.getByRole("option", { name: "Assistant", exact: true }).click()
  await expect(mode(page)).toHaveText("Assistant")
  await submit(page).click()

  await expect.poll(() => mock.prompts.length).toBe(1)
  expect(mock.creates).toHaveLength(2)
  expect(mock.creates[1]).toMatchObject({ mode: "assistant", location: { directory: workspace } })
  expect(mock.prompts[0]).toMatchObject({ sessionID: mock.creates[1]!.id, body: { text } })
  expect(mock.calls).toEqual(["worktree", "session", "session", "prompt"])
  await expectPath(page, sessionHref(String(mock.creates[1]!.id)))
  await expect(page.locator('[data-component="user-message"] [data-slot="user-message-text"]')).toHaveText(text)
})

test("restores the draft after closing and revisiting a pending session that fails", async ({ page }) => {
  const mock = await openWorktreeDraft(page, pendingDraft)
  const pending = await submitPending(page, mock)
  await draftFollowUp(page)
  const tab = tabLink(page, pending.sessionID)

  await page.locator("[data-titlebar-tab-slot]").filter({ has: tab }).locator('[data-slot="tab-close"] button').click()

  await expectPath(page, sessionHref(otherID))
  await expect(editor(page)).toBeEditable()
  await expect(tab).toHaveCount(0)
  await expect(pending.shimmer).toHaveCount(0)

  await page.goBack()

  await expect(page).toHaveURL(pending.url)
  await expect(tab).toBeVisible()
  await expect(pending.message.locator('[data-slot="user-message-text"]')).toHaveText(text)
  await expect(pending.message).toHaveAttribute("data-timeline-part-id", `${pending.messageID}:text:0`)
  await expect(pending.shimmer).toContainText("Creating worktree")
  await expect(pending.shimmer).toHaveAttribute("data-active", "true")
  await expect(editor(page)).toHaveText(followUp)
  expect(mock.calls).toEqual(["worktree"])

  mock.worktree.resolve({ status: 500, json: { message: "Worktree creation failed after revisiting the session" } })

  await expectPath(page, draftHref(draftID))
  await expect(page.getByText("Failed to create worktree", { exact: true })).toBeVisible()
  await expect(editor(page)).toHaveText(`${text}\n\n${followUp}`)
  await expect(submit(page)).toBeEnabled()
  await expect(page.getByRole("button", { name: "New worktree", exact: true })).toBeVisible()
  await expect(page.locator(`[data-titlebar-tab-link][href="${draftHref(draftID)}"]`)).toHaveCount(1)
  await expect(tab).toHaveCount(0)
  await expect(pending.message).toHaveCount(0)
  expect(mock.calls).toEqual(["worktree"])
  expect(mock.creates).toEqual([])
  expect(mock.prompts).toEqual([])
})

test("executes a selected slash command after creating its worktree", async ({ page }) => {
  const commands: { sessionID: string; body: unknown }[] = []

  const mock = await openWorktreeDraft(page, {
    ...pendingDraft,
    commands: [{ name: "review", description: "Review changes" }],
    onCommand: (input) => commands.push(input),
  })

  const expanded =
    "Review the latest commit for correctness and regressions. Check the relevant tests and report actionable findings."

  await editor(page).fill("/review")
  const suggestion = page.getByRole("button", { name: "/review Review changes", exact: true })
  await suggestion.click()
  await expect(editor(page)).toHaveText("/review")
  const pending = await submitPending(page, mock, "/review latest commit")
  await draftFollowUp(page)

  mock.worktree.resolve({ status: 200, json: { directory: workspace } })

  await expect
    .poll(() => commands)
    .toEqual([
      {
        sessionID: pending.sessionID,
        body: { name: "review", text: "latest commit", files: [], agents: [], skills: [], delivery: "steer" },
      },
    ])
  // The server owns command expansion; the client receives the expanded inbox item.
  await mock.push([
    {
      id: "evt_workspace_review",
      type: "session.inbox.enqueued",
      created: Date.now(),
      durable: { aggregateID: pending.sessionID, seq: 1, version: 1 },
      data: {
        sessionID: pending.sessionID,
        inboxID: "msg_workspace_review",
        item: { type: "user", payload: { text: expanded }, delivery: "steer" },
      },
    } satisfies OmnixaEvent,
  ])
  await expect(pending.shimmer).toHaveCount(0)
  await expect(page.locator('[data-slot="user-message-text"]')).toHaveText(expanded)
  await expect(editor(page)).toHaveText(followUp)
  await expect(submit(page)).toBeEnabled()
  expect(mock.creates).toEqual([expect.objectContaining({ id: pending.sessionID, location: { directory: workspace } })])
  expect(mock.prompts).toEqual([])
})

const accentRoot = "C:/Omnixa/WorkspaceAccent"

const accentWorkspace = `${accentRoot}/.worktrees/feature`

for (const row of [
  { name: "a managed worktree", directory: accentWorkspace, accent: true },
  {
    name: "the main root written with Windows case and separators",
    directory: "c:\\OMNIXA\\workspaceaccent\\",
    accent: false,
  },
]) {
  test(`workspace accent colors the user message only for ${row.name}`, async ({ page }) => {
    const inventory: WorktreeDirectory[] = [{ directory: accentRoot }, { directory: accentWorkspace, strategy: "git" }]

    const listed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/worktree" &&
        new URL(response.url()).searchParams.get("projectID") === "proj_workspaceaccent" &&
        response.request().method() === "GET",
    )

    const view = await openSession(page, {
      name: "WorkspaceAccent",
      // The mock answers every location with the session directory while the project stays rooted at main.
      directory: row.directory,
      project: { worktree: accentRoot, canonical: accentRoot },
      provider: provider({ id: "accent-model", name: "Accent Model" }),
      sessions: [
        {
          id: "ses_workspace_accent",
          title: "Workspace accent",
          model: { id: "accent-model", providerID: "omnixa" },
        },
      ],
      pageMessages: () => ({
        items: [
          { id: "msg_workspace_accent", type: "user", text: "Check this fixture workspace.", time: { created: 1 } },
        ],
      }),
      worktrees: () => inventory,
      seed: { theme: { id: "oc-2", scheme: "light" } },
    })

    expect((await listed).ok()).toBe(true)
    const composer = page.locator('[data-component="composer"]')
    const send = composer.getByRole("button", { name: "Send", exact: true })
    await expect(composer.locator('[data-action="composer-model"]')).toHaveText("Accent Model")
    await view.editor.fill("Inspect this fixture workspace.")
    await expect(send).toBeEnabled()
    await expectBackground(send, "icon-button-contrast")
    await send.hover()
    await expectBackground(send, "icon-button-contrast")
    await composer.locator('[data-action="composer-model"]').press("Tab")
    await expect(send).toBeFocused()
    await expectBackground(send, "icon-button-contrast")
    const message = page.locator('[data-slot="user-message-text"]')
    await expect(message).toHaveText("Check this fixture workspace.")
    await expectToken(message, "background-color", row.accent ? "--v2-background-bg-accent" : "--v2-blue-100")
    await expectToken(message, "color", row.accent ? "--v2-text-text-contrast" : "--v2-blue-700")

    if (!row.accent) return

    const url = page.url()

    const refreshed = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/worktree" && response.request().method() === "GET",
    )

    await view.push([
      {
        id: "evt_accent_inventory",
        created: 1700000001000,
        type: "worktree.updated",
        data: { projectID: "proj_workspaceaccent" },
      },
    ] satisfies OmnixaEvent[])
    expect((await refreshed).ok()).toBe(true)
    await expect(page).toHaveURL(url)
    await expect(view.editor).toHaveText("Inspect this fixture workspace.")
    await expectBackground(send, "icon-button-contrast")
    await view.push([
      {
        id: "evt_accent_running",
        created: 1700000002000,
        type: "session.execution.started",
        durable: { aggregateID: "ses_workspace_accent", seq: 1, version: 1 },
        data: { sessionID: "ses_workspace_accent" },
      },
    ] satisfies OmnixaEvent[])
    await view.editor.fill("")
    const stop = composer.getByRole("button", { name: "Stop", exact: true })
    await expect(stop).toBeEnabled()
    await expectBackground(stop, "icon-button-contrast")
  })
}

// Inventory refresh is an existing Project/Location effect; inspect it separately from submission writes.
function recordApiMutations(page: Page) {
  const inventoryRefreshes: Request[] = []
  const writes: string[] = []

  page.on("request", (request) => {
    const path = new URL(request.url()).pathname

    if (!path.startsWith("/api/") || ["GET", "HEAD", "OPTIONS"].includes(request.method())) return

    if (request.method() === "POST" && path === "/api/worktree/refresh") {
      inventoryRefreshes.push(request)

      return
    }

    writes.push(`${request.method()} ${path}`)
  })

  return { inventoryRefreshes, writes }
}

function renamed(sessionID: string) {
  return {
    id: "evt_generated_title",
    type: "session.renamed",
    created: Date.now(),
    location: { directory: workspace },
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    data: { sessionID, title: "Generated session title" },
  } satisfies OmnixaEvent
}

async function draftFollowUp(page: Page) {
  await editor(page).pressSequentially("!")
  await expect(editor(page)).toHaveText("!")
  await expect(editor(page)).toHaveAttribute("dir", "auto")
  await editor(page).fill("")
  await page.evaluate((text) => navigator.clipboard.writeText(text), followUp)
  await editor(page).press("ControlOrMeta+V")
  await expect(editor(page)).toHaveText(followUp)
}

async function submitPending(page: Page, mock: Awaited<ReturnType<typeof openWorktreeDraft>>, prompt = text) {
  await editor(page).fill(prompt)
  await expect(submit(page)).toBeEnabled()
  await submit(page).click()
  const sessionPath = sessionHref("")
  await expect(page).toHaveURL((url) => url.pathname.startsWith(sessionPath) && /\/ses_[^/]+$/.test(url.pathname))
  const url = page.url()
  const sessionID = new URL(url).pathname.slice(sessionPath.length)
  const preparing = page.locator('[data-component="session-preparing"]')
  const message = page.locator('[data-component="user-message"]')
  const shimmer = preparing.getByRole("status").locator('[data-component="text-shimmer"]')
  await expect(preparing.getByRole("heading", { level: 1 })).toHaveText("Session")
  await expect(editor(page)).toBeEditable()
  await expect(submit(page)).toBeDisabled()
  await expect(preparing.locator('[data-component="user-message"]')).toHaveCount(1)
  await expect(message.locator('[data-slot="user-message-text"]')).toHaveText(prompt)
  await expect(message).toHaveAttribute("data-timeline-part-id", /^.+:text:0$/)
  const messageID = (await message.getAttribute("data-timeline-part-id"))!.replace(/:text:0$/, "")
  await expect(shimmer).toContainText("Creating worktree")
  await expect(shimmer).toHaveAttribute("data-active", "true")
  await expect.poll(() => mock.calls).toEqual(["worktree"])
  // Worktrees are created by project, without a location.
  expect(mock.worktreeRequests.map((request) => request.url.searchParams.has("location[directory]"))).toEqual([false])
  expect(mock.worktreeRequests.map((request) => request.body)).toEqual([expect.objectContaining({ projectID })])
  expect(mock.creates).toEqual([])
  expect(mock.prompts).toEqual([])

  return { url, sessionID, messageID, message, shimmer }
}

// Resolves semantic colors through the browser, without reproducing the button's gradient.
async function expectBackground(element: Locator, token: string) {
  const color = await element.evaluate((element, token) => {
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.backgroundColor = `var(--v2-background-bg-${token})`
    element.append(probe)
    const color = getComputedStyle(probe).backgroundColor
    probe.remove()

    return color
  }, token)

  await expect(element).toHaveCSS("background-image", new RegExp(color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
}

async function expectToken(element: Locator, property: string, token: string) {
  const color = await element.evaluate((element, token) => {
    const probe = document.createElement("span")
    probe.hidden = true
    probe.style.color = `var(${token})`
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()

    return color
  }, token)

  await expect(element).toHaveCSS(property, color)
}
