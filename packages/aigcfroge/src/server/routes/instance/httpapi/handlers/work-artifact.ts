export * as WorkArtifactHandlers from "./work-artifact"

import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@aigcfroge/server/errors"
import { sessionLocationLayer } from "@aigcfroge/server/middleware/session-location"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const workArtifactHandlers = HttpApiBuilder.group(InstanceHttpApi, "work-artifact", (handlers) =>
  handlers.handle(
    "apply",
    Effect.fn("WorkArtifactHttpApi.apply")(function* (ctx) {
      // Placement comes from the persisted Session, never a caller's directory hint.
      const artifacts = yield* WorkArtifact.Service
      const result = yield* artifacts
        .apply({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError((error) => toApplyError(error, ctx.params.sessionID)))
      return result.artifact
    }),
  ),
).pipe(Layer.provide(sessionLocationLayer), Layer.provide(LocationServiceMap.layer))

function toApplyError(error: { readonly _tag: string }, sessionID: string) {
  switch (error._tag) {
    case "WorkArtifact.NotFound":
      return new SessionNotFoundError({ sessionID, message: "Session not found" })
    case "WorkArtifact.Scope":
      return new ForbiddenError({ message: "Work artifact requires its owning Work Session and Location" })
    case "WorkArtifact.PathValidation":
      return new InvalidRequestError({ message: "Invalid work artifact path", field: "relativePath" })
    case "WorkArtifact.Conflict":
      return new ConflictError({
        message: "Work artifact conflicts with the current file or binding",
        resource: "work-artifact",
      })
    case "WorkArtifact.Unavailable":
      return new ConflictError({ message: "Work artifact is unavailable", resource: "work-artifact" })
    default:
      return new ServiceUnavailableError({ message: "Work artifact storage is unavailable", service: "work-artifact" })
  }
}
