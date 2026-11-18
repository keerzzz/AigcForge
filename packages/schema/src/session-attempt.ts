export * as SessionAttempt from "./session-attempt.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { Event } from "./event.js"
import { Model } from "./model.js"
import { ModelSource } from "./model-source.js"
import { SessionGoalID } from "./session-goal-id.js"
import { SessionProviderContext } from "./session-provider-context.js"
import { TokenUsage } from "./token-usage.js"
import { Money } from "./money.js"
import { FinishReason } from "./llm.js"
import { NonNegativeInt, optional } from "./schema.js"

export const Delivery = Schema.Literals(["not-sent", "rejected", "ambiguous", "accepted", "unknown"]).annotate({
  identifier: "SessionAttempt.Delivery",
})
export type Delivery = typeof Delivery.Type

export class Failure extends Schema.Class<Failure>("SessionAttempt.Failure")({
  reason: Schema.Literals([
    "InvalidRequest", "UnsupportedOperation", "NoRoute", "Authentication", "RateLimit", "QuotaExceeded",
    "ContentPolicy", "ProviderInternal", "Transport", "InvalidProviderOutput", "UnknownProvider", "Timeout",
  ]),
  classification: Schema.Literals(["context-overflow", "payload-too-large", "model-not-found", "incomplete-stream"]).pipe(optional),
  status: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 })).pipe(optional),
  transport: Schema.Literals(["http", "websocket"]).pipe(optional),
  operation: Schema.Literals(["request", "read", "write"]).pipe(optional),
  phase: Schema.Literals(["prepare", "queue", "connect", "send", "receive", "decode", "complete", "fallback", "close"]).pipe(optional),
  delivery: Delivery.pipe(optional),
  recovery: Schema.Literals(["retry-connect", "retry-full", "rotate-and-retry-full", "fallback-http", "fail"]).pipe(optional),
}) {}

export class Started extends Schema.Class<Started>("SessionAttempt.Started")({
  ordinal: NonNegativeInt,
  attemptID: Schema.String,
  agent: Agent.ID,
  selection: Model.Selection,
  behaviorDigest: Schema.String.pipe(optional),
  /** Identifies the authored member when physical model and connection references overlap. */
  groupMemberIndex: NonNegativeInt.pipe(optional),
  model: Model.Ref,
  apiModelID: Schema.String,
  connection: ModelSource.ConnectionRef.pipe(optional),
  preparedDeployment: SessionProviderContext.Provenance.pipe(optional),
  quote: ModelSource.Quote,
  quoteOrigin: ModelSource.Origin.pipe(optional),
  quota: ModelSource.Quota.pipe(optional),
  goalRefs: Schema.Array(SessionGoalID.AttemptRef),
  transition: Schema.Literals(["initial", "retry", "fallback", "continuation"]),
  reason: Failure.pipe(optional),
  started: NonNegativeInt,
}) {}

export class Observation extends Schema.Class<Observation>("SessionAttempt.Observation")({
  observedAt: NonNegativeInt,
  deployment: SessionProviderContext.Provenance.pipe(optional),
  transport: Schema.Literals(["http", "websocket"]).pipe(optional),
  delivery: Delivery.pipe(optional),
  outputStarted: Schema.Literal(true).pipe(optional),
  /** Time at the first attributable output boundary; it is not a first-token measurement. */
  firstOutputAt: NonNegativeInt.pipe(optional),
  /** First nonempty text, reasoning or tool-input delta received for this physical attempt. */
  firstTokenAt: NonNegativeInt.pipe(optional),
  /** Early gateway headers are diagnostics, independent of the attempt's actual deployment. */
  gatewayReport: Schema.Struct({
    source: Schema.Literal("response-headers"),
    provider: Schema.String.pipe(optional),
    model: Schema.String.pipe(optional),
  }).pipe(optional),
}) {}

export class RecordedObservation extends Schema.Class<RecordedObservation>("SessionAttempt.RecordedObservation")({
  ...Observation.fields,
  event: Schema.Struct({ id: Event.ID, seq: Event.Seq }),
}) {}

export class Terminal extends Schema.Class<Terminal>("SessionAttempt.Terminal")({
  status: Schema.Literals(["completed", "failed", "cancelled", "interrupted"]),
  ended: NonNegativeInt,
  /** Provider stream completion precedes local tool settlement. */
  providerEndedAt: NonNegativeInt.pipe(optional),
  outputStarted: Schema.Boolean,
  finish: FinishReason.pipe(optional),
  rawFinish: Schema.String.pipe(optional),
  usage: TokenUsage.Info.pipe(optional),
  cost: Money.USD.pipe(optional),
  failure: Failure.pipe(optional),
  delivery: Delivery.pipe(optional),
}) {}

export class Info extends Schema.Class<Info>("SessionAttempt.Info")({
  ...Started.fields,
  observations: Schema.Array(RecordedObservation),
  terminal: Terminal.pipe(optional),
}) {}

export class Accounting extends Schema.Class<Accounting>("SessionAttempt.Accounting")({
  /** Counts are absent for historical receipts that do not identify physical attempts. */
  unknownPriceAttempts: NonNegativeInt.pipe(optional),
  missingUsageAttempts: NonNegativeInt.pipe(optional),
}) {}
