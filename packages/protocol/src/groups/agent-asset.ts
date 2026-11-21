import { AgentAsset } from "@aigcfroge/schema/agent-asset"
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
const root = "/agent-asset"
const sessionRoot = "/session/:sessionID/agent-asset"

export const AgentAssetListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
}).annotate({ identifier: "AgentAsset.ListQuery" })

export const AgentAssetContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
}).annotate({ identifier: "AgentAsset.ContentQuery" })

export const AgentAssetApplyPayload = Schema.Struct({
  candidate: AgentAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
}).annotate({ identifier: "AgentAsset.ApplyPayload" })

export const AgentAssetDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
}).annotate({ identifier: "AgentAsset.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(AgentAsset.Summary),
  invalid: Schema.Array(AgentAsset.InvalidEntry),
}).annotate({ identifier: "AgentAsset.ListResponse" })

export const AgentAssetGroup = HttpApiGroup.make("agent-asset")
  .add(
    HttpApiEndpoint.get("agent-asset.list", root, {
      query: AgentAssetListQuery,
      success: described(ListResponse, "List of agent-asset assets with invalid entries"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "agent-asset.list",
        summary: "List agent-asset assets",
        description: "List all agent-asset assets for the current Location, including invalid (skipped) entries.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("agent-asset.content", `${root}/content`, {
      query: AgentAssetContentQuery,
      success: described(AgentAsset.Info, "AgentAsset asset content"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "agent-asset.content",
        summary: "Get agent-asset asset content",
        description: "Get the full content of an asset by path.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("agent-asset.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: AgentAssetApplyPayload,
      success: described(AgentAsset.ApplyResult, "Applied agent asset with import warnings"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "agent-asset.apply",
        summary: "Apply agent-asset asset",
        description: "Apply a proposed agent-asset asset candidate, persisting it to disk.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("agent-asset.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: AgentAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "agent-asset.delete",
        summary: "Delete agent-asset asset",
        description: "Delete an asset by relative path with baseRevision CAS.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("agent-asset.remove", `${root}/delete`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: AgentAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "agent-asset.remove",
        summary: "Delete agent-asset asset at Location",
        description: "Delete an agent asset at the current Location by relative path with baseRevision CAS.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "agent-asset",
      description: "AgentAsset asset CRUD for the asset studio.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
