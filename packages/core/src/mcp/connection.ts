export * as McpConnection from "./connection"

import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  JsonSchema,
  Layer,
  Option,
  Scope,
  Schema,
  Stream,
} from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Composition } from "@aigcfroge/schema/composition"
import { McpScope, McpServerBinding } from "@aigcfroge/schema/mcp-scope"
import { canonicalToolName, McpRegistration, SERVER_NAME_PATTERN } from "../tool/mcp-registration"
import { RegistrationError, Tool } from "../tool/tool"
import { McpCredentialBindingStore } from "./binding/store"
import { Credential } from "../credential"
import { Location } from "../location"
import { CredentialScanner } from "../credential-scanner"
import { ProductModePolicy } from "../product-mode-policy"

// Phase C Slice 2: typed credential binding resolution. A binding carrying
// credentialRef is resolved via McpCredentialBindingStore (Location-scoped,
// directory-partitioned) and the material is fetched via Credential.Service
// at connect time, used once, and discarded — never cached, logged, or
// stored in the binding table.

export const HANDSHAKE_TIMEOUT = Duration.seconds(10)

export class InvalidConfigError extends Schema.TaggedErrorClass<InvalidConfigError>()(
  "McpConnection.InvalidConfigError",
  { serverName: Schema.String, reason: Schema.String },
) {
  override get message() {
    return `Invalid MCP binding for '${this.serverName}': ${this.reason}`
  }
}

export class ProcessStartError extends Schema.TaggedErrorClass<ProcessStartError>()("McpConnection.ProcessStartError", {
  serverName: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `MCP process for '${this.serverName}' failed to start: ${this.reason}`
  }
}

export class HandshakeTimeoutError extends Schema.TaggedErrorClass<HandshakeTimeoutError>()(
  "McpConnection.HandshakeTimeoutError",
  { serverName: Schema.String, timeoutMs: Schema.Number },
) {
  override get message() {
    return `MCP handshake with '${this.serverName}' timed out after ${this.timeoutMs}ms`
  }
}

export class ProtocolError extends Schema.TaggedErrorClass<ProtocolError>()("McpConnection.ProtocolError", {
  serverName: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `MCP protocol violation from '${this.serverName}': ${this.reason}`
  }
}

export class NotConnectedError extends Schema.TaggedErrorClass<NotConnectedError>()("McpConnection.NotConnectedError", {
  serverName: Schema.String,
}) {
  override get message() {
    return `MCP server '${this.serverName}' is not connected`
  }
}

export class UnknownToolError extends Schema.TaggedErrorClass<UnknownToolError>()("McpConnection.UnknownToolError", {
  name: Schema.String,
}) {
  override get message() {
    return `No connected MCP server owns tool '${this.name}'`
  }
}

export class CredentialMissingError extends Schema.TaggedErrorClass<CredentialMissingError>()(
  "McpConnection.CredentialMissingError",
  { serverName: Schema.String, credentialRef: Schema.optional(Schema.String) },
) {
  override get message() {
    return `MCP server '${this.serverName}' requires a credential binding`
  }
}

export class CredentialExpiredError extends Schema.TaggedErrorClass<CredentialExpiredError>()(
  "McpConnection.CredentialExpiredError",
  { serverName: Schema.String, credentialRef: Schema.String },
) {
  override get message() {
    return `Credential ${this.credentialRef} for MCP server '${this.serverName}' has expired`
  }
}

export class RemoteDnsError extends Schema.TaggedErrorClass<RemoteDnsError>()("McpConnection.RemoteDnsError", {
  serverName: Schema.String,
  url: Schema.String,
}) {}

export class RemoteConnectionRefusedError extends Schema.TaggedErrorClass<RemoteConnectionRefusedError>()(
  "McpConnection.RemoteConnectionRefusedError",
  { serverName: Schema.String, url: Schema.String },
) {}

export class RemoteTlsError extends Schema.TaggedErrorClass<RemoteTlsError>()("McpConnection.RemoteTlsError", {
  serverName: Schema.String,
  url: Schema.String,
}) {}

export class RemoteUnavailableError extends Schema.TaggedErrorClass<RemoteUnavailableError>()(
  "McpConnection.RemoteUnavailableError",
  { serverName: Schema.String, url: Schema.String, status: Schema.optional(Schema.Number) },
) {}

export class ConnectionClosedError extends Schema.TaggedErrorClass<ConnectionClosedError>()(
  "McpConnection.ConnectionClosedError",
  { serverName: Schema.String, reason: Schema.Literals(["disconnect", "owner_scope_closed", "kill_switch_disabled"]) },
) {}

export class McpDisabledError extends Schema.TaggedErrorClass<McpDisabledError>()("McpConnection.McpDisabledError", {
  operation: Schema.Literals(["connect", "call"]),
}) {}

