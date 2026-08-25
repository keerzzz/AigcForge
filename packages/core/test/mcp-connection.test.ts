import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer, Schema } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
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
import * as path from "node:path"
import { readFileSync } from "node:fs"
import { pollWithTimeout, testEffect } from "./lib/effect"

// Slice 1 (ADR-21 v1.1 / M3 plan §3 Phase C): the typed MCP connection owner.
// Every lifecycle failure is a typed failure, every child process is owned by
// an owner Scope, and discovered tools enter the ONE canonical ToolRegistry
// through McpRegistration — never a second registry.

const FIXTURE = path.join(import.meta.dir, "fixture", "mcp", "fake-mcp-server.mjs")

const permission = Layer.mock(PermissionV2.Service, { assert: () => Effect.void })
const Deps = Layer.mergeAll(CrossSpawnSpawner.defaultLayer, ApplicationTools.layer, ToolOutputStore.defaultLayer).pipe(
  Layer.provide(permission),
)
// Shared value => memoized into ONE ToolRegistry across owner + assertions.
const RegistryLayer = McpRegistration.layer.pipe(Layer.provide(Deps))
const TestLayer = Layer.mergeAll(
  McpConnection.layer.pipe(Layer.provide(RegistryLayer), Layer.provide(CrossSpawnSpawner.defaultLayer)),
  RegistryLayer,
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

type Probe = { readonly failed: boolean; readonly tag?: string }
const probe = <A, E>(eff: Effect.Effect<A, E, never>): Effect.Effect<Probe> =>
  eff.pipe(
    Effect.match({
      onFailure: (e) =>
        ({
          failed: true,
          tag: typeof e === "object" && e !== null && "_tag" in e ? String(e._tag) : undefined,
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

  it.live("fails closed when a stdio binding carries a credentialRef (Slice 2 boundary)", () =>
    Effect.gen(function* () {
      const conn = yield* McpConnection.Service
      const result = yield* probe(conn.connect({ binding: binding({ credentialRef: "cred_" + "a".repeat(32) }) }))
      expect(result.failed).toBe(true)
      expect(result.tag).toBe("McpConnection.InvalidConfigError")
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
})
