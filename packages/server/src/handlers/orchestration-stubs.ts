import { ConflictError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import { Session } from "@aigcfroge/core/session"
import { SessionTask } from "@aigcfroge/core/session/task"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { SessionGoal } from "@aigcfroge/core/session/goal"
import { WorkspaceRouteContext } from "@aigcfroge/protocol/middleware/workspace-routing"
import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { Api } from "../api"
import { locationRefForRoute } from "../middleware/workspace-routing"
import { AssetLocation } from "./asset-location"

/**
 * R1b transitional stubs (orchestration surfaces): contracts are live and the
 * client is generated; handlers arrive with the R2 port (control plane, sync
 * engine, work artifacts, auth). Fail closed with kind "not_implemented";
 * deleted as the R2 slices land real implementations.
 */
const failClosed = (group: string, name: string) =>
  Effect.fail(
    new InvalidRequestError({
      message: `${group}.${name} is not implemented until the R2 orchestration port`,
      kind: "not_implemented",
    }),
  )

export const AgentTaskHandler = HttpApiBuilder.group(Api, "agent-task", (handlers) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const tasks = yield* SessionTask.Service
    return handlers.handle("agent-task.list", () =>
      Effect.gen(function* () {
        const location = locationRefForRoute(yield* WorkspaceRouteContext)
        const visible = new Set<string>(
          (yield* sessions.list({ directory: location.directory, workspaceID: location.workspaceID })).data
            .filter((session) => {
              const owner = locationRefForRoute(session.location)
              return owner.directory === location.directory && owner.workspaceID === location.workspaceID
            })
            .map((session) => session.id),
        )
        return (yield* tasks.listAll()).filter((task) => visible.has(task.sessionID))
      }),
    )
  }),
)

export const WorkArtifactHandler = HttpApiBuilder.group(Api, "work-artifact", (handlers) =>
  Effect.gen(function* () {
    const scope = yield* AssetLocation.make("Work artifact")
    return handlers.handle("work-artifact.apply", ({ params, payload }) =>
      scope.atSessionLocation(
        params.sessionID,
        Effect.gen(function* () {
          const artifacts = yield* WorkArtifact.Service
          const artifact = (yield* artifacts.apply({ ...params, ...payload })).artifact
          yield* (yield* SessionGoal.Service).observeArtifact(params.sessionID)
          return artifact
        }).pipe(
          Effect.mapError((error) =>
            error instanceof WorkArtifact.ConflictError
              ? new ConflictError({ resource: error.relativePath, message: "A file already exists at this path" })
              : new InvalidRequestError({ message: error.message }),
          ),
        ),
      ),
    )
  }),
)

export const ControlPlaneHandler = HttpApiBuilder.group(Api, "controlPlane", (handlers) =>
  handlers.handle("controlPlane.moveSession", () => failClosed("controlPlane", "moveSession")),
)

export const ControlHandler = HttpApiBuilder.group(Api, "control", (handlers) =>
  handlers
    .handle("control.authSet", () => failClosed("control", "authSet"))
    .handle("control.authRemove", () => failClosed("control", "authRemove"))
    .handle("control.log", () => failClosed("control", "log")),
)

export const SyncHandler = HttpApiBuilder.group(Api, "sync", (handlers) =>
  handlers
    .handle("sync.start", () => failClosed("sync", "start"))
    .handle("sync.replay", () => failClosed("sync", "replay"))
    .handle("sync.steal", () => failClosed("sync", "steal"))
    .handle("sync.history", () => failClosed("sync", "history")),
)