export class HealthTransitionError extends Schema.TaggedErrorClass<HealthTransitionError>()(
  "McpConnection.HealthTransitionError",
  {
    from: McpScope.McpConnectionHealth,
    to: McpScope.McpConnectionHealth,
    requiresRebind: Schema.Boolean,
  },
) {
  override get message() {
    return `MCP health transition '${this.from}' -> '${this.to}' is not allowed`
  }
}

export const classifyRemoteFailure = (input: { readonly serverName: string; readonly url: string; readonly cause: unknown }) => {
  const cause = input.cause instanceof HttpClientError.HttpClientError ? input.cause.reason.cause : input.cause
  const text = String(cause).toLowerCase()
  if (text.includes("enotfound") || text.includes("getaddrinfo") || text.includes("dns"))
    return new RemoteDnsError({ serverName: input.serverName, url: input.url })
  if (text.includes("econnrefused") || text.includes("connection refused"))
    return new RemoteConnectionRefusedError({ serverName: input.serverName, url: input.url })
  if (text.includes("tls") || text.includes("ssl") || text.includes("cert"))
    return new RemoteTlsError({ serverName: input.serverName, url: input.url })
  return new RemoteUnavailableError({ serverName: input.serverName, url: input.url })
}

export const transitionHealth = (input: {
  readonly from: McpScope.McpConnectionHealth
  readonly to: McpScope.McpConnectionHealth
  readonly rebound?: boolean
}) => {
  const allowed =
    (input.from === "connecting" && ["ready", "degraded", "offline", "auth-required", "revoked"].includes(input.to)) ||
    (input.from === "ready" && ["connecting", "degraded", "offline", "revoked"].includes(input.to)) ||
    (input.from === "degraded" && ["connecting", "ready", "offline"].includes(input.to)) ||
    (input.from === "offline" && input.to === "connecting") ||
    (input.from === "auth-required" && input.to === "connecting") ||
    (input.from === "revoked" && input.to === "connecting" && input.rebound === true)
  if (allowed) return Effect.succeed(input.to)
  return Effect.fail(
    new HealthTransitionError({ from: input.from, to: input.to, requiresRebind: input.from === "revoked" }),
  )
}

/** Projection of one owned connection; health is runtime state, never frozen. */
export class ConnInfo extends Schema.Class<ConnInfo>("McpConnection.ConnInfo")({
  serverName: Schema.String,
  pid: Schema.optional(Schema.Number),
  health: McpScope.McpConnectionHealth,
}) {}

/**
 * Read-only connection-owner facts consumed by CompositionResolver. They are
 * published only after this owner has registered the canonical tools; they
 * deliberately exclude transport material, clients, commands, URLs and secrets.
 */
export class Fact extends Schema.Class<Fact>("McpConnection.Fact")({
  serverName: Schema.String,
  ref: Schema.Struct({ relativePath: Schema.String, revision: Composition.Revision }),
  credentialRef: Schema.optional(Schema.String),
  health: McpScope.McpConnectionHealth,
  tools: Schema.Array(Schema.String),
}) {}

export type ConnectError =
  | InvalidConfigError
  | ProcessStartError
  | HandshakeTimeoutError
  | ProtocolError
  | McpRegistration.InvalidServerNameError
  | McpRegistration.McpNameCollisionError
  | RegistrationError
  /**
   * ADR-21 §2.2: a credentialRef that is not bound in THIS Location is rejected
   * fail closed, and the rejection is part of `connect`'s public contract — the
   * caller has to be able to tell "not authorized here" from "bad config".
   * Leaving it out of this union widened the inferred error channel to `unknown`
   * and silently voided every other typed guarantee on `connect`.
   */
  | McpCredentialBindingStore.CrossLocationRefError
  | McpCredentialBindingStore.RevokedRefError
  | CredentialMissingError
  | CredentialExpiredError
  | RemoteDnsError
  | RemoteConnectionRefusedError
  | RemoteTlsError
  | RemoteUnavailableError
  | ConnectionClosedError
  | McpDisabledError
  | HealthTransitionError

export type CallToolError =
  | UnknownToolError
  | NotConnectedError
  | ProtocolError
  | ProcessStartError
  | CredentialMissingError
  | CredentialExpiredError
  | McpCredentialBindingStore.CrossLocationRefError
  | McpCredentialBindingStore.RevokedRefError
  | McpCredentialBindingStore.StateError
  | HealthTransitionError
  | RemoteDnsError
  | RemoteConnectionRefusedError
  | RemoteTlsError
  | RemoteUnavailableError
  | ConnectionClosedError
  | McpDisabledError

type WireError =
  | ProtocolError
  | ProcessStartError
  | CredentialMissingError
  | CredentialExpiredError
  | RemoteDnsError
  | RemoteConnectionRefusedError
  | RemoteTlsError
  | RemoteUnavailableError
  | ConnectionClosedError
