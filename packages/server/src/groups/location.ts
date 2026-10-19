import { existsSync } from "node:fs"
import { Location } from "@aigcfroge/core/location"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { WorkspaceV2 } from "@aigcfroge/core/workspace"
import { Effect, Layer, Schema } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/unstable/httpapi"
import { LocationNotFoundError } from "../errors"

export const LocationQuery = Schema.Struct({
  location: Schema.optional(
    Schema.Struct({
      directory: Schema.optional(Schema.String),
      workspace: Schema.optional(Schema.String),
    }),
  ),
}).annotate({ identifier: "LocationQuery" })

export const locationQueryOpenApi = OpenApi.annotations({
  transform: (operation) => {
    const parameters = operation.parameters
    if (!Array.isArray(parameters)) return operation
    return {
      ...operation,
      parameters: parameters.map((parameter) =>
        parameter?.name === "location" && parameter?.in === "query"
          ? { ...parameter, style: "deepObject", explode: true }
          : parameter,
      ),
    }
  },
})

export function response<A, E, R>(data: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const location = yield* Location.Service
    return {
      location: new Location.Info({
        directory: location.directory,
        workspaceID: location.workspaceID,
        project: location.project,
      }),
      data: yield* data,
    }
  })
}

export type LocationServices = Layer.Success<ReturnType<typeof LocationServiceMap.get>>

export class LocationMiddleware extends HttpApiMiddleware.Service<
  LocationMiddleware,
  {
    provides: LocationServices
  }
>()("@aigcfroge/HttpApiLocation", { error: LocationNotFoundError }) {}

export const LocationGroup = HttpApiGroup.make("server.location")
  .add(
    HttpApiEndpoint.get("location.get", "/api/location", {
      query: LocationQuery,
      success: Location.Info,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.location.get",
          summary: "Get location",
          description: "Resolve the requested location or the server default location.",
        }),
      ),
  )
  .middleware(LocationMiddleware)

function ref(request: HttpServerRequest.HttpServerRequest): Location.Ref {
  const query = new URL(request.url, "http://localhost").searchParams
  const workspaceID = query.get("location[workspace]") || request.headers["x-aigcfroge-workspace"]
  const directory =
    query.get("location[directory]") ||
    (request.headers["x-aigcfroge-directory"] ? decode(request.headers["x-aigcfroge-directory"]) : process.cwd())
  return Location.Ref.make({
    directory: AbsolutePath.make(directory),
    workspaceID: workspaceID ? WorkspaceV2.ID.make(workspaceID) : undefined,
  })
}

function decode(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

export const layer = Layer.effect(
  LocationMiddleware,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap
    return LocationMiddleware.of((effect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const target = ref(request)
        // The location layer graph (fff native search, config loaders, etc.)
        // assumes `directory` exists on disk and dies/interrupts on native
        // failures when it doesn't (e.g. a stale remembered workspace path).
        // Fail fast here with a typed 404 instead of letting that surface as
        // an opaque empty 500/503 further down the LayerMap build.
        //
        // Deliberately synchronous (node:fs existsSync, not the Effect
        // FileSystem service's async existsSafe): this middleware also guards
        // PtyGroup's `/api/pty/:ptyID/connect`, a `handleRaw` WebSocket
        // upgrade route. The legacy InstanceContextMiddleware equivalent
        // (packages/aigcfroge/.../middleware/instance-context.ts) reproduced a
        // hang under repeated upgrade/reject cycles when the check went
        // through `yield* fs.exists`; a plain existsSync avoids scheduling
        // this check on the Effect fiber runtime altogether.
        const exists = existsSync(target.directory)
        if (!exists) {
          return yield* new LocationNotFoundError({
            directory: target.directory,
            message: `Directory not found: ${target.directory}`,
          })
        }
        return yield* effect.pipe(Effect.provide(locations.get(target)))
      }),
    )
  }),
)
