import { CompositionResolver } from "@aigcfroge/core/composition-resolver"
import { Agent } from "@aigcfroge/core/agent"
import { CustomProfile } from "@aigcfroge/core/custom-profile"
import { AssetPlacement } from "@aigcfroge/core/asset-placement"
import { PromptAsset } from "@aigcfroge/core/prompt-asset"
import { SkillAsset } from "@aigcfroge/core/skill-asset"
import { CommandAsset } from "@aigcfroge/core/command-asset"
import { LocationServiceMap } from "@aigcfroge/core/location-services"
import { ProductModePolicy } from "@aigcfroge/core/product-mode-policy"
import { Plugin } from "@aigcfroge/core/plugin/service"
import { Session } from "@aigcfroge/core/session"
import { SessionErrors } from "@aigcfroge/core/session/error"
import { SessionComposition } from "@aigcfroge/core/session/composition"
import {
  ApiNotFoundError,
  CompositionResolveError,
  ConflictError,
  InvalidRequestError,
  SessionBusyError,
  UnsupportedProductModeError,
} from "@aigcfroge/protocol/errors"
import { WorkspaceRouteContext } from "@aigcfroge/protocol/middleware/workspace-routing"
import { Composition } from "@aigcfroge/schema/composition"
import { Location } from "@aigcfroge/core/location"
import { HttpApiBuilder } from "effect/http-api"
import { Effect, Schema } from "effect"
import { Api } from "../api"
import { locationRefForRoute } from "../middleware/workspace-routing"
import { missingSession } from "./session-error"

const failedSnapshot = (error: SessionComposition.Error) =>
  new CompositionResolveError({
    code: "snapshot_unavailable",
    message: `Custom session snapshot is unavailable: ${error._tag}`,
  })

const lifecycleErrorHandlers = {
  AgentNotAllowedError: (error: Agent.AgentNotAllowedError) =>
    new InvalidRequestError({ message: error.message, field: "agent", kind: "agent_mode_unavailable" }),
  "Session.ControllerConflictError": (error: SessionErrors.ControllerConflictError) =>
    new InvalidRequestError({ message: error.message, field: error.field, kind: error.kind }),
  UnsupportedProductModeError: (error: ProductModePolicy.UnsupportedProductModeError) =>
    new UnsupportedProductModeError({ mode: error.mode, message: error.message }),
  "Composition.ResolveError": (error: Composition.ResolveError) =>
    new CompositionResolveError({ code: error.code, message: error.message, diagnostics: error.diagnostics }),
  "Session.CompositionConflictError": (error: Session.CompositionConflictError) =>
    new ConflictError({ resource: error.sessionID, message: `Custom session conflict: ${error.reason}` }),
  "SessionComposition.SnapshotNotFoundError": failedSnapshot,
  "SessionComposition.SnapshotDecodeError": failedSnapshot,
  "SessionComposition.DependencyMissingError": failedSnapshot,
  "SessionComposition.AgentDelegationForbiddenError": failedSnapshot,
}

