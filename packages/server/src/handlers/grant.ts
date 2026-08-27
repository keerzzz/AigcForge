import { GrantEvent } from "@aigcfroge/core/grant/event"
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

/**
 * Issue a scoped grant for a pending request and resolve that request.
 *
 * Extracted from the endpoint body so the compensation branch is assertable.
 * It cannot be reached through a real HTTP round trip on purpose: `get` and
 * `reply` read the same in-memory pending Map (`permission.ts:412` / `:343`),
 * so "present at get, gone at reply" needs two racing grant requests, and
 * racing tests are forbidden. This function takes both owners as plain
 * arguments so a test can drive that window directly.
 *
 * The compensation is the point: once `issue` has committed, a failed `reply`
 * would otherwise leave an active grant behind for a request nobody can answer
 * — authority with no audit trail leading to it. Revoking at the revision it
 * was issued at keeps the CAS honest; if the revoke itself fails we log and
 * still fail the call, because reporting success here would be worse.
 */
export const issueGrantForRequest = Effect.fn("GrantHandler.issueGrantForRequest")(function* (input: {
  readonly permission: Pick<PermissionV2.Interface, "get" | "reply">
  readonly store: Pick<ScopedGrantStore.Interface, "issue" | "revoke">
  readonly sessionID: string
  readonly requestID: PermissionV2.ID
  readonly level: "session" | "location"
}) {
  const request = yield* input.permission.get(input.requestID)
  if (!request || request.sessionID !== input.sessionID) return yield* missingRequest(input.requestID)
  const issued = yield* input.store
    .issue({
      scope:
        input.level === "session" ? { level: "session", sessionID: request.sessionID } : { level: "location" },
      action: request.action,
      resources: request.resources,
    })
    .pipe(Effect.catchTag("GrantEvent.CommitRejected", (error) => Effect.fail(conflict(request.id, error.message))))

  return yield* input.permission.reply({ requestID: request.id, reply: "once" }).pipe(
    Effect.as(issued),
    Effect.catchTag("PermissionV2.NotFoundError", () =>
      input.store.revoke(issued.grant.id, issued.grantRevision).pipe(
        Effect.tapError((error) =>
          Effect.logError("Failed to compensate scoped grant after permission reply failure", {
            grantID: issued.grant.id,
            requestID: request.id,
            error,
          }),
        ),
        Effect.catch(() => Effect.void),
        Effect.andThen(Effect.fail(conflict(request.id, "Permission request disappeared after grant issuance"))),
      ),
    ),
  )
})

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
        return yield* issueGrantForRequest({
          permission: yield* PermissionV2.Service,
          store: yield* ScopedGrantStore.Service,
          sessionID: ctx.params.sessionID,
          requestID: ctx.params.requestID,
          level: ctx.payload.level,
        })
      }),
    ),
)
