import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { ProjectV2 } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
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

// 批次 1 §3.6 5 层依赖链兜底：core `Session.create({presetCategoryId})` 必须
// 把工种写入 session.Info，回读一致（老会话无值归 undefined，不破坏现有数据）。
describe("SessionV2.create presetCategoryId passthrough", () => {
  it.effect("persists the presetCategoryId on the created Session info", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const created = yield* session.create({ location, presetCategoryId: "it-development" })

      expect(created.presetCategoryId).toBe("it-development")
    }),
  )

  it.effect("round-trips presetCategoryId through the projected store", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const created = yield* session.create({ location, presetCategoryId: "video-creation" })
      const read = yield* session.get(created.id)

      expect(read.presetCategoryId).toBe("video-creation")
    }),
  )

  it.effect("omits presetCategoryId when the create input does not supply it", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service

      const created = yield* session.create({ location })

      expect(created.presetCategoryId).toBeUndefined()
    }),
  )
})
