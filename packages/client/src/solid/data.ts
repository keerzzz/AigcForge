// Client data layer: apply server events and cache API reads into a Solid store.
// Prefer straightforward projection. Invalidated reads revalidate serially so an older
// response cannot commit after its replacement. Reconnect invalidates cached reads;
// active UI owners decide what to sync again.

import type {
  AgentInfo,
  CommandInfo,
  ConfigEntry,
  SessionFormCancelInput,
  FormInfo,
  SessionFormReplyInput,
  IntegrationInfo,
  LocationRef,
  LocationGetOutput,
  McpResource,
  McpServer,
  ModelInfo,
  ModelGroupRead,
  ModelRef,
  ModelSelection,
  PermissionSavedInfo,
  PermissionRequest,
  PermissionReplyInput,
  Project,
  ProviderInfo,
  ProviderDefinitionList,
  ProviderDiscoveryRead,
  ModelSourceConnectionRef,
  ReferenceInfo,
  SessionMessageInfo,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionInfo,
  SessionIdentityIdentity,
  SessionExecutorPreference,
  SessionTaskInfo,
  SessionTaskOperationInfo,
  SessionTaskOperationRequest,
  SessionGoalInfo,
  SessionCommunicationMessage,
  SessionCommunicationCapability,
  ScheduleRule,
  ScheduleOccurrence,
  DelegationLegacyState,
  PersonalMemoryInfo,
  MemoryConfirmInput,
  MemoryRejectInput,
  MemoryEditInput,
  MemoryRemoveInput,
  WorkflowAssetWorkflowStatusResponse,
  SessionInstanceCacheDiagnostics,
  WorkArtifactApplyInput,
  MetaAgentRead,
  MetaAgentMemoryRecord,
  MetaAgentFactCategory,
  DelegationResultInput,
  SessionInstanceSessionInstanceSessionTaskGetInput,
  SessionInstanceSessionInstanceSessionTaskCreateInput,
  SessionInstanceSessionInstanceSessionTaskPatchInput,
  SessionInstanceSessionInstanceSessionTaskDeleteInput,
  SessionInboxInfo,
  SessionInboxCompaction,
  ShellInfo,
  SkillInfo,
  VcsInfo,
  AigcForgeEvent,
  AigcForgeClient,
  SessionGoalSetInput,
  SessionGoalEditInput,
  SessionGoalPauseInput,
  SessionGoalResumeInput,
  SessionGoalCancelInput,
  SessionGoalConfirmInput,
  SessionCommunicationSendInput,
  SessionCommunicationReplyInput,
  ScheduleCreateInput,
  ScheduleEditInput,
  SchedulePauseInput,
  ScheduleResumeInput,
  ScheduleCancelRuleInput,
  ScheduleRunOnceInput,
  ScheduleCancelRunInput,
  RequestOptions,
  WebSearchProvider,
} from "../promise"
import { Worktree } from "@aigcfroge/schema/worktree"
import { SessionID } from "@aigcfroge/schema/session-id"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { SessionMessage } from "@aigcfroge/schema/session-message"
import { Delegation } from "@aigcfroge/schema/delegation"
import {
  ClientError,
  isFormAlreadySettledError,
  isFormNotFoundError,
  isPermissionNotFoundError,
  type SessionPromptInput,
} from "../promise"
import { createStore, produce, reconcile, unwrap } from "solid-js/store"
import type { SessionInbox } from "@aigcfroge/schema/session-inbox"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Option, Schema } from "effect"

export type DataSessionStatus = "idle" | "running"
/**
 * Where a pending user prompt stands relative to the runner: `starting` is promoted at the next idle boundary,
 * `steering` waits for the next step boundary of an execution that already delivered input, `stranded` outlived an
 * execution that ended without delivering it, and `queued` waits for every steer to drain.
 */
export type DataPendingStatus = "starting" | "steering" | "stranded" | "queued"
type AigcForgeEventMap = { [Type in AigcForgeEvent["type"]]: Extract<AigcForgeEvent, { type: Type }> }

export type CreateDataInput = {
  readonly api: () => AigcForgeClient
  readonly directory: string
  /** Raw-message window used for an initial transcript read. Older pages retain their normal size. */
  readonly initialMessageLimit?: () => number
  readonly event: {
    readonly on: <Type extends AigcForgeEvent["type"]>(
      type: Type,
      handler: (event: AigcForgeEventMap[Type]) => void,
    ) => () => void
    readonly listen: (handler: (event: { name: AigcForgeEvent["type"]; details: AigcForgeEvent }) => void) => () => void
  }
  readonly connection?: {
    readonly status: () => "connected" | "connecting" | "reconnecting"
  }
  /** Receives failed event-driven reads. Explicit reads still reject to their caller. */
  readonly onError?: (error: unknown) => void
}

const messageIDFromEvent = (eventID: string) => eventID.replace(/^evt_/, "msg_")
const messagePageLimit = 20
// Trailing window for event bursts that each ask for the same refetch.
export const settleMs = 150

// Global MCP elicitations temporarily use "global" instead of a real session ID, so the
// server cannot recover their Location when settling them. Preserve the event Location
// until MCP elicitations carry session ownership.
export type FormWithLocation = FormInfo & { readonly location?: LocationRef }
type ShellWithLocation = ShellInfo & { readonly location: LocationRef }

type LocationData = {
  info?: LocationGetOutput
  vcs?: VcsInfo
  agent?: AgentInfo[]
  command?: CommandInfo[]
  config?: ConfigEntry[]
  integration?: IntegrationInfo[]
  mcpServer?: McpServer[]
  mcpResource?: McpResource[]
  model?: ModelInfo[]
  modelGroup?: ModelGroupRead
  provider?: ProviderInfo[]
  providerDefinition?: ProviderDefinitionList
  providerDiscovery?: Record<string, ProviderDiscoveryRead>
  reference?: ReferenceInfo[]
  websearch?: WebSearchProvider[]
  // Currently running shell commands for this location, keyed by shell id. Entries are removed
  // once the command exits or is deleted, so this only ever holds in-flight shells.
  shell?: Record<string, ShellWithLocation>
  skill?: SkillInfo[]
  hub?: { items?: SessionTaskInfo[] }
}

type Store = {
  session: {
    info: Record<string, SessionInfo>
    removed: Record<string, boolean>
    // Family index keyed by a family's root (or furthest-known-ancestor when the
    // true root is not yet loaded). The value is a flat deduplicated list of every
    // session ID in that family, including the key itself once its info arrives.
    family: Record<string, string[]>
    active: Record<string, DataSessionStatus>
    message: Record<string, SessionMessageInfo[]>
    messageCursor: Record<string, string | undefined>
    messageLoading: Record<string, boolean>
    pending: Record<string, SessionInboxInfo[]>
    task: Record<string, { items?: SessionTaskInfo[] }>
    operation: Record<string, { items: Record<string, SessionTaskOperationInfo>; listed: boolean }>
    goal: Record<string, { items: Record<string, SessionGoalInfo>; listed: boolean }>
    communication: Record<
      string,
      {
        items: Record<string, SessionCommunicationMessage>
        listed: boolean
        next?: string
        capability?: SessionCommunicationCapability
        version: number
        sequence: Record<string, number>
      }
    >
    schedule: Record<
      string,
      {
        rules: Record<string, ScheduleRule>
        listed: boolean
        occurrences: Record<string, ScheduleOccurrence>
        runsListed: Record<string, boolean>
      }
    >
    delegation: Record<string, { items?: DelegationLegacyState[] }>
    workflow: Record<string, { value?: WorkflowAssetWorkflowStatusResponse }>
    cache: Record<string, { value?: SessionInstanceCacheDiagnostics }>
    identity: Record<string, { value?: SessionIdentityIdentity }>
    meta: Record<string, { value?: MetaAgentRead }>
    facts: Record<string, { items?: MetaAgentMemoryRecord[] }>
    permission: Record<string, PermissionRequest[]>
    // Pending forms keyed by owner: a session ID or the temporary "global" elicitation sentinel.
    form: Record<string, FormWithLocation[]>
  }
  project: {
    info: Record<string, Project>
    permission: Record<string, PermissionSavedInfo[]>
  }
  location: Record<string, LocationData>
  memory: { items?: PersonalMemoryInfo[]; pending?: PersonalMemoryInfo[] }
}

export function locationKey(location: LocationRef) {
  return JSON.stringify([location.directory, location.workspaceID])
}

const decodeLocationKey = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.NullOr(Schema.String)])),
)

const decodeDelegationReceipt = Schema.decodeUnknownOption(
  Schema.Struct({ receipt: Delegation.Receipt, status: Delegation.DeliveryStatus }),
)

function locationQuery(ref: LocationRef) {
  return { directory: ref.directory }
}

function formRequestOptions(sessionID: string, ref?: LocationRef) {
  if (sessionID !== "global" || !ref) return undefined
  return {
    headers: {
      "x-aigcfroge-directory": encodeURIComponent(ref.directory),
    },
  }
}

function createSync() {
  // `started` is false while a reload waits for the load it replaces. Invalidations that land in
  // that window are already covered, since the reload has not read anything yet.
  type Pending = { promise: Promise<void>; invalidated: boolean; started: boolean }
  const state = new Map<string, true | Pending>()
  const start = (key: string, load: (current: () => boolean) => Promise<void>, wait?: Promise<void>) => {
    const entry: Pending = { promise: Promise.resolve(), invalidated: false, started: !wait }
    state.set(key, entry)
    const run = () => {
      entry.started = true
      return load(() => state.get(key) === entry && !entry.invalidated)
    }
    entry.promise = (wait ? wait.catch(() => undefined).then(run) : run())
      .then(() => {
        if (state.get(key) === entry && !entry.invalidated) state.set(key, true)
      })
      .finally(() => {
        if (state.get(key) === entry) state.delete(key)
      })
    return entry.promise
  }
  return {
    run(key: string, load: (current: () => boolean) => Promise<void>) {
      const active = state.get(key)
      if (active === true) return Promise.resolve()
      if (!active) return start(key, load)
      if (!active.invalidated) return active.promise
      return start(key, load, active.promise)
    },
    complete(key: string) {
      if (state.has(key)) return
      state.set(key, true)
    },
    has(key: string) {
      return state.has(key)
    },
    pending(key: string) {
      const active = state.get(key)
      return active !== undefined && active !== true
    },
    wait(key: string) {
      const active = state.get(key)
      return active !== undefined && active !== true ? active.promise : undefined
    },
    forget(key: string) {
      state.delete(key)
    },
    invalidate(key?: string) {
      if (key) {
        const active = state.get(key)
        if (active === true) state.delete(key)
        if (active !== undefined && active !== true && active.started) active.invalidated = true
        return
      }
      state.forEach((active, current) => {
        if (active === true) state.delete(current)
        if (active !== true && active.started) active.invalidated = true
      })
    },
  }
}

