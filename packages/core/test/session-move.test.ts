import type { FileSystem } from "@aigcfroge/core/filesystem"
import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import path from "path"
import { chmod, mkdir, readdir, rm } from "fs/promises"
import { Cause, Context, Deferred, Duration, Effect, Exit, Fiber, Layer, LayerMap, Queue, Scope } from "effect"
import { Worktree } from "@aigcfroge/schema/worktree"
import { Workspace } from "@aigcfroge/schema/workspace"
import { Bus } from "@aigcfroge/core/bus"
import { Config } from "@aigcfroge/core/config"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { Instance } from "@aigcfroge/core/instance"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-service-map"
import type { LocationServices } from "@aigcfroge/core/location-services"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionEvent } from "@aigcfroge/core/session/event"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionMessage } from "@aigcfroge/core/session/message"
import { SessionMove } from "@aigcfroge/core/session/move"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionRunner } from "@aigcfroge/core/session/runner/index"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { makeGlobalNode } from "@aigcfroge/util/effect/app-node"
import { Global } from "@aigcfroge/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { createLegacySession, offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { withCustomMode } from "./lib/product-mode"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionStore.node, Session.node]),
    [Project.node.replace(globalProjectNode), SessionExecution.node.replace(SessionExecution.noopLayer), offlineModels],
  ),
)
const itWithActiveExecution = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      Project.node,
      SessionProjector.node,
      SessionStore.node,
      SessionExecution.node,
      Session.node,
    ]),
    [
      Project.node.replace(globalProjectNode),
      LocationServiceMap.node.replace(
        Layer.effect(
          LocationServiceMap.Service,
          LayerMap.make(
            (ref: Location.Ref) =>
              Layer.merge(
                LayerNode.compile(Location.boundNode(ref), {
                  replacements: [Project.node.replace(globalProjectNode), offlineModels],
                }),
                Layer.succeed(SessionRunner.Service, { drain: () => Effect.never }),
              ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
          ),
        ),
      ),
    ],
  ),
)
const unavailableLocations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      Layer.effectDiscard(Effect.die(new Error("broken location"))) as unknown as Layer.Layer<
        LocationServices,
        FileSystem.DirectoryNotFoundError
      >,
  ),
)
const itWithUnavailableDestination = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      LocationServiceMap.node.replace(unavailableLocations),
    ],
  ),
)
const itWithExecution = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, SessionExecution.node, Project.node, Bus.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
  ]),
)
// Windows does not enforce POSIX mode bits, and root can traverse mode-000 directories.
const itWithPermissions =
  process.platform === "win32" || process.getuid?.() === 0 ? itWithExecution.live.skip : itWithExecution.live
const itWithInstance = testEffect(Layer.empty)
const sourceProbe = (options: { execution?: boolean } = {}) =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const source = AbsolutePath.make(path.join(tmp.path, "source"))
    const destination = AbsolutePath.make(tmp.path)
    yield* Effect.promise(() => mkdir(source))
    const probes = yield* Queue.unbounded<Deferred.Deferred<void>>()
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([Session.node, Bus.node, SessionExecution.node, Database.node]), [
        Global.node.replace(tempGlobalLayer),
        ...(options.execution ? [] : [SessionExecution.node.replace(SessionExecution.noopLayer)]),
        offlineModels,
        Instance.node.replace(
          makeGlobalNode({
            service: Instance.Service,
            deps: [LocationServiceMap.node],
            layer: Layer.effect(
              Instance.Service,
              Effect.gen(function* () {
                const locations = yield* LocationServiceMap.Service
                return Instance.Service.of({
                  provide: (session) => (effect) =>
                    Effect.gen(function* () {
                      if (session.location.directory === source) {
                        const release = yield* Deferred.make<void>()
                        yield* Queue.offer(probes, release)
                        yield* Deferred.await(release)
                      }
                      return yield* effect.pipe(Effect.provide(locations.get(session.location)))
                    }),
                })
              }),
            ),
          }),
        ),
      ]),
    )
    return {
      source,
      destination,
      probes,
      session: Context.get(context, Session.Service),
      bus: Context.get(context, Bus.Service),
      database: Context.get(context, Database.Service),
      execution: Context.get(context, SessionExecution.Service),
    }
  })

