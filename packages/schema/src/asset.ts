export * as Asset from "./asset"

import { Schema } from "effect"

export const AssetKindId = Schema.Literals(["prompt", "skill", "mcp", "command", "agent", "workflow", "plugin", "custom-profile"])
export type AssetKindId = typeof AssetKindId.Type

export const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length >= 1, { message: "Name must be at least 1 code point" })),
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length <= 80, { message: "Name must be at most 80 code points" })),
)

export const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((input) => Array.from(input).length <= 300, {
    message: "Description must be at most 300 code points",
  })),
)

export class AssetSummary extends Schema.Class<AssetSummary>("Asset.Summary")({
  kind: AssetKindId,
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Schema.String,
}) {}

export class AssetError extends Schema.TaggedErrorClass<AssetError>()("AssetError", {
  kind: Schema.String,
  reason: Schema.Literals([
    "unknown_kind",
    "invalid_candidate",
    "path_escape",
    "owner_root_escape",
    "name_conflict",
    "path_conflict",
    "stale_revision",
    "overwrite_confirmation_required",
    "delete_confirmation_required",
    "permission_denied",
    "write_failed",
    "reload_failed",
    "readback_mismatch",
    "rollback_failed",
    "concurrent_modification",
  ]),
  message: Schema.String,
}) {}
