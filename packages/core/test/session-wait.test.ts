import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Bus } from "@omnixa/core/bus"
import { Location } from "@omnixa/core/location"
import { Project } from "@omnixa/core/project"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { SessionProjector } from "@omnixa/core/session/projector"
import { SessionExecution } from "@omnixa/core/session/execution"
import { SessionStore } from "@omnixa/core/session/store"
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
