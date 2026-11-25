import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Stream } from "effect"
import fs from "fs/promises"
import path from "path"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { Bus } from "@omnixa/core/bus"
import { ConfigInstructionPlugin } from "@omnixa/core/config/plugin/instruction"
import { Config } from "@omnixa/core/config"
import { Document, Info, Event } from "@omnixa/schema/config"
import { Watcher } from "@omnixa/core/filesystem/watcher"
import { InstructionDiscovery } from "@omnixa/core/instruction-discovery"
import { Location } from "@omnixa/core/location"
import { AbsolutePath } from "@omnixa/core/schema"
import { FSUtil } from "@omnixa/util/fs-util"
import { Global } from "@omnixa/util/global"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { httpClient } from "@omnixa/util/effect/app-node-platform"
import { tempGlobalLayer } from "./fixture/global"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { readInitial, readUpdate, state } from "./lib/instructions"
import { testEffect } from "./lib/effect"
import { host } from "./plugin/host"

const it = testEffect(Layer.empty)

const instructionLayer = (input: {
  config?: string
  home?: string
  locationServiceLayer: Layer.Layer<Location.Service>
  filesystemLayer?: Layer.Layer<FSUtil.Service>
  project?: boolean
  global?: boolean
  entries?: Document[]
}) => {
  const watcher = Watcher.testLayer
  const config = Config.testLayer(input.entries)
  return Layer.mergeAll(
    AppNodeBuilder.build(
      LayerNode.group([
        InstructionDiscovery.node,
        Bus.node,
        FSUtil.node,
        Global.node,
        Location.node,
        Watcher.node,
        Config.node,
        httpClient,
      ]),
      [
        InstructionDiscovery.node.replace(
          InstructionDiscovery.configured({ project: input.project, global: input.global }),
        ),
        Config.node.replace(config),
        Global.node.replace(
          input.config || input.home
            ? Global.layerWith({
                ...(input.config ? { config: input.config } : {}),
                ...(input.home ? { home: input.home } : {}),
              })
            : tempGlobalLayer,
        ),
        Location.node.replace(input.locationServiceLayer),
        Watcher.node.replace(watcher),
        ...(input.filesystemLayer ? [FSUtil.node.replace(input.filesystemLayer)] : []),
      ],
    ),
    watcher,
    config,
  )
}

const start = Effect.fnUntraced(function* () {
  const bus = yield* Bus.Service
  yield* ConfigInstructionPlugin.Plugin.effect(host({ event: { subscribe: () => bus.subscribe(Event.Updated) } }))
  return yield* InstructionDiscovery.Service
})

const file = (path: string, content: string) =>
  new InstructionDiscovery.File({ path: AbsolutePath.make(path), content })

function emitAndWait(update: Watcher.Update) {
  return Effect.gen(function* () {
    const watcher = yield* Watcher.Test
    const bus = yield* Bus.Service
    const updated = yield* Deferred.make<void>()
    const fiber = yield* bus.subscribe(InstructionDiscovery.Event.Updated).pipe(
      Stream.runForEach(() => Deferred.succeed(updated, undefined).pipe(Effect.asVoid)),
      Effect.forkScoped,
    )
    yield* Effect.yieldNow
    yield* watcher.emit(update)
    yield* Deferred.await(updated).pipe(Effect.timeout("2 seconds"))
    yield* Fiber.interrupt(fiber)
  })
}

