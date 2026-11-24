import { expect, test } from "bun:test"
import type { Page, Route } from "@playwright/test"
import { createMockServerHandler, mockOmnixaServer } from "../../utils/mock-server"
import { Schema } from "effect"
import { Session } from "@omnixa/schema/session"
import { ParticipantID } from "@omnixa/schema/delegation-id"
import type {
  SessionCreateInput,
  SessionForkInput,
  SessionSelectExecutorInput,
  SessionSwitchAgentInput,
} from "@omnixa/client/promise"

type SessionRequestBody =
  | SessionCreateInput
  | Omit<SessionForkInput, "sessionID">
  | SessionSelectExecutorInput["payload"]
  | Omit<SessionSwitchAgentInput, "sessionID">

test("Meta mock selection keeper: creation, activation and forks preserve actual Agent and captured model", async () => {
  const sessions: Parameters<typeof createMockServerHandler>[0]["sessions"] = []

  const server = createMockServerHandler({
    provider: {},
    directory: "/project",
    project: {},
    sessions,
    pageMessages: () => ({ items: [{ id: "msg_boundary", type: "user", text: "Fork context", time: { created: 0 } }] }),
  })

  const model = { id: "meta", providerID: "provider", variant: "high" }
  const ordinaryModel = { id: "ordinary", providerID: "unavailable", variant: "low" }

  const request = async (path: string, method = "GET", body?: SessionRequestBody, status = 200) => {
    const response = await server.handler(
      new Request("http://localhost" + path, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )

    expect(response.status, method + " " + path + " " + (await response.clone().text())).toBe(status)

    return status === 204 ? undefined : response.json()
  }

  const response = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.toEncoded(Session.Info) }))

  const source = (info: ReturnType<typeof response>["data"]) => {
    if (!info.mode) throw new Error("Fork preview source mode is missing")

    return {
      sourceSessionID: info.id,
      mode: info.mode,
      agent: info.agent,
      model: info.model,
      controller: info.controller,
    }
  }

  try {
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) }))(
        await request("/api/agent"),
      ).data.map((item) => item.id),
    ).toEqual(["build", "meta", "plan", "explore"])
    const defaulted = response(await request("/api/session", "POST", { id: "ses_default" })).data
    expect(defaulted.agent).toBe("build")
    expect(defaulted.controller).toBeUndefined()

    const plan = response(
      await request("/api/session", "POST", { id: "ses_plan", agent: "plan", model: ordinaryModel, control: "meta" }),
    ).data

    expect(plan).toMatchObject({ agent: "plan", model: ordinaryModel })
    expect(plan.controller).toBeUndefined()
    expect(response(await request("/api/session", "POST", { id: plan.id, agent: "meta", model })).data).toEqual(plan)
    await request(`/api/session/${plan.id}/agent`, "POST", { agent: "meta", model }, 204)
    const meta = response(await request(`/api/session/${plan.id}`)).data
    expect(meta).toMatchObject({ agent: "meta", model, controller: { kind: "root", rootSessionID: plan.id } })
    const preference = { agent: "build", model: ordinaryModel }
    await request(`/api/session/${plan.id}/executor`, "POST", preference)

    const activeFork = response(
      await request(`/api/session/${plan.id}/fork`, "POST", { before: "msg_boundary", expectedSource: source(meta) }),
    ).data

    expect(activeFork).toMatchObject({
      agent: "meta",
      model,
      controller: { kind: "root", metaAgentID: meta.controller?.metaAgentID, rootSessionID: activeFork.id },
    })
    await request(`/api/session/${plan.id}/agent`, "POST", { agent: "build", model: ordinaryModel }, 204)
    const deactivated = response(await request(`/api/session/${plan.id}`)).data
    expect(deactivated).toMatchObject({
      agent: "build",
      model: ordinaryModel,
      controller: meta.controller,
      executorPreference: preference,
    })
    await request(`/api/session/${plan.id}/executor`, "POST", preference, 400)

    const ordinaryFork = response(
      await request(`/api/session/${plan.id}/fork`, "POST", {
        before: "msg_boundary",
        expectedSource: source(deactivated),
      }),
    ).data

    expect(ordinaryFork.agent).toBe("build")
    expect(ordinaryFork.model).toEqual(ordinaryModel)
    expect(ordinaryFork.controller).toBeUndefined()
    expect(ordinaryFork.executorPreference).toBeUndefined()

    const managedFork = response(
      await request(`/api/session/${plan.id}/fork`, "POST", {
        before: "msg_boundary",
        control: "meta",
        model,
        expectedSource: source(deactivated),
      }),
    ).data

    expect(managedFork).toMatchObject({
      agent: "meta",
      model,
      controller: { kind: "root", metaAgentID: meta.controller?.metaAgentID },
    })
    await request(`/api/session/${plan.id}/agent`, "POST", { agent: "meta", model }, 204)
    expect(response(await request(`/api/session/${plan.id}`)).data.controller).toEqual(meta.controller)
    const before = sessions.length
    await request(`/api/session/${plan.id}/fork`, "POST", { expectedSource: source(deactivated) }, 400)
    expect(sessions).toHaveLength(before)
    sessions.push({
      id: "ses_child",
      parentID: plan.id,
      mode: "coding",
      agent: "build",
      model: ordinaryModel,
      controller: {
        kind: "child",
        metaAgentID: meta.controller?.metaAgentID,
        rootSessionID: plan.id,
        executor: { agent: "build", model: ordinaryModel, source: "session" },
        source: { kind: "task", delegationID: "dlg_test", participantID: ParticipantID.create() },
      },
    })
    await request("/api/session/ses_child/agent", "POST", { agent: "plan", model }, 400)
    await request("/api/session/ses_child/agent", "POST", { agent: "build", model }, 400)
    await request("/api/session/ses_child/fork", "POST", {}, 400)
  } finally {
    await server.dispose()
  }
})

