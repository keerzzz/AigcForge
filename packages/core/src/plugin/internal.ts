export * as PluginInternal from "./internal.js"

import { LLMClient } from "@aigcfroge/ai"
import type { Plugin } from "@aigcfroge/plugin/effect/plugin"
import { LayerNode } from "@aigcfroge/util/effect/layer-node"
import { httpClient } from "@aigcfroge/util/effect/app-node-platform"
import { AppProcess } from "@aigcfroge/util/process"
import { CorrectionStore } from "../session/correction-store.js"
import { ToolIntegrityPlugin } from "./tool-integrity.js"
import { Context, Effect, Scope } from "effect"
import { HttpClient } from "effect/http"
import { Agent } from "../agent.js"
import { Model } from "../model.js"
import { ModelResolver } from "../model-resolver.js"
import { Service } from "./service.js"
import { Provider } from "../provider.js"
import { ProviderDiscovery } from "../provider/discovery.js"
import { ProviderDiscoveryPlugin } from "./provider/discovery.js"
import { Command } from "../command.js"
import { Config } from "../config.js"
import { Credential } from "../credential.js"
import { DelegationExecution } from "../delegation/execution.js"
import { WorkflowExecution } from "../workflow/execution.js"
import { DelegationService } from "../delegation/service.js"
import { Database } from "../database/database.js"
import { llmClient } from "../effect/app-node-platform.js"
import { ConfigAgentPlugin } from "../config/plugin/agent.js"
import { ConfigCommandPlugin } from "../config/plugin/command.js"
import { ConfigCompactionPlugin } from "../config/plugin/compaction.js"
import { ConfigFormatterPlugin } from "../config/plugin/formatter.js"
import { ConfigImagePlugin } from "../config/plugin/image.js"
import { ConfigInstructionPlugin } from "../config/plugin/instruction.js"
import { ConfigLocationWatcherPlugin } from "../config/plugin/location-watcher.js"
import { ConfigMcpPlugin } from "../config/plugin/mcp.js"
import { ConfigProviderPlugin } from "../config/plugin/provider.js"
import { ConfigPolicyPlugin } from "../config/plugin/policy.js"
import { ConfigReferencePlugin } from "../config/plugin/reference.js"
import { ConfigShellPlugin } from "../config/plugin/shell.js"
import { ConfigSnapshotPlugin } from "../config/plugin/snapshot.js"
import { ConfigSkillPlugin } from "../config/plugin/skill.js"
import { ConfigCompatibilityPlugin } from "../config/plugin/compatibility.js"
import { ConfigToolOutputPlugin } from "../config/plugin/tool-output.js"
import { ConfigWebSearchPlugin } from "../config/plugin/websearch.js"
import { ConfigWorktreePlugin } from "../config/plugin/worktree.js"
import { Worktree } from "../worktree.js"
import { WorktreeStrategies } from "../worktree/strategies.js"
import { Bus } from "../bus.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { FileMutation } from "../file-mutation.js"
import { Formatter } from "../formatter.js"
import { Form } from "../form.js"
import { FileSystem } from "../filesystem.js"
import { LocationWatcherPolicy } from "../filesystem/location-watcher-policy.js"
import { FSUtil } from "@aigcfroge/util/fs-util"
import { Global } from "@aigcfroge/util/global"
import { Image } from "../image.js"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Integration } from "../integration.js"
import { Job } from "../job.js"
import { KV } from "../kv.js"
import { Location } from "../location.js"
import { LocationMutation } from "../location-mutation.js"
import { ManagedPolicy } from "../managed-policy.js"
import { ModelsDev } from "../models-dev.js"
import { Mcp } from "../mcp/index.js"
import { Npm } from "@aigcfroge/util/npm"
import { Permission } from "../permission.js"
import { Reference } from "../reference.js"
import { WebSearch } from "../websearch.js"
import { Ripgrep } from "../ripgrep.js"
import { Session } from "../session.js"
import { SessionCompaction } from "../session/compaction.js"
import { SessionInstructions } from "../session/instructions.js"
import { SessionExecution } from "../session/execution.js"
import { SessionStore } from "../session/store.js"
import { SessionComposition } from "../session/composition.js"
import { SubagentJob } from "../session/subagent-job.js"
import { SessionShareV2 } from "../session/share-v2.js"
import { Shell } from "../shell.js"
import { ShellSelect } from "../shell/select.js"
import { Snapshot } from "../snapshot.js"
import { Skill } from "../skill.js"
import { SkillDiscovery } from "../skill/discovery.js"
import { Watcher } from "../filesystem/watcher.js"
import { PatchTool } from "../tool/plugin/patch.js"
import { EditTool } from "../tool/plugin/edit.js"
import { GlobTool } from "../tool/plugin/glob.js"
import { GrepTool } from "../tool/plugin/grep.js"
import { McpResourceTools } from "../tool/plugin/mcp-resource.js"
import { AigcForgeTools } from "../tool/plugin/aigcfroge.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { ReadToolFileSystem } from "../tool/read-filesystem.js"
import { ReadTool } from "../tool/plugin/read.js"
import { ShellTool } from "../tool/plugin/shell.js"
import { SkillTool } from "../tool/plugin/skill.js"
import { SubagentTool } from "../tool/plugin/subagent.js"
import { TaskTool } from "../tool/plugin/task.js"
import { SessionShareTool } from "../tool/plugin/share.js"
import { Tool } from "../tool.js"
import { ToolOutput } from "../tool-output.js"
import { WebFetchTool } from "../tool/plugin/webfetch.js"
import { WebSearchTool } from "../tool/plugin/websearch.js"
import { WellKnown } from "../wellknown.js"
import { WriteTool } from "../tool/plugin/write.js"
import { ListAssetsTool } from "../tool/list-assets.js"
import { DelegationProtocolTool } from "../tool/delegation-protocol.js"
import { TaskCreateTool } from "../tool/task-create.js"
import { TaskDeleteTool } from "../tool/task-delete.js"
import { TaskReorderTool } from "../tool/task-reorder.js"
import { TaskScheduleTool } from "../tool/taskschedule.js"
import { GoalTool } from "../tool/plugin/goal.js"
import { ScheduleTool } from "../tool/plugin/schedule.js"
import { SessionGoal } from "../session/goal.js"
import { TaskSpawnTool } from "../tool/taskspawn.js"
import { TaskUpdateTool } from "../tool/task-update.js"
import { TaskWriteTool } from "../tool/taskwrite.js"
import { TodoWriteTool } from "../tool/todowrite.js"
import { KBTools } from "../tool/kb-tools.js"
import { MemoryTool } from "../tool/memory.js"
import { ProposeMemoryTool } from "../tool/propose-memory.js"
import { ProposeNoteTool } from "../tool/propose-note.js"
import { ReminderCreateTool } from "../tool/reminder-create.js"
import { ReminderUpdateTool } from "../tool/reminder-update.js"
import { ReminderCancelTool } from "../tool/reminder-cancel.js"
import { WorkPresetTool } from "../tool/work-preset.js"
import { ProposeAgentAssetTool } from "../tool/propose-agent-asset.js"
import { ProposeCommandAssetTool } from "../tool/propose-command-asset.js"
import { ProposeMCPAssetTool } from "../tool/propose-mcp-asset.js"
import { ProposePluginAssetTool } from "../tool/propose-plugin-asset.js"
import { ProposePromptAssetTool } from "../tool/propose-prompt-asset.js"
import { ProposeSkillAssetTool } from "../tool/propose-skill-asset.js"
import { ProposeWorkflowAssetTool } from "../tool/propose-workflow-asset.js"
import { KBService } from "../session/kb-service.js"
import { ScheduleService } from "../session/schedule-service.js"
import { SessionTask } from "../session/task.js"
import { SessionTodo } from "../session/todo.js"
import { PersonalMemory } from "../session/personal-memory.js"
import { MetaAgentMemory } from "../agent/meta/memory.js"
import { MetaAgentService } from "../meta-agent/service.js"
import { AgentAssetService } from "../agent-asset-service.js"
import { CommandAssetService } from "../command-asset-service.js"
import { MCPAssetService } from "../mcp-asset-service.js"
import { PromptAssetService } from "../prompt-asset-service.js"
import { SkillAssetService } from "../skill-asset-service.js"
import { PluginAssetService } from "../plugin-asset-service.js"
import { WorkflowAsset } from "../workflow-asset.js"
import { WorkflowAssetService } from "../workflow-asset-service.js"
import { AgentPlugin } from "./agent.js"
import BrowserPlugin from "@aigcfroge/plugin-browser"
import { CommandPlugin } from "./command.js"
import { IdentityPlugin } from "./identity.js"
import { PlanPlugin } from "./plan.js"
import { ModelsDevPlugin } from "./models-dev.js"
import { McpCodeModeDefaultsPlugin } from "./mcp-codemode-defaults.js"
import { ProviderPlugins } from "./provider.js"
import { AigcfrogePlugin } from "./provider/aigcfroge.js"
import { WebSearchPlugins } from "./websearch/index.js"
import { SkillPlugin } from "./skill.js"
import { VcsHgPlugin } from "./vcs/hg.js"
import { ToolInputRepairPlugin } from "./tool-input-repair.js"
import { OptimizePlugin } from "./optimize.js"
import { VcsGitPlugin } from "./vcs/git.js"
import { VerbosityPlugin } from "./verbosity.js"
import { WarmingPlugin } from "./warming.js"
import { WellKnownPlugin } from "../wellknown/plugin.js"

