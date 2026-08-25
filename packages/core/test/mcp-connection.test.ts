import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
import { CredentialScanner } from "@aigcfroge/core/credential-scanner"
import { FSUtil } from "@aigcfroge/core/fs-util"
import { Global } from "@aigcfroge/core/global"
import { McpConnection } from "@aigcfroge/core/mcp/connection"
import { McpRegistration } from "@aigcfroge/core/tool/mcp-registration"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { Tool } from "@aigcfroge/core/tool/tool"
import { Tools } from "@aigcfroge/core/tool/tools"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { McpServerBinding } from "@aigcfroge/schema/mcp-scope"
import { Composition } from "@aigcfroge/schema/composition"
import { Credential } from "@aigcfroge/core/credential"
import { Integration } from "@aigcfroge/schema/integration"
import { McpCredentialBindingStore } from "@aigcfroge/core/mcp/binding/store"
import { Location } from "@aigcfroge/core/location"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { pollWithTimeout, testEffect } from "./lib/effect"
import { location as fixtureLocation } from "./fixture/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { withCustomModeEnabled } from "./lib/product-mode"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"

// Slice 1-2 (ADR-21 v1.2 / M3 plan §3 Phase C): the typed MCP connection owner.
// Every lifecycle failure is a typed failure, every child process is owned by
// an owner Scope, and discovered tools enter the ONE canonical ToolRegistry
// through McpRegistration — never a second registry.

const FIXTURE = path.join(import.meta.dir, "fixture", "mcp", "fake-mcp-server.mjs")

withCustomModeEnabled()

const permission = Layer.mock(PermissionV2.Service, { assert: () => Effect.void })
const dbEvents = Layer.mergeAll(Database.defaultLayer, EventV2.defaultLayer)
const testLocation = Layer.succeed(
  Location.Service,
  fixtureLocation({ directory: AbsolutePath.make("/tmp/test-mcp-connection") }),
)
const credentialStore = Credential.layer.pipe(Layer.provide(dbEvents))
const bindingStore = McpCredentialBindingStore.layer.pipe(Layer.provide(dbEvents), Layer.provide(testLocation))
const Deps = Layer.mergeAll(CrossSpawnSpawner.defaultLayer, ApplicationTools.layer, ToolOutputStore.defaultLayer).pipe(
  Layer.provide(permission),
)
// Shared value => memoized into ONE ToolRegistry across owner + assertions.
const RegistryLayer = McpRegistration.layer.pipe(Layer.provide(Deps))
// Provided the same way production does (location-layer.ts): if the harness were
// the only place the scanner came from, the stderr redaction path would be green
// here and absent in production — §4.6 trap 3.
const scannedRemoteTexts: string[] = []
const scannerLayer = CredentialScanner.layer
const trackingScannerLayer = Layer.effect(
  CredentialScanner.Service,
  Effect.gen(function* () {
    const scanner = yield* CredentialScanner.Service
    return CredentialScanner.Service.of({
      scan: (text) => scanner.scan(text).pipe(Effect.tap(() => Effect.sync(() => scannedRemoteTexts.push(text)))),
    })
  }),
).pipe(Layer.provide(scannerLayer))
let remoteReplies: Response[] = []
let remoteFailures: Error[] = []
let remoteStarted: Deferred.Deferred<void> | undefined
let remoteBlock: Deferred.Deferred<void> | undefined
const remoteRequests: Array<{ readonly url: string; readonly headers: Readonly<Record<string, string>> }> = []
const remoteHttp = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.suspend(() => {
      const failure = remoteFailures.shift()
      if (failure)
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause: failure, description: failure.message }),
          }),
        )
      const next = remoteReplies.shift()
      remoteRequests.push({ url: request.url, headers: request.headers })
      if (remoteStarted && remoteBlock)
        return Deferred.succeed(remoteStarted, undefined).pipe(
          Effect.andThen(Deferred.await(remoteBlock)),
          Effect.andThen(Effect.succeed(HttpClientResponse.fromWeb(request, next ?? new Response("{}")))),
        )
      return Effect.succeed(HttpClientResponse.fromWeb(request, next ?? new Response("{}")))
    }),
  ),
)
const TestLayer = Layer.mergeAll(
  McpConnection.layer.pipe(
    Layer.provide(RegistryLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(bindingStore),
    Layer.provide(credentialStore),
    Layer.provide(trackingScannerLayer),
    Layer.provide(remoteHttp),
    Layer.provide(testLocation),
    Layer.provide(dbEvents),
  ),
  RegistryLayer,
  bindingStore,
  credentialStore,
  trackingScannerLayer,
  remoteHttp,
  testLocation,
  dbEvents,
)
const it = testEffect(TestLayer)

const REVISION = Schema.decodeUnknownSync(Composition.Revision)("a".repeat(64))

const binding = (
  over: {
    serverName?: string
    mode?: string
    command?: ReadonlyArray<string>
    transport?: "stdio" | "remote"
    url?: string
    credentialRef?: string
  } = {},
) =>
  Schema.decodeUnknownSync(McpServerBinding)({
    serverName: over.serverName ?? "fake",
    ref: { relativePath: "mcp/fake.json", revision: REVISION },
    transport: over.transport ?? "stdio",
    ...(over.url === undefined ? {} : { url: over.url }),
    ...(over.credentialRef === undefined ? {} : { credentialRef: over.credentialRef }),
    command: over.command ?? [process.execPath, FIXTURE, over.mode ?? "ok"],
  })

type Probe = { readonly failed: boolean; readonly tag?: string; readonly reason?: string }
const probe = <A, E>(eff: Effect.Effect<A, E, never>): Effect.Effect<Probe> =>
  eff.pipe(
    Effect.match({
      onFailure: (e) =>
        ({
          failed: true,
          tag: typeof e === "object" && e !== null && "_tag" in e ? String(e._tag) : undefined,
          reason: typeof e === "object" && e !== null && "reason" in e ? String(e.reason) : undefined,
        }) satisfies Probe,
      onSuccess: (): Probe => ({ failed: false }),
    }),
  )

// Linux-only liveness of THE SPAWNED BINARY: the pid must exist with our
// fixture cmdline AND not be a zombie. Both halves matter — pids on this
// machine are recycled within milliseconds (a bare /proc/<pid>/stat check
// would report a recycled process as alive), and a zombie still exposes a
// matching cmdline while being dead for every practical purpose.
const alive = (pid: number) =>
  Effect.sync(() => {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      if (!cmdline.includes("fake-mcp-server.mjs")) return false
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
      const state = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trimStart()
        .split(" ")[0]
      return state !== "Z"
    } catch {
      return false
    }
  })

