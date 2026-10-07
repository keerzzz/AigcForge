import { createComputed, createRoot } from "solid-js"
import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import { createAigcfrogeClient, type Config, type AigcfrogeClient, type Project } from "@aigcfroge/sdk/v2/client"
import type { NormalizedProviderListResponse } from "@aigcfroge/session-ui/context"
import {
  bootstrapDirectory,
  loadPathQuery,
  loadProvidersQuery,
  loadV2PermissionPending,
  type PermissionPendingClient,
} from "./bootstrap"
import type { State, VcsCache } from "./types"
import { ServerScope } from "@/utils/server-scope"
import { applyDirectoryEvent } from "./event-reducer"
import { WorkReview } from "@aigcfroge/schema/work-review"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import type { Session } from "@aigcfroge/sdk/v2/client"

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse

describe("bootstrapDirectory", () => {
  test("marks a loading directory partial during bootstrap and complete after success", async () => {
    const mcpReads: string[] = []
    const v2PermissionReads: string[] = []
    const questionReads: unknown[] = []
    const [store, setStore] = createStore<State>({
      status: "loading",
      agent: [],
      command: [],
      project: "",
      projectMeta: undefined,
      icon: undefined,
      provider_ready: true,
      provider,
      config: {},
      path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
      session: [],
      sessionTotal: 0,
      session_status: {},
      session_working(id: string) {
        return this.session_status[id]?.type !== "idle"
      },
      session_diff: {},
      permission: {},
      permission_v2: {},
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
      question_revision: 0,
      question_load_epoch: 0,
      question_events: [],
      question: {},
      mcp_ready: true,
      mcp: {},
      lsp_ready: true,
      lsp: [],
      vcs: undefined,
      limit: 5,
      message: {},
      part: {},
      part_text_accum_delta: {},
    })

    await bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: false,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      sdk: {
        app: { agents: async () => ({ data: [{ name: "build", mode: "primary" }] }) },
        config: { get: async () => ({ data: {} }) },
        session: {
          status: async () => ({ data: {} }),
          get: async ({ sessionID }: { sessionID: string }) => ({
            data: { id: sessionID, mode: "custom", directory: "/project" },
          }),
        },
        vcs: { get: async () => ({ data: undefined }) },
        command: {
          list: async () => {
            mcpReads.push("command")
            return { data: [] }
          },
        },
        permission: { list: async () => ({ data: [] }) },
        v2: {
          question: {
            request: {
              list: async (input: unknown) => {
                questionReads.push(input)
                return {
                  data: {
                    location: { directory: "/project" },
                    data: [
                      {
                        id: "que_canonical",
                        sessionID: "ses_custom",
                        questions: [{ question: "Choose", header: "Choice", options: [] }],
                      },
                    ],
                  },
                }
              },
            },
          },
          permission: {
            request: {
              list: async () => {
                v2PermissionReads.push("list")
                return {
                  data: {
                    location: {},
                    data: [
                      {
                        id: "per_custom",
                        sessionID: "ses_custom",
                        action: "bash",
                        resources: ["/project/script.ts"],
                        metadata: { description: "Run script", credentialRef: "must-not-enter-app-state" },
                      },
                    ],
                  },
                }
              },
            },
          },
        },
        mcp: {
          status: async () => {
            mcpReads.push("status")
            return { data: {} }
          },
        },
        provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
      } as unknown as AigcfrogeClient,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
    })

    expect(store.status).toBe("partial")

    await new Promise<void>((resolve) =>
      createRoot((dispose) =>
        createComputed(() => {
          if (store.status !== "complete") return
          dispose()
          resolve()
        }),
      ),
    )

    expect(store.status).toBe("complete")
    expect(mcpReads).toEqual([])
    expect(v2PermissionReads).toEqual(["list"])
    expect(questionReads).toEqual([{ location: { directory: "/project" } }])
    expect(store.question.ses_custom?.map((question) => question.id)).toEqual(["que_canonical"])
    expect(store.permission_v2.ses_custom).toEqual([
      {
        id: "per_custom",
        sessionID: "ses_custom",
        action: "bash",
        resources: ["/project/script.ts"],
        metadata: { description: "Run script" },
      },
    ])
  })

  test("keeps an asked request received after the V2 snapshot begins", async () => {
    const [store, setStore] = createStore<State>({
      status: "complete",
      agent: [],
      command: [],
      project: "",
      projectMeta: undefined,
      icon: undefined,
      provider_ready: true,
      provider,
      config: {},
      path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
      session: [],
      sessionTotal: 1,
      session_status: {},
      session_working() {
        return false
      },
      session_diff: {},
      permission: {},
      permission_v2: {},
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
      question_revision: 0,
      question_load_epoch: 0,
      question_events: [],
      question: {},
      mcp_ready: true,
      mcp: {},
      lsp_ready: true,
      lsp: [],
      vcs: undefined,
      limit: 5,
      message: {},
      part: {},
      part_text_accum_delta: {},
    })
    const sdk = {
      session: { get: async () => ({ data: undefined }) },
      v2: {
        permission: {
          request: {
            list: async () => ({
              data: {
                location: {},
                data: [{ id: "per_snapshot", sessionID: "ses_custom", action: "bash", resources: ["/snapshot"] }],
              },
            }),
          },
        },
      },
    } satisfies PermissionPendingClient

    const pending = loadV2PermissionPending({ sdk, store, setStore })
    applyDirectoryEvent({
      event: {
        type: "permission.v2.asked",
        properties: { id: "per_live", sessionID: "ses_custom", action: "bash", resources: ["/live"] },
      },
      store,
      setStore,
      push() {},
      directory: "/project",
      loadLsp() {},
    })
    await pending

    expect(store.permission_v2.ses_custom?.map((request) => request.id)).toEqual(["per_live", "per_snapshot"])
    expect(store.permission_v2_events).toEqual([])
  })

  test("does not let an older V2 snapshot overwrite a newer load", async () => {
    const [store, setStore] = createStore<State>({
      status: "complete",
      agent: [],
      command: [],
      project: "",
      projectMeta: undefined,
      icon: undefined,
      provider_ready: true,
      provider,
      config: {},
      path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
      session: [],
      sessionTotal: 1,
      session_status: {},
      session_working() {
        return false
      },
      session_diff: {},
      permission: {},
      permission_v2: {},
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
      question_revision: 0,
      question_load_epoch: 0,
      question_events: [],
      question: {},
      mcp_ready: true,
      mcp: {},
      lsp_ready: true,
      lsp: [],
      vcs: undefined,
      limit: 5,
      message: {},
      part: {},
      part_text_accum_delta: {},
    })
    let resolveOlder!: (value: { data: { data: unknown[] } }) => void
    const older = new Promise<{ data: { data: unknown[] } }>((resolve) => {
      resolveOlder = resolve
    })
    let calls = 0
    const sdk = {
      session: { get: async () => ({ data: undefined }) },
      v2: {
        permission: {
          request: {
            list: () => {
              calls += 1
              if (calls === 1) return older
              return Promise.resolve({
                data: {
                  data: [{ id: "per_newer", sessionID: "ses_custom", action: "bash", resources: ["/newer"] }],
                },
              })
            },
          },
        },
      },
    } satisfies PermissionPendingClient

    const first = loadV2PermissionPending({ sdk, store, setStore })
    await loadV2PermissionPending({ sdk, store, setStore })
    resolveOlder({
      data: {
        data: [{ id: "per_older", sessionID: "ses_custom", action: "bash", resources: ["/older"] }],
      },
    })
    await first

    expect(store.permission_v2.ses_custom?.map((request) => request.id)).toEqual(["per_newer"])
  })

  test("does not revive a replied request from a stale V2 snapshot", async () => {
    const [store, setStore] = createStore<State>({
      status: "complete",
      agent: [],
      command: [],
      project: "",
      projectMeta: undefined,
      icon: undefined,
      provider_ready: true,
      provider,
      config: {},
      path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
      session: [],
      sessionTotal: 1,
      session_status: {},
      session_working() {
        return false
      },
      session_diff: {},
      permission: {},
      permission_v2: {
        ses_custom: [{ id: "per_pending", sessionID: "ses_custom", action: "bash", resources: ["/pending"] }],
      },
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
      question_revision: 0,
      question_load_epoch: 0,
      question_events: [],
      question: {},
      mcp_ready: true,
      mcp: {},
      lsp_ready: true,
      lsp: [],
      vcs: undefined,
      limit: 5,
      message: {},
      part: {},
      part_text_accum_delta: {},
    })
    const sdk = {
      session: { get: async () => ({ data: undefined }) },
      v2: {
        permission: {
          request: {
            list: async () => ({
              data: {
                location: {},
                data: [{ id: "per_pending", sessionID: "ses_custom", action: "bash", resources: ["/pending"] }],
              },
            }),
          },
        },
      },
    } satisfies PermissionPendingClient

    const pending = loadV2PermissionPending({ sdk, store, setStore })
    applyDirectoryEvent({
      event: {
        type: "permission.v2.replied",
        properties: { sessionID: "ses_custom", requestID: "per_pending", reply: "once" },
      },
      store,
      setStore,
      push() {},
      directory: "/project",
      loadLsp() {},
    })
    await pending

    expect(store.permission_v2.ses_custom).toBeUndefined()
    expect(store.permission_v2_events).toEqual([])
  })
})

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const client = createAigcfrogeClient({ baseUrl: "http://localhost" })
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", client).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", client).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
    expect([...loadProvidersQuery(remote, null, client).queryKey]).toEqual([
      "https://debian.example",
      null,
      "providers",
    ])
  })
})