const services = [
  Agent.Service,
  AppProcess.Service,
  CorrectionStore.Service,
  Provider.Service,
  ProviderDiscovery.Service,
  Model.Service,
  ModelResolver.Service,
  Service,
  Command.Service,
  Config.Service,
  Credential.Service,
  DelegationExecution.Service,
  WorkflowExecution.Service,
  DelegationService.Service,
  Database.Service,
  Bus.Service,
  Environment.Service,
  FileAccess.Service,
  FileMutation.Service,
  Formatter.Service,
  LocationWatcherPolicy.Service,
  FileSystem.Service,
  FSUtil.Service,
  Global.Service,
  HttpClient.HttpClient,
  Image.Service,
  InstructionDiscovery.Service,
  Integration.Service,
  Job.Service,
  KV.Service,
  LLMClient.Service,
  Location.Service,
  LocationMutation.Service,
  ManagedPolicy.Service,
  ModelsDev.Service,
  Mcp.Service,
  Npm.Service,
  Permission.Service,
  Form.Service,
  ReadToolFileSystem.Service,
  Reference.Service,
  WebSearch.Service,
  Ripgrep.Service,
  Session.Service,
  SessionStore.Service,
  SessionComposition.Service,
  SessionExecution.Service,
  SessionCompaction.Service,
  SessionInstructions.Service,
  SubagentJob.Service,
  SessionShareV2.Service,
  Shell.Service,
  ShellSelect.Service,
  Snapshot.Service,
  Skill.Service,
  SkillDiscovery.Service,
  Tool.Service,
  ToolOutput.Service,
  Watcher.Service,
  WellKnown.Service,
  Worktree.Service,
  WorktreeStrategies.Service,
  KBService.Service,
  ScheduleService.Service,
  SessionGoal.Service,
  PersonalMemory.Service,
  MetaAgentMemory.Service,
  MetaAgentService.Service,
  AgentAssetService.Service,
  CommandAssetService.Service,
  MCPAssetService.Service,
  PromptAssetService.Service,
  SkillAssetService.Service,
  PluginAssetService.Service,
  WorkflowAsset.Service,
  WorkflowAssetService.Service,
  SessionTask.Service,
  SessionTodo.Service,
] as const

