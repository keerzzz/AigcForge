import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { optional } from "@aigcfroge/schema/schema"
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
const root = "/command-asset"
const sessionRoot = "/session/:sessionID/command-asset"

export const CommandAssetListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
  scope: optional(AssetPlacement.Scope),
}).annotate({ identifier: "CommandAsset.ListQuery" })

export const CommandAssetContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  scope: optional(AssetPlacement.Scope),
}).annotate({ identifier: "CommandAsset.ContentQuery" })

export const CommandAssetInspectPayload = Schema.Struct({
  candidate: CommandAsset.Candidate,
  scope: AssetPlacement.Scope,
}).annotate({ identifier: "CommandAsset.InspectPayload" })

export const CommandAssetApplyPayload = Schema.Struct({
  candidate: CommandAsset.Candidate,
  baseRevision: optional(Schema.String),
  overwrite: Schema.Boolean,
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "CommandAsset.ApplyPayload" })

export const CommandAssetDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: optional(Schema.String),
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "CommandAsset.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(CommandAsset.Summary),
  invalid: Schema.Array(CommandAsset.InvalidEntry),
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "CommandAsset.ListResponse" })

export const CommandAssetGroup = HttpApiGroup.make("command-asset")
  .add(
    HttpApiEndpoint.get("command-asset.list", root, {
      query: CommandAssetListQuery,
      success: described(ListResponse, "List of command-asset assets with invalid entries"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "command-asset.list",
        summary: "List command-asset assets",
        description: "List Command assets for one selected owner. Omitted scope uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("command-asset.content", `${root}/content`, {
      query: CommandAssetContentQuery,
      success: described(CommandAsset.Info, "CommandAsset asset content"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "command-asset.content",
        summary: "Get command-asset asset content",
        description: "Get Command asset content from one selected owner. Omitted scope uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("command-asset.inspect", `${sessionRoot}/inspect`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: CommandAssetInspectPayload,
      success: described(CommandAsset.Inspection, "Command candidate facts and selected target"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "command-asset.inspect",
        summary: "Inspect a command-asset candidate",
        description:
          "Inspect a complete Command candidate for one selected owner without writing it or starting a model request.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("command-asset.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: CommandAssetApplyPayload,
      success: described(CommandAsset.Info, "Applied command asset"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "command-asset.apply",
        summary: "Apply command-asset asset",
        description:
          "Persist a complete Command candidate to the reviewed owner. Omitted target uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("command-asset.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: CommandAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "command-asset.delete",
        summary: "Delete command-asset asset",
        description:
          "Delete a Command asset by relative path. A selected target requires the current revision; omitted target keeps the legacy optional revision check.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("command-asset.remove", `${root}/delete`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: CommandAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "command-asset.remove",
        summary: "Delete command-asset asset at Location",
        description:
          "Delete a Command asset at the current Location or selected owner by relative path with baseRevision CAS.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "command-asset",
      description: "CommandAsset asset CRUD for the asset studio.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
