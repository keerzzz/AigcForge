import { describe, expect, setDefaultTimeout } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Deferred, Duration, Effect, Fiber, Layer, LayerMap, Schedule } from "effect"
import { TestClock } from "effect/testing"
import { define } from "@aigcfroge/plugin/effect/plugin"
import { Event } from "@aigcfroge/schema/config"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Global } from "@aigcfroge/util/global"
import { Npm } from "@aigcfroge/util/npm"
import { Bus } from "@aigcfroge/core/bus"
import { Command } from "@aigcfroge/core/command"
import { Database } from "@aigcfroge/core/database/database"
import { Watcher } from "@aigcfroge/core/filesystem/watcher"
import { ManagedPolicy } from "@aigcfroge/core/managed-policy"
import { Instance } from "@aigcfroge/core/instance"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { Location } from "@aigcfroge/core/location"
import { Plugin } from "@aigcfroge/core/plugin"
import { Rpc } from "@aigcfroge/core/rpc"
import { SdkPlugins } from "@aigcfroge/core/plugin/sdk"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { tempGlobalLayer } from "../fixture/global"
import { offlineModels } from "../fixture/models"
import { tmpdirScoped } from "../fixture/tmpdir"
import { advance } from "../lib/clock"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"

// Real Location boot with plugin-directory discovery, so local plugin files are loaded and reloaded.
setDefaultTimeout(15_000)

// Package resolution can be held open so overlapping activations become observable.
const npm = {
  directory: "",
  gate: undefined as Deferred.Deferred<void> | undefined,
  inflight: 0,
  peak: 0,
}

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: npm.directory, name }),
    resolve: (name) =>
      Effect.gen(function* () {
        npm.inflight++
        npm.peak = Math.max(npm.peak, npm.inflight)
        if (npm.gate) yield* Deferred.await(npm.gate)
        npm.inflight--
        return { directory: npm.directory, name }
      }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: npm.directory, name }),
    which: () => Effect.undefined,
  }),
)

const instances = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    const managed = yield* ManagedPolicy.Service
    const map = yield* LayerMap.make((ref: Location.Ref) => Instance.layer(ref, { replacements: bindings }), {
      idleTimeToLive: Duration.infinity,
    })
    const bindings: LayerNode.Replacements = [
      Global.node.replace(tempGlobalLayer),
      ManagedPolicy.node.replace(Layer.succeed(ManagedPolicy.Service, managed)),
      offlineModels,
      Npm.node.replace(npmLayer),
      Watcher.node.replace(Layer.succeed(Watcher.Service, watcher)),
      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, map)),
      Instance.node.replace(
        Layer.succeed(Instance.Service, {
          provide: (session) => Effect.provide(map.get(session.location)),
        }),
      ),
    ]
    return map
  }),
).pipe(Layer.provide(Watcher.testLayer), Layer.provide(ManagedPolicy.layer))

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([ManagedPolicy.node, Database.node, Bus.node, SdkPlugins.node, LocationServiceMap.node]),
    [Global.node.replace(tempGlobalLayer), offlineModels, LocationServiceMap.node.replace(instances)],
  ).pipe(Layer.provideMerge(Watcher.testLayer)),
)

const greeter = (command: string) => `export default {
  id: "greeter",
  async setup(ctx) {
    await ctx.command.transform((editor) => editor.add({ name: "${command}", execute: async () => {} }))
  },
}`

// Real-time polling: reloads do filesystem work that the TestClock cannot advance.
const settle = (predicate: () => boolean, attempts = 200): Effect.Effect<void, string> =>
  Effect.suspend(() => {
    if (predicate()) return Effect.void
    if (attempts === 0) return Effect.fail("not settled")
    return Effect.promise(() => Bun.sleep(10)).pipe(Effect.andThen(settle(predicate, attempts - 1)))
  })

const failed = (plugins: Plugin.Interface) =>
  plugins.list().pipe(
    Effect.flatMap((inventory) => {
      const failure = inventory.find((plugin) => plugin.state.status === "failed" && plugin.source.type === "local")
      return failure ? Effect.succeed(failure) : Effect.fail("activation pending")
    }),
    Effect.retry({ times: 200, schedule: Schedule.spaced("25 millis") }),
  )

