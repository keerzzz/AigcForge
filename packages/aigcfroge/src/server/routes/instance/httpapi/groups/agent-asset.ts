export * as AgentAssetApiGroup from "./agent-asset"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

const root = "/agent-asset"
const sessionRoot = "/session/:sessionID/agent-asset"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ListResponse = Schema.Struct({
  assets: Schema.Array(AgentAsset.Summary),
  invalid: Schema.Array(AgentAsset.InvalidEntry),
})

export const ContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ApplyPayload = Schema.Struct({
  candidate: AgentAsset.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
})

export const DeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
})

export const AgentAssetPaths = {
  list: root,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const AgentAssetApi = HttpApi.make("agent-asset").add(
  HttpApiGroup.make("agent-asset")
    .add(
      HttpApiEndpoint.get("list", AgentAssetPaths.list, {
        query: ListQuery,
        success: described(ListResponse, "List of agent assets with invalid entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "agent-asset.list",
          summary: "List agent assets",
          description: "List all agent assets for the current Location, including invalid (skipped) entries.",
        }),
      ),
      HttpApiEndpoint.get("content", AgentAssetPaths.content, {
        query: ContentQuery,
        success: described(AgentAsset.Info, "Agent asset content"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "agent-asset.content",
          summary: "Get agent asset content",
          description: "Get the full content of an agent asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", AgentAssetPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(AgentAsset.Info, "Applied agent asset"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "agent-asset.apply",
          summary: "Apply agent asset",
          description: "Apply a proposed agent asset candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", AgentAssetPaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(Schema.Void, "Deleted"),
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "agent-asset.delete",
          summary: "Delete agent asset",
          description: "Delete an agent asset by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
