import { SessionTask } from "@omnixa/schema/session-task"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Root is outside `/session/:sessionID` on purpose: the workspace-routing
// middleware parses `/session/<segment>` as a session id, so a literal
// cross-session read must not live under the session prefix.
const root = "/agent-task"

export const AgentTaskGroup = HttpApiGroup.make("agent-task")
  .add(
    HttpApiEndpoint.get("agent-task.list", root, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      success: described(Schema.Array(SessionTask.Info), "All tasks across sessions"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "agent-task.list",
        summary: "Aggregate all tasks across sessions",
        description:
          "Cross-session task aggregation for the Agent Hub: every task across all sessions, each carrying its owning sessionID and agentID so the client can group by agent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "agent-task",
      description: "Cross-session task aggregation (Agent Hub).",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
