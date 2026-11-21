import { MCPAsset } from "@aigcfroge/schema/mcp-asset"
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
const root = "/mcp-asset"
const sessionRoot = "/session/:sessionID/mcp-asset"

export const McpAssetListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
}).annotate({ identifier: "McpAsset.ListQuery" })

export const McpAssetContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
}).annotate({ identifier: "McpAsset.ContentQuery" })

export const McpAssetApplyPayload = Schema.Struct({
  candidate: MCPAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
}).annotate({ identifier: "McpAsset.ApplyPayload" })

export const McpAssetDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
}).annotate({ identifier: "McpAsset.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(MCPAsset.Summary),
  invalid: Schema.Array(MCPAsset.InvalidEntry),
}).annotate({ identifier: "McpAsset.ListResponse" })

export const McpAssetGroup = HttpApiGroup.make("mcp-asset")
  .add(
    HttpApiEndpoint.get("mcp-asset.list", root, {
      query: McpAssetListQuery,
      success: described(ListResponse, "List of mcp-asset assets with invalid entries"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp-asset.list",
        summary: "List mcp-asset assets",
        description: "List all mcp-asset assets for the current Location, including invalid (skipped) entries.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("mcp-asset.content", `${root}/content`, {
      query: McpAssetContentQuery,
      success: described(MCPAsset.Info, "McpAsset asset content"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp-asset.content",
        summary: "Get mcp-asset asset content",
        description: "Get the full content of a asset by path.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-asset.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: McpAssetApplyPayload,
      success: described(MCPAsset.Info, "Applied MCP asset"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp-asset.apply",
        summary: "Apply mcp-asset asset",
        description: "Apply a proposed mcp-asset asset candidate, persisting it to disk.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-asset.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: McpAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp-asset.delete",
        summary: "Delete mcp-asset asset",
        description: "Delete a asset by relative path with baseRevision CAS.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-asset.remove", `${root}/delete`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: McpAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp-asset.remove",
        summary: "Delete mcp-asset asset at Location",
        description: "Delete an MCP asset at the current Location by relative path with baseRevision CAS.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "mcp-asset",
      description: "McpAsset asset CRUD for the asset studio.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
