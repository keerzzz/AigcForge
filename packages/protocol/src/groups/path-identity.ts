import { PathIdentity } from "@aigcfroge/schema/path-identity"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { described } from "./metadata.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

// Fork-retained location-scoped surface (see question.ts for the conventions).
export const PathIdentityGroup = HttpApiGroup.make("server.pathIdentity")
  .add(
    HttpApiEndpoint.post("pathIdentity.compare", "/path-identity/compare", {
      query: LocationQuery,
      payload: PathIdentity.CompareInput,
      success: described(PathIdentity.Result, "Path identity comparison result"),
    }).annotateMerge(locationQueryOpenApi)
      .annotateMerge(
      OpenApi.annotations({
        identifier: "pathIdentity.compare",
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
