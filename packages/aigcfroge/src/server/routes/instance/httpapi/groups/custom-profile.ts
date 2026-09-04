export * as CustomProfileApiGroup from "./custom-profile"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { ApiNotFoundError, ConflictError, InvalidRequestError, UnknownError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

const root = "/custom-profile"
const sessionRoot = "/session/:sessionID/custom-profile"

export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
})

export const ListResponse = Schema.Struct({
  assets: Schema.Array(CustomProfile.Summary),
  invalid: Schema.Array(CustomProfile.InvalidEntry),
})

export const ContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ApplyPayload = Schema.Struct({
  candidate: CustomProfile.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
})

export const DeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
})

export const CustomProfilePaths = {
  list: root,
  content: `${root}/content`,
  apply: `${sessionRoot}/apply`,
  delete: `${sessionRoot}/delete`,
} as const

export const CustomProfileApi = HttpApi.make("custom-profile").add(
  HttpApiGroup.make("custom-profile")
    .add(
      HttpApiEndpoint.get("list", CustomProfilePaths.list, {
        query: ListQuery,
        success: described(ListResponse, "List of custom profile assets with invalid entries"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-profile.list",
          summary: "List custom profiles",
          description: "List all custom profile assets for the current Location, including invalid (skipped) entries.",
        }),
      ),
      HttpApiEndpoint.get("content", CustomProfilePaths.content, {
        query: ContentQuery,
        success: described(CustomProfile.Info, "Custom profile content"),
        error: [InvalidRequestError, ApiNotFoundError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-profile.content",
          summary: "Get custom profile content",
          description: "Get the full content of a custom profile asset by path.",
        }),
      ),
      HttpApiEndpoint.post("apply", CustomProfilePaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(CustomProfile.Info, "Applied custom profile"),
        error: [InvalidRequestError, ConflictError, UnknownError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-profile.apply",
          summary: "Apply custom profile",
          description: "Apply a proposed custom profile candidate, persisting it to disk.",
        }),
      ),
      HttpApiEndpoint.post("delete", CustomProfilePaths.delete, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: DeletePayload,
        success: described(CustomProfile.DeleteResult, "Delete result with referencing profiles"),
        error: [InvalidRequestError, ConflictError, ApiNotFoundError, UnknownError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-profile.delete",
          summary: "Delete custom profile",
          description: "Delete a custom profile by relative path with baseRevision CAS.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
