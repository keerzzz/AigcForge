import { Pty } from "@omnixa/schema/pty"
import { PtyTicket } from "@omnixa/schema/pty-ticket"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError, PtyNotFoundError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { PtyConnectAuthorization } from "../middleware/pty-connect.js"
import {
  InstanceContext,
  WorkspaceRouting,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"
import { PTY_CONNECT_TICKET_QUERY } from "./pty.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Lives beside the base `server.pty` group (different identifiers and
// paths); the base group serves /api/pty/*, this one serves the fork's /pty/* wire.
// Override only documentation operation IDs; client generation retains the original identifiers.
const root = "/pty"

export const PtyParams = Schema.Struct({ ptyID: Pty.ID })
export const CursorQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  cursor: Schema.optional(Schema.String),
}).annotate({ identifier: "Pty.CursorQuery" })

export const ShellItem = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  acceptable: Schema.Boolean,
}).annotate({ identifier: "Pty.ShellItem" })

export const PtyInstanceGroup = HttpApiGroup.make("pty-instance")
  .add(
    HttpApiEndpoint.get("pty.shells", `${root}/shells`, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(ShellItem), "List of shells"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.shells",
        summary: "List available shells",
        description: "Get a list of available shells on the system.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("pty.list", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(Pty.Info), "List of sessions"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.list",
        override: { operationId: "pty-instance.pty.list" },
        summary: "List PTY sessions",
        description: "Get a list of all active pseudo-terminal (PTY) sessions managed by Omnixa.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("pty.create", root, {
      query: WorkspaceRoutingQuery,
      payload: Pty.CreateInput,
      success: described(Pty.Info, "Created session"),
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.create",
        override: { operationId: "pty-instance.pty.create" },
        summary: "Create PTY session",
        description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("pty.get", `${root}/:ptyID`, {
      params: { ptyID: Pty.ID },
      query: WorkspaceRoutingQuery,
      success: described(Pty.Info, "Session info"),
      error: PtyNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.get",
        override: { operationId: "pty-instance.pty.get" },
        summary: "Get PTY session",
        description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("pty.update", `${root}/:ptyID`, {
      params: { ptyID: Pty.ID },
      query: WorkspaceRoutingQuery,
      payload: Pty.UpdateInput,
      success: described(Pty.Info, "Updated session"),
      error: [PtyNotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.update",
        override: { operationId: "pty-instance.pty.update" },
        summary: "Update PTY session",
        description: "Update properties of an existing pseudo-terminal (PTY) session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("pty.remove", `${root}/:ptyID`, {
      params: { ptyID: Pty.ID },
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Session removed"),
      error: PtyNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.remove",
        override: { operationId: "pty-instance.pty.remove" },
        summary: "Remove PTY session",
        description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("pty.connectToken", `${root}/:ptyID/connect-token`, {
      params: { ptyID: Pty.ID },
      query: WorkspaceRoutingQuery,
      success: described(PtyTicket.ConnectToken, "WebSocket connect token"),
      error: [ForbiddenError, PtyNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.connectToken",
        summary: "Create PTY WebSocket token",
        description: "Create a short-lived ticket for opening a PTY WebSocket connection.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "pty", description: "Experimental HttpApi PTY routes." }))
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)

export const PtyConnectInstanceGroup = HttpApiGroup.make("pty-connect-instance")
  .add(
    // Decode PTY connection query fields in the raw handler after checking
    // existence, preserving the established empty-404 response ordering.
    HttpApiEndpoint.get("pty.connect", `${root}/:ptyID/connect`, {
      params: PtyParams,
      success: described(Schema.Boolean, "Connected session"),
      error: [ForbiddenError, PtyNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "pty.connect",
        override: { operationId: "pty-connect-instance.pty.connect" },
        summary: "Connect to PTY session",
        description: "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        transform: (operation) => ({
          ...operation,
          parameters: [
            ...(operation.parameters ?? []),
            ...["directory", "workspace", "cursor", PTY_CONNECT_TICKET_QUERY].map((name) => ({
              in: "query",
              name,
              schema: { type: "string" },
            })),
          ],
        }),
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "pty", description: "PTY websocket route." }))
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(PtyConnectAuthorization)
