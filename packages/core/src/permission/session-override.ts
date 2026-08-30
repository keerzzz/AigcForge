export * as SessionPermissionOverride from "./session-override"

import { Clock, Context, Effect, Layer, Schema } from "effect"
import { SessionSchema } from "../session/schema"
import { SessionStore } from "../session/store"
import { LayerNode } from "../effect/layer-node"
import { SessionV2 } from "../session"
import { EventV2 } from "../event"
import { withStatics } from "../schema"
import { Identifier } from "../util/identifier"

// break-glass 租约时长（计划 §4.1）：每次 enable/renew 写入 60 秒，
// 过期后读取即视为关闭并清理。
export const LEASE_MS = 60_000

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()(
  "PermissionOverride.UnavailableError",
  {
    sessionID: SessionSchema.ID,
    reason: Schema.Literals(["child-session", "unattended"]),
  },
) {}

// 非 durable 事件定义：状态同步给 App 多窗口，不写 durable EventV2（红线 7）。
export const Event = {
  Enabled: EventV2.define({
    type: "permission.override.enabled",
    schema: { sessionID: SessionSchema.ID, expiresAt: Schema.Number },
  }),
  Disabled: EventV2.define({
    type: "permission.override.disabled",
    schema: { sessionID: SessionSchema.ID },
  }),
}

export const OverrideID = Schema.String.pipe(
  Schema.brand("PermissionOverride.ID"),
  withStatics((schema) => ({ create: () => schema.make("pov_" + Identifier.ascending()) })),
)
export type OverrideID = typeof OverrideID.Type

export interface Interface {
  readonly get: (sessionID: SessionSchema.ID) => Effect.Effect<boolean, SessionV2.NotFoundError>
  readonly enable: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionV2.NotFoundError | UnavailableError>
  readonly renew: (sessionID: SessionSchema.ID) => Effect.Effect<void, SessionV2.NotFoundError | UnavailableError>
  readonly disable: (sessionID: SessionSchema.ID) => Effect.Effect<void>
  readonly clear: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@aigcfroge/v2/SessionPermissionOverride") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SessionStore.Service
    const events = yield* EventV2.Service
    // Location-scoped：layer 重建（服务重启/切换目录）即清空。
    const overrides = new Map<SessionSchema.ID, number>()

    const sessionGuard = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      const session = yield* sessions.get(sessionID)
      if (!session) return yield* new SessionV2.NotFoundError({ sessionID })
      if (session.parentID !== undefined) return yield* new UnavailableError({ sessionID, reason: "child-session" })
      if (session.attended === false) return yield* new UnavailableError({ sessionID, reason: "unattended" })
      return Effect.void
    })

    const get = Effect.fn("SessionPermissionOverride.get")(function* (sessionID: SessionSchema.ID) {
      const expiresAt = overrides.get(sessionID)
      if (expiresAt === undefined) return false
      if ((yield* Clock.currentTimeMillis) >= expiresAt) {
        overrides.delete(sessionID)
        return false
      }
      return true
    })

    const grant = Effect.fnUntraced(function* (sessionID: SessionSchema.ID) {
      yield* sessionGuard(sessionID)
      const expiresAt = (yield* Clock.currentTimeMillis) + LEASE_MS
      overrides.set(sessionID, expiresAt)
      yield* events.publish(Event.Enabled, { sessionID, expiresAt })
    })

    const enable = Effect.fn("SessionPermissionOverride.enable")((sessionID: SessionSchema.ID) =>
      grant(sessionID).pipe(Effect.uninterruptible),
    )
    const renew = Effect.fn("SessionPermissionOverride.renew")((sessionID: SessionSchema.ID) => grant(sessionID))
    const disable = Effect.fn("SessionPermissionOverride.disable")(function* (sessionID: SessionSchema.ID) {
      const existed = overrides.delete(sessionID)
      if (existed) yield* events.publish(Event.Disabled, { sessionID })
    })
    const clear = Effect.fn("SessionPermissionOverride.clear")(function* () {
      const ids = [...overrides.keys()]
      overrides.clear()
      yield* Effect.forEach(ids, (sessionID) => events.publish(Event.Disabled, { sessionID }), {
        discard: true,
      })
    })

    return Service.of({ get, enable, renew, disable, clear })
  }),
)

export const locationLayer = layer.pipe(
  Layer.provideMerge(SessionStore.defaultLayer),
  Layer.provideMerge(EventV2.defaultLayer),
)

export const node = LayerNode.make(layer, [EventV2.node, SessionStore.node])
