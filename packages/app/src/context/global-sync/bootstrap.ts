import type {
  Config,
  AigcfrogeClient,
  Path,
  PermissionRequest,
  Project,
  ProviderAuthResponse,
  QuestionRequest,
  Session,
  SessionTaskInfo,
  Todo,
} from "@aigcfroge/sdk/v2/client"
import { showToast } from "@/utils/toast"
import { getFilename } from "@aigcfroge/core/util/path"
import { retry } from "@aigcfroge/core/util/retry"
import { batch } from "solid-js"
import { reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import { cmp, normalizeAgentList, normalizeProviderList } from "./utils"
import { formatServerError } from "@/utils/server-errors"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { QueryClient, queryOptions } from "@tanstack/solid-query"
import { loadMcpQuery, type TaskProgressSnapshot } from "../server-sync"
import { NormalizedProviderListResponse } from "@aigcfroge/session-ui/context"
import { ScopedKey, type ServerScope } from "@/utils/server-scope"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  session_todo: {
    [sessionID: string]: Todo[]
  }
  session_task: {
    [sessionID: string]: SessionTaskInfo[]
  }
  /** Mirrors server-sync's GlobalStore (M7 ⑦ freshness recency maps). */
  session_todo_updated_at: {
    [sessionID: string]: number
  }
  session_task_updated_at: {
    [sessionID: string]: number
  }
  /** P2: ephemeral per-session task progress (mirrors server-sync's GlobalStore). */
  session_task_progress: {
    [sessionID: string]: TaskProgressSnapshot | undefined
  }
  provider: NormalizedProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    const timer = setTimeout(finish, 50)
    if (typeof requestAnimationFrame !== "function") return
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(timer)
        finish()
      }, 0)
    })
  })
}

function errors(list: PromiseSettledResult<unknown>[]) {
  return list.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => item.reason)
}

const providerRev = new Map<string, number>()

export function clearProviderRev(scope: ServerScope, directory: string) {
  providerRev.delete(ScopedKey.from(scope, directory))
}

function runAll(list: Array<() => Promise<unknown>>) {
  return Promise.allSettled(list.map((item) => item()))
}

export const loadGlobalConfigQuery = (scope: ServerScope, sdk: AigcfrogeClient) =>
  queryOptions({
    queryKey: [scope, "config"],
    queryFn: () =>
      retry(() =>
        sdk.global.config.get().then((x) => {
          if (!x.data) throw new Error("Empty global config response")
          return x.data
        }),
      ),
  })

export const loadProjectsQuery = (scope: ServerScope, sdk: AigcfrogeClient) =>
  queryOptions({
    queryKey: [scope, "project"],
    queryFn: () =>
      retry(() =>
        sdk.project.list().then((x) => {
          return (x.data ?? [])
            .filter((p) => !!p?.id)
            .filter((p) => !!p.worktree && !p.worktree.includes("aigcfroge-test"))
            .slice()
            .sort((a, b) => cmp(a.id, b.id))
        }),
      ),
  })

