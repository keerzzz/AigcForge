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
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { McpServerBinding } from "@aigcfroge/schema/mcp-scope"
import { canonicalToolName, McpRegistration, SERVER_NAME_PATTERN } from "../tool/mcp-registration"
import { RegistrationError, Tool } from "../tool/tool"

// Phase C Slice 1 (ADR-21 v1.1): the typed MCP connection owner. Each
// connection lives in its own owner Scope that terminates the child process;
// discovered tools enter the ONE canonical ToolRegistry through
// McpRegistration. Secrets are never touched on this path — a binding carrying
// credentialRef fails closed until Slice 2 delivers binding resolution.

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

/** Projection of one owned connection; health is runtime state, never frozen. */
export class ConnInfo extends Schema.Class<ConnInfo>("McpConnection.ConnInfo")({
  serverName: Schema.String,
  pid: Schema.Number,
  health: Schema.Literals(["connecting", "ready"]),
}) {}

export type ConnectError =
  | InvalidConfigError
  | ProcessStartError
  | HandshakeTimeoutError
  | ProtocolError
  | McpRegistration.InvalidServerNameError
  | McpRegistration.McpNameCollisionError
  | McpRegistration.McpToolNameTooLongError
  | RegistrationError

export type CallToolError = UnknownToolError | NotConnectedError | ProtocolError | ProcessStartError

type WireError = ProtocolError | ProcessStartError
type Pending = Deferred.Deferred<unknown, WireError>

interface Wire {
  readonly serverName: string
  readonly pid: number
  /** Owner scope of this connection: spawn handle + pump fibers die with it. */
  readonly scope: Scope.Closeable
  readonly request: (method: string, params?: unknown) => Effect.Effect<unknown, WireError>
  readonly sendOnly: (payload: unknown) => Effect.Effect<void>
  health: "connecting" | "ready"
}

export interface Interface {
  /** Connect one stdio server and register its tools under mcp_<server>_<tool>. */
  readonly connect: (input: { readonly binding: unknown }) => Effect.Effect<ConnInfo, ConnectError>
  /** Kill and forget one connection. */
  readonly disconnect: (serverName: string) => Effect.Effect<void, NotConnectedError>
  /** Runtime projection of every owned connection. */
  readonly connections: () => Effect.Effect<readonly ConnInfo[]>
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

const decodeBinding = Schema.decodeUnknownSync(McpServerBinding)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner
    const registration = yield* McpRegistration.Service

    const conns = new Map<string, Wire>()
    const routes = new Map<string, { readonly server: string; readonly tool: string }>()

    // Spawns the child and wires the newline-delimited JSON-RPC protocol
    // around it. Runs inside the caller-provided Scope so the spawn handle
    // and pump fibers die together when that scope closes.
    const buildWire = Effect.fn("McpConnection.buildWire")(function* (input: {
      readonly serverName: string
      readonly command: readonly [string, ...string[]]
      readonly scope: Scope.Closeable
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
        health: "connecting",
      }
      return wire
    })

    const killConn = (serverName: string) =>
      Effect.gen(function* () {
        const wire = conns.get(serverName)
        if (!wire) return
        conns.delete(serverName)
        // Canonical-name routes stay: a known name whose server died must fail
        // as NotConnectedError, not degrade into UnknownToolError.
        yield* Scope.close(wire.scope, Exit.void).pipe(Effect.ignore)
      })

    const shutdown = Effect.fn("McpConnection.shutdown")(function* () {
      for (const name of [...conns.keys()]) yield* killConn(name)
    })

    yield* Effect.addFinalizer(shutdown)

    const requestOn = (server: string, method: string, params?: unknown): Effect.Effect<unknown, CallToolError> =>
      Effect.gen(function* () {
        const wire = conns.get(server)
        if (wire === undefined) return yield* new NotConnectedError({ serverName: server })
        return yield* wire.request(method, params)
      })

    const callServer = (server: string, tool: string, args: unknown): Effect.Effect<unknown, CallToolError> =>
      requestOn(server, "tools/call", { name: tool, arguments: args ?? {} })

    const connect = Effect.fn("McpConnection.connect")(function* (input: { readonly binding: unknown }) {
      const binding = yield* Effect.try({
        try: () => decodeBinding(input.binding),
        catch: () =>
          new InvalidConfigError({ serverName: "(undecodable)", reason: "binding failed McpServerBinding decode" }),
      })
      const serverName = binding.serverName
      if (!SERVER_NAME_PATTERN.test(serverName)) yield* new McpRegistration.InvalidServerNameError({ serverName })
      if (binding.transport !== "stdio")
        return yield* new InvalidConfigError({
          serverName,
          reason: `transport '${String(binding.transport)}' arrives with remote/OAuth (Slice 3)`,
        })
      if (binding.command === undefined || binding.command.length === 0)
        return yield* new InvalidConfigError({ serverName, reason: "stdio transport requires a command" })
      if (binding.credentialRef !== undefined)
        return yield* new InvalidConfigError({
          serverName,
          reason: "credentialRef resolution arrives with credential binding (Slice 2)",
        })
      const commandTuple: readonly [string, ...string[]] = [binding.command[0], ...binding.command.slice(1)]

      const connScope = yield* Scope.make()
      const wireExit = yield* buildWire({ serverName, command: commandTuple, scope: connScope }).pipe(
        Effect.provideService(Scope.Scope, connScope),
        Effect.exit,
      )
      if (Exit.isFailure(wireExit)) {
        yield* Scope.close(connScope, Exit.void).pipe(Effect.ignore)
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
        for (const toolName of Object.keys(wrapped))
          routes.set(canonicalToolName(serverName, toolName), { server: serverName, tool: toolName })
        wire.health = "ready"
        return new ConnInfo({ serverName, pid: wire.pid, health: "ready" })
      })

      return yield* established.pipe(Effect.onError(() => killConn(serverName)))
    })

    return Service.of({
      connect,
      disconnect: Effect.fn("McpConnection.disconnect")(function* (serverName: string) {
        if (!conns.has(serverName)) return yield* new NotConnectedError({ serverName })
        return yield* killConn(serverName)
      }),
      connections: Effect.fn("McpConnection.connections")(function* () {
        return [...conns.values()].map(
          (wire) => new ConnInfo({ serverName: wire.serverName, pid: wire.pid, health: wire.health }),
        )
      }),
      callTool: Effect.fn("McpConnection.callTool")(function* (input: {
        readonly name: string
        readonly args: Record<string, unknown>
      }) {
        const route = routes.get(input.name)
        if (route === undefined) return yield* new UnknownToolError({ name: input.name })
        return yield* callServer(route.server, route.tool, input.args)
      }),
      shutdown,
    })
  }),
)
