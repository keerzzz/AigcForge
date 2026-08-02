export * as ScheduledJobExecutor from "./scheduled-job-executor"

import { Effect, Layer } from "effect"
import { AgentV2 } from "../agent"
import { LayerNode } from "../effect/layer-node"
import { TaskDriver } from "../tool/task-driver"
import { ScheduledJob } from "./scheduled-job"

/**
 * Production {@link ScheduledJob.ScheduledExecutor} (M3b): creates an unattended
 * child Session under the task's owning Session through the TaskDriver process
 * seam and drives the task prompt through it. `attended: false` keeps the child
 * on the deny-by-default permission profile (`PermissionV2.configured` auto-denies
 * asks for unattended children), so a scheduled job can never block on a prompt.
 *
 * The runner settles the owning task itself, so `delegate` is called WITHOUT
 * `taskID`/`onSettle` — passing them would double-patch the task row.
 *
 * Every failure mode maps to a `ScheduledResult` instead of the error channel
 * (`E = never`): a {@link TaskDriver.DelegateError} classifies by reason, and
 * defects (TaskDriver seam not installed in this process, infrastructure faults
 * that `orDie` inside the seam) settle the task failed. Interruption is left
 * alone so a draining runtime can still shut down.
 *
 * The module is imported by `scheduled-job.ts` for the LayerNode graph while
 * importing the `ScheduledExecutor` tag back from it, so the layer body is
 * suspended to keep the class dereference out of cyclic module evaluation.
 */
export const layer = Layer.suspend(() =>
  Layer.succeed(ScheduledJob.ScheduledExecutor, {
    run: (input) =>
      Effect.gen(function* () {
        const child = yield* TaskDriver.createChild({
          parentID: input.parentID,
          ...(input.agent ? { agent: AgentV2.ID.make(input.agent) } : {}),
          attended: false,
        })
        yield* TaskDriver.delegate({
          sessionID: child.id,
          parentID: input.parentID,
          prompt: input.prompt,
        })
        return { outcome: "completed", childSessionID: child.id } satisfies ScheduledJob.ScheduledResult
      }).pipe(
        Effect.catchTag("TaskDriver.DelegateError", (error) =>
          Effect.succeed({
            outcome: error.reason === "cancelled" ? "cancelled" : "failed",
          } satisfies ScheduledJob.ScheduledResult),
        ),
        Effect.catchDefect((defect) =>
          Effect.logError("Scheduled job executor infrastructure failure", defect).pipe(
            Effect.as({ outcome: "failed" } satisfies ScheduledJob.ScheduledResult),
          ),
        ),
      ),
  }),
)

// The seam is a process-global cell read at call time, so the layer itself has
// no Layer requirements; the composition root installs TaskDriver separately.
export const node = LayerNode.make(layer, [])
