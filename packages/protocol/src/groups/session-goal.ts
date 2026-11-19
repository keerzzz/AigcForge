import { SessionGoal } from "@aigcfroge/schema/session-goal"
import { Session } from "@aigcfroge/schema/session"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError, SessionNotFoundError } from "../errors.js"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"

export const makeSessionGoalGroup = <I extends HttpApiMiddleware.AnyId, S>(
  sessionLocationMiddleware: Context.Key<I, S>,
) =>
  HttpApiGroup.make("server.sessionGoal")
    .add(
      HttpApiEndpoint.get("sessionGoal.list", "/api/session/:sessionID/goal", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID },
        success: Schema.Struct({ data: Schema.Array(SessionGoal.Info) }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "sessionGoal.list", summary: "List Session Goals" })),
    )
    .add(
      HttpApiEndpoint.get("sessionGoal.get", "/api/session/:sessionID/goal/:goalID", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID, goalID: SessionGoal.ID },
        success: Schema.Struct({ data: Schema.NullOr(SessionGoal.Info) }),
        error: SessionNotFoundError,
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "sessionGoal.get", summary: "Read one Session Goal" })),
    )
    .add(
      HttpApiEndpoint.post("sessionGoal.set", "/api/session/:sessionID/goal", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID },
        payload: SessionGoal.CreateInput,
        success: Schema.Struct({ data: SessionGoal.Info }),
        error: [SessionNotFoundError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "sessionGoal.set", summary: "Set and start a Session Goal" })),
    )
    .add(
      HttpApiEndpoint.patch("sessionGoal.edit", "/api/session/:sessionID/goal/:goalID", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID, goalID: SessionGoal.ID },
        payload: SessionGoal.EditInput,
        success: Schema.Struct({ data: SessionGoal.Info }),
        error: [SessionNotFoundError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGoal.edit",
            summary: "Revise Goal objective, conditions or budget",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("sessionGoal.pause", "/api/session/:sessionID/goal/:goalID/pause", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID, goalID: SessionGoal.ID },
        payload: SessionGoal.RevisionInput,
        success: Schema.Struct({ data: SessionGoal.Info }),
        error: [SessionNotFoundError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "sessionGoal.pause", summary: "Pause Goal continuation" })),
    )
    .add(
      HttpApiEndpoint.post("sessionGoal.resume", "/api/session/:sessionID/goal/:goalID/resume", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID, goalID: SessionGoal.ID },
        payload: SessionGoal.RevisionInput,
        success: Schema.Struct({ data: SessionGoal.Info }),
        error: [SessionNotFoundError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGoal.resume",
            summary: "Resume the saved Goal after checking budget and coordination",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("sessionGoal.cancel", "/api/session/:sessionID/goal/:goalID/cancel", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID, goalID: SessionGoal.ID },
        payload: SessionGoal.RevisionInput,
        success: Schema.Struct({ data: SessionGoal.Info }),
        error: [SessionNotFoundError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(OpenApi.annotations({ identifier: "sessionGoal.cancel", summary: "Cancel Goal continuation" })),
    )
    .add(
      HttpApiEndpoint.post("sessionGoal.confirm", "/api/session/:sessionID/goal/:goalID/confirm", {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        params: { sessionID: Session.ID, goalID: SessionGoal.ID },
        payload: SessionGoal.ConfirmInput,
        success: Schema.Struct({ data: SessionGoal.Info }),
        error: [SessionNotFoundError, InvalidRequestError, ConflictError],
      })
        .middleware(sessionLocationMiddleware)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "sessionGoal.confirm",
            summary: "Confirm the exact Goal revision and producer evidence set",
          }),
        ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "sessionGoal",
        description: "Persistent Session Goals, verified conditions and execution budget.",
      }),
    )
