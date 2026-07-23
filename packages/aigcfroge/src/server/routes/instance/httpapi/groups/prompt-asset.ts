export * as PromptAssetApiGroup from "./prompt-asset"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

const root = "/prompt-asset"
const sessionRoot = "/session/:sessionID/prompt-asset"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ApplyPayload = Schema.Struct({
  candidate: PromptAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
})

export const DeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
})

export const PromptAssetPaths = {
  list: root,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const PromptAssetApi = HttpApi.make("prompt-asset").add(
  HttpApiGroup.make("prompt-asset")
    .add(
      HttpApiEndpoint.get("list", PromptAssetPaths.list, {
        query: ListQuery,
        success: described(Schema.Array(PromptAsset.Summary), "List of prompt assets"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "prompt-asset.list",
          summary: "List prompt assets",
          description: "List all prompt assets for the current Location.",
        }),
      ),
      HttpApiEndpoint.get("content", PromptAssetPaths.content, {
        query: ContentQuery,
        success: described(PromptAsset.Info, "Prompt asset content"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "prompt-asset.content",
          summary: "Get prompt asset content",
          description: "Get the full content of a prompt asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", PromptAssetPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(PromptAsset.Info, "Applied prompt asset"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "prompt-asset.apply",
          summary: "Apply prompt asset",
          description: "Apply a proposed prompt asset candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", PromptAssetPaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(Schema.Void, "Deleted"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "prompt-asset.delete",
          summary: "Delete prompt asset",
          description: "Delete a prompt asset by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