export type Requirements = Context.Service.Identifier<(typeof services)[number]>

export const requirements = LayerNode.group([
  Agent.node,
  AppProcess.node,
  CorrectionStore.node,
  Provider.node,
  ProviderDiscovery.node,
  Model.node,
  ModelResolver.node,
  Command.node,
  Config.node,
  Credential.node,
  DelegationExecution.node,
  WorkflowExecution.node,
  DelegationService.node,
  Database.node,
  Bus.node,
  Environment.node,
  FileAccess.node,
  FileMutation.node,
  Formatter.node,
  LocationWatcherPolicy.node,
  FileSystem.node,
  FSUtil.node,
  Global.node,
  httpClient,
  Image.node,
  InstructionDiscovery.node,
  Integration.node,
  Job.node,
  KV.node,
  llmClient,
  Location.node,
  LocationMutation.node,
  ManagedPolicy.node,
  ModelsDev.node,
  Mcp.node,
  Npm.node,
  Permission.node,
  Form.node,
  ReadToolFileSystem.node,
  Reference.node,
  WebSearch.node,
  Ripgrep.node,
  Session.node,
  SessionStore.node,
  SessionComposition.node,
  SessionExecution.node,
  SessionCompaction.node,
  SessionInstructions.node,
  SubagentJob.node,
  SessionShareV2.node,
  Shell.node,
  ShellSelect.node,
  Snapshot.node,
  Skill.node,
  SkillDiscovery.node,
  Tool.node,
  ToolOutput.node,
  Watcher.node,
  WellKnown.node,
  Worktree.node,
  WorktreeStrategies.node,
  KBService.node,
  ScheduleService.node,
  SessionGoal.node,
  PersonalMemory.node,
  MetaAgentMemory.node,
  MetaAgentService.node,
  AgentAssetService.node,
  CommandAssetService.node,
  MCPAssetService.node,
  PromptAssetService.node,
  SkillAssetService.node,
  PluginAssetService.node,
  WorkflowAsset.node,
  WorkflowAssetService.node,
  SessionTask.node,
  SessionTodo.node,
])