describe("PluginSupervisor reload", () => {
  ;(
    [
      { name: "on a helper-only save", helper: "nested/helper.ts", touchEntry: false },
      { name: "when the entrypoint also changes", helper: "nested/helper.ts", touchEntry: true },
      { name: "outside the configured plugin directory", helper: "../shared/helper.ts", touchEntry: false },
    ] as const
  ).forEach((scenario) => {
    it.live(`reloads helper-defined RPC methods ${scenario.name}`, () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const root = path.join(directory.path, "external/greeter")
        const file = path.join(root, "index.ts")
        const helper = path.join(root, scenario.helper)
        const entry = `export { default } from ${JSON.stringify("./" + scenario.helper)}`
        const source = (version: number) => `import { Schema } from ${JSON.stringify(import.meta.resolve("effect"))}
          export default {
            id: "greeter",
            async setup(ctx) {
              await ctx.rpc.register({ id: "greeter", methods: {
                status: { input: Schema.Unknown, output: Schema.Number },
                ${version > 1 ? "info: { input: Schema.Unknown, output: Schema.Number }," : ""}
              }, events: {} }, {
                status: async () => ${version},
                ${version > 1 ? `info: async () => ${version},` : ""}
              })
              await ctx.command.transform(editor => editor.add({ name: "greet-v${version}", execute: async () => {} }))
            }
          }`
        yield* Effect.promise(async () => {
          await Bun.write(file, entry)
          await Bun.write(helper, source(1))
          await Bun.write(path.join(directory.path, ".aigcfroge/aigcfroge.json"), JSON.stringify({ plugins: [root] }))
        })
        const watcher = yield* Watcher.Test
        const locations = yield* LocationServiceMap.Service
        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const rpc = yield* Rpc.Service
          const commands = yield* Command.Service
          yield* plugins.awaitActivation
          expect(yield* rpc.call("greeter", "status", {})).toBe(1)
          expect(yield* rpc.call("greeter", "info", {}).pipe(Effect.flip)).toMatchObject({
            type: "rpc.method_not_found",
          })

          yield* Effect.promise(async () => {
            await Bun.write(helper, source(2))
            if (scenario.touchEntry) {
              await Bun.write(file, entry + "; // updated entry")
              await fs.utimes(file, new Date(), new Date(Date.now() + 1000))
            }
          })
          yield* watcher.emit({ path: scenario.touchEntry ? file : helper, type: "update" })
          yield* rpc
            .call("greeter", "info", {})
            .pipe(Effect.retry({ times: 80, schedule: Schedule.spaced("25 millis") }))
          expect(yield* rpc.call("greeter", "info", {})).toBe(2)
          expect(yield* commands.get("greet-v1")).toBeUndefined()
          expect(yield* commands.get("greet-v2")).toBeDefined()

          // Failed helper evaluations retain the active registration and recover on the next save.
          yield* Effect.promise(() => Bun.write(helper, 'throw new Error("broken helper"); export default {}'))
          yield* watcher.emit({ path: helper, type: "update" })
          yield* failed(plugins)
          expect(yield* rpc.call("greeter", "info", {})).toBe(2)
          yield* Effect.promise(() => Bun.write(helper, source(3)))
          yield* watcher.emit({ path: helper, type: "update" })
          yield* commands.get("greet-v3").pipe(
            Effect.flatMap((command) => (command ? Effect.void : Effect.fail("activation pending"))),
            Effect.retry({ times: 80, schedule: Schedule.spaced("25 millis") }),
          )
          expect(yield* rpc.call("greeter", "info", {})).toBe(3)
          expect(yield* commands.get("greet-v2")).toBeUndefined()
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        )
      }),
    )
  })
  ;(["discovered", "configured"] as const).forEach((mode) => {
    it.effect(`retains a ${mode} plugin change during initial activation`, () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const file = path.join(
          directory.path,
          mode === "discovered" ? ".aigcfroge/plugins/greeter.ts" : "external/greeter/index.ts",
        )
        yield* Effect.promise(async () => {
          await Bun.write(file, greeter("greet-v1"))
          await fs.utimes(file, new Date(0), new Date(0))
          if (mode === "configured") {
            await Bun.write(
              path.join(directory.path, ".aigcfroge/aigcfroge.json"),
              JSON.stringify({ plugins: [path.dirname(file)] }),
            )
          }
        })
        const entered = yield* Deferred.make<void>()
        const gate = yield* Deferred.make<void>()
        const sdk = yield* SdkPlugins.Service
        yield* sdk.register(
          define({
            id: "gated",
            effect: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate))),
          }),
        )
        const watcher = yield* Watcher.Test
        const locations = yield* LocationServiceMap.Service
        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          const commands = yield* Command.Service
          yield* Deferred.await(entered)
          // The real ConfigPluginSource merges config-root changes and configured-path watches.
          // Emit while setup is blocked, without a bus event that could mask a lost source trigger.
          yield* Effect.promise(async () => {
            await Bun.write(file, greeter("greet-v2"))
            await fs.utimes(file, new Date(), new Date())
          })
          yield* watcher.emit({ path: file, type: "update" })
          const ready = yield* plugins.awaitActivation.pipe(Effect.forkScoped({ startImmediately: true }))
          yield* Deferred.succeed(gate, undefined)
          yield* advance(() => ready.pollUnsafe() !== undefined)
          yield* Fiber.join(ready)

          expect(yield* commands.get("greet-v1")).toBeUndefined()
          expect(yield* commands.get("greet-v2")).toBeDefined()
        }).pipe(
          Effect.scoped,
          Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
        )
      }),
    )
  })

  it.live("adding and deleting a declaration refreshes an existing plugin with a missing optional dependency", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const file = path.join(directory.path, ".aigcfroge/plugins/directory-refresh.ts")
      const declaration = path.join(path.dirname(file), "review.plugin.yaml")
      // Observations must not change the source directory fingerprint or trigger config watches themselves.
      const markers = {
        evaluation: path.join(directory.path, "observations/evaluation.log"),
        setup: path.join(directory.path, "observations/setup.log"),
        cleanup: path.join(directory.path, "observations/cleanup.log"),
      }
      const source = `import { appendFileSync, readFileSync } from "node:fs"
        const optional = await import("./not-installed").then(() => "present", () => "fallback")
        appendFileSync(${JSON.stringify(markers.evaluation)}, "evaluate\\n")
        const generation = readFileSync(${JSON.stringify(markers.evaluation)}, "utf8").split("\\n").length - 1
        export default {
          id: "directory-refresh",
          async setup(ctx) {
            appendFileSync(${JSON.stringify(markers.setup)}, "setup\\n")
            await ctx.command.transform((editor) => editor.add({
              name: "directory-refresh-generation",
              description: optional + ":" + generation,
              execute: async () => {},
            }))
            return () => appendFileSync(${JSON.stringify(markers.cleanup)}, "cleanup\\n")
          },
        }`

      yield* Effect.promise(async () => {
        await Promise.all(Object.values(markers).map((marker) => Bun.write(marker, "")))
        await Bun.write(file, source)
      })

      const watcher = yield* Watcher.Test
      const locations = yield* LocationServiceMap.Service

      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        // Finish plugin cleanup while its observation files still exist.
        yield* Effect.addFinalizer(plugins.close)

        const expectGeneration = Effect.fnUntraced(function* (generation: number) {
          // emit only queues notifications; wait for the actual new registration before awaiting readiness.
          yield* pollWithTimeout(
            commands
              .get("directory-refresh-generation")
              .pipe(Effect.map((command) => (command?.description === `fallback:${generation}` ? command : undefined))),
            `Plugin generation ${generation} was not registered`,
          )
          yield* awaitWithTimeout(plugins.awaitActivation, `Plugin generation ${generation} did not settle`)

          expect(
            yield* Effect.promise(() =>
              Promise.all(
                [markers.evaluation, markers.setup, markers.cleanup].map((marker) => Bun.file(marker).text()),
              ),
            ),
          ).toEqual(["evaluate\n".repeat(generation), "setup\n".repeat(generation), "cleanup\n".repeat(generation - 1)])
          expect((yield* plugins.list()).filter((plugin) => plugin.source.type === "local")).toEqual([
            {
              id: Plugin.ID.make("directory-refresh"),
              source: { type: "local", path: file },
              state: { status: "active" },
              features: { server: true },
            },
          ])
        })

        yield* expectGeneration(1)
        expect(yield* watcher.subscriptions()).toContainEqual({ path: path.dirname(file), type: "directory" })

        yield* Effect.promise(() =>
          Bun.write(declaration, "kind: plugin\nname: review\ndescription: Saved declaration\nversion: 1.0.0\n"),
        )
        yield* watcher.emit({ path: declaration, type: "create" })
        yield* expectGeneration(2)

        yield* Effect.promise(() => fs.rm(declaration))
        yield* watcher.emit({ path: declaration, type: "delete" })
        yield* expectGeneration(3)
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(source)
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
    }),
  )

  it.live("keeps the running generation when an updated local plugin fails to import", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      const file = path.join(directory.path, ".aigcfroge/plugins/greeter.ts")
      // Local plugin revisions key on mtime, so give each rewrite a distinct timestamp.
      const write = (content: string, mtime: Date) =>
        Effect.promise(async () => {
          await Bun.write(file, content)
          await fs.utimes(file, mtime, mtime)
        })
      yield* write(greeter("greet-v1"), new Date(Date.now() - 60_000))
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        yield* plugins.awaitActivation
        expect(yield* commands.get("greet-v1")).toBeDefined()

        yield* write("export default {", new Date())
        yield* bus.publish(Event.Updated, {})
        const failure = yield* failed(plugins)

        expect(failure).toMatchObject({ source: { type: "local", path: file }, state: { status: "failed" } })
        // The broken revision never produced a generation, so the previous one keeps running.
        expect(yield* commands.get("greet-v1")).toBeDefined()
        expect(yield* plugins.list()).toContainEqual(
          expect.objectContaining({
            id: "greeter",
            source: { type: "local", path: file },
            state: { status: "active" },
          }),
        )
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
    }),
  )

  it.effect("serializes the periodic refresh behind an in-flight reload", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped()
      npm.directory = path.join(directory.path, "fixture-pkg")
      npm.gate = undefined
      npm.peak = 0
      yield* Effect.promise(() =>
        Bun.write(
          path.join(npm.directory, "package.json"),
          JSON.stringify({ name: "fixture-pkg", exports: { "./server": "./server.ts" } }),
        ),
      )
      yield* Effect.promise(() => Bun.write(path.join(npm.directory, "server.ts"), greeter("greet-pkg")))
      yield* Effect.promise(() =>
        Bun.write(path.join(directory.path, ".aigcfroge/aigcfroge.json"), JSON.stringify({ plugins: ["fixture-pkg"] })),
      )
      const bus = yield* Bus.Service
      const locations = yield* LocationServiceMap.Service
      yield* Effect.gen(function* () {
        const plugins = yield* Plugin.Service
        const commands = yield* Command.Service
        yield* TestClock.adjust("100 millis")
        yield* plugins.awaitActivation
        expect(yield* commands.get("greet-pkg")).toBeDefined()
        expect(npm.peak).toBe(1)

        // Hold the next resolve open, then let the 24 hour refresh fire while it is blocked.
        const gate = yield* Deferred.make<void>()
        npm.gate = gate
        npm.inflight = 0
        npm.peak = 0
        yield* bus.publish(Event.Updated, {})
        yield* TestClock.adjust("100 millis")
        yield* settle(() => npm.inflight === 1)
        yield* TestClock.adjust("24 hours")
        // Without serialization the refresh resolves concurrently with the held reload and the peak reaches 2.
        yield* settle(() => npm.peak > 1, 50).pipe(Effect.ignore)
        const peak = npm.peak
        yield* Deferred.succeed(gate, undefined)
        npm.gate = undefined
        yield* TestClock.adjust("100 millis")
        yield* plugins.awaitActivation

        expect(peak).toBe(1)
      }).pipe(
        Effect.scoped,
        Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
      )
    }),
  )
})

