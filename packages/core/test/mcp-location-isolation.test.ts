import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema, Scope } from "effect"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import * as os from "node:os"
import * as path from "node:path"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { McpConnection } from "@aigcfroge/core/mcp/connection"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { Composition } from "@aigcfroge/schema/composition"
import { McpServerBinding } from "@aigcfroge/schema/mcp-scope"
import { withCustomModeEnabled } from "./lib/product-mode"
import { pollWithTimeout, testEffect } from "./lib/effect"

/**
 * M3 exit condition, at the layer that actually decides it: "Location A's MCP
 * must not appear in Location B".
 *
 * Every other isolation assertion in this milestone builds its second Location
 * by hand — `Layer.fresh(RegistryLayer)` in `mcp-connection.test.ts`, a second
 * store layer in `mcp-credential-binding.test.ts`. Those prove the store and
 * connection owners honour a Location ref, but the separation itself is supplied
 * by the test, so they cannot fail if production stopped isolating. This one
 * goes through the real `LocationServiceMap` (`location-layer.ts:96`) and asks
 * it for two Locations, the same call the HTTP handlers make.
 *
 * Note what this does NOT cover: the *occupancy* domain is still process-global
 * because `ApplicationTools.layer` sits in the LayerMap's `dependencies`, so two
 * Locations binding the same server name collide. That is recorded in
 * technical-debt §3.2 and is a different claim from visibility — conflating the
 * two is what previously made this test look impossible to write.
 */
withCustomModeEnabled()

const FIXTURE = path.join(import.meta.dir, "fixture", "mcp", "fake-mcp-server.mjs")
const REVISION = Schema.decodeUnknownSync(Composition.Revision)("a".repeat(64))
const it = testEffect(LocationServiceMap.layer)

const bindingFor = (serverName: string) =>
  Schema.decodeUnknownSync(McpServerBinding)({
    serverName,
    ref: { relativePath: `mcp/${serverName}.json`, revision: REVISION },
    transport: "stdio",
    command: [process.execPath, FIXTURE, "ok"],
  })

/**
 * Gone entirely, not merely stopped: `/proc` where it exists (which also settles
 * identity against pid recycling), `process.kill(pid, 0)` elsewhere so the
 * Windows CI leg asserts this too. Mirrors `mcp-connection.test.ts`.
 */
const reaped = (pid: number) =>
  Effect.sync(() => {
    if (process.platform === "linux") {
      try {
        return !readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("fake-mcp-server.mjs")
      } catch {
        return true
      }
    }
    try {
      process.kill(pid, 0)
      return false
    } catch {
      return true
    }
  })

/** Both halves: the registry set and the definitions the model is handed. */
const view = (server: string) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const { definitions } = yield* registry.materialize()
    const name = `mcp_${server}_echo`
    return {
      registered: registry.registeredNames().has(name),
      materialized: definitions.some((definition) => definition.name === name),
    }
  })

