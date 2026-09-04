export * as CustomCompositionHandlers from "./custom-composition"

import { LocationServiceMap } from "@aigcfroge/core/location-layer"
import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { Composition } from "@aigcfroge/schema/composition"
import { SessionV2 } from "@aigcfroge/core/session"
import { SessionSchema } from "@aigcfroge/core/session/schema"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Effect, Layer } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  InvalidRequestError,
  SessionBusyError,
  SessionNotFoundError,
  ConflictError,
  CompositionResolveError,
  UnsupportedProductModeError,
} from "../errors"
import { locationRefForRoute, WorkspaceRouteContext } from "../middleware/workspace-routing"

export const customCompositionHandlers = HttpApiBuilder.group(InstanceHttpApi, "custom-composition", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap

    const plan = Effect.fn("CustomCompositionHttpApi.plan")(function* (ctx: { payload: Composition.CompositionInput }) {
      if (!ProductModePolicy.isCustomModeEnabled()) {
        // S7: runtime disabled is a typed disabled error on every custom
        // endpoint, matching the canonical surface.
        return yield* new UnsupportedProductModeError({
          mode: "custom",
          message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
        })
      }
      const route = yield* WorkspaceRouteContext
      const layer = locations.get(locationRefForRoute(route))
      const resolver = yield* CompositionResolver.Service.pipe(Effect.provide(layer), Effect.orDie)
      const res = yield* resolver.resolve(ctx.payload)
      return res
    })

    const start = Effect.fn("CustomCompositionHttpApi.start")(function* (ctx: { payload: Composition.StartInput }) {
      if (!ProductModePolicy.isCustomModeEnabled()) {
        return yield* new UnsupportedProductModeError({
          mode: "custom",
          message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
        })
      }
      const request = yield* HttpServerRequest.HttpServerRequest
      const caps = request.headers[ProductModePolicy.CAPABILITIES_HEADER]
      if (!ProductModePolicy.isCustomCapable(caps)) {
        // S7 parity: capability missing is a typed unsupported-mode error on
        // both the canonical (/api/session/custom) and legacy surfaces.
        return yield* Effect.fail(
          new UnsupportedProductModeError({
            mode: "custom",
            message: `Custom mode requires capability header '${ProductModePolicy.CAPABILITIES_HEADER}: ${ProductModePolicy.CAPABILITY_CUSTOM_V1}'`,
          }),
        )
      }
      const route = yield* WorkspaceRouteContext
      const location = locationRefForRoute(route)
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
            // S7 parity: canonical session.custom maps resolve failures to a
            // typed 422 CompositionResolveError, not a generic 400.
            Effect.fail(
              new CompositionResolveError({ code: err.code, message: err.message, diagnostics: err.diagnostics }),
            ),
          ),
          Effect.catchTag("Session.PromptConflictError", (err) =>
            // S7 parity: canonical session.custom maps conflicts to 409.
            Effect.fail(new ConflictError({ message: `Session conflict: ${err.sessionID}`, resource: err.sessionID })),
          ),
          Effect.catchTag("UnsupportedProductModeError", (err) =>
            Effect.fail(new UnsupportedProductModeError({ mode: err.mode, message: err.message })),
          ),
          Effect.catchTag("SessionComposition.SnapshotAlreadyExistsError", (err) =>
            Effect.fail(
              new ConflictError({
                message: `Snapshot already exists for session ${err.sessionID}`,
                resource: err.sessionID,
              }),
            ),
          ),
          Effect.catchTag("SessionComposition.SnapshotDecodeError", (err) =>
            Effect.fail(new InvalidRequestError({ message: `Snapshot decode error: ${err.message}` })),
          ),
        )
      return new Composition.StartResponse({
        session: res.session,
        snapshot: res.snapshot,
      })
    })

    const upgrade = Effect.fn("CustomCompositionHttpApi.upgrade")(function* (ctx: {
      payload: Composition.UpgradeInput
    }) {
      if (!ProductModePolicy.isCustomModeEnabled()) {
        return yield* new UnsupportedProductModeError({
          mode: "custom",
          message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
        })
      }
      const request = yield* HttpServerRequest.HttpServerRequest
      const caps = request.headers[ProductModePolicy.CAPABILITIES_HEADER]
      if (!ProductModePolicy.isCustomCapable(caps)) {
        // S7 parity: capability missing is a typed unsupported-mode error.
        return yield* Effect.fail(
          new UnsupportedProductModeError({
            mode: "custom",
            message: `Custom mode requires capability header '${ProductModePolicy.CAPABILITIES_HEADER}: ${ProductModePolicy.CAPABILITY_CUSTOM_V1}'`,
          }),
        )
      }
      const v2session = yield* SessionV2.Service
      const res = yield* v2session
        .upgradeCustom({
          sessionID: SessionSchema.ID.make(ctx.payload.sessionID),
          composition: ctx.payload.composition,
          expectedPlanDigest: ctx.payload.expectedPlanDigest,
          title: ctx.payload.title,
        })
        .pipe(
          Effect.catchTag("Session.NotFoundError", (err) =>
            Effect.fail(
              new SessionNotFoundError({
                sessionID: err.sessionID,
                message: `Session not found: ${err.sessionID}`,
              }),
            ),
          ),
          Effect.catchTag("Session.UpgradeSourceModeError", (err) =>
            Effect.fail(
              new InvalidRequestError({
                message: `Session ${err.sessionID} has mode "${err.mode}"; upgrade requires a custom source session`,
              }),
            ),
          ),
          Effect.catchTag("Session.SessionBusyError", (err) =>
            Effect.fail(
              new SessionBusyError({
                sessionID: err.sessionID,
                message: `Session is busy: ${err.sessionID}`,
              }),
            ),
          ),
          Effect.catchTag("Composition.ResolveError", (err) =>
            // S7 parity: resolve failures are a typed 422, matching the
            // canonical create surface.
            Effect.fail(
              new CompositionResolveError({ code: err.code, message: err.message, diagnostics: err.diagnostics }),
            ),
          ),
          Effect.catchTag("Session.PromptConflictError", (err) =>
            Effect.fail(new ConflictError({ message: `Session conflict: ${err.sessionID}`, resource: err.sessionID })),
          ),
          Effect.catchTag("UnsupportedProductModeError", (err) =>
            Effect.fail(new UnsupportedProductModeError({ mode: err.mode, message: err.message })),
          ),
          Effect.catchTag("SessionComposition.SnapshotAlreadyExistsError", (err) =>
            Effect.fail(
              new ConflictError({
                message: `Snapshot already exists for session ${err.sessionID}`,
                resource: err.sessionID,
              }),
            ),
          ),
          Effect.catchTag("SessionComposition.SnapshotDecodeError", (err) =>
            Effect.fail(new InvalidRequestError({ message: `Snapshot decode error: ${err.message}` })),
          ),
        )
      return new Composition.StartResponse({
        session: res.session,
        snapshot: res.snapshot,
      })
    })

    const health = Effect.fn("CustomCompositionHttpApi.health")(function* (ctx: { query: { path: string } }) {
      const route = yield* WorkspaceRouteContext
      const layer = locations.get(locationRefForRoute(route))
      const customProfiles = yield* CustomProfile.Service.pipe(Effect.provide(layer), Effect.orDie)
      const resolver = yield* CompositionResolver.Service.pipe(Effect.provide(layer), Effect.orDie)

      const profileInfo = yield* customProfiles
        .getByPath(ctx.query.path)
        .pipe(
          Effect.catch(() => Effect.fail(new InvalidRequestError({ message: `Profile not found: ${ctx.query.path}` }))),
        )

      const res = yield* resolver.checkHealth(profileInfo.profile)
      return res
    })

    const references = Effect.fn("CustomCompositionHttpApi.references")(function* (ctx: {
      query: { kind: string; path: string }
    }) {
      const route = yield* WorkspaceRouteContext
      const layer = locations.get(locationRefForRoute(route))
      const resolver = yield* CompositionResolver.Service.pipe(Effect.provide(layer), Effect.orDie)
      const profiles = yield* resolver.findReferencingProfiles(ctx.query.kind, ctx.query.path)
      return {
        profiles: Array.from(profiles),
      }
    })

    return handlers
      .handle("plan", plan)
      .handle("start", start)
      .handle("upgrade", upgrade)
      .handle("health", health)
      .handle("references", references)
  }),
).pipe(Layer.provide(LocationServiceMap.layer))
