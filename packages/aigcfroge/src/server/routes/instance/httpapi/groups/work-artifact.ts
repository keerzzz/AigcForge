export * as WorkArtifactApiGroup from "./work-artifact"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@aigcfroge/server/errors"
import { Authorization } from "../middleware/authorization"
import { SessionLocationMiddleware } from "@aigcfroge/server/middleware/session-location"

const sessionRoot = "/session/:sessionID/work-artifact"

export const ApplyPayload = Schema.Struct({
  title: Schema.String,
  relativePath: Schema.String,
  content: Schema.String,
  overwrite: Schema.Boolean,
})

export const WorkArtifactPaths = {
  apply: `${sessionRoot}/apply`,
} as const

export const WorkArtifactApi = HttpApi.make("work-artifact").add(
  HttpApiGroup.make("work-artifact")
    .add(
      HttpApiEndpoint.post("apply", WorkArtifactPaths.apply, {
        params: { sessionID: SessionID },
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: ApplyPayload,
        success: described(WorkArtifact.ArtifactRecord, "Applied work artifact"),
        error: [InvalidRequestError, ConflictError, ForbiddenError, SessionNotFoundError, ServiceUnavailableError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "work-artifact.apply",
          summary: "Apply work artifact",
          description:
            "Persist a drafted work artifact at the Session's stored Location and save its recoverable binding.",
        }),
      ),
    )
    .middleware(SessionLocationMiddleware)
    .middleware(Authorization),
)