test("serves an empty config document list for composer defaults", async () => {
  const server = createMockServerHandler({
    provider: {},
    directory: "C:/Omnixa",
    project: {},
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })

  try {
    const response = await server.handler(
      new Request("http://localhost/api/config?location%5Bdirectory%5D=C%3A%2FOmnixa"),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  } finally {
    await server.dispose()
  }
})

test("applies message latency after a list response gate is released", async () => {
  const events: string[] = []
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  let handler: ((route: Route) => Promise<void>) | undefined

  const page = {
    addInitScript: () => Promise.resolve(),
    on: () => page,
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback

      return Promise.resolve()
    },
  } as unknown as Page

  await mockOmnixaServer(page, {
    provider: {},
    directory: "C:/Omnixa",
    project: {},
    sessions: [{ id: "session" }],
    messageDelay: 25,
    beforeMessagesResponse: () => {
      events.push("before")
      started.resolve()

      return gate.promise
    },
    onMessages: (request) => events.push(request.phase),
    pageMessages: () => {
      events.push("page")

      return { items: [] }
    },
  })

  const response = handler!({
    request: () => ({
      url: () => "http://127.0.0.1:4096/api/session/session/message",
      method: () => "GET",
      headers: () => ({}),
      postDataBuffer: () => null,
    }),
    fulfill: () => {
      events.push("fulfill")

      return Promise.resolve()
    },
  } as unknown as Route)

  await started.promise
  expect(events).toEqual(["start", "before"])

  const released = performance.now()
  gate.resolve()
  await response
  expect(performance.now() - released).toBeGreaterThanOrEqual(20)
  expect(events).toEqual(["start", "before", "page", "end", "fulfill"])
})

test("routes requests through the HttpApi contract", async () => {
  const connected = Promise.withResolvers<{ integrationID: string; body: unknown }>()
  let handler: ((route: Route) => Promise<void>) | undefined

  const page = {
    addInitScript: () => Promise.resolve(),
    on: () => page,
    route: (_url: string, callback: (route: Route) => Promise<void>) => {
      handler = callback

      return Promise.resolve()
    },
  } as unknown as Page

  await mockOmnixaServer(page, {
    provider: {},
    directory: "C:/Omnixa",
    project: {},
    sessions: [],
    pageMessages: () => ({ items: [] }),
    onConnectKey: connected.resolve,
  })

  const body = Buffer.from(JSON.stringify({ key: "secret" }))
  let status: number | undefined
  await handler!({
    request: () => ({
      url: () => "http://127.0.0.1:4096/api/integration/anthropic/connect/key",
      method: () => "POST",
      headers: () => ({ "content-type": "application/json" }),
      postDataBuffer: () => body,
    }),
    fulfill: (response: Parameters<Route["fulfill"]>[0]) => {
      status = response?.status

      return Promise.resolve()
    },
  } as unknown as Route)

  expect(status).toBe(204)
  expect(await connected.promise).toEqual({ integrationID: "anthropic", body: { key: "secret" } })
})
