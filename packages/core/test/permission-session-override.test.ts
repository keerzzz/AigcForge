import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionPermissionOverride } from "@aigcfroge/core/permission/session-override"
import { testEffect } from "./lib/effect"

const projects = Layer.succeed(
  ProjectV2.Service,
  ProjectV2.Service.of({
    resolve: (directory) => Effect.succeed({ id: ProjectV2.ID.global, directory }),
    directories: () => Effect.succeed([]),
    commit: () => Effect.void,
  }),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(projects),
  Layer.provide(SessionExecution.noopLayer),
)
const base = Layer.mergeAll(
  Database.defaultLayer,
  EventV2.defaultLayer,
  projects,
  SessionProjector.defaultLayer,
  SessionStore.defaultLayer,
  SessionExecution.noopLayer,
  sessions,
)
const overrideLayer = SessionPermissionOverride.layer.pipe(
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(SessionStore.defaultLayer),
  Layer.provideMerge(projects),
)
const it = testEffect(Layer.mergeAll(base, overrideLayer))
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("SessionPermissionOverride", () => {
  it.effect("is disabled before activation and clears after the lease expires", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      expect(yield* service.get(created.id)).toBe(false)

      yield* service.enable(created.id)
      expect(yield* service.get(created.id)).toBe(true)

      yield* service.renew(created.id)
      expect(yield* service.get(created.id)).toBe(true)

      yield* TestClock.adjust("61 seconds")
      expect(yield* service.get(created.id)).toBe(false)
    }),
  )

  it.effect("disable turns the override off immediately", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* service.enable(created.id)
      yield* service.disable(created.id)
      expect(yield* service.get(created.id)).toBe(false)
    }),
  )

  it.effect("rejects child sessions", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ location })
      const child = yield* session.create({ location, parentID: parent.id })

      const exit = yield* service.enable(child.id).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionPermissionOverride.UnavailableError)
        if (error instanceof SessionPermissionOverride.UnavailableError) expect(error.reason).toBe("child-session")
      }
      expect(yield* service.get(child.id)).toBe(false)
    }),
  )

  it.effect("rejects unattended root sessions", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location, attended: false })

      const exit = yield* service.enable(created.id).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error).toBeInstanceOf(SessionPermissionOverride.UnavailableError)
        if (error instanceof SessionPermissionOverride.UnavailableError) expect(error.reason).toBe("unattended")
      }
      expect(yield* service.get(created.id)).toBe(false)
    }),
  )

  it.effect("clears all overrides", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const session = yield* SessionV2.Service
      const first = yield* session.create({ location })
      const second = yield* session.create({ location })
      yield* service.enable(first.id)
      yield* service.enable(second.id)
      yield* service.clear()
      expect(yield* service.get(first.id)).toBe(false)
      expect(yield* service.get(second.id)).toBe(false)
    }),
  )

  it.effect("clears state when the layer scope closes (service restart)", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      yield* service.enable(created.id)
      expect(yield* service.get(created.id)).toBe(true)

      // 嵌套 fresh layer = 服务重启：新实例的 Map 为空。
      yield* Effect.gen(function* () {
        const fresh = yield* SessionPermissionOverride.Service
        expect(yield* fresh.get(created.id)).toBe(false)
      }).pipe(Effect.provide(Layer.fresh(Layer.mergeAll(SessionPermissionOverride.layer, EventV2.defaultLayer, SessionStore.defaultLayer, projects))))
    }),
  )

  it.effect("rejects activation for a missing session", () =>
    Effect.gen(function* () {
      const service = yield* SessionPermissionOverride.Service
      const error = yield* service.enable(SessionV2.ID.make("ses_missing_override")).pipe(Effect.flip)
      expect(error._tag).toBe("Session.NotFoundError")
    }),
  )
})
