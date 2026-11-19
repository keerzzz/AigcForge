import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { ProjectTable } from "@aigcfroge/core/project/sql"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTable } from "@aigcfroge/core/session/sql"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

// The fork drives the tier through `Session.create({ permissionTier })` and
// SessionV1 event projection; v2's session surface has neither input nor
// SessionV1 projection yet, so these tests pin the part `permission.ts`
// actually consumes: the stored `permission_tier`/`attended`/`mode` columns
// decode through the session store exactly as the effective-rules owner reads
// them. Creation still defaults new roots to `propose` (attended NULL, §3.4).

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, SessionStore.node]), [Location.node.replace(current)]),
)

let counter = 0
const insertSession = (
  input: { permissionTier?: "propose" | "full"; attended?: 0 | 1 | null; parentID?: Session.ID } = {},
) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    counter += 1
    const id = Session.ID.make(`ses_tier_${counter}`)
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id,
        project_id: Project.ID.global,
        slug: id,
        directory: "/project",
        title: id,
        version: "test",
        agent: "test",
        // 根会话默认有人值守（attended NULL，计划 §3.4）。
        attended: input.parentID ? 0 : (input.attended ?? null),
        parent_id: input.parentID,
        ...(input.permissionTier ? { permission_tier: input.permissionTier } : {}),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    return id
  })

describe("Session permission tier", () => {
  it.effect("defaults a new root session to propose", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const sessionID = yield* insertSession()

      const session = yield* store.get(sessionID)
      expect(session?.permissionTier).toBe("propose")

      const { db } = yield* Database.Service
      expect(
        yield* db
          .select({ permission_tier: SessionTable.permission_tier })
          .from(SessionTable)
          .where(eq(SessionTable.id, sessionID))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ permission_tier: "propose" })
    }),
  )

  it.effect("round-trips an explicitly supplied full tier", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const sessionID = yield* insertSession({ permissionTier: "full" })

      expect((yield* store.get(sessionID))?.permissionTier).toBe("full")

      const { db } = yield* Database.Service
      yield* db
        .update(SessionTable)
        .set({ permission_tier: "propose" })
        .where(eq(SessionTable.id, sessionID))
        .run()
        .pipe(Effect.orDie)
      expect((yield* store.get(sessionID))?.permissionTier).toBe("propose")
    }),
  )

  it.effect("does not inherit the parent tier for child sessions", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const parent = yield* insertSession({ permissionTier: "full" })
      const child = yield* insertSession({ parentID: parent })

      expect((yield* store.get(parent))?.permissionTier).toBe("full")
      expect((yield* store.get(child))?.permissionTier).toBe("propose")
    }),
  )

  it.effect("decodes the stored tier and attendance flags into session info", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const full = yield* insertSession({ permissionTier: "full", attended: 1 })
      const unattended = yield* insertSession({ attended: 0 })

      const attendedSession = yield* store.get(full)
      expect(attendedSession?.permissionTier).toBe("full")
      expect(attendedSession?.attended).toBe(true)

      const unattendedSession = yield* store.get(unattended)
      expect(unattendedSession?.permissionTier).toBe("propose")
      expect(unattendedSession?.attended).toBe(false)
    }),
  )

  it.effect("treats a NULL attendance flag as attended (legacy rows)", () =>
    Effect.gen(function* () {
      const store = yield* SessionStore.Service
      const sessionID = yield* insertSession()

      const session = yield* store.get(sessionID)
      expect(session?.attended).toBeUndefined()
      // `effectiveV2` reads `attended !== false`: NULL rows stay attended.
      expect(session?.attended !== false).toBe(true)
    }),
  )
})
