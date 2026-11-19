import { Project } from "@aigcfroge/schema/project"
import { Session } from "@aigcfroge/schema/session"
import { Workspace } from "@aigcfroge/schema/workspace"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ApiNotFoundError, ApiVcsApplyError, InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
const root = "/experimental/workspace"

/**
 * Lifted from the fork entry control-plane types: workspace record with the
 * `timeUsed` runtime field appended.
 */
export const WorkspaceInstanceInfo = Schema.Struct({
  id: Workspace.ID,
  type: Schema.String,
  name: Schema.String,
  branch: Schema.optional(Schema.NullOr(Schema.String)),
  directory: Schema.optional(Schema.NullOr(Schema.String)),
  extra: Schema.optional(Schema.NullOr(Schema.Unknown)),
  projectID: Project.ID,
  timeUsed: Schema.Number,
}).annotate({ identifier: "WorkspaceInstance.Info" })

export const WorkspaceConnectionStatus = Schema.Struct({
  workspaceID: Workspace.ID,
  status: Schema.Literals(["connected", "connecting", "disconnected", "error"]),
}).annotate({ identifier: "WorkspaceInstance.ConnectionStatus" })

export const WorkspaceAdapterEntry = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  description: Schema.String,
}).annotate({ identifier: "WorkspaceInstance.AdapterEntry" })

export const WorkspaceCreatePayload = Schema.Struct({
  id: Schema.optional(Workspace.ID),
  type: Schema.String,
  branch: Schema.optional(Schema.NullOr(Schema.String)),
  extra: Schema.optional(Schema.NullOr(Schema.Unknown)),
}).annotate({ identifier: "WorkspaceInstance.CreatePayload" })

export const WorkspaceWarpPayload = Schema.Struct({
  id: Schema.NullOr(Workspace.ID),
  sessionID: Session.ID,
  copyChanges: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "WorkspaceInstance.WarpPayload" })

export class ApiWorkspaceWarpError extends Schema.TaggedError<ApiWorkspaceWarpError>()(
  "WorkspaceWarpError",
  {
    name: Schema.Literal("WorkspaceWarpError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export class ApiWorkspaceCreateError extends Schema.TaggedError<ApiWorkspaceCreateError>()(
  "WorkspaceCreateError",
  {
    name: Schema.Literal("WorkspaceCreateError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 400 },
) {}

export const WorkspaceInstanceGroup = HttpApiGroup.make("workspace-instance")
  .add(
    HttpApiEndpoint.get("workspace-instance.adapters", `${root}/adapter`, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(WorkspaceAdapterEntry), "Workspace adapters"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.workspace.adapter.list",
        summary: "List workspace adapters",
        description: "List all available workspace adapters for the current project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace-instance.list", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(WorkspaceInstanceInfo), "Workspaces"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.workspace.list",
        summary: "List workspaces",
        description: "List all workspaces.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace-instance.create", root, {
      query: WorkspaceRoutingQuery,
      payload: WorkspaceCreatePayload,
      success: described(WorkspaceInstanceInfo, "Workspace created"),
      error: [ApiWorkspaceCreateError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.workspace.create",
        summary: "Create workspace",
        description: "Create a workspace for the current project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace-instance.syncList", `${root}/sync-list`, {
      query: WorkspaceRoutingQuery,
      success: described(HttpApiSchema.NoContent, "Workspace list synced"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.workspace.syncList",
        summary: "Sync workspace list",
        description: "Register missing workspaces returned by workspace adapters.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workspace-instance.status", `${root}/status`, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(WorkspaceConnectionStatus), "Workspace status"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.workspace.status",
        summary: "Workspace status",
        description: "Get connection status for workspaces in the current project.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("workspace-instance.remove", `${root}/:id`, {
      params: { id: Workspace.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.UndefinedOr(WorkspaceInstanceInfo), "Workspace removed"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.workspace.remove",
        summary: "Remove workspace",
        description: "Remove an existing workspace.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workspace-instance.warp", `${root}/warp`, {
      query: WorkspaceRoutingQuery,
      payload: WorkspaceWarpPayload,
      success: described(HttpApiSchema.NoContent, "Session warped"),
      error: [ApiWorkspaceWarpError, ApiVcsApplyError, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.workspace.warp",
        summary: "Warp session into workspace",
        description: "Move a session's sync history into the target workspace, or detach it to the local project.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "workspace", description: "Experimental HttpApi workspace routes." }))
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