it.live("applies organization integration changes to running external plugins", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const root = path.join(directory.path, "external/policy-fixture")
    const entered = path.join(directory.path, "entered")
    const configuration = path.join(directory.path, ".aigcfroge/aigcfroge.json")
    yield* Effect.promise(async () => {
      await Bun.write(
        path.join(root, "index.ts"),
        `await Bun.write(${JSON.stringify(entered)}, "loaded"); ${greeter("policy-greet")}`,
      )
      await Bun.write(
        configuration,
        JSON.stringify({
          plugins: [root],
          experimental: { policies: [{ action: "integration.use", resource: "plugin:*", effect: "deny" }] },
        }),
      )
    })
    const locations = yield* LocationServiceMap.Service
    yield* Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const commands = yield* Command.Service
      const managed = yield* ManagedPolicy.Service
      const bus = yield* Bus.Service
      yield* plugins.awaitActivation
      expect(yield* commands.get("policy-greet")).toBeUndefined()
      expect(yield* Effect.promise(() => Bun.file(entered).exists())).toBe(false)
      yield* Effect.promise(() => Bun.write(configuration, JSON.stringify({ plugins: [root] })))
      yield* bus.publish(Event.Updated, {})
      yield* commands.get("policy-greet").pipe(
        Effect.flatMap((command) => (command ? Effect.void : Effect.fail("pending"))),
        Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
      )
      expect(yield* Effect.promise(() => Bun.file(entered).exists())).toBe(true)
      yield* managed.set({ statements: [{ action: "integration.use", resource: `plugin:${root}`, effect: "deny" }] })
      yield* commands.get("policy-greet").pipe(
        Effect.flatMap((command) => (command ? Effect.fail("pending") : Effect.void)),
        Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
      )
      yield* plugins.awaitActivation
      expect((yield* plugins.list()).some((plugin) => plugin.id === "greeter")).toBe(false)
      yield* managed.set({ statements: [] })
      yield* commands.get("policy-greet").pipe(
        Effect.flatMap((command) => (command ? Effect.void : Effect.fail("pending"))),
        Effect.retry({ times: 200, schedule: Schedule.spaced("10 millis") }),
      )
    }).pipe(
      Effect.scoped,
      Effect.provide(locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory.path) }))),
    )
  }),
)
