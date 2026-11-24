import { Project } from "@omnixa/schema/project"
import { AbsolutePath, NonNegativeInt } from "@omnixa/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError, ProjectNotFoundError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Lives beside the base `server.project` group (client name "project"): this group
// serves the fork's /project/* wire; the base group serves /api/project/*.
const root = "/project"

/** Lifted from the fork entry project model (nonNegative millis, `initialized` optional). */
export const ForkProjectTime = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: Schema.optional(NonNegativeInt),
}).annotate({ identifier: "ProjectInstance.Time" })

export const ForkProjectInfo = Schema.Struct({
  id: Project.ID,
  worktree: Schema.String,
  vcs: Schema.optional(Schema.Literal("git")),
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Icon),
  commands: Schema.optional(Project.Commands),
  time: ForkProjectTime,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "ProjectInstance.Info" })

export const ProjectUpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(Project.Icon),
  commands: Schema.optional(Project.Commands),
}).annotate({ identifier: "ProjectInstance.UpdatePayload" })

export const ProjectDirectories = Schema.Array(
  Schema.Struct({
    directory: AbsolutePath,
    strategy: Schema.optional(Schema.String),
  }),
).annotate({ identifier: "Project.Directories" })

export const ProjectInstanceGroup = HttpApiGroup.make("project-instance")
  .add(
    HttpApiEndpoint.get("project-instance.list", root, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(ForkProjectInfo), "List of projects"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.instance.list",
        summary: "List all projects",
        description: "Get a list of projects that have been opened with Omnixa.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project-instance.current", `${root}/current`, {
      query: WorkspaceRoutingQuery,
      success: described(ForkProjectInfo, "Current project information"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.instance.current",
        summary: "Get current project",
        description: "Retrieve the currently active project that Omnixa is working with.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("project-instance.initGit", `${root}/git/init`, {
      query: WorkspaceRoutingQuery,
      success: described(ForkProjectInfo, "Project information after git initialization"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.instance.initGit",
        summary: "Initialize git repository",
        description: "Create a git repository for the current project and return the refreshed project info.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("project-instance.update", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      query: WorkspaceRoutingQuery,
      payload: ProjectUpdatePayload,
      success: described(ForkProjectInfo, "Updated project information"),
      error: [InvalidRequestError, ProjectNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.instance.update",
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("project-instance.directories", `${root}/:projectID/directories`, {
      params: { projectID: Project.ID },
      query: WorkspaceRoutingQuery,
      success: described(ProjectDirectories, "Project directories"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.instance.directories",
        summary: "List project directories",
        description: "List known local absolute directories for a project.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "project",
      description: "Experimental HttpApi project routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