export type InternalPlugin = Plugin<Requirements | Scope.Scope>

const pre = [
  ToolInputRepairPlugin.Plugin,
  ConfigWorktreePlugin.Plugin,
  ConfigMcpPlugin.Plugin,
  McpCodeModeDefaultsPlugin.Plugin,
  WellKnownPlugin.Plugin,
  VcsGitPlugin.Plugin,
  AgentPlugin.Plugin,
  PlanPlugin.Plugin,
  CommandPlugin.Plugin,
  CommandPlugin.MetaCommands,
  SkillPlugin.Plugin,
  VcsHgPlugin.Plugin,
  ModelsDevPlugin,
  ProviderDiscoveryPlugin.Plugin,
  ...ProviderPlugins,
  ...WebSearchPlugins,
  PatchTool.Plugin,
  // Render model prompts after the patch plugin selects the available editing tools.
  ...OptimizePlugin.Plugins,
  VerbosityPlugin.Plugin,
  IdentityPlugin.Plugin,
  EditTool.Plugin,
  GlobTool.Plugin,
  GrepTool.Plugin,
  AigcForgeTools.Plugin,
  McpResourceTools.Plugin,
  QuestionTool.Plugin,
  ReadTool.Plugin,
  ShellTool.Plugin,
  SkillTool.Plugin,
  SubagentTool.Plugin,
  TaskTool.Plugin,
  SessionShareTool.Plugin,
  WebFetchTool.Plugin,
  WebSearchTool.Plugin,
  WriteTool.Plugin,
  WarmingPlugin.Plugin,
  ListAssetsTool.Plugin,
  DelegationProtocolTool.Plugin,
  KBTools.Plugin,
  MemoryTool.Plugin,
  ProposeMemoryTool.Plugin,
  ProposeNoteTool.Plugin,
  ReminderCreateTool.Plugin,
  ReminderUpdateTool.Plugin,
  ReminderCancelTool.Plugin,
  WorkPresetTool.Plugin,
  ProposeAgentAssetTool.Plugin,
  ProposeCommandAssetTool.Plugin,
  ProposeMCPAssetTool.Plugin,
  ProposePluginAssetTool.Plugin,
  ProposePromptAssetTool.Plugin,
  ProposeSkillAssetTool.Plugin,
  ProposeWorkflowAssetTool.Plugin,
  TaskCreateTool.Plugin,
  TaskDeleteTool.Plugin,
  TaskReorderTool.Plugin,
  TaskUpdateTool.Plugin,
  TaskWriteTool.Plugin,
  TodoWriteTool.Plugin,
  TaskScheduleTool.Plugin,
  GoalTool.Plugin,
  ScheduleTool.Plugin,
  TaskSpawnTool.Plugin,
  ToolIntegrityPlugin.Plugin,
] as const satisfies readonly InternalPlugin[]

const post = [
  ConfigInstructionPlugin.Plugin,
  ConfigReferencePlugin.Plugin,
  ConfigAgentPlugin.Plugin,
  BrowserPlugin,
  ConfigCommandPlugin.Plugin,
  ConfigCompactionPlugin.Plugin,
  ConfigFormatterPlugin.Plugin,
  ConfigImagePlugin.Plugin,
  ConfigLocationWatcherPlugin.Plugin,
  ConfigShellPlugin.Plugin,
  ConfigSnapshotPlugin.Plugin,
  ConfigToolOutputPlugin.Plugin,
  ConfigCompatibilityPlugin.Plugin,
  ConfigSkillPlugin.Plugin,
  ConfigProviderPlugin.Plugin,
  ConfigWebSearchPlugin.Plugin,
  ConfigPolicyPlugin.Plugin,
] as const satisfies readonly InternalPlugin[]

// Repository config must not switch off policy enforcement or the Console connection that delivers
// organization statements, so plugin remove operations skip these IDs.
export const guarded: ReadonlySet<string> = new Set([AigcfrogePlugin.id, ConfigPolicyPlugin.Plugin.id])

export const list = Effect.fn("PluginInternal.list")(function* () {
  // Capture only services; activation supplies the child Scope and batching context.
  const context = Context.pick(...services)(yield* Effect.context<Requirements>())
  const resolve = (plugins: readonly InternalPlugin[]) =>
    plugins.map(
      (plugin): Plugin => ({
        id: plugin.id,
        effect: (host) => plugin.effect(host).pipe(Effect.provide(context)),
      }),
    )
  return {
    pre: resolve(pre),
    post: resolve(post),
  }
})