export function createData(config: CreateDataInput) {
  const api = config.api
  let disposed = false
  onCleanup(() => (disposed = true))

  function refresh(load: () => Promise<unknown>) {
    if (disposed || (config.connection && config.connection.status() !== "connected")) return
    void load().catch((error) => {
      if (disposed || (config.connection && config.connection.status() !== "connected")) return
      if (config.onError) return config.onError(error)
      console.error("Failed to refresh client data", error)
    })
  }

  // Runs `load` once a burst of same-key events goes quiet, so N events cost one refetch.
  const settling = new Map<string, ReturnType<typeof setTimeout>>()
  onCleanup(() => settling.forEach((timer) => clearTimeout(timer)))
  function settle(key: string, load: () => Promise<unknown>) {
    clearTimeout(settling.get(key))
    settling.set(
      key,
      setTimeout(() => {
        settling.delete(key)
        refresh(load)
      }, settleMs),
    )
  }

  const [store, setStore] = createStore<Store>({
    session: {
      info: {},
      removed: {},
      family: {},
      active: {},
      message: {},
      messageCursor: {},
      messageLoading: {},
      pending: {},
      task: {},
      operation: {},
      goal: {},
      communication: {},
      schedule: {},
      delegation: {},
      workflow: {},
      cache: {},
      identity: {},
      meta: {},
      facts: {},
      permission: {},
      form: {},
    },
    project: {
      info: {},
      permission: {},
    },
    location: {},
    memory: {},
  })

  const [defaultLocation, setDefaultLocation] = createSignal<LocationRef>({ directory: config.directory })
  const sessions = createMemo(() =>
    Object.values(store.session.info).toSorted((a, b) => b.time.updated - a.time.updated),
  )
  const messageIndex = new Map<string, Map<string, number>>()
  const sync = createSync()
  const taskKey = (sessionID: string) => `session.task:${sessionID}`
  const operationOwners = new Map<
    string,
    { client: AigcForgeClient; location: string; keys: Set<string>; tail: Promise<void> }
  >()
  const delegationOwners = new Map<string, { client: AigcForgeClient; location: string }>()
  const goalOwners = new Map<
    string,
    { client: AigcForgeClient; location: string; keys: Set<string>; tail: Promise<void> }
  >()
  const communicationOwners = new Map<
    string,
    { client: AigcForgeClient; location: string; keys: Set<string>; tail: Promise<void> }
  >()
  const scheduleOwners = new Map<
    string,
    { client: AigcForgeClient; location: string; keys: Set<string>; tail: Promise<void> }
  >()
  const workflowOwners = new Map<string, { client: AigcForgeClient; directory: string }>()
  const cacheOwners = new Map<string, { client: AigcForgeClient; directory: string }>()
  const identityOwners = new Map<
    string,
    { client: AigcForgeClient; location: string; agent?: string; selected?: { agent: string; eventID: string } }
  >()
  const identityConnection = { client: api(), status: config.connection?.status() }
  const metaOwners = new Map<string, { client: AigcForgeClient; directory: string }>()
  const factOwners = new Map<string, { client: AigcForgeClient; directory: string; query: string }>()
  const hubOwners = new Map<string, AigcForgeClient>()
  const discoveryOwners = new Map<
    string,
    {
      client: AigcForgeClient
      location: LocationRef
      canonical?: string
      slot: string
      providerID: string
      connection?: ModelSourceConnectionRef
    }
  >()
  let memoryOwner: AigcForgeClient | undefined
  let activeUpdates: Map<string, DataSessionStatus | undefined> | undefined
  const pendingUpdates = new Map<string, Map<string, SessionInboxInfo | SessionInbox.Delivery | undefined>>()

  function taskCache(sessionID: string) {
    if (disposed) return undefined
    if (store.session.task[sessionID]) return store.session.task[sessionID]
    // This bucket's identity owns pending reads and mutations until deletion or eviction revokes it.
    setStore("session", "task", sessionID, {})
    return store.session.task[sessionID]
  }

  function taskInput<Input extends SessionInstanceSessionInstanceSessionTaskGetInput>(input: Input) {
    const location = store.session.info[input.sessionID]?.location
    return {
      ...input,
      directory: input.directory ?? location?.directory ?? defaultLocation().directory,
    }
  }

  function invalidateTaskMutation(sessionID: string, cache: ReturnType<typeof taskCache>) {
    if (disposed || !cache || store.session.task[sessionID] !== cache) return
    result.session.task.invalidate(sessionID)
  }

  function operationCache(sessionID: string) {
    if (disposed) return undefined
    const client = api()
    const location: LocationRef = store.session.info[sessionID]?.location ?? defaultLocation()
    const previous = operationOwners.get(sessionID)
    if (previous?.client !== client || previous.location !== locationKey(location)) {
      previous?.keys.forEach((key) => sync.forget(key))
      operationOwners.set(sessionID, {
        client,
        location: locationKey(location),
        keys: new Set(),
        tail: Promise.resolve(),
      })
      setStore("session", "operation", sessionID, reconcile({ items: {}, listed: false }))
    }
    const owner = operationOwners.get(sessionID)
    const cache = store.session.operation[sessionID]
    if (!owner || !cache) return undefined
    return { owner, cache, location }
  }

  function readOperation(sessionID: string, operationID?: string) {
    const lease = operationCache(sessionID)
    if (!lease) return Promise.resolve()
    const key = `session.task.operation:${sessionID}:${operationID ?? "list"}`
    lease.owner.keys.add(key)
    return sync.run(key, (current) => {
      // List and detail reads share one serial lane, so delayed HTTP snapshots cannot replace newer facts.
      const read = lease.owner.tail
        .catch(() => undefined)
        .then(async () => {
          const owned = () =>
            !disposed &&
            current() &&
            operationOwners.get(sessionID) === lease.owner &&
            store.session.operation[sessionID] === lease.cache &&
            api() === lease.owner.client &&
            (!config.connection || config.connection.status() === "connected") &&
            locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) === lease.owner.location
          if (!owned()) return
          const input = { sessionID, directory: lease.location.directory, workspace: lease.location.workspaceID }
          const tasks = lease.owner.client["session-instance"].session.instance.session.task
          const values = operationID
            ? [await tasks.operation({ ...input, operationID })]
            : await tasks.operations(input)
          if (!owned()) return
          if (operationID) {
            values.forEach((value) =>
              setStore("session", "operation", sessionID, "items", value.operationID, reconcile(value)),
            )
            return
          }
          batch(() => {
            setStore(
              "session",
              "operation",
              sessionID,
              "items",
              reconcile(Object.fromEntries(values.map((value) => [value.operationID, value]))),
            )
            setStore("session", "operation", sessionID, "listed", true)
          })
        })
      lease.owner.tail = read
      return read
    })
  }

  function rememberOperation(
    sessionID: string,
    value: SessionTaskOperationInfo,
    lease: ReturnType<typeof operationCache>,
  ) {
    if (
      !lease ||
      disposed ||
      operationOwners.get(sessionID) !== lease.owner ||
      api() !== lease.owner.client ||
      locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== lease.owner.location
    )
      return
    result.session.task.operation.invalidate(sessionID)
    setStore("session", "operation", sessionID, "items", value.operationID, reconcile(value))
    if (value.phase === "cancelled") removeOperationPermissions(sessionID, value.operationID)
  }

  function goalCache(sessionID: string) {
    if (disposed) return
    const client = api()
    const location: LocationRef = store.session.info[sessionID]?.location ?? defaultLocation()
    const previous = goalOwners.get(sessionID)
    if (previous?.client !== client || previous.location !== locationKey(location)) {
      previous?.keys.forEach((key) => sync.forget(key))
      goalOwners.set(sessionID, { client, location: locationKey(location), keys: new Set(), tail: Promise.resolve() })
      setStore("session", "goal", sessionID, reconcile({ items: {}, listed: false }))
    }
    const owner = goalOwners.get(sessionID)
    const cache = store.session.goal[sessionID]
    if (!owner || !cache) return
    return { owner, cache, location }
  }

  function readGoal(sessionID: string, goalID?: string) {
    const lease = goalCache(sessionID)
    if (!lease) return Promise.resolve()
    const key = `session.goal:${sessionID}:${goalID ?? "list"}`
    lease.owner.keys.add(key)
    return sync.run(key, (current) => {
      const read = lease.owner.tail
        .catch(() => undefined)
        .then(async () => {
          const owned = () =>
            !disposed &&
            current() &&
            goalOwners.get(sessionID) === lease.owner &&
            store.session.goal[sessionID] === lease.cache &&
            api() === lease.owner.client &&
            (!config.connection || config.connection.status() === "connected") &&
            locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) === lease.owner.location
          if (!owned()) return
          const before = structuredClone(unwrap(lease.cache.items))
          const input = { sessionID, directory: lease.location.directory, workspace: lease.location.workspaceID }
          const goals = lease.owner.client.sessionGoal
          const values = goalID
            ? [await goals.get({ ...input, goalID })].filter((value): value is SessionGoalInfo => value !== null)
            : await goals.list(input)
          if (!owned()) return
          // Goals have retained terminal records. A full SSE snapshot observed during the read wins by identity.
          const items = {
            ...unwrap(lease.cache.items),
            ...Object.fromEntries(
              values.map((value) => [
                value.id,
                JSON.stringify(before[value.id]) !== JSON.stringify(lease.cache.items[value.id]) &&
                lease.cache.items[value.id]
                  ? unwrap(lease.cache.items[value.id])
                  : value,
              ]),
            ),
          }
          batch(() => {
            setStore("session", "goal", sessionID, "items", reconcile(items))
            if (!goalID) setStore("session", "goal", sessionID, "listed", true)
          })
        })
      lease.owner.tail = read
      return read
    })
  }

  function rememberGoal(
    sessionID: string,
    value: SessionGoalInfo,
    lease: ReturnType<typeof goalCache>,
    before?: Store["session"]["goal"][string]["items"],
  ) {
    if (
      !lease ||
      disposed ||
      goalOwners.get(sessionID) !== lease.owner ||
      api() !== lease.owner.client ||
      store.session.goal[sessionID] !== lease.cache ||
      locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== lease.owner.location
    )
      return
    const previous = lease.cache.items[value.id]
    if (previous && (previous.revision > value.revision || previous.updatedAt > value.updatedAt)) return
    if (
      before &&
      previous &&
      JSON.stringify(before[value.id]) !== JSON.stringify(previous) &&
      previous.revision >= value.revision &&
      previous.updatedAt >= value.updatedAt
    )
      return
    setStore("session", "goal", sessionID, "items", value.id, reconcile(value))
  }

  function communicationCache(sessionID: string) {
    if (disposed || store.session.removed[sessionID]) return
    const client = api()
    const location: LocationRef = store.session.info[sessionID]?.location ?? defaultLocation()
    const previous = communicationOwners.get(sessionID)
    if (previous?.client !== client || previous.location !== locationKey(location)) {
      previous?.keys.forEach((key) => sync.forget(key))
      communicationOwners.set(sessionID, {
        client,
        location: locationKey(location),
        keys: new Set(),
        tail: Promise.resolve(),
      })
      setStore("session", "communication", sessionID, reconcile({ items: {}, listed: false, version: 0, sequence: {} }))
    }
    const owner = communicationOwners.get(sessionID)
    const cache = store.session.communication[sessionID]
    if (!owner || !cache) return
    return { owner, cache, location }
  }

  function readCommunication(sessionID: string, options?: { communicationID?: string; cursor?: string }) {
    const lease = communicationCache(sessionID)
    if (!lease) return Promise.resolve()
    const key = options?.communicationID
      ? `session.communication:${sessionID}:message:${options.communicationID}`
      : `session.communication:${sessionID}:page:${options?.cursor ?? "first"}`
    lease.owner.keys.add(key)
    return sync.run(key, (current) => {
      const read = lease.owner.tail
        .catch(() => undefined)
        .then(async () => {
          const owned = () =>
            !disposed &&
            current() &&
            communicationOwners.get(sessionID) === lease.owner &&
            store.session.communication[sessionID] === lease.cache &&
            api() === lease.owner.client &&
            (!config.connection || config.connection.status() === "connected") &&
            locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) === lease.owner.location
          if (!owned()) return
          const before = structuredClone(unwrap(lease.cache.items))
          const input = { sessionID, directory: lease.location.directory, workspace: lease.location.workspaceID }
          const communications = lease.owner.client.sessionCommunication
          const page = options?.communicationID
            ? {
                items: [await communications.read({ ...input, communicationID: options.communicationID })].filter(
                  (value): value is SessionCommunicationMessage => value !== null,
                ),
              }
            : await communications.list({ ...input, cursor: options?.cursor, limit: 20 })
          if (!owned()) return
          const items = {
            ...unwrap(lease.cache.items),
            ...Object.fromEntries(
              page.items.map((value) => [
                value.id,
                JSON.stringify(before[value.id]) !== JSON.stringify(lease.cache.items[value.id]) &&
                lease.cache.items[value.id]
                  ? unwrap(lease.cache.items[value.id])
                  : value,
              ]),
            ),
          }
          if (
            options?.communicationID &&
            !page.items.length &&
            JSON.stringify(before[options.communicationID]) ===
              JSON.stringify(lease.cache.items[options.communicationID])
          )
            delete items[options.communicationID]
          batch(() => {
            setStore("session", "communication", sessionID, "items", reconcile(items))
            if ("capability" in page) {
              setStore("session", "communication", sessionID, "capability", reconcile(page.capability))
              setStore("session", "communication", sessionID, "next", page.next)
              setStore("session", "communication", sessionID, "listed", true)
            }
          })
        })
      lease.owner.tail = read
      return read
    })
  }

  function rememberCommunication(
    sessionID: string,
    value: SessionCommunicationMessage,
    lease: ReturnType<typeof communicationCache>,
    before?: Store["session"]["communication"][string]["items"],
  ) {
    if (
      !lease ||
      disposed ||
      communicationOwners.get(sessionID) !== lease.owner ||
      api() !== lease.owner.client ||
      store.session.communication[sessionID] !== lease.cache ||
      locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== lease.owner.location
    )
      return
    const previous = lease.cache.items[value.id]
    setStore(
      "session",
      "communication",
      sessionID,
      "items",
      value.id,
      reconcile(
        previous &&
          ((before && JSON.stringify(before[value.id]) !== JSON.stringify(previous)) ||
            (value.state === "pending" && previous.state !== "pending"))
          ? { ...value, state: previous.state }
          : value,
      ),
    )
  }

  function communicationLifecycle(
    sessionID: string,
    inboxID: string | undefined,
    state: SessionCommunicationMessage["state"],
    sequence?: number,
  ) {
    communicationOwners.forEach((owner, participantID) => {
      const cache = store.session.communication[participantID]
      if (!cache || owner.client !== api()) return
      const values = Object.values(cache.items).filter(
        (value) => value.body.sessionID === sessionID && (!inboxID || value.body.inputID === inboxID),
      )
      // An in-flight page may contain a carrier we have not loaded yet. Revoke that snapshot too.
      if (!values.length && participantID !== sessionID && ![...owner.keys].some((key) => sync.pending(key))) return
      const key = inboxID ? JSON.stringify([sessionID, inboxID]) : undefined
      if (key && sequence !== undefined && (cache.sequence[key] ?? -1) >= sequence) return
      batch(() => {
        if (key && sequence !== undefined)
          setStore("session", "communication", participantID, "sequence", key, sequence)
        values.forEach((value) =>
          setStore(
            "session",
            "communication",
            participantID,
            "items",
            value.id,
            "state",
            store.session.removed[sessionID] ? "removed" : state,
          ),
        )
        result.session.communication.invalidate(participantID)
        setStore("session", "communication", participantID, "version", (version) => version + 1)
      })
    })
  }

  function scheduleCache(sessionID: string) {
    if (disposed) return
    const client = api()
    const location: LocationRef = store.session.info[sessionID]?.location ?? defaultLocation()
    const previous = scheduleOwners.get(sessionID)
    if (previous?.client !== client || previous.location !== locationKey(location)) {
      previous?.keys.forEach((key) => sync.forget(key))
      scheduleOwners.set(sessionID, {
        client,
        location: locationKey(location),
        keys: new Set(),
        tail: Promise.resolve(),
      })
      setStore(
        "session",
        "schedule",
        sessionID,
        reconcile({ rules: {}, listed: false, occurrences: {}, runsListed: {} }),
      )
    }
    const owner = scheduleOwners.get(sessionID)
    const cache = store.session.schedule[sessionID]
    if (!owner || !cache) return
    return { owner, cache, location }
  }

  function readSchedule(sessionID: string, scheduleID?: string) {
    const lease = scheduleCache(sessionID)
    if (!lease) return Promise.resolve()
    const key = `session.schedule:${sessionID}:${scheduleID ?? "list"}`
    lease.owner.keys.add(key)
    return sync.run(key, (current) => {
      const read = lease.owner.tail
        .catch(() => undefined)
        .then(async () => {
          const owned = () =>
            !disposed &&
            current() &&
            scheduleOwners.get(sessionID) === lease.owner &&
            store.session.schedule[sessionID] === lease.cache &&
            api() === lease.owner.client &&
            (!config.connection || config.connection.status() === "connected") &&
            locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) === lease.owner.location
          if (!owned()) return
          const query = { directory: lease.location.directory, workspace: lease.location.workspaceID }
          if (scheduleID) {
            const before = structuredClone(unwrap(lease.cache.occurrences))
            const values = await lease.owner.client.schedule.runs({ ...query, id: scheduleID })
            if (!owned()) return
            const items = {
              ...unwrap(lease.cache.occurrences),
              ...Object.fromEntries(
                values.map((value) => [
                  value.id,
                  JSON.stringify(before[value.id]) !== JSON.stringify(lease.cache.occurrences[value.id]) &&
                  lease.cache.occurrences[value.id]
                    ? unwrap(lease.cache.occurrences[value.id])
                    : value,
                ]),
              ),
            }
            batch(() => {
              setStore("session", "schedule", sessionID, "occurrences", reconcile(items))
              setStore("session", "schedule", sessionID, "runsListed", scheduleID, true)
            })
            return
          }
          const before = structuredClone(unwrap(lease.cache.rules))
          const values = await lease.owner.client.schedule.rules({ ...query, sessionID })
          if (!owned()) return
          const items = {
            ...unwrap(lease.cache.rules),
            ...Object.fromEntries(
              values.map((value) => [
                value.id,
                JSON.stringify(before[value.id]) !== JSON.stringify(lease.cache.rules[value.id]) &&
                lease.cache.rules[value.id]
                  ? unwrap(lease.cache.rules[value.id])
                  : value,
              ]),
            ),
          }
          batch(() => {
            setStore("session", "schedule", sessionID, "rules", reconcile(items))
            setStore("session", "schedule", sessionID, "listed", true)
          })
        })
      lease.owner.tail = read
      return read
    })
  }

  function rememberScheduleRule(
    sessionID: string,
    value: ScheduleRule,
    lease: ReturnType<typeof scheduleCache>,
    before?: Store["session"]["schedule"][string]["rules"],
  ) {
    if (
      !lease ||
      disposed ||
      scheduleOwners.get(sessionID) !== lease.owner ||
      api() !== lease.owner.client ||
      store.session.schedule[sessionID] !== lease.cache ||
      locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== lease.owner.location
    )
      return
    const previous = lease.cache.rules[value.id]
    if (previous && (previous.revision > value.revision || previous.updatedAt > value.updatedAt)) return
    if (
      before &&
      previous &&
      JSON.stringify(before[value.id]) !== JSON.stringify(previous) &&
      previous.revision >= value.revision &&
      previous.updatedAt >= value.updatedAt
    )
      return
    setStore("session", "schedule", sessionID, "rules", value.id, reconcile(value))
  }

  function rememberOccurrence(
    sessionID: string,
    value: ScheduleOccurrence,
    lease: ReturnType<typeof scheduleCache>,
    before?: Store["session"]["schedule"][string]["occurrences"],
  ) {
    if (
      !lease ||
      disposed ||
      scheduleOwners.get(sessionID) !== lease.owner ||
      api() !== lease.owner.client ||
      store.session.schedule[sessionID] !== lease.cache ||
      locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== lease.owner.location
    )
      return
    const previous = lease.cache.occurrences[value.id]
    if (previous && previous.updatedAt > value.updatedAt) return
    if (
      before &&
      previous &&
      JSON.stringify(before[value.id]) !== JSON.stringify(previous) &&
      previous.updatedAt >= value.updatedAt
    )
      return
    setStore("session", "schedule", sessionID, "occurrences", value.id, reconcile(value))
  }

  function rememberMemory(client: AigcForgeClient, cache: Store["memory"], value: PersonalMemoryInfo) {
    if (disposed || api() !== client || memoryOwner !== client || store.memory !== cache) return
    if (cache.items)
      setStore(
        "memory",
        "items",
        reconcile(cache.items.map((item) => (item.id === value.id ? structuredClone(value) : item))),
      )
    if (cache.pending)
      setStore(
        "memory",
        "pending",
        reconcile(
          value.status === "pending"
            ? cache.pending.map((item) => (item.id === value.id ? structuredClone(value) : item))
            : cache.pending.filter((item) => item.id !== value.id),
        ),
      )
    sync.invalidate("memory")
  }

  function setSessionActive(sessionID: string, status: DataSessionStatus) {
    activeUpdates?.set(sessionID, status)
    setStore("session", "active", sessionID, status)
  }

  function removePending(sessionID: string, inboxID?: string) {
    if (!inboxID) return
    pendingUpdates.get(sessionID)?.set(inboxID, undefined)
    if (store.session.pending[sessionID]?.some((item) => item.id === inboxID))
      setStore(
        "session",
        "pending",
        sessionID,
        (store.session.pending[sessionID] ?? []).filter((item) => item.id !== inboxID),
      )
  }

  function removePermission(sessionID: string, requestID: string) {
    const requests = store.session.permission[sessionID]
    if (!requests?.some((request) => request.id === requestID)) return
    setStore(
      "session",
      "permission",
      sessionID,
      requests.filter((request) => request.id !== requestID),
    )
  }

  function removeOperationPermissions(sessionID: string, operationID: string) {
    sync.invalidate(`session.permission:${sessionID}`)
    const requests = store.session.permission[sessionID]
    if (!requests) return
    const remaining = requests.filter(
      (request) =>
        request.source?.type !== "operation" ||
        request.source.sessionID !== sessionID ||
        request.source.operationID !== operationID,
    )
    if (remaining.length !== requests.length) setStore("session", "permission", sessionID, remaining)
  }

  function removeForm(sessionID: string, formID: string, ref?: LocationRef) {
    const forms = store.session.form[sessionID]
    if (!forms) return false
    const location = ref && locationKey(ref)
    const next = forms.filter((form) => {
      if (form.id !== formID) return true
      if (sessionID !== "global" || !location) return false
      return !form.location || locationKey(form.location) !== location
    })
    if (next.length === forms.length) return false
    setStore("session", "form", sessionID, next)
    return true
  }

  function settleForm(input: SessionFormCancelInput, ref: LocationRef | undefined, request: Promise<void>) {
    return request
      .catch((error: unknown) => {
        if ((!isFormNotFoundError(error) && !isFormAlreadySettledError(error)) || error.id !== input.formID) throw error
      })
      .then(() => {
        if (!removeForm(input.sessionID, input.formID, ref)) return
        result.session.form.invalidate(input.sessionID, ref)
        void result.session.form.sync(input.sessionID, ref).catch(() => undefined)
      })
  }

  function updatePending(sessionID: string, inboxID: string, delivery: SessionInbox.Delivery) {
    const index = store.session.pending[sessionID]?.findIndex((item) => item.id === inboxID) ?? -1
    const item = store.session.pending[sessionID]?.[index]
    pendingUpdates.get(sessionID)?.set(inboxID, item ? { ...item, delivery } : delivery)
    if (index < 0 || !item || item.delivery === delivery) return
    setStore("session", "pending", sessionID, index, { ...item, delivery })
  }

  // Inbox IDs of optimistic admissions awaiting acknowledgement, so rejection
  // only rolls back unacknowledged rows and a pending re-fetch cannot wipe a
  // row the server does not know about yet. Prompts clear on their durable
  // echo, positive pending read, or rollback; compactions also reconcile the
  // POST's canonical ID.
  const outbox = new Set<string>()

  // Session IDs of optimistic create admissions still awaiting acknowledgement
  // (the session.created echo or the create response itself). A failed create
  // only rolls back a session the server never acknowledged. Unlike
  // `creating`, this clears on the echo rather than request settlement.
  const sessionOutbox = new Set<string>()

  // In-flight optimistic creates by session ID. prompt() gates its POST on
  // this so a prompt sent to a still-creating session waits for the session
  // to exist server-side instead of failing with "not found".
  const creating = new Map<string, Promise<unknown>>()

  // Per-session send chain: prompts and compactions must be admitted in
  // submission order. Each waits for the previous POST to settle, so one
  // failure does not block the next.
  const sending = new Map<string, Promise<unknown>>()
  const messageLoads = new Map<string, Promise<unknown>>()
  const compacting = new Map<string, { id: string; observed: Set<string>; request: Promise<SessionInboxCompaction> }>()
  onCleanup(() => compacting.clear())

  // Register `promise` under `key` until it settles. A later registration
  // replaces an earlier one; settlement only clears its own entry.
  function track(map: Map<string, Promise<unknown>>, key: string, promise: Promise<unknown>) {
    map.set(key, promise)
    const settle = () => {
      if (map.get(key) === promise) map.delete(key)
    }
    void promise.then(settle, settle)
  }

  // Capture creation before settlement clears its entry, so dependent RPCs still see a failed create.
  function sendAdmission<Value>(sessionID: string, send: () => Promise<Value>, gate?: Promise<unknown>) {
    const created = creating.get(sessionID)
    const previous = sending.get(sessionID)
    const request = Promise.resolve()
      .then(() => Promise.all([gate, created, previous]))
      .then(send)
    track(
      sending,
      sessionID,
      request.catch(() => undefined),
    )
    return request
  }

  // Upsert an admitted inbox item into pending and (for user and synthetic
  // items) the visible transcript. Used by the inbox.enqueued
  // handler and by optimistic admission; the upsert is what reconciles
  // the durable echo with an optimistic placeholder — the durable payload and
  // times replace the client's guess.
  function admitLocal(item: SessionInboxInfo) {
    batch(() => {
      const pending = store.session.pending[item.sessionID] ?? []
      const at = pending.findIndex((entry) => entry.id === item.id)
      setStore(
        "session",
        "pending",
        item.sessionID,
        at < 0 ? [...pending, item] : pending.map((entry, index) => (index === at ? item : entry)),
      )
      if (item.type === "compaction") return
      materializeInboxMessage(item)
    })
  }

  function materializeInboxMessage(item: SessionInboxInfo) {
    if (item.type !== "user" && item.type !== "synthetic") return
    message.update(item.sessionID, (draft, index) => {
      const row =
        item.type === "user"
          ? { id: item.id, type: "user" as const, ...item.payload, time: { created: item.time.created } }
          : { id: item.id, type: "synthetic" as const, ...item.payload, time: { created: item.time.created } }
      const position = index.get(item.id)
      if (position === undefined) return message.append(draft, index, row)
      draft[position] = row
    })
  }

  // Remove an inbox item from pending, input, and the visible transcript.
  // Used by the inbox.cancelled handler and by optimistic rollback.
  function retractLocal(sessionID: string, inboxID: string) {
    batch(() => {
      removePending(sessionID, inboxID)
      if (!messageIndex.get(sessionID)?.has(inboxID)) return
      message.update(sessionID, (draft, index) => {
        const position = index.get(inboxID)
        if (position === undefined) return
        draft.splice(position, 1)
        index.delete(inboxID)
        message.reindex(draft, index, position)
      })
    })
  }

  const message = {
    update(sessionID: string, fn: (messages: SessionMessageInfo[], index: Map<string, number>) => void) {
      setStore(
        "session",
        "message",
        produce((draft) => {
          fn((draft[sessionID] ??= []), index(sessionID))
        }),
      )
    },
    append(messages: SessionMessageInfo[], index: Map<string, number>, item: SessionMessageInfo) {
      if (index.has(item.id)) return
      index.set(item.id, messages.length)
      messages.push(item)
    },
    insert(sessionID: string, item: SessionMessageInfo) {
      message.update(sessionID, (draft, index) => message.append(draft, index, item))
    },
    // Streaming events target one assistant message and, within it, the latest part of a kind.
    // A missing target means the row was never loaded or was evicted; the event is dropped.
    editAssistant(sessionID: string, messageID: string, fn: (assistant: SessionMessageAssistant) => void) {
      message.update(sessionID, (draft, index) => {
        const position = index.get(messageID)
        const item = position === undefined ? undefined : draft[position]
        if (item?.type === "assistant") fn(item)
      })
    },
    editTool(sessionID: string, messageID: string, toolID: string, fn: (tool: SessionMessageAssistantTool) => void) {
      message.editAssistant(sessionID, messageID, (assistant) => {
        const tool = assistant.content.findLast(
          (item): item is SessionMessageAssistantTool => item.type === "tool" && item.id === toolID,
        )
        if (tool) fn(tool)
      })
    },
    editText(sessionID: string, messageID: string, fn: (text: SessionMessageAssistantText) => void) {
      message.editAssistant(sessionID, messageID, (assistant) => {
        const text = assistant.content.findLast((item): item is SessionMessageAssistantText => item.type === "text")
        if (text) fn(text)
      })
    },
    editReasoning(sessionID: string, messageID: string, fn: (reasoning: SessionMessageAssistantReasoning) => void) {
      message.editAssistant(sessionID, messageID, (assistant) => {
        const reasoning = assistant.content.findLast(
          (item): item is SessionMessageAssistantReasoning => item.type === "reasoning" && !item.time?.completed,
        )
        if (reasoning) fn(reasoning)
      })
    },
    activeAssistant(messages: SessionMessageInfo[]) {
      const item = messages.findLast((item) => item.type === "assistant" && !item.time.completed)
      return item?.type === "assistant" ? item : undefined
    },
    shell(messages: SessionMessageInfo[], shellID: string) {
      const item = messages.findLast((item) => item.type === "shell" && item.shellID === shellID)
      return item?.type === "shell" ? item : undefined
    },
    compaction(messages: SessionMessageInfo[]) {
      const item = messages.findLast((item) => item.type === "compaction" && item.status === "running")
      return item?.type === "compaction" ? item : undefined
    },
    reindex(messages: SessionMessageInfo[], index: Map<string, number>, start: number) {
      for (let position = start; position < messages.length; position++) {
        const item = messages[position]
        if (item) index.set(item.id, position)
      }
    },
  }

  function index(sessionID: string) {
    const existing = messageIndex.get(sessionID)
    if (existing) return existing
    const created = new Map<string, number>()
    messageIndex.set(sessionID, created)
    return created
  }

  // Walk parentID upward through loaded session info to the family root. When a
  // parent's info is missing, that missing ID is the furthest-known ancestor and
  // is returned so orphan subtrees group under it until the parent arrives. A
  // seen set guards against parent cycles, stopping at the last non-repeating
  // ancestor.
  function resolveRoot(sessionID: string) {
    let current = sessionID
    let parentID = store.session.info[sessionID]?.parentID
    const seen = new Set([sessionID])
    while (parentID) {
      if (seen.has(parentID)) break
      seen.add(parentID)
      current = parentID
      parentID = store.session.info[parentID]?.parentID
    }
    return current
  }

  // Register one session into the family index. Idempotent: syncing an
  // existing session never duplicates its ID. When a tentative family keyed by
  // sessionID exists (descendants arrived while sessionID's own info was
  // absent) but sessionID turns out to have a parent, fold the orphan subtree
  // into the resolved root's family and drop the tentative entry.
  function registerSession(sessionID: string) {
    const info = store.session.info[sessionID]
    if (!info) return
    const rootID = resolveRoot(sessionID)
    setStore(
      "session",
      "family",
      produce((draft) => {
        if (sessionID !== rootID && draft[sessionID]) {
          const members = (draft[rootID] ??= [])
          for (const id of draft[sessionID]) {
            if (!members.includes(id)) members.push(id)
          }
          delete draft[sessionID]
        }
        const family = (draft[rootID] ??= [])
        if (!family.includes(sessionID)) family.push(sessionID)
      }),
    )
  }

  function evictSession(sessionID: string) {
    if (sessionOutbox.has(sessionID)) return
    sync.invalidate(`session.pending:${sessionID}`)
    sync.invalidate(`session.message:${sessionID}`)
    sync.forget(taskKey(sessionID))
    operationOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    operationOwners.delete(sessionID)
    goalOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    goalOwners.delete(sessionID)
    communicationOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    communicationOwners.delete(sessionID)
    scheduleOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    scheduleOwners.delete(sessionID)
    sync.forget(`session.delegation:${sessionID}`)
    delegationOwners.delete(sessionID)
    sync.forget(`session.workflow:${sessionID}`)
    sync.forget(`session.cache:${sessionID}`)
    workflowOwners.delete(sessionID)
    cacheOwners.delete(sessionID)
    sync.forget(`session.identity:${sessionID}`)
    identityOwners.delete(sessionID)
    sync.forget(`session.meta:${sessionID}`)
    sync.forget(`session.facts:${sessionID}`)
    metaOwners.delete(sessionID)
    factOwners.delete(sessionID)
    messageLoads.delete(sessionID)
    // Keep unacknowledged submissions until their echo or rollback settles them.
    const pending = store.session.pending[sessionID]?.filter((item) => outbox.has(item.id)) ?? []
    const messages = store.session.message[sessionID]?.filter((item) => outbox.has(item.id)) ?? []
    messageIndex.delete(sessionID)
    if (messages.length) messageIndex.set(sessionID, new Map(messages.map((item, index) => [item.id, index])))
    setStore(
      "session",
      produce((draft) => {
        delete draft.message[sessionID]
        delete draft.messageCursor[sessionID]
        delete draft.messageLoading[sessionID]
        delete draft.pending[sessionID]
        delete draft.task[sessionID]
        delete draft.operation[sessionID]
        delete draft.goal[sessionID]
        delete draft.communication[sessionID]
        delete draft.schedule[sessionID]
        delete draft.delegation[sessionID]
        delete draft.workflow[sessionID]
        delete draft.cache[sessionID]
        delete draft.identity[sessionID]
        delete draft.meta[sessionID]
        delete draft.facts[sessionID]
        if (messages.length) draft.message[sessionID] = messages
        if (pending.length) draft.pending[sessionID] = pending
      }),
    )
  }

  function removeSession(sessionID: string) {
    activeUpdates?.set(sessionID, undefined)
    store.session.pending[sessionID]?.forEach((item) => outbox.delete(item.id))
    messageIndex.delete(sessionID)
    messageLoads.delete(sessionID)
    sync.invalidate(`session:${sessionID}`)
    sync.invalidate(`session.family:${sessionID}`)
    sync.invalidate(`session.pending:${sessionID}`)
    sync.invalidate(`session.message:${sessionID}`)
    sync.invalidate(`session.permission:${sessionID}`)
    sync.invalidate(`session.form:${sessionID}:`)
    sync.forget(taskKey(sessionID))
    operationOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    operationOwners.delete(sessionID)
    goalOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    goalOwners.delete(sessionID)
    communicationOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    communicationOwners.delete(sessionID)
    scheduleOwners.get(sessionID)?.keys.forEach((key) => sync.forget(key))
    scheduleOwners.delete(sessionID)
    sync.forget(`session.delegation:${sessionID}`)
    delegationOwners.delete(sessionID)
    sync.forget(`session.workflow:${sessionID}`)
    sync.forget(`session.cache:${sessionID}`)
    workflowOwners.delete(sessionID)
    cacheOwners.delete(sessionID)
    sync.forget(`session.identity:${sessionID}`)
    identityOwners.delete(sessionID)
    sync.forget(`session.meta:${sessionID}`)
    sync.forget(`session.facts:${sessionID}`)
    metaOwners.delete(sessionID)
    factOwners.delete(sessionID)
    setStore(
      "session",
      produce((draft) => {
        draft.removed[sessionID] = true
        delete draft.info[sessionID]
        delete draft.active[sessionID]
        delete draft.message[sessionID]
        delete draft.messageCursor[sessionID]
        delete draft.messageLoading[sessionID]
        delete draft.pending[sessionID]
        delete draft.permission[sessionID]
        delete draft.form[sessionID]
        delete draft.task[sessionID]
        delete draft.operation[sessionID]
        delete draft.goal[sessionID]
        delete draft.communication[sessionID]
        delete draft.schedule[sessionID]
        delete draft.delegation[sessionID]
        delete draft.workflow[sessionID]
        delete draft.cache[sessionID]
        delete draft.identity[sessionID]
        delete draft.meta[sessionID]
        delete draft.facts[sessionID]
        for (const [rootID, family] of Object.entries(draft.family)) {
          const next = family.filter((id) => id !== sessionID)
          if (next.length === 0) delete draft.family[rootID]
          else draft.family[rootID] = next
        }
      }),
    )
  }

  function handleEvent(event: AigcForgeEvent) {
    if (event.type.startsWith("delegation.") && "delegationID" in event.data) {
      const delegationID = event.data.delegationID
      const parentSessionID = "parentSessionID" in event.data ? event.data.parentSessionID : undefined
      Object.entries(store.session.delegation).forEach(([sessionID, cache]) => {
        if (cache.items?.some((item) => item.delegation.id === delegationID) || parentSessionID === sessionID)
          result.session.delegation.invalidate(sessionID)
      })
      return
    }
    switch (event.type) {
      case "server.connected": {
        const updates = new Map<string, DataSessionStatus | undefined>()
        activeUpdates = updates
        refresh(() =>
          api()
            .session.active()
            .then((active) => {
              if (activeUpdates !== updates) return
              // Lifecycle events received during hydration supersede the snapshot.
              const snapshot = new Map<string, DataSessionStatus>(Object.keys(active).map((id) => [id, "running"]))
              updates.forEach((status, id) => {
                if (status === undefined) return snapshot.delete(id)
                snapshot.set(id, status)
              })
              activeUpdates = undefined
              setStore("session", "active", reconcile(Object.fromEntries(snapshot)))
            })
            .catch(() => {
              if (activeUpdates === updates) activeUpdates = undefined
            }),
        )
        refresh(() =>
          api()
            .location.get({ location: locationQuery(defaultLocation()) })
            .then((location) => {
              const key = locationKey(location)
              setStore("location", key, { info: location })
            }),
        )
        refresh(() => result.location.vcs.sync())
        refresh(() => result.project.sync())
        return
      }
      case "project.updated":
        setStore("project", "info", event.data.id, reconcile(event.data))
        return
      case "session.created":
        sessionOutbox.delete(event.data.sessionID)
        result.session.invalidate(event.data.sessionID)
        refresh(() => result.session.sync(event.data.sessionID))
        // Band-aid: a newly created session starts empty, so live events can be its source of truth.
        // Fetching pending inputs and projected messages separately lets promotion move an input between snapshots,
        // causing both requests to miss it and overwrite event-built state. Skip those racy initial reads until
        // hydration can load pending and projected messages atomically.
        sync.complete(`session.pending:${event.data.sessionID}`)
        sync.complete(`session.message:${event.data.sessionID}`)
        return
      case "session.deleted":
        communicationLifecycle(event.data.sessionID, undefined, "removed")
        removeSession(event.data.sessionID)
        return
      case "task.updated":
        result.session.task.invalidate(event.data.sessionID)
        hubOwners.forEach((_client, key) => sync.invalidate(`location.hub:${key}`))
        return
      case "task.operation.reserved":
        result.session.task.operation.invalidate(event.data.sessionID)
        if (
          event.data.source.type !== "model_tool" &&
          (store.session.message[event.data.sessionID] || sync.has(`session.message:${event.data.sessionID}`))
        ) {
          // The server projects the one source row. Read it through the original transcript owner.
          result.session.message.invalidate(event.data.sessionID)
          settle(`task.operation.source:${event.data.sessionID}`, () =>
            result.session.message.sync(event.data.sessionID),
          )
        }
        return
      case "task.operation.changed":
        result.session.task.operation.invalidate(event.data.sessionID)
        if (event.data.change.phase === "cancelled")
          removeOperationPermissions(event.data.sessionID, event.data.operationID)
        return
      case "session.goal.updated":
        if (goalOwners.has(event.data.sessionID))
          rememberGoal(event.data.sessionID, event.data.goal, goalCache(event.data.sessionID))
        return
      case "schedule.rule.created":
      case "schedule.rule.updated":
        if (scheduleOwners.has(event.data.sessionID))
          rememberScheduleRule(event.data.sessionID, event.data.rule, scheduleCache(event.data.sessionID))
        return
      case "schedule.occurrence.claimed":
      case "schedule.occurrence.updated":
        if (scheduleOwners.has(event.data.sessionID))
          rememberOccurrence(event.data.sessionID, event.data.occurrence, scheduleCache(event.data.sessionID))
        return
      case "schedule.rule.changed":
      case "schedule.occurrence.changed":
        result.session.schedule.invalidate(event.data.sessionID)
        return
      case "workflow.run.updated":
        result.session.workflow.invalidate(event.data.sessionID)
        return
      case "session.usage.updated":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, {
            cost: event.data.cost,
            tokens: event.data.tokens,
            unknownPriceAttempts: event.data.unknownPriceAttempts,
            missingUsageAttempts: event.data.missingUsageAttempts,
          })
        return
      case "session.agent.selected": {
        const previous = store.session.info[event.data.sessionID]?.agent
        const identity = identityOwners.get(event.data.sessionID)
        if (identity) identity.selected = { agent: event.data.agent, eventID: event.id }
        result.session.invalidate(event.data.sessionID)
        sync.invalidate(`session.family:${resolveRoot(event.data.sessionID)}`)
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, {
            agent: event.data.agent,
            time: {
              ...store.session.info[event.data.sessionID].time,
              updated: Math.max(store.session.info[event.data.sessionID].time.updated, event.created),
            },
          })
        message.insert(event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "agent-switched",
          agent: event.data.agent,
          previous,
          time: { created: event.created },
        })
        return
      }
      case "session.model.selected":
        result.session.invalidate(event.data.sessionID)
        sync.invalidate(`session.family:${resolveRoot(event.data.sessionID)}`)
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, {
            model: event.data.model,
            time: {
              ...store.session.info[event.data.sessionID].time,
              updated: Math.max(store.session.info[event.data.sessionID].time.updated, event.created),
            },
          })
        if (!store.session.message[event.data.sessionID]) return
        message.insert(event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "model-switched",
          model: event.data.model,
          time: { created: event.created },
        })
        refresh(() =>
          api()
            .session.message.get({ sessionID: event.data.sessionID, messageID: messageIDFromEvent(event.id) })
            .then((item) => {
              message.update(event.data.sessionID, (draft, index) => {
                const position = index.get(item.id)
                if (position === undefined) return message.append(draft, index, item)
                draft[position] = item
              })
            }),
        )
        return
      case "session.executor.selected":
        result.session.invalidate(event.data.sessionID)
        sync.invalidate(`session.family:${resolveRoot(event.data.sessionID)}`)
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, {
            executorPreference: event.data.executorPreference,
            time: {
              ...store.session.info[event.data.sessionID].time,
              updated: Math.max(store.session.info[event.data.sessionID].time.updated, event.created),
            },
          })
        return
      case "session.renamed": {
        // Preserve the live title when it races the session's initial read.
        refresh(() => {
          const family = sync.pending(`session.family:${event.data.sessionID}`)
            ? result.session.sync(event.data.sessionID, { children: true })
            : Promise.resolve()
          return Promise.all([result.session.sync(event.data.sessionID), family]).then(() => {
            if (store.session.info[event.data.sessionID])
              setStore("session", "info", event.data.sessionID, "title", event.data.title)
          })
        })
        return
      }
      case "session.permissions":
        result.session.identity.invalidate(event.data.sessionID)
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "permissions", event.data.permissions)
        return
      case "session.moved": {
        result.session.identity.invalidate(event.data.sessionID)
        const current = store.session.info[event.data.sessionID]
        if (current) {
          const previous = {
            location: { ...current.location },
            projectID: current.projectID,
            subpath: current.subpath,
          }
          setStore("session", "info", event.data.sessionID, "location", event.data.location)
          if (event.data.projectID) setStore("session", "info", event.data.sessionID, "projectID", event.data.projectID)
          setStore("session", "info", event.data.sessionID, "subpath", event.data.subpath)
          message.insert(event.data.sessionID, {
            id: messageIDFromEvent(event.id),
            type: "location-switched",
            location: event.data.location,
            projectID: event.data.projectID,
            subpath: event.data.subpath,
            previous,
            time: { created: event.created },
          })
        }
        return
      }
      case "worktree.resolved": {
        for (const [sessionID, info] of Object.entries(store.session.info)) {
          const explicit = event.data.adopted?.includes(info.projectID)
          const directory = explicit ? store.project.info[info.projectID]?.canonical : info.location.directory
          if (!directory) {
            result.session.invalidate(sessionID)
            refresh(() => result.session.sync(sessionID))
            continue
          }
          const adopted = Worktree.adopt(
            {
              projectID: info.projectID,
              directory,
            },
            event.data,
          )
          if (!adopted) continue
          setStore("session", "info", sessionID, "projectID", adopted.projectID)
          setStore("session", "info", sessionID, "subpath", adopted.subpath)
        }
        return
      }
      case "session.inbox.delivered": {
        const current = store.session.info[event.data.sessionID]
        const input = store.session.pending[event.data.sessionID]?.find((item) => item.id === event.data.inboxID)

        if (
          current &&
          (input?.type === "user" ||
            store.session.message[event.data.sessionID]?.find((item) => item.id === event.data.inboxID)?.type ===
              "user")
        )
          setStore(
            "session",
            "info",
            event.data.sessionID,
            "time",
            "message",
            Math.max(current.time.message ?? 0, event.created),
          )
        communicationLifecycle(event.data.sessionID, event.data.inboxID, "visible", event.durable.seq)
        const admitted = result.session.input.has(event.data.sessionID, event.data.inboxID)
        removePending(event.data.sessionID, event.data.inboxID)
        message.update(event.data.sessionID, (draft, index) => {
          const position = index.get(event.data.inboxID)
          if (position === undefined) return
          const existing = draft[position]
          if (!existing || !admitted) return
          existing.time.created = event.created
          existing.origin =
            existing.type === "user" && event.data.correctionSourceVersion !== 1
              ? { kind: "historical" }
              : {
                  kind: existing.type === "user" ? "inbox-user" : "inbox-synthetic",
                  sessionID: event.data.sessionID,
                  id: event.id,
                  seq: event.durable.seq,
                }
          draft.splice(position, 1)
          draft.push(existing)
          message.reindex(draft, index, position)
        })
        compacting.get(event.data.sessionID)?.observed.add(event.data.inboxID)
        return
      }
      case "session.inbox.delivery.changed":
        updatePending(event.data.sessionID, event.data.inboxID, event.data.delivery)
        return
      case "session.inbox.cancelled": {
        communicationLifecycle(event.data.sessionID, event.data.inboxID, "cancelled", event.durable.seq)
        retractLocal(event.data.sessionID, event.data.inboxID)
        compacting.get(event.data.sessionID)?.observed.add(event.data.inboxID)
        return
      }
      case "session.inbox.enqueued": {
        outbox.delete(event.data.inboxID)
        const item = {
          id: event.data.inboxID,
          sessionID: event.data.sessionID,
          time: { created: event.created },
          ...event.data.item,
        }
        pendingUpdates.get(item.sessionID)?.set(item.id, item)
        admitLocal(item)
        const communication = event.data.communication
        if (communication && event.data.item.type === "synthetic") {
          const text = event.data.item.payload.text
          for (const sessionID of new Set([communication.actor.sessionID, communication.targetSessionID])) {
            const lease = communicationCache(sessionID)
            if (!lease) continue
            const key = JSON.stringify([communication.body.sessionID, communication.body.inputID])
            if ((lease.cache.sequence[key] ?? -1) >= event.durable.seq) continue
            const previous = lease.cache.items[communication.id]
            const value = {
              ...communication,
              text,
              state: store.session.removed[communication.targetSessionID] ? "removed" : (previous?.state ?? "pending"),
            }
            if (JSON.stringify(previous) === JSON.stringify(value)) continue
            batch(() => {
              setStore("session", "communication", sessionID, "sequence", key, event.durable.seq)
              rememberCommunication(sessionID, value, lease)
              setStore("session", "communication", sessionID, "version", (version) => version + 1)
            })
          }
        }
        if (event.data.item.type === "compaction") {
          const active = compacting.get(event.data.sessionID)
          active?.observed.add(event.data.inboxID)
          if (active && active.id !== event.data.inboxID && outbox.delete(active.id))
            removePending(event.data.sessionID, active.id)
        }
        return
      }
      case "session.instructions.updated":
        // Mirror the projector: the initial baseline and empty-rendering deltas carry no text
        // and produce no transcript message.
        const updateText = event.data.text
        if (updateText === undefined) return
        message.insert(event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "system",
          text: updateText,
          description: `Instructions updated: ${Object.keys(event.data.delta).join(", ")}`,
          metadata: event.metadata,
          time: { created: event.created },
        })
        return
      case "session.synthetic":
        message.insert(event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "synthetic",
          origin: { kind: "core-synthetic", sessionID: event.data.sessionID, id: event.id, seq: event.durable.seq },
          text: event.data.text,
          description: event.data.description,
          metadata: event.data.metadata,
          time: { created: event.created },
        })
        return
      case "session.shell.started":
        message.insert(event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "shell",
          shellID: event.data.shell.id,
          command: event.data.shell.command,
          status: event.data.shell.status,
          exit: event.data.shell.exit,
          metadata:
            event.data.shell.metadata.background === true ? { ...event.metadata, background: true } : event.metadata,
          time: { created: event.created },
        })
        return
      case "session.shell.ended":
        message.update(event.data.sessionID, (draft) => {
          const match = message.shell(draft, event.data.shell.id)
          if (!match) return
          match.status = event.data.shell.status
          match.exit = event.data.shell.exit
          match.output = event.data.output
          match.time.completed = event.created
        })
        return
      case "session.step.started":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "time", "message", (time) => {
            const assistant = store.session.message[event.data.sessionID]?.find(
              (item) => item.id === event.data.assistantMessageID,
            )

            return Math.max(
              time ?? 0,
              assistant?.type === "assistant" && assistant.attempts !== undefined
                ? assistant.time.created
                : event.data.started,
            )
          })
        message.update(event.data.sessionID, (draft, index) => {
          const position = index.get(event.data.assistantMessageID)
          const existing = position === undefined ? undefined : draft[position]
          if (existing?.type === "assistant") {
            if (existing.attempts !== undefined) {
              if (event.data.snapshot) existing.snapshot = { ...existing.snapshot, start: event.data.snapshot }
              return
            }
            existing.agent = event.data.agent
            existing.model = event.data.model
            existing.retry = undefined
            existing.error = undefined
            existing.finish = undefined
            existing.completion = undefined
            existing.origin = { kind: "step", sessionID: event.data.sessionID, id: event.id, seq: event.durable.seq }
            existing.rawFinish = undefined
            existing.needsContinuation = undefined
            existing.providerState = undefined
            existing.time.created = event.data.started
            existing.time.streamed = undefined
            existing.time.completed = undefined
            if (event.data.snapshot) existing.snapshot = { ...existing.snapshot, start: event.data.snapshot }
            return
          }
          const currentAssistant = message.activeAssistant(draft)
          if (currentAssistant) {
            currentAssistant.retry = undefined
            currentAssistant.time.completed = event.created
          }
          message.append(draft, index, {
            id: event.data.assistantMessageID,
            type: "assistant",
            origin: { kind: "step", sessionID: event.data.sessionID, id: event.id, seq: event.durable.seq },
            agent: event.data.agent,
            model: event.data.model,
            metadata: event.metadata,
            content: [],
            snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
            time: { created: event.data.started },
          })
        })
        return
      case "session.attempt.started": {
        const { sessionID, assistantMessageID, ...started } = event.data

        if (store.session.info[sessionID])
          setStore("session", "info", sessionID, "time", "message", (time) => {
            const assistant = store.session.message[sessionID]?.find((item) => item.id === assistantMessageID)

            return Math.max(time ?? 0, assistant?.type === "assistant" ? assistant.time.created : started.started)
          })
        message.update(sessionID, (draft, index) => {
          const position = index.get(assistantMessageID)
          const assistant = position === undefined ? undefined : draft[position]
          if (assistant?.type !== "assistant") {
            const current = message.activeAssistant(draft)
            if (current) {
              current.retry = undefined
              current.time.completed ??= event.created
            }
            message.append(draft, index, {
              id: assistantMessageID,
              type: "assistant",
              origin: { kind: "step", sessionID, id: event.id, seq: event.durable.seq },
              agent: started.agent,
              model: started.model,
              attempts: [{ ...started, observations: [] }],
              metadata: event.metadata,
              content: [],
              time: { created: started.started },
            })
            return
          }
          if (assistant.attempts?.some((attempt) => attempt.ordinal === started.ordinal)) return
          if (
            assistant.content.length === 0 &&
            !assistant.attempts?.some(
              (attempt) =>
                attempt.terminal?.outputStarted ||
                attempt.observations.some((observation) => observation.outputStarted),
            )
          )
            assistant.model = started.model
          assistant.agent = started.agent
          assistant.attempts = [...(assistant.attempts ?? []), { ...started, observations: [] }]
          assistant.retry = undefined
          assistant.error = undefined
          assistant.finish = undefined
          assistant.rawFinish = undefined
          assistant.needsContinuation = undefined
        })
        return
      }
      case "session.attempt.observed":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          const attempt = assistant.attempts?.find((item) => item.ordinal === event.data.ordinal)
          if (!attempt || attempt.observations.some((observation) => observation.event.id === event.id)) return
          attempt.observations.push({ ...event.data.observation, event: { id: event.id, seq: event.durable.seq } })
        })
        return
      case "session.attempt.ended":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          const attempt = assistant.attempts?.find((item) => item.ordinal === event.data.ordinal)
          if (!attempt || attempt.terminal) return
          attempt.terminal = event.data.terminal
        })
        return
      case "session.step.streamed":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.time.streamed ??= event.created
        })
        return
      case "session.step.ended": {
        result.session.cache.invalidate(event.data.sessionID)
        result.session.meta.invalidate(event.data.sessionID)
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.time.completed = event.created
          assistant.finish = event.data.finish
          assistant.needsContinuation = event.data.needsContinuation
          assistant.rawFinish = event.data.rawFinish
          assistant.providerState = event.data.providerState
          assistant.cost = event.data.cost
          assistant.tokens = event.data.tokens
          assistant.unknownPriceAttempts = event.data.unknownPriceAttempts
          assistant.missingUsageAttempts = event.data.missingUsageAttempts
          if (event.data.snapshot) assistant.snapshot = { ...assistant.snapshot, end: event.data.snapshot }
        })
        return
      }
      case "session.step.failed":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.time.completed = event.created
          assistant.finish = event.data.finish ?? "error"
          assistant.needsContinuation = undefined
          assistant.completion = undefined
          assistant.rawFinish = event.data.rawFinish
          assistant.providerState = event.data.providerState
          assistant.error = event.data.error
          assistant.retry = undefined
          assistant.unknownPriceAttempts = event.data.unknownPriceAttempts
          assistant.missingUsageAttempts = event.data.missingUsageAttempts
          if (event.data.cost !== undefined && event.data.tokens !== undefined) {
            assistant.cost = event.data.cost
            assistant.tokens = event.data.tokens
          }
        })
        return
      case "session.step.completed":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.completion = { id: event.id, seq: event.durable.seq }
          assistant.time.completed ??= event.created
        })
        return
      case "session.text.started":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.content.push({ type: "text", text: "" })
        })
        return
      case "session.text.delta":
        message.editText(event.data.sessionID, event.data.assistantMessageID, (text) => {
          text.text += event.data.delta
        })
        return
      case "session.text.ended":
        message.editText(event.data.sessionID, event.data.assistantMessageID, (text) => {
          text.text = event.data.text
        })
        return
      case "session.tool.input.started":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.content.push({
            type: "tool",
            id: event.data.id,
            name: event.data.name,
            time: { created: event.created },
            state: { status: "streaming", input: "" },
          })
        })
        return
      case "session.tool.input.delta":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status === "streaming") tool.state.input += event.data.delta
        })
        return
      case "session.tool.input.ended":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status === "streaming") tool.state.input = event.data.text
        })
        return
      case "session.tool.called":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          tool.time.ran = event.created
          tool.executed = event.data.executed
          tool.providerState = event.data.state
          tool.state = { status: "running", input: event.data.input, metadata: {} }
        })
        return
      case "session.tool.progress":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status === "running") tool.state.metadata = event.data.metadata
        })
        return
      case "session.tool.success":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status !== "running") return
          tool.state = {
            status: "completed",
            input: tool.state.input,
            metadata: event.data.metadata,
            content: [...event.data.content],
          }
          tool.executed = event.data.executed || tool.executed === true
          tool.providerResultState = event.data.resultState
          tool.time.completed = event.created
        })
        return
      case "session.tool.failed":
        message.editTool(event.data.sessionID, event.data.assistantMessageID, event.data.id, (tool) => {
          if (tool.state.status !== "streaming" && tool.state.status !== "running") return
          tool.state = {
            status: "error",
            error: event.data.error,
            input: typeof tool.state.input === "string" ? {} : tool.state.input,
            metadata: event.data.metadata,
            content: event.data.content,
          }
          tool.executed = event.data.executed || tool.executed === true
          tool.providerResultState = event.data.resultState
          tool.time.completed = event.created
        })
        return
      case "session.reasoning.started":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.content.push({
            type: "reasoning",
            text: "",
            state: event.data.state,
            time: { created: event.created },
          })
        })
        return
      case "session.reasoning.delta":
        message.editReasoning(event.data.sessionID, event.data.assistantMessageID, (reasoning) => {
          reasoning.text += event.data.delta
        })
        return
      case "session.reasoning.ended":
        message.editReasoning(event.data.sessionID, event.data.assistantMessageID, (reasoning) => {
          reasoning.text = event.data.text
          reasoning.time = { created: reasoning.time?.created ?? event.created, completed: event.created }
          if (event.data.state !== undefined) reasoning.state = event.data.state
        })
        return
      case "session.retry.scheduled":
        message.editAssistant(event.data.sessionID, event.data.assistantMessageID, (assistant) => {
          assistant.retry = { attempt: event.data.attempt, at: event.data.at, error: event.data.error }
        })
        return
      case "session.execution.started":
        setSessionActive(event.data.sessionID, "running")
        return
      case "session.compaction.started":
        if (event.data.inputID) removePending(event.data.sessionID, event.data.inputID)
        message.insert(event.data.sessionID, {
          id: event.data.inputID ?? messageIDFromEvent(event.id),
          type: "compaction",
          status: "running",
          reason: event.data.reason,
          summary: "",
          recent: event.data.recent ?? "",
          time: { created: event.created },
        })
        if (event.data.inputID) compacting.get(event.data.sessionID)?.observed.add(event.data.inputID)
        return
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        setSessionActive(event.data.sessionID, "idle")
        message.update(event.data.sessionID, (draft) => {
          const currentAssistant = message.activeAssistant(draft)
          if (currentAssistant) currentAssistant.retry = undefined
        })
        if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return
        // Mirror the projected idle marker so turn boundaries match before the next message read.
        message.insert(event.data.sessionID, {
          id: messageIDFromEvent(event.id),
          type: "idle",
          outcome:
            event.type === "session.execution.succeeded"
              ? "succeeded"
              : event.type === "session.execution.failed"
                ? "failed"
                : "interrupted",
          ...(event.type === "session.execution.failed" ? { error: event.data.error } : {}),
          time: { created: event.created },
        })
        if (
          store.session.message[event.data.sessionID]?.some(
            (item) =>
              item.type === "assistant" &&
              item.content.some(
                (part) =>
                  part.type === "tool" && (part.state.status === "streaming" || part.state.status === "running"),
              ),
          )
        ) {
          sync.invalidate(`session.message:${event.data.sessionID}`)
          refresh(() => result.session.message.sync(event.data.sessionID))
        }
        // An event can overtake the first read; queue a revalidation when that read is still active.
        if (!store.session.info[event.data.sessionID] && !sync.has(`session:${event.data.sessionID}`)) return
        result.session.invalidate(event.data.sessionID)
        refresh(() => result.session.sync(event.data.sessionID))
        return
      case "session.viewed":
        if (!store.session.info[event.data.sessionID] && !sync.has(`session:${event.data.sessionID}`)) return
        result.session.invalidate(event.data.sessionID)
        refresh(() => result.session.sync(event.data.sessionID))
        return
      case "session.revert.staged":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "revert", event.data.revert)
        return
      case "session.revert.cleared":
        if (store.session.info[event.data.sessionID])
          setStore("session", "info", event.data.sessionID, "revert", undefined)
        return
      case "session.revert.committed": {
        if (store.session.info[event.data.sessionID]) {
          setStore("session", "info", event.data.sessionID, "revert", undefined)
        }
        // Only the server owns inbox insertion order. Refresh pending before reconciling local input messages.
        result.session.pending.invalidate(event.data.sessionID)
        result.session.message.invalidate(event.data.sessionID)
        refresh(async () => {
          await result.session.pending.sync(event.data.sessionID)
          await result.session.message.sync(event.data.sessionID)
        })
        message.update(event.data.sessionID, (draft, index) => {
          draft.forEach((item) => {
            if (item.type !== "assistant" || !item.completion || event.data.boundarySeq === undefined) return
            if (item.completion.seq >= event.data.boundarySeq) item.completion = undefined
          })
          const position = index.get(event.data.to)
          if (position === undefined) return
          for (const item of draft.splice(position)) index.delete(item.id)
        })
        return
      }
      case "session.compaction.delta":
        message.update(event.data.sessionID, (draft) => {
          const current = message.compaction(draft)
          if (current?.status === "running") current.summary += event.data.text
        })
        return
      case "session.compaction.ended":
        message.update(event.data.sessionID, (draft, index) => {
          const position = draft.findLastIndex((item) => item.type === "compaction" && item.status === "running")
          const current = draft[position]
          if (current?.type === "compaction") {
            Object.assign(current, {
              status: "completed",
              reason: event.data.reason,
              model: event.data.model,
              providerState: event.data.providerState,
              providerContext: event.data.providerContext,
              summary: event.data.text,
              recent: event.data.recent,
              cost: event.data.cost,
              tokens: event.data.tokens,
            })
            return
          }
          message.append(draft, index, {
            id: messageIDFromEvent(event.id),
            type: "compaction",
            status: "completed",
            reason: event.data.reason,
            model: event.data.model,
            providerState: event.data.providerState,
            providerContext: event.data.providerContext,
            summary: event.data.text,
            recent: event.data.recent,
            cost: event.data.cost,
            tokens: event.data.tokens,
            time: { created: event.created },
          })
        })
        return
      case "session.compaction.failed":
        if (event.data.inputID) removePending(event.data.sessionID, event.data.inputID)
        message.update(event.data.sessionID, (draft, index) => {
          const position = draft.findLastIndex((item) => item.type === "compaction" && item.status === "running")
          const current = draft[position]
          const failed: Extract<SessionMessageInfo, { type: "compaction"; status: "failed" }> = {
            id: current?.id ?? event.data.inputID ?? messageIDFromEvent(event.id),
            type: "compaction",
            status: "failed",
            reason: event.data.reason ?? "manual",
            error: event.data.error ?? {
              type: "compaction.failed",
              message: "Compaction failed before recording an error",
            },
            metadata: current?.type === "compaction" ? current.metadata : event.metadata,
            cost: event.data.cost,
            tokens: event.data.tokens,
            time: current?.type === "compaction" ? current.time : { created: event.created },
          }
          if (current?.type === "compaction") {
            draft[position] = failed
            return
          }
          message.append(draft, index, failed)
        })
        if (event.data.inputID) compacting.get(event.data.sessionID)?.observed.add(event.data.inputID)
        return
      case "permission.asked":
        if (
          event.data.source?.type === "operation" &&
          result.session.task.operation.get(event.data.source.sessionID, event.data.source.operationID)?.phase ===
            "cancelled"
        )
          return
        if (store.session.permission[event.data.sessionID]?.some((request) => request.id === event.data.id)) return
        setStore("session", "permission", event.data.sessionID, [
          ...(store.session.permission[event.data.sessionID] ?? []),
          event.data,
        ])
        return
      case "permission.replied":
        removePermission(event.data.sessionID, event.data.requestID)
        identityOwners.forEach((_owner, sessionID) => result.session.identity.invalidate(sessionID))
        return
      case "form.replied":
      case "form.cancelled":
        removeForm(event.data.sessionID, event.data.id, event.location)
        return
    }

    if (event.type === "credential.updated" || event.type === "credential.switched") {
      refreshDiscovery()
      Object.keys(store.location).forEach((key) => {
        const ref = decodeLocationKey(key)
        const location = { directory: ref[0], workspaceID: ref[1] ?? undefined }
        result.location.provider.definition.invalidate(location)
        if (
          result.location.provider.definition.list(location) !== undefined ||
          sync.has(`location.providerDefinition:${locationKey(location)}`)
        )
          refresh(() => result.location.provider.definition.sync(location))
        if (event.type === "credential.updated") {
          result.location.integration.invalidate(location)
          refresh(() => result.location.integration.sync(location))
          return
        }
        setStore("location", key, (data) => ({
          integration: data?.integration?.map((integration) => {
            if (integration.id !== event.data.integrationID) return integration
            const active = integration.connections.find(
              (connection) => connection.type === "credential" && connection.id === event.data.credentialID,
            )
            if (!active) return integration
            return {
              ...integration,
              connections: [active, ...integration.connections.filter((connection) => connection !== active)],
            }
          }),
        }))
        result.location.model.invalidate(location)
        result.location.provider.invalidate(location)
        refresh(() => Promise.all([result.location.model.sync(location), result.location.provider.sync(location)]))
      })
      return
    }

    if (!event.location) return
    const location = event.location
    if (event.type === "agent.updated" || event.type === "config.updated" || event.type === "plugin.updated")
      identityOwners.forEach((owner, sessionID) => {
        if (owner.location === locationKey(location)) result.session.identity.invalidate(sessionID)
      })
    switch (event.type) {
      case "provider.discovery.updated":
        refreshDiscovery(location, event.data.providerID, event.data.connection)
        break
      case "provider.updated":
        result.location.provider.invalidate(location)
        refresh(() => result.location.provider.sync(location))
        break
      case "model.updated":
        result.location.model.invalidate(location)
        refresh(() => result.location.model.sync(location))
        result.location.model.group.definition.invalidate(location)
        if (
          result.location.model.group.definition.list(location) !== undefined ||
          sync.has(`location.modelGroup:${locationKey(location)}`)
        )
          refresh(() => result.location.model.group.definition.sync(location))
        break
      case "agent.updated":
        result.location.agent.invalidate(location)
        refresh(() => result.location.agent.sync(location))
        break
      case "command.updated":
        result.location.command.invalidate(location)
        refresh(() => result.location.command.sync(location))
        break
      case "skill.updated":
        result.location.skill.invalidate(location)
        refresh(() => result.location.skill.sync(location))
        break
      case "vcs.branch.updated":
        setStore("location", locationKey(location), (data) => ({
          vcs: {
            branch: {
              ...data?.vcs?.branch,
              current: event.data.branch,
            },
          },
        }))
        break
      case "form.created":
        if (store.session.form[event.data.form.sessionID]?.some((form) => form.id === event.data.form.id)) break
        setStore("session", "form", event.data.form.sessionID, [
          ...(store.session.form[event.data.form.sessionID] ?? []),
          event.data.form.sessionID === "global" ? { ...event.data.form, location } : event.data.form,
        ])
        break
      case "shell.created":
        setStore("location", locationKey(location), (data) => ({
          shell: {
            ...data?.shell,
            [event.data.info.id]: { ...event.data.info, location },
          },
        }))
        break
      case "shell.exited":
      case "shell.deleted":
        setStore("location", locationKey(location), (data) => ({
          shell: Object.fromEntries(Object.entries(data?.shell ?? {}).filter(([id]) => id !== event.data.id)),
        }))
        break
      case "reference.updated":
        result.location.reference.invalidate(location)
        refresh(() => result.location.reference.sync(location))
        break
      case "integration.updated":
        refreshDiscovery(location)
        result.location.integration.invalidate(location)
        result.location.model.invalidate(location)
        result.location.provider.invalidate(location)
        refresh(() =>
          Promise.all([
            result.location.integration.sync(location),
            result.location.model.sync(location),
            result.location.provider.sync(location),
          ]),
        )
        break
      case "config.updated":
        refreshDiscovery(location)
        result.location.model.group.definition.invalidate(location)
        if (
          result.location.model.group.definition.list(location) !== undefined ||
          sync.has(`location.modelGroup:${locationKey(location)}`)
        )
          refresh(() => result.location.model.group.definition.sync(location))
        result.location.config.invalidate(location)
        if (result.location.config.list(location) !== undefined || sync.has(`location.config:${locationKey(location)}`))
          refresh(() => result.location.config.sync(location))
        result.location.provider.definition.invalidate(location)
        if (
          result.location.provider.definition.list(location) !== undefined ||
          sync.has(`location.providerDefinition:${locationKey(location)}`)
        )
          refresh(() => result.location.provider.definition.sync(location))
        refresh(() => result.location.websearch.refresh(location))
        break
      case "websearch.updated":
        refresh(() => result.location.websearch.refresh(location))
        break
      // Authenticating an MCP integration reconnects its server, which emits mcp.status.changed,
      // so the mcp list syncs here rather than off integration.updated. The server emits one event
      // per MCP server as each settles, so a location booting nine servers emitted nine refetches.
      case "mcp.status.changed":
        result.location.mcp.server.invalidate(location)
        settle(`mcp.status:${locationKey(location)}`, () => result.location.mcp.server.sync(location))
        break
      case "mcp.resources.changed":
        result.location.mcp.resource.invalidate(location)
        refresh(() => result.location.mcp.resource.sync(location))
        break
    }
  }

  // A cached per-location catalog. `sync` loads once per invalidation, keyed by the
  // effective location, and publishes under the server's canonical location; `alias`
  // also publishes under the requested key when the two differ.
  function locationResource<Field extends keyof LocationData>(
    field: Field,
    load: (location: ReturnType<typeof locationQuery>) => Promise<{ location: LocationRef; data: LocationData[Field] }>,
    options?: { alias?: boolean },
  ) {
    const publish = (key: string, value: LocationData[Field]) => setStore("location", key, { [field]: value })
    return {
      list: (ref?: LocationRef) => store.location[locationKey(ref ?? defaultLocation())]?.[field],
      sync: (ref?: LocationRef) => {
        const location = ref ?? defaultLocation()
        const id = locationKey(location)
        return sync.run(`location.${field}:${id}`, async () => {
          const response = await load(locationQuery(location))
          const key = locationKey(response.location)
          publish(key, response.data)
          if (options?.alias && key !== id) publish(id, response.data)
        })
      },
      invalidate: (ref?: LocationRef) => sync.invalidate(`location.${field}:${locationKey(ref ?? defaultLocation())}`),
    }
  }

  const vcs = locationResource("vcs", (location) => api().vcs.get({ location }))
  const shells = locationResource("shell", async (location) => {
    const response = await api().shell.list({ location })
    const ref = { directory: response.location.directory }
    return {
      location: response.location,
      data: Object.fromEntries(response.data.map((info) => [info.id, { ...info, location: ref }])),
    }
  })

  const discoverySlot = (providerID: string, connection?: ModelSourceConnectionRef) =>
    JSON.stringify([providerID, connection?.type, connection?.type === "credential" ? connection.id : connection?.name])

  function discoveryReads(ref?: LocationRef, providerID?: string, connection?: ModelSourceConnectionRef) {
    const location = ref && locationKey(ref)
    return [...discoveryOwners.entries()].filter(
      ([, owner]) =>
        (!location || locationKey(owner.location) === location || owner.canonical === location) &&
        (providerID === undefined || owner.providerID === providerID) &&
        (!connection ||
          !owner.connection ||
          discoverySlot(owner.providerID, owner.connection) === discoverySlot(owner.providerID, connection)),
    )
  }

  function refreshDiscovery(ref?: LocationRef, providerID?: string, connection?: ModelSourceConnectionRef) {
    discoveryReads(ref, providerID, connection).forEach(([key, owner]) => {
      sync.invalidate(key)
      refresh(() => providerDiscovery.sync(owner.providerID, owner.connection, owner.location))
    })
  }

  const providerDiscovery = {
    get(providerID: string, connection?: ModelSourceConnectionRef, ref?: LocationRef) {
      const location = ref ?? defaultLocation()
      const slot = discoverySlot(providerID, connection)
      if (!discoveryReads(location, providerID).some(([, owner]) => owner.slot === slot && owner.client === api()))
        return undefined
      return store.location[locationKey(location)]?.providerDiscovery?.[slot]
    },
    sync(providerID: string, connection?: ModelSourceConnectionRef, ref?: LocationRef) {
      if (disposed) return Promise.resolve()
      const location = ref ?? defaultLocation()
      const id = locationKey(location)
      const slot = discoverySlot(providerID, connection)
      const key = `location.providerDiscovery:${id}:${slot}`
      const client = api()
      const previous = discoveryOwners.get(key)
      const owner =
        previous?.client === client
          ? previous
          : { client, location, slot, providerID, connection, canonical: undefined }
      if (owner !== previous) {
        sync.forget(key)
        discoveryOwners.set(key, owner)
        setStore("location", id, (data) => ({
          providerDiscovery: Object.fromEntries(
            Object.entries(data?.providerDiscovery ?? {}).filter(([key]) => key !== slot),
          ),
        }))
      }
      return sync.run(key, async (current) => {
        const response = await client.provider.discovery.get({
          location: locationQuery(location),
          providerID,
          connection,
        })
        if (
          disposed ||
          !current() ||
          api() !== client ||
          discoveryOwners.get(key) !== owner ||
          (config.connection && config.connection.status() !== "connected")
        )
          return
        const canonical = locationKey(response.location)
        owner.canonical = canonical
        new Set([id, canonical]).forEach((location) =>
          setStore("location", location, (data) => ({
            providerDiscovery: { ...data?.providerDiscovery, [slot]: response.data },
          })),
        )
      })
    },
    invalidate(providerID?: string, connection?: ModelSourceConnectionRef, ref?: LocationRef) {
      discoveryReads(ref ?? defaultLocation(), providerID, connection).forEach(([key]) => sync.invalidate(key))
    },
  }

  const result = {
    on: config.event.on,
    listen: config.event.listen,
    session: {
      list() {
        return sessions()
      },
      get(sessionID: string) {
        return store.session.info[sessionID]
      },
      /** Whether this Data owner observed the canonical deletion event for the Session. */
      deleted(sessionID: string) {
        return store.session.removed[sessionID] === true
      },
      creating(sessionID: string) {
        return creating.has(sessionID)
      },
      remember(info: SessionInfo) {
        if (
          disposed ||
          (!sessionOutbox.has(info.id) && (store.session.info[info.id]?.time.updated ?? -Infinity) > info.time.updated)
        )
          return
        batch(() => {
          setStore(
            "session",
            "removed",
            produce((draft) => {
              delete draft[info.id]
            }),
          )
          setStore(
            "session",
            "info",
            info.id,
            reconcile({
              ...info,
              time: {
                ...info.time,
                message: Math.max(info.time.message ?? 0, store.session.info[info.id]?.time.message ?? 0) || undefined,
              },
            }),
          )
          sync.complete(`session:${info.id}`)
          registerSession(info.id)
        })
      },
      async selectExecutor(input: { sessionID: string; executorPreference: SessionExecutorPreference }) {
        const client = api()
        const info = await client.session.selectExecutor({
          sessionID: input.sessionID,
          payload: input.executorPreference,
        })
        if (disposed || api() !== client || !store.session.info[input.sessionID]) return info
        // Cache publication must not mutate the canonical mutation response.
        result.session.remember(structuredClone(info))
        return info
      },
      setStatus(sessionID: string, status: DataSessionStatus) {
        setSessionActive(sessionID, status)
      },
      root(sessionID: string) {
        return resolveRoot(sessionID)
      },
      family(sessionID: string) {
        return store.session.family[resolveRoot(sessionID)] ?? []
      },
      /** Clear heavy cached data for the root and all known descendants. */
      evict(sessionID: string) {
        const root = resolveRoot(sessionID)
        batch(() => {
          for (const id of new Set([root, sessionID, ...(store.session.family[root] ?? [])])) evictSession(id)
        })
      },
      cost(sessionID: string) {
        const session = store.session.info[sessionID]
        if (!session) return 0
        if (session.parentID) return session.cost
        return (store.session.family[sessionID] ?? [sessionID]).reduce(
          (total, id) => total + (store.session.info[id]?.cost ?? 0),
          0,
        )
      },
      status(sessionID: string) {
        return store.session.active[sessionID] ?? "idle"
      },
      active() {
        return Object.entries(store.session.active).flatMap(([sessionID, status]) =>
          status === "running" ? [sessionID] : [],
        )
      },
      task: {
        list(sessionID: string) {
          return store.session.task[sessionID]?.items
        },
        sync(sessionID: string) {
          const cache = taskCache(sessionID)
          if (!cache) return Promise.resolve()
          return sync.run(taskKey(sessionID), async (current) => {
            if (disposed || store.session.task[sessionID] !== cache || !current()) return
            const tasks = await api()["session-instance"].session.instance.session.task.get(taskInput({ sessionID }))
            if (disposed || store.session.task[sessionID] !== cache || !current()) return
            setStore("session", "task", sessionID, "items", reconcile(tasks))
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(taskKey(sessionID))
        },
        async create(input: SessionInstanceSessionInstanceSessionTaskCreateInput) {
          const cache = taskCache(input.sessionID)
          const created = await api()["session-instance"].session.instance.session.task.create(taskInput(input))
          invalidateTaskMutation(input.sessionID, cache)
          return created
        },
        async patch(input: SessionInstanceSessionInstanceSessionTaskPatchInput) {
          const cache = taskCache(input.sessionID)
          const updated = await api()["session-instance"].session.instance.session.task.patch(taskInput(input))
          invalidateTaskMutation(input.sessionID, cache)
          return updated
        },
        async remove(input: SessionInstanceSessionInstanceSessionTaskDeleteInput) {
          const cache = taskCache(input.sessionID)
          const removed = await api()["session-instance"].session.instance.session.task.delete(taskInput(input))
          invalidateTaskMutation(input.sessionID, cache)
          return removed
        },
        operation: {
          list(sessionID: string, taskID?: string) {
            const cache = store.session.operation[sessionID]
            const owner = operationOwners.get(sessionID)
            if (
              disposed ||
              owner?.client !== api() ||
              owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) ||
              !cache?.listed
            )
              return undefined
            return Object.values(cache.items).filter((value) => taskID === undefined || value.taskID === taskID)
          },
          get(sessionID: string, operationID: string) {
            const cache = store.session.operation[sessionID]
            const owner = operationOwners.get(sessionID)
            if (
              disposed ||
              owner?.client !== api() ||
              owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
            )
              return undefined
            return cache?.items[operationID]
          },
          sync(sessionID: string) {
            return readOperation(sessionID)
          },
          readback(sessionID: string, operationID: string) {
            sync.invalidate(`session.task.operation:${sessionID}:${operationID}`)
            return readOperation(sessionID, operationID)
          },
          invalidate(sessionID: string) {
            operationOwners.get(sessionID)?.keys.forEach((key) => sync.invalidate(key))
          },
          async dispatch(input: { sessionID: string; request: SessionTaskOperationRequest }) {
            const lease = operationCache(input.sessionID)
            const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
            const value = await api()["session-instance"].session.instance.session.task.dispatch({
              sessionID: input.sessionID,
              directory: location.directory,
              workspace: location.workspaceID,
              payload: input.request,
            })
            rememberOperation(input.sessionID, value, lease)
            return value
          },
          async cancel(input: { sessionID: string; operationID: string }) {
            const lease = operationCache(input.sessionID)
            const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
            const value = await api()["session-instance"].session.instance.session.task.cancelOperation({
              sessionID: input.sessionID,
              operationID: input.operationID,
              directory: location.directory,
              workspace: location.workspaceID,
            })
            rememberOperation(input.sessionID, value, lease)
            return value
          },
        },
      },
      goal: {
        list(sessionID: string) {
          const cache = store.session.goal[sessionID]
          const owner = goalOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) ||
            !cache?.listed
          )
            return undefined
          return Object.values(cache.items).toSorted(
            (left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id),
          )
        },
        get(sessionID: string, goalID: string) {
          const cache = store.session.goal[sessionID]
          const owner = goalOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          )
            return
          return cache?.items[goalID]
        },
        sync(sessionID: string) {
          return readGoal(sessionID)
        },
        readback(sessionID: string, goalID: string) {
          sync.invalidate(`session.goal:${sessionID}:${goalID}`)
          return readGoal(sessionID, goalID)
        },
        invalidate(sessionID: string) {
          goalOwners.get(sessionID)?.keys.forEach((key) => sync.invalidate(key))
        },
        async set(input: SessionGoalSetInput) {
          const lease = goalCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionGoal.set({
            ...input,
            directory: input.directory ?? lease?.location.directory,
            workspace: input.workspace ?? lease?.location.workspaceID,
          })
          rememberGoal(input.sessionID, value, lease, before)
          return value
        },
        async edit(input: SessionGoalEditInput) {
          const lease = goalCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionGoal.edit({
            ...input,
            directory: input.directory ?? lease?.location.directory,
            workspace: input.workspace ?? lease?.location.workspaceID,
          })
          rememberGoal(input.sessionID, value, lease, before)
          return value
        },
        async pause(input: SessionGoalPauseInput) {
          const lease = goalCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionGoal.pause({
            ...input,
            directory: input.directory ?? lease?.location.directory,
            workspace: input.workspace ?? lease?.location.workspaceID,
          })
          rememberGoal(input.sessionID, value, lease, before)
          return value
        },
        async resume(input: SessionGoalResumeInput) {
          const lease = goalCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionGoal.resume({
            ...input,
            directory: input.directory ?? lease?.location.directory,
            workspace: input.workspace ?? lease?.location.workspaceID,
          })
          rememberGoal(input.sessionID, value, lease, before)
          return value
        },
        async cancel(input: SessionGoalCancelInput) {
          const lease = goalCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionGoal.cancel({
            ...input,
            directory: input.directory ?? lease?.location.directory,
            workspace: input.workspace ?? lease?.location.workspaceID,
          })
          rememberGoal(input.sessionID, value, lease, before)
          return value
        },
        async confirm(input: SessionGoalConfirmInput) {
          const lease = goalCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionGoal.confirm({
            ...input,
            directory: input.directory ?? lease?.location.directory,
            workspace: input.workspace ?? lease?.location.workspaceID,
          })
          rememberGoal(input.sessionID, value, lease, before)
          return value
        },
      },
      communication: {
        list(sessionID: string) {
          const cache = store.session.communication[sessionID]
          const owner = communicationOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) ||
            !cache?.listed
          )
            return undefined
          return Object.values(cache.items).toSorted(
            (left, right) => Number(right.createdAt) - Number(left.createdAt) || left.id.localeCompare(right.id),
          )
        },
        get(sessionID: string, communicationID: string) {
          const cache = store.session.communication[sessionID]
          const owner = communicationOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          )
            return
          return cache?.items[communicationID]
        },
        capability(sessionID: string) {
          const cache = store.session.communication[sessionID]
          const owner = communicationOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          )
            return
          return cache?.capability
        },
        next(sessionID: string) {
          const cache = store.session.communication[sessionID]
          const owner = communicationOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          )
            return
          return cache?.next
        },
        version(sessionID: string) {
          const cache = store.session.communication[sessionID]
          const owner = communicationOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          )
            return 0
          return cache?.version ?? 0
        },
        sync(sessionID: string) {
          return readCommunication(sessionID)
        },
        more(sessionID: string) {
          const cursor = result.session.communication.next(sessionID)
          if (!cursor) return Promise.resolve()
          // A refreshed first page may revisit an already loaded cursor. Read that page again before advancing.
          sync.invalidate(`session.communication:${sessionID}:page:${cursor}`)
          return readCommunication(sessionID, { cursor })
        },
        readback(sessionID: string, communicationID: string) {
          sync.invalidate(`session.communication:${sessionID}:message:${communicationID}`)
          return readCommunication(sessionID, { communicationID })
        },
        invalidate(sessionID: string) {
          communicationOwners.get(sessionID)?.keys.forEach((key) => sync.invalidate(key))
        },
        async send(input: SessionCommunicationSendInput, options?: RequestOptions) {
          const lease = communicationCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionCommunication.send(
            {
              ...input,
              directory: input.directory ?? lease?.location.directory,
              workspace: input.workspace ?? lease?.location.workspaceID,
            },
            options,
          )
          rememberCommunication(input.sessionID, value, lease, before)
          result.session.communication.invalidate(input.sessionID)
          return value
        },
        async reply(input: SessionCommunicationReplyInput, options?: RequestOptions) {
          const lease = communicationCache(input.sessionID)
          const before = structuredClone(unwrap(lease?.cache.items ?? {}))
          const value = await api().sessionCommunication.reply(
            {
              ...input,
              directory: input.directory ?? lease?.location.directory,
              workspace: input.workspace ?? lease?.location.workspaceID,
            },
            options,
          )
          rememberCommunication(input.sessionID, value, lease, before)
          result.session.communication.invalidate(input.sessionID)
          return value
        },
      },
      schedule: {
        list(sessionID: string) {
          const cache = store.session.schedule[sessionID]
          const owner = scheduleOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) ||
            !cache?.listed
          )
            return undefined
          return Object.values(cache.rules).toSorted(
            (left, right) => Number(right.createdAt) - Number(left.createdAt) || left.id.localeCompare(right.id),
          )
        },
        get(sessionID: string, scheduleID: string) {
          const cache = store.session.schedule[sessionID]
          const owner = scheduleOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          )
            return
          return cache?.rules[scheduleID]
        },
        runs(sessionID: string, scheduleID: string) {
          const cache = store.session.schedule[sessionID]
          const owner = scheduleOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) ||
            !cache?.runsListed[scheduleID]
          )
            return
          return Object.values(cache.occurrences)
            .filter((value) => value.scheduleID === scheduleID)
            .toSorted(
              (left, right) => Number(right.scheduledAt) - Number(left.scheduledAt) || left.id.localeCompare(right.id),
            )
        },
        occurrence(sessionID: string, occurrenceID: string) {
          const cache = store.session.schedule[sessionID]
          const owner = scheduleOwners.get(sessionID)
          if (
            disposed ||
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          )
            return
          return cache?.occurrences[occurrenceID]
        },
        sync(sessionID: string) {
          return readSchedule(sessionID)
        },
        syncRuns(sessionID: string, scheduleID: string) {
          return readSchedule(sessionID, scheduleID)
        },
        invalidate(sessionID: string) {
          scheduleOwners.get(sessionID)?.keys.forEach((key) => sync.invalidate(key))
        },
        async create(input: Omit<ScheduleCreateInput, "directory" | "workspace">) {
          const sessionID = input.payload.sessionID
          const lease = scheduleCache(sessionID)
          const location: LocationRef = store.session.info[sessionID]?.location ?? defaultLocation()
          const before = structuredClone(unwrap(lease?.cache.rules ?? {}))
          const value = await api().schedule.create({
            ...input,
            directory: location.directory,
            workspace: location.workspaceID,
          })
          rememberScheduleRule(sessionID, value, lease, before)
          return value
        },
        async edit(input: Omit<ScheduleEditInput, "directory" | "workspace"> & { sessionID: string }) {
          const lease = scheduleCache(input.sessionID)
          const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
          const before = structuredClone(unwrap(lease?.cache.rules ?? {}))
          const value = await api().schedule.edit({
            id: input.id,
            payload: input.payload,
            directory: location.directory,
            workspace: location.workspaceID,
          })
          rememberScheduleRule(input.sessionID, value, lease, before)
          return value
        },
        async pause(input: Omit<SchedulePauseInput, "directory" | "workspace"> & { sessionID: string }) {
          const lease = scheduleCache(input.sessionID)
          const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
          const before = structuredClone(unwrap(lease?.cache.rules ?? {}))
          const value = await api().schedule.pause({
            id: input.id,
            payload: input.payload,
            directory: location.directory,
            workspace: location.workspaceID,
          })
          rememberScheduleRule(input.sessionID, value, lease, before)
          return value
        },
        async resume(input: Omit<ScheduleResumeInput, "directory" | "workspace"> & { sessionID: string }) {
          const lease = scheduleCache(input.sessionID)
          const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
          const before = structuredClone(unwrap(lease?.cache.rules ?? {}))
          const value = await api().schedule.resume({
            id: input.id,
            payload: input.payload,
            directory: location.directory,
            workspace: location.workspaceID,
          })
          rememberScheduleRule(input.sessionID, value, lease, before)
          return value
        },
        async cancel(input: Omit<ScheduleCancelRuleInput, "directory" | "workspace"> & { sessionID: string }) {
          const lease = scheduleCache(input.sessionID)
          const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
          const before = structuredClone(unwrap(lease?.cache.rules ?? {}))
          const value = await api().schedule.cancelRule({
            id: input.id,
            payload: input.payload,
            directory: location.directory,
            workspace: location.workspaceID,
          })
          rememberScheduleRule(input.sessionID, value, lease, before)
          return value
        },
        async run(input: Omit<ScheduleRunOnceInput, "directory" | "workspace"> & { sessionID: string }) {
          const lease = scheduleCache(input.sessionID)
          const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
          const before = structuredClone(unwrap(lease?.cache.occurrences ?? {}))
          const value = await api().schedule.runOnce({
            id: input.id,
            payload: input.payload,
            directory: location.directory,
            workspace: location.workspaceID,
          })
          rememberOccurrence(input.sessionID, value, lease, before)
          result.session.schedule.invalidate(input.sessionID)
          return value
        },
        async cancelRun(input: Omit<ScheduleCancelRunInput, "directory" | "workspace"> & { sessionID: string }) {
          const lease = scheduleCache(input.sessionID)
          const location: LocationRef = store.session.info[input.sessionID]?.location ?? defaultLocation()
          const before = structuredClone(unwrap(lease?.cache.occurrences ?? {}))
          const value = await api().schedule.cancelRun({
            occurrenceID: input.occurrenceID,
            directory: location.directory,
            workspace: location.workspaceID,
          })
          rememberOccurrence(input.sessionID, value, lease, before)
          return value
        },
      },
      delegation: {
        readResult(sessionID: string, input: Omit<DelegationResultInput, "directory" | "workspace">) {
          return api().delegation.result({
            ...input,
            directory: store.session.info[sessionID]?.location.directory ?? defaultLocation().directory,
          })
        },
        list(sessionID: string) {
          const items = store.session.delegation[sessionID]?.items
          const owner = delegationOwners.get(sessionID)
          if (owner?.client !== api()) return undefined
          if (owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation()))
            return undefined
          return items
        },
        remember(sessionID: string, value: DelegationLegacyState) {
          const owner = delegationOwners.get(sessionID)
          if (disposed || owner?.client !== api() || value.delegation.parentSessionID !== sessionID) return
          if (owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation())) return
          const items = store.session.delegation[sessionID]?.items ?? []
          setStore(
            "session",
            "delegation",
            sessionID,
            "items",
            reconcile([...items.filter((item) => item.delegation.id !== value.delegation.id), structuredClone(value)]),
          )
        },
        sync(sessionID: string) {
          if (disposed) return Promise.resolve()
          const client = api()
          const location = store.session.info[sessionID]?.location ?? defaultLocation()
          const key = `session.delegation:${sessionID}`
          const owner = delegationOwners.get(sessionID)
          if (owner?.client !== client || owner.location !== locationKey(location)) {
            sync.forget(key)
            setStore("session", "delegation", sessionID, reconcile({}))
            delegationOwners.set(sessionID, { client, location: locationKey(location) })
          }
          const cache = store.session.delegation[sessionID]
          return sync.run(key, async (current) => {
            const items = await client.delegation.list({
              parentSessionID: sessionID,
              includeArchived: true,
              directory: location.directory,
            })
            if (disposed || store.session.delegation[sessionID] !== cache || !current()) return
            if (
              api() !== client ||
              locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== locationKey(location)
            ) {
              sync.invalidate(key)
              return
            }
            setStore("session", "delegation", sessionID, "items", reconcile(items))
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.delegation:${sessionID}`)
        },
        receipts(sessionID: string) {
          return (store.session.message[sessionID] ?? []).flatMap((message) => {
            if (message.type !== "assistant") return []
            return message.content.flatMap((call) => {
              if (call.type !== "tool") return []
              if (call.state.status === "streaming") return []
              const decoded = decodeDelegationReceipt(call.state.metadata)
              if (Option.isNone(decoded)) return []
              return [
                {
                  ...decoded.value,
                  source: { messageID: message.id, id: call.id },
                  text:
                    call.state.status === "completed"
                      ? call.state.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
                      : undefined,
                },
              ]
            })
          })
        },
      },
      workflow: {
        get(sessionID: string) {
          const value = store.session.workflow[sessionID]?.value
          const owner = workflowOwners.get(sessionID)
          if (
            owner?.client !== api() ||
            owner.directory !== (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory)
          )
            return undefined
          return value
        },
        sync(sessionID: string) {
          if (disposed) return Promise.resolve()
          const client = api()
          const directory = store.session.info[sessionID]?.location.directory ?? defaultLocation().directory
          const key = `session.workflow:${sessionID}`
          const owner = workflowOwners.get(sessionID)
          if (owner?.client !== client || owner.directory !== directory) {
            sync.forget(key)
            setStore("session", "workflow", sessionID, reconcile({}))
            workflowOwners.set(sessionID, { client, directory })
          }
          const cache = store.session.workflow[sessionID]
          return sync.run(key, async (current) => {
            const value = await client["session-instance"].session.instance.session.workflow.get({
              sessionID,
              directory,
            })
            if (
              disposed ||
              api() !== client ||
              !current() ||
              store.session.workflow[sessionID] !== cache ||
              (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory) !== directory
            )
              return
            setStore("session", "workflow", sessionID, "value", reconcile(value))
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.workflow:${sessionID}`)
        },
      },
      cache: {
        get(sessionID: string) {
          const value = store.session.cache[sessionID]?.value
          const owner = cacheOwners.get(sessionID)
          if (
            owner?.client !== api() ||
            owner.directory !== (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory)
          )
            return undefined
          return value
        },
        sync(sessionID: string) {
          if (disposed) return Promise.resolve()
          const client = api()
          const directory = store.session.info[sessionID]?.location.directory ?? defaultLocation().directory
          const key = `session.cache:${sessionID}`
          const owner = cacheOwners.get(sessionID)
          if (owner?.client !== client || owner.directory !== directory) {
            sync.forget(key)
            setStore("session", "cache", sessionID, reconcile({}))
            cacheOwners.set(sessionID, { client, directory })
          }
          const cache = store.session.cache[sessionID]
          return sync.run(key, async (current) => {
            const value = await client["session-instance"].session.instance.session.cacheDiagnostics({
              sessionID,
              directory,
            })
            if (
              disposed ||
              api() !== client ||
              !current() ||
              store.session.cache[sessionID] !== cache ||
              (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory) !== directory
            )
              return
            setStore("session", "cache", sessionID, "value", reconcile(value))
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.cache:${sessionID}`)
        },
      },
      artifact: {
        apply(input: WorkArtifactApplyInput) {
          return api()["work-artifact"].apply(taskInput(input))
        },
      },
      identity: {
        get(sessionID: string) {
          const value = store.session.identity[sessionID]?.value
          if (disposed || (config.connection && config.connection.status() !== "connected")) return undefined
          const owner = identityOwners.get(sessionID)
          if (
            owner?.client !== api() ||
            owner.location !== locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) ||
            owner.agent !== store.session.info[sessionID]?.agent
          )
            return undefined
          return value
        },
        sync(sessionID: string) {
          if (disposed) return Promise.resolve()
          const client = api()
          const location: LocationRef = store.session.info[sessionID]?.location ?? defaultLocation()
          const agent = store.session.info[sessionID]?.agent
          const key = `session.identity:${sessionID}`
          const owner = identityOwners.get(sessionID)
          if (owner?.client !== client || owner.location !== locationKey(location) || owner.agent !== agent) {
            sync.forget(key)
            setStore("session", "identity", sessionID, reconcile({}))
            identityOwners.set(sessionID, {
              client,
              location: locationKey(location),
              agent,
              selected: owner?.client === client && owner.selected?.agent === agent ? owner.selected : undefined,
            })
          }
          const lease = identityOwners.get(sessionID)
          const cache = store.session.identity[sessionID]
          return sync.run(key, async (current) => {
            const value = await client["session-instance"].session.instance.session.identity({
              sessionID,
              directory: location.directory,
              workspace: location.workspaceID,
            })
            if (
              disposed ||
              !current() ||
              store.session.identity[sessionID] !== cache ||
              identityOwners.get(sessionID) !== lease
            )
              return
            if (
              api() !== client ||
              (config.connection && config.connection.status() !== "connected") ||
              locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== locationKey(location) ||
              store.session.info[sessionID]?.agent !== agent ||
              (agent !== undefined && value.agent !== agent) ||
              (lease?.selected && value.coordination?.selection.event?.id !== lease.selected.eventID)
            ) {
              sync.invalidate(key)
              return
            }
            setStore("session", "identity", sessionID, "value", reconcile(value))
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.identity:${sessionID}`)
          if (store.session.identity[sessionID]) setStore("session", "identity", sessionID, "value", undefined)
        },
      },
      meta: {
        get(sessionID: string) {
          const value = store.session.meta[sessionID]?.value
          const owner = metaOwners.get(sessionID)
          if (
            owner?.client !== api() ||
            owner.directory !== (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory)
          )
            return undefined
          return value
        },
        sync(sessionID: string) {
          if (disposed) return Promise.resolve()
          const client = api()
          const directory = store.session.info[sessionID]?.location.directory ?? defaultLocation().directory
          const key = `session.meta:${sessionID}`
          const owner = metaOwners.get(sessionID)
          if (owner?.client !== client || owner.directory !== directory) {
            sync.forget(key)
            setStore("session", "meta", sessionID, reconcile({}))
            metaOwners.set(sessionID, { client, directory })
          }
          const cache = store.session.meta[sessionID]
          return sync.run(key, async (current) => {
            const value = await client["session-instance"].session.instance.session.meta({ sessionID, directory })
            if (
              disposed ||
              api() !== client ||
              !current() ||
              store.session.meta[sessionID] !== cache ||
              (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory) !== directory
            )
              return
            setStore("session", "meta", sessionID, "value", reconcile(value))
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.meta:${sessionID}`)
        },
      },
      projectMemory: {
        list(sessionID: string) {
          const items = store.session.facts[sessionID]?.items
          const owner = factOwners.get(sessionID)
          if (
            owner?.client !== api() ||
            owner.directory !== (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory)
          )
            return undefined
          return items
        },
        sync(sessionID: string, filter: { category?: MetaAgentFactCategory; keyword?: string } = {}) {
          if (disposed) return Promise.resolve()
          const client = api()
          const directory = store.session.info[sessionID]?.location.directory ?? defaultLocation().directory
          const key = `session.facts:${sessionID}`
          const query = JSON.stringify([filter.category, filter.keyword])
          const owner = factOwners.get(sessionID)
          if (owner?.client !== client || owner.directory !== directory || owner.query !== query) {
            sync.forget(key)
            setStore("session", "facts", sessionID, reconcile({}))
            factOwners.set(sessionID, { client, directory, query })
          }
          const cache = store.session.facts[sessionID]
          return sync.run(key, async (current) => {
            const items = await client["session-instance"].session.instance.session.projectMemory.get({
              sessionID,
              directory,
              ...filter,
            })
            if (
              disposed ||
              api() !== client ||
              !current() ||
              store.session.facts[sessionID] !== cache ||
              (store.session.info[sessionID]?.location.directory ?? defaultLocation().directory) !== directory
            )
              return
            setStore("session", "facts", sessionID, "items", reconcile(items))
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.facts:${sessionID}`)
        },
        async remove(input: { sessionID: string; id: string }) {
          const client = api()
          const cache = store.session.facts[input.sessionID]
          await client["session-instance"].session.instance.session.projectMemory.remove(taskInput(input))
          if (disposed || api() !== client || store.session.facts[input.sessionID] !== cache) return
          if (cache?.items)
            setStore(
              "session",
              "facts",
              input.sessionID,
              "items",
              reconcile(cache.items.filter((item) => item.id !== input.id)),
            )
          sync.invalidate(`session.facts:${input.sessionID}`)
        },
      },
      // Inputs are the pending user and synthetic items; compactions are control items.
      input: {
        list(sessionID: string) {
          return (store.session.pending[sessionID] ?? []).flatMap((item) =>
            item.type === "compaction" ? [] : [item.id],
          )
        },
        has(sessionID: string, inboxID: string) {
          return (
            store.session.pending[sessionID]?.some((item) => item.id === inboxID && item.type !== "compaction") ?? false
          )
        },
      },
      pending: {
        list(sessionID: string) {
          return store.session.pending[sessionID] ?? []
        },
        // An execution's idle boundary promotes every pending steer at once, so a steer only waits behind work
        // once the current execution has delivered input.
        status(sessionID: string, inboxID: string): DataPendingStatus | undefined {
          const pending = store.session.pending[sessionID] ?? []
          const item = pending.find((entry) => entry.id === inboxID && entry.type === "user")
          if (!item) return undefined
          if (item.delivery === "queue") return "queued"
          const messages = store.session.message[sessionID] ?? []
          const boundary = messages.findLastIndex((entry) => entry.type === "idle")
          if ((store.session.active[sessionID] ?? "idle") === "idle")
            return boundary >= 0 && item.time.created <= messages[boundary].time.created ? "stranded" : "starting"
          return messages
            .slice(boundary + 1)
            .some((entry) => entry.type === "user" && !pending.some((other) => other.id === entry.id))
            ? "steering"
            : "starting"
        },
        sync(sessionID: string) {
          const key = `session.pending:${sessionID}`
          return sync.run(key, async (current) => {
            const client = api()
            if (disposed || !current()) return
            const updates = new Map<string, SessionInboxInfo | SessionInbox.Delivery | undefined>()
            pendingUpdates.set(sessionID, updates)
            try {
              const snapshot = await client.session.inbox.list({ sessionID })
              if (disposed || !current()) return
              if (api() !== client) {
                sync.invalidate(key)
                return
              }
              // Events can overtake this HTTP response on a remote connection.
              // Reconcile them before an older snapshot can resurrect delivered input.
              const entries = new Map(snapshot.map((item) => [item.id, item]))
              updates.forEach((item, id) => {
                if (item === undefined) entries.delete(id)
                else if (typeof item === "string") {
                  const existing = entries.get(id)
                  if (existing) entries.set(id, { ...existing, delivery: item })
                } else entries.set(id, item)
              })
              const pending = [...entries.values()]
              // A positive read acknowledges admission even when its SSE echo is delayed.
              pending.forEach((item) => outbox.delete(item.id))
              // Compactions also coalesce by Session, not just by the proposed ID.
              if (pending.some((item) => item.type === "compaction"))
                store.session.pending[sessionID]
                  ?.filter((item) => item.type === "compaction")
                  .forEach((item) => outbox.delete(item.id))
              // Keep optimistic rows still awaiting their echo: this fetch may
              // have raced ahead of an in-flight admission the server does not
              // know about yet.
              const inflight = (store.session.pending[sessionID] ?? []).filter((item) => outbox.has(item.id))
              const merged = inflight.length === 0 ? pending : [...pending, ...inflight]
              batch(() => {
                setStore("session", "pending", sessionID, reconcile(merged))
                merged.forEach(materializeInboxMessage)
              })
            } finally {
              if (pendingUpdates.get(sessionID) === updates) pendingUpdates.delete(sessionID)
            }
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.pending:${sessionID}`)
        },
      },
      // Optimistic session creation: admit a local record under a
      // client-minted ID so a session view can mount immediately, then create
      // the session on the server. The session.created echo re-syncs the
      // record by ID, so the durable payload replaces the client's guess.
      // Returns the ID synchronously along with the in-flight request:
      // callers gate session-dependent sends on the request (prompt() gates
      // itself on any in-flight create of its session automatically).
      create(input: {
        id?: string
        title?: string
        mode?: ProductMode.GenericSessionMode
        agent?: string
        control?: "meta"
        executorPreference?: SessionExecutorPreference
        model?: ModelSelection
        location?: LocationRef
        projectID?: string
      }) {
        const { projectID, ...payload } = input
        const id = payload.id ?? SessionID.create()
        const location = payload.location ?? defaultLocation()
        const fresh = !store.session.info[id]
        if (fresh) {
          const now = Date.now()
          sessionOutbox.add(id)
          result.session.remember({
            id,
            projectID: projectID ?? store.location[locationKey(location)]?.info?.project.id ?? "",
            mode: payload.mode ?? ProductMode.Default,
            agent: payload.agent,
            model: payload.model,
            executorPreference: payload.executorPreference,
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: now, updated: now },
            title: payload.title,
            location,
          })
          // A mounted optimistic session must not fetch its empty collections
          // before creation settles. The session.created echo re-syncs info.
          sync.complete(`session.family:${id}`)
          sync.complete(`session.pending:${id}`)
          sync.complete(`session.message:${id}`)
        }
        // Wrapped so even a synchronous client failure reaches the rollback.
        const client = api()
        const request = Promise.resolve()
          .then(() => client.session.create({ ...payload, id, location }))
          .then((info) => {
            if (disposed || api() !== client || (fresh && !store.session.info[id])) return info
            result.session.remember(structuredClone(info))
            sessionOutbox.delete(id)
            return info
          })
          .catch((error) => {
            if (disposed || api() !== client) throw error
            // Roll back only a record this call admitted and neither the echo
            // nor the response has acknowledged: anything else is server state.
            if (fresh && sessionOutbox.delete(id)) removeSession(id)
            throw error
          })
        if (fresh) track(creating, id, request)
        return { id, request }
      },
      compact(input: { sessionID: string; model?: ModelRef }) {
        const active = compacting.get(input.sessionID)
        if (active) return active.request
        // A known pending control ID may be consumed while setup waits. Propose
        // a fresh ID and let the server coalesce, without duplicating its row.
        const id = SessionMessage.ID.create()
        if (!store.session.pending[input.sessionID]?.some((item) => item.type === "compaction")) {
          outbox.add(id)
          admitLocal({
            id,
            sessionID: input.sessionID,
            time: { created: Date.now() },
            type: "compaction",
            delivery: "steer",
            payload: {},
          })
        }
        // Compaction admission can coalesce onto a different ID. Retire the
        // speculative row on an echo, and remember consumed IDs until the POST
        // settles so its older response cannot resurrect a queued row.
        const observed = new Set<string>()
        const request = sendAdmission(input.sessionID, async () => {
          if (input.model) await api().session.switchModel({ sessionID: input.sessionID, model: input.model })
          return api().session.compact({ sessionID: input.sessionID, id })
        })
          .then((item) => {
            batch(() => {
              outbox.delete(id)
              if (item.id !== id) removePending(input.sessionID, id)
              if (!observed.has(item.id) && !messageIndex.get(input.sessionID)?.has(item.id)) admitLocal(item)
            })
            return item
          })
          .catch((error) => {
            if (outbox.delete(id)) removePending(input.sessionID, id)
            throw error
          })
          .finally(() => {
            if (compacting.get(input.sessionID)?.request === request) compacting.delete(input.sessionID)
          })
        compacting.set(input.sessionID, { id, observed, request })
        return request
      },
      // Optimistic prompt admission: render the prompt immediately under a
      // client-minted ID, send it, and let the durable inbox.enqueued echo
      // upsert that same ID with the server's payload. Server admission is
      // idempotent per ID, so retrying with the identical payload cannot
      // double-admit.
      prompt(input: SessionPromptInput & { gate?: Promise<unknown>; prepare?: () => Promise<unknown> }) {
        const client = api()
        const { gate, prepare, ...request } = input
        const id = request.id ?? SessionMessage.ID.create()
        // A retry may reuse an ID that is already rendered — and possibly
        // already durable. Admit optimistically only for new IDs so a failed
        // retry cannot roll back acknowledged state.
        const fresh =
          !messageIndex.get(request.sessionID)?.has(id) &&
          !store.session.pending[request.sessionID]?.some((item) => item.id === id)
        if (fresh) {
          outbox.add(id)
          admitLocal({
            id,
            sessionID: request.sessionID,
            time: { created: Date.now() },
            type: "user",
            delivery: request.delivery ?? "steer",
            // Files and skills stay off the optimistic row: their durable
            // forms are server-loaded (content, mime, resolution), so they
            // fill in when the echo upserts the row.
            payload: {
              text: request.text,
              agents: request.agents?.map((agent) => ({ ...agent })),
              metadata: request.metadata,
            },
          })
        }
        return sendAdmission(
          request.sessionID,
          async () => {
            if (disposed || api() !== client)
              throw new ClientError("Transport", { detail: "Session admission owner changed" })
            await prepare?.()
            if (disposed || api() !== client)
              throw new ClientError("Transport", { detail: "Session admission owner changed" })
            return client.session.prompt({ ...request, id })
          },
          gate,
        ).catch((error) => {
          if (disposed || api() !== client) throw error
          // Roll back only rows this call admitted and the server has not
          // acknowledged: anything else is server state.
          if (fresh && outbox.delete(id)) retractLocal(request.sessionID, id)
          throw error
        })
      },
      async sync(sessionID: string, options?: { children?: boolean }) {
        await result.session.readback(sessionID, options)
      },
      async readback(sessionID: string, options?: { children?: boolean }) {
        // A joined or discarded read cannot acknowledge this caller's selection.
        let adopted: { client: AigcForgeClient; info: SessionInfo } | undefined
        await sync.run(options?.children ? `session.family:${sessionID}` : `session:${sessionID}`, async (current) => {
          const client = api()
          if (disposed || !current()) return
          const [info, children] = await Promise.all([
            client.session.get({ sessionID }),
            options?.children
              ? client.session.list({ parentID: sessionID, order: "desc" }).then((response) => response.data)
              : [],
          ])
          if (disposed || api() !== client || !current()) return
          const sessions = [info, ...children]
          const accepted = sessions.filter(
            (session) => (store.session.info[session.id]?.time.updated ?? -Infinity) <= session.time.updated,
          )
          batch(() => {
            setStore(
              "session",
              "info",
              produce((draft) => {
                for (const session of accepted) {
                  // Store events can mutate the cached object during publication.
                  const canonical = session === info ? structuredClone(info) : undefined
                  draft[session.id] = {
                    ...session,
                    time: {
                      ...session.time,
                      message: Math.max(session.time.message ?? 0, draft[session.id]?.time.message ?? 0) || undefined,
                    },
                  }
                  if (canonical) adopted = { client, info: canonical }
                }
              }),
            )
            setStore(
              "session",
              "removed",
              produce((draft) => {
                for (const session of accepted) delete draft[session.id]
              }),
            )
            for (const session of sessions) {
              sync.complete(`session:${session.id}`)
              registerSession(session.id)
            }
          })
        })
        if (disposed || !adopted || api() !== adopted.client) return
        return adopted.info
      },
      invalidate(sessionID: string) {
        sync.invalidate(`session:${sessionID}`)
        result.session.identity.invalidate(sessionID)
      },
      message: {
        list(sessionID: string) {
          return store.session.message[sessionID] ?? []
        },
        get(sessionID: string, messageID: string) {
          const messages = store.session.message[sessionID]
          const position = messageIndex.get(sessionID)?.get(messageID)
          return position === undefined ? undefined : messages?.[position]
        },
        sync(sessionID: string) {
          const key = `session.message:${sessionID}`
          return sync.run(key, async (current) => {
            if (disposed || !current()) return
            await messageLoads.get(sessionID)?.catch(() => undefined)
            const client = api()
            if (disposed || !current()) return
            const before = new Map(
              (store.session.message[sessionID] ?? []).map((item) => [item.id, structuredClone(unwrap(item))]),
            )
            const response = await client.message.list({
              sessionID,
              limit: config.initialMessageLimit?.() ?? messagePageLimit,
              order: "desc",
            })
            if (disposed || !current()) return
            if (api() !== client) {
              sync.invalidate(key)
              return
            }
            const live = store.session.message[sessionID] ?? []
            // Preserve rows changed during this read, including delivered inputs that already left the inbox.
            // Unchanged cached rows still adopt the snapshot so reconnect can recover missed events.
            const updated = new Map(
              live
                .filter((item) => JSON.stringify(before.get(item.id)) !== JSON.stringify(item))
                .map((item) => [item.id, item]),
            )
            const fetched = response.data.toReversed().map((item) => {
              const current = updated.get(item.id)
              if (!current) return item
              const previous = before.get(item.id)
              return previous ? mergeMessageSnapshot(previous, current, item) : current
            })
            // Same protection as the pending sync: a re-fetch racing an
            // admission must not wipe its local transcript row.
            const ids = new Set(fetched.map((item) => item.id))
            const admitted = new Set(
              (store.session.pending[sessionID] ?? []).flatMap((item) =>
                item.type === "user" || item.type === "synthetic" ? [item.id] : [],
              ),
            )
            const local = live.filter(
              (item) => !ids.has(item.id) && (updated.has(item.id) || outbox.has(item.id) || admitted.has(item.id)),
            )
            const messages = local.length === 0 ? fetched : [...fetched, ...local]
            batch(() => {
              messageIndex.set(sessionID, new Map(messages.map((message, index) => [message.id, index])))
              setStore("session", "message", sessionID, reconcile(messages))
              setStore("session", "messageCursor", sessionID, response.cursor.next ?? undefined)
            })
          })
        },
        more(sessionID: string) {
          return store.session.messageCursor[sessionID] !== undefined
        },
        loading(sessionID: string) {
          return store.session.messageLoading[sessionID] ?? false
        },
        async loadMore(
          sessionID: string,
          options?: {
            all?: boolean
            signal?: AbortSignal
            /** Runs synchronously inside the store-publication batch. */
            beforePublish?: () => void
          },
        ): Promise<void> {
          const signal = options?.signal
          if (disposed || signal?.aborted) return
          // Hydration owns the newest window and its cursor; older pages start after that publication.
          const reading = sync.wait(`session.message:${sessionID}`)
          if (reading) {
            if (!signal) await reading
            if (signal) {
              const aborted = Promise.withResolvers<void>()
              const cancel = () => aborted.resolve()
              signal.addEventListener("abort", cancel, { once: true })
              await Promise.race([reading, aborted.promise])
                .catch((error) => {
                  if (!signal.aborted) throw error
                })
                .finally(() => signal.removeEventListener("abort", cancel))
            }
            if (disposed || signal?.aborted) return
          }
          while (messageLoads.has(sessionID)) {
            const published = await (() => {
              const pending = messageLoads.get(sessionID)
              if (!signal) return pending
              const aborted = Promise.withResolvers<void>()
              const cancel = () => aborted.resolve()
              signal.addEventListener("abort", cancel, { once: true })
              return Promise.race([pending, aborted.promise])
                .catch((error) => {
                  if (!signal.aborted) throw error
                })
                .finally(() => signal.removeEventListener("abort", cancel))
            })()
            if ((!options?.all && published) || disposed || signal?.aborted) return
          }
          if (sync.wait(`session.message:${sessionID}`)) return result.session.message.loadMore(sessionID, options)
          const cursor = store.session.messageCursor[sessionID]
          if (!cursor || disposed || signal?.aborted) return
          const client = api()
          setStore("session", "messageLoading", sessionID, true)
          const request = Promise.resolve()
            .then(async () => {
              if (disposed || signal?.aborted || api() !== client || messageLoads.get(sessionID) !== request) return
              const fetched: SessionMessageInfo[] = []
              let next: string | undefined = cursor
              do {
                const response = await client.message.list(
                  {
                    sessionID,
                    limit: options?.all ? 200 : messagePageLimit,
                    cursor: next,
                  },
                  { signal },
                )
                if (disposed || signal?.aborted || api() !== client || messageLoads.get(sessionID) !== request) return
                fetched.push(...response.data)
                next = response.cursor.next ?? undefined
                if (!options?.all) break
              } while (next)
              // A jump through history publishes once, not once per page of offscreen messages.
              const existing = store.session.message[sessionID] ?? []
              const ids = new Set(existing.map((item) => item.id))
              const messages = [...fetched.reverse().filter((item) => !ids.has(item.id)), ...existing]
              batch(() => {
                options?.beforePublish?.()
                messageIndex.set(sessionID, new Map(messages.map((item, position) => [item.id, position])))
                setStore("session", "message", sessionID, reconcile(messages))
                setStore("session", "messageCursor", sessionID, next)
              })
              return true
            })
            .catch((error) => {
              if (!signal?.aborted) throw error
            })
            .finally(() => {
              if (disposed || messageLoads.get(sessionID) !== request) return
              setStore("session", "messageLoading", sessionID, false)
            })
          track(messageLoads, sessionID, request)
          await request
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.message:${sessionID}`)
          if (!messageLoads.delete(sessionID) || disposed) return
          setStore("session", "messageLoading", sessionID, false)
        },
      },
      permission: {
        list(sessionID: string) {
          return store.session.permission[sessionID]
        },
        sessions() {
          return Object.entries(store.session.permission).flatMap(([sessionID, requests]) =>
            requests.length > 0 ? [sessionID] : [],
          )
        },
        sync(sessionID: string) {
          const client = api()
          const location = locationKey(store.session.info[sessionID]?.location ?? defaultLocation())
          return sync.run(`session.permission:${sessionID}`, async (current) => {
            const requests = await client.permission.list({ sessionID })
            if (
              disposed ||
              !current() ||
              api() !== client ||
              locationKey(store.session.info[sessionID]?.location ?? defaultLocation()) !== location
            )
              return
            setStore("session", "permission", sessionID, requests)
          })
        },
        invalidate(sessionID: string) {
          sync.invalidate(`session.permission:${sessionID}`)
        },
        async reply(input: PermissionReplyInput) {
          await api()
            .permission.reply(input)
            .catch((error: unknown) => {
              if (!isPermissionNotFoundError(error)) throw error
            })
          removePermission(input.sessionID, input.requestID)
          identityOwners.forEach((_owner, sessionID) => result.session.identity.invalidate(sessionID))
        },
      },
      form: {
        list(sessionID: string, ref?: LocationRef) {
          const forms = store.session.form[sessionID]
          if (sessionID !== "global") return forms
          if (!ref) return
          const key = locationKey(ref)
          return forms?.filter((form) => form.location && locationKey(form.location) === key)
        },
        sessions() {
          return Object.entries(store.session.form).flatMap(([sessionID, forms]) =>
            sessionID !== "global" && forms.length > 0 ? [sessionID] : [],
          )
        },
        sync(sessionID: string, ref?: LocationRef) {
          const key = `session.form:${sessionID}:${sessionID === "global" ? locationKey(ref ?? defaultLocation()) : ""}`
          return sync.run(key, async () => {
            if (sessionID === "global") {
              const response = await api().form.list({
                location: locationQuery(ref ?? defaultLocation()),
              })
              const location = {
                directory: response.location.directory,
              }
              const locationID = locationKey(location)
              setStore("session", "form", sessionID, [
                ...(store.session.form[sessionID] ?? []).filter(
                  (form) => form.location && locationKey(form.location) !== locationID,
                ),
                ...response.data.filter((form) => form.sessionID === "global").map((form) => ({ ...form, location })),
              ])
              return
            }
            setStore("session", "form", sessionID, await api().session.form.list({ sessionID }))
          })
        },
        invalidate(sessionID: string, ref?: LocationRef) {
          sync.invalidate(
            `session.form:${sessionID}:${sessionID === "global" ? locationKey(ref ?? defaultLocation()) : ""}`,
          )
        },
        reply(input: SessionFormReplyInput, ref?: LocationRef) {
          return settleForm(input, ref, api().session.form.reply(input, formRequestOptions(input.sessionID, ref)))
        },
        cancel(input: SessionFormCancelInput, ref?: LocationRef) {
          return settleForm(input, ref, api().session.form.cancel(input, formRequestOptions(input.sessionID, ref)))
        },
      },
    },
    memory: {
      list() {
        const items = store.memory.items
        return memoryOwner === api() ? items : undefined
      },
      pending() {
        const items = store.memory.pending
        return memoryOwner === api() ? items : undefined
      },
      sync() {
        if (disposed) return Promise.resolve()
        const client = api()
        if (memoryOwner !== client) {
          sync.forget("memory")
          setStore("memory", reconcile({}))
          memoryOwner = client
        }
        const cache = store.memory
        return sync.run("memory", async (current) => {
          const [items, pending] = await Promise.all([client.memory.list(), client.memory.pending()])
          if (disposed || api() !== client || !current() || store.memory !== cache) return
          setStore("memory", reconcile({ items, pending }))
        })
      },
      invalidate() {
        sync.invalidate("memory")
      },
      async confirm(input: MemoryConfirmInput) {
        const client = api()
        const cache = store.memory
        const value = await client.memory.confirm(input)
        rememberMemory(client, cache, value)
        return value
      },
      async reject(input: MemoryRejectInput) {
        const client = api()
        const cache = store.memory
        const value = await client.memory.reject(input)
        rememberMemory(client, cache, value)
        return value
      },
      async edit(input: MemoryEditInput) {
        const client = api()
        const cache = store.memory
        const value = await client.memory.edit(input)
        rememberMemory(client, cache, value)
        return value
      },
      async remove(input: MemoryRemoveInput) {
        const client = api()
        const cache = store.memory
        const value = await client.memory.remove(input)
        rememberMemory(client, cache, value)
        return value
      },
    },
    project: {
      list() {
        return Object.values(store.project.info).toSorted((a, b) => b.time.active - a.time.active)
      },
      get(projectID: string) {
        return store.project.info[projectID]
      },
      sync() {
        return sync.run("project", async () => {
          const projects = await api().project.list()
          setStore("project", "info", reconcile(Object.fromEntries(projects.map((project) => [project.id, project]))))
        })
      },
      invalidate() {
        sync.invalidate("project")
      },
      permission: {
        list(projectID: string) {
          return store.project.permission[projectID]
        },
        sync(projectID: string) {
          return sync.run(`project.permission:${projectID}`, async () => {
            setStore("project", "permission", projectID, await api().permission.saved.list({ projectID }))
          })
        },
        invalidate(projectID: string) {
          sync.invalidate(`project.permission:${projectID}`)
        },
      },
    },
    shell: {
      list(location?: LocationRef) {
        return Object.values(shells.list(location) ?? {})
      },
      listBySession(sessionID: string) {
        return Object.values(store.location)
          .flatMap((data) => Object.values(data.shell ?? {}))
          .filter((shell) => shell.metadata.sessionID === sessionID)
      },
      get(id: string) {
        return Object.values(store.location)
          .map((data) => data.shell?.[id])
          .find((shell) => shell !== undefined)
      },
      sync: shells.sync,
      invalidate: shells.invalidate,
    },
    location: {
      hub: {
        list(ref?: LocationRef) {
          const key = locationKey(ref ?? defaultLocation())
          const items = store.location[key]?.hub?.items
          return hubOwners.get(key) === api() ? items : undefined
        },
        sync(ref?: LocationRef) {
          if (disposed) return Promise.resolve()
          const location = ref ?? defaultLocation()
          const key = locationKey(location)
          const client = api()
          if (hubOwners.get(key) !== client) {
            sync.forget(`location.hub:${key}`)
            setStore("location", key, { hub: {} })
            setStore("location", key, "hub", reconcile({}))
            hubOwners.set(key, client)
          }
          const cache = store.location[key]?.hub
          return sync.run(`location.hub:${key}`, async (current) => {
            const items = await client["agent-task"].list({ directory: location.directory })
            if (disposed || api() !== client || !current() || store.location[key]?.hub !== cache) return
            setStore("location", key, "hub", "items", reconcile(items))
          })
        },
        invalidate(ref?: LocationRef) {
          sync.invalidate(`location.hub:${locationKey(ref ?? defaultLocation())}`)
        },
      },
      info(ref?: LocationRef) {
        return store.location[locationKey(ref ?? defaultLocation())]?.info
      },
      default() {
        return defaultLocation()
      },
      syncInfo(ref?: LocationRef) {
        const current = ref ?? defaultLocation()
        return sync.run(`location:${locationKey(current)}`, async () => {
          const location = await api().location.get({ location: locationQuery(current) })
          const key = locationKey(location)
          if (!store.location[key]) setStore("location", key, {})
          setStore("location", key, "info", location)
          if (!ref) {
            setDefaultLocation({ directory: location.directory })
          }
        })
      },
      async sync(ref?: LocationRef) {
        await result.location.syncInfo(ref)
        const location = ref ?? defaultLocation()
        await Promise.all([
          result.location.vcs.sync(location),
          result.location.agent.sync(location),
          result.location.command.sync(location),
          result.location.integration.sync(location),
          result.location.mcp.server.sync(location),
          result.location.mcp.resource.sync(location),
          result.location.model.sync(location),
          result.location.provider.sync(location),
          result.location.reference.sync(location),
          result.location.skill.sync(location),
          result.shell.sync(location),
          result.session.form.sync("global", location),
        ])
      },
      invalidate(ref?: LocationRef) {
        const location = ref ?? defaultLocation()
        sync.invalidate(`location:${locationKey(location)}`)
        result.location.vcs.invalidate(location)
        result.location.agent.invalidate(location)
        result.location.command.invalidate(location)
        result.location.config.invalidate(location)
        result.location.integration.invalidate(location)
        result.location.mcp.server.invalidate(location)
        result.location.mcp.resource.invalidate(location)
        result.location.model.invalidate(location)
        result.location.model.group.definition.invalidate(location)
        result.location.provider.invalidate(location)
        result.location.provider.definition.invalidate(location)
        result.location.provider.discovery.invalidate(undefined, undefined, location)
        result.location.reference.invalidate(location)
        result.location.skill.invalidate(location)
        result.shell.invalidate(location)
        result.session.form.invalidate("global", location)
      },
      vcs: { info: vcs.list, sync: vcs.sync, invalidate: vcs.invalidate },
      agent: locationResource("agent", (location) => api().agent.list({ location })),
      command: locationResource("command", (location) => api().command.list({ location })),
      config: locationResource("config", async (location) => ({
        location: { directory: location.directory },
        data: await api().config.get({ location }),
      })),
      integration: locationResource("integration", (location) => api().integration.list({ location })),
      mcp: {
        server: locationResource("mcpServer", (location) => api().mcp.list({ location })),
        resource: locationResource("mcpResource", async (location) => {
          const response = await api().mcp.resource.catalog({ location })
          return { location: response.location, data: response.data.resources }
        }),
      },
      model: {
        ...locationResource("model", (location) => api().model.list({ location }), { alias: true }),
        group: {
          definition: locationResource("modelGroup", (location) => api().model.group.definition.get({ location }), {
            alias: true,
          }),
        },
      },
      provider: {
        ...locationResource("provider", (location) => api().provider.list({ location }), { alias: true }),
        /** Opt-in authored definitions, including disabled and pending layers, with conditional-write revisions. */
        definition: locationResource("providerDefinition", (location) => api().provider.definition.get({ location }), {
          alias: true,
        }),
        /** Opt-in saved directory snapshots and fetch diagnostics; sync never starts a provider list request. */
        discovery: providerDiscovery,
      },
      reference: locationResource("reference", (location) => api().reference.list({ location })),
      websearch: {
        list(location?: LocationRef) {
          return store.location[locationKey(location ?? defaultLocation())]?.websearch
        },
        async refresh(ref?: LocationRef) {
          const input = { location: locationQuery(ref ?? defaultLocation()) }
          const providers = await api().websearch.providers(input)
          const key = locationKey(providers.location)
          setStore("location", key, { websearch: providers.data })
        },
      },
      skill: locationResource("skill", (location) => api().skill.list({ location })),
    },
  }

  createEffect(() => {
    const client = api()
    const status = config.connection?.status()
    if (identityConnection.client === client && identityConnection.status === status) return
    identityConnection.client = client
    identityConnection.status = status
    identityOwners.forEach((_owner, sessionID) => result.session.identity.invalidate(sessionID))
    operationOwners.forEach((_owner, sessionID) => result.session.task.operation.invalidate(sessionID))
    goalOwners.forEach((_owner, sessionID) => result.session.goal.invalidate(sessionID))
    communicationOwners.forEach((_owner, sessionID) => result.session.communication.invalidate(sessionID))
    scheduleOwners.forEach((_owner, sessionID) => result.session.schedule.invalidate(sessionID))
    discoveryOwners.forEach((_owner, key) => sync.invalidate(key))
  })

  createEffect(() => {
    if (config.connection?.status() === "connected") return
    sync.invalidate()
    messageLoads.forEach((_request, sessionID) => result.session.message.invalidate(sessionID))
  })

  onCleanup(
    config.event.listen(({ details }) => {
      handleEvent(details)
    }),
  )

  return result
}

