import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { SessionV2 } from "@aigcfroge/core/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, ForbiddenError, InvalidRequestError, SessionNotFoundError } from "../errors"
import { LocationMiddleware, LocationQuery, locationQueryOpenApi } from "./location"
import { QueryBoolean } from "../query-boolean"

export const DelegationState = Schema.Struct({
  delegation: Delegation.Info,
  participants: Schema.Array(Delegation.ParticipantInfo),
  turns: Schema.Array(Delegation.TurnInfo),
  softExpired: Schema.Boolean,
}).annotate({ identifier: "DelegationState" })

const query = Schema.Struct({
  ...LocationQuery.fields,
  parentSessionID: SessionV2.ID.pipe(Schema.optional),
  includeArchived: QueryBoolean.schema.pipe(Schema.optional),
})
const errors = [InvalidRequestError, SessionNotFoundError, ForbiddenError, ConflictError] as const
const route = (operation: string, summary: string) =>
  OpenApi.annotations({ identifier: `v2.delegation.${operation}`, summary })

export const DelegationGroup = HttpApiGroup.make("server.delegation")
  .add(
    HttpApiEndpoint.get("delegation.list", "/api/delegation", {
      query,
      success: Schema.Array(DelegationState),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("list", "List persistent delegations")),
  )
  .add(
    HttpApiEndpoint.post("delegation.create", "/api/delegation", {
      query: LocationQuery,
      payload: Schema.Struct({ parentSessionID: SessionV2.ID, title: Schema.String }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("create", "Create persistent delegation")),
  )
  .add(
    HttpApiEndpoint.get("delegation.get", "/api/delegation/:delegationID", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("get", "Get persistent delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.addParticipant", "/api/delegation/:delegationID/participant", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        provider: Schema.String,
        target: Schema.String,
        role: Delegation.ParticipantRole,
        context: Delegation.ParticipantContext,
      }),
      success: Delegation.ParticipantInfo,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("addParticipant", "Add delegation participant")),
  )
  .add(
    HttpApiEndpoint.get("delegation.listTurns", "/api/delegation/:delegationID/turn", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      success: Schema.Array(Delegation.TurnInfo),
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("listTurns", "List delegation turns")),
  )
  .add(
    HttpApiEndpoint.post("delegation.appendTurn", "/api/delegation/:delegationID/turn", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        kind: Delegation.TurnKind,
        promptSummary: Schema.String.pipe(Schema.optional),
        evidenceDigest: Schema.String.pipe(Schema.optional),
        revisionDigest: Delegation.RevisionDigest.pipe(Schema.optional),
        participantIDs: Schema.Array(ParticipantID),
        delivery: Delegation.DeliveryIntent,
        deliveryOrigin: Schema.String,
        senderParticipantID: ParticipantID,
      }),
      success: Delegation.TurnInfo,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("appendTurn", "Append delegation turn")),
  )
  .add(
    HttpApiEndpoint.post("delegation.retry", "/api/delegation/:delegationID/turn/:turnID/retry", {
      params: { delegationID: DelegationID.ID, turnID: TurnID },
      query: LocationQuery,
      payload: Schema.Struct({ participantID: ParticipantID }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("retry", "Retry delegation delivery")),
  )
  .add(
    HttpApiEndpoint.post("delegation.reconcile", "/api/delegation/:delegationID/reconcile", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        participantID: ParticipantID.pipe(Schema.optional),
        turnID: TurnID.pipe(Schema.optional),
        decision: Schema.Literals(["resume", "retry", "fork", "close"]),
      }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("reconcile", "Reconcile delegation recovery")),
  )
  .add(
    HttpApiEndpoint.post("delegation.retractRejection", "/api/delegation/:delegationID/review/retract-rejection", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({ participantID: ParticipantID.pipe(Schema.optional), reason: Schema.String }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("retractRejection", "Retract delegation rejection")),
  )
  .add(
    HttpApiEndpoint.post("delegation.steer", "/api/delegation/:delegationID/steer", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({ turnID: TurnID, participantID: ParticipantID }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("steer", "Wake an admitted delegation turn")),
  )
  .add(
    HttpApiEndpoint.post("delegation.interrupt", "/api/delegation/:delegationID/interrupt", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({ participantID: ParticipantID.pipe(Schema.optional) }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("interrupt", "Interrupt delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.complete", "/api/delegation/:delegationID/complete", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({ summary: Schema.String.pipe(Schema.optional) }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("complete", "Complete and archive delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.close", "/api/delegation/:delegationID/close", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({ reason: Schema.String.pipe(Schema.optional) }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("close", "Close delegation admission")),
  )
  .add(
    HttpApiEndpoint.post("delegation.archive", "/api/delegation/:delegationID/archive", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("archive", "Archive delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.unarchive", "/api/delegation/:delegationID/unarchive", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("unarchive", "Unarchive delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.fork", "/api/delegation/:delegationID/fork", {
      params: { delegationID: DelegationID.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        title: Schema.String.pipe(Schema.optional),
        reason: Schema.String.pipe(Schema.optional),
      }),
      success: DelegationState,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("fork", "Fork delegation")),
  )
  .add(
    HttpApiEndpoint.delete("delegation.delete", "/api/delegation/:delegationID", {
      params: { delegationID: DelegationID.ID },
      query: Schema.Struct({ ...LocationQuery.fields, purge: QueryBoolean.schema }),
      success: HttpApiSchema.NoContent,
      error: errors,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(route("delete", "Purge delegation")),
  )
  .middleware(LocationMiddleware)
  .annotateMerge(OpenApi.annotations({ title: "delegation", description: "Persistent delegation routes." }))
