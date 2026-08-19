export * as CustomCompositionHandlers from "./custom-composition"

import { InstanceState } from "@/effect/instance-state"
import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { Composition } from "@aigcfroge/schema/composition"
import { Location } from "@aigcfroge/core/location"
import { AbsolutePath } from "@aigcfroge/core/schema"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
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

    const start = Effect.fn("CustomCompositionHttpApi.start")(function* (ctx: {
      payload: Composition.StartInput
    }) {
      const request = yield* HttpServerRequest.HttpServerRequest
      const caps = request.headers[ProductModePolicy.CAPABILITIES_HEADER]
      if (!ProductModePolicy.isCustomCapable(caps)) {
        return yield* Effect.fail(
          new InvalidRequestError({
            message: `Custom mode requires capability header '${ProductModePolicy.CAPABILITIES_HEADER}: ${ProductModePolicy.CAPABILITY_CUSTOM_V1}'`,
          }),
        )
      }
      const ctx2 = yield* InstanceState.context
      const location = Location.Ref.make({ directory: AbsolutePath.make(ctx2.directory) })
      const v2session = yield* SessionV2.Service
      const res = yield* v2session
        .createCustom({
          id: ctx.payload.sessionID ? SessionSchema.ID.make(ctx.payload.sessionID) : undefined,
          location,
          composition: ctx.payload.composition,
          expectedPlanDigest: ctx.payload.expectedPlanDigest,
          title: ctx.payload.title,
        })
        .pipe(
          Effect.catchTag("Composition.ResolveError", (err) =>
            Effect.fail(new InvalidRequestError({ message: `${err.code}: ${err.message}` })),
          ),
          Effect.catchTag("Session.PromptConflictError", (err) =>
            Effect.fail(new InvalidRequestError({ message: `Session conflict: ${err.sessionID}` })),
          ),
          Effect.catchTag("UnsupportedProductModeError", (err) =>
            Effect.fail(new InvalidRequestError({ message: err.message })),
          ),
          Effect.catchTag("SessionComposition.SnapshotAlreadyExistsError", (err) =>
            Effect.fail(new InvalidRequestError({ message: `Snapshot already exists for session ${err.sessionID}` })),
          ),
          Effect.catchTag("SessionComposition.SnapshotDecodeError", (err) =>
            Effect.fail(new InvalidRequestError({ message: `Snapshot decode error: ${err.message}` })),
          ),
        )
      return {
        session: res.session,
        snapshot: res.snapshot,
      }
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

    return handlers
      .handle("plan", plan)
      .handle("start", start)
      .handle("health", health)
      .handle("references", references)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
