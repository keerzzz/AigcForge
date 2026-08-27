import { McpScope } from "@aigcfroge/schema/mcp-scope"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Location } from "@aigcfroge/core/location"
import { SessionV2 } from "@aigcfroge/core/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, GrantNotFoundError, PermissionNotFoundError, SessionNotFoundError } from "../errors"
import { SessionLocationMiddleware } from "../middleware/session-location"
import { LocationMiddleware, LocationQuery, locationQueryOpenApi } from "./location"

const GrantLevel = Schema.Literals(["session", "location"])

export const GrantGroup = HttpApiGroup.make("server.grant")
  .add(
    HttpApiEndpoint.get("grant.list", "/api/permission/grant", {
      query: LocationQuery,
      success: Location.response(Schema.Array(McpScope.ScopedGrantInfo)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.permission.grant.list",
          summary: "List scoped grants",
          description: "Retrieve scoped grant history for a location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("grant.revoke", "/api/permission/grant/:grantID", {
      params: { grantID: McpScope.ScopedGrant.fields.id },
      query: LocationQuery,
      payload: Schema.Struct({ expectedRevision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))) }),
      success: McpScope.ScopedGrantInfo,
      error: [GrantNotFoundError, ConflictError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.permission.grant.revoke",
          summary: "Revoke scoped grant",
          description: "Revoke a scoped grant using its current CAS revision.",
        }),
      ),
  )
  .middleware(LocationMiddleware)
  .add(
    HttpApiEndpoint.post("session.permission.grant", "/api/session/:sessionID/permission/:requestID/grant", {
      params: { sessionID: SessionV2.ID, requestID: PermissionV2.ID },
      payload: Schema.Struct({ level: GrantLevel }),
      success: McpScope.ScopedGrantInfo,
      error: [SessionNotFoundError, PermissionNotFoundError, ConflictError],
    })
      .middleware(SessionLocationMiddleware)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.session.permission.grant",
          summary: "Issue scoped grant for pending permission",
          description: "Issue a Session or Location scoped grant whose facts are copied from an owned pending request.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "grants", description: "Scoped grant routes." }))
