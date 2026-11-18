export * as Permission from "./permission.js"

import { makeLocationNode } from "@aigcfroge/util/effect/app-node"
import { Context, Deferred, Duration, Effect, Layer, Option, Schema } from "effect"
import { Permission } from "@aigcfroge/schema/permission"
import { Bus } from "./bus.js"
import { Location } from "./location.js"
import { Agent } from "./agent.js"
import { SessionErrors } from "./session/error.js"
import { SessionSchema } from "./session/schema.js"
import { SessionStore } from "./session/store.js"
import { SessionComposition } from "./session/composition.js"
import { PermissionEffective } from "./permission/effective.js"
import { SessionPermissionOverride } from "./permission/session-override.js"
import { Wildcard } from "./util/wildcard.js"
import { PermissionSaved } from "./permission/saved.js"
import { ApprovalPresence } from "./permission/approval-presence.js"
import { ScopedGrantStore } from "./grant/store.js"
import { PluginHooks } from "./plugin/hooks.js"
import { PermissionTier } from "@aigcfroge/schema/permission-tier"

const PermissionEffect = Permission.Effect
export { PermissionEffect as Effect }
export { Rule, Ruleset } from "@aigcfroge/schema/permission"
const missingAgentPermissions: Permission.Ruleset = [{ action: "*", resource: "*", effect: "deny" }]

export const ID = Permission.ID
export type ID = typeof ID.Type

export const Source = Permission.Source
export type Source = typeof Source.Type
export const ToolSource = Permission.ToolSource
export type ToolSource = Permission.ToolSource
export const OperationSource = Permission.OperationSource
export type OperationSource = Permission.OperationSource

const RequestFields = {
  sessionID: Permission.Request.fields.sessionID,
  action: Permission.Request.fields.action,
  resources: Permission.Request.fields.resources,
  save: Permission.Request.fields.save,
  metadata: Permission.Request.fields.metadata,
  source: Permission.Request.fields.source,
}

export const Request = Permission.Request
export type Request = typeof Request.Type

export const Reply = Permission.Reply
export type Reply = typeof Reply.Type

export const AssertInput = Schema.Struct({
  id: ID.pipe(Schema.optional),
  ...RequestFields,
  agent: Agent.ID.pipe(Schema.optional),
}).annotate({ identifier: "Permission.AssertInput" })
export type AssertInput = typeof AssertInput.Type

export const ReplyInput = Schema.Struct({
  requestID: ID,
  reply: Reply,
  message: Schema.String.pipe(Schema.optional),
}).annotate({ identifier: "Permission.ReplyInput" })
export type ReplyInput = typeof ReplyInput.Type

export const AskResult = Schema.Struct({
  id: ID,
  effect: Permission.Effect,
}).annotate({ identifier: "Permission.AskResult" })
export type AskResult = typeof AskResult.Type

export { Event } from "@aigcfroge/schema/permission"

export class DeclinedError extends Schema.TaggedError<DeclinedError>()("Permission.DeclinedError", {}) {}

export class CorrectedError extends Schema.TaggedError<CorrectedError>()("Permission.CorrectedError", {
  feedback: Schema.String,
}) {}

/** The ask has no capable responder or was withdrawn when its owner closed. */
export class RejectedError extends Schema.TaggedError<RejectedError>()("Permission.RejectedError", {
  reason: Schema.optional(ApprovalPresence.Reason),
}) {
  override get message() {
    return this.reason === "no_responder"
      ? "No approval responder is available for this session"
      : "Approval request was withdrawn because its owner closed"
  }
}

/** The approval ask outlived its TTL without an answer and was withdrawn. */
export class AskExpiredError extends Schema.TaggedError<AskExpiredError>()("Permission.AskExpiredError", {
  requestID: ID,
  ttlMs: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
}) {
  override get message() {
    return `Approval request ${this.requestID} expired after ${this.ttlMs}ms without an answer`
  }
}

export class BlockedError extends Schema.TaggedError<BlockedError>()("Permission.BlockedError", {
  rules: Permission.Ruleset,
  permission: Schema.String,
  resources: Schema.Array(Schema.String),
  reason: Schema.String.pipe(Schema.optional),
}) {
  override get message() {
    return this.reason ?? `Permission denied: ${this.permission}`
  }
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Permission.NotFoundError", {
  requestID: ID,
}) {}

export type Error = BlockedError | CorrectedError | RejectedError | AskExpiredError

export function evaluate(action: string, resource: string, ...rulesets: Permission.Ruleset[]): Permission.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(action, rule.action) && Wildcard.match(resource, rule.resource)) ?? {
      action,
      resource: "*",
      effect: "ask",
    }
  )
}