type Pending = Deferred.Deferred<unknown, WireError>

interface Wire {
  readonly serverName: string
  readonly pid?: number
  /** Owner scope of this connection: spawn handle + pump fibers die with it. */
  readonly scope: Scope.Closeable
  readonly request: (method: string, params?: unknown) => Effect.Effect<unknown, WireError>
  readonly sendOnly: (payload: unknown) => Effect.Effect<void>
  readonly stop: (error: ConnectionClosedError) => Effect.Effect<void>
  health: McpScope.McpConnectionHealth
  binding?: McpServerBinding
  tools?: ReadonlyArray<string>
}

export interface Interface {
  /** Connect one stdio server and register its tools under mcp_<server>_<tool>. */
  readonly connect: (input: { readonly binding: unknown }) => Effect.Effect<ConnInfo, ConnectError>
  /** Kill and forget one connection. */
  readonly disconnect: (serverName: string) => Effect.Effect<void, NotConnectedError>
  /** Runtime projection of every owned connection. */
  readonly connections: () => Effect.Effect<readonly ConnInfo[]>
  /** Last observed health for one server, including failed admissions. */
  readonly health: (serverName: string) => Effect.Effect<McpScope.McpConnectionHealth | undefined>
  /** Successful canonical registrations and their non-secret binding identity. */
  readonly facts: () => Effect.Effect<readonly Fact[]>
  /** Execute a tool by canonical name through the owning connection. */
  readonly callTool: (input: {
    readonly name: string
    readonly args: Record<string, unknown>
  }) => Effect.Effect<unknown, CallToolError>
  /** Kill and forget every connection (also wired as the layer finalizer). */
  readonly shutdown: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/McpConnection") {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * Ceiling for one redacted stderr line in the log. Applied AFTER scanning —
 * exported so the ordering test binds to the real constant instead of a copy
 * that could silently drift from it.
 */
export const MAX_STDERR_LOG = 2000

/**
 * The one place stderr text becomes log text (ADR-21 §2.4). Scan the FULL line,
 * then truncate what survives — never the reverse. Truncating first would slice
 * a secret that straddles the boundary into a prefix no pattern can match, and
 * the intact secret would go to the log. M2 proved this on the workflow handoff
 * (`workflow-runner.ts:205`).
 *
 * Extracted rather than inlined in the pump so the ordering is directly
 * assertable — same reason `lookupFilter` / `rebindFilter` are exported from the
 * binding store: a security-relevant step that no assertion can reach is a step
 * nobody is guarding.
 */
export const redactStderrLine = (scanner: CredentialScanner.Interface, line: string) =>
  Effect.gen(function* () {
    const scanned = yield* scanner.scan(line)
    return { redacted: scanned.stripped.slice(0, MAX_STDERR_LOG), secretHits: scanned.hits.length }
  })

/**
 * The canonical binding decoder, NOT a local `Schema.decodeUnknownSync`.
 * `McpScope.decodeBinding` is where three rules live that a bare schema decode
 * skips: excess-key rejection (`strictOptions`), the transport/command/url shape
 * contract, and ADR-21 §2.5 止血 2 — rejecting a binding whose `command` or
 * `url` carries secret-like material. A local decoder here left all three
 * unenforced on the only production path that decodes bindings.
 */
const decodeBinding = McpScope.decodeBinding

/**
 * Map credential material to the child's environment (ADR-21 §2.1). This is the
 * ONLY place material is read, and the result is handed straight to the spawn.
 *
 * The names are deliberately generic and stable: an MCP stdio server reads its
 * secret from the environment, and a per-server naming scheme would become an
 * immutable contract the same way canonical tool names are (ADR-19 §2.6). Until
 * a real server catalog says otherwise, one name per credential shape.
 *
 * `metadata` is NOT forwarded — it is caller-supplied and could carry anything,
 * so it stays out of the child environment.
 */
const credentialEnvFor = (value: Credential.Value): Record<string, string> =>
  value.type === "oauth" ? { MCP_CREDENTIAL_ACCESS_TOKEN: value.access } : { MCP_CREDENTIAL_API_KEY: value.key }

const credentialHeadersFor = (value: Credential.OAuth): Record<string, string> => ({
  Authorization: `Bearer ${value.access}`,
})

/**
 * The one expiry rule, shared by connect admission and per-call admission.
 *
 * It has to be one function rather than two inline comparisons: `requestOn`
 * re-resolves the binding before every credentialed call so that revocation
 * takes effect immediately, and expiry has to ride the same path or a token
 * that lapsed after the handshake stays invisible locally — surfacing only if
 * the remote answers 401, which then reports a *missing* credential for one that
 * merely expired (and reports `offline` for a server that answers 403 instead).
 *
 * No clock tolerance on purpose. Granting grace here alone would give the two
 * admission points different rules; granting it at both would let a
 * nearly-expired token connect and then fail on its first call, which is worse
 * feedback than refusing the connection. ADR-21 §4.1 keeps refresh out of this
 * owner, so the only outcome either way is a typed failure into `auth-required`.
 */
const isCredentialExpired = (value: Credential.Value, nowMs: number) =>
  value.type === "oauth" && value.expires <= nowMs / 1000

export const redactRemoteResponse = (
  scanner: CredentialScanner.Interface,
  input: { readonly headers: Readonly<Record<string, string>>; readonly body: string },
) =>
  Effect.forEach(
    [...Object.entries(input.headers).map(([name, value]) => `${name}: ${value}`), input.body],
    (text) => redactStderrLine(scanner, text),
  ).pipe(
    Effect.map((entries) => ({
      entries: entries.map((entry) => entry.redacted),
      secretHits: entries.reduce((total, entry) => total + entry.secretHits, 0),
    })),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const registration = yield* McpRegistration.Service
    const bindingStore = yield* McpCredentialBindingStore.Service
    const credentialService = yield* Credential.Service
    const scanner = yield* CredentialScanner.Service
    const http = yield* HttpClient.HttpClient
    const currentLocation = yield* Location.Service

    const conns = new Map<string, Wire>()
    const health = new Map<string, McpScope.McpConnectionHealth>()
    const routes = new Map<string, { readonly server: string; readonly tool: string }>()

    const setHealth = (input: {
      readonly serverName: string
      readonly to: McpScope.McpConnectionHealth
      readonly rebound?: boolean
    }) =>
      Effect.gen(function* () {
        const current = health.get(input.serverName)
        if (current === undefined || current === input.to) {
          health.set(input.serverName, input.to)
          const wire = conns.get(input.serverName)
          if (wire !== undefined) wire.health = input.to
          return input.to
        }
        const next = yield* transitionHealth({ from: current, to: input.to, rebound: input.rebound })
        health.set(input.serverName, next)
        const wire = conns.get(input.serverName)
        if (wire !== undefined) wire.health = next
        return next
      })

    // Spawns the child and wires the newline-delimited JSON-RPC protocol
    // around it. Runs inside the caller-provided Scope so the spawn handle
    // and pump fibers die together when that scope closes.
    const buildWire = Effect.fn("McpConnection.buildWire")(function* (input: {
      readonly serverName: string
      readonly command: readonly [string, ...string[]]
      readonly scope: Scope.Closeable
      /**
       * ADR-21 §2.1: the material arrives here and goes straight into the child
       * env. It is never stored on the wire, the ConnInfo, the registry or any
       * closure that outlives this call — `credentialEnvFor` builds it, the
       * spawn consumes it, and it falls out of scope immediately.
       */
      readonly env?: Record<string, string>
    }) {
      const { serverName, command } = input
      const pending = new Map<number, Pending>()
      const state = { dead: false, nextId: 0 }

      const failAll = (err: WireError) =>
        Effect.gen(function* () {
          if (state.dead) return
          state.dead = true
          const entries = [...pending.values()]
          pending.clear()
          yield* Effect.forEach(entries, (d) => Deferred.fail(d, err), { discard: true }).pipe(Effect.ignore)
        })

      // endOnDone must stay false: each request writes one chunk through the
      // stdin sink, and the default (`endOnDone: true`, cross-spawn-spawner
      // stdin cfg) would close the pipe after the first message.
      // forceKillAfter gives the TERM→KILL escalation a bounded ceiling.
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(command[0], command.slice(1), {
            extendEnv: true,
            ...(input.env !== undefined ? { env: input.env } : {}),
            stdin: { stream: "pipe", endOnDone: false },
            stdout: "pipe",
            stderr: "pipe",
            forceKillAfter: "3 seconds",
          }),
        )
        .pipe(Effect.mapError(() => new ProcessStartError({ serverName, reason: "spawn failed" })))

      // Termination ownership belongs to the spawner's own release path
      // (cross-spawn-spawner.ts:296-341): on scope close it TERMs the child's
      // process group (children are group leaders — detached defaults true on
      // non-win32, :378) and escalates to group SIGKILL after the
      // forceKillAfter ceiling below. The stubborn-child test pins exactly
      // this escalation; do not add a parallel killer here — a second,
      // unobserved mechanism is indistinguishable from none, and an unguarded
      // delayed SIGKILL would fire at a possibly-recycled pid.

      const sendRaw = (payload: unknown) =>
        Stream.make(Buffer.from(`${JSON.stringify(payload)}\n`)).pipe(Stream.run(handle.stdin))

      // stdout pump: resolve the pending request keyed by response id; any
      // malformed frame fails the whole wire (fail closed).
      yield* Effect.forkScoped(
        handle.stdout.pipe(
          Stream.decodeText,
          Stream.splitLines,
          Stream.runForEach((line) =>
            Effect.gen(function* () {
              const trimmed = line.trim()
              if (trimmed.length > 0 && !state.dead) {
                let msg: unknown
                try {
                  msg = JSON.parse(trimmed)
                } catch {
                  msg = undefined
                }
                if (msg === undefined) {
                  yield* failAll(new ProtocolError({ serverName, reason: "malformed JSON-RPC frame" }))
                } else if (!isRecord(msg)) {
                  yield* failAll(new ProtocolError({ serverName, reason: "frame was not an object" }))
                } else if (msg.id !== undefined && msg.id !== null) {
                  const key = Number(msg.id)
                  const d = pending.get(key)
                  if (d !== undefined) {
                    pending.delete(key)
                    if (msg.error !== undefined && msg.error !== null) {
                      const code = isRecord(msg.error) && typeof msg.error.code === "number" ? msg.error.code : -32768
                      yield* Deferred.fail(d, new ProtocolError({ serverName, reason: `JSON-RPC error ${code}` }))
                    } else {
                      yield* Deferred.succeed(d, msg.result)
                    }
                  }
                }
              }
            }),
          ),
          Effect.ignore,
        ),
      )

      // stderr pump (ADR-21 §2.4): server stderr is external, untrusted text and
      // the last place a secret can still surface. The order below is the whole
      // point — scan the FULL line, then truncate what is left. Truncating first
      // would cut a secret that straddles the boundary into a prefix too short
      // for any pattern to match, and it would go to the log intact. M2 proved
      // this on the workflow handoff (`workflow-runner.ts:205`).
      yield* Effect.forkScoped(
        handle.stderr.pipe(
          Stream.decodeText,
          Stream.splitLines,
          Stream.runForEach((line) =>
            Effect.gen(function* () {
              const trimmed = line.trim()
              if (trimmed.length === 0) return
              const redacted = yield* redactStderrLine(scanner, trimmed)
              yield* Effect.logDebug("mcp server stderr", { serverName, ...redacted })
            }),
          ),
          Effect.ignore,
        ),
      )

      // death watcher: surface exit/signal to every in-flight request.
      yield* Effect.forkScoped(
        handle.exitCode.pipe(
          Effect.flatMap((code) =>
            failAll(new ProcessStartError({ serverName, reason: `process exited with code ${code}` })),
          ),
          Effect.catch(() => failAll(new ProcessStartError({ serverName, reason: "process terminated by signal" }))),
          Effect.ignore,
        ),
      )

      const request = (method: string, params?: unknown): Effect.Effect<unknown, WireError> =>
        Effect.gen(function* () {
          if (state.dead) return yield* new ProcessStartError({ serverName, reason: "connection closed" })
          const id = ++state.nextId
          const d = yield* Deferred.make<unknown, WireError>()
          pending.set(id, d)
          yield* sendRaw({ jsonrpc: "2.0", id, method, params }).pipe(
            Effect.mapError(() => new ProcessStartError({ serverName, reason: "stdin write failed" })),
          )
          return yield* Deferred.await(d)
        })

      const wire: Wire = {
        serverName,
        pid: Number(handle.pid),
        scope: input.scope,
        request,
        sendOnly: (payload) => sendRaw(payload).pipe(Effect.ignore),
        stop: failAll,
        health: "connecting",
      }
      return wire
    })

