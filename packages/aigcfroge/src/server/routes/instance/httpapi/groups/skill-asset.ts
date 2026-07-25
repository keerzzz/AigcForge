export * as SkillAssetApiGroup from "./skill-asset"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { SkillAsset } from "@aigcfroge/schema/skill-asset"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

const root = "/skill-asset"
const sessionRoot = "/session/:sessionID/skill-asset"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ListResponse = Schema.Struct({
  assets: Schema.Array(SkillAsset.Summary),
  invalid: Schema.Array(SkillAsset.InvalidEntry),
})

export const ContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ApplyPayload = Schema.Struct({
  candidate: SkillAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
})

export const DeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
})

export const SkillAssetPaths = {
  list: root,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const SkillAssetApi = HttpApi.make("skill-asset").add(
  HttpApiGroup.make("skill-asset")
    .add(
      HttpApiEndpoint.get("list", SkillAssetPaths.list, {
        query: ListQuery,
        success: described(ListResponse, "List of skill assets with invalid entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "skill-asset.list",
          summary: "List skill assets",
          description: "List all skill assets for the current Location, including invalid (skipped) entries.",
        }),
      ),
      HttpApiEndpoint.get("content", SkillAssetPaths.content, {
        query: ContentQuery,
        success: described(SkillAsset.Info, "Skill asset content"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "skill-asset.content",
          summary: "Get skill asset content",
          description: "Get the full content of a skill asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", SkillAssetPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(SkillAsset.Info, "Applied skill asset"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "skill-asset.apply",
          summary: "Apply skill asset",
          description: "Apply a proposed skill asset candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", SkillAssetPaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(Schema.Void, "Deleted"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "skill-asset.delete",
          summary: "Delete skill asset",
          description: "Delete a skill asset by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