describe("Session.move", () => {
  for (const unavailable of [false, true]) {
    for (const boundary of ["entry", "probe"] as const) {
      itWithInstance.live(
        `rejects Custom movement at ${boundary} without residue from ${unavailable ? "unavailable" : "healthy"} sources`,
        () =>
          withCustomMode(
            boundary === "entry" ? undefined : "true",
            Effect.gen(function* () {
              const fixture = yield* sourceProbe()
              const created = yield* fixture.session.create({
                location: Location.Ref.make({ directory: fixture.source }),
              })
              yield* fixture.session.synthetic({ sessionID: created.id, text: "Keep pending", resume: false })
              yield* fixture.bus.publish(SessionEvent.InboxEnqueued, {
                sessionID: created.id,
                inboxID: SessionMessage.ID.create(),
                item: {
                  type: "move",
                  delivery: "queue",
                  payload: {
                    location: Location.Ref.make({ directory: fixture.destination }),
                    projectID: created.projectID,
                  },
                },
              })
              // Reopening a recorded Custom Session must hit the guard before needing its frozen dependency.
              yield* fixture.database.db
                .update(SessionTable)
                .set({ mode: "custom" })
                .where(eq(SessionTable.id, created.id))
                .run()
                .pipe(Effect.orDie)
              const recorded = yield* fixture.session.get(created.id)
              const row = yield* fixture.database.db
                .select()
                .from(SessionTable)
                .where(eq(SessionTable.id, created.id))
                .get()
              const pending = yield* fixture.session.inbox(created.id)
              const published = new Array<string>()
              const unsubscribe = yield* fixture.bus.listen((event) =>
                Effect.sync(() => {
                  if (event.durable?.aggregateID === created.id) published.push(event.type)
                }),
              )
              yield* Effect.addFinalizer(() => unsubscribe)

              const rejection = yield* Effect.gen(function* () {
                const move = fixture.session.move({ sessionID: created.id, directory: fixture.destination })
                if (boundary === "entry") {
                  if (unavailable) yield* Effect.promise(() => rm(fixture.source, { recursive: true }))
                  return yield* move.pipe(Effect.flip)
                }
                const moving = yield* move.pipe(Effect.flip, Effect.forkIn(yield* Scope.Scope))
                const release = yield* Queue.take(fixture.probes)
                yield* Effect.addFinalizer(() => Deferred.interrupt(release))
                return yield* withCustomMode(
                  undefined,
                  Effect.gen(function* () {
                    if (unavailable) yield* Deferred.die(release, new Error("source unavailable"))
                    if (!unavailable) yield* Deferred.succeed(release, undefined)
                    return yield* Fiber.join(moving)
                  }),
                )
              })

              expect(rejection).toEqual(
                new ProductModePolicy.UnsupportedProductModeError({
                  mode: "custom",
                  message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
                }),
              )
              expect(yield* fixture.session.get(created.id)).toEqual(recorded)
              expect(
                yield* fixture.database.db.select().from(SessionTable).where(eq(SessionTable.id, created.id)).get(),
              ).toEqual(row)
              expect(yield* fixture.session.inbox(created.id)).toEqual(pending)
              expect(pending).toMatchObject([{ type: "synthetic" }, { type: "move" }])
              expect(published).toEqual([])
              expect(yield* Queue.size(fixture.probes)).toBe(0)
            }).pipe(Effect.timeout("10 seconds")),
          ),
      )
    }
  }

  for (const missing of [false, true]) {
    itWithInstance.live(
      `moves Work Sessions with Custom disabled from ${missing ? "missing" : "healthy"} sources`,
      () =>
        withCustomMode(
          undefined,
          Effect.gen(function* () {
            const fixture = yield* sourceProbe()
            const created = yield* fixture.session.create({
              location: Location.Ref.make({ directory: fixture.source }),
              mode: "work",
            })
            const pending = yield* fixture.session.synthetic({
              sessionID: created.id,
              text: "Keep pending",
              resume: false,
            })
            const published = new Array<string>()
            const unsubscribe = yield* fixture.bus.listen((event) =>
              Effect.sync(() => {
                if (event.durable?.aggregateID === created.id) published.push(event.type)
              }),
            )
            yield* Effect.addFinalizer(() => unsubscribe)
            yield* Effect.gen(function* () {
              const move = fixture.session.move({
                sessionID: created.id,
                directory: fixture.destination,
                delivery: "queue",
              })
              if (missing) {
                yield* Effect.promise(() => rm(fixture.source, { recursive: true }))
                return yield* move
              }
              const moving = yield* move.pipe(Effect.forkIn(yield* Scope.Scope))
              const release = yield* Queue.take(fixture.probes)
              yield* Effect.addFinalizer(() => Deferred.interrupt(release))
              yield* Deferred.succeed(release, undefined)
              yield* Fiber.join(moving)
            })

            expect((yield* fixture.session.get(created.id)).location.directory).toBe(
              missing ? fixture.destination : fixture.source,
            )
            expect((yield* fixture.session.get(created.id)).mode).toBe("work")
            const inbox = yield* fixture.session.inbox(created.id)
            expect(inbox[0]).toEqual(pending)
            if (missing) expect(inbox).toEqual([pending])
            if (!missing) expect(inbox.slice(1)).toMatchObject([{ type: "move", delivery: "queue" }])
            expect(published).toEqual([missing ? "session.moved" : "session.inbox.enqueued"])
            expect(yield* Queue.size(fixture.probes)).toBe(0)
          }).pipe(Effect.timeout("10 seconds")),
        ),
    )
  }

  itWithInstance.live("moves through the bound service without depending on the Session facade", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = AbsolutePath.make(tmp.path)
      const context = yield* Layer.build(
        AppNodeBuilder.build(LayerNode.group([SessionMove.node, SessionStore.node, Bus.node, Project.node]), [
          Global.node.replace(tempGlobalLayer),
          Project.node.replace(globalProjectNode),
          SessionExecution.node.replace(SessionExecution.noopLayer),
          offlineModels,
        ]),
      )
      const moves = Context.get(context, SessionMove.Service)
      const store = Context.get(context, SessionStore.Service)
      const bus = Context.get(context, Bus.Service)
      const projects = Context.get(context, Project.Service)
      const sessionID = Session.ID.create()

      // Call outside the construction context: the service owns all of its dependencies.
      expect(yield* moves.move({ sessionID, directory }).pipe(Effect.flip)).toEqual(
        new Session.NotFoundError({ sessionID }),
      )
      yield* projects.resolve(directory)
      yield* bus.publish(SessionEvent.Created, {
        sessionID,
        slug: "move-service",
        version: "test",
        projectID: Project.ID.global,
        location: Location.Ref.make({ directory: AbsolutePath.make(path.join(tmp.path, "missing")) }),
      })
      yield* moves.move({ sessionID, directory })
      expect(yield* store.get(sessionID)).toMatchObject({
        location: { directory },
        projectID: Project.ID.global,
      })
    }),
  )

  itWithInstance.live("delegates to the provided move service", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = AbsolutePath.make(tmp.path)
      const rejection = new Session.DestinationUnavailableError({ directory })
      const context = yield* Layer.build(
        AppNodeBuilder.build(Session.node, [
          Global.node.replace(tempGlobalLayer),
          Project.node.replace(globalProjectNode),
          SessionExecution.node.replace(SessionExecution.noopLayer),
          SessionMove.node.replace(Layer.succeed(SessionMove.Service, { move: () => Effect.fail(rejection) })),
          offlineModels,
        ]),
      )
      const sessions = Context.get(context, Session.Service)
      const created = yield* sessions.create({ location: Location.Ref.make({ directory }) })

      expect(yield* sessions.move({ sessionID: created.id, directory }).pipe(Effect.flip)).toBe(rejection)
      expect(yield* sessions.inbox(created.id)).toEqual([])
    }),
  )

  for (const broken of [false, true]) {
    itWithExecution.live(
      `moves an idle session from ${broken ? "broken" : "healthy"} source configuration`,
      () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          const source = AbsolutePath.make(path.join(tmp.path, "source"))
          const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
          yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination)]))
          if (broken)
            yield* Effect.promise(() =>
              Bun.write(
                path.join(source, "aigcfroge.json"),
                JSON.stringify({ instructions: ["{file:./missing.txt}"] }),
              ),
            )
          const session = yield* Session.Service
          const execution = yield* SessionExecution.Service
          const created = yield* (broken ? createLegacySession : session.create)({
            location: Location.Ref.make({ directory: source }),
          })

          yield* session.move({ sessionID: created.id, directory: destination })
          yield* execution.awaitIdle(created.id)

          expect((yield* session.get(created.id)).location.directory).toBe(destination)
          expect(yield* session.inbox(created.id)).toEqual([])
        }),
      { timeout: 15_000 },
    )
  }

  itWithPermissions(
    "recovers an idle session from an unreadable source directory",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const source = AbsolutePath.make(path.join(tmp.path, "source"))
        const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
        yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination)]))
        const session = yield* Session.Service
        const execution = yield* SessionExecution.Service
        const created = yield* session.create({ location: Location.Ref.make({ directory: source }) })
        yield* Effect.addFinalizer(() => Effect.promise(() => chmod(source, 0o755)))
        yield* Effect.promise(() => chmod(source, 0o000))
        expect(
          yield* Effect.promise(() =>
            readdir(source).then(
              () => false,
              () => true,
            ),
          ),
        ).toBe(true)

        yield* session.move({ sessionID: created.id, directory: destination })
        yield* execution.awaitIdle(created.id)

        expect((yield* session.get(created.id)).location.directory).toBe(destination)
        expect(yield* session.inbox(created.id)).toEqual([])
      }),
    { timeout: 15_000 },
  )

  for (const broken of [false, true]) {
    itWithInstance.live(
      `uses the ${broken ? "broken" : "healthy discovery-disabled"} selected instance rather than the default Location`,
      () =>
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          const source = Location.Ref.make({ directory: AbsolutePath.make(path.join(tmp.path, "source")) })
          const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
          yield* Effect.promise(() => Promise.all([mkdir(source.directory), mkdir(destination)]))
          const config = JSON.stringify({ instructions: ["{file:./missing.txt}"] })
          if (!broken) yield* Effect.promise(() => Bun.write(path.join(source.directory, "aigcfroge.json"), config))
          const selectedID = Session.ID.create()
          const replacements: LayerNode.Replacements = [
            Global.node.replace(tempGlobalLayer),
            SessionExecution.node.replace(SessionExecution.noopLayer),
            offlineModels,
            Instance.node.replace(
              makeGlobalNode({
                service: Instance.Service,
                deps: [LocationServiceMap.node],
                layer: Layer.effect(
                  Instance.Service,
                  Effect.gen(function* () {
                    const locations = yield* LocationServiceMap.Service
                    const privateInstances = yield* LayerMap.make(
                      () =>
                        Instance.layer(source, {
                          discovery: false,
                          replacements: [
                            ...bindings,
                            ...(broken
                              ? [
                                  Config.node.replace(
                                    Config.configured({ project: false, global: false, content: config }),
                                  ),
                                ]
                              : []),
                          ],
                        }),
                      { idleTimeToLive: Duration.infinity },
                    )
                    const selector = Instance.Service.of({
                      provide: (session) =>
                        Effect.provide(
                          session.id === selectedID && session.location.directory === source.directory
                            ? privateInstances.get(session.id)
                            : locations.get(session.location),
                        ),
                    })
                    const bindings: LayerNode.Replacements = [
                      ...replacements,
                      Instance.node.replace(Layer.succeed(Instance.Service, selector)),
                      LocationServiceMap.node.replace(Layer.succeed(LocationServiceMap.Service, locations)),
                    ]
                    return selector
                  }),
                ),
              }),
            ),
          ]
          const context = yield* Layer.build(
            AppNodeBuilder.build(LayerNode.group([Session.node, Project.node, Bus.node]), replacements),
          )
          const session = Context.get(context, Session.Service)
          const created = yield* (broken ? session.create : createLegacySession)({
            id: selectedID,
            location: source,
          }).pipe(Effect.provide(context))
          const pending = yield* session.synthetic({
            sessionID: created.id,
            text: "Keep pending",
            delivery: "queue",
            resume: false,
          })

          yield* session.move({ sessionID: created.id, directory: destination, delivery: "queue" })

          expect((yield* session.get(created.id)).location.directory).toBe(broken ? destination : source.directory)
          const inbox = yield* session.inbox(created.id)
          expect(inbox[0]).toEqual(pending)
          if (broken) expect(inbox).toEqual([pending])
          if (!broken) expect(inbox.slice(1)).toMatchObject([{ type: "move", delivery: "queue" }])
        }),
      { timeout: 15_000 },
    )
  }

  for (const interrupt of ["source", "caller"] as const) {
    itWithInstance.live(`does not recover or enqueue a move when the ${interrupt} interrupts the probe`, () =>
      Effect.gen(function* () {
        const fixture = yield* sourceProbe()
        const created = yield* fixture.session.create({ location: Location.Ref.make({ directory: fixture.source }) })
        const pending = yield* fixture.session.synthetic({ sessionID: created.id, text: "Keep pending", resume: false })
        const moving = yield* fixture.session
          .move({ sessionID: created.id, directory: fixture.destination })
          .pipe(Effect.forkScoped)
        const release = yield* Queue.take(fixture.probes)

        if (interrupt === "source") yield* Deferred.interrupt(release)
        if (interrupt === "caller") yield* Fiber.interrupt(moving)
        const exit = yield* Fiber.await(moving)

        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        expect((yield* fixture.session.get(created.id)).location.directory).toBe(fixture.source)
        expect(yield* fixture.session.inbox(created.id)).toEqual([pending])
      }).pipe(Effect.timeout("5 seconds")),
    )
  }

  itWithInstance.live("does not recover if execution starts during the source probe", () =>
    Effect.gen(function* () {
      const fixture = yield* sourceProbe({ execution: true })
      const created = yield* fixture.session.create({ location: Location.Ref.make({ directory: fixture.source }) })
      const moving = yield* fixture.session
        .move({ sessionID: created.id, directory: fixture.destination })
        .pipe(Effect.forkScoped)
      const release = yield* Queue.take(fixture.probes)

      yield* fixture.execution.wake(created.id)
      // The real coordinator now owns execution; its separate instance acquisition stays suspended.
      yield* Queue.take(fixture.probes)
      expect(yield* fixture.execution.isActive(created.id)).toBe(true)
      yield* Deferred.die(release, new Error("source unavailable"))
      yield* Fiber.join(moving)

      expect((yield* fixture.session.get(created.id)).location.directory).toBe(fixture.source)
      expect(yield* fixture.session.inbox(created.id)).toMatchObject([{ type: "move", delivery: "steer" }])
      expect(yield* fixture.execution.isActive(created.id)).toBe(true)
      yield* fixture.execution.interrupt(created.id)
      yield* fixture.execution.awaitIdle(created.id)
    }).pipe(Effect.timeout("5 seconds")),
  )

  itWithInstance.live(
    "recovers a missing source without initializing its instance and retains destination workspace identity",
    () =>
      Effect.gen(function* () {
        const fixture = yield* sourceProbe()
        const created = yield* fixture.session.create({
          location: Location.Ref.make({ directory: fixture.source, workspaceID: Workspace.ID.create() }),
        })
        yield* Effect.promise(() => rm(fixture.source, { recursive: true }))
        const workspaceID = Workspace.ID.create()

        yield* fixture.session.move({ sessionID: created.id, directory: fixture.destination, workspaceID })

        expect((yield* fixture.session.get(created.id)).location).toEqual(
          Location.Ref.make({ directory: fixture.destination, workspaceID }),
        )
        expect(yield* fixture.session.inbox(created.id)).toEqual([])
        expect(yield* Queue.size(fixture.probes)).toBe(0)
      }).pipe(Effect.timeout("5 seconds")),
  )

  for (const changed of ["directory", "workspace"] as const) {
    itWithInstance.live(`allows inbox cancellation during a source probe and rejects stale ${changed} recovery`, () =>
      Effect.gen(function* () {
        const fixture = yield* sourceProbe()
        const created = yield* fixture.session.create({ location: Location.Ref.make({ directory: fixture.source }) })
        const pending = yield* fixture.session.synthetic({
          sessionID: created.id,
          text: "Cancel pending",
          resume: false,
        })
        const moving = yield* fixture.session
          .move({ sessionID: created.id, directory: fixture.destination })
          .pipe(Effect.exit, Effect.forkScoped)
        const release = yield* Queue.take(fixture.probes)

        yield* fixture.session.cancelInbox({ sessionID: created.id, inboxID: pending.id }).pipe(
          Effect.timeout("2 seconds"),
          Effect.onError(() => Deferred.interrupt(release)),
        )
        expect(yield* fixture.session.inbox(created.id)).toEqual([])
        expect(moving.pollUnsafe()).toBeUndefined()
        const location = Location.Ref.make({
          directory: changed === "directory" ? fixture.destination : fixture.source,
          workspaceID: changed === "workspace" ? Workspace.ID.create() : undefined,
        })
        yield* fixture.bus.publish(SessionEvent.Moved, {
          sessionID: created.id,
          location,
          projectID: created.projectID,
        })
        yield* Deferred.die(release, new Error("source unavailable"))
        expect(Exit.isSuccess(yield* Fiber.join(moving))).toBe(true)

        expect((yield* fixture.session.get(created.id)).location).toEqual(location)
        expect(yield* fixture.session.inbox(created.id)).toMatchObject([
          { type: "move", payload: { location: { directory: fixture.destination } } },
        ])
      }).pipe(Effect.timeout("5 seconds")),
    )
  }

  itWithUnavailableDestination.effect("rejects an unavailable destination before admitting the move", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const source = AbsolutePath.make(path.join(tmp.path, "source"))
          const destination = AbsolutePath.make(path.join(tmp.path, "destination"))
          yield* Effect.promise(() => Promise.all([mkdir(source), mkdir(destination)]))
          const created = yield* createLegacySession({ location: Location.Ref.make({ directory: source }) })

          const error = yield* session.move({ sessionID: created.id, directory: destination }).pipe(Effect.flip)

          expect(error).toEqual(new Session.DestinationUnavailableError({ directory: destination }))
          expect((yield* session.get(created.id)).location.directory).toBe(source)
          expect(yield* session.inbox(created.id)).toEqual([])
        }),
      ),
    ),
  )

  it.effect("applies a move immediately when the source directory no longer exists", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const destination = AbsolutePath.make(tmp.path)
          const source = path.join(tmp.path, "source")
          yield* Effect.promise(() => mkdir(source))
          const created = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(source) }),
          })

          yield* session.move({ sessionID: created.id, directory: destination })
          expect((yield* session.get(created.id)).location.directory).toBe(AbsolutePath.make(source))
          expect(yield* session.inbox(created.id)).toHaveLength(1)
          const pending = yield* session.synthetic({
            sessionID: created.id,
            text: "Keep queued",
            delivery: "queue",
            resume: false,
          })
          yield* session.move({ sessionID: created.id, directory: destination, delivery: "queue" })
          expect(yield* session.inbox(created.id)).toHaveLength(3)

          yield* Effect.promise(() => rm(source, { recursive: true }))
          yield* session.move({ sessionID: created.id, directory: destination })

          expect((yield* session.get(created.id)).location.directory).toBe(destination)
          expect(yield* session.inbox(created.id)).toEqual([pending])

          yield* session.move({ sessionID: created.id, directory: destination })
          expect(yield* session.inbox(created.id)).toHaveLength(2)

          yield* Effect.promise(() => mkdir(path.join(tmp.path, "other")))
          const steered = yield* session.create({
            location: Location.Ref.make({ directory: AbsolutePath.make(path.join(tmp.path, "other")) }),
          })
          yield* session.move({ sessionID: steered.id, directory: destination, delivery: "queue" })
          expect(yield* session.inbox(steered.id)).toMatchObject([{ type: "move", delivery: "queue" }])
        }),
      ),
    ),
  )

  itWithActiveExecution.live("defers an active move when the source directory no longer exists", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const execution = yield* SessionExecution.Service
          const source = AbsolutePath.make(path.join(tmp.path, "source"))
          const destination = AbsolutePath.make(tmp.path)
          yield* Effect.promise(() => mkdir(source))
          const created = yield* createLegacySession({ location: Location.Ref.make({ directory: source }) })

          // Hold real execution open so the move cannot be consumed before admission is checked.
          yield* execution.wake(created.id)
          expect(yield* execution.isActive(created.id)).toBe(true)
          yield* Effect.promise(() => rm(source, { recursive: true }))

          yield* session.move({ sessionID: created.id, directory: destination })

          expect((yield* session.get(created.id)).location.directory).toBe(source)
          expect(yield* session.inbox(created.id)).toMatchObject([
            {
              type: "move",
              delivery: "steer",
              payload: { location: { directory: destination } },
            },
          ])
          expect(yield* execution.isActive(created.id)).toBe(true)

          yield* execution.interrupt(created.id)
          yield* execution.awaitIdle(created.id)
        }),
      ),
    ),
  )

  it.effect("keeps a moved session out of its former directory's new identity", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const bus = yield* Bus.Service
          const previous = AbsolutePath.make(path.join(tmp.path, "previous"))
          const destination = AbsolutePath.make(tmp.path)
          const created = yield* createLegacySession({ location: Location.Ref.make({ directory: previous }) })

          // Moves are admitted through the inbox and applied by the drain;
          // publish the applied move directly since execution is a no-op here.
          yield* bus.publish(SessionEvent.Moved, {
            sessionID: created.id,
            location: Location.Ref.make({ directory: destination }),
            projectID: Project.ID.global,
          })
          // The former directory becomes a project after the session left it.
          yield* bus.publish(Worktree.Event.Resolved, {
            projectID: Project.ID.make("adopting"),
            directory: previous,
            previous: Project.ID.global,
          })

          expect(yield* session.get(created.id)).toMatchObject({
            projectID: Project.ID.global,
            location: { directory: destination },
            subpath: undefined,
          })
        }),
      ),
    ),
  )
})
