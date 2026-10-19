import { describe, expect, test } from "bun:test"
import type { Event, ProductMode, Session } from "@aigcfroge/sdk/v2/client"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { createComponent, untrack } from "solid-js"
import { render } from "solid-js/web"
import type { SetStoreFunction, Store } from "solid-js/store"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { createSdkForServer } from "@/utils/server"
import { ServerScope } from "@/utils/server-scope"
import { LanguageProvider } from "./language"
import { PlatformProvider } from "./platform"
import type { ServerSDK } from "./server-sdk"
import { createServerSyncContextInner } from "./server-sync"
import { createDirSyncContext } from "./directory-sync"
import { applyDirectoryEvent } from "./global-sync/event-reducer"
import type { State } from "./global-sync/types"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"

describe("pickDirectoriesToEvict", () => {
  test("keeps pinned stores and evicts idle stores", () => {
    const now = 5_000
    const picks = pickDirectoriesToEvict({
      stores: ["a", "b", "c", "d"],
      state: new Map([
        ["a", { lastAccessAt: 1_000 }],
        ["b", { lastAccessAt: 4_900 }],
        ["c", { lastAccessAt: 4_800 }],
        ["d", { lastAccessAt: 3_000 }],
      ]),
      pins: new Set(["a"]),
      max: 2,
      ttl: 1_500,
      now,
    })

    expect(picks).toEqual(["d", "c"])
  })
})

describe("loadRootSessionsWithFallback", () => {
  test("uses limited roots query when supported", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      list: async (query) => {
        calls.push(query)
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(true)
    expect(calls).toEqual([{ directory: "dir", roots: true, limit: 10 }])
  })

  test("forwards product mode to limited and fallback queries", async () => {
    const calls: Array<{ directory: string; roots: true; mode?: ProductMode; limit?: number }> = []

    await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 10,
      mode: "chat",
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
    })

    expect(calls).toEqual([
      { directory: "dir", roots: true, mode: "chat", limit: 10 },
      { directory: "dir", roots: true, mode: "chat" },
    ])
  })

  test("falls back to full roots query on limited-query failure", async () => {
    const calls: Array<{ directory: string; roots: true; limit?: number }> = []

    const result = await loadRootSessionsWithFallback({
      directory: "dir",
      limit: 25,
      list: async (query) => {
        calls.push(query)
        if (query.limit) throw new Error("unsupported")
        return { data: [] }
      },
    })

    expect(result.data).toEqual([])
    expect(result.limited).toBe(false)
    expect(calls).toEqual([
      { directory: "dir", roots: true, limit: 25 },
      { directory: "dir", roots: true },
    ])
  })
})

describe("estimateRootSessionTotal", () => {
  test("keeps exact total for full fetches", () => {
    expect(estimateRootSessionTotal({ count: 42, limit: 10, limited: false })).toBe(42)
  })

  test("marks has-more for full-limit limited fetches", () => {
    expect(estimateRootSessionTotal({ count: 10, limit: 10, limited: true })).toBe(11)
  })

  test("keeps exact total when limited fetch is under limit", () => {
    expect(estimateRootSessionTotal({ count: 9, limit: 10, limited: true })).toBe(9)
  })
})

describe("canDisposeDirectory", () => {
  test("rejects pinned or inflight directories", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: true,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: true,
        loadingSessions: false,
      }),
    ).toBe(false)
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: true,
      }),
    ).toBe(false)
  })

  test("accepts idle unpinned directory store", () => {
    expect(
      canDisposeDirectory({
        directory: "dir",
        hasStore: true,
        pinned: false,
        booting: false,
        loadingSessions: false,
      }),
    ).toBe(true)
  })
})

type ReviewSession = Session & { workReview?: WorkReview.Review }
// Only the injected HTTP body may be malformed; the real client/store keep their generated Session types.
type SessionResponse = Omit<Session, "workReview"> & { workReview?: unknown }

function reviewSession(id: string, revision?: number): ReviewSession {
  return {
    id,
    slug: id,
    projectID: "project",
    directory: "/project",
    title: id,
    version: "1",
    mode: "work",
    time: { created: 1, updated: 1 },
    ...(revision === undefined
      ? {}
      : {
          workReview: new WorkReview.Review({
            contractVersion: 1,
            artifactID: "artifact-a",
            artifactRevision: WorkflowAsset.Revision.make("a".repeat(64)),
            state: "open",
            revision,
            updatedAt: 1,
          }),
        }),
  }
}

