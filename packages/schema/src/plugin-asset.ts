export * as PluginAsset from "./plugin-asset"

import { Effect, Schema } from "effect"

// -- Branded scalars --
export const Name = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((s) => Array.from(s).length >= 1, { message: "Min 1 code point" })),
  Schema.check(Schema.makeFilter<string>((s) => Array.from(s).length <= 80, { message: "Max 80 code points" })),
  Schema.brand("PluginAsset.Name"),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.makeFilter<string>((s) => Array.from(s).length <= 300, { message: "Max 300 code points" })),
  Schema.brand("PluginAsset.Description"),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("PluginAsset.Revision"),
)
export type Revision = typeof Revision.Type

// -- Sub-types --
export class Author extends Schema.Class<Author>("PluginAsset.Author")({
  name: Schema.String,
  email: Schema.optional(Schema.String),
}) {}

export class SourceDef extends Schema.Class<SourceDef>("PluginAsset.SourceDef")({
  type: Schema.Literals(["mcp", "openapi", "bundled"]),
  mcp: Schema.optional(Schema.Struct({ name: Schema.String })),
  openapi: Schema.optional(Schema.Struct({ url: Schema.String })),
}) {}

export class HookDef extends Schema.Class<HookDef>("PluginAsset.HookDef")({
  event: Schema.Literals([
    "PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit",
    "Notification", "PermissionRequest", "SessionStart", "SessionEnd",
  ]),
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
}) {}

// -- Asset schemas --
export class Frontmatter extends Schema.Class<Frontmatter>("PluginAsset.Frontmatter")({
  kind: Schema.Literal("plugin"),
  name: Name,
  description: Description,
  version: Schema.String,
  category: Schema.optional(Schema.String),
  author: Schema.optional(Author),
  source: Schema.optional(SourceDef),
  hooks: Schema.optional(Schema.Array(HookDef)),
}) {}

export class Summary extends Schema.Class<Summary>("PluginAsset.Summary")({
  kind: Schema.Literal("plugin"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  source: Schema.optional(Schema.String),
  toolCount: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
}) {}

export class Info extends Schema.Class<Info>("PluginAsset.Info")({
  kind: Schema.Literal("plugin"),
  name: Name,
  description: Description,
  relativePath: Schema.String,
  revision: Revision,
  version: Schema.String,
  category: Schema.optional(Schema.String),
  author: Schema.optional(Author),
  source: Schema.optional(SourceDef),
  hooks: Schema.optional(Schema.Array(HookDef)),
}) {}

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("PluginAsset.InvalidEntry")({
  relativePath: Schema.String,
  errorTag: InvalidErrorTag,
}) {}

// -- Bridge types (系统级桥接) --
export const BridgeSource = Schema.Literals([
  "claude-code", "codex", "cursor", "zcode", "kimi-code",
])
export type BridgeSource = typeof BridgeSource.Type

export class BundledCounts extends Schema.Class<BundledCounts>("PluginAsset.BundledCounts")({
  commands: Schema.Number,
  skills: Schema.Number,
  agents: Schema.Number,
  hooks: Schema.Number,
  mcpServers: Schema.Number,
}) {}

export class BridgeEntry extends Schema.Class<BridgeEntry>("PluginAsset.BridgeEntry")({
  name: Schema.String,
  description: Schema.String,
  source: BridgeSource,
  category: Schema.optional(Schema.String),
  originPath: Schema.String,
  format: Schema.String,
  bundled: BundledCounts,
}) {}