const review = (revision: number, state: WorkReview.State = "open") =>
  new WorkReview.Review({
    contractVersion: 1,
    artifactID: "artifact-a",
    artifactRevision: WorkflowAsset.Revision.make("a".repeat(64)),
    state,
    revision,
    updatedAt: 1,
  })

const reviewSession = (id: string, workReview?: WorkReview.Review): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/project",
  title: id,
  version: "1",
  mode: "work",
  time: { created: 1, updated: 1 },
  ...(workReview ? { workReview } : {}),
})

function reviewReadback() {
  const [store, setStore] = createStore<State>({
    status: "complete" as const,
    agent: [],
    command: [],
    project: "project",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider,
    config: {},
    path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_working() {
      return false
    },
    session_diff: {},
    permission: {},
    permission_v2: {},
    permission_v2_revision: 0,
    permission_v2_load_epoch: 0,
    permission_v2_events: [],
    question_revision: 0,
    question_load_epoch: 0,
    question_events: [],
    question: {},
    mcp_ready: true,
    mcp: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    part: {},
    part_text_accum_delta: {},
  })
  const started = Promise.withResolvers<string>()
  const response = Promise.withResolvers<{ data?: Session }>()
  const sdk = {
    session: {
      get({ sessionID }) {
        started.resolve(sessionID)
        return response.promise
      },
    },
    v2: {
      permission: {
        request: {
          list: async () => ({
            data: { data: [{ id: "per_a", sessionID: "ses_a", action: "bash", resources: ["/project/script"] }] },
          }),
        },
      },
    },
  } satisfies PermissionPendingClient
  return {
    store,
    response,
    started,
    load: () => loadV2PermissionPending({ sdk, store, setStore }),
    apply(event: Parameters<typeof applyDirectoryEvent>[0]["event"]) {
      applyDirectoryEvent({ event, store, setStore, directory: "/project", push() {}, loadLsp() {} })
    },
  }
}

