export * as BuiltInTools from "./builtins"

import { Layer } from "effect"
import { BashTool } from "./bash"
import { ApplyPatchTool } from "./apply-patch"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { ReadToolFileSystem } from "./read-filesystem"
import { SkillTool } from "./skill"
import { TaskTool } from "./task"
import { TaskWriteTool } from "./taskwrite"
import { TaskScheduleTool } from "./taskschedule"
import { TaskSpawnTool } from "./taskspawn"
import { TodoWriteTool } from "./todowrite"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WorkPresetTool } from "./work-preset"
import { ProposePromptAssetTool } from "./propose-prompt-asset"
import { ProposeSkillAssetTool } from "./propose-skill-asset"
import { ProposeMCPAssetTool } from "./propose-mcp-asset"
import { ProposeCommandAssetTool } from "./propose-command-asset"
import { ProposeAgentAssetTool } from "./propose-agent-asset"
import { ProposeWorkflowAssetTool } from "./propose-workflow-asset"
import { ProposePluginAssetTool } from "./propose-plugin-asset"
import { ListAssetsTool } from "./list-assets"
import { WriteTool } from "./write"

/**
 * Composes only the shipped Location-scoped built-in tool transforms.
 * Each tool retains its implementation and focused tests independently. Dynamic
 * MCP and plugin tools later use separate scoped canonical registrations, while
 * provider/model filtering belongs to a future materialization phase rather
 * than this static list. The caller intentionally supplies shared Location
 * services once to this merged set.
 *
 * TODO: Port the remaining launch-follow-up leaves deliberately: edit fuzzy
 * parity, LSP,
 * repo_clone, repo_overview, plan_exit, and Rune/code mode. Keep MCP and plugin
 * transforms separate from this static built-in list.
 */
export const locationLayer = Layer.mergeAll(
  ApplyPatchTool.layer,
  BashTool.layer,
  EditTool.layer,
  GlobTool.layer,
  GrepTool.layer,
  ListAssetsTool.layer,
  QuestionTool.layer,
  ReadTool.layer.pipe(Layer.provide(ReadToolFileSystem.layer)),
  SkillTool.layer,
  TaskTool.layer,
  TaskWriteTool.layer,
  TaskScheduleTool.layer,
  TaskSpawnTool.layer,
  TodoWriteTool.layer,
  WebFetchTool.layer,
  WebSearchTool.layer.pipe(Layer.provide(WebSearchTool.defaultConfigLayer)),
  WriteTool.layer,
  ProposePromptAssetTool.layer,
  ProposeSkillAssetTool.layer,
  ProposeMCPAssetTool.layer,
  ProposeCommandAssetTool.layer,
  ProposeAgentAssetTool.layer,
  ProposeWorkflowAssetTool.layer,
  ProposePluginAssetTool.layer,
  WorkPresetTool.layer,
)
