export * as AgentTaskApiGroup from "./agent-task"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { SessionTask } from "@aigcfroge/core/session/task"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

// Root is outside `/session/:sessionID` on purpose: the workspace-routing
// middleware parses `/session/<segment>` as a session id, so a literal
// cross-session read must not live under the session prefix.
const root = "/agent-task"

export const AgentTaskApi = HttpApi.make("agent-task").add(
  HttpApiGroup.make("agent-task")
    .add(
      HttpApiEndpoint.get("list", root, {
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
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
