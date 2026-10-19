import { ScopedGrantStore } from "@aigcfroge/core/grant/store"
import { PermissionV2 } from "@aigcfroge/core/permission"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConflictError, GrantNotFoundError, PermissionNotFoundError } from "../errors"
import { response } from "../groups/location"

function missingGrant(grantID: string) {
  return new GrantNotFoundError({ grantID, message: `Scoped grant not found: ${grantID}` })
}

function missingRequest(requestID: PermissionV2.ID) {
  return new PermissionNotFoundError({ requestID, message: `Permission request not found: ${requestID}` })
}

function conflict(resource: string, message: string) {
  return new ConflictError({ resource, message })
}

export const GrantHandler = HttpApiBuilder.group(Api, "server.grant", (handlers) =>
  handlers
    .handle(
      "grant.list",
      Effect.fn("GrantHandler.list")(function* () {
        return yield* response((yield* ScopedGrantStore.Service).list())
      }),
    )
    .handle(
      "grant.revoke",
      Effect.fn("GrantHandler.revoke")(function* (ctx) {
        return yield* (yield* ScopedGrantStore.Service).revoke(ctx.params.grantID, ctx.payload.expectedRevision).pipe(
          Effect.catchTag("ScopedGrant.NotFoundError", () => Effect.fail(missingGrant(ctx.params.grantID))),
          Effect.catchTag("ScopedGrant.StateError", (error) =>
            Effect.fail(conflict(ctx.params.grantID, error.message)),
          ),
          Effect.catchTag("GrantEvent.CommitRejected", (error) =>
            Effect.fail(conflict(ctx.params.grantID, error.message)),
          ),
        )
      }),
    )
    .handle(
      "session.permission.grant",
      Effect.fn("GrantHandler.sessionPermissionGrant")(function* (ctx) {
        return yield* (yield* PermissionV2.Service)
          .grant({
            sessionID: ctx.params.sessionID,
            requestID: ctx.params.requestID,
            level: ctx.payload.level,
          })
          .pipe(
            Effect.catchTag("PermissionV2.NotFoundError", () => missingRequest(ctx.params.requestID)),
            Effect.catchTag("GrantEvent.CommitRejected", (error) => conflict(ctx.params.requestID, error.message)),
          )
      }),
    ),
)
