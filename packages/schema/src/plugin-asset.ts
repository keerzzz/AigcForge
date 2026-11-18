export * as PluginAsset from "./plugin-asset.js"

import { Effect, Schema } from "effect"
import { optional } from "./schema.js"

// -- Branded scalars --
export const Name = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(80)),
  Schema.brand("PluginAsset.Name"),
  Schema.annotate({ identifier: "PluginAsset.Name" }),
)
export type Name = typeof Name.Type

export const Description = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(300)),
  Schema.brand("PluginAsset.Description"),
  Schema.annotate({ identifier: "PluginAsset.Description" }),
)
export type Description = typeof Description.Type

export const Revision = Schema.String.pipe(
  Schema.check(Schema.isMinLength(64)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  Schema.brand("PluginAsset.Revision"),
  Schema.annotate({ identifier: "PluginAsset.Revision" }),
)
export type Revision = typeof Revision.Type

export const Content = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(1_000_000)),
  Schema.brand("PluginAsset.Content"),
  Schema.annotate({ identifier: "PluginAsset.Content" }),
)
export type Content = typeof Content.Type

export const BaseRevision = Schema.Union([Schema.Null, Revision])
export type BaseRevision = typeof BaseRevision.Type

export class Candidate extends Schema.Class<Candidate>("PluginAsset.Candidate")(
  Schema.Struct({
    name: Name,
    description: Description,
    content: Content,
    relativePath: optional(Schema.String),
  }).annotate({ identifier: "PluginAsset.Candidate" }),
) {}

// -- Sub-types --
export class Author extends Schema.Class<Author>("PluginAsset.Author")(
  Schema.Struct({
    name: Schema.String,
    email: optional(Schema.String),
  }).annotate({ identifier: "PluginAsset.Author" }),
) {}

export class SourceDef extends Schema.Class<SourceDef>("PluginAsset.SourceDef")(
  Schema.Struct({
    type: Schema.Literals(["mcp", "openapi", "bundled"]),
    mcp: optional(Schema.Struct({ name: Schema.String })),
    openapi: optional(Schema.Struct({ url: Schema.String })),
  }).annotate({ identifier: "PluginAsset.SourceDef" }),
) {}

export class HookDef extends Schema.Class<HookDef>("PluginAsset.HookDef")(
  Schema.Struct({
    event: Schema.Literals([
      "PreToolUse",
      "PostToolUse",
      "Stop",
      "UserPromptSubmit",
      "Notification",
      "PermissionRequest",
      "SessionStart",
      "SessionEnd",
    ]),
    command: Schema.String,
    timeout: optional(Schema.Number),
  }).annotate({ identifier: "PluginAsset.HookDef" }),
) {}

// -- Asset schemas --
export class Frontmatter extends Schema.Class<Frontmatter>("PluginAsset.Frontmatter")(
  Schema.Struct({
    kind: Schema.Literal("plugin"),
    name: Name,
    description: Description,
    version: Schema.String,
    category: optional(Schema.String),
    author: optional(Author),
    source: optional(SourceDef),
    hooks: optional(Schema.Array(HookDef)),
  }).annotate({ identifier: "PluginAsset.Frontmatter" }),
) {}

export class Summary extends Schema.Class<Summary>("PluginAsset.Summary")(
  Schema.Struct({
    kind: Schema.Literal("plugin"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
    source: optional(Schema.String),
    toolCount: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  }).annotate({ identifier: "PluginAsset.Summary" }),
) {}

export class Info extends Schema.Class<Info>("PluginAsset.Info")(
  Schema.Struct({
    kind: Schema.Literal("plugin"),
    name: Name,
    description: Description,
    relativePath: Schema.String,
    revision: Revision,
    content: Content,
    version: Schema.String,
    category: optional(Schema.String),
    author: optional(Author),
    source: optional(SourceDef),
    hooks: optional(Schema.Array(HookDef)),
  }).annotate({ identifier: "PluginAsset.Info" }),
) {}

export const InvalidErrorTag = Schema.Literals(["parse_error", "bad_frontmatter", "name_conflict"])
export type InvalidErrorTag = typeof InvalidErrorTag.Type

export class InvalidEntry extends Schema.Class<InvalidEntry>("PluginAsset.InvalidEntry")(
  Schema.Struct({
    relativePath: Schema.String,
    errorTag: InvalidErrorTag,
  }).annotate({ identifier: "PluginAsset.InvalidEntry" }),
) {}

// -- Bridge types (系统级桥接) --
export const BridgeSource = Schema.Literals(["claude-code", "codex", "cursor", "zcode", "kimi-code"])
export type BridgeSource = typeof BridgeSource.Type

export class BundledCounts extends Schema.Class<BundledCounts>("PluginAsset.BundledCounts")(
  Schema.Struct({
    commands: Schema.Number,
    skills: Schema.Number,
    agents: Schema.Number,
    hooks: Schema.Number,
    mcpServers: Schema.Number,
  }).annotate({ identifier: "PluginAsset.BundledCounts" }),
) {}

export class BridgeEntry extends Schema.Class<BridgeEntry>("PluginAsset.BridgeEntry")(
  Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    source: BridgeSource,
    category: optional(Schema.String),
    originPath: Schema.String,
    format: Schema.String,
    bundled: BundledCounts,
  }).annotate({ identifier: "PluginAsset.BridgeEntry" }),
) {}
