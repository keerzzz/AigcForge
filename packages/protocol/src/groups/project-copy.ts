import { Project } from "@aigcfroge/schema/project"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
export const GenerateNamePayload = Schema.Struct({
  context: Schema.optional(Schema.String),
}).annotate({ identifier: "ProjectCopy.GenerateNamePayload" })

export const ProjectCopyGroup = HttpApiGroup.make("projectCopyName")
  .add(
    HttpApiEndpoint.post("projectCopyName.generateName", "/experimental/project/:projectID/copy/generate-name", {
      params: { projectID: Project.ID },
      query: WorkspaceRoutingQuery,
      payload: GenerateNamePayload,
      success: Schema.Struct({ name: Schema.String }).annotate({ identifier: "ProjectCopy.GenerateNameResponse" }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.projectCopy.generateName",
        summary: "Generate project copy name",
        description: "Generate a short name for a project copy from task context.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "projectCopy", description: "Project copy naming routes." }))
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
