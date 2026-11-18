import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { SessionTask } from "@aigcfroge/core/session/task"
import { Event } from "@aigcfroge/schema/event"
import { SessionID } from "@aigcfroge/schema/session-id"
import { SessionTaskEvent } from "@aigcfroge/schema/session-task-event"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)

describe("Session Task event facade", () => {
  test("re-exports the exact canonical Task events and shared payload schemas", () => {
    expect(SessionTask.Event.Updated).toBe(SessionTaskEvent.Updated)
    expect(SessionTask.Event.TodoUpdated).toBe(SessionTaskEvent.TodoUpdated)
    expect(SessionTask.Event.Progress).toBe(SessionTaskEvent.Progress)
    expect(SessionTask.TodoProjection).toBe(SessionTaskEvent.TodoProjection)
    expect(SessionTask.TaskExecutionPhase).toBe(SessionTaskEvent.TaskExecutionPhase)
    expect(SessionTask.Event.Updated.data.fields.tasks.value).toBe(SessionTask.Info)
  })

  it.effect("publishes the canonical notifications without adding durable Session facts", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const sessionID = SessionID.make("ses_task_events")
      const task = new SessionTask.Info({
        id: "tsk_event",
        sessionID,
        content: "Review implementation",
        status: "completed",
        priority: "high",
        outputDigest: "Result record",
        revision: 2,
        createdAt: 1,
        updatedAt: 2,
      })
      const observed = new Array<Event.Payload>()
      const unsubscribe = yield* bus.listen((event) => Effect.sync(() => observed.push(event)).pipe(Effect.asVoid))
      yield* Effect.addFinalizer(() => unsubscribe)
      const updated = yield* bus.publish(SessionTask.Event.Updated, { sessionID, tasks: [task] })
      const todo = yield* bus.publish(SessionTask.Event.TodoUpdated, {
        sessionID,
        todos: [
          new SessionTask.TodoProjection({ content: task.content, status: task.status, priority: task.priority }),
        ],
      })
      const progress = yield* bus.publish(SessionTask.Event.Progress, {
        sessionID,
        taskID: task.id,
        phase: "waiting",
        updatedAt: 2,
      })
      expect(observed).toEqual([updated, todo, progress])
      expect(Schema.encodeSync(SessionTaskEvent.Updated)(updated).data.tasks).toEqual([
        Schema.encodeSync(SessionTask.Info)(task),
      ])
      expect(Schema.encodeSync(SessionTaskEvent.TodoUpdated)(todo).data.todos).toEqual([
        { content: task.content, status: task.status, priority: task.priority },
      ])
      expect(Schema.encodeSync(SessionTaskEvent.Progress)(progress).data).toEqual({
        sessionID,
        taskID: task.id,
        phase: "waiting",
        updatedAt: 2,
      })
      expect(observed.every((event) => event.durable === undefined)).toBe(true)
      const log = yield* bus.log({ aggregateID: sessionID }).pipe(Stream.runCollect)
      expect(log.filter((event) => !Bus.isSynced(event))).toEqual([])
    }),
  )
})
