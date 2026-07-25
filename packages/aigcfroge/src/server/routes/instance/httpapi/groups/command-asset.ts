export * as CommandAssetApiGroup from "./command-asset"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

const root = "/command-asset"
const sessionRoot = "/session/:sessionID/command-asset"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ListResponse = Schema.Struct({
  assets: Schema.Array(CommandAsset.Summary),
  invalid: Schema.Array(CommandAsset.InvalidEntry),
})

export const ContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ApplyPayload = Schema.Struct({
  candidate: CommandAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
})

export const DeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
})

export const CommandAssetPaths = {
  list: root,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const CommandAssetApi = HttpApi.make("command-asset").add(
  HttpApiGroup.make("command-asset")
    .add(
      HttpApiEndpoint.get("list", CommandAssetPaths.list, {
        query: ListQuery,
        success: described(ListResponse, "List of command assets with invalid entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "command-asset.list",
          summary: "List command assets",
          description: "List all command assets for the current Location, including invalid (skipped) entries.",
        }),
      ),
      HttpApiEndpoint.get("content", CommandAssetPaths.content, {
        query: ContentQuery,
        success: described(CommandAsset.Info, "Command asset content"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "command-asset.content",
          summary: "Get command asset content",
          description: "Get the full content of a command asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", CommandAssetPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(CommandAsset.Info, "Applied command asset"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "command-asset.apply",
          summary: "Apply command asset",
          description: "Apply a proposed command asset candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", CommandAssetPaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(Schema.Void, "Deleted"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "command-asset.delete",
          summary: "Delete command asset",
          description: "Delete a command asset by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
