import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Session } from "@aigcfroge/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained control-plane surface (see prompt-asset.ts for the conventions).
const root = "/experimental/control-plane"

/** Lifted from the fork core MoveSession.Input: destination directory contract. */
export const MoveSessionDestination = Schema.Struct({
  directory: AbsolutePath,
}).annotate({ identifier: "MoveSession.Destination" })

export const MoveSessionPayload = Schema.Struct({
  sessionID: Session.ID,
  destination: MoveSessionDestination,
  moveChanges: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "MoveSession.Input" })

export class ApiMoveSessionError extends Schema.TaggedError<ApiMoveSessionError>()(
  "MoveSessionError",
  {
    name: Schema.Literal("MoveSessionError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const ControlPlaneGroup = HttpApiGroup.make("controlPlane")
  .add(
    HttpApiEndpoint.post("controlPlane.moveSession", `${root}/move-session`, {
      payload: MoveSessionPayload,
      success: described(HttpApiSchema.NoContent, "Session moved"),
      error: ApiMoveSessionError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.controlPlane.moveSession",
        summary: "Move session",
        description: "Move a session to another project directory, optionally transferring local changes.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "controlPlane", description: "Control-plane orchestration routes." }))
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