    const redactRemoteFailure = (input: {
      readonly serverName: string
      readonly headers: Readonly<Record<string, string>>
      readonly body: string
    }) =>
      redactRemoteResponse(scanner, { headers: input.headers, body: input.body }).pipe(
        Effect.tap((redacted) =>
          Effect.logDebug("mcp remote response rejected", { serverName: input.serverName, secretHits: redacted.secretHits }),
        ),
      )

    const buildRemoteWire = Effect.fn("McpConnection.buildRemoteWire")(function* (input: {
      readonly serverName: string
      readonly url: string
      readonly scope: Scope.Closeable
      readonly headers?: Record<string, string>
    }) {
      let nextId = 0
      const pending = new Map<number, Pending>()
      const post = (payload: unknown) =>
        HttpClientRequest.post(input.url).pipe(
          HttpClientRequest.setHeaders(input.headers ?? {}),
          HttpClientRequest.bodyJson(payload),
          Effect.flatMap(http.execute),
          Effect.catch((cause) => Effect.fail(classifyRemoteFailure({ ...input, cause }))),
        )
      const stop = (error: ConnectionClosedError) =>
        Effect.gen(function* () {
          const entries = [...pending.values()]
          pending.clear()
          yield* Effect.forEach(entries, (deferred) => Deferred.fail(deferred, error), { discard: true })
        })
      const request = (method: string, params?: unknown): Effect.Effect<unknown, WireError> =>
        Effect.gen(function* () {
          const id = ++nextId
          const deferred = yield* Deferred.make<unknown, WireError>()
          pending.set(id, deferred)
          const complete = post({ jsonrpc: "2.0", id, method, params }).pipe(
            Effect.flatMap((response) =>
              Effect.gen(function* () {
                const body = yield* response.text.pipe(
                  Effect.mapError(
                    () => new ProtocolError({ serverName: input.serverName, reason: "remote response body could not be read" }),
                  ),
                )
                yield* redactRemoteFailure({ serverName: input.serverName, headers: response.headers, body })
                if (response.status === 401 || response.status === 403)
                  return yield* new CredentialMissingError({ serverName: input.serverName })
                if (response.status < 200 || response.status >= 300)
                  return yield* new RemoteUnavailableError({ serverName: input.serverName, url: input.url, status: response.status })
                const message = yield* Effect.try({
                  try: () => JSON.parse(body),
                  catch: () => new ProtocolError({ serverName: input.serverName, reason: "remote response was not JSON" }),
                })
                if (!isRecord(message) || !("result" in message))
                  return yield* new ProtocolError({ serverName: input.serverName, reason: "remote response lacked result" })
                return message.result
              }),
            ),
            Effect.matchEffect({
              onFailure: (error) => Deferred.fail(deferred, error),
              onSuccess: (result) => Deferred.succeed(deferred, result),
            }),
            Effect.ensuring(Effect.sync(() => pending.delete(id))),
          )
          yield* complete.pipe(Effect.forkIn(input.scope))
          return yield* Deferred.await(deferred)
        })
      return {
        serverName: input.serverName,
        scope: input.scope,
        request,
        sendOnly: (payload: unknown) => post(payload).pipe(Effect.asVoid, Effect.ignore),
        stop,
        health: "connecting" as const,
      } satisfies Wire
    })

