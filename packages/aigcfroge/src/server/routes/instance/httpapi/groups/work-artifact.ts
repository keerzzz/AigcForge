export * as WorkArtifactApiGroup from "./work-artifact"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { SessionID } from "@/session/schema"
import { WorkArtifact } from "@aigcfroge/core/session/artifact"
import { ConflictError, InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

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
        error: [InvalidRequestError, ConflictError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "work-artifact.apply",
          summary: "Apply work artifact",
          description: "Persist a drafted work artifact (candidate message) to the current Location atomically.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
