import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Session } from "@aigcfroge/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface: paths are relative to the instance API
// root (not under /api) and keep the fork's flat directory/workspace query
// fields until the R3 client replay normalizes conventions.
const root = "/workflow-asset"
const sessionRoot = "/session/:sessionID/workflow-asset"

export const WorkflowAssetListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
}).annotate({ identifier: "WorkflowAsset.ListQuery" })

export const WorkflowAssetContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
}).annotate({ identifier: "WorkflowAsset.ContentQuery" })

export const WorkflowAssetApplyPayload = Schema.Struct({
  candidate: WorkflowAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
}).annotate({ identifier: "WorkflowAsset.ApplyPayload" })

export const WorkflowAssetDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
}).annotate({ identifier: "WorkflowAsset.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(WorkflowAsset.Summary),
  invalid: Schema.Array(WorkflowAsset.InvalidEntry),
}).annotate({ identifier: "WorkflowAsset.ListResponse" })

export const WorkflowAssetGroup = HttpApiGroup.make("workflow-asset")
  .add(
    HttpApiEndpoint.get("workflow-asset.list", root, {
      query: WorkflowAssetListQuery,
      success: described(ListResponse, "List of workflow-asset assets with invalid entries"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "workflow-asset.list",
        summary: "List workflow-asset assets",
        description: "List all workflow-asset assets for the current Location, including invalid (skipped) entries.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workflow-asset.content", `${root}/content`, {
      query: WorkflowAssetContentQuery,
      success: described(WorkflowAsset.Info, "WorkflowAsset asset content"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "workflow-asset.content",
        summary: "Get workflow-asset asset content",
        description: "Get the full content of a asset by path.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workflow-asset.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: WorkflowAssetApplyPayload,
      success: described(WorkflowAsset.Info, "Applied workflow asset"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "workflow-asset.apply",
        summary: "Apply workflow-asset asset",
        description: "Apply a proposed workflow-asset asset candidate, persisting it to disk.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workflow-asset.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: WorkflowAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "workflow-asset.delete",
        summary: "Delete workflow-asset asset",
        description: "Delete a asset by relative path with baseRevision CAS.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "workflow-asset",
      description: "WorkflowAsset asset CRUD for the asset studio.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
