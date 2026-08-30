export * as PluginAssetApiGroup from "./plugin-asset"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { PluginAsset as SchemaPluginAsset } from "@aigcfroge/schema/plugin-asset"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { SessionID } from "@/session/schema"

const root = "/plugin-asset"
const sessionRoot = "/session/:sessionID/plugin-asset"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ListResponse = Schema.Struct({
  assets: Schema.Array(SchemaPluginAsset.Summary),
  invalid: Schema.Array(SchemaPluginAsset.InvalidEntry),
  bridged: Schema.Array(SchemaPluginAsset.BridgeEntry),
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

export const PluginAssetPaths = {
  list: root,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const PluginAssetApi = HttpApi.make("plugin-asset").add(
  HttpApiGroup.make("plugin-asset")
    .add(
      HttpApiEndpoint.get("list", PluginAssetPaths.list, {
        query: ListQuery,
        success: described(ListResponse, "List of plugin assets with invalid entries and bridged plugins"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "plugin-asset.list",
          summary: "List plugin assets",
          description:
            "List all plugin assets for the current Location, including invalid entries and system-bridged plugins.",
        }),
      ),
      HttpApiEndpoint.get("content", PluginAssetPaths.content, {
        query: ContentQuery,
        success: described(SchemaPluginAsset.Info, "Plugin asset content"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "plugin-asset.content",
          summary: "Get plugin asset content",
          description: "Get the full content of a plugin asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", PluginAssetPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(SchemaPluginAsset.Info, "Applied plugin asset"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "plugin-asset.apply",
          summary: "Apply plugin asset",
          description: "Apply a proposed plugin asset candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", PluginAssetPaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(Schema.Void, "Deleted"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "plugin-asset.delete",
          summary: "Delete plugin asset",
          description: "Delete a plugin asset by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
