import { describe, expect } from "bun:test"
import { Cause, Context, Effect, Exit, Layer, RcMap, Scope } from "effect"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Database } from "@omnixa/core/database/database"
import { Bus } from "@omnixa/core/bus"
import { Instance } from "@omnixa/core/instance/service"
import { Location } from "@omnixa/core/location"
import { Project } from "@omnixa/core/project"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { Job } from "@omnixa/core/job"
import { SessionEvent } from "@omnixa/core/session/event"
import { SessionTable } from "@omnixa/core/session/sql"
import { SessionExecution } from "@omnixa/core/session/execution"
import { SessionModelTransport } from "@omnixa/core/session/model-transport"
import { SessionProjector } from "@omnixa/core/session/projector"
import { SessionStore } from "@omnixa/core/session/store"
import { SessionEnvironment } from "@omnixa/core/session/environment"
import { LocationServiceMap } from "@omnixa/core/location-services"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { createLegacySession, offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"

const closed: Session.ID[] = []
const transportScopes = new Set<Scope.Scope>()
const transport = Layer.effect(
  SessionModelTransport.Service,
  Effect.gen(function* () {
    const scope = yield* Scope.Scope
    transportScopes.add(scope)
    yield* Effect.addFinalizer(() => Effect.sync(() => transportScopes.delete(scope)))
    return SessionModelTransport.Service.of({
      bind: () => ({ execute: () => Effect.die("Unexpected WebSocket execution") }),
      close: (sessionID) => Effect.sync(() => closed.push(sessionID)),
      closeAll: Effect.void,
    })
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionProjector.node,
      SessionStore.node,
      SessionEnvironment.node,
      Session.node,
      Project.node,
      Instance.node,
      LocationServiceMap.node,
    ]),
    [
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      SessionModelTransport.node.replace(transport),
      offlineModels,
    ],
  ),
)

