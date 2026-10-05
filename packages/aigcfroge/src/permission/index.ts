import { LayerNode } from "@aigcfroge/core/effect/layer-node"
import { ConfigPermissionV1 } from "@aigcfroge/core/v1/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@aigcfroge/core/util/wildcard"
import { Deferred, Effect, Layer, Context, Semaphore } from "effect"
import os from "os"
import { PermissionV1 } from "@aigcfroge/core/v1/permission"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@aigcfroge/core/event"

export const Event = {
  Asked: EventV2.define({ type: "permission.asked", schema: PermissionV1.Request.fields }),
  Replied: EventV2.define({
    type: "permission.replied",
    schema: {
      sessionID: PermissionV1.Request.fields.sessionID,
      requestID: PermissionV1.ID,
      reply: PermissionV1.Reply,
    },
  }),
}

export interface Interface {
  readonly ask: (input: PermissionV1.AskInput) => Effect.Effect<void, PermissionV1.Error>
  readonly reply: (input: PermissionV1.ReplyInput) => Effect.Effect<void, PermissionV1.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionV1.Request>>
}

interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
  // Chat full 危险 action 的逐次确认规则：always 自动放行判定必须与其
  // 同序（追加在 approved 之后），否则自动放行会跳过确认（H1）。
  finalRules?: PermissionV1.Ruleset
}

interface State {
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: PermissionV1.Rule[]
  decisions: Semaphore.Semaphore
}

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: new Map<PermissionV1.ID, PendingEntry>(),
          approved: [],
          decisions: yield* Semaphore.make(1),
        }

        yield* Effect.addFinalizer(() =>
          state.decisions.withPermit(
            Effect.gen(function* () {
              for (const item of state.pending.values()) {
                yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
              }
              state.pending.clear()
            }),
          ),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")((input: PermissionV1.AskInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const current = yield* InstanceState.get(state)
          const rules = input.patterns.map((pattern) =>
            evaluate(
              input.permission,
              pattern,
              input.ruleset,
              current.approved,
              input.finalRules ? [...input.finalRules] : [],
            ),
          )
          if (rules.some((rule) => rule.action === "deny"))
            return yield* new PermissionV1.DeniedError({
              ruleset: input.ruleset.filter((rule) => Wildcard.match(input.permission, rule.permission)),
            })
          if (!rules.some((rule) => rule.action === "ask")) return yield* Effect.void

          const id = input.id ?? PermissionV1.ID.ascending()
          if (current.pending.has(id)) return yield* Effect.die(`Duplicate pending permission ID: ${id}`)
          const info: PermissionV1.Request = {
            id,
            sessionID: input.sessionID,
            permission: input.permission,
            patterns: input.patterns,
            metadata: input.metadata,
            always: input.always,
            tool: input.tool,
          }
          const deferred = yield* Deferred.make<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>()
          current.pending.set(id, {
            info,
            deferred,
            ...(input.finalRules?.length ? { finalRules: input.finalRules } : {}),
          })
          return yield* events
            .publish(Event.Asked, info)
            .pipe(
              Effect.andThen(restore(Deferred.await(deferred))),
              Effect.ensuring(
                current.decisions
                  .withPermit(Effect.sync(() => current.pending.delete(id)))
                  .pipe(
                    Effect.flatMap((removed) =>
                      removed
                        ? events.publish(Event.Replied, { sessionID: input.sessionID, requestID: id, reply: "reject" })
                        : Effect.void,
                    ),
                  ),
              ),
            )
        }),
      ),
    )

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
      const current = yield* InstanceState.get(state)
      const items = yield* current.decisions.withPermit(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const existing = current.pending.get(input.requestID)
            if (!existing) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })
            if (input.reply === "always") {
              current.approved.push(
                ...existing.info.always.map((pattern) => ({
                  permission: existing.info.permission,
                  pattern,
                  action: "allow" as const,
                })),
              )
            }
            const related = Array.from(current.pending.values()).filter((item) => {
              if (item === existing || item.info.sessionID !== existing.info.sessionID) return false
              if (input.reply === "reject") return true
              if (input.reply !== "always") return false
              return item.info.patterns.every(
                (pattern) =>
                  evaluate(item.info.permission, pattern, current.approved, item.finalRules ? [...item.finalRules] : [])
                    .action === "allow",
              )
            })
            const items = [existing, ...related]
            // Settle the entire propagation set before notifying fallible subscribers.
            yield* Effect.forEach(items, (item, index) => {
              current.pending.delete(item.info.id)
              if (input.reply !== "reject") return Deferred.succeed(item.deferred, undefined)
              return Deferred.fail(
                item.deferred,
                index === 0 && input.message
                  ? new PermissionV1.CorrectedError({ feedback: input.message })
                  : new PermissionV1.RejectedError(),
              )
            })
            return items
          }),
        ),
      )
      yield* Effect.uninterruptible(
        Effect.forEach(
          items,
          (item) =>
            events.publish(Event.Replied, {
              sessionID: item.info.sessionID,
              requestID: item.info.id,
              reply: input.reply,
            }),
          { discard: true },
        ),
      )
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermissionV1.Info) {
  const ruleset: PermissionV1.Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule[] {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: PermissionV1.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  const reads = ["list_mcp_resources", "read_mcp_resource"]
  return new Set(
    tools.filter((tool) => {
      const permission = edits.includes(tool) ? "edit" : reads.includes(tool) ? "read" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export const node = LayerNode.make(layer, [EventV2Bridge.node])

export * as Permission from "."
