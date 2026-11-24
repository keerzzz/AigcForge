import type { FileSystem } from "@omnixa/core/filesystem"
import { describe, expect } from "bun:test"
import { LLMClient, LLMEvent, type LLMRequest } from "@omnixa/ai"
import { Agent } from "@omnixa/core/agent"
import { Database } from "@omnixa/core/database/database"
import { AppNodeBuilder } from "@omnixa/core/effect/app-node-builder"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Bus } from "@omnixa/core/bus"
import { Location } from "@omnixa/core/location"
import { LocationServiceMap } from "@omnixa/core/location-service-map"
import type { LocationServices } from "@omnixa/core/location-services"
import { Plugin } from "@omnixa/core/plugin"
import { Project } from "@omnixa/core/project"
import { AbsolutePath } from "@omnixa/core/schema"
import { Session } from "@omnixa/core/session"
import { SessionEvent } from "@omnixa/core/session/event"
import { SessionMessage } from "@omnixa/core/session/message"
import { SessionProjector } from "@omnixa/core/session/projector"
import { SessionExecution } from "@omnixa/core/session/execution"
import { SessionStore } from "@omnixa/core/session/store"
import { Effect, Layer, LayerMap, Stream } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })
let requests: LLMRequest[] = []
const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    return Stream.make(LLMEvent.textDelta({ id: "summary", text: "manual session summary" }))
  },
  generate: () => Effect.die("unused"),
})
const locations = Layer.effect(
  LocationServiceMap.Service,
  LayerMap.make(
    () =>
      // Manual compaction is admitted without executing the model.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      Layer.mergeAll(
        LayerNode.compile(Agent.node),
        client,
        Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
      ) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
  ),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      LocationServiceMap.node.replace(locations),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)

describe("Session.compact", () => {
  it.effect("durably coalesces manual compaction", () =>
    Effect.gen(function* () {
      requests = []
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })

      const messageID = SessionMessage.ID.create()
      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: created.id,
        inboxID: messageID,
        item: {
          type: "user",
          payload: { text: "Please compact this session history." },
          delivery: "steer",
        },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, {
        sessionID: created.id,
        inboxID: messageID,
      })

      expect(yield* session.compact({ id: messageID, sessionID: created.id }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.CompactionConflictError",
        inputID: messageID,
      })
      const first = yield* session.compact({ sessionID: created.id })
      const second = yield* session.compact({ sessionID: created.id })

      expect(second.id).toBe(first.id)
      expect(requests).toHaveLength(0)
      expect(yield* session.inbox(created.id)).toEqual([
        expect.objectContaining({ id: first.id, type: "compaction", delivery: "steer" }),
      ])
      expect((yield* session.context(created.id)).find((message) => message.id === first.id)).toBeUndefined()

      const queued = yield* session.create({ location })
      const queue = yield* session.compact({ sessionID: queued.id, delivery: "queue" })
      expect(queue).toMatchObject({ type: "compaction", delivery: "queue" })
    }),
  )

  it.effect("coalesces concurrent manual compaction", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const created = yield* session.create({ location })
      const admitted = yield* Effect.all(
        [SessionMessage.ID.create(), SessionMessage.ID.create()].map((id) =>
          session.compact({ id, sessionID: created.id }),
        ),
        { concurrency: "unbounded" },
      )

      expect(admitted[1]?.id).toBe(admitted[0]?.id)
      expect(yield* session.inbox(created.id)).toHaveLength(1)
    }),
  )

  it.effect("commits a staged revert before admitting manual compaction", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const bus = yield* Bus.Service
      const created = yield* session.create({ location })
      const messageID = SessionMessage.ID.create()

      yield* bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: created.id,
        inboxID: messageID,
        item: {
          type: "user",
          payload: { text: "Undo this prompt before compacting." },
          delivery: "steer",
        },
      })
      yield* bus.publish(SessionEvent.InboxDelivered, {
        sessionID: created.id,
        inboxID: messageID,
      })
      yield* bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: created.id,
        revert: { messageID, files: [] },
      })

      expect((yield* session.get(created.id)).revert?.messageID).toBe(messageID)

      const compacted = yield* session.compact({ sessionID: created.id })

      expect((yield* session.get(created.id)).revert).toBeUndefined()
      expect(yield* session.context(created.id)).toEqual([])
      expect(yield* session.inbox(created.id)).toEqual([
        expect.objectContaining({ id: compacted.id, type: "compaction" }),
      ])
    }),
  )
})
