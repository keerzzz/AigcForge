import { CanonicalMessages } from "./global-sync/canonical-messages"
import { batch, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@aigcfroge/core/util/binary"
import { retry } from "@aigcfroge/core/util/retry"
import {
  clearSessionPrefetch,
  getSessionPrefetch,
  getSessionPrefetchPromise,
  setSessionPrefetch,
} from "./global-sync/session-prefetch"
import type { Message, Part, SessionTaskInfo } from "@aigcfroge/sdk/v2/client"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { SESSION_CACHE_LIMIT, dropSessionCaches, pickSessionCacheEvictions } from "./global-sync/session-cache"
import { diffs as list, message as clean } from "@/utils/diffs"
import { type createServerSdkContext } from "./server-sdk"
import { type createServerSyncContextInner } from "./server-sync"
import { directoryKey, mergeSessionReview } from "./global-sync/utils"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])

function sortParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id))
}

function runInflight(map: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
  const pending = map.get(key)
  if (pending) return pending
  const promise = task().finally(() => {
    if (map.get(key) === promise) map.delete(key)
  })
  map.set(key, promise)
  return promise
}

const keyFor = (directory: string, id: string) => `${directory}\n${id}`

type TaskReadSource = { directory: string; signal?: AbortSignal }

// Request metadata only; ServerSync's session_task remains the sole data store.
export function createTaskReadback(input: {
  get: (source: TaskReadSource & { sessionID: string }) => Promise<SessionTaskInfo[]>
  list: (source: TaskReadSource) => Promise<SessionTaskInfo[]>
  keys: () => string[]
  write: (sessionID: string, tasks: SessionTaskInfo[] | undefined) => void
}) {
  const versions = new Map<string, { event: number; read: number }>()
  const directories = new Map<string, symbol>()
  const inflight = new Map<string, Promise<void>>()
  const dirty = new Set<string>()
  let eventEpoch = 0
  let readEpoch = 0
  let fullReadEpoch = 0
  let disposed = false

  const scope = (source: TaskReadSource) => {
    const directory = directoryKey(source.directory)
    const generation = directories.get(directory) ?? Symbol(directory)
    directories.set(directory, generation)
    return { ...source, directory, generation }
  }
  const begin = (source: TaskReadSource) => ({ ...scope(source), event: eventEpoch, read: ++readEpoch })
  const current = (request: ReturnType<typeof scope>) =>
    !disposed && !request.signal?.aborted && directories.get(request.directory) === request.generation

  const commit = (request: ReturnType<typeof begin>, sessionID: string, tasks: SessionTaskInfo[]) => {
    const version = versions.get(sessionID)
    if (!current(request) || request.read < fullReadEpoch) return
    if ((version?.event ?? 0) > request.event || (version?.read ?? 0) > request.read) return
    // Only successful reads advance the accepted-read epoch. An earlier result
    // can render while a newer read is pending, but cannot replace its success.
    versions.set(sessionID, { event: version?.event ?? 0, read: request.read })
    input.write(sessionID, tasks)
  }
  const invalidate = (sessionID: string) => {
    versions.set(sessionID, { event: ++eventEpoch, read: versions.get(sessionID)?.read ?? 0 })
  }
  const load = async (source: TaskReadSource & { sessionID: string }) => {
    if (disposed || source.signal?.aborted) return
    // A concurrent all-session snapshot must also clear cold, in-flight sessions.
    if (!versions.has(source.sessionID)) versions.set(source.sessionID, { event: 0, read: 0 })
    const request = begin(source)
    const tasks = await input.get(source)
    commit(request, source.sessionID, tasks)
  }
  const reset = () => {
    const active = directories.size > 0
    directories.clear()
    inflight.clear()
    dirty.clear()
    return active
  }

  return {
    load,
    async loadAll(source: TaskReadSource) {
      if (disposed || source.signal?.aborted) return
      const request = begin(source)
      const tasks = await input.list(source)
      if (!current(request) || request.read < fullReadEpoch) return
      // An empty global snapshot also excludes sessions not seen by this cache
      // yet, including rows that an older all-session read may return later.
      fullReadEpoch = request.read
      const grouped = new Map<string, SessionTaskInfo[]>()
      tasks.forEach((task) => {
        const list = grouped.get(task.sessionID) ?? []
        list.push(task)
        grouped.set(task.sessionID, list)
      })
      batch(() => {
        new Set([...input.keys(), ...versions.keys(), ...grouped.keys()]).forEach((sessionID) => {
          // Keep an empty-list tombstone; absence is a successful snapshot too.
          commit(request, sessionID, grouped.get(sessionID) ?? [])
        })
      })
    },
    set: (sessionID: string, tasks: SessionTaskInfo[] | undefined) => {
      if (disposed || !sessionID) return
      invalidate(sessionID)
      dirty.forEach((key) => {
        if (key.endsWith(`\n${sessionID}`)) dirty.delete(key)
      })
      input.write(sessionID, tasks)
    },
    refresh(directory: string, sessionID: string) {
      if (disposed || !sessionID) return Promise.resolve()
      invalidate(sessionID)
      const request = scope({ directory })
      const key = keyFor(request.directory, sessionID)
      dirty.add(key)
      return runInflight(inflight, key, () =>
        // Batch same-turn invalidations; an event during a read owes one more
        // snapshot, not another parallel request or a row-revision comparison.
        Promise.resolve().then(async () => {
          while (current(request) && dirty.delete(key)) {
            await load({ directory, sessionID }).catch((error: unknown) => {
              // A superseded failure still owes the already queued refresh.
              if (current(request) && !dirty.has(key)) throw error
            })
          }
        }),
      )
    },
    disposeDirectory(directory: string) {
      const key = directoryKey(directory)
      directories.delete(key)
      inflight.forEach((_promise, bucket) => {
        if (!bucket.startsWith(`${key}\n`)) return
        dirty.delete(bucket)
        inflight.delete(bucket)
      })
    },
    reset,
    dispose() {
      disposed = true
      reset()
      versions.clear()
    },
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const isNotFound = (error: unknown) =>
  error instanceof Error &&
  typeof error.cause === "object" &&
  error.cause !== null &&
  (error.cause as { status?: unknown }).status === 404

function merge<T extends { id: string }>(a: readonly T[], b: readonly T[]) {
  const map = new Map(a.map((item) => [item.id, item] as const))
  for (const item of b) map.set(item.id, item)
  return [...map.values()].sort((x, y) => cmp(x.id, y.id))
}

type OptimisticStore = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

type OptimisticAddInput = {
  sessionID: string
  message: Message
  parts: Part[]
}

type OptimisticRemoveInput = {
  sessionID: string
  messageID: string
}

type OptimisticItem = {
  message: Message
  parts: Part[]
}

type MessagePage = {
  canonical?: boolean
  session: Message[]
  part: { id: string; part: Part[] }[]
  cursor?: string
  complete: boolean
}

const hasParts = (parts: Part[] | undefined, want: Part[]) => {
  if (!parts) return want.length === 0
  return want.every((part) => Binary.search(parts, part.id, (item) => item.id).found)
}

const mergeParts = (parts: Part[] | undefined, want: Part[]) => {
  if (!parts) return sortParts(want)
  const next = [...parts]
  let changed = false
  for (const part of want) {
    const result = Binary.search(next, part.id, (item) => item.id)
    if (result.found) continue
    next.splice(result.index, 0, part)
    changed = true
  }
  if (!changed) return parts
  return next
}

export function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
  if (items.length === 0) return { ...page, confirmed: [] as string[] }

  const session = [...page.session]
  const part = new Map(page.part.map((item) => [item.id, sortParts(item.part)]))
  const confirmed: string[] = []

  for (const item of items) {
    const result = Binary.search(session, item.message.id, (message) => message.id)
    const found = result.found
    if (!found) session.splice(result.index, 0, item.message)

    const current = part.get(item.message.id)
    if (found && (page.canonical || hasParts(current, item.parts))) {
      confirmed.push(item.message.id)
      continue
    }

    part.set(item.message.id, mergeParts(current, item.parts))
  }

  return {
    cursor: page.cursor,
    complete: page.complete,
    session,
    part: [...part.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, part]) => ({ id, part })),
    confirmed,
  }
}

