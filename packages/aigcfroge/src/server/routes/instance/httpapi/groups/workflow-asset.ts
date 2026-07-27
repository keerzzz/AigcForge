export * as WorkflowAssetApiGroup from "./workflow-asset"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { SessionID } from "@/session/schema"

const root = "/workflow-asset"
const sessionRoot = "/session/:sessionID/workflow-asset"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ListResponse = Schema.Struct({
  assets: Schema.Array(WorkflowAsset.Summary),
  invalid: Schema.Array(WorkflowAsset.InvalidEntry),
})

export const ContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ApplyPayload = Schema.Struct({
  candidate: Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    content: Schema.String,
  }),
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
})

export const DeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
})

export const WorkflowAssetPaths = {
  list: root,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const WorkflowAssetApi = HttpApi.make("workflow-asset").add(
  HttpApiGroup.make("workflow-asset")
    .add(
      HttpApiEndpoint.get("list", WorkflowAssetPaths.list, {
        query: ListQuery,
        success: described(ListResponse, "List of workflow assets with invalid entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "workflow-asset.list",
          summary: "List workflow assets",
          description: "List all workflow assets for the current Location, including invalid (skipped) entries.",
        }),
      ),
      HttpApiEndpoint.get("content", WorkflowAssetPaths.content, {
        query: ContentQuery,
        success: described(WorkflowAsset.Info, "Workflow asset content"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "workflow-asset.content",
          summary: "Get workflow asset content",
          description: "Get the full content of a workflow asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", WorkflowAssetPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(WorkflowAsset.Info, "Applied workflow asset"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "workflow-asset.apply",
          summary: "Apply workflow asset",
          description: "Apply a proposed workflow asset candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", WorkflowAssetPaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(Schema.Void, "Deleted"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "workflow-asset.delete",
          summary: "Delete workflow asset",
          description: "Delete a workflow asset by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
