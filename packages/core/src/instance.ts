import { Context, Effect, Layer } from "effect"
import { Agent } from "./agent.js"
import { AgentAsset } from "./agent-asset.js"
import { AgentAssetService } from "./agent-asset-service.js"
import { MCPAsset } from "./mcp-asset.js"
import { MCPAssetService } from "./mcp-asset-service.js"
import { PluginAsset } from "./plugin-asset.js"
import { PluginAssetService } from "./plugin-asset-service.js"
import { WorkflowAsset } from "./workflow-asset.js"
import { WorkflowAssetService } from "./workflow-asset-service.js"
import { AISDK } from "./aisdk.js"
import { Model } from "./model.js"
import { ModelGroup } from "./model-group.js"
import { Provider } from "./provider.js"
import { ProviderDiscovery } from "./provider/discovery.js"
import { Command } from "./command.js"
import { CommandAsset } from "./command-asset.js"
import { CommandAssetService } from "./command-asset-service.js"
import { PromptAsset } from "./prompt-asset.js"
import { PromptAssetService } from "./prompt-asset-service.js"
import { Config } from "./config.js"
import { CompositionResolver } from "./composition-resolver.js"
import { CustomProfile } from "./custom-profile.js"
import { CustomProfileService } from "./custom-profile-service.js"
import { LayerNode } from "@omnixa/util/effect/layer-node"
import { Node } from "@omnixa/util/effect/app-node"
import { FileMutation } from "./file-mutation.js"
import { Environment } from "./environment/index.js"
import { Formatter } from "./formatter.js"
import { FileSystem } from "./filesystem.js"
import { FileSystemSearch } from "./filesystem/search.js"
import { Generate } from "./generate.js"
import { Form } from "./form.js"
import { Image } from "./image.js"
import { LocationWatcher } from "./filesystem/location-watcher.js"
import { Integration } from "./integration.js"
import { Location } from "./location.js"
import { LocationLifecycle } from "./location-lifecycle.js"
import { FileAccess } from "./file-access.js"
import { ModelResolver } from "./model-resolver.js"
import { Mcp } from "./mcp/index.js"
import { Permission } from "./permission.js"
import { SessionPermissionOverride } from "./permission/session-override.js"
import { ScopedGrantStore } from "./grant/store.js"
import { PathIdentity } from "./path-identity.js"
import { Plugin } from "./plugin.js"
import { PluginHooks } from "./plugin/hooks.js"
import { InstancePlugins } from "./plugin/instance.js"
import { PluginSupervisor } from "./plugin/supervisor.js"
import { WorktreeStrategies } from "./worktree/strategies.js"
import { Pty } from "./pty.js"
import { Shell } from "./shell.js"
import { ShellSelect } from "./shell/select.js"
import { Reference } from "./reference.js"
import { Rpc } from "./rpc.js"
import { WebSearch } from "./websearch.js"
import { ReferenceInstructions } from "./reference/instructions.js"
import { SessionRunnerLLM } from "./session/runner/llm.js"
import { SessionRunnerModel } from "./session/runner/model.js"
import { SessionCompaction } from "./session/compaction.js"
import { SessionTitle } from "./session/title.js"
import { SessionContext } from "./session/context.js"
import { SessionIdentityProjection } from "./session/session-identity.js"
import { WorkArtifact } from "./session/artifact.js"
import { Skill } from "./skill.js"
import { SkillAsset } from "./skill-asset.js"
import { SkillAssetService } from "./skill-asset-service.js"
import { SkillInstructions } from "./skill/instructions.js"
import { Snapshot } from "./snapshot.js"
import { InstructionDiscovery } from "./instruction-discovery.js"
import { InstructionBuiltIns } from "./instructions/builtins.js"
import { InstructionEntry } from "./session/instruction-entry.js"
import { SessionInstructions } from "./session/instructions.js"
import { McpConnection } from "./mcp/connection.js"
import { McpCredentialBindingStore } from "./mcp/binding/store.js"
import { McpTool } from "./tool/mcp.js"
import { ReadToolFileSystem } from "./tool/read-filesystem.js"
import { Tool } from "./tool.js"
import { ToolOutput } from "./tool-output.js"
import { Vcs } from "./vcs.js"

export * as Instance from "./instance.js"
export { Service, node, type Interface } from "./instance/service.js"