describe("InstructionDiscovery", () => {
  it.effect("stores ordered values with last-write-wins precedence", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      yield* discovery.transform((editor) => {
        editor.add(file("/repo/AGENTS.md", "first"))
        editor.add(file("/repo/packages/AGENTS.md", "package"))
        editor.add(file("/repo/AGENTS.md", "last"))
        editor.update("/repo/packages/AGENTS.md", (current) => {
          current.content = "updated"
          current.path = AbsolutePath.make("/ignored")
        })
        editor.remove("/missing")
      })

      expect(yield* discovery.list()).toEqual([
        file("/repo/AGENTS.md", "last"),
        file("/repo/packages/AGENTS.md", "updated"),
      ])
    }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([InstructionDiscovery.node, Bus.node])))),
  )

  it.effect("preserves admitted values while the source is unavailable", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      yield* discovery.transform((editor) => editor.unavailable())
      expect(
        (yield* readUpdate(
          yield* discovery.load(),
          state({ "core/instructions": [{ path: "/repo/AGENTS.md", content: "old" }] }),
        )).changed,
      ).toBe(false)
    }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([InstructionDiscovery.node, Bus.node])))),
  )

  it.effect("renders granular instruction updates", () =>
    Effect.gen(function* () {
      const discovery = yield* InstructionDiscovery.Service
      yield* discovery.transform((editor) => {
        editor.add(file("/global/AGENTS.md", "global"))
        editor.add(
          file("/repo/AGENTS.md", ["old", ...Array.from({ length: 20 }, (_, index) => `keep ${index}`)].join("\n")),
        )
      })
      const initial = yield* readInitial(yield* discovery.load())

      yield* discovery.transform((editor) => {
        editor.update("/repo/AGENTS.md", (current) => {
          current.content = ["new", ...Array.from({ length: 20 }, (_, index) => `keep ${index}`)].join("\n")
        })
      })
      const modified = (yield* readUpdate(yield* discovery.load(), initial)).text
      expect(modified).toContain("The instructions from /repo/AGENTS.md changed. Here's the diff:")
      expect(modified).toContain("-old\n+new")
      expect(modified).not.toContain("global")

      const rewritten = state({
        "core/instructions": [{ path: "/repo/AGENTS.md", content: "old one\nold two\nold three\nold four" }],
      })
      yield* discovery.transform((editor) => {
        editor.remove("/global/AGENTS.md")
        editor.update("/repo/AGENTS.md", (current) => {
          current.content = "new"
        })
      })
      expect((yield* readUpdate(yield* discovery.load(), rewritten)).text).toBe(
        "The instructions changed:\nInstructions from: /repo/AGENTS.md\nnew",
      )

      yield* discovery.transform((editor) => {
        editor.add(file("/repo/packages/AGENTS.md", "package"))
      })
      const structural = (yield* readUpdate(yield* discovery.load(), initial)).text
      expect(structural).toContain("The instructions from /global/AGENTS.md no longer apply.")
      expect(structural).toContain("New instructions apply from:\nInstructions from: /repo/packages/AGENTS.md\npackage")
      expect(structural).not.toContain("Instructions from: /global/AGENTS.md\nglobal")
    }).pipe(Effect.provide(AppNodeBuilder.build(LayerNode.group([InstructionDiscovery.node, Bus.node])))),
  )
})

