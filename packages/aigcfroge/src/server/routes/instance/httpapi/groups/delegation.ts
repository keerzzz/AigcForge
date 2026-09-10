export * as DelegationApiGroup from "./delegation"

import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { SessionV2 } from "@aigcfroge/core/session"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { QueryBoolean } from "./query"

export const LegacyDelegationState = Schema.Struct({
  delegation: Delegation.Info,
  participants: Schema.Array(Delegation.ParticipantInfo),
  turns: Schema.Array(Delegation.TurnInfo),
  softExpired: Schema.Boolean,
})
const query = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  parentSessionID: SessionV2.ID.pipe(Schema.optional),
  includeArchived: QueryBoolean.pipe(Schema.optional),
})
const locationQuery = Schema.Struct(WorkspaceRoutingQueryFields)
const endpoint = (operation: string, summary: string) =>
  OpenApi.annotations({ identifier: `legacy.delegation.${operation}`, summary })
const root = "/delegation"
const group = HttpApiGroup.make("delegation")
  .add(
    HttpApiEndpoint.get("list", root, {
      query,
      success: Schema.Array(LegacyDelegationState),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("list", "List persistent delegations")),
    HttpApiEndpoint.post("create", root, {
      query: locationQuery,
      payload: Schema.Struct({ parentSessionID: SessionV2.ID, title: Schema.String }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("create", "Create persistent delegation")),
    HttpApiEndpoint.get("get", `${root}/:delegationID`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("get", "Get persistent delegation")),
    HttpApiEndpoint.post("addParticipant", `${root}/:delegationID/participant`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({
        provider: Schema.String,
        target: Schema.String,
        role: Delegation.ParticipantRole,
        context: Delegation.ParticipantContext,
      }),
      success: Delegation.ParticipantInfo,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("addParticipant", "Add delegation participant")),
    HttpApiEndpoint.get("listTurns", `${root}/:delegationID/turn`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: Schema.Array(Delegation.TurnInfo),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("listTurns", "List delegation turns")),
    HttpApiEndpoint.post("appendTurn", `${root}/:delegationID/turn`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
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
      error: InvalidRequestError,
    }).annotateMerge(endpoint("appendTurn", "Append delegation turn")),
    HttpApiEndpoint.post("retry", `${root}/:delegationID/turn/:turnID/retry`, {
      params: { delegationID: DelegationID.ID, turnID: TurnID },
      query: locationQuery,
      payload: Schema.Struct({ participantID: ParticipantID }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("retry", "Retry delegation delivery")),
    HttpApiEndpoint.post("reconcile", `${root}/:delegationID/reconcile`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({
        participantID: ParticipantID.pipe(Schema.optional),
        turnID: TurnID.pipe(Schema.optional),
        decision: Schema.Literals(["resume", "retry", "fork", "close"]),
      }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("reconcile", "Reconcile delegation")),
    HttpApiEndpoint.post("retractRejection", `${root}/:delegationID/review/retract-rejection`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ participantID: ParticipantID.pipe(Schema.optional), reason: Schema.String }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("retractRejection", "Retract rejection")),
    HttpApiEndpoint.post("steer", `${root}/:delegationID/steer`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ turnID: TurnID, participantID: ParticipantID }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("steer", "Wake an admitted delegation turn")),
    HttpApiEndpoint.post("interrupt", `${root}/:delegationID/interrupt`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ participantID: ParticipantID.pipe(Schema.optional) }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("interrupt", "Interrupt delegation")),
    HttpApiEndpoint.post("complete", `${root}/:delegationID/complete`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ summary: Schema.String.pipe(Schema.optional) }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("complete", "Complete delegation")),
    HttpApiEndpoint.post("close", `${root}/:delegationID/close`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ reason: Schema.String.pipe(Schema.optional) }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("close", "Close delegation")),
    HttpApiEndpoint.post("archive", `${root}/:delegationID/archive`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("archive", "Archive delegation")),
    HttpApiEndpoint.post("unarchive", `${root}/:delegationID/unarchive`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("unarchive", "Unarchive delegation")),
    HttpApiEndpoint.post("fork", `${root}/:delegationID/fork`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({
        title: Schema.String.pipe(Schema.optional),
        reason: Schema.String.pipe(Schema.optional),
      }),
      success: LegacyDelegationState,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("fork", "Fork delegation")),
    HttpApiEndpoint.delete("delete", `${root}/:delegationID`, {
      params: { delegationID: DelegationID.ID },
      query: Schema.Struct({
        ...WorkspaceRoutingQueryFields,
        purge: QueryBoolean,
      }),
      success: Schema.Void,
      error: InvalidRequestError,
    }).annotateMerge(endpoint("delete", "Purge delegation")),
  )
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)

export const DelegationApi = HttpApi.make("delegation").add(group)