describe("Session.remove", () => {
  it.effect("removes a session and its children", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const location = Location.Ref.make({ directory: AbsolutePath.make(temporary.path) })
      const session = yield* Session.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ parentID: parent.id })
      yield* session.environment({ sessionID: parent.id, variables: { SESSION_ENV: "parent" } })
      yield* session.environment({ sessionID: child.id, variables: { SESSION_ENV: "child" } })
      const locations = yield* LocationServiceMap.Service
      yield* Effect.acquireRelease(locations.contextEffect(location), () => locations.invalidate(location))
      closed.length = 0

      yield* session.remove(parent.id)

      expect((yield* session.list()).data).toEqual([])
      expect(closed).toEqual([parent.id, child.id])
      const environments = yield* SessionEnvironment.Service
      expect(yield* environments.get(parent.id)).toBeUndefined()
      expect(yield* environments.get(child.id)).toBeUndefined()
      expect(yield* Effect.result(session.get(parent.id))).toMatchObject({ _tag: "Failure" })
      expect(yield* Effect.result(session.get(child.id))).toMatchObject({ _tag: "Failure" })
    }),
  )

  it.live("removes unloaded sessions and children without initializing an instance", () =>
    Effect.gen(function* () {
      const temporary = yield* tmpdirScoped()
      const sessions = yield* Session.Service
      const locations = yield* LocationServiceMap.Service
      const parent = yield* createLegacySession({
        location: Location.Ref.make({ directory: AbsolutePath.make(temporary.path) }),
      })
      const child = yield* sessions.create({ parentID: parent.id })
      closed.length = 0
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])

      yield* sessions.remove(parent.id)

      expect(closed).toEqual([parent.id, child.id])
      expect(transportScopes.size).toBe(1)
      expect(Array.from(yield* RcMap.keys(locations.rcMap))).toEqual([])
      expect((yield* sessions.list()).data).toEqual([])
    }),
  )

  testEffect(Layer.empty).live(
    "MC10 retains the parent and remaining child after partial cleanup and retries only the remainder",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped()
        const timeline: { type: "interrupt" | "idle" | "close" | "deleted"; sessionID: Session.ID }[] = []
        const failOnce = new Set<Session.ID>()
        const failure = new Error("Second child transport cleanup failed")
        const context = yield* Layer.build(
          AppNodeBuilder.build(
            LayerNode.group([
              Database.node,
              Bus.node,
              Job.node,
              SessionProjector.node,
              SessionStore.node,
              SessionEnvironment.node,
              Session.node,
              Instance.node,
              LocationServiceMap.node,
            ]),
            [
              Database.node.replace(Database.configured({ path: `${directory.path}/partial-cleanup.sqlite` })),
              Project.node.replace(globalProjectNode),
              SessionExecution.node.replace(
                Layer.effect(
                  SessionExecution.Service,
                  Effect.gen(function* () {
                    const execution = yield* SessionExecution.Service
                    return SessionExecution.Service.of({
                      ...execution,
                      interrupt: (sessionID, options) =>
                        execution
                          .interrupt(sessionID, options)
                          .pipe(Effect.tap(() => Effect.sync(() => timeline.push({ type: "interrupt", sessionID })))),
                      awaitIdle: (sessionID) =>
                        execution
                          .awaitIdle(sessionID)
                          .pipe(Effect.tap(() => Effect.sync(() => timeline.push({ type: "idle", sessionID })))),
                    })
                  }),
                ).pipe(Layer.provide(SessionExecution.noopLayer)),
              ),
              SessionModelTransport.node.replace(
                Layer.effect(
                  SessionModelTransport.Service,
                  Effect.gen(function* () {
                    const original = yield* SessionModelTransport.Service
                    return SessionModelTransport.Service.of({
                      ...original,
                      close: (sessionID) =>
                        Effect.gen(function* () {
                          timeline.push({ type: "close", sessionID })
                          if (failOnce.delete(sessionID)) return yield* Effect.die(failure)
                          yield* original.close(sessionID)
                        }),
                    })
                  }),
                ).pipe(Layer.provide(transport)),
              ),
              offlineModels,
            ],
          ),
        )
        const sessions = Context.get(context, Session.Service)
        const bus = Context.get(context, Bus.Service)
        const jobs = Context.get(context, Job.Service)
        const database = Context.get(context, Database.Service)
        const environments = Context.get(context, SessionEnvironment.Service)
        const parent = yield* sessions.create({
          location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
          title: "Partial cleanup parent",
        })
        yield* sessions.create({ parentID: parent.id, title: "First created child" })
        yield* sessions.create({ parentID: parent.id, title: "Second created child" })
        // The production list decides cleanup order; creation time may be equal.
        const children = (yield* sessions.list({ parentID: parent.id })).data
        expect(children).toHaveLength(2)
        const first = children[0]
        const second = children[1]
        if (!first || !second) return yield* Effect.die(new Error("Cleanup children missing"))
        yield* sessions.environment({ sessionID: parent.id, variables: { SESSION_ENV: "parent" } })
        yield* sessions.environment({ sessionID: first.id, variables: { SESSION_ENV: "first" } })
        yield* sessions.environment({ sessionID: second.id, variables: { SESSION_ENV: "second" } })
        const before = yield* database.db.select().from(SessionTable).all()
        failOnce.add(second.id)
        yield* bus.project(SessionEvent.Deleted, (event) =>
          Effect.sync(() => timeline.push({ type: "deleted", sessionID: event.data.sessionID })),
        )
        const interruptedCleanup = yield* sessions.remove(parent.id).pipe(Effect.exit)
        if (Exit.isSuccess(interruptedCleanup))
          return yield* Effect.die(new Error("Expected child cleanup failure missing"))
        expect(Cause.squash(interruptedCleanup.cause)).toBe(failure)
        expect(timeline).toEqual([
          { type: "interrupt", sessionID: parent.id },
          { type: "idle", sessionID: parent.id },
          { type: "close", sessionID: parent.id },
          { type: "interrupt", sessionID: first.id },
          { type: "idle", sessionID: first.id },
          { type: "close", sessionID: first.id },
          { type: "deleted", sessionID: first.id },
          { type: "interrupt", sessionID: second.id },
          { type: "idle", sessionID: second.id },
          { type: "close", sessionID: second.id },
        ])
        expect(yield* database.db.select().from(SessionTable).all()).toEqual(
          before.filter((row) => row.id !== first.id),
        )
        expect(yield* environments.get(parent.id)).toEqual({ SESSION_ENV: "parent" })
        expect(yield* environments.get(second.id)).toEqual({ SESSION_ENV: "second" })
        expect(yield* environments.get(first.id)).toBeUndefined()
        expect((yield* sessions.get(second.id)).parentID).toBe(parent.id)
        expect(yield* jobs.isDeletingSession(parent.id)).toBe(false)
        expect(yield* jobs.isDeletingSession(second.id)).toBe(false)
        yield* sessions.remove(parent.id)
        expect(timeline.filter((event) => event.type === "deleted").map((event) => event.sessionID)).toEqual([
          first.id,
          second.id,
          parent.id,
        ])
        expect(timeline.filter((event) => event.type === "close").map((event) => event.sessionID)).toEqual([
          parent.id,
          first.id,
          second.id,
          parent.id,
          second.id,
        ])
        expect(yield* database.db.select().from(SessionTable).all()).toEqual([])
        expect(yield* environments.get(parent.id)).toBeUndefined()
        expect(yield* environments.get(second.id)).toBeUndefined()
        expect(yield* jobs.isDeletingSession(parent.id)).toBe(false)
      }),
  )

  it.effect("fails when the session does not exist", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing")

      expect(yield* Effect.result(session.remove(sessionID))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "Session.NotFoundError", sessionID },
      })
    }),
  )
})
