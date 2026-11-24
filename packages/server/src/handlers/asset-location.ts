import { LocationServiceMap } from "@omnixa/core/location-services"
import { Plugin } from "@omnixa/core/plugin/service"
import { Session } from "@omnixa/core/session"
import { ApiNotFoundError, ConflictError, InvalidRequestError } from "@omnixa/protocol/errors"
import { WorkspaceRouteContext } from "@omnixa/protocol/middleware/workspace-routing"
import { Effect } from "effect"
import { locationRefForRoute } from "../middleware/workspace-routing"

// Borrow the existing Location graph; Session mutations must match both placement fields before borrowing it.
export const make = Effect.fnUntraced(function* (name: string) {
  const locations = yield* LocationServiceMap.Service
  const sessions = yield* Session.Service
  const atLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const route = yield* WorkspaceRouteContext
      const context = yield* locations.contextEffect(locationRefForRoute(route)).pipe(
        Effect.mapError(
          (error) =>
            new ApiNotFoundError({
              name: "NotFoundError",
              data: { message: `Location not found: ${error.directory}` },
            }),
        ),
      )
      return yield* Plugin.awaitActivation.pipe(Effect.andThen(effect), Effect.provideContext(context))
    })
  const atSessionLocation = <A, E, R>(sessionID: Session.ID, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const session = yield* sessions.get(sessionID).pipe(
        Effect.catchTag(
          "Session.NotFoundError",
          () =>
            new InvalidRequestError({
              message: `${name} asset Session not found`,
              field: "sessionID",
              kind: "not_found",
            }),
        ),
      )
      const route = yield* WorkspaceRouteContext
      const location = locationRefForRoute(route)
      const owner = locationRefForRoute(session.location)
      if (location.directory !== owner.directory || location.workspaceID !== owner.workspaceID)
        return yield* new ConflictError({
          resource: session.id,
          message: `${name} asset Session belongs to another Location`,
        })
      return yield* atLocation(effect)
    })
  return { atLocation, atSessionLocation }
})

export * as AssetLocation from "./asset-location"
