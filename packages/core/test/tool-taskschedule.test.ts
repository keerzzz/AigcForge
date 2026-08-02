import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { EventV2 } from "@aigcfroge/core/event"
import { Location } from "@aigcfroge/core/location"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { PermissionSaved } from "@aigcfroge/core/permission/saved"
import { Project } from "@aigcfroge/core/project"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { SessionTask } from "@aigcfroge/core/session/task"
import { TaskScheduleTool } from "@aigcfroge/core/tool/taskschedule"
import { ToolRegistry } from "@aigcfroge/core/tool/registry"
import { Tools } from "@aigcfroge/core/tool/tools"
import { ApplicationTools } from "@aigcfroge/core/tool/application-tools"
import { ToolOutputStore } from "@aigcfroge/core/tool-output-store"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const current = Layer.succeed(
  Location.Service,
  Location.Service.of(location({ directory: AbsolutePath.make("/project") })),
)
const sessions = SessionV2.layer.pipe(
  Layer.provide(EventV2.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(SessionStore.defaultLayer),
  Layer.provide(Project.defaultLayer),
  Layer.provide(SessionExecution.noopLayer),
)
const permission = PermissionV2.locationLayer.pipe(
  Layer.provideMerge(Database.defaultLayer),
  Layer.provideMerge(SessionStore.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provideMerge(current),
  Layer.provideMerge(sessions),
  Layer.provideMerge(SessionExecution.noopLayer),
  Layer.provideMerge(PermissionSaved.defaultLayer),
)
const registry = ToolRegistry.layer.pipe(
  Layer.provide(permission),
  Layer.provide(ApplicationTools.layer),
  Layer.provide(ToolOutputStore.defaultLayer),
)
const tools = Layer.effect(
  Tools.Service,
  ToolRegistry.Service.use((reg) => Effect.succeed(Tools.Service.of({ register: reg.register }))),
).pipe(Layer.provide(registry))

const it = testEffect(
  TaskScheduleTool.layer.pipe(
    Layer.provideMerge(tools),
    Layer.provideMerge(registry),
    Layer.provideMerge(SessionTask.defaultLayer),
    Layer.provideMerge(permission),
  ),
)

describe("task_schedule tool", () => {
  it.effect("registers the task_schedule tool in the registry", () =>
    Effect.gen(function* () {
      const reg = yield* ToolRegistry.Service
      const materialized = yield* reg.materialize([
        { action: TaskScheduleTool.name, resource: "*", effect: "allow" },
      ])
      expect(materialized.definitions.some((definition) => definition.name === TaskScheduleTool.name)).toBe(true)
    }),
  )
})