const waitDead = (pid: number) =>
  Effect.gen(function* () {
    while (yield* alive(pid)) yield* Effect.sleep("20 millis")
  }).pipe(
    Effect.timeoutOrElse({
      duration: "10 seconds",
      orElse: () => Effect.die(new Error(`child pid ${pid} survived`)),
    }),
  )

describe("McpConnection typed stdio owner (Phase C Slice 1)", () => {
  it.live("rejects an invalid server name before spawning any process", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(conn.connect({ binding: binding({ serverName: "Bad Name" }) }))
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpRegistration.InvalidServerNameError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("rejects a stdio binding without a command", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(conn.connect({ binding: binding({ command: [] }) }))
      expect(result.tag).toBe("McpConnection.InvalidConfigError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("fails typed when the executable does not exist", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(
        conn.connect({ binding: binding({ command: ["/nonexistent/aigcfroge-missing-bin"] }) }),
      )
      expect(result.tag).toBe("McpConnection.ProcessStartError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("fails typed when the process exits during startup", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(conn.connect({ binding: binding({ mode: "crash" }) }))
      expect(result.tag).toBe("McpConnection.ProcessStartError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.effect("fails the handshake with a typed timeout when initialize is never answered", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const fiber = yield* Effect.forkScoped(conn.connect({ binding: binding({ mode: "silent" }) }))
      yield* TestClock.adjust("30 seconds")
      const result = yield* probe(Fiber.join(fiber))
      expect(result.tag).toBe("McpConnection.HandshakeTimeoutError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("fails typed on protocol garbage from stdout", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(conn.connect({ binding: binding({ mode: "garbage" }) }))
      expect(result.tag).toBe("McpConnection.ProtocolError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("interrupting a pending connect kills the spawned child", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const fiber = yield* Effect.forkScoped(conn.connect({ binding: binding({ mode: "silent" }) }))
      const seen = yield* pollWithTimeout(
        Effect.map(conn.connections(), (list) => list.find((c) => c.serverName === "fake")),
        "connection never appeared",
        "10 seconds",
      )
      if (seen === undefined) {
        yield* Effect.fail(new Error("connection disappeared before interrupt"))
        return
      }
      if (seen.pid === undefined) throw new Error("stdio connection did not expose a pid")
      yield* Fiber.interrupt(fiber)
      yield* waitDead(seen.pid)
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("closing the owning scope kills every child process (no orphans)", () =>
    Effect.gen(function* () {
      let pid: number | undefined
      yield* Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* McpConnection.Service
          const info = yield* conn.connect({ binding: binding() })
          pid = info.pid
          expect(info.health).toBe("ready")
          // Layer.fresh defeats memoization against the OUTER provide that
          // testEffect.run wraps around every body: without it the shared layer's
          // finalizers attach to the outermost scope and the inner scoped exit
          // being asserted here would never run them.
        }).pipe(Effect.provide(TestLayer.pipe(Layer.fresh))),
      )
      if (pid === undefined) throw new Error("connect did not report a pid")
      yield* waitDead(pid)
    }),
  )

  it.live("disconnect releases a real stdio pending call with a typed close reason", () =>
    Effect.gen(function* () {
      const marker = path.join("/tmp", `aigcfroge-mcp-pending-${randomUUID()}`)
      const conn = yield* McpConnection.Service
      const info = yield* conn.connect({
        binding: binding({ serverName: "pending", command: [process.execPath, FIXTURE, "pendingcall", marker] }),
      })
      if (info.pid === undefined) throw new Error("stdio connection did not expose a pid")
      const fiber = yield* Effect.forkScoped(probe(conn.callTool({ name: "mcp_pending_echo", args: {} })))
      yield* pollWithTimeout(
        Effect.promise(() => Bun.file(marker).exists()).pipe(Effect.flatMap((exists) => (exists ? Effect.succeed(marker) : Effect.succeed(undefined)))),
        "stdio server never observed the pending tool call",
      )
      yield* conn.disconnect("pending")
      const result = yield* Fiber.join(fiber)
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpConnection.ConnectionClosedError")
      expect(result.reason).toBe("disconnect")
      yield* waitDead(info.pid)
      expect(yield* conn.connections()).toHaveLength(0)
      yield* Effect.promise(() => Bun.file(marker).delete()).pipe(Effect.ignore)
    }),
  )

  it.live("revoking a bound credential fails the next tool admission before the server observes it", () =>
    Effect.gen(function* () {
      const marker = path.join("/tmp", `aigcfroge-mcp-revoked-${randomUUID()}`)
      const credential = yield* Credential.Service
      const bindings = yield* McpCredentialBindingStore.Service
      const conn = yield* McpConnection.Service
      const stored = yield* credential.create({
        integrationID: Integration.ID.make("int_mcp_call_revoke"),
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: "key" }),
        label: "revoke-before-call",
      })
      const storedBinding = yield* bindings.bind({ serverName: "revoke-call", credentialRef: String(stored.id) })
      yield* conn.connect({
        binding: binding({
          serverName: "revoke-call",
          credentialRef: String(stored.id),
          command: [process.execPath, FIXTURE, "pendingcall", marker],
        }),
      })
      yield* bindings.revoke(storedBinding.id, storedBinding.bindingRevision)

      const result = yield* probe(conn.callTool({ name: "mcp_revoke-call_echo", args: {} }))
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpBinding.RevokedRefError")
      expect(yield* conn.health("revoke-call")).toBe("revoked")
      expect((yield* conn.facts()).find((fact) => fact.serverName === "revoke-call")?.health).toBe("revoked")
      expect(yield* Effect.promise(() => Bun.file(marker).exists())).toBe(false)
      yield* conn.disconnect("revoke-call")
    }),
  )

  it.live("connection facts expose only successful canonical registration identity", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      yield* conn.connect({ binding: binding({ serverName: "fact-server" }) })
      const facts = yield* conn.facts()
      expect(facts).toHaveLength(1)
      expect(facts[0]?.serverName).toBe("fact-server")
      expect(facts[0]?.ref).toEqual({ relativePath: "mcp/fake.json", revision: REVISION })
      expect(facts[0]?.tools).toEqual(["mcp_fact-server_echo", "mcp_fact-server_desc"])
      expect("command" in (facts[0] ?? {})).toBe(false)
      yield* conn.disconnect("fact-server")
    }),
  )

  it.live("kill switch rejects new admission and closes an already pending call", () =>
    Effect.gen(function* () {
      const marker = path.join("/tmp", `aigcfroge-mcp-kill-${randomUUID()}`)
      const conn = yield* McpConnection.Service
      const info = yield* conn.connect({
        binding: binding({ serverName: "killswitch", command: [process.execPath, FIXTURE, "pendingcall", marker] }),
      })
      if (info.pid === undefined) throw new Error("stdio connection did not expose a pid")
      const pending = yield* Effect.forkScoped(probe(conn.callTool({ name: "mcp_killswitch_echo", args: {} })))
      yield* pollWithTimeout(
        Effect.promise(() => Bun.file(marker).exists()).pipe(Effect.flatMap((exists) => (exists ? Effect.succeed(marker) : Effect.succeed(undefined)))),
        "stdio server never observed the pending tool call",
      )
      const saved = process.env["AIGCFROGE_CUSTOM_MODE"]
      delete process.env["AIGCFROGE_CUSTOM_MODE"]
      const disabled = yield* probe(
        conn.connect({ binding: binding({ serverName: "new-server", mode: "ok" }) }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (saved === undefined) delete process.env["AIGCFROGE_CUSTOM_MODE"]
            else process.env["AIGCFROGE_CUSTOM_MODE"] = saved
          }),
        ),
      )
      expect(disabled.tag).toBe("McpConnection.McpDisabledError")
      const pendingResult = yield* Fiber.join(pending)
      expect(pendingResult.failed).toBe(true)
      expect(pendingResult.tag).toBe("McpConnection.ConnectionClosedError")
      expect(pendingResult.reason).toBe("kill_switch_disabled")
      expect(yield* conn.connections()).toHaveLength(0)
      yield* waitDead(info.pid)
      yield* Effect.promise(() => Bun.file(marker).delete()).pipe(Effect.ignore)
    }),
  )

  it.live("disconnect kills that server's child and further calls fail closed", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const info = yield* conn.connect({ binding: binding() })
      if (info.pid === undefined) throw new Error("stdio connection did not expose a pid")
      yield* conn.disconnect(info.serverName)
      yield* waitDead(info.pid)
      const result = yield* probe(conn.callTool({ name: "mcp_fake_echo", args: { msg: "hi" } }))
      expect(result.tag).toBe("McpConnection.NotConnectedError")
    }),
  )

  it.live("registers discovered tools under mcp_<server>_<tool> in the one canonical registry", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      yield* conn.connect({ binding: binding() })
      const registry = yield* ToolRegistry.Service
      const names = registry.registeredNames()
      expect(names.has("mcp_fake_echo")).toBe(true)
      expect(names.has("mcp_fake_desc")).toBe(true)
      const { definitions } = yield* registry.materialize()
      const echoDef = definitions.find((d) => d.name === "mcp_fake_echo")
      expect(echoDef?.description).toBe("Echo a message")
    }),
  )

  it.live("a name collision fails closed and leaves the previous winner untouched", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const tools = yield* Tools.Service
      const sentinel = Tool.makeRaw({
        description: "sentinel",
        inputSchema: { type: "object" },
        execute: () => Effect.succeed("sentinel"),
      })
      yield* tools.register({ mcp_fake_echo: sentinel })
      const result = yield* probe(conn.connect({ binding: binding() }))
      expect(result.tag).toBe("McpRegistration.McpNameCollisionError")
      // The failed registration must not leak its own child either.
      expect(yield* conn.connections()).toHaveLength(0)
      // The previous winner is still what answers for the name.
      const registry = yield* ToolRegistry.Service
      const { definitions } = yield* registry.materialize()
      expect(definitions.find((d) => d.name === "mcp_fake_echo")?.description).toBe("sentinel")
    }),
  )

  it.live("callTool round-trips through the connected server", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      yield* conn.connect({ binding: binding() })
      const out = yield* conn.callTool({ name: "mcp_fake_echo", args: { msg: "hi" } })
      expect(JSON.stringify(out)).toContain("echo:hi")
    }),
  )

  it.live("calling an unregistered MCP tool fails closed", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      yield* conn.connect({ binding: binding() })
      const result = yield* probe(conn.callTool({ name: "mcp_nope_missing", args: {} }))
      expect(result.tag).toBe("McpConnection.UnknownToolError")
    }),
  )

  it.live("escalates to SIGKILL for a child that ignores SIGTERM (forceKillAfter ceiling)", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const info = yield* conn.connect({ binding: binding({ serverName: "stubborn", mode: "stubborn" }) })
      // Bound the teardown itself: without the SIGKILL escalation the release
      // path awaits a TERM this fixture swallows forever.
      yield* conn.disconnect(info.serverName).pipe(
        Effect.timeoutOrElse({
          duration: "8 seconds",
          orElse: () => Effect.fail(new Error("disconnect hung: no forceKillAfter SIGKILL escalation")),
        }),
      )
      // TERM is ignored by this fixture; death must still arrive via the
      // spawner's forceKillAfter group-SIGKILL escalation (~3s), well inside
      // this 15s bound. If that option disappears from spawn options this
      // test goes red at its timeout.
      if (info.pid === undefined) throw new Error("stdio connection did not expose a pid")
      yield* waitDead(info.pid)
    }),
  )

  it.live("enters auth-required when a stdio binding carries an unbound credentialRef", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(conn.connect({ binding: binding({ credentialRef: "cred_" + "a".repeat(32) }) }))
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpConnection.CredentialMissingError")
      expect(yield* conn.health("fake")).toBe("auth-required")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("registers and routes a tool literally named __proto__ (no prototype pollution)", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      yield* conn.connect({ binding: binding({ serverName: "proto", mode: "proto" }) })
      const registry = yield* ToolRegistry.Service
      const names = registry.registeredNames()
      // The names assertion comes FIRST so a regression here is a fast,
      // deterministic red instead of a hung callTool.
      expect(names.has("mcp_proto_good")).toBe(true)
      expect(names.has("mcp_proto___proto__")).toBe(true)
      const out = yield* conn.callTool({ name: "mcp_proto___proto__", args: { msg: "hi" } })
      expect(JSON.stringify(out)).toContain("echo:hi")
    }),
  )

  it.live("credential update keeps binding transparent, create with new ID dangles and requires rebinding", () =>
    Effect.gen(function* () {
      const credential = yield* Credential.Service
      const bindingStore = yield* McpCredentialBindingStore.Service
      const conn = yield* McpConnection.Service
      // Create initial credential and bind
      const intID = Schema.decodeUnknownSync(Integration.ID)("int_test")
      const created = yield* credential.create({
        integrationID: intID,
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: "k1" }),
        label: "test",
      })
      const bind = yield* bindingStore.bind({ serverName: "credtest", credentialRef: String(created.id) })
      const info1 = yield* conn.connect({
        binding: binding({ serverName: "credtest", credentialRef: String(created.id) }),
      })
      expect(info1.health).toBe("ready")
      yield* conn.disconnect(info1.serverName)
      yield* credential.update(created.id, {
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: "k2" }),
      })
      const info2 = yield* conn.connect({
        binding: binding({ serverName: "credtest", credentialRef: String(created.id) }),
      })
      expect(info2.health).toBe("ready")
      yield* conn.disconnect(info2.serverName)
      const recreated = yield* credential.create({
        integrationID: intID,
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: "k3" }),
        label: "test2",
      })
      expect(String(recreated.id)).not.toBe(String(created.id))
      // Unconditional: a nested `if (... instanceof ...)` here would skip the
      // assertion whenever the error type changed, which is precisely the
      // regression this case exists to catch.
      const danglingProbe = yield* probe(
        conn.connect({ binding: binding({ serverName: "credtest", credentialRef: String(created.id) }) }),
      )
      expect(danglingProbe.failed).toBe(true)
      expect(danglingProbe.tag).toBe("McpConnection.CredentialMissingError")
      // Rebind after revoke should restore: first revoke the old binding
      const revoked = yield* bindingStore.revoke(bind.id, bind.bindingRevision)
      const rebind = yield* bindingStore.rebind(revoked.id, revoked.bindingRevision, recreated.id as string)
      expect(rebind.credentialRef).toBe(recreated.id)
      const info3 = yield* conn.connect({
        binding: binding({ serverName: "credtest", credentialRef: recreated.id as string }),
      })
      expect(info3.health).toBe("ready")
    }),
  )

  it.live("connection-time credential isolation rejects Location B after Location A has connected", () =>
    Effect.gen(function* () {
      const credential = yield* Credential.Service
      const bindingStore = yield* McpCredentialBindingStore.Service
      const conn = yield* McpConnection.Service
      const created = yield* credential.create({
        integrationID: Integration.ID.make("int_cross_location_connect"),
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: "key" }),
        label: "cross location",
      })
      yield* bindingStore.bind({ serverName: "cross-location", credentialRef: String(created.id) })
      const fromA = yield* conn.connect({
        binding: binding({ serverName: "cross-location", credentialRef: String(created.id) }),
      })
      expect(fromA.health).toBe("ready")

      const db = yield* Database.Service
      const events = yield* EventV2.Service
      const locationB = Layer.succeed(
        Location.Service,
        fixtureLocation({ directory: AbsolutePath.make("/tmp/test-mcp-connection-b") }),
      )
      const bindingsB = McpCredentialBindingStore.layer.pipe(
        Layer.provide(Layer.mergeAll(Layer.succeed(Database.Service, db), Layer.succeed(EventV2.Service, events), locationB)),
      )
      const connectionB = McpConnection.layer.pipe(
        Layer.provide(RegistryLayer.pipe(Layer.fresh)),
        Layer.provide(CrossSpawnSpawner.defaultLayer),
        Layer.provide(bindingsB),
        Layer.provide(Layer.succeed(Credential.Service, credential)),
        Layer.provide(trackingScannerLayer),
        Layer.provide(remoteHttp),
        Layer.provide(locationB),
        Layer.fresh,
      )
      const fromB = yield* McpConnection.Service.use((other) =>
        probe(other.connect({ binding: binding({ serverName: "cross-location", credentialRef: String(created.id) }) })),
      ).pipe(Effect.provide(connectionB))
      expect(fromB.tag).toBe("McpBinding.CrossLocationRefError")
      expect(yield* conn.connections()).toHaveLength(1)
      yield* conn.disconnect("cross-location")
    }),
  )

  it.live("rejects a binding whose command carries secret-like material (ADR-21 §2.5 止血 2)", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      // The single most common leak path: a user pastes the token straight into
      // the MCP command line. This must die at decode, before any spawn.
      const result = yield* probe(
        conn.connect({
          binding: {
            serverName: "leaky",
            ref: { relativePath: "mcp/leaky.json", revision: REVISION },
            transport: "stdio",
            command: [process.execPath, FIXTURE, "ok", "--api_key=sk-live-abcdefghijklmnopqrstuvwxyz012345"],
          },
        }),
      )
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpConnection.InvalidConfigError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("injects the resolved material into the child env and leaks it nowhere else", () =>
    Effect.gen(function* () {
      const credential = yield* Credential.Service
      const bindingStore = yield* McpCredentialBindingStore.Service
      const conn = yield* McpConnection.Service
      const SECRET = "sk-live-envprobe-0123456789abcdef"
      const created = yield* credential.create({
        integrationID: Integration.ID.make("int_envtest"),
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: SECRET }),
        label: "envtest",
      })
      yield* bindingStore.bind({ serverName: "envsrv", credentialRef: String(created.id) })
      const info = yield* conn.connect({
        binding: binding({ serverName: "envsrv", mode: "envecho", credentialRef: String(created.id) }),
      })
      expect(info.health).toBe("ready")

      // 1. The material really reached the child: the fixture echoes its own env.
      const called = yield* conn.callTool({ name: "mcp_envsrv_echo", args: {} })
      expect(JSON.stringify(called)).toContain(SECRET)

      // 2. It is not on the runtime projection.
      const projected = JSON.stringify(yield* conn.connections())
      expect(projected).not.toContain(SECRET)

      // 3. It is not on the registered tool catalog either — the registry is the
      //    surface a provider turn sees, so a leak there would reach the model.
      const registry = yield* ToolRegistry.Service
      const catalog = JSON.stringify([...registry.registeredNames()])
      expect(catalog).not.toContain(SECRET)
      expect(catalog).toContain("mcp_envsrv_echo")

      yield* conn.disconnect("envsrv")
    }),
  )

  it.effect("redactStderrLine scans BEFORE truncating (a secret straddling the boundary still matches)", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const secret = "sk-live-abcdefghijklmnopqrstuvwxyz012345"
      const line = `${"x".repeat(McpConnection.MAX_STDERR_LOG + 400)} api_key=${secret}`

      // Production path: the real function the stderr pump calls.
      const out = yield* McpConnection.redactStderrLine(scanner, line)
      expect(out.secretHits).toBeGreaterThan(0)
      expect(out.redacted).not.toContain(secret)
      expect(out.redacted.length).toBeLessThanOrEqual(McpConnection.MAX_STDERR_LOG)

      // Inverted order, for contrast: truncate first and the secret is sliced
      // off, so nothing matches — that is the bug this ordering prevents.
      const truncatedFirst = yield* scanner.scan(line.slice(0, McpConnection.MAX_STDERR_LOG))
      expect(truncatedFirst.hits.length).toBe(0)
    }),
  )

  it.live("survives a secret-bearing stderr line without failing the connection", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const info = yield* conn.connect({ binding: binding({ serverName: "errsrv", mode: "stderrsecret" }) })
      expect(info.health).toBe("ready")
      const projected = JSON.stringify(yield* conn.connections())
      expect(projected).not.toContain("sk-live-abcdefghijklmnopqrstuvwxyz012345")
      yield* conn.disconnect("errsrv")
    }),
  )
})

