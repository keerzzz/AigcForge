import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionV1 } from "@aigcfroge/core/v1/session"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"
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

describe("SessionV2 permission tier", () => {
  it.effect("defaults a new root session to propose", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })

      expect(created.permissionTier).toBe(PermissionTier.Default)
      expect(yield* session.get(created.id)).toMatchObject({ permissionTier: "propose" })
    }),
  )

  it.effect("round-trips an explicitly supplied full tier", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location, permissionTier: "full" })

      expect(created.permissionTier).toBe("full")
      expect(yield* session.get(created.id)).toMatchObject({ permissionTier: "full" })
    }),
  )

  it.effect("does not inherit the parent tier for child sessions", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ location, mode: "chat", permissionTier: "full" })
      const child = yield* session.create({ location, parentID: parent.id, mode: "work" })

      expect(parent.permissionTier).toBe("full")
      expect(child.permissionTier).toBe("propose")
      expect(yield* session.get(child.id)).toMatchObject({ permissionTier: "propose" })
    }),
  )

  it.effect("reloads an updated tier after a projected Session update", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location })

      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: created.id,
        info: SessionV1.SessionInfo.make({
          id: created.id,
          slug: "updated",
          version: "test",
          projectID: created.projectID,
          directory: created.location.directory,
          title: "updated",
          agent: "build",
          permissionTier: "full",
          time: { created: 0, updated: 1 },
        }),
      })

      expect(yield* session.get(created.id)).toMatchObject({ permissionTier: "full" })
    }),
  )

  it.effect("decodes legacy Session events without a tier as propose", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const events = yield* EventV2.Service
      const created = yield* session.create({ location, permissionTier: "full" })

      yield* events.publish(SessionV1.Event.Updated, {
        sessionID: created.id,
        info: SessionV1.SessionInfo.make({
          id: created.id,
          slug: "updated",
          version: "test",
          projectID: created.projectID,
          directory: created.location.directory,
          title: "updated",
          agent: "build",
          time: { created: 0, updated: 1 },
        }),
      })

      expect(yield* session.get(created.id)).toMatchObject({ permissionTier: "propose" })
    }),
  )

  it.effect("projects the tier through the legacy created event into the session row", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const created = yield* session.create({ location })
      const { db } = yield* Database.Service

      expect(
        yield* db
          .select({ permission_tier: SessionTable.permission_tier })
          .from(SessionTable)
          .where(eq(SessionTable.id, created.id))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ permission_tier: "propose" })
    }),
  )
})
