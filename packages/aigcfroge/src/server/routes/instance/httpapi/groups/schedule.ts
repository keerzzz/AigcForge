export * as ScheduleApiGroup from "./schedule"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Schedule } from "@aigcfroge/schema/schedule"
import { described } from "./metadata"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"

// Root is outside `/session/:sessionID` on purpose: the workspace-routing
// middleware parses `/session/<segment>` as a session id, so schedule reads
// keyed by a literal session id must not live under the session prefix.
const root = "/schedule"
const deliveryRoot = "/delivery"

export const ScheduleApi = HttpApi.make("schedule").add(
  HttpApiGroup.make("schedule")
    .add(
      HttpApiEndpoint.get("pending", `${root}/pending`, {
        success: described(Schema.Array(Schedule.Info), "All pending schedules process-wide"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "schedule.pending",
          summary: "All pending schedules",
          description: "Cross-session pending schedule list for the assistant dashboard and icon-rail badge.",
        }),
      ),
      HttpApiEndpoint.get("list", `${root}/:sessionID`, {
        params: Schema.Struct({ sessionID: Schema.String }),
        success: described(Schema.Array(Schedule.Info), "Schedules of a session"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "schedule.list",
          summary: "List schedules of a session",
        }),
      ),
      HttpApiEndpoint.post("cancel", `${root}/:id/cancel`, {
        params: Schema.Struct({ id: Schema.String }),
        success: described(Schedule.Info, "The cancelled schedule"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "schedule.cancel",
          summary: "Cancel a reminder",
          description: "A cancelled reminder is never delivered.",
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get("recent", `${deliveryRoot}/recent`, {
        query: Schema.Struct({ limit: Schema.optional(Schema.Number) }),
        success: described(Schema.Array(Schedule.Delivery), "Recent inbox records process-wide"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "delivery.recent",
          summary: "Recent deliveries",
          description: "Cross-session recent inbox records for the assistant dashboard.",
        }),
      ),
      HttpApiEndpoint.get("inbox", `${deliveryRoot}/:sessionID`, {
        params: Schema.Struct({ sessionID: Schema.String }),
        success: described(Schema.Array(Schedule.Delivery), "Inbox deliveries of a session"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "delivery.inbox",
          summary: "List the inbox of a session",
        }),
      ),
      HttpApiEndpoint.post("read", `${deliveryRoot}/:deliveryKey/read`, {
        params: Schema.Struct({ deliveryKey: Schema.String }),
        success: described(Schema.Void, "Mark a delivery read"),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "delivery.read",
          summary: "Mark an inbox delivery read",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