export async function bootstrapGlobal(input: {
  serverSDK: AigcfrogeClient
  scope: ServerScope
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  const slow = [
    () => input.queryClient.fetchQuery(loadGlobalConfigQuery(input.scope, input.serverSDK)),
    () => input.queryClient.fetchQuery(loadProvidersQuery(input.scope, null, input.serverSDK)),
    () => input.queryClient.fetchQuery(loadPathQuery(input.scope, null, input.serverSDK)),
    () =>
      input.queryClient
        .fetchQuery(loadProjectsQuery(input.scope, input.serverSDK))
        .then((data) => input.setGlobalStore("project", data)),
  ]
  await runAll(slow)
  // showErrors({
  //   errors: errors(),
  //   title: input.requestFailedTitle,
  //   translate: input.translate,
  //   formatMoreCount: input.formatMoreCount,
  // })
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

function projectID(directory: string, projects: Project[]) {
  return projects.find((project) => project.worktree === directory || project.sandboxes?.includes(directory))?.id
}

function mergeSession(setStore: SetStoreFunction<State>, session: Session) {
  setStore("session", (list) => {
    const next = list.slice()
    const idx = next.findIndex((item) => item.id >= session.id)
    if (idx === -1) return [...next, session]
    if (next[idx]?.id === session.id) {
      next[idx] = session
      return next
    }
    next.splice(idx, 0, session)
    return next
  })
}

function warmSessions(input: {
  ids: string[]
  store: Store<State>
  setStore: SetStoreFunction<State>
  sdk: AigcfrogeClient
}) {
  const known = new Set(input.store.session.map((item) => item.id))
  const ids = [...new Set(input.ids)].filter((id) => !!id && !known.has(id))
  if (ids.length === 0) return Promise.resolve()
  return Promise.all(
    ids.map((sessionID) =>
      retry(() => input.sdk.session.get({ sessionID })).then((x) => {
        const session = x.data
        if (!session?.id) return
        mergeSession(input.setStore, session)
      }),
    ),
  ).then(() => undefined)
}

export const loadProvidersQuery = (scope: ServerScope, directory: string | null, sdk: AigcfrogeClient) =>
  queryOptions({
    queryKey: [scope, directory, "providers"],
    queryFn: () =>
      retry(() =>
        sdk.provider.list().then((x) => {
          if (!x.data) throw new Error("Empty provider list response")
          return normalizeProviderList(x.data)
        }),
      ),
  })

export const loadAgentsQuery = (scope: ServerScope, directory: string | null, sdk: AigcfrogeClient) =>
  queryOptions({
    queryKey: [scope, directory, "agents"],
    queryFn: () => retry(() => sdk.app.agents().then((x) => normalizeAgentList(x.data))),
  })

export const loadPathQuery = (scope: ServerScope, directory: string | null, sdk: AigcfrogeClient) =>
  queryOptions<Path>({
    queryKey: [scope, directory, "path"],
    queryFn: () =>
      retry(() =>
        sdk.path.get().then((x) => {
          if (!x.data) throw new Error("Empty path response")
          return x.data
        }),
      ),
  })

export async function bootstrapDirectory(input: {
  directory: string
  scope: ServerScope
  mcp: boolean
  sdk: AigcfrogeClient
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<void> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    path: Path
    project: Project[]
    provider: NormalizedProviderListResponse
  }
  queryClient: QueryClient
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  const seededPath = input.global.path.directory === input.directory ? input.global.path : undefined
  if (seededProject) input.setStore("project", seededProject)
  if (seededPath) input.setStore("path", seededPath)
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", reconcile(input.global.config, { merge: false }))
  }
  if (loading) input.setStore("status", "partial")

  const revKey = ScopedKey.from(input.scope, input.directory)
  const rev = (providerRev.get(revKey) ?? 0) + 1
  providerRev.set(revKey, rev)
  void (async () => {
    const slow = [
      () => Promise.resolve(input.loadSessions(input.directory)),
      () =>
        input.queryClient
          .ensureQueryData(loadAgentsQuery(input.scope, input.directory, input.sdk))
          .then((data) => input.setStore("agent", data)),
      () =>
        retry(() =>
          input.sdk.config.get().then((x) => {
            if (!x.data) return
            input.setStore("config", reconcile(x.data, { merge: false }))
          }),
        ),
      () =>
        retry(() =>
          input.sdk.session.status().then((x) => {
            if (!x.data) return
            input.setStore("session_status", x.data)
          }),
        ),
      !seededProject &&
        (() =>
          retry(() => input.sdk.project.current()).then((x) => {
            if (!x.data || !x.data.id) return
            input.setStore("project", x.data.id)
          })),
      !seededPath &&
        (() =>
          input.queryClient.ensureQueryData(loadPathQuery(input.scope, input.directory, input.sdk)).then((data) => {
            const next = projectID(data.directory ?? input.directory, input.global.project)
            if (next) input.setStore("project", next)
          })),
      () =>
        retry(() =>
          input.sdk.vcs.get().then((x) => {
            const next = x.data ?? input.store.vcs
            input.setStore("vcs", next)
            if (next) input.vcsCache.setStore("value", next)
          }),
        ),
      input.mcp && (() => retry(() => input.sdk.command.list().then((x) => input.setStore("command", x.data ?? [])))),
      () =>
        retry(() =>
          input.sdk.permission.list().then((x) => {
            const ids = (x.data ?? []).map((perm) => perm?.sessionID).filter((id): id is string => !!id)
            const grouped = groupBySession(
              (x.data ?? []).filter((perm): perm is PermissionRequest => !!perm?.id && !!perm.sessionID),
            )
            return warmSessions({ ids, store: input.store, setStore: input.setStore, sdk: input.sdk }).then(() =>
              batch(() => {
                for (const sessionID of Object.keys(input.store.permission)) {
                  if (grouped[sessionID]) continue
                  input.setStore("permission", sessionID, [])
                }
                for (const [sessionID, permissions] of Object.entries(grouped)) {
                  input.setStore(
                    "permission",
                    sessionID,
                    reconcile(
                      permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
                      { key: "id" },
                    ),
                  )
                }
              }),
            )
          }),
        ),
      () =>
        retry(() =>
          input.sdk.question.list().then((x) => {
            const ids = (x.data ?? []).map((question) => question?.sessionID).filter((id): id is string => !!id)
            const grouped = groupBySession((x.data ?? []).filter((q): q is QuestionRequest => !!q?.id && !!q.sessionID))
            return warmSessions({ ids, store: input.store, setStore: input.setStore, sdk: input.sdk }).then(() =>
              batch(() => {
                for (const sessionID of Object.keys(input.store.question)) {
                  if (grouped[sessionID]) continue
                  input.setStore("question", sessionID, [])
                }
                for (const [sessionID, questions] of Object.entries(grouped)) {
                  input.setStore(
                    "question",
                    sessionID,
                    reconcile(
                      questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
                      { key: "id" },
                    ),
                  )
                }
              }),
            )
          }),
        ),
      () => Promise.resolve(input.loadSessions(input.directory)),
      input.mcp && (() => input.queryClient.fetchQuery(loadMcpQuery(input.scope, input.directory, input.sdk))),
      () =>
        input.queryClient.fetchQuery(loadProvidersQuery(input.scope, input.directory, input.sdk)).catch((err) => {
          const project = getFilename(input.directory)
          showToast({
            title: input.translate("toast.project.reloadFailed.title", { project }),
            description: formatServerError(err, input.translate),
          })
        }),
    ].filter(Boolean) as (() => Promise<any>)[]

    await waitForPaint()
    const slowErrs = errors(await runAll(slow))
    if (slowErrs.length > 0) {
      console.error("Failed to finish bootstrap instance", slowErrs[0])
      const project = getFilename(input.directory)
      const description = formatServerError(slowErrs[0], input.translate)
      showToast({
        title: input.translate("toast.project.reloadFailed.title", { project }),
        description,
      })
      // Resolve any pending worktree waiters so submission fails fast instead of
      // hanging until the 5-minute timeout. Without this, sending a message in a
      // newly-created workspace produces no output because submit.ts waits on a
      // "ready" signal that was never sent.
      WorktreeState.failed(input.scope, input.directory, description)
    }

    if (loading && slowErrs.length === 0) {
      input.setStore("status", "complete")
      // Signal that the directory is bootstrapped so message submission in a
      // newly-created workspace can proceed instead of waiting on the timeout.
      WorktreeState.ready(input.scope, input.directory)
    }
  })()
}
