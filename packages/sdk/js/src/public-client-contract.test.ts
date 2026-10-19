import { describe, expect, test } from "bun:test"
import type { AigcfrogeClientConfig, EventServerConnected, LocationInfo } from "@aigcfroge/sdk"

const connected = { id: "evt_sdk_connected", type: "server.connected", properties: {} } satisfies EventServerConnected

const entrypoints = [
  { name: "@aigcfroge/sdk", load: () => import("@aigcfroge/sdk") },
  { name: "@aigcfroge/sdk/client", load: () => import("@aigcfroge/sdk/client") },
  { name: "@aigcfroge/sdk/v2", load: () => import("@aigcfroge/sdk/v2") },
  { name: "@aigcfroge/sdk/v2/client", load: () => import("@aigcfroge/sdk/v2/client") },
]

const sessionID = "ses_sdk_public_contract"
const requestID = "que_sdk_public_contract"
const directory = "/sdk-contract-project"
const location = { directory, project: { id: "project-sdk-contract", directory } } satisfies LocationInfo

test("public server entrypoints share the canonical implementation", async () => {
  const root = await import("@aigcfroge/sdk")
  const canonical = await import("@aigcfroge/sdk/v2")
  const server = await import("@aigcfroge/sdk/server")
  const canonicalServer = await import("@aigcfroge/sdk/v2/server")

  expect(root.createAigcfroge).toBe(canonical.createAigcfroge)
  expect(root.createAigcfrogeServer).toBe(canonicalServer.createAigcfrogeServer)
  expect(server.createAigcfrogeServer).toBe(canonicalServer.createAigcfrogeServer)
})

test("the public client accepts a synchronous single-Request handler", async () => {
  const sdk = await import("@aigcfroge/sdk")
  const requests: Request[] = []
  const config = {
    baseUrl: "http://sdk-contract.invalid",
    fetch: (...args: [Request]) => {
      expect(args).toHaveLength(1)
      expect(args[0]).toBeInstanceOf(Request)
      requests.push(args[0])
      return Response.json([])
    },
  } satisfies AigcfrogeClientConfig
  expect(Reflect.has(config.fetch, "preconnect")).toBe(false)
  const client = sdk.createAigcfrogeClient(config)
  expect((await client.session.task.get({ sessionID })).data).toEqual([])
  expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
    ["GET", `/session/${sessionID}/task`],
  ])
})

test("the public SSE client accepts the same plain Request handler", async () => {
  const sdk = await import("@aigcfroge/sdk")
  const http = transport()
  const client = sdk.createAigcfrogeClient({ baseUrl: "http://sdk-contract.invalid", fetch: http.fetch })
  expect(Reflect.has(http.fetch, "preconnect")).toBe(false)
  const events = await client.event.subscribe()
  try {
    expect((await events.stream.next()).value).toEqual(connected)
  } finally {
    await events.stream.return()
  }
  expect(http.requests.map((request) => [request.method, request.path])).toEqual([["GET", "/event"]])
})

test("public generated transport backs the same canonical operation client", async () => {
  const exported = await import("@aigcfroge/sdk/v2/gen/client")
  const canonical = await import("@aigcfroge/sdk/v2/client")
  const http = transport()
  const client = exported.createClient({ baseUrl: "http://sdk-contract.invalid", fetch: http.fetch })
  expect(Reflect.has(client, "session")).toBe(false)
  expect(Reflect.has(client, "question")).toBe(false)
  const sdk = new canonical.AigcfrogeClient({ client })
  expect((await sdk.session.task.get({ sessionID })).data).toEqual([])
  expect(http.requests.map((request) => [request.method, request.path])).toEqual([
    ["GET", `/session/${sessionID}/task`],
  ])
})

