import { beforeAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createComponent, createEffect, createRoot, ErrorBoundary, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import type { Event, SessionIdentityIdentity } from "@aigcfroge/sdk/v2/client"
import type { ServerSDK } from "./server-sdk"
import { ServerScope } from "@/utils/server-scope"
// Deep specifiers are not mocked by sibling tests, so they resolve to the real
// implementations used to rebuild the barrel in beforeAll.
import * as uiContextHelper from "@aigcfroge/ui/context/helper"
import * as uiContextFile from "@aigcfroge/ui/context/file"
import * as uiContextDialog from "@aigcfroge/ui/context/dialog"
import * as uiContextI18n from "@aigcfroge/ui/context/i18n"

let sdkContext: typeof import("./server-sdk")
let syncContext: typeof import("./server-sync")
let languageContext: typeof import("./language")
let PermissionProvider: typeof import("./permission").PermissionProvider
let usePermission: typeof import("./permission").usePermission
let PlatformProvider: typeof import("./platform").PlatformProvider
let ServerConnection: typeof import("./server").ServerConnection
let createSdkForServer: typeof import("@/utils/server").createSdkForServer
let SessionIdentityQuery: typeof import("@/components/session/session-identity-query").SessionIdentityQuery
let identityPermission: typeof import("@/components/status-bar/current-session-source").identityPermission
let SessionIdentityHeader: typeof import("@/components/session/session-header").SessionIdentityHeader
let Persist: typeof import("@/utils/persist").Persist
let PersistTesting: typeof import("@/utils/persist").PersistTesting

// Sibling tests (context/comments, context/terminal) re-mock @aigcfroge/ui/context to a
// no-op createSimpleContext inside their own beforeAll and never restore it; bun shares
// one module registry and re-evaluates importers on each mock.module, so a top-level mock
// here loses to their later hooks. Re-establish the real surface in beforeAll and import
// the providers afterward, the same ordering the sibling tests use. components/file-tree
// likewise mocks @solidjs/router with an incomplete surface — restore the read-only hooks
// so providers can render directly instead of through MemoryRouter/Route.
beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({ pathname: "/", query: {} }),
    useSearchParams: () => [{}, () => undefined],
    useBeforeLeave: () => undefined,
  }))
  mock.module("@aigcfroge/ui/context", () => ({
    ...uiContextHelper,
    ...uiContextFile,
    ...uiContextDialog,
    ...uiContextI18n,
  }))
  sdkContext = await import("./server-sdk")
  syncContext = await import("./server-sync")
  languageContext = await import("./language")
  ;({ PermissionProvider, usePermission } = await import("./permission"))
  ;({ PlatformProvider } = await import("./platform"))
  ;({ ServerConnection } = await import("./server"))
  ;({ createSdkForServer } = await import("@/utils/server"))
  ;({ SessionIdentityQuery } = await import("@/components/session/session-identity-query"))
  ;({ identityPermission } = await import("@/components/status-bar/current-session-source"))
  ;({ SessionIdentityHeader } = await import("@/components/session/session-header"))
  ;({ Persist, PersistTesting } = await import("@/utils/persist"))
})

const disposers: Array<() => void> = []

afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
  document.body.replaceChildren()
})

// Readiness comes from Solid/query state, never a timed sleep.
function until(ready: Accessor<boolean>) {
  return new Promise<void>((resolve) =>
    createRoot((dispose) => {
      disposers.push(dispose)
      createEffect(() => {
        if (!ready()) return
        resolve()
        dispose()
      })
    }),
  )
}

