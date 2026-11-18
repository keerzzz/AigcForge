import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { Permission } from "@aigcfroge/schema/permission"
import { Session } from "@aigcfroge/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, GrantNotFoundError, PermissionNotFoundError, SessionNotFoundError } from "../errors.js"
import { described } from "./metadata.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const GrantLevel = Schema.Literals(["session", "location"])

// Fork-retained scoped-grant surface (see question.ts for the conventions).
export const GrantGroup = HttpApiGroup.make("server.grant")
  .add(
    HttpApiEndpoint.get("grant.list", "/permission/grant", {
      query: LocationQuery,
      success: described(Schema.Array(McpScope.ScopedGrantInfo), "List of scoped grants"),
    }).annotateMerge(locationQueryOpenApi)
      .annotateMerge(
      OpenApi.annotations({
        identifier: "permission.grant.list",
        summary: "List scoped grants",
        description: "Retrieve scoped grant history for a location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("grant.revoke", "/permission/grant/:grantID", {
      params: { grantID: McpScope.ScopedGrant.fields.id },
      query: LocationQuery,
      payload: Schema.Struct({ expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)) }),
      success: described(McpScope.ScopedGrantInfo, "Revoked scoped grant"),
      error: [GrantNotFoundError, ConflictError],
    }).annotateMerge(locationQueryOpenApi)
      .annotateMerge(
      OpenApi.annotations({
        identifier: "permission.grant.revoke",
        summary: "Revoke scoped grant",
        description: "Revoke a scoped grant using its current CAS revision.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("session.permission.grant", "/session/:sessionID/permission/:requestID/grant", {
      params: { sessionID: Session.ID, requestID: Permission.ID },
      payload: Schema.Struct({ level: GrantLevel }),
      success: described(McpScope.ScopedGrantInfo, "Issued scoped grant"),
      error: [SessionNotFoundError, PermissionNotFoundError, ConflictError],
    }).annotateMerge(locationQueryOpenApi)
      .annotateMerge(
      OpenApi.annotations({
        identifier: "session.permission.grant",
        summary: "Issue scoped grant for pending permission",
        description:
          "Issue a Session or Location scoped grant whose facts are copied from an owned pending request.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "grants", description: "Scoped grant routes." }))
