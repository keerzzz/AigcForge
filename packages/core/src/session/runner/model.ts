export * as SessionRunnerModel from "./model.js"

import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { AIError, LanguageModel } from "@aigcfroge/ai"
import { Model } from "../../model.js"
import { ModelGroup } from "../../model-group.js"
import type { ModelSource } from "@aigcfroge/schema/model-source"
import { Provider } from "../../provider.js"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { ModelResolver } from "../../model-resolver.js"
import { Database } from "../../database/database.js"
import { Location } from "../../location.js"
import { KeyedMutex } from "../../effect/keyed-mutex.js"
import { Integration } from "../../integration.js"
import { PluginHooks } from "../../plugin/hooks.js"
import { SessionSchema } from "../schema.js"
import { SessionHistory } from "../history.js"
import { SessionProviderContext } from "../provider-context.js"
import { SessionUsage } from "../usage.js"
import { SessionMessageTable, SessionTable } from "../sql.js"
import { sameModel } from "../error.js"
import { isDeepStrictEqual } from "node:util"
import { and, asc, eq, isNull, or } from "drizzle-orm"
import type { SessionAttempt } from "@aigcfroge/schema/session-attempt"

export class ModelNotSelectedError extends Schema.TaggedError<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedError<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  { providerID: Provider.ID, modelID: Model.ID },
) {
  override get message() {
    if (this.providerID === "azure-cognitive-services")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use azure/${this.modelID} instead.`
    if (this.providerID === "google-vertex-anthropic")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use google-vertex/${this.modelID} instead.`
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}
export type Error = ModelNotSelectedError | ModelUnavailableError | ModelResolver.Error | ModelGroup.UnavailableError
export interface Binding {
  readonly behavior: ModelGroup.BehaviorSnapshot
  readonly sessionID: SessionSchema.ID
  readonly agent: SessionSchema.Info["agent"]
  readonly cursor: number
  readonly connection?: ModelSource.ConnectionRef
  readonly tried: readonly { readonly model: Model.Ref; readonly connection?: ModelSource.ConnectionRef }[]
  readonly blockedConnections: readonly {
    readonly providerID: Provider.ID
    readonly connection?: ModelSource.ConnectionRef
  }[]
  /** A stale fresh choice returns before Goal admission and the durable Started reservation. */
  readonly withReservation: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A | undefined, E, R>
}
export type Resolved = ModelResolver.Resolved & { readonly selection?: Model.Selection; readonly binding?: Binding }

export interface Options {
  readonly binding?: Binding
  readonly groupBehavior?: ModelGroup.BehaviorSnapshot
  readonly advance?: { readonly from: Resolved; readonly cause: AIError }
  readonly reprepare?: boolean
}

type Candidate = {
  readonly index: number
  readonly connectionIndex: number
  readonly member: ModelGroup.Member
  readonly selected: Model.Info
  readonly connection?: ModelSource.ConnectionRef
  readonly weight: number
  readonly runtime?: ModelResolver.Resolved
  readonly quota?: ModelSource.Quota
}

export interface Interface {
  /** Availability is sampled lazily for each explicitly selected model resolution. */
  readonly resolve: (
    session: SessionSchema.Info,
    available: Model.Interface["available"],
    options?: Options,
  ) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/SessionRunnerModel") {}

/** Builds a Resolved whose catalog identity mirrors the route model. Test or embedding seam. */
export const resolved = (
  model: LanguageModel,
  options: {
    readonly capabilities: Model.Capabilities
    readonly variant?: Model.VariantID
    readonly cost: Model.Info["cost"]
    readonly limit: Model.Info["limit"]
    readonly compaction?: Provider.Compaction
    readonly transport?: Provider.Transport
    readonly quote?: ModelSource.Quote
    readonly connection?: ModelSource.ConnectionRef
    readonly quota?: ModelSource.Quota
  },
): Resolved => ({
  model,
  ref: Model.Ref.make({
    id: Model.ID.make(model.id),
    providerID: Provider.ID.make(model.provider),
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  }),
  capabilities: options.capabilities,
  cost: options.cost,
  limit: options.limit,
  compaction: options.compaction,
  transport: options.transport,
  quote:
    options.quote ??
    (options.cost.length === 0
      ? { status: "unknown" }
      : {
          status: options.cost.every(
            (cost) => cost.input === 0 && cost.output === 0 && cost.cache.read === 0 && cost.cache.write === 0,
          )
            ? "free"
            : "known",
          prices: options.cost,
        }),
  connection: options.connection,
  quota: options.quota,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const groups = yield* ModelGroup.Service
    const catalog = yield* Model.Service
    const providers = yield* Provider.Service
    const integrations = yield* Integration.Service
    const hooks = yield* PluginHooks.Service
    const db = (yield* Database.Service).db
    const location = yield* Location.Service
    const reservations = yield* KeyedMutex.make<string>()
    const readReservations = Effect.fnUntraced(function* (behavior: ModelGroup.BehaviorSnapshot) {
      const rows = yield* db
        .select({ message: SessionMessageTable, sessionID: SessionTable.id })
        .from(SessionMessageTable)
        .innerJoin(SessionTable, eq(SessionMessageTable.session_id, SessionTable.id))
        .where(
          and(
            or(eq(SessionMessageTable.type, "assistant"), eq(SessionMessageTable.type, "user")),
            eq(SessionTable.directory, location.directory),
            location.workspaceID === undefined
              ? isNull(SessionTable.workspace_id)
              : eq(SessionTable.workspace_id, location.workspaceID),
          ),
        )
        .orderBy(asc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      const seen = new Set<string>()
      const inputs = new Map<SessionSchema.ID, string>()
      return (yield* Effect.forEach(rows, (row) =>
        SessionHistory.decodeMessageRow(row.message).pipe(
          Effect.orDie,
          Effect.map((message) => {
            if (message.type === "user") {
              inputs.set(row.sessionID, message.id)
              return []
            }
            if (
              message.type !== "assistant" ||
              message.origin?.kind !== "step" ||
              message.origin.sessionID !== row.sessionID
            )
              return []
            return (message.attempts ?? []).flatMap((attempt) => {
              if (
                !Model.Selection.isGroup(attempt.selection) ||
                attempt.selection.groupID !== behavior.groupID ||
                attempt.behaviorDigest !== behavior.behaviorDigest ||
                seen.has(attempt.attemptID)
              )
                return []
              seen.add(attempt.attemptID)
              const index = memberIndex(behavior, attempt)
              return index === undefined
                ? []
                : [
                    {
                      sessionID: row.sessionID,
                      messageID: message.id,
                      inputID: inputs.get(row.sessionID),
                      index,
                      attempt,
                    },
                  ]
            })
          }),
        ),
      ))
        .flat()
        .toSorted((left, right) => left.attempt.started - right.attempt.started)
    })
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, available, options) {
        const selection = session.model ?? (yield* catalog.selection())
        if (selection && Model.Selection.isGroup(selection)) {
          const current = yield* groups.current(selection.groupID)
          if (
            current.unavailable === "missing" ||
            current.unavailable === "disabled" ||
            (options?.groupBehavior === undefined && current.unavailable !== undefined)
          )
            return yield* new ModelGroup.UnavailableError({ groupID: selection.groupID, reason: current.unavailable })
          const behavior = options?.groupBehavior ?? current.behavior
          if (behavior === undefined || behavior.groupID !== selection.groupID || behavior.members.length === 0)
            return yield* new ModelGroup.UnavailableError({ groupID: selection.groupID, reason: "empty" })
          const prior =
            options?.binding?.sessionID === session.id &&
            options.binding.agent === session.agent &&
            options.binding.behavior.groupID === selection.groupID &&
            options.binding.behavior.behaviorDigest === behavior.behaviorDigest
              ? options.binding
              : undefined
          const time = (yield* DateTime.nowAsDate).getTime()
          const tried = (prior?.tried ?? []).concat(
            options?.advance ? [{ model: options.advance.from.ref, connection: options.advance.from.connection }] : [],
          )
          const failedQuota =
            options?.advance === undefined
              ? undefined
              : currentQuota(options.advance.from.quota, options.advance.from.connection, time)
          const blockedConnections = (prior?.blockedConnections ?? []).concat(
            options?.advance &&
              (options.advance.cause.reason._tag === "Authentication" ||
                (options.advance.cause.reason._tag === "QuotaExceeded" &&
                  failedQuota?.windows.some(
                    (window) =>
                      window.scope === "account" &&
                      (window.resetAt === undefined || window.resetAt > time) &&
                      exhausted(window),
                  )))
              ? [{ providerID: options.advance.from.ref.providerID, connection: options.advance.from.connection }]
              : [],
          )
          const ledger = yield* readReservations(behavior)
          const previous =
            prior === undefined &&
            behavior.affinity === "session" &&
            options?.advance === undefined &&
            !options?.reprepare
              ? ledger.findLast((entry) => entry.sessionID === session.id && entry.attempt.agent === session.agent)
              : undefined
          let held =
            options?.advance === undefined && !options?.reprepare
              ? (prior ??
                (previous === undefined
                  ? undefined
                  : {
                      cursor: previous.index,
                      connection: previous.attempt.connection,
                    }))
              : undefined
          const extended =
            behavior.strategy !== "order" && behavior.strategy !== "rotate" && behavior.strategy !== "weight"
          const needsQuota = extended && behavior.strategy !== "fast" && behavior.strategy !== "cheap"
          const continuingAdapter =
            needsQuota &&
            options?.advance?.from.quota !== undefined &&
            options.advance.from.quota.status !== "unsupported"
              ? yield* hooks.has("session", "model.quota", options.advance.from.ref.providerID)
              : false
          const views = new Map<string, readonly Model.Info[]>()
          const activeConnections = new Map<Provider.ID, ModelSource.ConnectionRef | undefined>()
          const quotas = new Map<string, ModelSource.Quota | undefined>()
          const activeConnection = Effect.fnUntraced(function* (providerID: Provider.ID) {
            if (activeConnections.has(providerID)) return activeConnections.get(providerID)
            const provider = yield* providers.get(providerID)
            const connection = yield* integrations.connection.active(
              provider?.integrationID ?? Integration.ID.make(providerID),
            )
            const ref: ModelSource.ConnectionRef | undefined =
              connection?.type === "credential"
                ? { type: "credential", id: connection.id }
                : connection?.type === "env"
                  ? { type: "env", name: connection.name }
                  : undefined
            activeConnections.set(providerID, ref)
            return ref
          })
          const resolveCandidate = (candidate: Pick<Candidate, "selected" | "member" | "connection">) =>
            resolver.resolveModel(candidate.selected, candidate.member.variant, candidate.connection).pipe(
              Effect.catchTags({
                "SessionRunnerModel.VariantUnavailableError": () => Effect.undefined,
                "SessionRunnerModel.UnsupportedPackageError": () => Effect.undefined,
                "SessionRunnerModel.ModelConfigurationError": () => Effect.undefined,
                "SessionRunnerModel.UnresolvedProviderVariablesError": () => Effect.undefined,
                "Integration.Authorization": () => Effect.undefined,
              }),
            )
          const prepared = (yield* Effect.forEach(behavior.members, (member, index) =>
            Effect.gen(function* () {
              const connections =
                member.connections ??
                (held?.cursor === index && held.connection !== undefined
                  ? [
                      { ref: held.connection, weight: 1 },
                      { ref: undefined, weight: 1 },
                    ]
                  : [{ ref: undefined, weight: 1 }])
              return (yield* Effect.forEach(connections, (connection, connectionIndex) =>
                Effect.gen(function* () {
                  // Capture only the active reference. Credential material is still resolved by the original resolver.
                  const ref = connection.ref ?? (extended ? yield* activeConnection(member.providerID) : undefined)
                  const key = ref === undefined ? "active" : JSON.stringify([member.providerID, ref])
                  const known = views.get(key)
                  const models =
                    known ??
                    (yield* available(
                      ref === undefined
                        ? undefined
                        : {
                            providerID: member.providerID,
                            connection: ref,
                          },
                    ))
                  if (known === undefined) views.set(key, models)
                  const selected = models.find(
                    (model) => model.providerID === member.providerID && model.id === member.id,
                  )
                  if (
                    !selected?.enabled ||
                    !Model.supportsText(selected) ||
                    (member.variant !== undefined &&
                      member.variant !== "default" &&
                      !selected.variants.some((variant) => variant.id === member.variant))
                  )
                    return []
                  if (
                    ref !== undefined &&
                    (tried.some(
                      (entry) => sameModel(entry.model, member) && isDeepStrictEqual(entry.connection, ref),
                    ) ||
                      blockedConnections.some(
                        (entry) => entry.providerID === member.providerID && isDeepStrictEqual(entry.connection, ref),
                      ))
                  )
                    return []
                  const candidate: Candidate = {
                    index,
                    connectionIndex,
                    member,
                    selected,
                    connection: ref,
                    weight: connection.weight ?? 1,
                    quota: selected.metadata?.quota,
                  }
                  const quotaKey = JSON.stringify([member.providerID, selected.modelID, ref])
                  const reportedQuota = !needsQuota
                    ? candidate.quota
                    : quotas.has(quotaKey)
                      ? quotas.get(quotaKey)
                      : supportsStrategy(behavior.strategy, quotaFacts(candidate, time))
                        ? candidate.quota
                        : (yield* hooks.trigger("session", "model.quota", {
                            sessionID: session.id,
                            model: member,
                            ...(ref === undefined ? {} : { connection: ref }),
                          })).quota
                  const quota: ModelSource.Quota | undefined =
                    reportedQuota === undefined || !extended || isDeepStrictEqual(reportedQuota.connection, ref)
                      ? reportedQuota
                      : {
                          status: "error",
                          source: reportedQuota.source,
                          reason: "invalid-output",
                          observedAt: time,
                          ...(ref === undefined ? {} : { connection: ref }),
                          windows: [],
                        }
                  if (needsQuota && !quotas.has(quotaKey)) quotas.set(quotaKey, quota)
                  const runtime = behavior.strategy === "fast" ? yield* resolveCandidate(candidate) : undefined
                  if (behavior.strategy === "fast" && runtime === undefined) return []
                  return [{ ...candidate, quota, runtime }]
                }),
              )).flat()
            }),
          )).flat()
          const candidates = prepared.filter(
            (candidate, index) =>
              !extended ||
              prepared.findIndex(
                (other) => other.index === candidate.index && isDeepStrictEqual(other.connection, candidate.connection),
              ) === index,
          )
          const rejected = new Set<Candidate>()
          // Typed unknown/error data proves the adapter exists. Only missing/unsupported capability stops this strategy.
          const strategyAvailable =
            !needsQuota ||
            continuingAdapter ||
            candidates.some((candidate) => candidate.quota !== undefined && candidate.quota.status !== "unsupported")
          const ranked = (receipts: typeof ledger, time: number) => {
            const eligible = candidates.filter((candidate) => !rejected.has(candidate))
            if (eligible.length === 0 || !strategyAvailable) return
            if (held !== undefined) {
              const pinned = eligible.find(
                (candidate) =>
                  candidate.index === held?.cursor && isDeepStrictEqual(candidate.connection, held?.connection),
              )
              if (pinned && (!needsQuota || !quotaFacts(pinned, time)?.spent)) return pinned
            }
            if (behavior.strategy === "fast") {
              const measured = eligible.flatMap((candidate) => {
                const sample = speedSample(
                  candidate,
                  receipts.map((entry) => entry.attempt),
                  time,
                )
                return sample === undefined ? [] : [{ candidate, estimate: sample.ttft + (200 * 1000) / sample.tps }]
              })
              const unmeasured = eligible.filter(
                (candidate) => !measured.some((entry) => entry.candidate === candidate),
              )
              const initials = new Set(
                receipts
                  .filter((entry) => entry.attempt.transition === "initial")
                  .map((entry) => JSON.stringify([entry.sessionID, entry.messageID])),
              ).size
              if (
                measured.length > 0 &&
                unmeasured.length > 0 &&
                options?.advance === undefined &&
                (initials + 1) % 8 === 0
              )
                return unmeasured[Math.floor(initials / 8) % unmeasured.length]
              return (
                measured.toSorted(
                  (left, right) =>
                    left.estimate - right.estimate ||
                    left.candidate.index - right.candidate.index ||
                    left.candidate.connectionIndex - right.candidate.connectionIndex,
                )[0]?.candidate ?? unmeasured[0]
              )
            }
            if (behavior.strategy === "cheap") {
              return eligible
                .map((candidate) => {
                  const quote = SessionUsage.currentQuote(
                    candidate.selected.metadata?.quote ?? { status: "unknown" },
                    time,
                  )
                  const price =
                    quote.status === "unknown" ? undefined : quote.prices.find((price) => price.tier === undefined)
                  // This is a 1:1 input/output rate estimate. The original quote + actual usage still owns billing.
                  return {
                    candidate,
                    priced: quote.status === "free" || price !== undefined,
                    cost: quote.status === "free" ? 0 : price === undefined ? undefined : price.input + price.output,
                    cache:
                      quote.status === "free"
                        ? 0
                        : price === undefined
                          ? undefined
                          : price.cache.read + price.cache.write,
                  }
                })
                .toSorted(
                  (left, right) =>
                    Number(right.priced) - Number(left.priced) ||
                    (left.cost === undefined || right.cost === undefined ? 0 : left.cost - right.cost) ||
                    (left.cache === undefined || right.cache === undefined ? 0 : left.cache - right.cache) ||
                    left.candidate.index - right.candidate.index ||
                    left.candidate.connectionIndex - right.candidate.connectionIndex,
                )[0]?.candidate
            }
            if (needsQuota) {
              const informed = eligible.flatMap((candidate) => {
                const facts = quotaFacts(candidate, time)
                return facts === undefined || !supportsStrategy(behavior.strategy, facts) ? [] : [{ candidate, facts }]
              })
              const unknown = eligible.filter((candidate) => !informed.some((entry) => entry.candidate === candidate))
              const ready = informed.filter((entry) => !entry.facts.spent)
              const spent = informed.filter((entry) => entry.facts.spent).map((entry) => entry.candidate)
              const stable = (left: Candidate, right: Candidate) =>
                left.index - right.index || left.connectionIndex - right.connectionIndex
              const compareSmart = (left: (typeof ready)[number], right: (typeof ready)[number]) => {
                const renewal =
                  Array.from(
                    { length: Math.max(left.facts.renewals.length, right.facts.renewals.length) },
                    (_, index) => {
                      const a = left.facts.renewals[index] ?? Number.POSITIVE_INFINITY
                      const b = right.facts.renewals[index] ?? Number.POSITIVE_INFINITY
                      return a === b ? 0 : a < b ? -1 : 1
                    },
                  ).find((difference) => difference !== 0) ?? 0
                return (
                  renewal ||
                  (left.facts.expiry ?? Number.POSITIVE_INFINITY) - (right.facts.expiry ?? Number.POSITIVE_INFINITY) ||
                  stable(left.candidate, right.candidate)
                )
              }
              if (behavior.strategy === "usage" || behavior.strategy === "pace") {
                const scored = ready.flatMap((entry) => {
                  const metric = behavior.strategy === "usage" ? entry.facts.usage : entry.facts.pace
                  return metric === undefined ? [] : [{ candidate: entry.candidate, metric }]
                })
                const positions = new Map<string, number[]>()
                scored.forEach((entry, index) =>
                  positions.set(entry.metric.unit, [...(positions.get(entry.metric.unit) ?? []), index]),
                )
                const ordered = scored.map((entry) => entry.candidate)
                // Preserve different units' authored slots; a pairwise cross-unit comparator would be non-transitive.
                positions.forEach((places) => {
                  const within = places
                    .map((place) => scored[place])
                    .toSorted(
                      (left, right) =>
                        right.metric.value - left.metric.value || stable(left.candidate, right.candidate),
                    )
                  places.forEach((place, index) => {
                    ordered[place] = within[index].candidate
                  })
                })
                return [...ordered, ...unknown, ...spent][0]
              }
              if (behavior.strategy === "free")
                return [
                  ...ready
                    .toSorted(
                      (left, right) =>
                        Number(right.facts.free) - Number(left.facts.free) || stable(left.candidate, right.candidate),
                    )
                    .map((entry) => entry.candidate),
                  ...unknown,
                  ...spent,
                ][0]
              if (behavior.strategy === "expiring") {
                const free = ready
                  .filter((entry) => entry.facts.expiringFree)
                  .toSorted(
                    (left, right) =>
                      (left.facts.expiry ?? Number.POSITIVE_INFINITY) -
                        (right.facts.expiry ?? Number.POSITIVE_INFINITY) || stable(left.candidate, right.candidate),
                  )
                const paid = ready.filter((entry) => !entry.facts.expiringFree).toSorted(compareSmart)
                return [...free, ...paid].map((entry) => entry.candidate).concat(unknown, spent)[0]
              }
              if (behavior.strategy === "drain") {
                type Receipt = (typeof receipts)[number]
                const sameSeat = (left: Receipt | undefined, right: Receipt | undefined) =>
                  left !== undefined &&
                  right !== undefined &&
                  left.index === right.index &&
                  isDeepStrictEqual(left.attempt.connection, right.attempt.connection)
                const previous = new Map<string, Receipt>()
                const temporary = new Map<string, Receipt>()
                let on: Receipt | undefined
                let past = false
                receipts.forEach((entry) => {
                  const owner = JSON.stringify([entry.sessionID, entry.attempt.agent, entry.inputID])
                  const advance = entry.attempt.reason?.reason === "QuotaExceeded" && sameSeat(previous.get(owner), on)
                  // A held fallback's later tool Step is also "initial"; only a new promoted User makes it a fresh choice.
                  if (
                    on === undefined ||
                    advance ||
                    (entry.attempt.transition === "initial" && !sameSeat(temporary.get(owner), entry))
                  ) {
                    on = entry
                    past = false
                    temporary.delete(owner)
                  }
                  if (
                    (entry.attempt.transition === "fallback" || entry.attempt.transition === "continuation") &&
                    !advance
                  )
                    temporary.set(owner, entry)
                  if (sameSeat(on, entry) && entry.attempt.terminal?.failure?.reason === "QuotaExceeded") past = true
                  previous.set(owner, entry)
                })
                const cursor =
                  on === undefined
                    ? -1
                    : eligible.findIndex(
                        (candidate) =>
                          candidate.index === on?.index &&
                          isDeepStrictEqual(candidate.connection, on?.attempt.connection),
                      )
                const start = cursor < 0 ? 0 : (cursor + Number(past)) % eligible.length
                const circular = [...eligible.slice(start), ...eligible.slice(0, start)]
                return (
                  circular.find((candidate) => ready.some((entry) => entry.candidate === candidate)) ??
                  circular.find((candidate) => unknown.includes(candidate)) ??
                  circular[0]
                )
              }
              return [...ready.toSorted(compareSmart).map((entry) => entry.candidate), ...unknown, ...spent][0]
            }
            const indexes = [...new Set(eligible.map((candidate) => candidate.index))]
            const memberMaximum = Math.max(
              ...indexes.map((index) => (behavior.strategy === "weight" ? (behavior.members[index].weight ?? 1) : 1)),
            )
            const memberWeight = indexes.reduce(
              (sum, index) =>
                sum + (behavior.strategy === "weight" ? (behavior.members[index].weight ?? 1) : 1) / memberMaximum,
              0,
            )
            const memberCounts = indexes.map((index) => ({
              index,
              count: receipts.filter((entry) => entry.index === index).length,
            }))
            const totalMembers = memberCounts.reduce((sum, entry) => sum + entry.count, 0)
            const orderedMembers = memberCounts.sort((left, right) =>
              behavior.strategy === "order"
                ? left.index - right.index
                : ((totalMembers + 1) *
                    (behavior.strategy === "weight" ? (behavior.members[right.index].weight ?? 1) : 1)) /
                    memberMaximum /
                    memberWeight -
                    right.count -
                    (((totalMembers + 1) *
                      (behavior.strategy === "weight" ? (behavior.members[left.index].weight ?? 1) : 1)) /
                      memberMaximum /
                      memberWeight -
                      left.count) || left.index - right.index,
            )
            const connections = eligible.filter((candidate) => candidate.index === orderedMembers[0]?.index)
            const connectionMaximum = Math.max(
              ...connections.map((candidate) => (behavior.strategy === "weight" ? candidate.weight : 1)),
            )
            const connectionWeight = connections.reduce(
              (sum, candidate) => sum + (behavior.strategy === "weight" ? candidate.weight : 1) / connectionMaximum,
              0,
            )
            const counts = connections.map((candidate) => ({
              candidate,
              count: receipts.filter(
                (entry) =>
                  entry.index === candidate.index &&
                  (candidate.connection === undefined ||
                    isDeepStrictEqual(entry.attempt.connection, candidate.connection)),
              ).length,
            }))
            const totalConnections = counts.reduce((sum, entry) => sum + entry.count, 0)
            return counts.sort((left, right) =>
              behavior.strategy === "order"
                ? left.candidate.connectionIndex - right.candidate.connectionIndex
                : ((totalConnections + 1) * (behavior.strategy === "weight" ? right.candidate.weight : 1)) /
                    connectionMaximum /
                    connectionWeight -
                    right.count -
                    (((totalConnections + 1) * (behavior.strategy === "weight" ? left.candidate.weight : 1)) /
                      connectionMaximum /
                      connectionWeight -
                      left.count) || left.candidate.connectionIndex - right.candidate.connectionIndex,
            )[0]?.candidate
          }
          while (true) {
            const candidate = ranked(ledger, (yield* DateTime.nowAsDate).getTime())
            if (candidate === undefined) break
            const resolved = candidate.runtime ?? (yield* resolveCandidate(candidate))
            if (
              resolved === undefined ||
              tried.some(
                (entry) =>
                  sameModel(entry.model, resolved.ref) && isDeepStrictEqual(entry.connection, resolved.connection),
              ) ||
              blockedConnections.some(
                (entry) =>
                  entry.providerID === resolved.ref.providerID &&
                  isDeepStrictEqual(entry.connection, resolved.connection),
              )
            ) {
              rejected.add(candidate)
              continue
            }
            if (
              held !== undefined &&
              candidate.index === held.cursor &&
              !isDeepStrictEqual(resolved.connection, held.connection)
            ) {
              held = undefined
              if (ranked(ledger, (yield* DateTime.nowAsDate).getTime()) !== candidate) continue
            }
            let committed =
              held !== undefined &&
              candidate.index === held.cursor &&
              isDeepStrictEqual(resolved.connection, held.connection)
            const withReservation: Binding["withReservation"] = (effect) =>
              reservations.withLock(
                JSON.stringify([location.directory, location.workspaceID, behavior.groupID, behavior.behaviorDigest]),
              )(
                Effect.gen(function* () {
                  const current = yield* groups.current(behavior.groupID)
                  if (
                    current.unavailable === "missing" ||
                    current.unavailable === "disabled" ||
                    (options?.groupBehavior === undefined &&
                      (current.unavailable !== undefined ||
                        current.behavior?.behaviorDigest !== behavior.behaviorDigest))
                  )
                    return undefined
                  const time = (yield* DateTime.nowAsDate).getTime()
                  if (
                    !strategyAvailable ||
                    (!committed && ranked(yield* readReservations(behavior), time) !== candidate)
                  )
                    return undefined
                  const value = yield* effect
                  committed = true
                  return value
                }),
              )
            const quota = candidate.quota ?? resolved.quota
            return {
              ...resolved,
              quota:
                quota !== undefined && isDeepStrictEqual(quota.connection, resolved.connection) ? quota : undefined,
              selection,
              binding: {
                behavior,
                sessionID: session.id,
                agent: session.agent,
                cursor: candidate.index,
                connection: resolved.connection,
                tried,
                blockedConnections,
                withReservation:
                  !extended && prior !== undefined && options?.advance === undefined && committed
                    ? prior.withReservation
                    : withReservation,
              },
            }
          }
          return yield* new ModelGroup.UnavailableError({
            groupID: selection.groupID,
            reason: candidates.length > 0 && !strategyAvailable ? "strategy-unavailable" : "no-candidates",
          })
        }
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        if (!selection) {
          const resolved = yield* resolver.resolve()
          if (resolved) return { ...resolved, selection: resolved.ref }
          return yield* new ModelNotSelectedError({ sessionID: session.id })
        }
        const selected = (yield* available()).find(
          (model) => model.providerID === selection.providerID && model.id === selection.id,
        )
        if (!selected)
          return yield* new ModelUnavailableError({
            providerID: selection.providerID,
            modelID: selection.id,
          })
        return { ...(yield* resolver.resolveModel(selected, selection.variant)), selection }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    ModelResolver.node,
    ModelGroup.node,
    Model.node,
    Provider.node,
    Integration.node,
    PluginHooks.node,
    Database.node,
    Location.node,
  ],
})

/** Undeclared expiry remains a source decision; a different account's observation is never current. */
function currentQuota(
  quota: ModelSource.Quota | undefined,
  connection: ModelSource.ConnectionRef | undefined,
  time: number,
) {
  if (
    quota?.status !== "known" ||
    !isDeepStrictEqual(quota.connection, connection) ||
    (quota.observedAt !== undefined && quota.observedAt > time) ||
    (quota.freshUntil !== undefined && quota.freshUntil <= time)
  )
    return
  return quota
}

function exhausted(window: ModelSource.Quota["windows"][number]) {
  return (
    window.unlimited !== true &&
    ((window.usedRatio !== undefined && window.usedRatio >= 1) ||
      (window.remaining !== undefined && window.remaining <= 0))
  )
}

function quotaFacts(candidate: Candidate, time: number) {
  const quota = currentQuota(candidate.quota, candidate.connection, time)
  if (quota === undefined) return
  const quote = SessionUsage.currentQuote(
    candidate.runtime?.quote ?? candidate.selected.metadata?.quote ?? { status: "unknown" },
    time,
  )
  const windows = quota.windows.filter(
    (window) =>
      (window.scope === "account" ||
        window.modelIDs === undefined ||
        window.modelIDs.includes(candidate.selected.modelID)) &&
      (window.resetAt === undefined || window.resetAt > time),
  )
  const measured = windows.map((window) => {
    const ratio =
      window.unlimited === true
        ? 0
        : window.usedRatio !== undefined && window.usedRatio >= 0
          ? window.usedRatio
          : window.total !== undefined && window.total > 0 && window.remaining !== undefined
            ? Math.max(0, 1 - window.remaining / window.total)
            : undefined
    return {
      window,
      ratio,
      unit: JSON.stringify([
        candidate.member.providerID,
        window.id,
        window.unit,
        ratio === undefined ? "amount" : "ratio",
      ]),
    }
  })
  const mostUsed = measured
    .filter((entry) => entry.ratio !== undefined)
    .toSorted((left, right) => (right.ratio ?? 0) - (left.ratio ?? 0))[0]
  const balance = measured.find((entry) => entry.window.remaining !== undefined)
  const usage =
    mostUsed === undefined
      ? balance === undefined
        ? undefined
        : { unit: balance.unit, value: balance.window.remaining ?? 0 }
      : { unit: mostUsed.unit, value: 1 - (mostUsed.ratio ?? 0) }
  const paced = measured
    .filter(
      (entry) =>
        entry.window.resetAt !== undefined && (entry.ratio !== undefined || entry.window.remaining !== undefined),
    )
    .toSorted(
      (left, right) =>
        (right.window.spanMs ?? 0) - (left.window.spanMs ?? 0) ||
        (left.window.resetAt ?? Number.POSITIVE_INFINITY) - (right.window.resetAt ?? Number.POSITIVE_INFINITY),
    )[0]
  const pace =
    paced === undefined
      ? undefined
      : {
          unit: paced.unit,
          value:
            (paced.ratio === undefined ? (paced.window.remaining ?? 0) : 1 - paced.ratio) /
            ((paced.window.resetAt ?? time) - time),
        }
  const creditsCurrent = quota.credits?.expiresAt === undefined || quota.credits.expiresAt > time
  const credits = creditsCurrent && (quota.credits?.unlimited === true || (quota.credits?.balance ?? 0) > 0)
  const free = quota.freeModel === true || quote.status === "free"
  const priced =
    quote.status === "free" || (quote.status === "known" && quote.prices.some((price) => price.tier === undefined))
  const expiry = [
    ...windows
      .filter((window) => !exhausted(window))
      .flatMap((window) => (window.resetAt === undefined ? [] : [window.resetAt])),
    ...(credits && quota.credits?.expiresAt !== undefined ? [quota.credits.expiresAt] : []),
  ].toSorted((left, right) => left - right)[0]
  return {
    quota,
    windows,
    usage,
    pace,
    expiry,
    free,
    freeKnown: quota.freeModel !== undefined || priced,
    expiringFree: free || quota.freePlan === true,
    expiringFreeKnown: quota.freePlan !== undefined || quota.freeModel !== undefined || priced,
    qualified:
      quota.allowed !== undefined ||
      measured.some((entry) => entry.ratio !== undefined || entry.window.remaining !== undefined) ||
      quota.credits?.balance !== undefined ||
      quota.credits?.unlimited !== undefined ||
      quota.freeModel !== undefined ||
      quota.freePlan !== undefined,
    spent:
      quota.allowed === false ||
      (windows.some(exhausted) && !credits) ||
      (!free && windows.length === 0 && quota.credits?.balance !== undefined && !credits),
    renewals: windows
      .filter((window) => !exhausted(window) && window.resetAt !== undefined)
      .toSorted((left, right) => (right.spanMs ?? 0) - (left.spanMs ?? 0))
      .map((window) => window.resetAt ?? Number.POSITIVE_INFINITY),
  }
}

function supportsStrategy(strategy: ModelGroup.Definition["strategy"], facts: ReturnType<typeof quotaFacts>) {
  if (facts === undefined) return false
  if (strategy === "usage") return facts.usage !== undefined
  if (strategy === "pace") return facts.pace !== undefined
  if (strategy === "free") return facts.qualified && facts.freeKnown
  if (strategy === "expiring") return facts.qualified && facts.expiringFreeKnown && facts.expiry !== undefined
  return facts.qualified
}

/** The actual transport proof owns a speed sample; prepared-only records cannot establish one. */
function speedSample(candidate: Candidate, attempts: readonly SessionAttempt.Info[], time: number) {
  if (candidate.runtime === undefined) return
  const target = SessionProviderContext.provenance(candidate.runtime)
  if (target === undefined) return
  return attempts
    .flatMap((attempt) => {
      const terminal = attempt.terminal
      const firstTokenAt = attempt.observations.find(
        (observation) => observation.firstTokenAt !== undefined,
      )?.firstTokenAt
      const source = attempt.observations.findLast((observation) => observation.deployment !== undefined)?.deployment
      const output = (terminal?.usage?.output ?? 0) + (terminal?.usage?.reasoning ?? 0)
      if (
        !sameModel(attempt.model, candidate.member) ||
        attempt.apiModelID !== candidate.runtime?.model.id ||
        !isDeepStrictEqual(attempt.connection, candidate.runtime.connection) ||
        terminal?.status !== "completed" ||
        firstTokenAt === undefined ||
        firstTokenAt < attempt.started ||
        terminal.providerEndedAt === undefined ||
        terminal.providerEndedAt <= firstTokenAt ||
        terminal.providerEndedAt > time ||
        time - terminal.providerEndedAt >= 24 * 60 * 60 * 1000 ||
        output <= 0 ||
        source === undefined ||
        !SessionProviderContext.compatible(source, target)
      )
        return []
      return [
        {
          observedAt: terminal.providerEndedAt,
          ttft: firstTokenAt - attempt.started,
          tps: (output * 1000) / (terminal.providerEndedAt - firstTokenAt),
        },
      ]
    })
    .toSorted((left, right) => right.observedAt - left.observedAt)[0]
}

/** Old receipts may recover an authored index only when model and current connection policy identify one member. */
function memberIndex(behavior: ModelGroup.BehaviorSnapshot, attempt: SessionAttempt.Started) {
  const indexes = behavior.members.flatMap((member, index) =>
    sameModel(member, attempt.model) &&
    (member.connections === undefined ||
      member.connections.some((connection) => isDeepStrictEqual(connection.ref, attempt.connection)))
      ? [index]
      : [],
  )
  if (attempt.groupMemberIndex !== undefined)
    return indexes.includes(attempt.groupMemberIndex) ? attempt.groupMemberIndex : undefined
  return indexes.length === 1 ? indexes[0] : undefined
}

export function fallbackEligible(error: AIError, strategy?: ModelGroup.Definition["strategy"]) {
  const reason = error.reason
  if (strategy === "drain" && reason._tag === "RateLimit") return false
  if (reason._tag === "InvalidRequest")
    return (
      reason.classification === "context-overflow" ||
      reason.classification === "payload-too-large" ||
      reason.classification === "model-not-found"
    )
  if (reason._tag === "InvalidProviderOutput") return reason.classification === "incomplete-stream"
  return (
    reason._tag === "Authentication" ||
    reason._tag === "QuotaExceeded" ||
    reason._tag === "RateLimit" ||
    reason._tag === "ProviderInternal" ||
    reason._tag === "Transport" ||
    reason._tag === "UnknownProvider" ||
    reason._tag === "NoRoute" ||
    reason._tag === "UnsupportedOperation" ||
    reason._tag === "Timeout"
  )
}
