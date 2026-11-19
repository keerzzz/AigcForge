import { Session } from "@aigcfroge/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
const sessionRoot = "/session/:sessionID/work-artifact"

/**
 * M1 Artifact contract lifted from the fork core (ADR-15 §5): in-memory event,
 * not persisted; the applied record is the wire success shape.
 */
export const WorkArtifactArtifactRecord = Schema.Struct({
  id: Schema.String.annotate({ description: "稳定 Artifact ID" }),
  sessionID: Session.ID,
  kind: Schema.Literal("document").annotate({ description: "M1 固定" }),
  title: Schema.String,
  mediaType: Schema.Literal("text/markdown"),
  relativePath: Schema.String.annotate({ description: "相对 Session Location，规范化后不得越界" }),
  status: Schema.Literals(["available", "missing"]),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}).annotate({ identifier: "WorkArtifact.ArtifactRecord" })

export const WorkArtifactApplyPayload = Schema.Struct({
  title: Schema.String,
  relativePath: Schema.String,
  content: Schema.String,
  overwrite: Schema.Boolean,
}).annotate({ identifier: "WorkArtifact.ApplyPayload" })

export const WorkArtifactGroup = HttpApiGroup.make("work-artifact")
  .add(
    HttpApiEndpoint.post("work-artifact.apply", `${sessionRoot}/apply`, {
      params: { sessionID: Session.ID },
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: WorkArtifactApplyPayload,
      success: described(WorkArtifactArtifactRecord, "Applied work artifact"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "work-artifact.apply",
        summary: "Apply work artifact",
        description: "Persist a drafted work artifact (candidate message) to the current Location atomically.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "work-artifact",
      description: "Work artifact apply surface (Work mode).",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
