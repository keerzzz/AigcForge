import { PathIdentity } from "@aigcfroge/core/path-identity"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationMiddleware, LocationQuery, locationQueryOpenApi } from "./location"

export const PathIdentityGroup = HttpApiGroup.make("server.pathIdentity")
  .add(
    HttpApiEndpoint.post("pathIdentity.compare", "/api/path-identity/compare", {
      query: LocationQuery,
      payload: PathIdentity.CompareInput,
      success: PathIdentity.Result,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.pathIdentity.compare",
          summary: "Compare local path identities",
          description:
            "Prove that two local path references identify the same filesystem object, or return a typed unknown result.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "pathIdentity",
      description: "Read-only, location-scoped local path identity proof.",
    }),
  )
  .middleware(LocationMiddleware)
