import { Agent } from "@aigcfroge/schema/agent"
import { ProductMode } from "@aigcfroge/schema/product-mode"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ApiVcsApplyError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
export const InstancePathInfo = Schema.Struct({
  home: Schema.String,
  state: Schema.String,
  config: Schema.String,
  worktree: Schema.String,
  directory: Schema.String,
}).annotate({ identifier: "Instance.PathInfo" })

/** Lifted from the fork entry project VCS contract. */
export const VcsMode = Schema.Literals(["git", "branch"]).annotate({ identifier: "InstanceVcs.Mode" })

export const VcsInfo = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
}).annotate({ identifier: "InstanceVcs.Info" })

export const VcsFileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.optional(Schema.String),
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
}).annotate({ identifier: "InstanceVcs.FileDiff" })

export const VcsFileStatus = Schema.Struct({
  file: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  status: Schema.Literals(["added", "deleted", "modified"]),
  staged: Schema.Boolean,
}).annotate({ identifier: "InstanceVcs.FileStatus" })

export const VcsCommitEntry = Schema.Struct({
  hash: Schema.String,
  message: Schema.String,
  author: Schema.String,
  date: Schema.String,
}).annotate({ identifier: "InstanceVcs.CommitEntry" })

export const VcsApplyInput = Schema.Struct({
  patch: Schema.String,
}).annotate({ identifier: "InstanceVcs.ApplyInput" })

export const VcsApplyResult = Schema.Struct({
  applied: Schema.Boolean,
}).annotate({ identifier: "InstanceVcs.ApplyResult" })

export const VcsDiffQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  mode: VcsMode,
  context: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
}).annotate({ identifier: "InstanceVcs.DiffQuery" })

/** Lifted from the fork entry command registry (wire template is a string). */
export const CommandInstanceInfo = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  template: Schema.String,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "CommandInstance.Info" })

/** Lifted from the fork entry skill registry. */
export const SkillInstanceInfo = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  location: Schema.String,
  content: Schema.String,
}).annotate({ identifier: "SkillInstance.Info" })

/**
 * `/agent` response projection: the shared core `Agent.Info` stays untouched, and
 * the modes each agent may serve as primary are computed by the policy owner.
 */
export const AgentWithPrimaryModes = Schema.Struct({
  ...Agent.Info.fields,
  primaryModes: Schema.Array(ProductMode.ID),
}).annotate({ identifier: "InstanceAgent.Info" })
export interface AgentWithPrimaryModes extends Schema.Schema.Type<typeof AgentWithPrimaryModes> {}

export const LSPStatus = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  root: Schema.String,
  status: Schema.Literals(["connected", "error"]),
}).annotate({ identifier: "LSP.Status" })

export const FormatterStatus = Schema.Struct({
  name: Schema.String,
  extensions: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "Formatter.Status" })

export const InstanceGroup = HttpApiGroup.make("instance-instance")
  .add(
    HttpApiEndpoint.post("instance-instance.dispose", "/instance/dispose", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Instance disposed"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.instance.dispose",
        summary: "Dispose instance",
        description: "Clean up and dispose the instance, releasing all resources.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.path", "/path", {
      query: WorkspaceRoutingQuery,
      success: described(InstancePathInfo, "Path information"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.path.get",
        summary: "Get paths",
        description: "Retrieve the current working directory and related path information for the instance.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.vcs", "/vcs", {
      query: WorkspaceRoutingQuery,
      success: described(VcsInfo, "VCS info"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.get",
        summary: "Get VCS info",
        description: "Retrieve version control system (VCS) information for the current instance.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.vcsStatus", "/vcs/status", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(VcsFileStatus), "VCS status"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.status",
        summary: "Get VCS status",
        description: "Retrieve the current git status of all files in the instance.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.vcsDiff", "/vcs/diff", {
      query: VcsDiffQuery,
      success: described(Schema.Array(VcsFileDiff), "VCS diff"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.diff",
        summary: "Get VCS diff",
        description: "Retrieve the git diff of files in the instance.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.vcsDiffRaw", "/vcs/diff/raw", {
      query: VcsDiffQuery,
      success: described(
        Schema.Struct({ file: Schema.String, patch: Schema.String }),
        "Raw VCS diff",
      ),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.diffRaw",
        summary: "Get raw VCS diff",
        description: "Retrieve the raw git diff patch for a single file.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("instance-instance.vcsApply", "/vcs/apply", {
      query: WorkspaceRoutingQuery,
      payload: VcsApplyInput,
      success: described(VcsApplyResult, "VCS patch applied"),
      error: ApiVcsApplyError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.apply",
        summary: "Apply VCS patch",
        description: "Apply a git patch to the instance working tree.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("instance-instance.vcsStage", "/vcs/stage", {
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({ files: Schema.Array(Schema.String) }),
      success: described(HttpApiSchema.NoContent, "Files staged"),
      error: ApiVcsApplyError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.stage",
        summary: "Stage files",
        description: "Stage the given files.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("instance-instance.vcsUnstage", "/vcs/unstage", {
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({ files: Schema.Array(Schema.String) }),
      success: described(HttpApiSchema.NoContent, "Files unstaged"),
      error: ApiVcsApplyError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.unstage",
        summary: "Unstage files",
        description: "Unstage the given files.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("instance-instance.vcsCommit", "/vcs/commit", {
      query: WorkspaceRoutingQuery,
      payload: Schema.Struct({ message: Schema.String }),
      success: described(HttpApiSchema.NoContent, "Changes committed"),
      error: ApiVcsApplyError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.commit",
        summary: "Commit changes",
        description: "Commit staged changes with the given message.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.vcsLog", "/vcs/log", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(VcsCommitEntry), "Commit log"),
      error: ApiVcsApplyError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.vcs.log",
        summary: "Get commit log",
        description: "Retrieve the recent commit log.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.command", "/command", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(CommandInstanceInfo), "List of commands"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.command.list",
        summary: "List commands",
        description: "Get a list of all available commands in the system.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.agent", "/agent", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(AgentWithPrimaryModes), "List of agents"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.agent.list",
        summary: "List agents",
        description: "Get a list of all available agents.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.skill", "/skill", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(SkillInstanceInfo), "List of skills"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.skill.list",
        summary: "List skills",
        description: "Get a list of all available skills.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.lsp", "/lsp", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(LSPStatus), "LSP server status"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.lsp.status",
        summary: "List LSP server status",
        description: "Get the status of language server protocol (LSP) servers.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("instance-instance.formatter", "/formatter", {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(FormatterStatus), "Formatter status"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "instance.formatter.status",
        summary: "List formatter status",
        description: "Get the status of file formatters.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "instance",
      description: "Experimental HttpApi instance routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
