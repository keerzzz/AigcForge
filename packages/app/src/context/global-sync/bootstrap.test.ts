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

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse

describe("bootstrapDirectory", () => {
  test("marks a loading directory partial during bootstrap and complete after success", async () => {
    const mcpReads: string[] = []
    const v2PermissionReads: string[] = []
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
      todo: {},
      permission: {},
      permission_v2: {},
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
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
        question: { list: async () => ({ data: [] }) },
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

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.status).toBe("complete")
    expect(mcpReads).toEqual([])
    expect(v2PermissionReads).toEqual(["list"])
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
      todo: {},
      permission: {},
      permission_v2: {},
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
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
      todo: {},
      permission: {},
      permission_v2: {},
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
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
      todo: {},
      permission: {},
      permission_v2: {
        ses_custom: [{ id: "per_pending", sessionID: "ses_custom", action: "bash", resources: ["/pending"] }],
      },
      permission_v2_revision: 0,
      permission_v2_load_epoch: 0,
      permission_v2_events: [],
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
