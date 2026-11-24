import { Event } from "@omnixa/schema/event"
import { NonNegativeInt } from "@omnixa/schema/schema"
import { Session } from "@omnixa/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQuery } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained sync surface (see prompt-asset.ts for the conventions).
const root = "/sync"

export const SyncReplayEvent = Schema.Struct({
  id: Event.ID,
  aggregateID: Schema.String,
  seq: NonNegativeInt,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "Sync.ReplayEvent" })

export const SyncReplayPayload = Schema.Struct({
  directory: Schema.String,
  events: Schema.NonEmptyArray(SyncReplayEvent),
}).annotate({ identifier: "Sync.ReplayPayload" })

export const SyncReplayResponse = Schema.Struct({
  sessionID: Schema.String,
}).annotate({ identifier: "Sync.ReplayResponse" })

export const SyncSessionPayload = Schema.Struct({
  sessionID: Session.ID,
}).annotate({ identifier: "Sync.SessionPayload" })

export const SyncHistoryPayload = Schema.Record(Schema.String, NonNegativeInt).annotate({
  identifier: "Sync.HistoryPayload",
})

export const SyncHistoryEvent = Schema.Struct({
  id: Event.ID,
  aggregate_id: Schema.String,
  seq: NonNegativeInt,
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Unknown),
}).annotate({ identifier: "Sync.HistoryEvent" })

export const SyncGroup = HttpApiGroup.make("sync")
  .add(
    HttpApiEndpoint.post("sync.start", `${root}/start`, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Boolean, "Workspace sync started"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.start",
        summary: "Start workspace sync",
        description: "Start sync loops for workspaces in the current project that have active sessions.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.replay", `${root}/replay`, {
      // Fork wire: the client sends `directory` inside the body ({directory, events}),
      // never as a query param. The query keeps only `workspace` so the compiled
      // client input has a single `directory` field (no query/body collision).
      query: Schema.Struct({ workspace: Schema.optional(Schema.String) }),
      payload: SyncReplayPayload,
      success: described(SyncReplayResponse, "Replayed sync events"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.replay",
        summary: "Replay sync events",
        description: "Validate and replay a complete sync event history.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.steal", `${root}/steal`, {
      query: WorkspaceRoutingQuery,
      payload: SyncSessionPayload,
      success: described(SyncSessionPayload, "Session stolen into workspace"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.steal",
        summary: "Steal session into workspace",
        description: "Update a session to belong to the current workspace through the sync event system.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("sync.history", `${root}/history`, {
      query: WorkspaceRoutingQuery,
      payload: SyncHistoryPayload,
      success: described(Schema.Array(SyncHistoryEvent), "Sync events"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sync.history.list",
        summary: "List sync events",
        description:
          "List sync events for all aggregates. Keys are aggregate IDs the client already knows about, values are the last known sequence ID. Events with seq > value are returned for those aggregates. Aggregates not listed in the input get their full history.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "sync",
      description: "Experimental HttpApi sync routes.",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