export function merge(...rulesets: Permission.Ruleset[]): Permission.Ruleset {
  return rulesets.flat()
}

export interface Interface {
  readonly close: Effect.Effect<void>
  readonly ask: (input: AssertInput) => Effect.Effect<AskResult, SessionErrors.NotFoundError>
  /** Configured posture; ordinary Coding consults saved approvals separately after its per-request deny guard. */
  readonly effectiveRules: (
    sessionID: SessionSchema.ID,
    agentID?: Agent.ID,
  ) => Effect.Effect<Permission.Ruleset, SessionErrors.NotFoundError | BlockedError>
  readonly assert: (input: AssertInput) => Effect.Effect<void, Error | SessionErrors.NotFoundError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Request | undefined>
  readonly forSession: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Request>>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/Permission") {}

interface Pending {
  readonly request: Request
  readonly agent?: Agent.ID
  readonly deferred: Deferred.Deferred<void, DeclinedError | CorrectedError | RejectedError>
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const agents = yield* Agent.Service
    const sessions = yield* SessionStore.Service
    const compositions = yield* SessionComposition.Service
    const saved = yield* PermissionSaved.Service
    const hooks = yield* PluginHooks.Service
    const pending = new Map<ID, Pending>()
    let closed = false

    const close = Effect.gen(function* () {
      closed = true
      // Shutdown release publishes nothing: a scope-cancelled approval leaves
      // no ledger entry (fork contract, M3 Phase G §7.1) — the parked fiber
      // fails typed with RejectedError so the caller can tell a shutdown
      // withdrawal apart from a user decline only by the absence of a reply.
      yield* Effect.forEach(Array.from(pending.values()), (item) => Deferred.fail(item.deferred, new RejectedError()), {
        discard: true,
      })
      pending.clear()
    }).pipe(Effect.uninterruptible)
    yield* Effect.addFinalizer(() => close)

    const savedRules = Effect.fnUntraced(function* () {
      return (yield* saved.list({ projectID: location.project.id })).map(
        (item): Permission.Rule => ({
          action: item.action,
          resource: item.resource,
          effect: "allow",
        }),
      )
    })

    const override = yield* SessionPermissionOverride.Service
    // Hard dependency (ADR-20 §2.7): an optional lookup here is what let a
    // build ship with no provider, turning every `ask` in every mode into a
    // silent no_responder rejection. A missing provider must fail the layer.
    const presence = yield* ApprovalPresence.Service

