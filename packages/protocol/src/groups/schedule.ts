import { Schedule } from "@aigcfroge/schema/schedule"
import { Session } from "@aigcfroge/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
// Root is outside `/session/:sessionID` on purpose: the workspace-routing
// middleware parses `/session/<segment>` as a session id, so schedule reads
// keyed by a literal session id must not live under the session prefix.
const root = "/schedule"
const deliveryRoot = "/delivery"

// Negative limits reach SQLite's unbounded LIMIT -1; bound them like the
// session group's pagination.
const NonNegativeLimit = Schema.optional(
  Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)

// Delivery keys live in a route segment (`/delivery/:deliveryKey/read`); a key
// containing a path separator would split the route, so reject those at the
// schema boundary (one or more non-separator characters).
const DeliveryKeyParam = Schema.String.pipe(Schema.check(Schema.isPattern(/^[^/\\]+$/)))

export const ScheduleGroup = HttpApiGroup.make("schedule")
  .add(
    HttpApiEndpoint.get("schedule.pending", `${root}/pending`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      success: described(Schema.Array(Schedule.Info), "All pending schedules process-wide"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "schedule.pending",
        summary: "All pending schedules",
        description: "Cross-session pending schedule list for the assistant dashboard and icon-rail badge.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("schedule.list", `${root}/:sessionID`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ sessionID: Session.ID }),
      success: described(Schema.Array(Schedule.Info), "Schedules of a session"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "schedule.list",
        summary: "List schedules of a session",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("schedule.cancel", `${root}/:id/cancel`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      error: InvalidRequestError,
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
    HttpApiEndpoint.post("schedule.create", `${root}/rule`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      payload: Schedule.Create,
      error: InvalidRequestError,
      success: described(Schedule.Rule, "The created schedule rule"),
    }),
  )
  .add(
    HttpApiEndpoint.get("schedule.rules", `${root}/rules/:sessionID`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ sessionID: Session.ID }),
      success: described(Schema.Array(Schedule.Rule), "Rules owned by the source session"),
    }),
  )
  .add(
    HttpApiEndpoint.get("schedule.rule", `${root}/rule/:id`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      error: InvalidRequestError,
      success: described(Schedule.Rule, "The current rule revision"),
    }),
  )
  .add(
    HttpApiEndpoint.patch("schedule.edit", `${root}/rule/:id`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      payload: Schedule.Edit,
      error: InvalidRequestError,
      success: described(Schedule.Rule, "The edited rule"),
    }),
  )
  .add(
    HttpApiEndpoint.post("schedule.pause", `${root}/rule/:id/pause`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      payload: Schedule.Mutation,
      error: InvalidRequestError,
      success: described(Schedule.Rule, "The paused rule"),
    }),
  )
  .add(
    HttpApiEndpoint.post("schedule.resume", `${root}/rule/:id/resume`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      payload: Schedule.Mutation,
      error: InvalidRequestError,
      success: described(Schedule.Rule, "The resumed rule"),
    }),
  )
  .add(
    HttpApiEndpoint.post("schedule.cancelRule", `${root}/rule/:id/cancel`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      payload: Schedule.Mutation,
      error: InvalidRequestError,
      success: described(Schedule.Rule, "The cancelled rule with preserved occurrence history"),
    }),
  )
  .add(
    HttpApiEndpoint.post("schedule.runOnce", `${root}/rule/:id/run`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      payload: Schedule.Mutation,
      error: InvalidRequestError,
      success: described(Schedule.Occurrence, "The claimed occurrence and its admission state"),
    }),
  )
  .add(
    HttpApiEndpoint.get("schedule.runs", `${root}/rule/:id/runs`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ id: Schedule.ID }),
      error: InvalidRequestError,
      success: described(Schema.Array(Schedule.Occurrence), "Independent occurrence receipts, newest first"),
    }),
  )
  .add(
    HttpApiEndpoint.post("schedule.cancelRun", `${root}/run/:occurrenceID/cancel`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ occurrenceID: Schedule.OccurrenceID }),
      error: InvalidRequestError,
      success: described(Schedule.Occurrence, "The occurrence cancellation state"),
    }),
  )
  .add(
    HttpApiEndpoint.get("delivery.recent", `${deliveryRoot}/recent`, {
      query: Schema.Struct({ ...WorkspaceRoutingQueryFields, limit: NonNegativeLimit }),
      success: described(Schema.Array(Schedule.Delivery), "Recent inbox records process-wide"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "delivery.recent",
        summary: "Recent deliveries",
        description: "Cross-session recent inbox records for the assistant dashboard.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("delivery.inbox", `${deliveryRoot}/:sessionID`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ sessionID: Session.ID }),
      success: described(Schema.Array(Schedule.Delivery), "Inbox deliveries of a session"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "delivery.inbox",
        summary: "List the inbox of a session",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("delivery.read", `${deliveryRoot}/:deliveryKey/read`, {
      query: Schema.Struct(WorkspaceRoutingQueryFields),
      params: Schema.Struct({ deliveryKey: DeliveryKeyParam }),
      success: described(Schema.Void, "Mark a delivery read"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "delivery.read",
        summary: "Mark an inbox delivery read",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "schedule",
      description: "Schedules and assistant inbox deliveries.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
