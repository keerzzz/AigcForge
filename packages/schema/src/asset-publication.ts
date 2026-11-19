import { Schema, Struct } from "effect"
import { Asset } from "./asset.js"
import { AssetPlacement } from "./asset-placement.js"
import { AgentAsset } from "./agent-asset.js"
import { CommandAsset } from "./command-asset.js"
import { MCPAsset } from "./mcp-asset.js"
import { PluginAsset } from "./plugin-asset.js"
import { PromptAsset } from "./prompt-asset.js"
import { SkillAsset } from "./skill-asset.js"
import { WorkflowAsset } from "./workflow-asset.js"
import { Location } from "./location.js"
import { Skill } from "./skill.js"
import { optional } from "./schema.js"

export const Kind = Asset.AssetKindId.pick(["prompt", "skill", "command", "agent", "mcp", "workflow", "plugin"])
export type Kind = typeof Kind.Type

export class RegisteredSkill extends Schema.Class<RegisteredSkill>("AssetPublication.RegisteredSkill")(
  Struct.pick(Skill.Info.fields, ["id", "name", "description", "autoinvoke", "path"]),
) {}

export class Runtime extends Schema.Class<Runtime>("AssetPublication.Runtime")({
  sourceLocation: Location.Ref,
  skills: Schema.Array(RegisteredSkill),
}) {}

function definitionFields<const K extends Kind, I extends Schema.Constraint>(kind: K, invalid: I) {
  return {
    kind: Schema.Literal(kind),
    target: AssetPlacement.Target,
    assets: Schema.Array(
      Asset.AssetSummary.pipe(
        Schema.check(
          Schema.makeFilter((asset) => asset.kind === kind, { message: "Asset kind must match its source" }),
        ),
      ),
    ),
    invalid: Schema.Array(invalid),
  }
}

export class PromptDefinitions extends Schema.Class<PromptDefinitions>("AssetPublication.PromptDefinitions")(
  definitionFields("prompt", PromptAsset.InvalidEntry),
) {}
export class SkillDefinitions extends Schema.Class<SkillDefinitions>("AssetPublication.SkillDefinitions")(
  definitionFields("skill", SkillAsset.InvalidEntry),
) {}
export class CommandDefinitions extends Schema.Class<CommandDefinitions>("AssetPublication.CommandDefinitions")(
  definitionFields("command", CommandAsset.InvalidEntry),
) {}
export class AgentDefinitions extends Schema.Class<AgentDefinitions>("AssetPublication.AgentDefinitions")(
  definitionFields("agent", AgentAsset.InvalidEntry),
) {}
export class MCPDefinitions extends Schema.Class<MCPDefinitions>("AssetPublication.MCPDefinitions")(
  definitionFields("mcp", MCPAsset.InvalidEntry),
) {}
export class WorkflowDefinitions extends Schema.Class<WorkflowDefinitions>("AssetPublication.WorkflowDefinitions")(
  definitionFields("workflow", WorkflowAsset.InvalidEntry),
) {}
export class PluginDefinitions extends Schema.Class<PluginDefinitions>("AssetPublication.PluginDefinitions")(
  definitionFields("plugin", PluginAsset.InvalidEntry),
) {}

export const Definition = Schema.Union([
  PromptDefinitions,
  SkillDefinitions,
  CommandDefinitions,
  AgentDefinitions,
  MCPDefinitions,
  WorkflowDefinitions,
  PluginDefinitions,
]).pipe(Schema.toTaggedUnion("kind"), Schema.annotate({ identifier: "AssetPublication.Definition" }))
export type Definition = typeof Definition.Type

export class SourceError extends Schema.Class<SourceError>("AssetPublication.SourceError")({
  kind: Kind,
  scope: AssetPlacement.Scope,
  target: AssetPlacement.Target.pipe(optional),
  error: Asset.AssetError,
}) {}

export class Publication extends Schema.Class<Publication>("AssetPublication.Publication")({
  runtime: Runtime,
  definitions: Schema.Array(Definition),
  errors: Schema.Array(SourceError),
}) {}

export const Json = Schema.toCodecJson(Publication)

export * as AssetPublication from "./asset-publication.js"
