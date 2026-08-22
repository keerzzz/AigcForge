import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { SessionV2 } from "@aigcfroge/core/session"
import { WorkflowExecution } from "@aigcfroge/core/workflow/workflow-execution"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const sessionID = SessionV2.ID.make("ses_workflow_execution")
const runID = WorkflowAsset.WorkflowRunID.make("wfr_workflow_execution")

const run = new WorkflowAsset.WorkflowRunInfo({
  id: runID,
  sessionID,
  snapshotDigest: "snapshot",
  workflowName: "workflow",
  workflowRevision: "revision",
  status: "pending",
  revision: 1,
  timeCreated: 1,
  timeUpdated: 1,
})

describe("WorkflowExecution", () => {
  it.effect("admits before scheduling the asynchronous owner", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const drained = yield* Deferred.make<void>()
        const execution = yield* WorkflowExecution.make({
          admit: () => Effect.succeed(run),
          drain: () => Deferred.succeed(drained, undefined),
        })

        expect(yield* execution.submit(sessionID)).toBe(run)
        yield* Deferred.await(drained)
      }),
    ),
  )

  it.effect("coalesces repeated wakeups for one Session", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const firstStarted = yield* Deferred.make<void>()
        const firstGate = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        let drains = 0
        const execution = yield* WorkflowExecution.make({
          admit: () => Effect.succeed(run),
          drain: () =>
            Effect.sync(() => ++drains).pipe(
              Effect.flatMap((current) =>
                current === 1
                  ? Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(firstGate)))
                  : Deferred.succeed(secondStarted, undefined),
              ),
            ),
        })

        yield* execution.wake(sessionID)
        yield* Deferred.await(firstStarted)
        yield* Effect.all([execution.wake(sessionID), execution.wake(sessionID), execution.wake(sessionID)], {
          concurrency: "unbounded",
        })
        yield* Deferred.succeed(firstGate, undefined)
        yield* Deferred.await(secondStarted)

        expect(drains).toBe(2)
      }),
    ),
  )

  it.effect("interrupt waits for owner cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const cleanup = yield* Deferred.make<void>()
        const execution = yield* WorkflowExecution.make({
          admit: () => Effect.succeed(run),
          drain: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(cleanup, undefined)),
            ),
        })

        yield* execution.wake(sessionID)
        yield* Deferred.await(started)
        const interrupted = yield* execution.interrupt(sessionID).pipe(Effect.forkChild)
        yield* Deferred.await(cleanup)
        yield* Fiber.join(interrupted)
        expect(yield* execution.isActive(sessionID)).toBe(false)
      }),
    ),
  )
})