async function reviewReadbackOwner() {
  const get = Promise.withResolvers<SessionResponse>()
  const list = Promise.withResolvers<SessionResponse[]>()
  const getStarted = Promise.withResolvers<string>()
  const listStarted = Promise.withResolvers<URL>()
  const fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      if (url.pathname === "/session") {
        listStarted.resolve(url)
        return Response.json(await list.promise)
      }
      if (url.pathname === "/session/ses_a") {
        getStarted.resolve("ses_a")
        return Response.json(await get.promise)
      }
      if (url.pathname === "/session/ses_a/message") return Response.json([])
      if (url.pathname === "/experimental/capabilities")
        return Response.json({ canonicalSessionModes: ["assistant", "custom"] })
      if (url.pathname === "/global/config" || url.pathname === "/mcp") return Response.json({})
      if (url.pathname === "/path") {
        return Response.json({ state: "", config: "", worktree: "/project", directory: "/project", home: "/home" })
      }
      if (url.pathname === "/provider") return Response.json({ all: [], connected: [], default: {} })
      if (url.pathname === "/project" || url.pathname === "/lsp" || url.pathname === "/command")
        return Response.json([])
      throw new Error(`Unexpected fixture request: ${request.method} ${url.pathname}`)
    },
    { preconnect() {} },
  )
  const emitter = createGlobalEmitter<Record<string, Event>>()
  const createClient: ServerSDK["createClient"] = (options) =>
    createSdkForServer({ server: { url: "http://work-review-readback.test" }, fetch, ...options })
  const sdk: ServerSDK = {
    scope: ServerScope.local,
    url: "http://work-review-readback.test",
    client: createClient({ throwOnError: true }),
    createClient,
    event: { on: emitter.on.bind(emitter), listen: emitter.listen.bind(emitter), start: async () => {} },
    ensureDirSdkContext: (directory) => ({
      scope: ServerScope.local,
      directory,
      url: "http://work-review-readback.test",
      createClient,
      client: createClient({ directory, throwOnError: true }),
      event: createGlobalEmitter<{ [Kind in Event["type"]]: Extract<Event, { type: Kind }> }>(),
    }),
  }
  const ready = Promise.withResolvers<{
    server: ReturnType<typeof createServerSyncContextInner>
    directory: ReturnType<typeof createDirSyncContext>
    store: Store<State>
    setStore: SetStoreFunction<State>
  }>()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement("div")
  const dispose = render(
    () =>
      createComponent(QueryClientProvider, {
        client: queryClient,
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
              return createComponent(LanguageProvider, {
                locale: "en",
                get children() {
                  return untrack(() => {
                    const server = createServerSyncContextInner(sdk)
                    const [store, setStore] = server.child("/project", { bootstrap: false })
                    setStore("status", "complete")
                    const directory = createDirSyncContext("/project", server, sdk)
                    ready.resolve({ server, directory, store, setStore })
                    return null
                  })
                },
              })
            },
          })
        },
      }),
    container,
  )
  const context = await ready.promise
  return {
    ...context,
    get,
    list,
    getStarted,
    listStarted,
    apply(event: Parameters<typeof applyDirectoryEvent>[0]["event"]) {
      applyDirectoryEvent({
        event,
        store: context.store,
        setStore: context.setStore,
        directory: "/project",
        push() {},
        loadLsp() {},
      })
    },
    dispose() {
      dispose()
      queryClient.clear()
      container.remove()
    },
  }
}