entrypoints.forEach((entry) => {
  describe(`public SDK contract: ${entry.name}`, () => {
    test("does not expose retired Todo or unowned Question operations", async () => {
      const sdk = await entry.load()
      const http = transport()
      const client = sdk.createAigcfrogeClient({ baseUrl: "http://sdk-contract.invalid", fetch: http.fetch })

      expect(Reflect.has(client.session, "todo"), "retired session.todo must not remain callable").toBe(false)
      expect(Reflect.has(client, "question"), "retired unowned question namespace must not remain callable").toBe(false)
      expect(http.requests).toEqual([])
    })

    test("executes the canonical Task, owned Question and auth wire contracts", async () => {
      const sdk = await entry.load()
      const canonical = await import("@aigcfroge/sdk/v2/client")
      const http = transport()
      const client = sdk.createAigcfrogeClient({ baseUrl: "http://sdk-contract.invalid", directory, fetch: http.fetch })

      expect(client).toBeInstanceOf(canonical.AigcfrogeClient)
      if (!(client instanceof canonical.AigcfrogeClient))
        throw new Error(`${entry.name} still constructs a different SDK`)

      expect((await client.session.task.get({ sessionID })).data).toEqual([])
      expect((await client.v2.question.request.list({ location: { directory } })).data).toEqual({
        location,
        data: [],
      })
      expect((await client.v2.session.question.list({ sessionID })).data).toEqual({ data: [] })
      expect(
        (
          await client.v2.session.question.reply({
            sessionID,
            requestID,
            questionV2Reply: { answers: [["One"]] },
          })
        ).response?.status,
      ).toBe(204)
      expect((await client.v2.session.question.reject({ sessionID, requestID })).response?.status).toBe(204)
      expect((await client.auth.set({ providerID: "synthetic", auth: { type: "api", key: "test-only" } })).data).toBe(
        true,
      )

      expect(http.requests.map((request) => [request.method, request.path, request.body])).toEqual([
        ["GET", `/session/${sessionID}/task`, undefined],
        ["GET", "/api/question/request", undefined],
        ["GET", `/api/session/${sessionID}/question`, undefined],
        ["POST", `/api/session/${sessionID}/question/${requestID}/reply`, { answers: [["One"]] }],
        ["POST", `/api/session/${sessionID}/question/${requestID}/reject`, undefined],
        ["PUT", "/auth/synthetic", { type: "api", key: "test-only" }],
      ])
      expect(http.requests[0]?.directory).toBe(directory)
      expect(http.requests[1]?.locationDirectory).toBe(directory)
    })

    test("shares the canonical factory and constructor without legacy input overloads", async () => {
      const sdk = await entry.load()
      const canonical = await import("@aigcfroge/sdk/v2/client")
      expect(sdk.createAigcfrogeClient).toBe(canonical.createAigcfrogeClient)
      expect(sdk.AigcfrogeClient).toBe(canonical.AigcfrogeClient)

      // These negative type checks are intentionally compiled by the SDK's
      // existing src-inclusive typecheck. They never execute an HTTP request.
      const oldSessionInput: Parameters<ReturnType<typeof sdk.createAigcfrogeClient>["session"]["get"]>[0] = {
        // @ts-expect-error The public SDK must not retain the retired path wrapper.
        path: { id: sessionID },
      }
      const oldAuthInput: Parameters<ReturnType<typeof sdk.createAigcfrogeClient>["auth"]["set"]>[0] = {
        // @ts-expect-error The public SDK must not retain the retired path/body wrapper.
        path: { id: "synthetic" },
        body: { type: "api", key: "test-only" },
      }
      void oldSessionInput
      void oldAuthInput
    })
  })
})

// Use real package exports, factories, generated methods and serialization.
// Only the HTTP boundary is substituted; an unexpected URL fails closed.
function transport() {
  const requests: Array<{
    method: string
    path: string
    body: unknown
    directory: string | null
    locationDirectory: string | null
  }> = []
  const routes = new Map([
    [`GET /session/${sessionID}/task`, "tasks"],
    ["GET /api/question/request", "location-questions"],
    [`GET /api/session/${sessionID}/question`, "session-questions"],
    [`POST /api/session/${sessionID}/question/${requestID}/reply`, "no-content"],
    [`POST /api/session/${sessionID}/question/${requestID}/reject`, "no-content"],
    ["PUT /auth/synthetic", "auth"],
    ["GET /event", "events"],
  ])
  const stub = async (...args: [Request]) => {
    expect(args).toHaveLength(1)
    const request = args[0]
    expect(request).toBeInstanceOf(Request)
    const url = new URL(request.url)
    const route = routes.get(`${request.method} ${url.pathname}`)
    if (url.origin !== "http://sdk-contract.invalid" || !route) {
      throw new Error(`Unexpected SDK request: ${request.method} ${url}`)
    }
    const body: unknown = request.body === null ? undefined : await request.clone().json()
    requests.push({
      method: request.method,
      path: url.pathname,
      body,
      directory: url.searchParams.get("directory"),
      locationDirectory: url.searchParams.get("location[directory]"),
    })
    if (route === "no-content") return new Response(null, { status: 204 })
    if (route === "location-questions") return Response.json({ location, data: [] })
    if (route === "session-questions") return Response.json({ data: [] })
    if (route === "auth") return Response.json(true)
    if (route === "events") {
      return new Response(`data: ${JSON.stringify(connected)}\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      })
    }
    return Response.json([])
  }
  return { fetch: stub, requests }
}
