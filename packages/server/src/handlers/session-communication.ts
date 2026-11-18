import { Session } from "@aigcfroge/core/session"
import { ControllerConflictError } from "@aigcfroge/core/session/error"
import { SessionShareV2 } from "@aigcfroge/core/session/share-v2"
import { SessionCommunication } from "@aigcfroge/schema/session-communication"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@aigcfroge/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { missingSession } from "./session-error"

const communicationErrors = <A, R>(effect: Effect.Effect<A,
  Session.NotFoundError | Session.MessageDecodeError | ControllerConflictError | SessionCommunication.Error, R>) => effect.pipe(
  Effect.catchTag("Session.NotFoundError", missingSession),
  Effect.catchTag("Session.MessageDecodeError", () => new InvalidRequestError({ field: "communication", kind: "message_decode", message: "The saved communication message could not be decoded" })),
  Effect.catchTag("Session.ControllerConflictError", (error) => new InvalidRequestError({ field: error.field, kind: error.kind, message: error.message })),
  Effect.catchTag("SessionCommunication.Error", (error): Effect.Effect<never, ServiceUnavailableError | ConflictError | InvalidRequestError> => {
    if (error.reason === "unavailable") return new ServiceUnavailableError({ service: "sessionCommunication", message: error.message })
    if (error.reason === "conflicting_retry") return new ConflictError({ resource: error.communicationID, message: error.message })
    return new InvalidRequestError({ field: "communication", kind: error.reason, message: error.message })
  }),
)

export const SessionCommunicationHandler = HttpApiBuilder.group(Api, "server.sessionCommunication", (handlers) => Effect.gen(function* () {
  const share = yield* SessionShareV2.Service
  return handlers
    .handle("sessionCommunication.send", Effect.fn(function* (ctx) {
      return { data: yield* communicationErrors(share.send({ ...ctx.payload, sessionID: ctx.params.sessionID })) }
    }))
    .handle("sessionCommunication.reply", Effect.fn(function* (ctx) {
      return { data: yield* communicationErrors(share.reply({ ...ctx.payload, ...ctx.params })) }
    }))
    .handle("sessionCommunication.read", Effect.fn(function* (ctx) {
      return { data: (yield* communicationErrors(share.read(ctx.params))) ?? null }
    }))
    .handle("sessionCommunication.list", Effect.fn(function* (ctx) {
      return { data: yield* communicationErrors(share.list({ sessionID: ctx.params.sessionID, cursor: ctx.query.cursor, limit: ctx.query.limit })) }
    }))
}))
