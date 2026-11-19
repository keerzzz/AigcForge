import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { Bus } from "@aigcfroge/core/bus"
import { Database } from "@aigcfroge/core/database/database"
import { AppNodeBuilder } from "@aigcfroge/core/effect/app-node-builder"
import { WorkflowEvent } from "@aigcfroge/core/workflow/event"
import { Event } from "@aigcfroge/schema/event"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Updated } from "@aigcfroge/schema/workflow-event"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node]), [
    Bus.node.replace(Bus.configured({ persist: true })),
  ]),
)

describe("Workflow event facade", () => {
  test("re-exports the canonical Schema update while retaining the commit helper", () => {
    expect(WorkflowEvent.Updated).toBe(Updated)
    expect(WorkflowEvent.Updated.data).toBe(Updated.data)
    expect(typeof WorkflowEvent.publish).toBe("function")
  })

  it.effect("discovers committed Workflow updates in their run-owned durable log", () =>
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      const runID = WorkflowAsset.WorkflowRunID.make("run_event_log")
      const first = yield* WorkflowEvent.publish(
        bus,
        { runID, sessionID: "session_contract", status: "pending", revision: 1, timeUpdated: 1 },
        () => Effect.succeed(true),
      )
      const second = yield* WorkflowEvent.publish(
        bus,
        {
          runID,
          sessionID: "session_contract",
          status: "running",
          revision: 2,
          currentStepId: "first",
          errorCategory: undefined,
          timeUpdated: 2,
        },
        () => Effect.succeed(true),
      )
      const recorded = yield* bus.log({ aggregateID: runID }).pipe(Stream.runCollect)
      const events = recorded.filter((event): event is Event.Payload => !Bus.isSynced(event))
      expect(
        events.map((event) => Schema.encodeSync(Updated)(Schema.decodeUnknownSync(Schema.toType(Updated))(event))),
      ).toEqual([first, second].map((event) => Schema.encodeSync(Updated)(event)))
      expect(events.map((event) => event.durable?.seq)).toEqual([Event.Seq.make(0), Event.Seq.make(1)])
      expect(recorded.at(-1)).toEqual({ type: "log.synced", aggregateID: runID, seq: Event.Seq.make(1) })
      const after = yield* bus.log({ aggregateID: runID, after: 0 }).pipe(Stream.runCollect)
      expect(after.flatMap((event) => (Bus.isSynced(event) ? [] : [event.id]))).toEqual([second.id])
      const sessionLog = yield* bus.log({ aggregateID: "session_contract" }).pipe(Stream.runCollect)
      expect(sessionLog.filter((event) => !Bus.isSynced(event))).toEqual([])
    }),
  )
})
