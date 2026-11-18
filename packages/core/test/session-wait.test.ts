import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { Bus } from "@aigcfroge/core/bus"
import { Location } from "@aigcfroge/core/location"
import { Project } from "@aigcfroge/core/project"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Session } from "@aigcfroge/core/session"
import { SessionProjector } from "@aigcfroge/core/session/projector"
import { SessionExecution } from "@aigcfroge/core/session/execution"
import { SessionStore } from "@aigcfroge/core/session/store"
import { createLegacySession } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
const awaited: Session.ID[] = []
const execution = Layer.mock(SessionExecution.Service, {
  awaitIdle: (sessionID) => Effect.sync(() => awaited.push(sessionID)),
})
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, Project.node, SessionProjector.node, SessionStore.node, Session.node]),
    [Project.node.replace(globalProjectNode), SessionExecution.node.replace(execution)],
  ),
)

describe("Session.wait", () => {
  it.effect("delegates to SessionExecution.awaitIdle", () =>
    Effect.gen(function* () {
      awaited.length = 0
      const sessions = yield* Session.Service
      const session = yield* createLegacySession({ location })

      yield* sessions.wait(session.id)

      expect(awaited).toEqual([session.id])
    }),
  )
})
