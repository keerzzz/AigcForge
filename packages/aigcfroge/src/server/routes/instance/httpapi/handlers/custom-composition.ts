export * as CustomCompositionHandlers from "./custom-composition"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { Composition } from "@aigcfroge/schema/composition"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { Effect, Layer } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { InvalidRequestError } from "../errors"

export const customCompositionHandlers = HttpApiBuilder.group(InstanceHttpApi, "custom-composition", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const plan = Effect.fn("CustomCompositionHttpApi.plan")(function* (ctx: {
      payload: Composition.CompositionInput
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const resolver = yield* CompositionResolver.Service.pipe(Effect.provide(layer), Effect.orDie)
      const res = yield* resolver.resolve(ctx.payload)
      return res
    })

    const health = Effect.fn("CustomCompositionHttpApi.health")(function* (ctx: {
      query: { path: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const customProfiles = yield* CustomProfile.Service.pipe(Effect.provide(layer), Effect.orDie)
      const resolver = yield* CompositionResolver.Service.pipe(Effect.provide(layer), Effect.orDie)

      const profileInfo = yield* customProfiles.getByPath(ctx.query.path).pipe(
        Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Profile not found: ${ctx.query.path}` }))),
      )

      const res = yield* resolver.checkHealth(profileInfo.profile)
      return res
    })

    const references = Effect.fn("CustomCompositionHttpApi.references")(function* (ctx: {
      query: { kind: string; path: string }
    }) {
      const ctx2 = yield* InstanceState.context
      const layer = locations.get(Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) }))
      const resolver = yield* CompositionResolver.Service.pipe(Effect.provide(layer), Effect.orDie)
      const profiles = yield* resolver.findReferencingProfiles(ctx.query.kind, ctx.query.path)
      return {
        profiles: Array.from(profiles),
      }
    })

    return handlers.handle("plan", plan).handle("health", health).handle("references", references)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
