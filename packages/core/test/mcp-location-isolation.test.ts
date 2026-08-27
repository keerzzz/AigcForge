import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, Schema, Scope } from "effect"
import { mkdirSync, rmSync } from "node:fs"
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
import { testEffect } from "./lib/effect"

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
})