    const killConn = (
      serverName: string,
      reason: ConnectionClosedError["reason"] = "disconnect",
    ) =>
      Effect.gen(function* () {
        const wire = conns.get(serverName)
        if (!wire) return
        conns.delete(serverName)
        // Canonical-name routes stay: a known name whose server died must fail
        // as NotConnectedError, not degrade into UnknownToolError.
        yield* wire.stop(new ConnectionClosedError({ serverName, reason }))
        yield* Scope.close(wire.scope, Exit.void).pipe(Effect.ignore)
      })

    const shutdownConnections = (reason: ConnectionClosedError["reason"]) =>
      Effect.forEach([...conns.keys()], (name) => killConn(name, reason), { discard: true })

    const shutdown = Effect.fn("McpConnection.shutdown")(function* () {
      yield* shutdownConnections("owner_scope_closed")
    })

    yield* Effect.addFinalizer(shutdown)

    const requestOn = (server: string, method: string, params?: unknown): Effect.Effect<unknown, CallToolError> =>
      Effect.gen(function* () {
        const wire = conns.get(server)
        if (wire === undefined) return yield* new NotConnectedError({ serverName: server })
        if (wire.binding?.credentialRef !== undefined) {
          yield* bindingStore.resolve({ serverName: server, credentialRef: wire.binding.credentialRef }).pipe(
            Effect.catch((error): Effect.Effect<void, CallToolError> => {
              if (error instanceof McpCredentialBindingStore.RevokedRefError)
                return setHealth({ serverName: server, to: "revoked" }).pipe(Effect.andThen(Effect.fail(error)))
              if (error instanceof McpCredentialBindingStore.DanglingRefError)
                return setHealth({ serverName: server, to: "auth-required" }).pipe(
                  Effect.andThen(Effect.fail(new CredentialMissingError({ serverName: server, credentialRef: error.credentialRef }))),
                )
              return Effect.fail(error)
            }),
          )
          // Same admission rule as connect (`isCredentialExpired`): a token that
          // lapsed after the handshake must fail here, typed as expired, rather
          // than travelling to the remote and coming back as a 401 that reads
          // like a missing credential.
          const credentialRef = wire.binding.credentialRef
          const cred = yield* credentialService.get(Credential.ID.make(credentialRef)).pipe(Effect.orDie)
          if (!cred) return yield* new CredentialMissingError({ serverName: server, credentialRef })
          // No `setHealth` here: `ready -> auth-required` is rejected by
          // `transitionHealth`, so attempting it would only be swallowed. Same
          // reason the `tapError` further down has never been able to record
          // this state. See technical-debt §3.2.
          if (isCredentialExpired(cred.value, Date.now()))
            return yield* new CredentialExpiredError({ serverName: server, credentialRef })
        }
        return yield* wire.request(method, params).pipe(
          Effect.tapError((error) =>
            setHealth({
              serverName: server,
              to:
                error instanceof CredentialMissingError || error instanceof CredentialExpiredError
                  ? "auth-required"
                  : error instanceof ProtocolError
                    ? "degraded"
                    : "offline",
            }).pipe(Effect.catch(() => Effect.void)),
          ),
        )
      })

