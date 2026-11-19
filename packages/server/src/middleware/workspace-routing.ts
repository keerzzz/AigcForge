import path from "node:path"
import { Environment } from "@aigcfroge/core/environment/index"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { Workspace } from "@aigcfroge/core/workspace"
import { ApiNotFoundError, InvalidRequestError } from "@aigcfroge/protocol/errors"
import {
  InstanceContext,
  WorkspaceRouteContext,
  WorkspaceRouting,
  WorkspaceRoutingQuery,
} from "@aigcfroge/protocol/middleware/workspace-routing"
import { AbsolutePath } from "@aigcfroge/schema/schema"
import { Context, Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/http"

/** The Protocol route stays transport-only; handlers explicitly borrow this Location graph. */
export function locationRefForRoute(route: { readonly directory: string; readonly workspaceID?: string }) {
  return LocationServiceMap.canonical(
    Location.Ref.make({
      directory: AbsolutePath.make(path.resolve(route.directory)),
      workspaceID: route.workspaceID === undefined ? undefined : Workspace.ID.make(route.workspaceID),
    }),
  )
}

export const workspaceRoutingLayer = Layer.effect(
  WorkspaceRouting,
  Effect.sync(() =>
    WorkspaceRouting.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const query = yield* HttpServerRequest.schemaSearchParams(WorkspaceRoutingQuery).pipe(
          Effect.mapError(() => new InvalidRequestError({ message: "Invalid workspace routing query" })),
        )
        const directory =
          query.directory ||
          (request.headers["x-aigcfroge-directory"] ? decode(request.headers["x-aigcfroge-directory"]) : process.cwd())
        if (directory.includes("\0"))
          return yield* new InvalidRequestError({ message: "Invalid directory", field: "directory" })
        const workspaceID = query.workspace
          ? yield* Schema.decodeUnknownEffect(Workspace.ID)(query.workspace).pipe(
              Effect.mapError(() => new InvalidRequestError({ message: "Invalid workspace ID", field: "workspace" })),
            )
          : undefined
        return yield* effect.pipe(
          Effect.provideService(WorkspaceRouteContext, locationRefForRoute({ directory, workspaceID })),
        )
      }),
    ),
  ),
)

export const instanceContextLayer = Layer.effect(
  InstanceContext,
  Effect.gen(function* () {
    const workspace = yield* Workspace.Service
    const locations = yield* LocationServiceMap.Service
    return InstanceContext.of((effect) =>
      Effect.gen(function* () {
        const route = yield* WorkspaceRouteContext
        const ref = locationRefForRoute(route)
        // Workspace.connect is lazy; a logical existence check must precede the graph borrow.
        if (ref.workspaceID && !(yield* workspace.exists(ref.workspaceID)))
          return yield* notFound(`Workspace not found: ${ref.workspaceID}`)
        const context = yield* locations
          .contextEffect(ref)
          .pipe(Effect.mapError((error) => notFound(`Location not found: ${error.directory}`)))
        const environment = Context.get(context, Environment.Service)
        const kind = yield* Environment.typeFollowing(environment.files, ref.directory).pipe(
          Effect.catchTag("Environment.NotFound", () => notFound(`Location not found: ${ref.directory}`)),
          Effect.catchTag("Environment.Failed", (error) =>
            error.cause instanceof Workspace.NotFound
              ? notFound(`Workspace not found: ${error.cause.workspaceID}`)
              : Effect.die(error),
          ),
        )
        if (kind !== "directory") return yield* notFound(`Location not found: ${ref.directory}`)
        return yield* effect
      }),
    )
  }),
)

function notFound(message: string) {
  return new ApiNotFoundError({ name: "NotFoundError", data: { message } })
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}