const nodes = [
  Location.node,
  LocationLifecycle.node,
  Environment.node,
  Config.node,
  CompositionResolver.node,
  CustomProfile.node,
  CustomProfileService.node,
  Agent.node,
  AgentAsset.node,
  AgentAssetService.node,
  MCPAsset.node,
  MCPAssetService.node,
  PluginAsset.node,
  PluginAssetService.node,
  WorkflowAsset.node,
  WorkflowAssetService.node,
  Command.node,
  CommandAsset.node,
  CommandAssetService.node,
  PromptAsset.node,
  PromptAssetService.node,
  Reference.node,
  Rpc.node,
  WebSearch.node,
  Integration.node,
  Provider.node,
  Model.node,
  ModelGroup.node,
  ProviderDiscovery.node,
  ModelResolver.node,
  AISDK.node,
  Plugin.node,
  PluginHooks.node,
  InstancePlugins.node,
  PluginSupervisor.node,
  WorktreeStrategies.node,
  FileSystemSearch.node,
  FileSystem.node,
  ShellSelect.node,
  Pty.node,
  Shell.node,
  Skill.node,
  SkillAsset.node,
  SkillAssetService.node,
  InstructionBuiltIns.node,
  InstructionDiscovery.node,
  FileAccess.node,
  FileMutation.node,
  WorkArtifact.node,
  Formatter.node,
  Mcp.node,
  Permission.node,
  SessionPermissionOverride.node,
  ScopedGrantStore.node,
  PathIdentity.node,
  Tool.node,
  ToolOutput.node,
  Image.node,
  SkillInstructions.node,
  ReferenceInstructions.node,
  InstructionEntry.node,
  Form.node,
  Generate.node,
  ReadToolFileSystem.node,
  McpTool.node,
  McpCredentialBindingStore.node,
  McpConnection.node,
  SessionInstructions.node,
  SessionRunnerModel.node,
  SessionCompaction.node,
  SessionTitle.node,
  SessionContext.node,
  SessionIdentityProjection.node,
  Snapshot.node,
  SessionRunnerLLM.node,
  Vcs.node,
  // Start repository watches only after boot-critical filesystem and Git work.
  LocationWatcher.node,
] as const satisfies readonly Node.LocationGraph<never, unknown>[]

export const graph = LayerNode.group(nodes)

export type Services = LayerNode.Output<typeof graph>
export type Error = FileSystem.DirectoryNotFoundError

export interface Options {
  // Plugins this instance is born with; empty and absent are equivalent.
  readonly plugins?: InstancePlugins.List
  // Filesystem config discovery; true (default) is today's behavior. When
  // false the instance boots vanilla: no upward config scan, no global config
  // dir, no plugin-dir loading or ambient plugin module imports, no boot-time
  // AGENTS.md discovery. Wellknown integration config and host-injected values
  // still apply, and a config value that explicitly names something
  // file-backed (a skill path, an MCP command) is a request, not discovery.
  // Use-triggered behavior also stays: reading a file still injects nested
  // AGENTS.md instructions — that is session-time context, not boot-time
  // population.
  readonly discovery?: boolean
  readonly replacements?: LayerNode.Replacements
}

// Vanilla neutralizes the discovery inputs; the plugin list stays untouched.
// These are defaults ahead of caller replacements: a host that replaces a
// gated node itself owns that node's discovery flags. Plugin-directory
// discovery needs no swap here — implicit scanning only triggers on Directory
// config entries, which a no-scan Config never produces, and the default
// source still honors explicit plugin operations from wellknown and
// host-injected config.
const vanillaReplacements: LayerNode.Replacements = [
  Config.node.replace(Config.configured({ project: false, global: false })),
  InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: false, global: false })),
]

// One instance is one compiled, fresh copy of the graph standing on a directory.
export function layer(ref: Location.Ref, options: Options = {}): Layer.Layer<Services, Error> {
  const startedAt = performance.now()
  // Ordered: vanilla defaults, then caller replacements (which win over the
  // defaults), then instance bindings (which win over everything).
  const replacements: LayerNode.Replacements = [
    ...(options.discovery === false ? vanillaReplacements : []),
    ...(options.replacements ?? []),
    Location.node.replace(Location.boundNode(ref)),
    InstancePlugins.node.replace(InstancePlugins.bound(options.plugins ?? [])),
  ]

  return LayerNode.compile(graph, { replacements, shared: Node.tags.values.global }).pipe(
    // A missing directory is expected; other instance boot failures remain defects.
    Layer.catchCause(
      (cause): Layer.Layer<Services, Error> =>
        Layer.unwrap(
          Effect.failCause(cause).pipe(
            Effect.catch(
              (error): Effect.Effect<never, Error> =>
                error instanceof FileSystem.DirectoryNotFoundError ? Effect.fail(error) : Effect.die(error),
            ),
          ),
        ),
    ),
    Layer.tap((context) => Effect.addFinalizer(() => Context.get(context, LocationLifecycle.Service).shutdown)),
    Layer.tap(() =>
      Effect.logInfo("location services booted", {
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    ),
  )
}
