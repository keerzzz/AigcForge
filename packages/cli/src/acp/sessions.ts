import { isDeepStrictEqual } from "node:util"
import type { McpServer, SessionConfigOption } from "@agentclientprotocol/sdk"
import type { OmnixaClient, OmnixaEvent } from "@omnixa/client/effect"
import { Mcp } from "@omnixa/schema/mcp"
import type { Session } from "@omnixa/schema/session"
import { FSUtil } from "@omnixa/util/fs-util"
import { Cause, Deferred, Effect, Exit, Queue, Ref, Scope, Stream } from "effect"
import type { ACPCatalog, Catalog } from "./catalog"
import { ACPClient } from "./client"
import {
  availableCommands,
  configOptions,
  resolveChange,
  selectionFromSession,
  type Change,
  type Selection,
} from "./config-option"
import { ACPConnection } from "./connection"
import { ACPError } from "./error"

export type SupportedMcpServer = Exclude<McpServer, { readonly type: "acp" | "sse" }>

export type Attached = {
  readonly id: Session.ID
  readonly cwd: string
  readonly selection: Ref.Ref<Selection>
}

export type Snapshot = {
  readonly attached?: Attached
  readonly generation: number
  readonly revision: number
}

export interface Interface {
  readonly snapshot: (sessionID: string) => Effect.Effect<Snapshot, never, Scope.Scope>
  readonly validateSnapshot: (
    sessionID: string,
    snapshot: Snapshot,
  ) => Effect.Effect<void, ACPError.InvalidRequestError>
  readonly attach: (
    session: Session.Info,
    cwd: string,
    mcpServers: readonly SupportedMcpServer[],
    snapshot?: Snapshot,
  ) => Effect.Effect<{ readonly attached: Attached; readonly configOptions: SessionConfigOption[] }, ACPError.Failure>
  readonly detach: (sessionID: string) => Effect.Effect<void>
  readonly release: (attached: Attached) => Effect.Effect<void>
  readonly require: (sessionID: string) => Effect.Effect<Attached, ACPError.SessionNotFoundError>
  readonly fork: (attached: Attached, effect: Effect.Effect<void>) => Effect.Effect<void, ACPError.SessionNotFoundError>
  readonly options: (attached: Attached) => Effect.Effect<SessionConfigOption[], ACPError.Failure>
  readonly select: (
    attached: Attached,
    configId: string,
    value: unknown,
  ) => Effect.Effect<SessionConfigOption[], ACPError.Failure>
}

type SelectionUpdate = {
  readonly refresh?: boolean
  readonly force?: boolean
  readonly generation?: number
}

type Entry = {
  readonly attached: Attached
  readonly scope: Scope.Closeable
  readonly selected: Queue.Queue<SelectionUpdate>
  generation: number
  revision: number
}

type SelectedEvent = Extract<
  OmnixaEvent,
  {
    type: "session.model.selected" | "session.agent.selected" | "session.executor.selected"
  }
>

