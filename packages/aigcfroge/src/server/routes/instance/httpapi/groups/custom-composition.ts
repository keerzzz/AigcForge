export * as CustomCompositionApiGroup from "./custom-composition"

import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"
import { described } from "./metadata"
import { Composition } from "@aigcfroge/schema/composition"
import { CustomProfile } from "@aigcfroge/schema/custom-profile"
import {
  ConflictError,
  CompositionResolveError,
  InvalidRequestError,
  SessionBusyError,
  SessionNotFoundError,
  UnsupportedProductModeError,
} from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"

const root = "/custom-composition"

export const HealthQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
})

export const ReferencesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  kind: Schema.String,
  path: Schema.String,
})

export const ReferencesResponse = Schema.Struct({
  profiles: Schema.Array(CustomProfile.Summary),
})

export const CustomCompositionPaths = {
  plan: `${root}/plan`,
  start: `${root}/start`,
  upgrade: `${root}/upgrade`,
  health: `${root}/health`,
  references: `${root}/references`,
} as const

export const CustomCompositionApi = HttpApi.make("custom-composition").add(
  HttpApiGroup.make("custom-composition")
    .add(
      HttpApiEndpoint.post("plan", CustomCompositionPaths.plan, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: Composition.CompositionInput,
        success: described(Composition.Plan, "Composition plan"),
        error: [UnsupportedProductModeError, InvalidRequestError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-composition.plan",
          summary: "Resolve custom composition plan",
          description: "Resolve a proposed composition input into a deterministic execution plan.",
        }),
      ),
      HttpApiEndpoint.post("start", CustomCompositionPaths.start, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: Composition.StartInput,
        success: described(Composition.StartResponse, "Started custom session and snapshot"),
        error: [UnsupportedProductModeError, InvalidRequestError, ConflictError, CompositionResolveError],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-composition.start",
          summary: "Start atomic custom composition session",
          description: "Freeze latest facts, create atomic custom session and snapshot.",
        }),
      ),
      HttpApiEndpoint.post("upgrade", CustomCompositionPaths.upgrade, {
        query: Schema.Struct(WorkspaceRoutingQueryFields),
        payload: Composition.UpgradeInput,
        success: described(Composition.StartResponse, "Upgraded custom session and snapshot"),
        error: [
          UnsupportedProductModeError,
          InvalidRequestError,
          SessionNotFoundError,
          SessionBusyError,
          ConflictError,
          CompositionResolveError,
        ],
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-composition.upgrade",
          summary: "Upgrade custom session composition",
          description:
            "Freeze a new composition for an idle custom source session, creating a new custom session and snapshot without mutating the source.",
        }),
      ),
      HttpApiEndpoint.get("health", CustomCompositionPaths.health, {
        query: HealthQuery,
        success: described(Composition.Health, "Profile health status"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-composition.health",
          summary: "Check profile health",
          description: "Check the health and asset freshness of a stored custom profile.",
        }),
      ),
      HttpApiEndpoint.get("references", CustomCompositionPaths.references, {
        query: ReferencesQuery,
        success: described(ReferencesResponse, "Referencing profiles"),
        error: InvalidRequestError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "custom-composition.references",
          summary: "Find referencing profiles",
          description: "Find all custom profiles referencing a specific asset.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization),
)