function setup(input?: { identityGate?: Promise<void> }) {
  const started = Promise.withResolvers<void>()
  const requests: Array<{ method: string; server: string; sessionID: string; directory: string | null }> = []
  const records = new Map<
    string,
    {
      tier: "propose" | "full"
      failUpdate?: boolean
      failIdentity?: boolean
      updateGate?: Promise<void>
      identityGate?: Promise<void>
    }
  >()
  const record = (server: string, sessionID = "session-1") => {
    const key = `${server}/${sessionID}`
    const existing = records.get(key)
    if (existing) return existing
    const next: NonNullable<ReturnType<typeof records.get>> = { tier: "propose", identityGate: input?.identityGate }
    records.set(key, next)
    return next
  }
  const fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      if (url.pathname === "/global/config" || url.pathname === "/path") return Response.json({})
      if (url.pathname === "/provider") return Response.json({ all: [], connected: [], default: {} })
      if (url.pathname === "/project" || url.pathname === "/lsp") return Response.json([])
      const sessionID = url.pathname.split("/")[2]
      const current = record(url.hostname, sessionID)
      requests.push({
        method: request.method,
        server: url.hostname,
        sessionID,
        directory: url.searchParams.get("directory") ?? request.headers.get("x-aigcfroge-directory"),
      })
      if (requests.filter((item) => item.method === "GET").length === 3) started.resolve()
      if (request.method === "PATCH") {
        await current.updateGate
        if (current.failUpdate) return Response.json({ message: "update refused" }, { status: 403 })
        const body: unknown = await request.json()
        if (
          !body ||
          typeof body !== "object" ||
          !("permissionTier" in body) ||
          (body.permissionTier !== "propose" && body.permissionTier !== "full")
        ) {
          throw new Error("Expected a permission tier mutation")
        }
        current.tier = body.permissionTier
        return Response.json({ id: sessionID, permissionTier: current.tier })
      }
      if (url.pathname.endsWith("/identity")) {
        if (current.failIdentity) return Response.json({ message: "identity unavailable" }, { status: 503 })
        const data = {
          sessionID,
          mode: "coding",
          location: { directory: "/repo" },
          projectID: "project",
          agent: "build",
          model: { status: "missing" },
          permission: { declaredTier: current.tier, effect: current.tier === "full" ? "allow" : "ask" },
          capability: { health: "ready", reasons: [] },
          detail: { status: "missing", reason: "fixture" },
        } satisfies SessionIdentityIdentity
        await current.identityGate
        return Response.json(data)
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    },
    { preconnect() {} },
  )
  const events = new Map<string, ReturnType<typeof createGlobalEmitter<Record<string, Event>>>>()
  const sdk = (host: string): ServerSDK => {
    const event = createGlobalEmitter<Record<string, Event>>()
    events.set(host, event)
    const createClient: ServerSDK["createClient"] = (options) =>
      createSdkForServer({
        server: { url: `http://${host}` },
        fetch,
        ...options,
      })
    return {
      scope: ServerScope.fromServerKey(ServerConnection.Key.make(`http://${host}`)),
      url: `http://${host}`,
      client: createClient({ throwOnError: true }),
      createClient,
      event: { on: event.on.bind(event), listen: event.listen.bind(event), start: async () => {} },
      ensureDirSdkContext: (directory) => ({
        scope: ServerScope.fromServerKey(ServerConnection.Key.make(`http://${host}`)),
        directory,
        url: `http://${host}`,
        createClient,
        client: createClient({ directory, throwOnError: true }),
        event: createGlobalEmitter<{ [Kind in Event["type"]]: Extract<Event, { type: Kind }> }>(),
      }),
    }
  }
  const servers = { a: sdk("server-a.test"), b: sdk("server-b.test") }
  const [state, setState] = createStore<{ server: "a" | "b"; directory: string | undefined }>({
    server: "a",
    directory: "/repo",
  })
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  disposers.push(() => client.clear())
  const sdkSpy = spyOn(sdkContext, "useServerSDK").mockImplementation(() => () => servers[state.server])
  disposers.push(() => sdkSpy.mockRestore())
  const storage = PersistTesting.localStorageWithPrefix(Persist.global("permission").storage!)
  Object.values(servers).forEach((server) => {
    const key = Persist.serverGlobal(server.scope, "permission").key
    storage.removeItem(key)
    disposers.push(() => storage.removeItem(key))
  })
  let permission: ReturnType<typeof usePermission> | undefined
  const consumers: ReturnType<typeof SessionIdentityQuery.use>[] = []
  const [failure, setFailure] = createStore<{ error?: unknown }>({})
  function Consumer(props: { target: Accessor<{ sdk: ServerSDK; sessionID: string } | undefined>; header?: boolean }) {
    const query = SessionIdentityQuery.use(props.target)
    consumers.push(query)
    if (props.header) return createComponent(SessionIdentityHeader, { query })
    const text = document.createTextNode("")
    createEffect(() => {
      text.data = query.data?.permission.declaredTier ?? "loading"
    })
    return text
  }
  function Probe() {
    permission = usePermission()
    return [
      createComponent(Consumer, { target: () => ({ sdk: servers.a, sessionID: "session-1" }), header: true }),
      createComponent(Consumer, { target: () => ({ sdk: servers.a, sessionID: "session-1" }) }),
      createComponent(Consumer, { target: () => ({ sdk: servers.a, sessionID: "session-2" }) }),
      createComponent(Consumer, { target: () => ({ sdk: servers.b, sessionID: "session-1" }) }),
      createComponent(Consumer, { target: () => undefined }),
    ]
  }
  function Owners() {
    const syncs = {
      a: syncContext.createServerSyncContext(servers.a),
      b: syncContext.createServerSyncContext(servers.b),
    }
    Object.values(syncs).forEach((sync) => {
      const child = sync.child
      // The actual child owner supplies its full store; this suite does not bootstrap directory assets.
      const childSpy = spyOn(sync, "child").mockImplementation((directory, options) =>
        child(directory, { ...options, bootstrap: false }),
      )
      disposers.push(() => childSpy.mockRestore())
      child("/repo", { bootstrap: false })[1]("config", { permission: "ask" })
    })
    const syncSpy = spyOn(syncContext, "useServerSync").mockImplementation(() => () => syncs[state.server])
    disposers.push(() => syncSpy.mockRestore())
    return createComponent(PermissionProvider, {
      directory: () => state.directory,
      get children() {
        return createComponent(Probe, {})
      },
    })
  }
  const container = document.createElement("div")
  document.body.append(container)
  disposers.push(
    render(
      () =>
        createComponent(QueryClientProvider, {
          client,
          get children() {
            return createComponent(PlatformProvider, {
              value: {
                platform: "web",
                openLink() {},
                restart: async () => {},
                back() {},
                forward() {},
                notify: async () => {},
              },
              get children() {
                return createComponent(ErrorBoundary, {
                  fallback: (error) => {
                    setFailure("error", error)
                    return "Fixture failed"
                  },
                  get children() {
                    return createComponent(languageContext.LanguageProvider, {
                      locale: "en",
                      get children() {
                        return createComponent(Owners, {})
                      },
                    })
                  },
                })
              },
            })
          },
        }),
      container,
    ),
  )
  return {
    servers,
    client,
    consumers,
    permission: permission!,
    requests,
    record,
    setState,
    events,
    started: started.promise,
    failure,
    container,
  }
}