export const make = Effect.fnUntraced(function* (input: {
  readonly client: OmnixaClient
  readonly connection: ACPConnection.Interface
  readonly catalog: ACPCatalog.Interface
}) {
  const scope = yield* Effect.scope
  const sessions = new Map<string, Entry>()
  // Only in-flight requests keep tickets; detach removes their membership even without an entry.
  const pendingSnapshots = new Map<string, Set<Snapshot>>()
  yield* Scope.addFinalizer(
    scope,
    Effect.sync(() => pendingSnapshots.clear()),
  )
  // Outlives entries so re-attaching does not re-add servers.
  const registeredMcpBySession = new Map<string, Map<string, Mcp.ServerConfig>>()
  const connected = yield* Deferred.make<void>()

  // Subscribe before any attach. Canonical reads stay in each entry's fold.
  yield* input.client.event.subscribe().pipe(
    Stream.tap((event) => (event.type === "server.connected" ? Deferred.succeed(connected, undefined) : Effect.void)),
    Stream.filter(
      (event): event is SelectedEvent =>
        event.type === "session.model.selected" ||
        event.type === "session.agent.selected" ||
        event.type === "session.executor.selected",
    ),
    Stream.runForEach((event) => {
      const entry = sessions.get(event.data.sessionID)
      return entry ? Queue.offer(entry.selected, { refresh: true }) : Effect.void
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning("ACP selection event stream failed", cause),
    ),
    Effect.ensuring(Deferred.succeed(connected, undefined)),
    Effect.forkScoped,
  )

  const owner = Effect.fnUntraced(function* (attached: Attached) {
    const entry = sessions.get(attached.id)
    if (entry?.attached !== attached) return yield* new ACPError.SessionNotFoundError({ sessionId: attached.id })
    return entry
  })

  const current = (entry: Entry, generation = entry.generation, revision = entry.revision) =>
    sessions.get(entry.attached.id) === entry && entry.generation === generation && entry.revision === revision

  const validSnapshot = (sessionID: string, snapshot: Snapshot) => {
    const entry = sessions.get(sessionID)
    return (
      pendingSnapshots.get(sessionID)?.has(snapshot) === true &&
      snapshot.attached === entry?.attached &&
      snapshot.generation === (entry?.generation ?? 0) &&
      snapshot.revision === (entry?.revision ?? 0)
    )
  }

  const validateSnapshot = Effect.fnUntraced(function* (sessionID: string, snapshot: Snapshot) {
    if (!validSnapshot(sessionID, snapshot))
      return yield* new ACPError.InvalidRequestError({
        message: "Session selection changed while loading; retry the request",
        field: "sessionId",
      })
  })

  // Ref and revision change in one synchronous boundary.
  const accept = (entry: Entry, selection: Selection, generation: number, revision: number) =>
    Ref.modify(entry.attached.selection, (previous) => {
      if (!current(entry, generation, revision)) return [false, previous]
      if (!isDeepStrictEqual(previous, selection)) entry.revision++
      return [true, selection]
    })

  const adopt = Effect.fnUntraced(function* (
    entry: Entry,
    session: Session.Info,
    generation: number,
    revision: number,
  ) {
    if (session.id !== entry.attached.id)
      return yield* new ACPError.SessionNotFoundError({ sessionId: entry.attached.id })
    if (FSUtil.resolve(session.location.directory) !== FSUtil.resolve(entry.attached.cwd))
      return yield* new ACPError.SessionDirectoryMismatchError({
        sessionId: entry.attached.id,
        cwd: entry.attached.cwd,
      })
    return yield* accept(entry, selectionFromSession(session), generation, revision)
  })

  const refresh = Effect.fnUntraced(function* (entry: Entry, generation: number, modeID?: Selection["modeID"]) {
    if (!current(entry, generation)) return false
    const revision = entry.revision
    const session = yield* input.client.session
      .get({ sessionID: entry.attached.id })
      .pipe(Effect.catch(ACPClient.classify))
    if (!current(entry, generation)) return false
    if (
      modeID === "meta" &&
      (session.agent !== modeID ||
        session.controller?.kind !== "root" ||
        session.controller.rootSessionID !== entry.attached.id ||
        !session.model)
    )
      return yield* new ACPError.InvalidRequestError({
        message: "Could not confirm the Meta Session selection",
        field: "agent",
      })
    return yield* adopt(entry, session, generation, revision)
  })

  const options = Effect.fnUntraced(function* (attached: Attached) {
    yield* owner(attached)
    const catalog = yield* input.catalog.get(attached.cwd)
    yield* owner(attached)
    return configOptions(catalog, yield* Ref.get(attached.selection))
  })

  const sendCommands = (sessionID: string, catalog: Catalog) =>
    input.connection.sessionUpdate({
      sessionId: sessionID,
      update: { sessionUpdate: "available_commands_update", availableCommands: availableCommands(catalog) },
    })

  const changed = Effect.fnUntraced(function* (
    entry: Entry,
    previous: { readonly catalog: Catalog; readonly options: SessionConfigOption[] },
    next: Catalog,
    update?: SelectionUpdate,
  ) {
    if (!current(entry) || (update?.generation !== undefined && entry.generation !== update.generation)) return previous
    if (update?.refresh) yield* refresh(entry, entry.generation).pipe(Effect.ignore)
    if (!current(entry) || (update?.generation !== undefined && entry.generation !== update.generation)) return previous
    const selected = configOptions(next, yield* Ref.get(entry.attached.selection))
    if (update?.force || !isDeepStrictEqual(selected, previous.options)) {
      yield* input.connection.sessionUpdate({
        sessionId: entry.attached.id,
        update: { sessionUpdate: "config_option_update", configOptions: selected },
      })
    }
    if (!isDeepStrictEqual(next.commands, previous.catalog.commands)) yield* sendCommands(entry.attached.id, next)
    return { catalog: next, options: selected }
  })

  const registerMcp = (attached: Attached, servers: readonly SupportedMcpServer[]) =>
    Effect.suspend(() => {
      const registered = registeredMcpBySession.get(attached.id) ?? new Map<string, Mcp.ServerConfig>()
      registeredMcpBySession.set(attached.id, registered)
      return Effect.forEach(
        servers,
        (server) =>
          Effect.suspend(() => {
            const config = mcpConfig(server)
            if (isDeepStrictEqual(registered.get(server.name), config)) return Effect.void
            registered.set(server.name, config)
            return input.client.mcp.add({ server: server.name, location: { directory: attached.cwd }, config }).pipe(
              Effect.catch(ACPClient.classify),
              Effect.onError(() => Effect.sync(() => registered.delete(server.name))),
              Effect.uninterruptible,
            )
          }),
        { concurrency: "unbounded", discard: true },
      )
    })

  const remove = (sessionID: string, entry: Entry) =>
    Effect.suspend(() => {
      if (sessions.get(sessionID) === entry) {
        pendingSnapshots.delete(sessionID)
        sessions.delete(sessionID)
        registeredMcpBySession.delete(sessionID)
      }
      return Scope.close(entry.scope, Exit.void)
    })

  return {
    snapshot: (sessionID) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const entry = sessions.get(sessionID)
          const snapshot = {
            attached: entry?.attached,
            generation: entry?.generation ?? 0,
            revision: entry?.revision ?? 0,
          }
          const pending = pendingSnapshots.get(sessionID) ?? new Set<Snapshot>()
          pending.add(snapshot)
          pendingSnapshots.set(sessionID, pending)
          return snapshot
        }),
        (snapshot) =>
          Effect.sync(() => {
            const pending = pendingSnapshots.get(sessionID)
            if (!pending?.delete(snapshot)) return
            if (pending.size === 0) pendingSnapshots.delete(sessionID)
          }),
      ),
    validateSnapshot,
    attach: Effect.fn("cli.acp.sessions.attach")(function* (session, cwd, mcpServers, snapshot) {
      yield* Deferred.await(connected)
      const catalog = yield* input.catalog.get(cwd)
      const entry: Entry = {
        attached: {
          id: session.id,
          cwd,
          selection: yield* Ref.make(selectionFromSession(session)),
        },
        scope: Scope.forkUnsafe(scope),
        selected: yield* Queue.unbounded<SelectionUpdate>(),
        generation: 0,
        revision: 0,
      }
      // Validate a load/resume read against the same owner immediately before the swap.
      const replaced = sessions.get(session.id)
      if (snapshot && !validSnapshot(session.id, snapshot)) {
        yield* Scope.close(entry.scope, Exit.void)
        return yield* new ACPError.InvalidRequestError({
          message: "Session selection changed while loading; retry the request",
          field: "sessionId",
        })
      }
      sessions.set(session.id, entry)
      if (replaced) yield* Scope.close(replaced.scope, Exit.void)
      yield* registerMcp(entry.attached, mcpServers).pipe(Effect.onError(() => remove(session.id, entry)))
      yield* owner(entry.attached)
      const initial = configOptions(catalog, yield* Ref.get(entry.attached.selection))
      const responded = yield* ACPConnection.Responded
      // One fold owns notifications; its options are only the last advertised cache.
      yield* Effect.gen(function* () {
        yield* responded
        yield* owner(entry.attached)
        yield* sendCommands(session.id, catalog)
        yield* Stream.merge(
          input.catalog.changes(cwd).pipe(Stream.map((catalog) => ({ catalog, update: undefined }))),
          Stream.fromQueue(entry.selected).pipe(Stream.map((update) => ({ catalog: undefined, update }))),
        ).pipe(
          Stream.runFoldEffect(
            () => ({ catalog, options: initial }),
            (previous, step) =>
              changed(entry, previous, step.catalog ?? previous.catalog, step.update).pipe(
                Effect.orElseSucceed(() => previous),
              ),
          ),
        )
      }).pipe(Effect.ignore, Effect.forkIn(entry.scope))
      yield* owner(entry.attached)
      return {
        attached: entry.attached,
        configOptions: configOptions(catalog, yield* Ref.get(entry.attached.selection)),
      }
    }),
    detach: Effect.fn("cli.acp.sessions.detach")(function* (sessionID) {
      const entry = sessions.get(sessionID)
      pendingSnapshots.delete(sessionID)
      if (entry) yield* remove(sessionID, entry)
    }),
    release: Effect.fn("cli.acp.sessions.release")(function* (attached) {
      const entry = sessions.get(attached.id)
      if (entry?.attached === attached) yield* remove(attached.id, entry)
    }),
    require: Effect.fnUntraced(function* (sessionID) {
      const entry = sessions.get(sessionID)
      if (!entry) return yield* new ACPError.SessionNotFoundError({ sessionId: sessionID })
      return entry.attached
    }),
    fork: Effect.fn("cli.acp.sessions.fork")(function* (attached, effect) {
      const entry = yield* owner(attached)
      yield* Effect.forkIn(effect, entry.scope, { startImmediately: true })
    }),
    options,
    select: Effect.fn("cli.acp.sessions.select")(function* (attached, configId, value) {
      const entry = yield* owner(attached)
      // One request generation includes catalog retry, HTTP acceptance, and readback.
      const generation = ++entry.generation
      const attempt = Effect.gen(function* () {
        if (!current(entry, generation)) return yield* new ACPError.SessionNotFoundError({ sessionId: attached.id })
        if (typeof value !== "string") return yield* new ACPError.InvalidConfigOptionError({ configId })
        const catalog = yield* input.catalog.get(attached.cwd)
        if (!current(entry, generation)) return yield* new ACPError.SessionNotFoundError({ sessionId: attached.id })
        const selection = yield* Ref.get(attached.selection)
        const change: Change | undefined = yield* resolveChange(catalog, selection, configId, value)
        if (!current(entry, generation)) return yield* new ACPError.SessionNotFoundError({ sessionId: attached.id })
        const revision = entry.revision
        if (!change) {
          yield* refresh(entry, generation)
          return
        }
        if ("executorPreference" in change) {
          const session = yield* input.client.session
            .selectExecutor({
              sessionID: attached.id,
              payload: change.executorPreference,
            })
            .pipe(Effect.catch(ACPClient.classify))
          if (!current(entry, generation)) return
          if (entry.revision !== revision || !(yield* adopt(entry, session, generation, revision)))
            yield* refresh(entry, generation)
          return
        }
        yield* (
          "model" in change
            ? input.client.session.switchModel({ sessionID: attached.id, model: change.model })
            : input.client.session.switchAgent({ sessionID: attached.id, agent: change.modeID })
        ).pipe(Effect.catch(ACPClient.classify))
        if (!current(entry, generation)) return
        // First Meta selection must read its new identity and model from the server.
        const modeID = "modeID" in change ? change.modeID : undefined
        if (selection.controller || modeID === "meta" || entry.revision !== revision) {
          yield* refresh(entry, generation, modeID)
          return
        }
        yield* accept(entry, { ...selection, ...change }, generation, revision)
      })
      const retry = () => input.catalog.reload(attached.cwd).pipe(Effect.andThen(attempt))
      yield* attempt.pipe(
        Effect.catchTags({ ACPInvalidModelError: retry, ACPInvalidModeError: retry, ACPInvalidEffortError: retry }),
        Effect.onError(() =>
          Effect.gen(function* () {
            if (!current(entry, generation)) return
            if ((yield* Ref.get(attached.selection)).controller) yield* refresh(entry, generation).pipe(Effect.ignore)
            if (current(entry, generation)) yield* Queue.offer(entry.selected, { force: true, generation })
          }).pipe(Effect.ignore),
        ),
      )
      if (current(entry, generation)) yield* Queue.offer(entry.selected, { generation })
      return yield* options(attached)
    }),
  } satisfies Interface
})

function mcpConfig(server: SupportedMcpServer) {
  if ("type" in server) {
    return new Mcp.RemoteConfig({
      type: "remote",
      url: server.url,
      headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
      oauth: false,
    })
  }
  return new Mcp.LocalConfig({
    type: "local",
    command: [server.command, ...server.args],
    environment: Object.fromEntries(server.env.map((entry) => [entry.name, entry.value])),
  })
}

export * as ACPSessions from "./sessions"
