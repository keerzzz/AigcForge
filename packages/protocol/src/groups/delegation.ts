import { Delegation } from "@aigcfroge/schema/delegation"
import { DelegationID, ParticipantID, TurnID } from "@aigcfroge/schema/delegation-id"
import { Session } from "@aigcfroge/schema/session"
import { optional } from "@aigcfroge/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { InvalidRequestError } from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"
import { QueryBoolean } from "./query.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
export const LegacyDelegationState = Schema.Struct({
  delegation: Delegation.Info,
  participants: Schema.Array(Delegation.ParticipantInfo),
  turns: Schema.Array(Delegation.TurnInfo),
  softExpired: Schema.Boolean,
  deliveries: optional(Schema.Array(Delegation.DeliveryInfo)),
  reviews: optional(Schema.Array(Delegation.ReviewRecord)),
  revisions: optional(Schema.Array(Delegation.RevisionRecord)),
  archivedFrom: optional(Schema.Literals(["completed", "cancelled"])),
  barrier: optional(Delegation.Barrier),
}).annotate({ identifier: "Delegation.LegacyState" })

const query = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  parentSessionID: Session.ID.pipe(Schema.optional),
  includeArchived: QueryBoolean.pipe(Schema.optional),
})

const locationQuery = Schema.Struct(WorkspaceRoutingQueryFields)

const endpoint = (operation: string, summary: string) =>
  OpenApi.annotations({ identifier: `legacy.delegation.${operation}`, summary })

const root = "/delegation"

export const DelegationGroup = HttpApiGroup.make("delegation")
  .add(
    HttpApiEndpoint.get(
      "delegation.result",
      "/delegation/:delegationID/turn/:turnID/participant/:participantID/result",
      {
        params: { delegationID: DelegationID.ID, turnID: TurnID, participantID: ParticipantID },
        query: Schema.Struct({
          ...WorkspaceRoutingQueryFields,
          deliveryOrigin: Schema.String,
          senderParticipantID: ParticipantID,
          attempt: Schema.NumberFromString,
        }),
        success: described(Delegation.Result, "Exact admitted delivery result"),
        error: [InvalidRequestError],
      },
    ).annotateMerge(endpoint("result", "Read exact delivery result")),
  )
  .add(
    HttpApiEndpoint.get("delegation.list", root, {
      query,
      success: described(Schema.Array(LegacyDelegationState), "List persistent delegations"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("list", "List persistent delegations")),
  )
  .add(
    HttpApiEndpoint.post("delegation.create", root, {
      query: locationQuery,
      payload: Schema.Struct({
        parentSessionID: Session.ID,
        title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
      }),
      success: described(LegacyDelegationState, "Created persistent delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("create", "Create persistent delegation")),
  )
  .add(
    HttpApiEndpoint.get("delegation.get", `${root}/:delegationID`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: described(LegacyDelegationState, "Get persistent delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("get", "Get persistent delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.addParticipant", `${root}/:delegationID/participant`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({
        provider: Schema.String.check(Schema.isMinLength(1)),
        target: Schema.String.check(Schema.isMinLength(1)),
        role: Delegation.ParticipantRole,
        context: Delegation.ParticipantContext,
      }),
      success: described(Delegation.ParticipantInfo, "Added delegation participant"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("addParticipant", "Add delegation participant")),
  )
  .add(
    HttpApiEndpoint.get("delegation.listTurns", `${root}/:delegationID/turn`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: described(Schema.Array(Delegation.TurnInfo), "List delegation turns"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("listTurns", "List delegation turns")),
  )
  .add(
    HttpApiEndpoint.post("delegation.appendTurn", `${root}/:delegationID/turn`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({
        kind: Delegation.TurnKind,
        /** Full task text is admitted only into target Sessions. Omission keeps historical admit-only behavior. */
        prompt: Schema.String.check(Schema.isMinLength(1)).pipe(Schema.optional),
        promptSummary: Schema.String.pipe(Schema.optional),
        evidenceDigest: Schema.String.pipe(Schema.optional),
        revisionDigest: Delegation.RevisionDigest.pipe(Schema.optional),
        participantIDs: Schema.Array(ParticipantID),
        delivery: Delegation.DeliveryIntent,
        deliveryOrigin: Schema.String,
        senderParticipantID: ParticipantID,
      }),
      success: described(Delegation.TurnInfo, "Appended delegation turn"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("appendTurn", "Append delegation turn")),
  )
  .add(
    HttpApiEndpoint.post("delegation.retry", `${root}/:delegationID/turn/:turnID/retry`, {
      params: { delegationID: DelegationID.ID, turnID: TurnID },
      query: locationQuery,
      payload: Schema.Struct({ participantID: ParticipantID }),
      success: described(LegacyDelegationState, "Retried delegation delivery"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("retry", "Retry delegation delivery")),
  )
  .add(
    HttpApiEndpoint.post("delegation.reconcile", `${root}/:delegationID/reconcile`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({
        participantID: ParticipantID.pipe(Schema.optional),
        turnID: TurnID.pipe(Schema.optional),
        decision: Schema.Literals(["resume", "retry", "fork", "close"]),
      }),
      success: described(LegacyDelegationState, "Reconciled delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("reconcile", "Reconcile delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.retractRejection", `${root}/:delegationID/review/retract-rejection`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ participantID: ParticipantID.pipe(Schema.optional), reason: Schema.String }),
      success: described(LegacyDelegationState, "Retracted rejection"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("retractRejection", "Retract rejection")),
  )
  .add(
    HttpApiEndpoint.post("delegation.steer", `${root}/:delegationID/steer`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ turnID: TurnID, participantID: ParticipantID }),
      success: described(LegacyDelegationState, "Steered delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("steer", "Wake an admitted delegation turn")),
  )
  .add(
    HttpApiEndpoint.post("delegation.interrupt", `${root}/:delegationID/interrupt`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ participantID: ParticipantID.pipe(Schema.optional) }),
      success: described(LegacyDelegationState, "Interrupted delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("interrupt", "Interrupt delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.complete", `${root}/:delegationID/complete`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ summary: Schema.String.pipe(Schema.optional) }),
      success: described(LegacyDelegationState, "Completed delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("complete", "Complete delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.close", `${root}/:delegationID/close`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({ reason: Schema.String.pipe(Schema.optional) }),
      success: described(LegacyDelegationState, "Closed delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("close", "Close delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.archive", `${root}/:delegationID/archive`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: described(LegacyDelegationState, "Archived delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("archive", "Archive delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.unarchive", `${root}/:delegationID/unarchive`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      success: described(LegacyDelegationState, "Unarchived delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("unarchive", "Unarchive delegation")),
  )
  .add(
    HttpApiEndpoint.post("delegation.fork", `${root}/:delegationID/fork`, {
      params: { delegationID: DelegationID.ID },
      query: locationQuery,
      payload: Schema.Struct({
        title: Schema.String.pipe(Schema.optional),
        reason: Schema.String.pipe(Schema.optional),
      }),
      success: described(LegacyDelegationState, "Forked delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("fork", "Fork delegation")),
  )
  .add(
    HttpApiEndpoint.delete("delegation.delete", `${root}/:delegationID`, {
      params: { delegationID: DelegationID.ID },
      query: Schema.Struct({
        ...WorkspaceRoutingQueryFields,
        purge: QueryBoolean,
      }),
      success: described(Schema.Void, "Purged delegation"),
      error: InvalidRequestError,
    }).annotateMerge(endpoint("delete", "Purge delegation")),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "delegation",
      description: "Persistent delegation lifecycle (Meta-Agent infra).",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