export function applyOptimisticAdd(draft: OptimisticStore, input: OptimisticAddInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    messages.splice(result.index, 0, input.message)
  } else {
    draft.message[input.sessionID] = [input.message]
  }
  draft.part[input.message.id] = sortParts(input.parts)
}

export function applyOptimisticRemove(draft: OptimisticStore, input: OptimisticRemoveInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (result.found) messages.splice(result.index, 1)
  }
  delete draft.part[input.messageID]
}

function setOptimisticAdd(setStore: (...args: unknown[]) => void, input: OptimisticAddInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return [input.message]
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    const next = [...messages]
    next.splice(result.index, 0, input.message)
    return next
  })
  setStore("part", input.message.id, sortParts(input.parts))
}

function setOptimisticRemove(setStore: (...args: unknown[]) => void, input: OptimisticRemoveInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return messages
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (!result.found) return messages
    const next = [...messages]
    next.splice(result.index, 1)
    return next
  })
  setStore("part", (part: Record<string, Part[] | undefined>) => {
    if (!(input.messageID in part)) return part
    const next = { ...part }
    delete next[input.messageID]
    return next
  })
}

export function pickTarget(ownDirectory: string, requestedDirectory?: string): string {
  if (!requestedDirectory || requestedDirectory === ownDirectory) return ownDirectory
  return requestedDirectory
}

