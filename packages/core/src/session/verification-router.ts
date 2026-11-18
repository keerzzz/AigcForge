export * as VerificationRouter from "./verification-router"

import { Context, Effect, Layer, Schema } from "effect"
import { Config } from "../config"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { Verifier } from "./verifier"
import { DelegationID } from "@aigcfroge/schema/delegation-id"
import { Document, type Entry } from "@aigcfroge/schema/config"

const settings = (documents: readonly Entry[]) => documents
  .filter((entry): entry is Document => entry.type === "document")
  .flatMap((entry) => entry.info.meta?.verifier ? [entry.info.meta.verifier] : [])
  .reduce<{ enabled: boolean; threshold: number }>((result, current) => ({
    enabled: current.escalation_enabled ?? result.enabled,
    threshold: current.escalation_threshold ?? result.threshold,
  }), { enabled: false, threshold: 2 })

export const Level = Schema.Literals(["l0", "l1", "l2"])
export type RouteLevel = typeof Level.Type

export class Source extends Schema.Class<Source>("VerificationRouter.Source")({
  sessionID: SessionSchema.ID,
  messageID: SessionMessage.ID,
  id: Schema.String,
}) {}

export class Observation extends Schema.Class<Observation>("VerificationRouter.Observation")({
  kind: Schema.Literals(["contradiction", "missing_evidence"]),
  quote: Schema.String,
  detail: Schema.String,
}) {}

export const Observations = Schema.Struct({ observations: Schema.Array(Observation) })

export class JudgeResult extends Schema.Class<JudgeResult>("VerificationRouter.JudgeResult")({
  taskID: Schema.String,
  status: Schema.Literals(["reported", "no_issue_reported", "invalid", "partial", "empty", "failed", "cancelled", "running", "recovery_required"]),
  observations: Schema.Array(Observation),
  reason: Schema.optionalKey(Schema.String),
}) {}

export class Completion extends Schema.Class<Completion>("VerificationRouter.Completion")({
  delegationID: DelegationID.ID,
  revisionDigest: Schema.optionalKey(Schema.String),
  archivedFrom: Schema.Literal("completed"),
  canComplete: Schema.Boolean,
}) {}

export class State extends Schema.Class<State>("VerificationRouter.State")({
  level: Level,
  failures: Schema.Int,
}) {}

export class Settlement extends Schema.Class<Settlement>("VerificationRouter.Settlement")({
  source: Source,
  mechanicalSource: Schema.optionalKey(Source),
  mechanical: Schema.optionalKey(Verifier.Result),
  intent: Schema.optionalKey(Schema.Literal("content_creation")),
  enabled: Schema.Boolean,
  level: Level,
  operation: Schema.Literals(["none", "l1", "l2"]),
  status: Schema.Literals(["not_dispatched", "running", "completed", "failed", "cancelled", "unavailable"]),
  reason: Schema.optionalKey(Schema.String),
  observations: Schema.Array(JudgeResult),
  completion: Schema.optionalKey(Completion),
  reset: Schema.Literals(["none", "l0_passed", "completion_barrier"]),
  state: State,
}) {}

type Input = {
  readonly history: readonly Settlement[]
  readonly source: Source
  readonly mechanicalSource?: Source
  readonly mechanical?: Verifier.Result
  readonly intent?: "content_creation"
  readonly operation: "none" | "l1" | "l2"
  readonly status: typeof Settlement.Type.status
  readonly reason?: string
  readonly observations?: readonly JudgeResult[]
  readonly completion?: Completion
}

export interface Interface {
  readonly route: (input: Input) => Effect.Effect<Settlement>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/VerificationRouter") {}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const config = yield* Config.Service
  const configured = settings(yield* config.entries())
  const route = Effect.fn("VerificationRouter.route")(function* (input: Input) {
    const seen = new Set<string>()
    const judged = new Set<string>()
    const increment = (state: State) => state.failures + 1 < configured.threshold
      ? new State({ level: state.level, failures: state.failures + 1 })
      : new State({ level: state.level === "l0" ? "l1" : "l2", failures: 0 })
    const fold = (state: State, record: Pick<Settlement, "source" | "mechanicalSource" | "mechanical" | "intent" | "enabled" | "operation" | "status" | "observations" | "completion">) => {
      const key = record.mechanicalSource ? JSON.stringify(record.mechanicalSource) : undefined
      const mechanical = record.mechanical
      const updated = key === undefined || seen.has(key) || !mechanical
        ? state
        : (() => {
            seen.add(key)
            if (mechanical.status === "passed") return new State({ level: "l0", failures: 0 })
            return record.enabled && mechanical.status === "failed" ? increment(state) : state
          })()
      const judge = JSON.stringify(record.source)
      const active = record.enabled && record.intent === "content_creation" && record.operation === "l1" && record.status !== "not_dispatched" && record.status !== "unavailable" && updated.level === "l0"
        ? new State({ level: "l1", failures: updated.failures })
        : updated
      const observed = record.enabled && !judged.has(judge) && record.observations.some((result) => result.status === "reported" && result.observations.length > 0)
        ? (() => { judged.add(judge); return increment(active) })()
        : active
      return record.completion?.canComplete ? new State({ level: "l0", failures: 0 }) : observed
    }
    const previous = input.history.reduce(fold, new State({ level: "l0", failures: 0 }))
    const freshMechanical = input.mechanicalSource !== undefined && !seen.has(JSON.stringify(input.mechanicalSource))
    const before = fold(previous, { ...input, enabled: configured.enabled, observations: [] })
    // An unavailable check and an empty or malformed model answer never clear failures.
    const level: RouteLevel = !configured.enabled ? "l0" : input.intent === "content_creation" && before.level === "l0" ? "l1" : before.level
    const state = configured.enabled
      ? fold(before, { ...input, mechanical: undefined, enabled: configured.enabled, observations: input.observations ?? [] })
      : new State({ level: "l0", failures: 0 })
    return new Settlement({
      source: input.source,
      ...(input.mechanicalSource ? { mechanicalSource: input.mechanicalSource } : {}),
      ...(input.mechanical ? { mechanical: input.mechanical } : {}),
      ...(input.intent ? { intent: input.intent } : {}),
      enabled: configured.enabled,
      level,
      operation: input.operation,
      status: input.status,
      ...(input.reason ? { reason: input.reason } : {}),
      observations: [...(input.observations ?? [])],
      ...(input.completion ? { completion: input.completion } : {}),
      reset: input.completion?.canComplete ? "completion_barrier" : freshMechanical && input.mechanical?.status === "passed" ? "l0_passed" : "none",
      state,
    })
  })
  return Service.of({ route })
}))