export const CustomCompositionHandler = HttpApiBuilder.group(Api, "custom-composition", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const sessions = yield* Session.Service
    const compositions = yield* SessionComposition.Service
    const atLocation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const route = yield* WorkspaceRouteContext
        const context = yield* locations.contextEffect(locationRefForRoute(route)).pipe(
          Effect.mapError(
            (error) =>
              new ApiNotFoundError({
                name: "NotFoundError",
                data: { message: `Location not found: ${error.directory}` },
              }),
          ),
        )
        return yield* Plugin.awaitActivation.pipe(Effect.andThen(effect), Effect.provideContext(context))
      })

    return handlers
      .handle("custom-composition.plan", ({ payload }) =>
        atLocation(
          Effect.gen(function* () {
            if (!ProductModePolicy.isCustomModeEnabled())
              return yield* new UnsupportedProductModeError({
                mode: "custom",
                message: ProductModePolicy.CUSTOM_MODE_DISABLED_MESSAGE,
              })
            const resolver = yield* CompositionResolver.Service
            return yield* resolver.resolve(payload)
          }),
        ),
      )
      .handle("custom-composition.start", ({ payload }) =>
        atLocation(
          Effect.gen(function* () {
            const route = yield* WorkspaceRouteContext
            return yield* sessions
              .createCustom({
                id: payload.sessionID === undefined ? undefined : Session.ID.make(payload.sessionID),
                location: locationRefForRoute(route),
                composition: payload.composition,
                expectedPlanDigest: payload.expectedPlanDigest,
                title: payload.title,
                model: payload.model,
                executorPreference: payload.executorPreference,
              })
              .pipe(
                Effect.catchTags(lifecycleErrorHandlers),
                Effect.catchTag(
                  "FileSystem.DirectoryNotFoundError",
                  (error) =>
                    new InvalidRequestError({ field: "directory", message: `Directory not found: ${error.directory}` }),
                ),
                Effect.catchTag(
                  "Session.NotFoundError",
                  () => new InvalidRequestError({ message: "Custom session parent is unavailable" }),
                ),
              )
          }),
        ),
      )
      .handle("custom-composition.upgrade", ({ payload }) =>
        atLocation(
          Effect.gen(function* () {
            const route = yield* WorkspaceRouteContext
            const source = yield* sessions
              .get(Session.ID.make(payload.sessionID))
              .pipe(Effect.catchTag("Session.NotFoundError", missingSession))
            const location = locationRefForRoute(route)
            const owner = locationRefForRoute(source.location)
            if (owner.directory !== location.directory || owner.workspaceID !== location.workspaceID)
              return yield* new ConflictError({
                resource: source.id,
                message: "Upgrade source belongs to another Location",
              })
            return yield* sessions.upgradeCustom({ ...payload, sessionID: source.id }).pipe(
              Effect.catchTags(lifecycleErrorHandlers),
              Effect.catchTag(
                "FileSystem.DirectoryNotFoundError",
                (error) =>
                  new InvalidRequestError({ field: "directory", message: `Directory not found: ${error.directory}` }),
              ),
              Effect.catchTag("Session.NotFoundError", missingSession),
              Effect.catchTag(
                "Session.BusyError",
                (error) =>
                  new SessionBusyError({ sessionID: error.sessionID, message: `Session is busy: ${error.sessionID}` }),
              ),
              Effect.catchTag(
                "Session.UpgradeSourceModeError",
                (error) =>
                  new ConflictError({
                    resource: error.sessionID,
                    message: "Upgrade requires an ordinary source session",
                  }),
              ),
              Effect.catchTag(
                "Session.UpgradeSourceMovedError",
                (error) =>
                  new ConflictError({ resource: error.sessionID, message: "Upgrade source moved while freezing" }),
              ),
            )
          }),
        ),
      )
      .handle("custom-composition.health", ({ query }) =>
        atLocation(
          Effect.gen(function* () {
            const resolver = yield* CompositionResolver.Service
            return yield* resolver
              .checkHealth(query.path)
              .pipe(
                Effect.mapError(
                  (error) =>
                    new InvalidRequestError({ message: `Profile not found: ${error.relativePath}`, field: "path" }),
                ),
              )
          }),
        ),
      )
      .handle("custom-composition.references", ({ query }) =>
        atLocation(
          Effect.gen(function* () {
            if ((query.scope === undefined) !== (query.targetRoot === undefined))
              return yield* new InvalidRequestError({
                field: query.scope === undefined ? "scope" : "targetRoot",
                message: "Reference scope and targetRoot must be supplied together",
              })
            const kind = yield* Schema.decodeUnknownEffect(Composition.AllowedKind)(query.kind).pipe(
              Effect.mapError(() => new InvalidRequestError({ message: "Unsupported reference kind", field: "kind" })),
            )
            if (query.scope !== undefined && kind !== "prompt" && kind !== "skill" && kind !== "command")
              return yield* new InvalidRequestError({
                field: "kind",
                message: `Selected targets are unsupported for ${kind} references`,
              })
            const target = yield* Effect.gen(function* () {
              if (kind === "prompt") {
                const owner = yield* PromptAsset.Service
                return (yield* owner.select(query.scope ?? "location")).target
              }
              if (kind === "skill") {
                const owner = yield* SkillAsset.Service
                return (yield* owner.select(query.scope ?? "location")).target
              }
              if (kind === "command") {
                const owner = yield* CommandAsset.Service
                return (yield* owner.select(query.scope ?? "location")).target
              }
              return undefined
            }).pipe(
              Effect.mapError(
                (error) =>
                  new InvalidRequestError({
                    field: "scope",
                    message: error instanceof Error ? error.message : String(error),
                  }),
              ),
            )
            if (target !== undefined && query.scope !== undefined && query.targetRoot !== undefined) {
              const mismatch = AssetPlacement.targetMismatch(
                target,
                new AssetPlacement.Target({ scope: query.scope, root: query.targetRoot }),
              )
              if (mismatch) return yield* new ConflictError({ resource: query.targetRoot, message: mismatch.message })
            }
            const profiles = yield* CustomProfile.Service
            const location = yield* Location.Service
            const includeLegacyLocation = query.scope === undefined
            return {
              profiles: yield* profiles
                .references({ kind, path: query.path, target, includeLegacyLocation })
                .pipe(Effect.mapError((error) => new InvalidRequestError({ message: error.reason, field: "path" }))),
              ...(yield* compositions
                .references({ location, kind, path: query.path, target, includeLegacyLocation })
                .pipe(Effect.mapError((error) => new InvalidRequestError({ message: error.message, field: "path" })))),
            }
          }),
        ),
      )
  }),
)
