import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import { Session } from "@aigcfroge/schema/session"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ApiNotFoundError, ConflictError, InvalidRequestError, UnknownError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
const root = "/custom-profile"
const sessionRoot = "/session/:sessionID/custom-profile"

export const CustomProfileListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  search: Schema.optional(Schema.String),
}).annotate({ identifier: "CustomProfile.ListQuery" })

export const CustomProfileContentQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
}).annotate({ identifier: "CustomProfile.ContentQuery" })

export const CustomProfileApplyPayload = Schema.Struct({
  candidate: CustomProfile.Candidate,
  baseRevision: Schema.optional(Schema.String),
  overwrite: Schema.Boolean,
}).annotate({ identifier: "CustomProfile.ApplyPayload" })

export const CustomProfileDeletePayload = Schema.Struct({
  relativePath: Schema.String,
  baseRevision: Schema.optional(Schema.String),
}).annotate({ identifier: "CustomProfile.DeletePayload" })

const ListResponse = Schema.Struct({
  assets: Schema.Array(CustomProfile.Summary),
  invalid: Schema.Array(CustomProfile.InvalidEntry),
}).annotate({ identifier: "CustomProfile.ListResponse" })

export const CustomProfileGroup = HttpApiGroup.make("custom-profile")
  .add(
    HttpApiEndpoint.get("custom-profile.list", root, {
      query: CustomProfileListQuery,
      success: described(ListResponse, "List of custom profile assets with invalid entries"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "custom-profile.list",
        summary: "List custom profiles",
        description: "List all custom profile assets for the current Location, including invalid (skipped) entries.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("custom-profile.content", `${root}/content`, {
      query: CustomProfileContentQuery,
      success: described(CustomProfile.Info, "Custom profile content"),
      error: [InvalidRequestError, ApiNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "custom-profile.content",
        summary: "Get custom profile content",
        description: "Get the full content of a custom profile asset by path.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("custom-profile.apply", `${root}/apply`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: CustomProfileApplyPayload,
      success: described(CustomProfile.Info, "Saved custom profile"),
      error: [InvalidRequestError, ConflictError, UnknownError],
    })
      .annotate(HttpApi.PayloadParseOptions, { onExcessProperty: "error", errors: "all" })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "custom-profile.apply",
          summary: "Save custom profile",
          description: "Save a proposed custom profile candidate at the current Location without creating a Session.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("custom-profile.delete", `${sessionRoot}/delete`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: CustomProfileDeletePayload,
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
  .add(
    HttpApiEndpoint.post("custom-profile.remove", `${root}/delete`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: CustomProfileDeletePayload,
      success: described(CustomProfile.DeleteResult, "Delete result with referencing profiles"),
      error: [InvalidRequestError, ConflictError, ApiNotFoundError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "custom-profile.remove",
        summary: "Delete custom profile at Location",
        description:
          "Delete a custom profile at the current Location by relative path with baseRevision CAS without requiring a Session.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "custom-profile",
      description: "Custom profile CRUD for the composition platform.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