export const createDirSyncContext = (
  directory: string,
  serverSync: ReturnType<typeof createServerSyncContextInner>,
  serverSDK: ReturnType<typeof createServerSdkContext>,
) => {
  const client = serverSDK.createClient({ directory, throwOnError: true })

  type Child = ReturnType<(typeof serverSync)["child"]>
  type Setter = Child[1]

  const current = createMemo(() => serverSync.child(directory, { mcp: true }))
  const target = (requestedDirectory?: string) => {
    const effective = pickTarget(directory, requestedDirectory)
    if (effective === directory) return current()
    return serverSync.child(effective)
  }
  const absolute = (path: string) => (current()[0].path.directory + "/" + path).replace("//", "/")
  const initialMessagePageSize = 2
  const historyMessagePageSize = 200
  const inflight = new Map<string, Promise<void>>()
  const dirty = new Set<string>()
  const stream = CanonicalMessages.createStream()
  const inflightDiff = new Map<string, Promise<void>>()
  const optimistic = new Map<string, Map<string, OptimisticItem>>()
  const maxDirs = 30
  const seen = new Map<string, Set<string>>()
  const [meta, setMeta] = createStore({
    limit: {} as Record<string, number>,
    cursor: {} as Record<string, string | undefined>,
    complete: {} as Record<string, boolean>,
    loading: {} as Record<string, boolean>,
  })

  const getSession = (sessionID: string) => {
    const store = current()[0]
    const match = Binary.search(store.session, sessionID, (s) => s.id)
    if (match.found) return store.session[match.index]
    return undefined
  }

  const setOptimistic = (directory: string, sessionID: string, item: OptimisticItem) => {
    const key = keyFor(directory, sessionID)
    const list = optimistic.get(key)
    if (list) {
      list.set(item.message.id, { message: item.message, parts: sortParts(item.parts) })
      return
    }
    optimistic.set(key, new Map([[item.message.id, { message: item.message, parts: sortParts(item.parts) }]]))
  }

  const clearOptimistic = (directory: string, sessionID: string, messageID?: string) => {
    const key = keyFor(directory, sessionID)
    if (!messageID) {
      optimistic.delete(key)
      return
    }

    const list = optimistic.get(key)
    if (!list) return
    list.delete(messageID)
    if (list.size === 0) optimistic.delete(key)
  }

  const getOptimistic = (directory: string, sessionID: string) => [
    ...(optimistic.get(keyFor(directory, sessionID))?.values() ?? []),
  ]

  const seenFor = (directory: string) => {
    const existing = seen.get(directory)
    if (existing) {
      seen.delete(directory)
      seen.set(directory, existing)
      return existing
    }
    const created = new Set<string>()
    seen.set(directory, created)
    while (seen.size > maxDirs) {
      const first = seen.keys().next().value
      if (!first) break
      const stale = [...(seen.get(first) ?? [])]
      seen.delete(first)
      const [, setStore] = serverSync.child(first, { bootstrap: false })
      evict(first, setStore, stale)
    }
    return created
  }

  const clearMeta = (directory: string, sessionIDs: string[]) => {
    if (sessionIDs.length === 0) return
    for (const sessionID of sessionIDs) {
      clearOptimistic(directory, sessionID)
      stream.clear(sessionID)
      dirty.delete(keyFor(directory, sessionID))
    }
    setMeta(
      produce((draft) => {
        for (const sessionID of sessionIDs) {
          const key = keyFor(directory, sessionID)
          delete draft.limit[key]
          delete draft.cursor[key]
          delete draft.complete[key]
          delete draft.loading[key]
        }
      }),
    )
  }

  const evict = (directory: string, setStore: Setter, sessionIDs: string[]) => {
    if (sessionIDs.length === 0) return
    clearSessionPrefetch(serverSDK.scope, directory, sessionIDs)
    for (const sessionID of sessionIDs) {
      serverSync.task.set(sessionID, undefined)
    }
    setStore(
      produce((draft) => {
        dropSessionCaches(draft, sessionIDs)
      }),
    )
    clearMeta(directory, sessionIDs)
  }

  const touch = (directory: string, setStore: Setter, sessionID: string) => {
    const stale = pickSessionCacheEvictions({
      seen: seenFor(directory),
      keep: sessionID,
      limit: SESSION_CACHE_LIMIT,
    })
    evict(directory, setStore, stale)
  }

  const fetchMessages = async (input: {
    client: typeof client
    sessionID: string
    limit: number
    before?: string
    through?: string
  }) => {
    const info =
      current()[0].session.find((item) => item.id === input.sessionID) ??
      (await input.client.session.get({ sessionID: input.sessionID })).data
    const capabilities = await serverSync.capabilities()
    if (info && capabilities.canonicalSessionModes.includes(info.mode ?? ProductMode.Default))
      return CanonicalMessages.page(input.client, info, input.limit, input.before, input.through)
    const messages = await retry(() =>
      input.client.session.messages({ sessionID: input.sessionID, limit: input.limit, before: input.before }),
    )
    const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
    const session = items.map((x) => clean(x.info)).sort((a, b) => cmp(a.id, b.id))
    const part = items.map((message) => ({ id: message.info.id, part: sortParts(message.parts) }))
    const cursor = messages.response.headers.get("x-next-cursor") ?? undefined
    return {
      session,
      part,
      cursor,
      complete: !cursor,
    }
  }

  const tracked = (directory: string, sessionID: string) => seen.get(directory)?.has(sessionID) ?? false

  const loadMessages = async (input: {
    directory: string
    client: typeof client
    setStore: Setter
    sessionID: string
    limit: number
    before?: string
    mode?: "replace" | "prepend"
  }) => {
    const key = keyFor(input.directory, input.sessionID)
    if (meta.loading[key]) return

    setMeta("loading", key, true)
    const [cachedStore] = serverSync.child(input.directory, { bootstrap: false })
    await fetchMessages({
      ...input,
      through: input.mode !== "prepend" ? cachedStore.message[input.sessionID]?.[0]?.id : undefined,
    })
      .then((page) => {
        if (!tracked(input.directory, input.sessionID)) return
        const next = mergeOptimisticPage(page, getOptimistic(input.directory, input.sessionID))
        for (const messageID of next.confirmed) {
          clearOptimistic(input.directory, input.sessionID, messageID)
        }
        const [store] = serverSync.child(input.directory, { bootstrap: false })
        const cached = input.mode === "prepend" ? (store.message[input.sessionID] ?? []) : []
        const message = input.mode === "prepend" ? merge(cached, next.session) : next.session
        batch(() => {
          input.setStore("message", input.sessionID, reconcile(message, { key: "id" }))
          for (const p of next.part) {
            const filtered = p.part.filter((x) => !SKIP_PARTS.has(x.type))
            input.setStore("part", p.id, "canonical" in page && page.canonical ? stream.snapshot(filtered) : filtered)
          }
          setMeta("limit", key, message.length)
          setMeta("cursor", key, next.cursor)
          setMeta("complete", key, next.complete)
          setSessionPrefetch({
            scope: serverSDK.scope,
            directory: input.directory,
            sessionID: input.sessionID,
            limit: message.length,
            cursor: next.cursor,
            complete: next.complete,
          })
        })
      })
      .catch((error) => {
        if (isNotFound(error) && !tracked(input.directory, input.sessionID)) return
        throw error
      })
      .finally(() => {
        setMeta(
          produce((draft) => {
            if (!tracked(input.directory, input.sessionID)) {
              delete draft.loading[key]
              return
            }
            draft.loading[key] = false
          }),
        )
      })
  }

  const result = {
    get data() {
      return current()[0]
    },
    get set(): Setter {
      return current()[1]
    },
    get status() {
      return current()[0].status
    },
    get ready() {
      return current()[0].status !== "loading"
    },
    get project() {
      const store = current()[0]
      const match = Binary.search(serverSync.data.project, store.project, (p) => p.id)
      if (match.found) return serverSync.data.project[match.index]
      return undefined
    },
    session: {
      get: getSession,
      optimistic: {
        add(input: { directory?: string; sessionID: string; message: Message; parts: Part[] }) {
          const _directory = input.directory ?? directory
          const [, setStore] = target(input.directory)
          setOptimistic(_directory, input.sessionID, { message: input.message, parts: input.parts })
          setOptimisticAdd(setStore as (...args: unknown[]) => void, input)
        },
        remove(input: { directory?: string; sessionID: string; messageID: string }) {
          const _directory = input.directory ?? directory
          const [, setStore] = target(input.directory)
          clearOptimistic(_directory, input.sessionID, input.messageID)
          setOptimisticRemove(setStore as (...args: unknown[]) => void, input)
        },
      },
      addOptimisticMessage(input: {
        sessionID: string
        messageID: string
        parts: Part[]
        agent: string
        model: { providerID: string; modelID: string }
        variant?: string
      }) {
        const message: Message = {
          id: input.messageID,
          sessionID: input.sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: input.agent,
          model: { ...input.model, variant: input.variant },
        }
        const [, setStore] = target()
        setOptimistic(directory, input.sessionID, { message, parts: input.parts })
        setOptimisticAdd(setStore as (...args: unknown[]) => void, {
          sessionID: input.sessionID,
          message,
          parts: input.parts,
        })
      },
      async sync(sessionID: string, opts?: { force?: boolean }) {
        const [store, setStore] = serverSync.child(directory)
        const key = keyFor(directory, sessionID)

        touch(directory, setStore, sessionID)

        const seeded = getSessionPrefetch(serverSDK.scope, directory, sessionID)
        if (seeded && store.message[sessionID] !== undefined && meta.limit[key] === undefined) {
          batch(() => {
            setMeta("limit", key, seeded.limit)
            setMeta("cursor", key, seeded.cursor)
            setMeta("complete", key, seeded.complete)
            setMeta("loading", key, false)
          })
        }

        if (opts?.force) dirty.add(key)
        do {
          await runInflight(inflight, key, async () => {
            const pending = getSessionPrefetchPromise(serverSDK.scope, directory, sessionID)
            if (pending) {
              await pending
              const seeded = getSessionPrefetch(serverSDK.scope, directory, sessionID)
              if (seeded && store.message[sessionID] !== undefined && meta.limit[key] === undefined) {
                batch(() => {
                  setMeta("limit", key, seeded.limit)
                  setMeta("cursor", key, seeded.cursor)
                  setMeta("complete", key, seeded.complete)
                  setMeta("loading", key, false)
                })
              }
            }

            const hasSession = Binary.search(store.session, sessionID, (s) => s.id).found
            const cached = store.message[sessionID] !== undefined && meta.limit[key] !== undefined
            const force = dirty.delete(key)
            if (cached && hasSession && !force) return

            const limit = meta.limit[key] ?? initialMessagePageSize
            const sessionReq =
              hasSession && !force
                ? Promise.resolve()
                : retry(() => client.session.get({ sessionID }))
                    .then((session) => {
                      if (!tracked(directory, sessionID)) return
                      const data = session.data
                      if (data?.id !== sessionID) return
                      // Archived sessions stay out of the session list (aligned
                      // with upstream: the list is driven only by the list API).
                      // Messages still load below so archived history stays
                      // readable, but the session must not resurrect into the
                      // sidebar or drift sessionTotal.
                      if (data.time?.archived) return
                      setStore(
                        "session",
                        produce((draft) => {
                          const match = Binary.search(draft, sessionID, (s) => s.id)
                          if (match.found) {
                            draft[match.index] = mergeSessionReview(draft[match.index], data)
                            return
                          }
                          draft.splice(match.index, 0, mergeSessionReview(undefined, data))
                        }),
                      )
                    })
                    .catch((error) => {
                      if (isNotFound(error) && !tracked(directory, sessionID)) return
                      throw error
                    })

            const messagesReq =
              cached && !force
                ? Promise.resolve()
                : loadMessages({
                    directory,
                    client,
                    setStore,
                    sessionID,
                    limit,
                  })

            await Promise.all([sessionReq, messagesReq])
          }).catch((error: unknown) => {
            // An event received during a failed read still owes a fresh snapshot.
            if (!tracked(directory, sessionID) || !dirty.has(key)) throw error
          })
        } while (tracked(directory, sessionID) && (dirty.has(key) || inflight.has(key)))
      },
      async diff(sessionID: string, opts?: { force?: boolean }) {
        const [store, setStore] = serverSync.child(directory)
        touch(directory, setStore, sessionID)
        if (store.session_diff[sessionID] !== undefined && !opts?.force) return

        const key = keyFor(directory, sessionID)
        return runInflight(inflightDiff, key, () =>
          retry(() => client.session.diff({ sessionID })).then((diff) => {
            if (!tracked(directory, sessionID)) return
            setStore("session_diff", sessionID, reconcile(list(diff.data), { key: "file" }))
          }),
        )
      },
      history: {
        more(sessionID: string) {
          const store = current()[0]
          const key = keyFor(directory, sessionID)
          if (store.message[sessionID] === undefined) return false
          if (meta.limit[key] === undefined) return false
          if (meta.complete[key]) return false
          return !!meta.cursor[key]
        },
        loading(sessionID: string) {
          const key = keyFor(directory, sessionID)
          return meta.loading[key] ?? false
        },
        async loadMore(sessionID: string, count?: number) {
          const [, setStore] = serverSync.child(directory)
          touch(directory, setStore, sessionID)
          const key = keyFor(directory, sessionID)
          const step = count ?? historyMessagePageSize
          if (meta.loading[key]) return
          if (meta.complete[key]) return
          const before = meta.cursor[key]
          if (!before) return

          await runInflight(inflight, key, () =>
            loadMessages({
              directory,
              client,
              setStore,
              sessionID,
              limit: step,
              before,
              mode: "prepend",
            }),
          )
        },
      },
      evict(sessionID: string, _directory = directory) {
        const [, setStore] = serverSync.child(_directory)
        seenFor(_directory).delete(sessionID)
        evict(_directory, setStore, [sessionID])
      },
      fetch: async (count = 10) => {
        const [store, setStore] = serverSync.child(directory)
        setStore("limit", (x) => x + count)
        await client.session.list().then((x) => {
          const current = new Map(store.session.map((session) => [session.id, session]))
          const sessions = (x.data ?? [])
            .filter((s) => !!s?.id)
            .sort((a, b) => cmp(a.id, b.id))
            .slice(0, store.limit)
            .map((session) => mergeSessionReview(current.get(session.id), session))
          setStore("session", reconcile(sessions, { key: "id" }))
        })
      },
      more: createMemo(() => current()[0].session.length >= current()[0].limit),
      archive: async (sessionID: string) => {
        const [, setStore] = serverSync.child(directory)
        await client.session.update({ sessionID, time: { archived: Date.now() } })
        setStore(
          produce((draft) => {
            const match = Binary.search(draft.session, sessionID, (s) => s.id)
            if (match.found) draft.session.splice(match.index, 1)
          }),
        )
      },
    },
    mcp: {
      toggle: (name: string) => serverSync.mcp.toggle(directory, name),
    },
    absolute,
    get directory() {
      return current()[0].path.directory
    },
  }
  onCleanup(() => {
    seen.forEach((sessions) => sessions.forEach((sessionID) => stream.clear(sessionID)))
    seen.clear()
    dirty.clear()
  })
  onCleanup(
    serverSDK.event.listen((event) => {
      if (directoryKey(event.name) !== directoryKey(directory)) return
      const details = event.details
      if (!details.type.startsWith("session.next.") || !details.properties || !("sessionID" in details.properties))
        return
      const sessionID = details.properties.sessionID
      if (typeof sessionID !== "string" || !tracked(directory, sessionID)) return
      const [store, setStore] = current()
      const live = stream.update(details, store.part)
      if (live?.parts) setStore("part", live.messageID, live.parts)
      if (details.type.endsWith(".delta") && (!live || live.present)) return
      void result.session
        .sync(sessionID, { force: true })
        .catch(() => console.error("Failed to refresh canonical session messages"))
    }),
  )
  return result
}