    const callServer = (server: string, tool: string, args: unknown): Effect.Effect<unknown, CallToolError> =>
      requestOn(server, "tools/call", { name: tool, arguments: args ?? {} })

    const connect = Effect.fn("McpConnection.connect")(function* (input: { readonly binding: unknown }) {
      if (!ProductModePolicy.isCustomModeEnabled()) {
        yield* shutdownConnections("kill_switch_disabled")
        return yield* new McpDisabledError({ operation: "connect" })
      }
      const binding = yield* Effect.try({
        try: () => decodeBinding(input.binding),
        catch: () =>
          new InvalidConfigError({ serverName: "(undecodable)", reason: "binding failed McpServerBinding decode" }),
      })
      const serverName = binding.serverName
      if (!SERVER_NAME_PATTERN.test(serverName)) yield* new McpRegistration.InvalidServerNameError({ serverName })
      if (binding.transport === "stdio" && (binding.command === undefined || binding.command.length === 0))
        return yield* new InvalidConfigError({ serverName, reason: "stdio transport requires a command" })
      if (binding.transport === "remote" && binding.url === undefined)
        return yield* new InvalidConfigError({ serverName, reason: "remote transport requires a url" })
      let credential: Credential.Value | undefined = undefined
      if (binding.credentialRef !== undefined) {
        const resolved = yield* bindingStore.resolve({ serverName, credentialRef: binding.credentialRef }).pipe(
          // The annotation is required, not decorative: without it TS pins the
          // handler's return type to the first branch, the second branch stops
          // fitting, and the whole `connect` error channel collapses to
          // `unknown` — voiding every typed guarantee on it at once.
          Effect.catch(
            (e): Effect.Effect<
              never,
              | McpCredentialBindingStore.CrossLocationRefError
              | McpCredentialBindingStore.RevokedRefError
              | CredentialMissingError
              | InvalidConfigError
              | HealthTransitionError
            > => {
              if (e instanceof McpCredentialBindingStore.CrossLocationRefError) return Effect.fail(e)
              if (e instanceof McpCredentialBindingStore.DanglingRefError)
                return setHealth({ serverName, to: "auth-required" }).pipe(
                  Effect.andThen(Effect.fail(new CredentialMissingError({ serverName, credentialRef: e.credentialRef }))),
                )
              if (e instanceof McpCredentialBindingStore.RevokedRefError)
                return setHealth({ serverName, to: "revoked" }).pipe(Effect.andThen(Effect.fail(e)))
              return Effect.fail(new InvalidConfigError({ serverName, reason: e.message }))
            },
          ),
        )
        const credID = Credential.ID.make(resolved.credentialRef)
        const cred = yield* credentialService.get(credID).pipe(Effect.orDie)
        if (!cred) {
          yield* setHealth({ serverName, to: "auth-required" })
          return yield* new CredentialMissingError({ serverName, credentialRef: resolved.credentialRef })
        }
        if (isCredentialExpired(cred.value, Date.now())) {
          yield* setHealth({ serverName, to: "auth-required" })
          return yield* new CredentialExpiredError({ serverName, credentialRef: resolved.credentialRef })
        }
        credential = cred.value
      }
      if (binding.transport === "remote" && credential?.type === "key")
        return yield* new InvalidConfigError({ serverName, reason: "remote transport requires an OAuth credential" })
      if (conns.has(serverName)) yield* killConn(serverName, "disconnect")
      yield* setHealth({ serverName, to: "connecting", rebound: health.get(serverName) === "revoked" })
      const connScope = yield* Scope.make()
      const wireExit = yield* (binding.transport === "stdio"
        ? buildWire({
            serverName,
            command: [binding.command![0], ...binding.command!.slice(1)],
            scope: connScope,
            ...(credential !== undefined ? { env: credentialEnvFor(credential) } : {}),
          })
        : buildRemoteWire({
            serverName,
            url: binding.url!,
            scope: connScope,
            ...(credential?.type === "oauth" ? { headers: credentialHeadersFor(credential) } : {}),
          })).pipe(
        Effect.provideService(Scope.Scope, connScope),
        Effect.exit,
      )
      if (Exit.isFailure(wireExit)) {
        yield* Scope.close(connScope, Exit.void).pipe(Effect.ignore)
        yield* setHealth({ serverName, to: "offline" }).pipe(Effect.catch(() => Effect.void))
        const failure = Cause.findErrorOption(wireExit.cause)
        if (Option.isSome(failure)) return yield* Effect.fail(failure.value)
        return yield* Effect.die(Cause.squash(wireExit.cause))
      }
      const wire = wireExit.value
      conns.set(serverName, wire)

      const established = Effect.gen(function* () {
        const timeoutMs = Duration.toMillis(HANDSHAKE_TIMEOUT)
        const bounded = <A, E>(eff: Effect.Effect<A, E>) =>
          eff.pipe(
            Effect.timeoutOrElse({
              duration: HANDSHAKE_TIMEOUT,
              orElse: () => Effect.fail(new HandshakeTimeoutError({ serverName, timeoutMs })),
            }),
          )
        const initResult = yield* bounded(
          wire.request("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "aigcfroge", version: "0" },
          }),
        )
        if (!isRecord(initResult))
          return yield* new ProtocolError({ serverName, reason: "initialize result was not an object" })
        yield* wire.sendOnly({ jsonrpc: "2.0", method: "notifications/initialized" })
        const listed = yield* bounded(wire.request("tools/list"))
        const rawTools = isRecord(listed) && Array.isArray(listed.tools) ? listed.tools : []
        const discovered = rawTools.flatMap((t) => {
          if (!isRecord(t) || typeof t.name !== "string" || t.name.length === 0) return []
          return [
            {
              name: t.name,
              description: typeof t.description === "string" ? t.description : "",
              inputSchema: isRecord(t.inputSchema) ? t.inputSchema : { type: "object" },
            },
          ]
        })
        // Null prototype: server-provided tool names are external input; a
        // tool literally named `__proto__` must become an own data key, not
        // mutate Object.prototype (§6.2 red line).
        const wrapped: Record<string, Tool.AnyTool> = Object.create(null)
        for (const t of discovered) {
          wrapped[t.name] = Tool.makeRaw({
            description: t.description,
            // JsonSchema is `{ [x: string]: unknown }` — the guarded record
            // flows straight through, no assertion needed.
            inputSchema: t.inputSchema,
            execute: (callInput) =>
              callServer(serverName, t.name, callInput).pipe(
                Effect.catch((e) => new Tool.Failure({ message: e._tag })),
              ),
          })
        }
        // Registration lives on the CONNECTION's own scope: closing or killing
        // the connection unregisters its canonical names automatically.
        yield* registration
          .registerServer({ serverName, tools: wrapped })
          .pipe(Effect.provideService(Scope.Scope, connScope))
        // Routes derive from the keys that were ACTUALLY registered — never
        // from the discovered list — so a route can never exist without its
        // registration behind it.
        const registeredTools = Object.keys(wrapped).map((toolName) => ({
          toolName,
          canonicalName: canonicalToolName(serverName, toolName),
        }))
        const canonicalTools = registeredTools.map((tool) => tool.canonicalName)
        for (const tool of registeredTools) routes.set(tool.canonicalName, { server: serverName, tool: tool.toolName })
        wire.binding = binding
        wire.tools = canonicalTools
        wire.health = yield* setHealth({ serverName, to: "ready" })
        return new ConnInfo({ serverName, pid: wire.pid, health: wire.health })
      })

      return yield* established.pipe(
        Effect.tapError((error) =>
          setHealth({
            serverName,
            to: error instanceof CredentialMissingError || error instanceof CredentialExpiredError ? "auth-required" : "offline",
          }).pipe(Effect.catch(() => Effect.void)),
        ),
        Effect.onError(() => killConn(serverName, "owner_scope_closed")),
      )
    })

    return Service.of({
      connect,
      disconnect: Effect.fn("McpConnection.disconnect")(function* (serverName: string) {
        if (!health.has(serverName)) return yield* new NotConnectedError({ serverName })
        yield* killConn(serverName)
        health.delete(serverName)
      }),
      connections: Effect.fn("McpConnection.connections")(function* () {
        return [...conns.values()].map(
          (wire) => new ConnInfo({ serverName: wire.serverName, pid: wire.pid, health: wire.health }),
        )
      }),
      health: Effect.fn("McpConnection.health")(function* (serverName: string) {
        return health.get(serverName)
      }),
      facts: Effect.fn("McpConnection.facts")(function* () {
        return [...conns.values()].flatMap((wire) => {
          if (wire.binding === undefined || wire.tools === undefined) return []
          return [
            new Fact({
              serverName: wire.serverName,
              ref: wire.binding.ref,
              credentialRef: wire.binding.credentialRef,
              health: wire.health,
              tools: wire.tools,
            }),
          ]
        })
      }),
      callTool: Effect.fn("McpConnection.callTool")(function* (input: {
        readonly name: string
        readonly args: Record<string, unknown>
      }) {
        if (!ProductModePolicy.isCustomModeEnabled()) {
          yield* shutdownConnections("kill_switch_disabled")
          return yield* new McpDisabledError({ operation: "call" })
        }
        const route = routes.get(input.name)
        if (route === undefined) return yield* new UnknownToolError({ name: input.name })
        return yield* callServer(route.server, route.tool, input.args)
      }),
      shutdown,
    })
  }),
)
