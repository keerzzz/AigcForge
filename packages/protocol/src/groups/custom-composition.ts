import { Composition } from "@omnixa/schema/composition"
import { CustomProfile } from "@omnixa/schema/custom-profile"
import { AssetPlacement } from "@omnixa/schema/asset-placement"
import { AbsolutePath, optional } from "@omnixa/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import {
  CompositionResolveError,
  ConflictError,
  InvalidRequestError,
  SessionBusyError,
  SessionNotFoundError,
  UnsupportedProductModeError,
} from "../errors.js"
import { Authorization } from "../middleware/authorization.js"
import { InstanceContext, WorkspaceRouting, WorkspaceRoutingQueryFields } from "../middleware/workspace-routing.js"
import { described } from "./metadata.js"

// Fork-retained instance-scoped surface (see prompt-asset.ts for the conventions).
const root = "/custom-composition"

export const CustomCompositionHealthQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
}).annotate({ identifier: "CustomComposition.HealthQuery" })

export const CustomCompositionReferencesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  kind: Schema.String,
  path: Schema.String,
  scope: optional(AssetPlacement.Scope),
  targetRoot: optional(AbsolutePath),
}).annotate({ identifier: "CustomComposition.ReferencesQuery" })

export const CustomCompositionReferencesResponse = Schema.Struct({
  profiles: Schema.Array(CustomProfile.Summary),
  snapshots: Schema.Array(Composition.SnapshotReference),
  snapshotsComplete: Schema.Boolean,
}).annotate({ identifier: "CustomComposition.ReferencesResponse" })

export const CustomCompositionGroup = HttpApiGroup.make("custom-composition")
  .add(
    HttpApiEndpoint.post("custom-composition.plan", `${root}/plan`, {
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
  )
  .add(
    HttpApiEndpoint.post("custom-composition.start", `${root}/start`, {
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
  )
  .add(
    HttpApiEndpoint.post("custom-composition.upgrade", `${root}/upgrade`, {
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
          "Freeze a composition for an idle ordinary source session, creating a new custom root and snapshot without mutating the source.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("custom-composition.health", `${root}/health`, {
      query: CustomCompositionHealthQuery,
      success: described(Composition.Health, "Profile health status"),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "custom-composition.health",
        summary: "Check profile health",
        description: "Check the health and asset freshness of a stored custom profile.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("custom-composition.references", `${root}/references`, {
      query: CustomCompositionReferencesQuery,
      success: described(CustomCompositionReferencesResponse, "Referencing profiles and Session snapshots"),
      error: [InvalidRequestError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "custom-composition.references",
        summary: "Find referencing profiles and Session snapshots",
        description:
          "Find custom profiles and immutable Session snapshots referencing an asset, including moved and archived Sessions. Omitted scope and targetRoot retain Location references; provide both to select a Prompt, Skill or Command owner. Revisions and asset existence do not affect matching. snapshotsComplete is false when a stored snapshot or its historical source cannot be read reliably.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "custom-composition",
      description: "Custom mode composition lifecycle (ADR-17~21).",
    }),
  )
  .middleware(InstanceContext)
  .middleware(WorkspaceRouting)
  .middleware(Authorization)