    // Ordinary Coding exposes V2's ordered configuration; saved approvals enter only after its request-level
    // deny guard. Product envelopes keep saved placement inside the envelope so Chat dangerous asks stay gated.
    const configured = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, agentID?: Agent.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionErrors.NotFoundError({ sessionID })
      const agent = yield* session.mode === "custom" ||
      (session.controller?.kind === "child" && session.controller.source.kind === "workflow")
        ? compositions.selectAgent(sessionID, agentID ?? session.agent ?? "").pipe(
            Effect.map((selection) => selection.info),
            Effect.mapError(
              (error) =>
                new BlockedError({
                  rules: [],
                  permission: "*",
                  resources: [agentID ?? session.agent ?? ""],
                  reason: `Custom composition is unavailable: ${error._tag}`,
                }),
            ),
          )
        : agents.resolve(agentID ?? session.agent)
      const input = {
        mode: session.mode,
        agent: String(agentID ?? agent?.id ?? session.agent ?? ""),
        tier: session.permissionTier ?? PermissionTier.Default,
        parentID: session.parentID,
        attended: session.attended,
        masterPermissionEnabled: yield* override.get(sessionID),
      }
      const ordered = PermissionEffective.usesOrderedConfiguration(input)
      const parent =
        session.controller?.kind === "child" ? yield* sessions.get(session.controller.rootSessionID) : undefined
      return {
        rules: PermissionEffective.effectiveV2(
          { ...input, savedApprovals: ordered ? [] : yield* savedRules() },
          agent?.permissions ?? missingAgentPermissions,
          session.permissions ?? [],
        ),
        consultSaved: ordered && session.attended !== false,
        attended: session.attended !== false,
        parentRules: parent?.permissions,
        boundChild: session.controller?.kind === "child",
      }
    })

    const effectiveRules = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, agentID?: Agent.ID) {
      const configuration = yield* configured(sessionID, agentID)
      return configuration.boundChild ? PermissionEffective.childRules(configuration.rules) : configuration.rules
    })

    const consultGrant = Effect.fn("Permission.consultGrant")(function* (input: AssertInput) {
      // Read per-call: layer-construction-time capture would miss providers
      // composed outside this layer.
      const grantsOption = yield* Effect.serviceOption(ScopedGrantStore.Service)
      if (Option.isNone(grantsOption)) return false
      const store = grantsOption.value
      // `findValid` has no typed error channel, so a catch here could only ever
      // swallow interruption and defects — both must survive.
      const hit = yield* store.findValid({
        action: input.action,
        resources: input.resources,
        sessionID: input.sessionID,
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
      })
      if (!hit) return false
      if (hit.grant.scope.level !== "once") return true
      // Racing consumers: losing the consume falls back to the ask flow.
      const consumed = yield* store.consume(hit.grant.id).pipe(
        Effect.catchTag("ScopedGrant.StateError", () => Effect.succeed(undefined)),
        Effect.catchTag("ScopedGrant.NotFoundError", () => Effect.succeed(undefined)),
        // A commit-rejected consume is the same lost race as the two above: the
        // grant stopped being consumable between findValid and consume, so the
        // call falls back to the ask flow instead of surfacing a conflict.
        Effect.catchTag("GrantEvent.CommitRejected", () => Effect.succeed(undefined)),
      )
      return consumed !== undefined
    })

    const requireResponder = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionErrors.NotFoundError({ sessionID })
      if (!(yield* presence.hasResponder({ location: session.location, mode: session.mode })))
        return yield* new RejectedError({ reason: "no_responder" })
      return Effect.void
    })

    function relevant(input: AssertInput, rules: Permission.Ruleset) {
      return rules.filter((rule) => Wildcard.match(input.action, rule.action))
    }

    const evaluateInput = Effect.fnUntraced(function* (input: AssertInput) {
      const configuration = yield* configured(input.sessionID, input.agent)
      if (
        configuration.boundChild &&
        (input.action === "task" ||
          input.action === "subagent" ||
          input.resources.some(
            (resource) =>
              PermissionEffective.evaluate(configuration.parentRules ?? [], input.action, resource) === "deny",
          ))
      )
        return { effect: "deny" as const, rules: PermissionEffective.childRules(configuration.rules) }
      if (input.resources.some((resource) => evaluate(input.action, resource, configuration.rules).effect === "deny"))
        return { effect: "deny" as const, rules: configuration.rules }
      const rules = configuration.consultSaved ? merge(configuration.rules, yield* savedRules()) : configuration.rules
      const effects = input.resources.map((resource) => evaluate(input.action, resource, rules).effect)
      const effect: Permission.Effect = effects.includes("deny") ? "deny" : effects.includes("ask") ? "ask" : "allow"
      const event = yield* hooks.trigger("permission", "evaluate", {
        sessionID: input.sessionID,
        agent: input.agent,
        action: input.action,
        resources: input.resources,
        metadata: input.metadata,
        source: input.source,
        effect,
      })
      // Hooks can introduce a new ask after configuration was clamped for unattended execution.
      return {
        effect: !configuration.attended && event.effect === "ask" ? ("deny" as const) : event.effect,
        message: event.message,
        rules,
      }
    })

    function request(input: AssertInput, message?: string): Request {
      // Omit absent optionals so the payload matches its JSON wire form: the
      // schema's `optional` requires the key to be absent, and an explicit
      // `undefined` fails decode — in-process listeners decode the same
      // object clients receive after serialization.
      return {
        id: input.id ?? ID.create(),
        sessionID: input.sessionID,
        action: input.action,
        resources: input.resources,
        ...(input.save !== undefined ? { save: input.save } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(message !== undefined ? { message } : {}),
      }
    }

    const create = (request: Request, agent?: Agent.ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<void, DeclinedError | CorrectedError | RejectedError>()
          const item = { request, agent, deferred }
          if (closed) {
            yield* Deferred.fail(deferred, new RejectedError())
            return item
          }
          if (pending.has(request.id))
            return yield* Effect.die(new Error(`Duplicate pending permission ID: ${request.id}`))
          pending.set(request.id, item)
          yield* bus
            .publish(Permission.Event.Asked, request)
            .pipe(Effect.onError(() => Effect.sync(() => pending.delete(request.id))))
          return item
        }),
      )

    const ask = Effect.fn("Permission.ask")(function* (input: AssertInput) {
      if (closed) return { id: input.id ?? ID.create(), effect: "deny" as const }
      const result = yield* evaluateInput(input).pipe(
        Effect.catchTag("Permission.BlockedError", () =>
          Effect.succeed({ effect: "deny" as const, message: "Custom composition is unavailable", rules: [] }),
        ),
      )
      const value = request(input, result.message)
      if (result.effect === "ask") {
        const granted = yield* consultGrant(input)
        const effect = granted ? ("allow" as const) : result.effect
        if (!granted) yield* create(value, input.agent)
        return { id: value.id, effect }
      }
      return { id: value.id, effect: result.effect }
    })

    const assert = Effect.fn("Permission.assert")((input: AssertInput) =>
      Effect.gen(function* () {
        if (closed) return yield* Effect.die(new DeclinedError())
        const result = yield* evaluateInput(input)
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            if (result.effect === "deny") {
              return yield* new BlockedError({
                rules: relevant(input, result.rules),
                permission: input.action,
                resources: input.resources,
                reason: result.message,
              })
            }
            if (result.effect === "allow") return
            if (yield* consultGrant(input)) return
            // A legacy SSE client cannot observe custom asks, so it cannot
            // keep a custom prompt parked (ADR-20 §2.7).
            yield* requireResponder(input.sessionID)
            const item = yield* create(request(input, result.message), input.agent)
            return yield* restore(
              Deferred.await(item.deferred).pipe(
                // Deliberate defect tunnel: leaves wrap execution in blanket `mapError`, which
                // must not convert a user's decline into model-facing tool output. The decline
                // resurfaces as a typed failure at SessionModelRequest.executeTool. A decline
                // WITH feedback (CorrectedError) intentionally stays typed so the leaf can turn
                // it into ToolFailure and the model continues.
                Effect.catchTag("Permission.DeclinedError", (error) => Effect.die(error)),
                Effect.timeoutOrElse({
                  duration: Duration.millis(presence.ttlMs),
                  orElse: () =>
                    Effect.gen(function* () {
                      yield* bus
                        .publish(Permission.Event.Replied, {
                          sessionID: item.request.sessionID,
                          requestID: item.request.id,
                          reply: "reject",
                        })
                        .pipe(Effect.ignore)
                      pending.delete(item.request.id)
                      yield* new AskExpiredError({ requestID: item.request.id, ttlMs: presence.ttlMs })
                    }),
                }),
              ),
            ).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  pending.delete(item.request.id)
                }),
              ),
            )
          }),
        )
      }),
    )

    const reply = Effect.fn("Permission.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (!existing) return yield* new NotFoundError({ requestID: input.requestID })
          yield* bus.publish(Permission.Event.Replied, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
            reply: input.reply,
          })

          if (input.reply === "reject") {
            yield* Deferred.fail(
              existing.deferred,
              input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
            )
            pending.delete(input.requestID)
            // Each operation owns its approval; historical Tool rejection still ends the Session batch.
            if (existing.request.source?.type === "operation") return
            for (const [id, item] of pending) {
              if (
                item.request.sessionID !== existing.request.sessionID ||
                item.request.source?.type === "operation"
              )
                continue
              yield* bus.publish(Permission.Event.Replied, {
                sessionID: item.request.sessionID,
                requestID: item.request.id,
                reply: "reject",
              })
              // Feedback applies to the whole batch, so parallel asks don't end the step.
              yield* Deferred.fail(
                item.deferred,
                input.message ? new CorrectedError({ feedback: input.message }) : new DeclinedError(),
              )
              pending.delete(id)
            }
            return
          }

          if (input.reply === "always" && existing.request.save?.length) {
            yield* saved.add({
              projectID: location.project.id,
              action: existing.request.action,
              resources: existing.request.save,
            })
          }
          yield* Deferred.succeed(existing.deferred, undefined)
          pending.delete(input.requestID)
          if (input.reply !== "always" || !existing.request.save?.length) return

          for (const [id, item] of pending) {
            const result = yield* evaluateInput({ ...item.request, agent: item.agent }).pipe(
              Effect.catchTag("Session.NotFoundError", () => Effect.undefined),
              Effect.catchTag("Permission.BlockedError", () => Effect.undefined),
            )
            if (result?.effect !== "allow") continue
            yield* bus.publish(Permission.Event.Replied, {
              sessionID: item.request.sessionID,
              requestID: item.request.id,
              reply: "always",
            })
            yield* Deferred.succeed(item.deferred, undefined)
            pending.delete(id)
          }
        }),
      ),
    )

    const list = Effect.fn("Permission.list")(function* () {
      return Array.from(pending.values(), (item) => item.request)
    })

    const get = Effect.fn("Permission.get")(function* (id: ID) {
      return pending.get(id)?.request
    })

    const forSession = Effect.fn("Permission.forSession")(function* (sessionID: SessionSchema.ID) {
      return Array.from(pending.values(), (item) => item.request).filter((request) => request.sessionID === sessionID)
    })

    return Service.of({ ask, assert, reply, get, forSession, list, close, effectiveRules })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    Location.node,
    Agent.node,
    SessionStore.node,
    SessionComposition.node,
    PermissionSaved.node,
    PluginHooks.node,
    SessionPermissionOverride.node,
    ApprovalPresence.node,
  ],
})
