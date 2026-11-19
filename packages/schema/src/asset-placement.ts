import { Schema } from "effect"
import { AbsolutePath } from "./schema.js"

export const Scope = Schema.Literals(["project", "global", "location"]).pipe(
  Schema.annotate({ identifier: "AssetPlacement.Scope" }),
)
export type Scope = typeof Scope.Type

export class Target extends Schema.Class<Target>("AssetPlacement.Target")(
  Schema.Struct({
    scope: Scope,
    /** Canonical directory that directly owns this asset family. */
    root: AbsolutePath,
  }).annotate({ identifier: "AssetPlacement.Target" }),
) {}

export * as AssetPlacement from "./asset-placement.js"