describe("AI-TDD-S06-R11/R12 bootstrap WorkReview readback", () => {
  test("R11: warming a Session reads the canonical direct workReview", async () => {
    const context = reviewReadback()
    const pending = context.load()
    expect(await context.started.promise).toBe("ses_a")
    const session = reviewSession("ses_a", { ...review(2) })
    context.response.resolve({ data: session })
    await pending
    expect(context.store.session[0]?.workReview).toEqual(session.workReview)
  })

  test.each(["older", "equal", "missing", "invalid"] as const)(
    "R12: late bootstrap session.get with %s review cannot replace newer received review",
    async (kind) => {
      const context = reviewReadback()
      const pending = context.load()
      expect(await context.started.promise).toBe("ses_a")
      const newest = review(7, "resolved")
      context.apply({ type: "session.created", properties: { info: reviewSession("ses_a", newest) } })
      expect(context.store.session[0]?.workReview).toEqual(newest)
      const older = kind === "missing" ? undefined : review(kind === "equal" ? 7 : 1)
      context.response.resolve({
        data: {
          ...reviewSession("ses_a", kind === "invalid" ? { ...review(9), artifactID: "" } : older),
          title: "network title",
        },
      })
      await pending
      expect(context.store.session[0]?.workReview).toEqual(newest)
      expect(context.store.session[0]?.title).toBe("network title")
    },
  )

  test("R12: work.review.updated received during bootstrap survives its older Session response", async () => {
    const context = reviewReadback()
    const pending = context.load()
    await context.started.promise
    context.apply({ type: "session.created", properties: { info: reviewSession("ses_a", review(1)) } })
    const newest = review(4, "resolved")
    context.apply({
      type: "work.review.updated",
      properties: { sessionID: "ses_a", revision: 4, review: { ...newest } },
    })
    context.response.resolve({ data: reviewSession("ses_a", review(2)) })
    await pending
    expect(context.store.session[0]?.workReview).toEqual(newest)
  })

  test("R12: a Session response for a different ID cannot populate the requested Session", async () => {
    const context = reviewReadback()
    const pending = context.load()
    expect(await context.started.promise).toBe("ses_a")
    context.response.resolve({ data: reviewSession("ses_b", review(8)) })
    await pending
    expect(context.store.session).toEqual([])
  })

  test("R11: warming metadata-only Sessions does not create an old-format compatibility view", async () => {
    const context = reviewReadback()
    const pending = context.load()
    await context.started.promise
    context.response.resolve({ data: { ...reviewSession("ses_a"), metadata: { workReview: review(9) } } })
    await pending
    expect(context.store.session[0]?.workReview).toBeUndefined()
  })
})
