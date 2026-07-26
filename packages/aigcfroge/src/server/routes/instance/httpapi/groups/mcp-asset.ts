export * as MCPAssetApiGroup from "./mcp-asset"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { MCPAsset } from "@aigcfroge/schema/mcp-asset"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

const root = "/mcp-asset"
const sessionRoot = "/session/:sessionID/mcp-asset"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ListResponse = Schema.Struct({
  assets: Schema.Array(MCPAsset.Summary),
  invalid: Schema.Array(MCPAsset.InvalidEntry),
})

export const ContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ApplyPayload = Schema.Struct({
  candidate: MCPAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
})

export const DeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
})

export const MCPAssetPaths = {
  list: root,
  listSystem: `${root}/system`,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const MCPAssetApi = HttpApi.make("mcp-asset").add(
  HttpApiGroup.make("mcp-asset")
    .add(
      HttpApiEndpoint.get("list", MCPAssetPaths.list, {
        query: ListQuery,
        success: described(ListResponse, "List of mcp assets with invalid entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mcp-asset.list",
          summary: "List mcp assets",
          description: "List all mcp assets for the current Location, including invalid (skipped) entries.",
        }),
      ),
      HttpApiEndpoint.get("listSystem", MCPAssetPaths.listSystem, {
        success: described(Schema.Array(MCPAsset.Summary), "System MCP assets"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mcp-asset.listSystem",
          summary: "List system MCP assets",
          description: "List MCP assets discovered from system config files (.config/Code/User/mcp.json, etc.).",
        }),
      ),
      HttpApiEndpoint.get("content", MCPAssetPaths.content, {
        query: ContentQuery,
        success: described(MCPAsset.Info, "MCP asset content"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mcp-asset.content",
          summary: "Get mcp asset content",
          description: "Get the full content of a mcp asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", MCPAssetPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(MCPAsset.Info, "Applied mcp asset"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mcp-asset.apply",
          summary: "Apply mcp asset",
          description: "Apply a proposed mcp asset candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", MCPAssetPaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(Schema.Void, "Deleted"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "mcp-asset.delete",
          summary: "Delete mcp asset",
          description: "Delete a mcp asset by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
