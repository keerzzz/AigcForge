import { SkillAsset } from "@omnixa/schema/skill-asset"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { optional } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface: paths are relative to the instance API
// root (not under /api) and keep the fork's flat directory/workspace query
// fields until the R3 client replay normalizes conventions.
const root = "/skill-asset"
const sessionRoot = "/session/:sessionID/skill-asset"

export const SkillAssetListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
  scope: optional(AssetPlacement.Scope),
}).annotate({ identifier: "SkillAsset.ListQuery" })

export const SkillAssetContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  scope: optional(AssetPlacement.Scope),
}).annotate({ identifier: "SkillAsset.ContentQuery" })

export const SkillAssetInspectPayload = Schema.Struct({
  candidate: SkillAsset.Candidate,
  scope: AssetPlacement.Scope,
}).annotate({ identifier: "SkillAsset.InspectPayload" })

export const SkillAssetApplyPayload = Schema.Struct({
  candidate: SkillAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "SkillAsset.ApplyPayload" })

export const SkillAssetDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "SkillAsset.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(SkillAsset.Summary),
  invalid: Schema.Array(SkillAsset.InvalidEntry),
  target: optional(AssetPlacement.Target),
}).annotate({ identifier: "SkillAsset.ListResponse" })

export const SkillAssetGroup = HttpApiGroup.make("skill-asset")
  .add(
    HttpApiEndpoint.get("skill-asset.list", root, {
      query: SkillAssetListQuery,
      success: described(ListResponse, "List of skill-asset assets with invalid entries"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "skill-asset.list",
        summary: "List skill-asset assets",
        description: "List Skill assets for one selected owner. Omitted scope uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("skill-asset.content", `${root}/content`, {
      query: SkillAssetContentQuery,
      success: described(SkillAsset.Info, "SkillAsset asset content"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "skill-asset.content",
        summary: "Get skill-asset asset content",
        description: "Get Skill asset content from one selected owner. Omitted scope uses the current Location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("skill-asset.inspect", `${sessionRoot}/inspect`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: SkillAssetInspectPayload,
      success: described(SkillAsset.Inspection, "Skill candidate facts and selected target"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "skill-asset.inspect",
        summary: "Inspect a skill-asset candidate",
        description:
          "Inspect a complete Skill candidate for one selected owner without writing it or starting a model request.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("skill-asset.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: SkillAssetApplyPayload,
      success: described(SkillAsset.Info, "Applied skill asset"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "skill-asset.apply",
        summary: "Apply skill-asset asset",
        description: "Apply a proposed skill-asset asset candidate, persisting it to disk.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("skill-asset.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: SkillAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "skill-asset.delete",
        summary: "Delete skill-asset asset",
        description: "Delete a asset by relative path with baseRevision CAS.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("skill-asset.remove", `${root}/delete`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: SkillAssetDeletePayload,
      success: described(Schema.Void, "Deleted"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "skill-asset.remove",
        summary: "Delete skill-asset asset at Location",
        description:
          "Delete a skill asset at the current Location or selected owner by relative path with baseRevision CAS.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "skill-asset",
      description: "SkillAsset asset CRUD for the asset studio.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
