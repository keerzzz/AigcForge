import { PluginAsset } from "@omnixa/schema/plugin-asset"
import { Session } from "@omnixa/schema/session"
import { optional } from "@omnixa/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface: paths are relative to the instance API
// root (not under /api) and keep the fork's flat directory/workspace query
// fields until the R3 client replay normalizes conventions.
const root = "/plugin-asset"
const sessionRoot = "/session/:sessionID/plugin-asset"

export const PluginAssetListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
}).annotate({ identifier: "PluginAsset.ListQuery" })

export const PluginAssetContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
}).annotate({ identifier: "PluginAsset.ContentQuery" })

export const PluginAssetApplyPayload = Schema.Struct({
  candidate: PluginAsset.Candidate,
  baseRevision: optional(Schema.String),
  overwrite: Schema.Boolean,
}).annotate({ identifier: "PluginAsset.ApplyPayload" })

export const PluginAssetDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: optional(Schema.String),
}).annotate({ identifier: "PluginAsset.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(PluginAsset.Summary),
  invalid: Schema.Array(PluginAsset.InvalidEntry),
  bridged: Schema.Array(PluginAsset.BridgeEntry),
}).annotate({ identifier: "PluginAsset.ListResponse" })

export const PluginAssetGroup = HttpApiGroup.make("plugin-asset")
  .add(
    HttpApiEndpoint.get("plugin-asset.list", root, {
      query: PluginAssetListQuery,
      success: described(ListResponse, "List of plugin-asset assets with invalid entries"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "plugin-asset.list",
        summary: "List plugin-asset assets",
        description: "List all plugin-asset assets for the current Location, including invalid (skipped) entries.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("plugin-asset.content", `${root}/content`, {
      query: PluginAssetContentQuery,
      success: described(PluginAsset.Info, "PluginAsset asset content"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "plugin-asset.content",
        summary: "Get plugin-asset asset content",
        description: "Get the full content of a asset by path.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("plugin-asset.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: PluginAssetApplyPayload,
      success: described(PluginAsset.Info, "Applied plugin asset"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "plugin-asset.apply",
        summary: "Apply plugin-asset asset",
        description: "Apply a proposed plugin-asset asset candidate, persisting it to disk.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("plugin-asset.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: PluginAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "plugin-asset.delete",
        summary: "Delete plugin-asset asset",
        description: "Delete a asset by relative path with baseRevision CAS.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("plugin-asset.remove", `${root}/delete`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: PluginAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "plugin-asset.remove",
        summary: "Delete plugin-asset asset at Location",
        description: "Delete a plugin asset at the current Location by relative path with baseRevision CAS.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "plugin-asset",
      description: "PluginAsset asset CRUD for the asset studio.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
