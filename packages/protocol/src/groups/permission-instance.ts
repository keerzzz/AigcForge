import { PermissionV1 } from "@aigcfroge/schema/v1/permission"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, PermissionNotFoundError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Lives beside the base `server.permission` group (client name "permission").
const root = "/permission"

const ReplyPayload = Schema.Struct({
  reply: PermissionV1.Reply,
  message: Schema.optional(Schema.String),
}).annotate({ identifier: "PermissionInstance.ReplyPayload" })

export const PermissionInstanceGroup = HttpApiGroup.make("permission-instance")
  .add(
    HttpApiEndpoint.get("permission-instance.list", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(PermissionV1.Request), "List of pending permissions"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "permission.list",
        summary: "List pending permissions",
        description: "Get all pending permission requests across all sessions.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("permission-instance.reply", `${root}/:requestID/reply`, {
      params: { requestID: PermissionV1.ID },
      query: WorkspaceRoutingQuery,
      payload: ReplyPayload,
      success: described(Schema.Boolean, "Permission processed successfully"),
      error: [InvalidRequestError, PermissionNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "permission.reply",
        summary: "Respond to permission request",
        description: "Approve or deny a permission request from the AI assistant.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "permission",
      description: "Experimental HttpApi permission routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
