import { describe, expect, test } from "bun:test"
import type { OmnixaEvent } from "@omnixa/client/promise"
import { createRoot } from "solid-js"
import { createOmnixaEventSource, createServerTransport } from "./client"

const permission = {
  id: "evt_permission",
  created: 1,
  type: "permission.asked",
  location: { directory: "/repo", workspaceID: "workspace_1" },
  data: {
    id: "perm_1",
    sessionID: "ses_1",
    action: "read",
    resources: ["src/**"],
    source: { type: "tool", messageID: "msg_1", id: "call_1" },
  },
} satisfies Extract<OmnixaEvent, { type: "permission.asked" }>

function setup() {
  return createRoot((dispose) => ({ ...createOmnixaEventSource(), dispose }))
}

describe("server event stream", () => {
  test("publishes the original current event with exact data", () => {
    const server = setup()
    const received: OmnixaEvent[] = []
    let requestID: string | undefined

    server.event.on("permission.asked", (event) => {
      requestID = event.data.id
    })
    server.event.listen((event) => received.push(event))
    server.publish(permission)

    expect(requestID).toBe("perm_1")
    expect(received).toEqual([permission])
    expect(received[0]).toBe(permission)
    server.dispose()
  })

  test("filters locations without changing workspace identity", () => {
    const server = setup()
    const repo: OmnixaEvent[] = []
    const other: OmnixaEvent[] = []
    const all: OmnixaEvent[] = []
    let workspaceID: string | undefined

    const global = {
      id: "evt_connected",
      type: "server.connected",
      data: {},
    } satisfies Extract<OmnixaEvent, { type: "server.connected" }>

    const repoEvents = server.event.location("/repo")
    repoEvents.on("permission.asked", (event) => {
      workspaceID = event.location?.workspaceID
    })
    repoEvents.listen((event) => repo.push(event))
    server.event.location("/other").listen((event) => other.push(event))
    server.event.listen((event) => all.push(event))
    server.publish(permission)
    server.publish(global)

    expect(repo).toEqual([permission])
    expect(workspaceID).toBe("workspace_1")
    expect(other).toEqual([])
    expect(all).toEqual([permission, global])
    server.dispose()
  })

  test("isolates servers and clears subscriptions with their owner", () => {
    const first = setup()
    const second = setup()
    const received = { first: 0, second: 0 }

    first.event.listen(() => received.first++)
    second.event.listen(() => received.second++)
    first.publish(permission)
    first.dispose()
    first.publish(permission)
    second.publish(permission)

    expect(received).toEqual({ first: 1, second: 1 })
    second.dispose()
  })
})

test("rotates HTTP and PTY clients together", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = []

  const fetch: NonNullable<Parameters<typeof createServerTransport>[0]["fetch"]> = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push({ url: request.url, authorization: request.headers.get("authorization") })

    return Response.json({
      version: "2.0.0-test",
      pid: 1,
      urls: [request.url],
      paths: { tmp: "/tmp/omnixa" },
    })
  }

  const transport = createServerTransport({
    http: { url: "http://127.0.0.1:4100", password: "first" },
    fetch,
  })

  const observed = createRoot((dispose) => ({ api: () => transport.api, dispose }))

  const initialPty = transport.pty

  await transport.api.server.info()

  const replacement = transport.update({
    url: "http://127.0.0.1:4200",
    password: "second",
  })

  expect(observed.api()).toBe(replacement)

  await transport.api.server.info()

  expect(replacement).toBe(transport.api)
  expect(transport.pty).not.toBe(initialPty)
  expect(transport.url).toBe("http://127.0.0.1:4200")
  expect(requests).toEqual([
    {
      url: "http://127.0.0.1:4100/api/info",
      authorization: `Basic ${btoa("omnixa:first")}`,
    },
    {
      url: "http://127.0.0.1:4200/api/info",
      authorization: `Basic ${btoa("omnixa:second")}`,
    },
  ])
  const sameOrigin = transport.update({ url: "http://127.0.0.1:4200", password: "third" })
  expect(observed.api()).toBe(sameOrigin)
  await observed.api().server.info()
  expect(requests[2]).toEqual({
    url: "http://127.0.0.1:4200/api/info",
    authorization: `Basic ${btoa("omnixa:third")}`,
  })
  observed.dispose()
})
