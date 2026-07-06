import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { SessionStore } from "@aigcfroge/core/session/store"
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
const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    EventV2.defaultLayer,
    projects,
    SessionProjector.defaultLayer,
    SessionStore.defaultLayer,
    SessionExecution.noopLayer,
    sessions,
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("SessionV2.children", () => {
  it.effect("returns only the sessions that name the parent", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const { db } = yield* Database.Service
      const parent = yield* session.create({ location })
      const childA = yield* session.create({ location })
      const childB = yield* session.create({ location })
      yield* session.create({ location })

      for (const child of [childA, childB]) {
        yield* db
          .update(SessionTable)
          .set({ parent_id: parent.id })
          .where(eq(SessionTable.id, child.id))
          .run()
          .pipe(Effect.orDie)
      }

      const children = yield* session.children(parent.id)
      expect(children.map((child) => child.id).sort()).toEqual([childA.id, childB.id].sort())
      expect(children.every((child) => child.parentID === parent.id)).toBe(true)
    }),
  )

  it.effect("returns an empty list when a session has no children", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      expect(yield* session.children(created.id)).toEqual([])
    }),
  )

  it.effect("rejects children lookup for a missing session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const missing = SessionV2.ID.make("ses_missing_children")

      expect(
        yield* session.children(missing).pipe(
          Effect.flip,
          Effect.map((error) => error._tag),
        ),
      ).toBe("Session.NotFoundError")
    }),
  )
})