export type Data = ReturnType<typeof createData>

// A completion event changes terminal fields, not a full text body missed before reconnect.
// Apply observed field changes to the HTTP snapshot; assistant tools align by their stable IDs.
function mergeMessageSnapshot(before: SessionMessageInfo, live: SessionMessageInfo, snapshot: SessionMessageInfo) {
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value)
  const array = (value: unknown): value is unknown[] => Array.isArray(value)
  const tool = (value: unknown): value is Record<string, unknown> & { type: "tool"; id: string } =>
    record(value) && value.type === "tool" && typeof value.id === "string"
  const merge = (before: unknown, live: unknown, snapshot: unknown, field?: "message" | "content"): unknown => {
    if (JSON.stringify(before) === JSON.stringify(live)) return snapshot
    if (array(before) && array(live) && array(snapshot)) {
      if (live.length < before.length) return live
      if (field !== "content")
        return Array.from({ length: Math.max(live.length, snapshot.length) }, (_, index) =>
          index < live.length ? merge(before[index], live[index], snapshot[index]) : snapshot[index],
        )
      return [
        ...snapshot.map((value, index) => {
          if (tool(value)) {
            const current = live.find((part) => tool(part) && part.id === value.id)
            const previous = before.find((part) => tool(part) && part.id === value.id)
            return current === undefined ? value : merge(previous, current, value)
          }
          const current = live[index]
          if (tool(current)) return value
          return index < live.length ? merge(before[index], current, value) : value
        }),
        ...live.filter((value, index) =>
          tool(value) ? !snapshot.some((part) => tool(part) && part.id === value.id) : index >= snapshot.length,
        ),
      ]
    }
    if (!record(before) || !record(live) || !record(snapshot)) return live
    if (before.type !== live.type || before.status !== live.status || before.kind !== live.kind) return live
    const result = { ...snapshot }
    new Set([...Object.keys(before), ...Object.keys(live)]).forEach((key) => {
      if (JSON.stringify(before[key]) === JSON.stringify(live[key])) return
      if (!Object.hasOwn(live, key)) {
        delete result[key]
        return
      }
      result[key] = merge(
        before[key],
        live[key],
        snapshot[key],
        field === "message" && before.type === "assistant" && snapshot.type === "assistant" && key === "content"
          ? "content"
          : undefined,
      )
    })
    return result
  }
  return Object.assign(structuredClone(snapshot), merge(before, unwrap(live), snapshot, "message"))
}