describe("MCP Location isolation through the real LayerMap (M3 exit condition)", () => {
  it.live("keeps each Location's MCP tools and connections out of the other", () =>
    Effect.gen(function* () {
      const root = path.join(os.tmpdir(), `aigcfroge-loc-iso-${randomUUID()}`)
      const dirA = path.join(root, "a")
      const dirB = path.join(root, "b")
      mkdirSync(dirA, { recursive: true })
      mkdirSync(dirB, { recursive: true })
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(root, { recursive: true, force: true })))

      const locations = yield* LocationServiceMap
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void).pipe(Effect.ignore))
      const a = yield* Layer.buildWithScope(locations.get({ directory: AbsolutePath.make(dirA) }), scope)
      const b = yield* Layer.buildWithScope(locations.get({ directory: AbsolutePath.make(dirB) }), scope)

      // Distinct server names on purpose: same-name binding across Locations is
      // the occupancy question, which today collides (see the block comment).
      yield* McpConnection.Service.use((conn) => conn.connect({ binding: bindingFor("only-in-a") })).pipe(
        Effect.provide(a),
      )
      yield* McpConnection.Service.use((conn) => conn.connect({ binding: bindingFor("only-in-b") })).pipe(
        Effect.provide(b),
      )

      // Bidirectional, and each Location does see its own — without that half,
      // a registry that returned nothing at all would pass every absence check.
      expect(yield* view("only-in-a").pipe(Effect.provide(a))).toEqual({ registered: true, materialized: true })
      expect(yield* view("only-in-b").pipe(Effect.provide(a))).toEqual({ registered: false, materialized: false })
      expect(yield* view("only-in-b").pipe(Effect.provide(b))).toEqual({ registered: true, materialized: true })
      expect(yield* view("only-in-a").pipe(Effect.provide(b))).toEqual({ registered: false, materialized: false })

      const namesIn = (context: typeof a) =>
        McpConnection.Service.use((conn) => conn.connections()).pipe(
          Effect.provide(context),
          Effect.map((all) => all.map((info) => info.serverName)),
        )
      expect(yield* namesIn(a)).toEqual(["only-in-a"])
      expect(yield* namesIn(b)).toEqual(["only-in-b"])
    }),
  )

  /**
   * Location unload, on the production path and without touching production.
   *
   * An earlier pass concluded this was untestable because the only trigger is
   * `location-layer.ts:282`'s hardcoded `idleTimeToLive: "60 minutes"` — a real
   * clock cannot be waited out and a virtual one cannot coexist with a live
   * subprocess. That conclusion came from not reading `LayerMap`'s interface,
   * which carries an explicit `invalidate(key)` alongside the idle timer. The
   * TTL is only the automatic trigger; this is the same teardown reached
   * deliberately.
   */
  it.live("releases a Location's child process and tools when the LayerMap invalidates it", () =>
    Effect.gen(function* () {
      const root = path.join(os.tmpdir(), `aigcfroge-loc-unload-${randomUUID()}`)
      mkdirSync(root, { recursive: true })
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(root, { recursive: true, force: true })))

      const locations = yield* LocationServiceMap
      const ref = { directory: AbsolutePath.make(root) }
      // The borrow lives in its own scope: `LayerMap` reference-counts, so an
      // `invalidate` while this test still holds the layer only marks it — the
      // finalizers cannot run until the last borrower lets go. Measured, not
      // assumed: invalidating with the borrow open left the child alive.
      const borrow = yield* Scope.make()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void).pipe(Effect.ignore))
      yield* Effect.addFinalizer(() => Scope.close(borrow, Exit.void).pipe(Effect.ignore))
      const context = yield* Layer.buildWithScope(locations.get(ref), borrow)

      const info = yield* McpConnection.Service.use((conn) => conn.connect({ binding: bindingFor("unload-me") })).pipe(
        Effect.provide(context),
      )
      const pid = info.pid
      if (pid === undefined) throw new Error("stdio connection did not expose a pid")
      expect(yield* view("unload-me").pipe(Effect.provide(context))).toEqual({
        registered: true,
        materialized: true,
      })
      // Control: the child is running and unreaped before the unload, so the
      // assertions below cannot hold vacuously.
      expect(yield* reaped(pid)).toBe(false)

      yield* Scope.close(borrow, Exit.void)
      yield* locations.invalidate(ref)

      // The observable that cannot be faked: the external binary this Location
      // owned is gone and reaped, meaning the owner Scope ran its finalizers.
      yield* pollWithTimeout(
        reaped(pid).pipe(Effect.map((gone) => (gone ? true : undefined))),
        "the invalidated Location left its MCP child running",
      )
      // And nothing leaked into the Location's next incarnation: asking for the
      // same ref again yields a set with no connections of its own.
      const rebuilt = yield* Layer.buildWithScope(locations.get(ref), scope)
      expect(yield* McpConnection.Service.use((conn) => conn.connections()).pipe(Effect.provide(rebuilt))).toEqual([])
      expect(yield* view("unload-me").pipe(Effect.provide(rebuilt))).toEqual({
        registered: false,
        materialized: false,
      })
    }),
  )
})
