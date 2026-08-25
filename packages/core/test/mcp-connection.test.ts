import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
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
import { Credential } from "@aigcfroge/core/credential"
import { Integration } from "@aigcfroge/schema/integration"
import { McpCredentialBindingStore } from "@aigcfroge/core/mcp/binding/store"
import { Location } from "@aigcfroge/core/location"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { pollWithTimeout, testEffect } from "./lib/effect"
import { location as fixtureLocation } from "./fixture/location"
import { AbsolutePath } from "@aigcfroge/core/schema"

// Slice 1-2 (ADR-21 v1.2 / M3 plan §3 Phase C): the typed MCP connection owner.
// Every lifecycle failure is a typed failure, every child process is owned by
// an owner Scope, and discovered tools enter the ONE canonical ToolRegistry
// through McpRegistration — never a second registry.

const FIXTURE = path.join(import.meta.dir, "fixture", "mcp", "fake-mcp-server.mjs")

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
const scannerLayer = CredentialScanner.layer
const TestLayer = Layer.mergeAll(
  McpConnection.layer.pipe(
    Layer.provide(RegistryLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(bindingStore),
    Layer.provide(credentialStore),
    Layer.provide(scannerLayer),
    Layer.provide(testLocation),
    Layer.provide(dbEvents),
  ),
  RegistryLayer,
  bindingStore,
  credentialStore,
  scannerLayer,
  testLocation,
  dbEvents,
)
const it = testEffect(TestLayer)

const REVISION = "a".repeat(64)

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

  it.live("disconnect kills that server's child and further calls fail closed", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const info = yield* conn.connect({ binding: binding() })
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
      yield* waitDead(info.pid)
    }),
  )

  it.live("fails closed when a stdio binding carries a credentialRef without a binding (cross-location)", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(conn.connect({ binding: binding({ credentialRef: "cred_" + "a".repeat(32) }) }))
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpBinding.CrossLocationRefError")
      expect(yield* conn.connections()).toHaveLength(0)
    }),
  )

  it.live("fails closed on remote transport before Slice 3 delivers it", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(
        conn.connect({ binding: binding({ transport: "remote", url: "https://mcp.example.com/rpc" }) }),
      )
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpConnection.InvalidConfigError")
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
      expect(danglingProbe.tag).toBe("McpConnection.InvalidConfigError")
      expect(danglingProbe.reason).toBe("credential dangling, requires rebinding")
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
