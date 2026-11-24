import { Session } from "@omnixa/schema/session"
import { SessionCommunication } from "@omnixa/schema/session-communication"
import { PositiveInt } from "@omnixa/schema/schema"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError, ServiceUnavailableError, SessionNotFoundError } from "../errors.js"
import { WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"

export const makeSessionCommunicationGroup = <I extends HttpApiMiddleware.AnyId, S>(
  sessionLocationMiddleware: Context.Key<I, S>,
) =>
  HttpApiGroup.make("server.sessionCommunication")
    .add(
      HttpApiEndpoint.post("sessionCommunication.send", "/api/session/:sessionID/communication", {
        params: { sessionID: Session.ID },
        query: WorkspaceRoutingQuery,
        payload: SessionCommunication.Send,
        success: Schema.Struct({ data: SessionCommunication.Receipt }),
        error: [SessionNotFoundError, ServiceUnavailableError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "sessionCommunication.send",
            summary: "Send immutable content to another Session",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post(
        "sessionCommunication.reply",
        "/api/session/:sessionID/communication/:communicationID/reply",
        {
          params: { sessionID: Session.ID, communicationID: SessionCommunication.ID },
          query: WorkspaceRoutingQuery,
          payload: SessionCommunication.Reply,
          success: Schema.Struct({ data: SessionCommunication.Receipt }),
          error: [SessionNotFoundError, ServiceUnavailableError, InvalidRequestError, ConflictError],
        },
      )
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "sessionCommunication.reply",
            summary: "Reply to the exact saved communication sender",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("sessionCommunication.read", "/api/session/:sessionID/communication/:communicationID", {
        params: { sessionID: Session.ID, communicationID: SessionCommunication.ID },
        query: WorkspaceRoutingQuery,
        success: Schema.Struct({ data: Schema.NullOr(SessionCommunication.Message) }),
        error: [SessionNotFoundError, ServiceUnavailableError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "sessionCommunication.read",
            summary: "Read one retained communication and its original Inbox state",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("sessionCommunication.list", "/api/session/:sessionID/communication", {
        params: { sessionID: Session.ID },
        query: Schema.Struct({
          ...WorkspaceRoutingQueryFields,
          cursor: Schema.optional(Schema.String),
          limit: Schema.NumberFromString.pipe(Schema.decodeTo(PositiveInt), Schema.optional),
        }),
        success: Schema.Struct({ data: SessionCommunication.Page }),
        error: [SessionNotFoundError, ServiceUnavailableError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "sessionCommunication.list",
            summary: "List sent and received communications with runtime capabilities",
          }),
        ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "sessionCommunication",
        description: "Durable content exchange through the original Session Inbox.",
      }),
    )
