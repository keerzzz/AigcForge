import { AgentAsset } from "@aigcfroge/schema/agent-asset"
import { CommandAsset } from "@aigcfroge/schema/command-asset"
import { MCPAsset } from "@aigcfroge/schema/mcp-asset"
import { PluginAsset } from "@aigcfroge/schema/plugin-asset"
import { PromptAsset } from "@aigcfroge/schema/prompt-asset"
import { SkillAsset } from "@aigcfroge/schema/skill-asset"
import { WorkflowAsset } from "@aigcfroge/schema/workflow-asset"
import { Schema } from "effect"

export class Input extends Schema.Class<Input>("SkillProposal.Input")({
  name: SkillAsset.Name,
  description: SkillAsset.Description,
  slash: Schema.Boolean,
  content: Schema.String,
}) {}

export class Facts extends Schema.Class<Facts>("SkillProposal.Facts")({
  relativePath: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isPattern(/^[^<>:"\/\\|?*\x00-\x1F\x7F]+\.md$/)),
  ),
  exists: Schema.Boolean,
  revision: SkillAsset.BaseRevision,
  nameConflict: Schema.Boolean,
  pathConflict: Schema.Boolean,
}) {}

export class CommandInput extends Schema.Class<CommandInput>("CommandProposal.Input")({
  name: CommandAsset.Name,
  description: CommandAsset.Description,
  invocation: CommandAsset.Invocation,
  args: Schema.optional(Schema.String),
  source: CommandAsset.Source,
}) {}

export class CommandFacts extends Schema.Class<CommandFacts>("CommandProposal.Facts")({
  ...Facts.fields,
  revision: CommandAsset.BaseRevision,
}) {}

export class PromptInput extends Schema.Class<PromptInput>("PromptProposal.Input")({
  name: PromptAsset.Name,
  description: PromptAsset.Description,
  template: PromptAsset.Template,
}) {}

export class PromptFacts extends Schema.Class<PromptFacts>("PromptProposal.Facts")({
  ...Facts.fields,
  revision: PromptAsset.BaseRevision,
}) {}

export class AgentInput extends Schema.Class<AgentInput>("AgentProposal.Input")({
  name: AgentAsset.Name,
  description: AgentAsset.Description,
  config: AgentAsset.Config,
  source: AgentAsset.Source,
}) {}

export class AgentFacts extends Schema.Class<AgentFacts>("AgentProposal.Facts")({
  ...Facts.fields,
  revision: AgentAsset.BaseRevision,
  warnings: Schema.Array(AgentAsset.Warning),
}) {}

export class MCPInput extends Schema.Class<MCPInput>("MCPProposal.Input")({
  name: MCPAsset.Name,
  description: MCPAsset.Description,
  command: MCPAsset.Command,
  args: MCPAsset.Candidate.fields.args,
  env: MCPAsset.Candidate.fields.env,
  configJson: MCPAsset.ConfigJson,
}) {}

export class MCPFacts extends Schema.Class<MCPFacts>("MCPProposal.Facts")({
  ...Facts.fields,
  revision: MCPAsset.BaseRevision,
}) {}

export class PluginInput extends Schema.Class<PluginInput>("PluginProposal.Input")({
  name: PluginAsset.Name,
  description: PluginAsset.Description,
  content: PluginAsset.Content,
}) {}

export class PluginFacts extends Schema.Class<PluginFacts>("PluginProposal.Facts")({
  ...Facts.fields,
  relativePath: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isPattern(/^[^<>:"\/\\|?*\x00-\x1F\x7F]+\.plugin\.yaml$/)),
  ),
  revision: PluginAsset.BaseRevision,
}) {}

export class WorkflowInput extends Schema.Class<WorkflowInput>("WorkflowProposal.Input")({
  name: WorkflowAsset.Name,
  description: WorkflowAsset.Description,
  content: WorkflowAsset.Content,
}) {}

export class WorkflowFacts extends Schema.Class<WorkflowFacts>("WorkflowProposal.Facts")({
  ...Facts.fields,
  relativePath: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isPattern(/^[^<>:"\/\\|?*\x00-\x1F\x7F]+\.yaml$/)),
  ),
  revision: WorkflowAsset.BaseRevision,
}) {}

export * as SkillProposalContract from "./contract"