describe("shared session identity permission queries", () => {
  test("deduplicates two consumers, isolates servers/sessions, and does not fetch an absent target", async () => {
    const fixture = setup()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    expect(fixture.requests).toHaveLength(3)
    expect(fixture.consumers[0].data).toEqual(fixture.consumers[1].data)
    expect(fixture.consumers[2].data?.sessionID).toBe("session-2")
    expect(fixture.consumers[4].data).toBeUndefined()
  })

  test("a successful mutation refreshes both consumers, not another server or session", async () => {
    const fixture = setup()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    await fixture.permission.setPermissionTier("session-1", "full")
    expect(fixture.record("server-a.test").tier).toBe("full")
    // Await the mutation's query invalidation, not a manual refetch that would hide the regression.
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(4)
    await until(() => fixture.consumers[0].data?.permission.declaredTier === "full")
    expect(fixture.consumers[1].data?.permission.declaredTier).toBe("full")
    expect(identityPermission(fixture.consumers[1], "Request failed")?.kind).toBe("full")
    expect(fixture.consumers[2].data?.permission.declaredTier).toBe("propose")
    expect(fixture.consumers[3].data?.permission.declaredTier).toBe("propose")
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(4)
    expect(fixture.requests.find((request) => request.method === "PATCH")?.directory).toBe(encodeURIComponent("/repo"))
  })

  test("an acknowledged write stays successful while a failed refresh replaces stale permission displays", async () => {
    const fixture = setup()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    expect(fixture.container.textContent).toContain("propose")
    fixture.record("server-a.test").failIdentity = true
    await fixture.permission.setPermissionTier("session-1", "full")
    expect(fixture.record("server-a.test").tier).toBe("full")
    await until(() => fixture.consumers[0].isError && fixture.consumers[1].isError)
    expect(fixture.failure.error).toBeUndefined()
    expect(fixture.consumers[0].data).toBeUndefined()
    expect(fixture.consumers[1].data).toBeUndefined()
    expect(identityPermission(fixture.consumers[1], "Request failed")).toEqual({
      kind: "degraded",
      reason: "Request failed",
    })
    expect(fixture.container.querySelector('[data-state="unavailable"]')?.textContent).toContain("Request failed")
    expect(fixture.container.querySelector('[data-field="permission"]')).toBeNull()

    fixture.record("server-a.test").failIdentity = false
    await fixture.consumers[0].refetch()
    await until(() => fixture.consumers[0].isSuccess && fixture.consumers[1].isSuccess)
    expect(fixture.container.querySelector('[data-state="unavailable"]')).toBeNull()
    expect(fixture.container.querySelector('[data-field="permission"]')?.textContent).toContain("Full access")
    expect(identityPermission(fixture.consumers[1], "Request failed")).toEqual({ kind: "full", effect: "allow" })
  })

  test("a read started before the mutation cannot replace the refreshed identity", async () => {
    const gate = Promise.withResolvers<void>()
    const fixture = setup({ identityGate: gate.promise })
    await fixture.started
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(3)
    fixture.record("server-a.test").identityGate = undefined
    await fixture.permission.setPermissionTier("session-1", "full")
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(4)
    gate.resolve()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    expect(fixture.consumers[0].data?.permission.declaredTier).toBe("full")
    expect(fixture.consumers[1].data?.permission.declaredTier).toBe("full")
  })

  test("the server event owner refreshes both consumers even without an open directory store", async () => {
    const fixture = setup()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    fixture.record("server-a.test").tier = "full"
    fixture.events.get("server-a.test")!.emit("/not-open", {
      id: "event-1",
      type: "session.updated",
      properties: {
        sessionID: "session-1",
        info: {
          id: "session-1",
          slug: "one",
          title: "One",
          projectID: "project",
          directory: "/not-open",
          version: "1",
          time: { created: 1, updated: 2 },
          permissionTier: "full",
        },
      },
    })
    await until(
      () =>
        fixture.consumers[0].data?.permission.declaredTier === "full" &&
        fixture.consumers[1].data?.permission.declaredTier === "full",
    )
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(4)
    expect(fixture.consumers[2].data?.permission.declaredTier).toBe("propose")
    expect(fixture.consumers[3].data?.permission.declaredTier).toBe("propose")
  })

  test("a failed mutation rejects without changing the cached identity or refetching", async () => {
    const fixture = setup()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    fixture.record("server-a.test").failUpdate = true
    await expect(fixture.permission.setPermissionTier("session-1", "full")).rejects.toBeDefined()
    expect(fixture.consumers[0].data?.permission.declaredTier).toBe("propose")
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(3)
  })

  test("missing directory rejects instead of reporting a successful mutation", async () => {
    const fixture = setup()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    fixture.setState("directory", undefined)
    await expect(fixture.permission.setPermissionTier("session-1", "full")).rejects.toBeDefined()
    expect(fixture.requests.some((request) => request.method === "PATCH")).toBe(false)
  })

  test("a server switch during mutation invalidates the original server's identity", async () => {
    const fixture = setup()
    await until(() => fixture.consumers.slice(0, 4).every((query) => query.isSuccess))
    const gate = Promise.withResolvers<void>()
    fixture.record("server-a.test").updateGate = gate.promise
    const update = fixture.permission.setPermissionTier("session-1", "full")
    fixture.setState("server", "b")
    gate.resolve()
    await update
    expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(4)
    await until(() => fixture.consumers[0].data?.permission.declaredTier === "full")
    expect(fixture.consumers[3].data?.permission.declaredTier).toBe("propose")
  })
})
