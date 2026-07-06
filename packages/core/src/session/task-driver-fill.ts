export * as TaskDriverFill from "./task-driver-fill"

import { Effect, Layer } from "effect"
import { BackgroundJob } from "../background-job"
import { SessionV2 } from "../session"
import { TaskDriver } from "../tool/task-driver"

/**
 * Installs a `SessionV2`-backed implementation into the {@link TaskDriver}
 * module bridge so the `task` built-in can drive child Sessions. Merge this at
 * every composition root that runs Sessions (public API, server, app runtime).
 *
 * Requires `SessionV2.Service` + `BackgroundJob.Service`. `SessionV2` is a leaf
 * here — nothing depends back on the filler — so this closes no dependency
 * cycle. This module may import `SessionV2` because it is only imported by
 * composition roots, never by the `SessionV2` construction chain.
 *
 * The child Session drain runs on a `BackgroundJob` fiber, never on the caller's
 * fiber. The caller is a `task` tool executing inside the parent Session's own
 * drain; driving the child synchronously on the parent's fiber would deadlock
 * the single-connection SQLite serializer. This mirrors V1's task tool, which
 * also settles child Sessions on a BackgroundJob fiber and only awaits the
 * result.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sessions = yield* SessionV2.Service
    const background = yield* BackgroundJob.Service
    TaskDriver.install(sessions, {
      runOffFiber: (sessionID, drain) =>
        background
          .start({ id: sessionID, type: "task", run: drain.pipe(Effect.as("")) })
          .pipe(Effect.andThen(background.wait({ id: sessionID }))),
    })
  }),
)
