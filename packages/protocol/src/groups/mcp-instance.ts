import { Mcp } from "@aigcfroge/schema/mcp"
import { ConfigMCPV1 } from "@aigcfroge/schema/v1/config/mcp"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, McpServerNotFoundError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Lives beside the base `server.mcp` group (client name "mcp").
const root = "/mcp"

export const McpAddPayload = Schema.Struct({
  name: Schema.String,
  config: ConfigMCPV1.Info,
}).annotate({ identifier: "McpInstance.AddPayload" })

export const McpStatusMap = Schema.Record(Schema.String, Mcp.Status).annotate({ identifier: "McpInstance.StatusMap" })

export const McpAuthStartResponse = Schema.Struct({
  authorizationUrl: Schema.String,
  oauthState: Schema.String,
}).annotate({ identifier: "McpInstance.AuthStartResponse" })

export const McpAuthCallbackPayload = Schema.Struct({
  code: Schema.String,
}).annotate({ identifier: "McpInstance.AuthCallbackPayload" })

export const McpAuthRemoveResponse = Schema.Struct({
  success: Schema.Literal(true),
}).annotate({ identifier: "McpInstance.AuthRemoveResponse" })

export class McpUnsupportedOAuthError extends Schema.TaggedError<McpUnsupportedOAuthError>()(
  "McpUnsupportedOAuthError",
  { error: Schema.String },
  { httpApiStatus: 400 },
) {}

export const McpInstanceGroup = HttpApiGroup.make("mcp-instance")
  .add(
    HttpApiEndpoint.get("mcp-instance.status", root, {
      query: WorkspaceRoutingQuery,
      success: described(McpStatusMap, "MCP server status"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.status",
        summary: "Get MCP status",
        description: "Get the status of all Model Context Protocol (MCP) servers.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-instance.add", root, {
      query: WorkspaceRoutingQuery,
      payload: McpAddPayload,
      success: described(McpStatusMap, "MCP server added successfully"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.add",
        summary: "Add MCP server",
        description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-instance.authStart", `${root}/:name/auth`, {
      params: { name: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(McpAuthStartResponse, "OAuth flow started"),
      error: [McpUnsupportedOAuthError, McpServerNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.auth.start",
        summary: "Start MCP OAuth",
        description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-instance.authCallback", `${root}/:name/auth/callback`, {
      params: { name: Schema.String },
      query: WorkspaceRoutingQuery,
      payload: McpAuthCallbackPayload,
      success: described(Mcp.Status, "OAuth authentication completed"),
      error: [InvalidRequestError, McpServerNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.auth.callback",
        summary: "Complete MCP OAuth",
        description:
          "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-instance.authAuthenticate", `${root}/:name/auth/authenticate`, {
      params: { name: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(Mcp.Status, "OAuth authentication completed"),
      error: [McpUnsupportedOAuthError, McpServerNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.auth.authenticate",
        summary: "Authenticate MCP OAuth",
        description: "Start OAuth flow and wait for callback (opens browser).",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("mcp-instance.authRemove", `${root}/:name/auth`, {
      params: { name: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(McpAuthRemoveResponse, "OAuth credentials removed"),
      error: McpServerNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.auth.remove",
        summary: "Remove MCP OAuth",
        description: "Remove OAuth credentials for an MCP server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-instance.connect", `${root}/:name/connect`, {
      params: { name: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "MCP server connected successfully"),
      error: McpServerNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.connect",
        description: "Connect an MCP server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("mcp-instance.disconnect", `${root}/:name/disconnect`, {
      params: { name: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "MCP server disconnected successfully"),
      error: McpServerNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "mcp.disconnect",
        description: "Disconnect an MCP server.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "mcp",
      description: "Experimental HttpApi MCP routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