describe("AI-TDD-S06-R11/R12 actual Session read owners", () => {
  test.each(["older", "equal", "missing", "invalid"] as const)(
    "R12: DirectorySync session.get with %s review cannot overwrite a newer received Session",
    async (kind) => {
      const context = await reviewReadbackOwner()
      try {
        context.setStore("session", [reviewSession("ses_a", 1)])
        const pending = context.directory.session.sync("ses_a", { force: true })
        expect(await context.getStarted.promise).toBe("ses_a")
        const newest = reviewSession("ses_a", 5)
        context.apply({ type: "session.updated", properties: { info: newest } })
        const older = reviewSession(
          "ses_a",
          kind === "missing" ? undefined : kind === "equal" ? 5 : kind === "invalid" ? 9 : 2,
        )
        context.get.resolve({
          ...older,
          ...(older.workReview
            ? {
                workReview: {
                  ...older.workReview,
                  state: "resolved",
                  artifactID: kind === "invalid" ? "" : "artifact-a",
                },
              }
            : {}),
          title: "late GET title",
        })
        await pending
        expect(context.store.session[0]).toMatchObject({
          workReview: { ...newest.workReview },
          title: "late GET title",
        })
      } finally {
        context.dispose()
      }
    },
  )

  test("R12: DirectorySync rejects a response for another Session ID", async () => {
    const context = await reviewReadbackOwner()
    try {
      context.setStore("session", [reviewSession("ses_a", 1), reviewSession("ses_b", 2)])
      const pending = context.directory.session.sync("ses_a", { force: true })
      await context.getStarted.promise
      context.get.resolve(reviewSession("ses_b", 9))
      await pending
      expect(context.store.session.map((session) => session.id)).toEqual(["ses_a", "ses_b"])
      expect(context.store.session[0]).toMatchObject({ workReview: { revision: 1 } })
      expect(context.store.session[1]).toMatchObject({ workReview: { revision: 2 } })
    } finally {
      context.dispose()
    }
  })

  test.each(["older", "equal", "missing", "invalid"] as const)(
    "R12: DirectorySync paged list with %s review cannot replace a newer accepted review",
    async (kind) => {
      const context = await reviewReadbackOwner()
      try {
        context.setStore("session", [reviewSession("ses_a", 1)])
        const pending = context.directory.session.fetch()
        await context.listStarted.promise
        const newest = reviewSession("ses_a", 4)
        context.apply({ type: "session.updated", properties: { info: newest } })
        const incoming = reviewSession(
          "ses_a",
          kind === "missing" ? undefined : kind === "equal" ? 4 : kind === "invalid" ? 9 : 2,
        )
        context.list.resolve([
          {
            ...incoming,
            ...(incoming.workReview
              ? {
                  workReview: {
                    ...incoming.workReview,
                    state: "resolved",
                    artifactID: kind === "invalid" ? "" : "artifact-a",
                  },
                }
              : {}),
            title: "page title",
          },
        ])
        await pending
        expect(context.store.session[0]).toMatchObject({ workReview: { ...newest.workReview }, title: "page title" })
      } finally {
        context.dispose()
      }
    },
  )
  ;[undefined, "work" as const].forEach((mode) => {
    test.each(["older", "equal", "missing", "invalid"] as const)(
      `R12: ServerSync ${mode ?? "all-mode"} bootstrap list with %s review preserves the newest received review`,
      async (kind) => {
        const context = await reviewReadbackOwner()
        try {
          context.setStore("session", [reviewSession("ses_a", 1)])
          const pending = context.server.project.loadSessions("/project", { mode })
          const request = await context.listStarted.promise
          expect(request.searchParams.get("mode")).toBe(mode ?? null)
          const newest = reviewSession("ses_a", 6)
          context.apply({ type: "session.updated", properties: { info: newest } })
          const incoming = reviewSession(
            "ses_a",
            kind === "missing" ? undefined : kind === "equal" ? 6 : kind === "invalid" ? 9 : 2,
          )
          context.list.resolve([
            {
              ...incoming,
              ...(incoming.workReview
                ? {
                    workReview: {
                      ...incoming.workReview,
                      state: "resolved",
                      artifactID: kind === "invalid" ? "" : "artifact-a",
                    },
                  }
                : {}),
              title: "bootstrap title",
            },
          ])
          await pending
          expect(context.store.session[0]).toMatchObject({
            workReview: { ...newest.workReview },
            title: "bootstrap title",
          })
        } finally {
          context.dispose()
        }
      },
    )
  })

  test("R12: the real bootstrap list preserves a work.review.updated received while it is in flight", async () => {
    const context = await reviewReadbackOwner()
    try {
      context.setStore("session", [reviewSession("ses_a", 1)])
      const pending = context.server.project.loadSessions("/project")
      await context.listStarted.promise
      context.apply({
        type: "work.review.updated",
        properties: { sessionID: "ses_a", revision: 5, review: reviewSession("ses_a", 5).workReview },
      })
      context.list.resolve([reviewSession("ses_a", 2)])
      await pending
      expect(context.store.session[0]).toMatchObject({ workReview: { revision: 5 } })
    } finally {
      context.dispose()
    }
  })

  test("R12: recreating DirectorySync restores canonical Review via SDK GET without any notification", async () => {
    const previous = await reviewReadbackOwner()
    try {
      const pending = previous.directory.session.sync("ses_a", { force: true })
      await previous.getStarted.promise
      previous.get.resolve(reviewSession("ses_a", 1))
      await pending
      expect(previous.store.session[0]).toMatchObject({ workReview: { revision: 1 } })
    } finally {
      previous.dispose()
    }

    const reloaded = await reviewReadbackOwner()
    try {
      expect(reloaded.store.session).toEqual([])
      const pending = reloaded.directory.session.sync("ses_a", { force: true })
      await reloaded.getStarted.promise
      reloaded.get.resolve(reviewSession("ses_a", 7))
      await pending
      expect(reloaded.store.session[0]).toMatchObject({ workReview: { revision: 7 } })
    } finally {
      reloaded.dispose()
    }
  })

  test.each([undefined, "work"] as const)(
    "R12: a cold ServerSync %p list restores canonical Review without event delivery",
    async (mode) => {
      const context = await reviewReadbackOwner()
      try {
        const pending = context.server.project.loadSessions("/project", { mode })
        await context.listStarted.promise
        const authoritative = reviewSession("ses_a", 8)
        context.list.resolve([authoritative])
        await pending
        expect(context.store.session[0]).toMatchObject({ workReview: { ...authoritative.workReview } })
      } finally {
        context.dispose()
      }
    },
  )

  test.each(["get", "list"] as const)(
    "R11: actual SDK %s reads no metadata-only compatibility view",
    async (source) => {
      const context = await reviewReadbackOwner()
      try {
        const pending =
          source === "get"
            ? context.directory.session.sync("ses_a", { force: true })
            : context.server.project.loadSessions("/project")
        const response = { ...reviewSession("ses_a"), metadata: { workReview: reviewSession("ses_a", 9).workReview } }
        if (source === "get") {
          await context.getStarted.promise
          context.get.resolve(response)
        }
        if (source === "list") {
          await context.listStarted.promise
          context.list.resolve([response])
        }
        await pending
        expect(context.store.session[0]).toMatchObject({ id: "ses_a" })
        const result = context.store.session[0]
        expect(result?.workReview).toBeUndefined()
      } finally {
        context.dispose()
      }
    },
  )
})
