import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer, Schema } from "effect"
import { Session as SessionNs } from "@/session/session"
import { CrossSpawnSpawner } from "@aigcfroge/core/cross-spawn-spawner"
import { Database } from "@aigcfroge/core/database/database"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { Storage } from "@/storage/storage"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"

const it = testEffect(
  Layer.mergeAll(
    SessionNs.layer.pipe(
      Layer.provide(Storage.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provideMerge(EventV2Bridge.defaultLayer),
      Layer.provide(SessionProjector.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
    CrossSpawnSpawner.defaultLayer,
    testInstanceStoreLayer,
  ),
)

describe("Session permission tier", () => {
  it.instance("defaults a new root session to propose", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* session.create({})

      expect(created.permissionTier).toBe(PermissionTier.Default)
      expect((yield* session.get(created.id)).permissionTier).toBe("propose")
    }),
  )

  it.instance("round-trips an explicitly supplied full tier", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* session.create({ permissionTier: "full" })

      expect(created.permissionTier).toBe("full")
      expect((yield* session.get(created.id)).permissionTier).toBe("full")
    }),
  )

  it.instance("resets the tier to propose on fork", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const parent = yield* session.create({ mode: "chat", permissionTier: "full" })
      const fork = yield* session.fork({ sessionID: parent.id })

      expect(parent.permissionTier).toBe("full")
      expect(fork.permissionTier).toBe("propose")
    }),
  )

  it.instance("updates the tier through setPermissionTier and reloads it", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const created = yield* session.create({})

      yield* session.setPermissionTier({ sessionID: created.id, permissionTier: "full" })

      expect((yield* session.get(created.id)).permissionTier).toBe("full")
    }),
  )

  it.instance("accepts attended false and permissionTier through the create input schema", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(SessionNs.CreateInput)({
        mode: "chat",
        attended: false,
        permissionTier: "full",
      })
      expect(decoded).toMatchObject({ mode: "chat", attended: false, permissionTier: "full" })

      const session = yield* SessionNs.Service
      const created = yield* session.create({ attended: false })
      expect((yield* session.get(created.id)).attended).toBe(false)
    }),
  )
})

describe("Session permission tier guards (M6)", () => {
  it.instance("rejects tier updates for child and unattended sessions", () =>
    Effect.gen(function* () {
      const session = yield* SessionNs.Service
      const parent = yield* session.create({ mode: "chat", agent: "meta" })
      const child = yield* session.create({ parentID: parent.id, mode: "chat", agent: "meta" })
      const unattended = yield* session.create({ mode: "chat", agent: "meta", attended: false })

      for (const target of [child, unattended]) {
        const exit = yield* session.setPermissionTier({ sessionID: target.id, permissionTier: "full" }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.squash(exit.cause)).toBeInstanceOf(SessionNs.PermissionTierError)
        }
      }

      yield* session.setPermissionTier({ sessionID: parent.id, permissionTier: "full" })
      expect((yield* session.get(parent.id)).permissionTier).toBe("full")
    }),
  )
})