describe("McpConnection remote/OAuth health (Phase C Slice 3)", () => {
  it.effect("admits every legal health edge and rejects revoked-to-ready without rebind", () =>
    Effect.gen(function* () {
      const legal = [
        ["connecting", "ready"],
        ["connecting", "degraded"],
        ["connecting", "offline"],
        ["connecting", "auth-required"],
        ["connecting", "revoked"],
        ["ready", "connecting"],
        ["ready", "degraded"],
        ["ready", "offline"],
        ["ready", "revoked"],
        ["degraded", "connecting"],
        ["degraded", "ready"],
        ["degraded", "offline"],
        ["offline", "connecting"],
        ["auth-required", "connecting"],
      ] as const
      for (const [from, to] of legal) expect(yield* McpConnection.transitionHealth({ from, to })).toBe(to)
      expect(yield* McpConnection.transitionHealth({ from: "revoked", to: "connecting", rebound: true })).toBe(
        "connecting",
      )

      for (const [from, to] of [
        ["ready", "auth-required"],
        ["offline", "ready"],
        ["auth-required", "ready"],
        ["revoked", "ready"],
        ["revoked", "connecting"],
      ] as const) {
        const error = yield* McpConnection.transitionHealth({ from, to }).pipe(Effect.flip)
        expect(error._tag).toBe("McpConnection.HealthTransitionError")
        expect(error.from).toBe(from)
        expect(error.to).toBe(to)
      }
      const revoked = yield* McpConnection.transitionHealth({ from: "revoked", to: "connecting" }).pipe(Effect.flip)
      expect(revoked.requiresRebind).toBe(true)
    }),
  )

  it.live("connects a remote server through the same owner and canonical registry", () =>
    Effect.gen(function* () {
      remoteReplies = [
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "remote", version: "0" } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
        new Response("{}", { headers: { "content-type": "application/json" } }),
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              tools: [
                {
                  name: "echo",
                  description: "Remote echo",
                  inputSchema: { type: "object", properties: { msg: { type: "string" } } },
                },
              ],
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "remote:hi" }] } }), {
          headers: { "content-type": "application/json" },
        }),
      ]
      const conn = yield* McpConnection.Service
      const info = yield* conn.connect({
        binding: binding({ serverName: "remote", transport: "remote", url: "https://remote.test/mcp" }),
      })
      expect(info.health).toBe("ready")
      expect(info.pid).toBeUndefined()
      expect(remoteRequests).toHaveLength(3)
      expect(remoteRequests[0]?.headers.authorization).toBeUndefined()
      const registry = yield* ToolRegistry.Service
      expect(registry.registeredNames().has("mcp_remote_echo")).toBe(true)
      expect(JSON.stringify(yield* conn.callTool({ name: "mcp_remote_echo", args: { msg: "hi" } }))).toContain("remote:hi")
      yield* conn.disconnect("remote")
    }),
  )

  it.live("reconnect replaces the owned server definition through the canonical registry", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const first = yield* conn.connect({ binding: binding({ serverName: "reconnect", mode: "ok" }) })
      if (first.pid === undefined) throw new Error("stdio connection did not expose a pid")
      const registry = yield* ToolRegistry.Service
      expect((yield* registry.materialize()).definitions.find((item) => item.name === "mcp_reconnect_echo")?.description).toBe(
        "Echo a message",
      )

      const second = yield* conn.connect({ binding: binding({ serverName: "reconnect", mode: "changed" }) })
      expect(second.health).toBe("ready")
      expect((yield* registry.materialize()).definitions.find((item) => item.name === "mcp_reconnect_echo")?.description).toBe(
        "Changed echo",
      )
      yield* waitDead(first.pid)
      yield* conn.disconnect("reconnect")
    }),
  )

  it.live("sends resolved remote credentials only in the request header, never the connection projection", () =>
    Effect.gen(function* () {
      remoteRequests.length = 0
      scannedRemoteTexts.length = 0
      remoteFailures.length = 0
      remoteReplies = [
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          headers: { "content-type": "application/json" },
        }),
        new Response("{}", { headers: { "content-type": "application/json" } }),
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
          headers: { "content-type": "application/json" },
        }),
      ]
      const credential = yield* Credential.Service
      const bindings = yield* McpCredentialBindingStore.Service
      const conn = yield* McpConnection.Service
      const secret = "sk-live-remote-header-0123456789abcdef"
      const created = yield* credential.create({
        integrationID: Integration.ID.make("int_remote_header"),
        value: Schema.decodeUnknownSync(Credential.OAuth)({
          type: "oauth",
          methodID: "oauth",
          refresh: "refresh",
          access: secret,
          expires: Math.floor(Date.now() / 1000) + 60,
        }),
        label: "remote header",
      })
      yield* bindings.bind({ serverName: "header", credentialRef: String(created.id) })
      const info = yield* conn.connect({
        binding: binding({
          serverName: "header",
          transport: "remote",
          url: "https://header.test/mcp",
          credentialRef: String(created.id),
        }),
      })
      expect(remoteRequests[0]?.headers.authorization).toBe(`Bearer ${secret}`)
      expect(JSON.stringify(info)).not.toContain(secret)
      expect(JSON.stringify(yield* conn.connections())).not.toContain(secret)
      yield* conn.disconnect("header")
    }),
  )

  it.live("rejects a remote key credential instead of guessing a server-specific header contract", () =>
    Effect.gen(function* () {
      const credential = yield* Credential.Service
      const bindings = yield* McpCredentialBindingStore.Service
      const conn = yield* McpConnection.Service
      const created = yield* credential.create({
        integrationID: Integration.ID.make("int_remote_key"),
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: "key" }),
        label: "remote key",
      })
      yield* bindings.bind({ serverName: "remote-key", credentialRef: String(created.id) })
      const result = yield* probe(
        conn.connect({
          binding: binding({
            serverName: "remote-key",
            transport: "remote",
            url: "https://key.test/mcp",
            credentialRef: String(created.id),
          }),
        }),
      )
      expect(result.tag).toBe("McpConnection.InvalidConfigError")
      expect(result.reason).toBe("remote transport requires an OAuth credential")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("maps remote authentication rejection to auth-required rather than offline", () =>
    Effect.gen(function* () {
      remoteRequests.length = 0
      scannedRemoteTexts.length = 0
      remoteFailures.length = 0
      remoteReplies = [new Response("authorization required", { status: 401 })]
      const conn = yield* McpConnection.Service
      const result = yield* probe(
        conn.connect({ binding: binding({ serverName: "remote-auth", transport: "remote", url: "https://auth.test/mcp" }) }),
      )
      expect(result.tag).toBe("McpConnection.CredentialMissingError")
      expect(yield* conn.health("remote-auth")).toBe("auth-required")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )


  it.live("scans remote response headers and body through the connection path", () =>
    Effect.gen(function* () {
      const secret = "sk-live-remote-diagnostic-0123456789abcdef"
      scannedRemoteTexts.length = 0
      remoteFailures.length = 0
      remoteReplies = [
        new Response(`server api_key=${secret}`, {
          status: 503,
          headers: { authorization: `Bearer ${secret}` },
        }),
      ]
      const conn = yield* McpConnection.Service
      const result = yield* probe(
        conn.connect({ binding: binding({ serverName: "diagnostic", transport: "remote", url: "https://diag.test/mcp" }) }),
      )
      expect(result.tag).toBe("McpConnection.RemoteUnavailableError")
      expect(scannedRemoteTexts).toContain(`authorization: Bearer ${secret}`)
      expect(scannedRemoteTexts).toContain(`server api_key=${secret}`)
    }),
  )

  it.live("owner scope close fails an in-flight remote request with a typed close reason", () =>
    Effect.gen(function* () {
      const outerScope = yield* Effect.scope
      const started = yield* Deferred.make<void>()
      const blocked = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<Probe>()
      remoteRequests.length = 0
      remoteFailures.length = 0
      remoteStarted = undefined
      remoteBlock = undefined
      remoteReplies = [
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
          headers: { "content-type": "application/json" },
        }),
        new Response("{}", { headers: { "content-type": "application/json" } }),
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "wait", inputSchema: { type: "object" } }] } }), {
          headers: { "content-type": "application/json" },
        }),
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [] } }), {
          headers: { "content-type": "application/json" },
        }),
      ]
      yield* Effect.scoped(
        Effect.gen(function* () {
          const conn = yield* McpConnection.Service
          yield* conn.connect({
            binding: binding({ serverName: "close", transport: "remote", url: "https://close.test/mcp" }),
          })
          remoteStarted = started
          remoteBlock = blocked
          yield* conn
            .callTool({ name: "mcp_close_wait", args: {} })
            .pipe(probe, Effect.tap((result) => Deferred.succeed(completed, result)), Effect.forkIn(outerScope))
          yield* Deferred.await(started)
        }).pipe(Effect.provide(TestLayer.pipe(Layer.fresh))),
      )
      const result = yield* Deferred.await(completed)
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpConnection.ConnectionClosedError")
      expect(result.reason).toBe("owner_scope_closed")
      remoteStarted = undefined
      remoteBlock = undefined
    }),
  )

  it.live("maps unavailable remote admission to its typed failure and preserves offline health", () =>
    Effect.gen(function* () {
      scannedRemoteTexts.length = 0
      remoteFailures.length = 0
      remoteReplies = [
        new Response("service unavailable", { status: 503, headers: { "content-type": "text/plain" } }),
      ]
      const conn = yield* McpConnection.Service
      const result = yield* probe(
        conn.connect({ binding: binding({ serverName: "offline", transport: "remote", url: "https://offline.test/mcp" }) }),
      )
      expect(result.tag).toBe("McpConnection.RemoteUnavailableError")
      expect(yield* conn.health("offline")).toBe("offline")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("maps DNS, refused, and TLS transport failures through remote connect", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const cases = [
        ["dns", "getaddrinfo ENOTFOUND remote.test", "McpConnection.RemoteDnsError"],
        ["refused", "connect ECONNREFUSED 127.0.0.1", "McpConnection.RemoteConnectionRefusedError"],
        ["tls", "certificate verify failed", "McpConnection.RemoteTlsError"],
      ] as const
      for (const [serverName, message, expectedTag] of cases) {
        remoteReplies = []
        remoteFailures = [new Error(message)]
        const result = yield* probe(
          conn.connect({ binding: binding({ serverName, transport: "remote", url: `https://${serverName}.test/mcp` }) }),
        )
        expect(result.tag).toBe(expectedTag)
        expect(yield* conn.health(serverName)).toBe("offline")
      }
    }),
  )

  it.effect("classifies DNS, refused, and TLS transport failures as distinct typed errors", () =>
    Effect.sync(() => {
      const dns = McpConnection.classifyRemoteFailure({
        serverName: "remote",
        url: "https://remote.test/mcp",
        cause: new Error("getaddrinfo ENOTFOUND remote.test"),
      })
      const refused = McpConnection.classifyRemoteFailure({
        serverName: "remote",
        url: "https://remote.test/mcp",
        cause: new Error("connect ECONNREFUSED 127.0.0.1"),
      })
      const tls = McpConnection.classifyRemoteFailure({
        serverName: "remote",
        url: "https://remote.test/mcp",
        cause: new Error("certificate verify failed"),
      })
      expect(dns._tag).toBe("McpConnection.RemoteDnsError")
      expect(refused._tag).toBe("McpConnection.RemoteConnectionRefusedError")
      expect(tls._tag).toBe("McpConnection.RemoteTlsError")
    }),
  )

  it.live("distinguishes missing, expired, and revoked credentials while exposing the actionable health state", () =>
    Effect.gen(function* () {
      const credential = yield* Credential.Service
      const bindings = yield* McpCredentialBindingStore.Service
      const conn = yield* McpConnection.Service

      const missing = yield* probe(
        conn.connect({ binding: binding({ serverName: "missing", credentialRef: "cred_" + "m".repeat(32) }) }),
      )
      expect(missing.tag).toBe("McpConnection.CredentialMissingError")
      expect(yield* conn.health("missing")).toBe("auth-required")

      const expiredCredential = yield* credential.create({
        integrationID: Integration.ID.make("int_remote_expired"),
        value: Schema.decodeUnknownSync(Credential.OAuth)({
          type: "oauth",
          methodID: "oauth",
          refresh: "refresh",
          access: "access",
          expires: 0,
        }),
        label: "expired",
      })
      yield* bindings.bind({ serverName: "expired", credentialRef: String(expiredCredential.id) })
      const expired = yield* probe(
        conn.connect({ binding: binding({ serverName: "expired", credentialRef: String(expiredCredential.id) }) }),
      )
      expect(expired.tag).toBe("McpConnection.CredentialExpiredError")
      expect(yield* conn.health("expired")).toBe("auth-required")

      const revokedCredential = yield* credential.create({
        integrationID: Integration.ID.make("int_remote_revoked"),
        value: Schema.decodeUnknownSync(Credential.Key)({ type: "key", key: "key" }),
        label: "revoked",
      })
      const revokedBinding = yield* bindings.bind({ serverName: "revoked", credentialRef: String(revokedCredential.id) })
      yield* bindings.revoke(revokedBinding.id, revokedBinding.bindingRevision)
      const revoked = yield* probe(
        conn.connect({ binding: binding({ serverName: "revoked", credentialRef: String(revokedCredential.id) }) }),
      )
      expect(revoked.tag).toBe("McpBinding.RevokedRefError")
      expect(yield* conn.health("revoked")).toBe("revoked")
    }),
  )

  it.effect("scans remote headers and response text before they can reach logs", () =>
    Effect.gen(function* () {
      const scanner = yield* CredentialScanner.Service
      const secret = "sk-live-abcdefghijklmnopqrstuvwxyz012345"
      const redacted = yield* McpConnection.redactRemoteResponse(scanner, {
        headers: { authorization: `Bearer ${secret}` },
        body: `${"x".repeat(McpConnection.MAX_STDERR_LOG + 400)} api_key=${secret}`,
      })
      expect(redacted.secretHits).toBeGreaterThan(1)
      expect(redacted.entries.join("\n")).not.toContain(secret)
      expect(redacted.entries[1]?.length).toBeLessThanOrEqual(McpConnection.MAX_STDERR_LOG)
    }),
  )
})
