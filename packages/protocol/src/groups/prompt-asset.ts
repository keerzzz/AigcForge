import { AssetPlacement } from "@aigcfroge/schema/asset-placement"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
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
const root = "/prompt-asset"
const sessionRoot = "/session/:sessionID/prompt-asset"

export const PromptAssetListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
  scope: optional(AssetPlacement.Scope),
}).annotate({ identifier: "PromptAsset.ListQuery" })

export const PromptAssetContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  scope: optional(AssetPlacement.Scope),
}).annotate({ identifier: "PromptAsset.ContentQuery" })

export const PromptAssetInspectPayload = Schema.Struct({
  candidate: PromptAsset.Candidate,
  scope: AssetPlacement.Scope,
}).annotate({ identifier: "PromptAsset.InspectPayload" })

// Keep the legacy revision codec: an omitted Effect client revision encodes as JSON null.
export const PromptAssetApplyPayload = Schema.Struct({
  candidate: PromptAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "PromptAsset.ApplyPayload" })

export const PromptAssetDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "PromptAsset.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(PromptAsset.Summary),
  invalid: Schema.Array(PromptAsset.InvalidEntry),
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "PromptAsset.ListResponse" })

export const PromptAssetGroup = HttpApiGroup.make("prompt-asset")
  .add(
    HttpApiEndpoint.get("prompt-asset.list", root, {
      query: PromptAssetListQuery,
      success: described(ListResponse, "List of prompt assets with invalid entries"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "prompt-asset.list",
        summary: "List prompt assets",
        description: "List Prompt assets for one selected owner. Omitted scope uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("prompt-asset.content", `${root}/content`, {
      query: PromptAssetContentQuery,
      success: described(PromptAsset.Info, "Prompt asset content"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "prompt-asset.content",
        summary: "Get prompt asset content",
        description: "Get Prompt asset content from one selected owner. Omitted scope uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("prompt-asset.inspect", `${sessionRoot}/inspect`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: PromptAssetInspectPayload,
      success: described(PromptAsset.Inspection, "Prompt candidate facts and selected target"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "prompt-asset.inspect",
        summary: "Inspect a prompt asset candidate",
        description:
          "Inspect a complete Prompt candidate for one selected owner without writing it or starting a model request.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("prompt-asset.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: PromptAssetApplyPayload,
      success: described(PromptAsset.Info, "Applied prompt asset"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "prompt-asset.apply",
        summary: "Apply prompt asset",
        description:
          "Persist a complete Prompt candidate to the reviewed owner. Omitted target uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("prompt-asset.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: PromptAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "prompt-asset.delete",
        summary: "Delete prompt asset",
        description:
          "Delete a Prompt asset by relative path. Selected existing files require the current revision; omitted target keeps the legacy optional revision check.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("prompt-asset.remove", `${root}/delete`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: PromptAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "prompt-asset.remove",
        summary: "Delete prompt asset at Location",
        description:
          "Delete a Prompt asset at the current Location or selected owner by relative path with baseRevision CAS.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "prompt-asset",
      description: "Prompt asset CRUD for the asset studio.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