describe("ConfigInstructionPlugin.Plugin", () => {
  for (const source of ["symlink", "extglob"] as const) {
    it.live(`refreshes configured ${source} files when their real content changes`, () =>
      Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
        Effect.flatMap((tmp) => {
          const target = path.join(tmp.path, "shared", "a.md")
          const alias = path.join(tmp.path, "rules", "CLAUDE.md")
          return Effect.gen(function* () {
            yield* Effect.promise(async () => {
              await fs.mkdir(path.dirname(target))
              await fs.mkdir(path.dirname(alias))
              await fs.writeFile(target, "old protocol")
              if (source === "symlink") await fs.symlink(target, alias)
            })
            const discovery = yield* start()
            const initial = yield* readInitial(yield* discovery.load())
            expect(initial.text).toContain("old protocol")
            yield* Effect.promise(() => fs.writeFile(target, "new protocol"))
            yield* emitAndWait({ type: "update", path: target })
            expect((yield* readUpdate(yield* discovery.load(), initial)).text).toContain("new protocol")
          }).pipe(
            Effect.provide(
              instructionLayer({
                config: path.join(tmp.path, "global"),
                project: false,
                global: false,
                entries: [
                  Document.make({
                    type: "document",
                    info: Info.make({
                      instructions: [source === "symlink" ? "rules/CLAUDE.md" : "shared/@(a|b).md"],
                    }),
                  }),
                ],
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location({
                      directory: AbsolutePath.make(tmp.path),
                    }),
                  ),
                ),
              }),
            ),
          )
        }),
      ),
    )
  }

  it.live("follows configured directories as missing parents appear", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const generated = path.join(tmp.path, "generated")
          const rules = path.join(generated, "rules")
          const discovery = yield* start()
          const watcher = yield* Watcher.Test
          expect((yield* readInitial(yield* discovery.load())).text).toBe("")
          expect(yield* watcher.subscriptions()).toEqual([{ path: generated, type: "file" }])
          yield* Effect.promise(() => fs.mkdir(generated))
          yield* emitAndWait({ type: "create", path: generated })
          expect((yield* watcher.subscriptions()).at(-1)).toEqual({ path: rules, type: "file" })
          yield* Effect.promise(async () => {
            await fs.mkdir(rules)
            await fs.writeFile(path.join(rules, "testing.md"), "generated testing protocol")
          })
          yield* emitAndWait({ type: "create", path: rules })
          expect((yield* readInitial(yield* discovery.load())).text).toContain("generated testing protocol")
          expect((yield* watcher.subscriptions()).at(-1)).toEqual({ path: rules, type: "directory" })
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              project: false,
              global: false,
              entries: [
                Document.make({ type: "document", info: Info.make({ instructions: ["generated/rules/*.md"] }) }),
              ],
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
              ),
            }),
          ),
        ),
      ),
    ),
  )

  it.live("loads configured files, globs and URLs with implicit discovery disabled", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) => {
        const directory = path.join(tmp.path, "config")
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch: () => new Response("remote protocol"),
        })
        const entries = [
          Document.make({
            type: "document",
            path: AbsolutePath.make(path.join(directory, "omnixa.json")),
            info: Info.make({ instructions: ["CLAUDE.md", "rules/*.md", server.url.href] }),
          }),
        ]
        return Effect.gen(function* () {
          yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
          yield* Effect.promise(async () => {
            await fs.mkdir(path.join(directory, "rules"), { recursive: true })
            await fs.writeFile(path.join(directory, "CLAUDE.md"), "project protocol")
            await fs.writeFile(path.join(directory, "rules", "testing.md"), "testing protocol")
          })
          const discovery = yield* start()
          const initial = yield* readInitial(yield* discovery.load())
          expect(initial.text).toContain("project protocol")
          expect(initial.text).toContain("testing protocol")
          expect(initial.text).toContain(`Instructions from: ${server.url.href}\nremote protocol`)
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "CLAUDE.md"), "updated project protocol"))
          yield* emitAndWait({ type: "update", path: path.join(directory, "CLAUDE.md") })
          expect((yield* readUpdate(yield* discovery.load(), initial)).text).toContain("updated project protocol")
          yield* Effect.promise(() => fs.writeFile(path.join(directory, "rules", "api.md"), "API protocol"))
          yield* emitAndWait({ type: "create", path: path.join(directory, "rules", "api.md") })
          expect((yield* readUpdate(yield* discovery.load(), initial)).text).toContain("API protocol")
          const config = yield* Config.Test
          yield* config.setEntries([])
          const bus = yield* Bus.Service
          const changed = yield* bus
            .subscribe(InstructionDiscovery.Event.Updated)
            .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
          yield* bus.publish(Event.Updated, {})
          yield* Fiber.join(changed).pipe(Effect.timeout("2 seconds"))
          expect((yield* readUpdate(yield* discovery.load(), initial)).text).toBe(
            "Previously loaded instructions no longer apply.",
          )
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              project: false,
              global: false,
              entries,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location({
                    directory: AbsolutePath.make(tmp.path),
                  }),
                ),
              ),
            }),
          ),
        )
      }),
    ),
  )

  it.live("refetches configured URLs when config changes during an in-flight load", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const requested = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const calls = { count: 0 }
          const server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch: () => {
              calls.count++
              return calls.count === 1
                ? Effect.runPromise(
                    Deferred.succeed(requested, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                      Effect.as(new Response("old remote protocol")),
                    ),
                  )
                : new Response("updated remote protocol")
            },
          })
          yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
          const entries = [Document.make({ type: "document", info: Info.make({ instructions: [server.url.href] }) })]
          yield* Effect.gen(function* () {
            const bus = yield* Bus.Service
            const updated = yield* bus
              .subscribe(InstructionDiscovery.Event.Updated)
              .pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
            const loading = yield* start().pipe(Effect.forkScoped({ startImmediately: true }))
            yield* Deferred.await(requested).pipe(Effect.timeout("2 seconds"))
            yield* bus.publish(Event.Updated, {})
            yield* Effect.yieldNow
            yield* Deferred.succeed(release, undefined)
            const discovery = yield* Fiber.join(loading)
            yield* Fiber.join(updated).pipe(Effect.timeout("2 seconds"))
            expect(calls.count).toBe(2)
            expect((yield* readInitial(yield* discovery.load())).text).toContain("updated remote protocol")
          }).pipe(
            Effect.provide(
              instructionLayer({
                project: false,
                global: false,
                entries,
                config: path.join(tmp.path, "global"),
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location({
                      directory: AbsolutePath.make(tmp.path),
                    }),
                  ),
                ),
              }),
            ),
          )
        }),
      ),
    ),
  )

  it.live("loads global and upward project files and rescans them on change", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        const home = path.join(tmp.path, "home")
        const shared = path.join(home, "code")
        const project = path.join(shared, "repo")
        const directory = path.join(project, "packages", "core")
        const outside = path.join(tmp.path, "AGENTS.md")
        const globalFile = path.join(global, "AGENTS.md")
        const sharedFile = path.join(shared, "AGENTS.md")
        const projectFile = path.join(project, "AGENTS.md")
        const packageFile = path.join(directory, "AGENTS.md")
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            await fs.mkdir(global, { recursive: true })
            await fs.mkdir(directory, { recursive: true })
            await fs.writeFile(outside, "outside")
            await fs.writeFile(globalFile, "global")
            await fs.writeFile(sharedFile, "shared")
            await fs.writeFile(projectFile, "project")
            await fs.writeFile(packageFile, "package")
          })

          const discovery = yield* start()
          const watcher = yield* Watcher.Test
          expect(yield* watcher.subscriptions()).toEqual([
            { path: globalFile, type: "file" },
            { path: packageFile, type: "file" },
            { path: path.join(project, "packages", "AGENTS.md"), type: "file" },
            { path: projectFile, type: "file" },
            { path: sharedFile, type: "file" },
            { path: path.join(home, "AGENTS.md"), type: "file" },
          ])
          expect(yield* watcher.subscriptions()).not.toContainEqual({
            path: path.join(tmp.path, "AGENTS.md"),
            type: "file",
          })
          const initialized = yield* readInitial(yield* discovery.load())
          expect(initialized.text).toBe(
            [
              `Instructions from: ${globalFile}\nglobal`,
              `Instructions from: ${packageFile}\npackage`,
              `Instructions from: ${projectFile}\nproject`,
              `Instructions from: ${sharedFile}\nshared`,
            ].join("\n\n"),
          )
          expect(initialized.text).not.toContain("outside")

          yield* Effect.promise(() => fs.writeFile(packageFile, "changed"))
          yield* emitAndWait({ type: "update", path: packageFile })
          const changed = (yield* readUpdate(yield* discovery.load(), initialized)).text
          expect(changed).toContain(`The instructions changed:\nInstructions from: ${packageFile}\nchanged`)
          expect(changed).not.toContain(`Instructions from: ${globalFile}\nglobal`)

          yield* Effect.promise(() => fs.rm(packageFile))
          yield* emitAndWait({ type: "delete", path: packageFile })
          const removed = (yield* readUpdate(yield* discovery.load(), initialized)).text
          expect(removed).toContain(`The instructions from ${packageFile} no longer apply.`)
          expect(removed).not.toContain(`Instructions from: ${globalFile}\nglobal`)

          yield* Effect.promise(() => fs.rm(globalFile))
          yield* emitAndWait({ type: "delete", path: globalFile })
          yield* Effect.promise(() => fs.rm(projectFile))
          yield* emitAndWait({ type: "delete", path: projectFile })
          yield* Effect.promise(() => fs.rm(sharedFile))
          yield* emitAndWait({ type: "delete", path: sharedFile })
          expect((yield* readUpdate(yield* discovery.load(), initialized)).text).toBe(
            "Previously loaded instructions no longer apply.",
          )
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: global,
              home,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(directory) },
                    { projectDirectory: AbsolutePath.make(project) },
                  ),
                ),
              ),
            }),
          ),
        )
      }),
    ),
  )

  it.live("keeps an empty AGENTS.md as available context", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const file = path.join(tmp.path, "AGENTS.md")
          yield* Effect.promise(() => fs.writeFile(file, ""))
          const discovery = yield* start()
          expect((yield* readInitial(yield* discovery.load())).text).toBe(`Instructions from: ${file}\n`)
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
              ),
            }),
          ),
        ),
      ),
    ),
  )

  it.live("discovers a newly created instruction file above the project root", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const home = path.join(tmp.path, "home")
        const shared = path.join(home, "code")
        const project = path.join(shared, "repo")
        const intermediate = path.join(shared, "AGENTS.md")
        const directory = path.join(project, "core")
        const projectFile = path.join(project, "AGENTS.md")
        return Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* Effect.promise(() => fs.writeFile(projectFile, "project"))
          const discovery = yield* start()
          expect((yield* readInitial(yield* discovery.load())).text).toBe(`Instructions from: ${projectFile}\nproject`)

          yield* Effect.promise(() => fs.writeFile(intermediate, "intermediate"))
          yield* emitAndWait({ type: "create", path: intermediate })

          expect((yield* readInitial(yield* discovery.load())).text).toBe(
            [`Instructions from: ${projectFile}\nproject`, `Instructions from: ${intermediate}\nintermediate`].join(
              "\n\n",
            ),
          )
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              home,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(directory) },
                    { projectDirectory: AbsolutePath.make(project) },
                  ),
                ),
              ),
            }),
          ),
        )
      }),
    ),
  )

  it.live("stops instruction candidates at the project root outside home", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const global = path.join(tmp.path, "global")
        const home = path.join(tmp.path, "home")
        const project = path.join(tmp.path, "scratch", "repo")
        const directory = path.join(project, "packages", "core")
        return Effect.gen(function* () {
          yield* Effect.promise(() => fs.mkdir(directory, { recursive: true }))
          yield* start()
          const watcher = yield* Watcher.Test
          expect(yield* watcher.subscriptions()).toEqual([
            { path: path.join(global, "AGENTS.md"), type: "file" },
            { path: path.join(directory, "AGENTS.md"), type: "file" },
            { path: path.join(project, "packages", "AGENTS.md"), type: "file" },
            { path: path.join(project, "AGENTS.md"), type: "file" },
          ])
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: global,
              home,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(
                  location(
                    { directory: AbsolutePath.make(directory) },
                    { projectDirectory: AbsolutePath.make(project) },
                  ),
                ),
              ),
            }),
          ),
        )
      }),
    ),
  )

  // A client CWD can spell the drive `c:` while git reports the project root as `C:`.
  ;(process.platform === "win32" ? it.live : it.live.skip)(
    "stops at the project root when the location drive letter differs in case",
    () =>
      Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ).pipe(
        Effect.flatMap((tmp) => {
          const global = path.join(tmp.path, "global")
          const home = path.join(tmp.path, "home")
          const project = path.join(tmp.path, "repo")
          const directory = project[0].toLowerCase() + project.slice(1)
          return Effect.gen(function* () {
            yield* Effect.promise(() => fs.mkdir(project, { recursive: true }))
            yield* Effect.promise(() => fs.writeFile(path.join(project, "AGENTS.md"), "project"))
            yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "AGENTS.md"), "outside"))
            const discovery = yield* start()
            const watcher = yield* Watcher.Test
            expect(yield* watcher.subscriptions()).toEqual([
              { path: path.join(global, "AGENTS.md"), type: "file" },
              { path: path.join(directory, "AGENTS.md"), type: "file" },
            ])
            expect((yield* readInitial(yield* discovery.load())).text).toBe(
              `Instructions from: ${path.join(directory, "AGENTS.md")}\nproject`,
            )
          }).pipe(
            Effect.provide(
              instructionLayer({
                config: global,
                home,
                locationServiceLayer: Layer.succeed(
                  Location.Service,
                  Location.Service.of(
                    location(
                      { directory: AbsolutePath.make(directory) },
                      { projectDirectory: AbsolutePath.make(project) },
                    ),
                  ),
                ),
              }),
            ),
          )
        }),
      ),
  )

  it.effect("isolates source failure without failing activation", () => {
    const failingFS = Layer.effect(
      FSUtil.Service,
      FSUtil.Service.pipe(
        Effect.map((fs) =>
          FSUtil.Service.of({ ...fs, up: () => Effect.fail(new FSUtil.FileSystemError({ method: "up" })) }),
        ),
      ),
    ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
    return Effect.gen(function* () {
      const discovery = yield* start()
      expect(
        (yield* readUpdate(
          yield* discovery.load(),
          state({ "core/instructions": [{ path: "/repo/AGENTS.md", content: "old" }] }),
        )).changed,
      ).toBe(false)
    }).pipe(
      Effect.provide(
        instructionLayer({
          filesystemLayer: failingFS,
          locationServiceLayer: Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
          ),
        }),
      ),
    )
  })

  it.effect("marks a discovered file that disappears before read as unavailable", () => {
    const discovered = AbsolutePath.make("/repo/AGENTS.md")
    const racingFS = Layer.effect(
      FSUtil.Service,
      FSUtil.Service.pipe(
        Effect.map((fs) =>
          FSUtil.Service.of({
            ...fs,
            up: () => Effect.succeed([discovered]),
            readFileStringSafe: () => Effect.undefined,
          }),
        ),
      ),
    ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
    return Effect.gen(function* () {
      const discovery = yield* start()
      expect(
        (yield* readUpdate(
          yield* discovery.load(),
          state({ "core/instructions": [{ path: discovered, content: "old" }] }),
        )).changed,
      ).toBe(false)
    }).pipe(
      Effect.provide(
        instructionLayer({
          filesystemLayer: racingFS,
          locationServiceLayer: Layer.succeed(
            Location.Service,
            Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
          ),
        }),
      ),
    )
  })

  it.effect("preserves the global baseline when an existing global file cannot be read", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) => {
        const globalFile = AbsolutePath.make(path.join(tmp.path, "global", "AGENTS.md"))
        const unreadableFS = Layer.effect(
          FSUtil.Service,
          FSUtil.Service.pipe(
            Effect.map((fs) =>
              FSUtil.Service.of({
                ...fs,
                isFile: (file) => Effect.succeed(file === globalFile),
                readFileStringSafe: () => Effect.undefined,
              }),
            ),
          ),
        ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))
        return Effect.gen(function* () {
          const discovery = yield* start()
          expect((yield* readInitial(yield* discovery.load()).pipe(Effect.flip))._tag).toBe(
            "Instructions.InitializationBlocked",
          )
          expect(
            (yield* readUpdate(
              yield* discovery.load(),
              state({ "core/instructions": [{ path: globalFile, content: "global rules" }] }),
            )).changed,
          ).toBe(false)
        }).pipe(
          Effect.provide(
            instructionLayer({
              config: path.join(tmp.path, "global"),
              project: false,
              filesystemLayer: unreadableFS,
              locationServiceLayer: Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(tmp.path) })),
              ),
            }),
          ),
        )
      }),
    ),
  )

  it.effect("canonicalizes boundaries and honors project opt-out", () =>
    Effect.gen(function* () {
      const observed: { values: FSUtil.UpOptions[] } = { values: [] }
      const observingFS = Layer.effect(
        FSUtil.Service,
        FSUtil.Service.pipe(
          Effect.map((fs) =>
            FSUtil.Service.of({
              ...fs,
              up: (options) => Effect.sync(() => (observed.values.push(options), [])),
            }),
          ),
        ),
      ).pipe(Layer.provide(LayerNode.compile(FSUtil.node)))

      yield* start().pipe(
        Effect.provide(
          instructionLayer({
            filesystemLayer: observingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location({ directory: AbsolutePath.make("/repo/") }, { projectDirectory: AbsolutePath.make("/repo") }),
              ),
            ),
          }),
        ),
      )
      yield* start().pipe(
        Effect.provide(
          instructionLayer({
            filesystemLayer: observingFS,
            project: false,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(location({ directory: AbsolutePath.make("/repo") })),
            ),
          }),
        ),
      )
      yield* start().pipe(
        Effect.provide(
          instructionLayer({
            filesystemLayer: observingFS,
            locationServiceLayer: Layer.succeed(
              Location.Service,
              Location.Service.of(
                location(
                  { directory: AbsolutePath.make("/outside") },
                  { projectDirectory: AbsolutePath.make("/repo") },
                ),
              ),
            ),
          }),
        ),
      )

      const repo = path.resolve("/repo")
      expect(observed.values).toEqual([{ targets: ["AGENTS.md"], start: repo, stop: repo, type: "file" }])
    }),
  )
})
