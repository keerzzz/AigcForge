import { Effect, Layer, LayerMap } from "effect"
import { Location } from "./location"
import { Policy } from "./policy"
import { Config } from "./config"
import { PluginV2 } from "./plugin"
import { Catalog } from "./catalog"
import { Integration } from "./integration"
import { CommandV2 } from "./command"
import { AgentV2 } from "./agent"
import { AgentFileLoader } from "./agent/file-loader"
import { PluginInternal } from "./plugin/internal"
import { Project } from "./project"
import { ProjectCopy } from "./project/copy"
import { ProjectDirectories } from "./project/directories"
import { EventV2 } from "./event"
import { Credential } from "./credential"
import { Npm } from "./npm"
import { ModelsDev } from "./models-dev"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
import { Database } from "./database/database"
import { PermissionV2 } from "./permission"
import { SessionPermissionOverride } from "./permission/session-override"
import { PermissionSaved } from "./permission/saved"
import { ApprovalPresence } from "./permission/approval-presence"
import { FileSystem } from "./filesystem"
import { Ripgrep } from "./ripgrep"
import { Watcher } from "./filesystem/watcher"
import { LocationMutation } from "./location-mutation"
import { FileMutation } from "./file-mutation"
import { Reference } from "./reference"
import { ReferenceGuidance } from "./reference/guidance"
import { RepositoryCache } from "./repository-cache"
import { Pty } from "./pty"
import { SkillV2 } from "./skill"
import { SkillGuidance } from "./skill/guidance"
import { BuiltInTools } from "./tool/builtins"
import { MemoryTool } from "./tool/memory"
import { MetaAgentMemory } from "./agent/meta/memory"
import { MetaAgentService } from "./meta-agent/service"
import { PromptAsset } from "./prompt-asset"
import { PromptAssetService } from "./prompt-asset-service"
import { SkillAsset } from "./skill-asset"
import { SkillAssetService } from "./skill-asset-service"
import { MCPAsset } from "./mcp-asset"
import { MCPAssetService } from "./mcp-asset-service"
import { CommandAsset } from "./command-asset"
import { CommandAssetService } from "./command-asset-service"
import { AgentAsset } from "./agent-asset"
import { AgentAssetService } from "./agent-asset-service"
import { CustomProfile } from "./custom-profile"
import { CustomProfileService } from "./custom-profile-service"
import { CompositionResolver } from "./composition-resolver"
import { AssetKind } from "./asset-kind"
import { AgentAssetBridge } from "./agent/asset-bridge"
import { WorkflowAsset } from "./workflow-asset"
import { PluginAsset } from "./plugin-asset"
import { PluginBridge } from "./plugin-asset/bridge"
import { SessionComposition } from "./session/composition"
import { WorkflowRun } from "./workflow/workflow-run"
import { WorkflowRunner } from "./workflow/workflow-runner"
import { CredentialScanner } from "./credential-scanner"
import { McpConnection } from "./mcp/connection"
import { McpRegistration } from "./tool/mcp-registration"

import { Image } from "./image"
import { ToolRegistry } from "./tool/registry"
import { ApplicationTools } from "./tool/application-tools"
import { ToolOutputStore } from "./tool-output-store"
import { AppProcess } from "./process"
import { CrossSpawnSpawner } from "./cross-spawn-spawner"
import { SessionStore } from "./session/store"
import { SessionTodo } from "./session/todo"
import { ScheduleService } from "./session/schedule-service"
import { PersonalMemory } from "./session/personal-memory"
import { KBService } from "./session/kb-service"
import { SessionTask } from "./session/task"
import { WorkArtifact } from "./session/artifact"
import { QuestionV2 } from "./question"
import { LLMClient } from "@aigcfroge/llm"
import { RequestExecutor } from "@aigcfroge/llm/route"
import * as SessionRunnerLLM from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { CorrectionExtractor } from "./session/correction-extractor"
import { CorrectionStore } from "./session/correction-store"
import { DoomLoop } from "./session/doom-loop"
import { ReferenceChecker } from "./session/reference-checker"
import { VerificationRouter } from "./session/verification-router"
import { Verifier } from "./session/verifier"
import { SystemContextBuiltIns } from "./system-context/builtins"
import { FetchHttpClient } from "effect/unstable/http"
import { Flag } from "./flag/flag"

export class LocationServiceMap extends LayerMap.Service<LocationServiceMap>()("@aigcfroge/example/LocationServiceMap", {
  lookup: (ref: Location.Ref) => {
    const boot = Layer.effectDiscard(
      Effect.logInfo("booting location services", { directory: ref.directory, workspaceID: ref.workspaceID }),
    )
    const location = Location.layer(ref)
    const systemContext = SystemContextBuiltIns.locationLayer
    const config = Config.locationLayer
    const agentV2Layer = AgentV2.fileLayer.pipe(Layer.provide(AgentFileLoader.layer))
    const base = Layer.mergeAll(
      location,
      Policy.locationLayer,
      config,
      Reference.locationLayer,
      PluginV2.locationLayer,
      Catalog.locationLayer,
      Integration.locationLayer,
      CommandV2.locationLayer,
      agentV2Layer,
      PluginInternal.locationLayer,
      ProjectCopy.locationLayer,
      FileSystem.locationLayer,
      Watcher.locationLayer,
      Pty.locationLayer,
      SkillV2.locationLayer,
      PromptAsset.locationLayer,
      SkillAsset.locationLayer,
      MCPAsset.locationLayer.pipe(Layer.provide(config)),
      CommandAsset.locationLayer.pipe(Layer.provide(config)),
      AgentAsset.locationLayer,
      CustomProfile.layer,
      AssetKind.layer,
      WorkflowAsset.locationLayer,
      PluginAsset.locationLayer,
      PluginBridge.layer,
      SessionComposition.layer,
      systemContext,
      LocationMutation.locationLayer.pipe(Layer.orDie),
      CrossSpawnSpawner.defaultLayer,
      FSUtil.defaultLayer,
    ).pipe(Layer.provideMerge(location))
    const resources = ToolOutputStore.layer.pipe(Layer.provide(base))
    const permissionsAndTools = ToolRegistry.layer.pipe(
      Layer.provideMerge(PermissionV2.locationLayer),
      Layer.provideMerge(SessionPermissionOverride.locationLayer),
      Layer.provide(resources),
      Layer.provide(base),
    )
    const services = Layer.mergeAll(base, resources, permissionsAndTools)
    // Canonical MCP connection owner (ADR-21 v1.1 / Phase C Slice 1): sits
    // after ToolRegistry availability, registers through McpRegistration into
    // the SAME memoized registry instance — provide(), never provideMerge.
    const mcpConnections = McpConnection.layer.pipe(
      Layer.provide(McpRegistration.layer),
      Layer.provide(services),
    )
    const image = Image.layer.pipe(Layer.provide(services))
    const mutation = FileMutation.locationLayer.pipe(Layer.provide(services))
    const promptAssetService = PromptAssetService.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(mutation),
    )
    const skillAssetService = SkillAssetService.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(mutation),
    )
    const mcpAssetService = MCPAssetService.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(mutation),
    )
    const commandAssetService = CommandAssetService.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(mutation),
    )
    const agentAssetService = AgentAssetService.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(mutation),
    )
    const customProfileService = CustomProfileService.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(mutation),
    )
    const compositionResolver = CompositionResolver.locationLayer.pipe(
      Layer.provide(services),
    )
    const skillGuidance = SkillGuidance.locationLayer.pipe(Layer.provide(services))
    const referenceGuidance = ReferenceGuidance.locationLayer.pipe(Layer.provide(services))
    const tasks = SessionTask.layer.pipe(Layer.provide(services))
    const workflowRun = WorkflowRun.layer.pipe(Layer.provide(services))
    const workflowRunner = WorkflowRunner.layer.pipe(
      Layer.provide(workflowRun),
      Layer.provide(tasks),
      Layer.provide(CredentialScanner.layer),
      Layer.provide(services),
    )
    const todos = SessionTodo.layer.pipe(Layer.provide(tasks), Layer.provide(services))
    const questions = QuestionV2.locationLayer.pipe(Layer.provide(services))
    const workArtifact = WorkArtifact.locationLayer.pipe(Layer.provide(services), Layer.provide(mutation))
    // The `task` built-in reaches child Sessions through the TaskDriver module
    // bridge (a plain Deferred filled by the composition root), not a Layer, so
    // BuiltInTools carries no extra requirement here. See tool/task-driver.ts.
    const memoryTools = MemoryTool.layer.pipe(
      Layer.provide(MetaAgentMemory.layer.pipe(Layer.provide(MetaAgentService.layer))),
      Layer.provide(services),
    )
    const builtInTools = BuiltInTools.locationLayer.pipe(
      Layer.provide(services),
      Layer.provide(ScheduleService.layer),
      Layer.provide(PersonalMemory.layer),
      Layer.provide(KBService.layer),
      Layer.provide(mutation),
      Layer.provide(promptAssetService),
      Layer.provide(skillAssetService),
      Layer.provide(mcpAssetService),
      Layer.provide(commandAssetService),
      Layer.provide(agentAssetService),
      Layer.provide(resources),
      Layer.provide(todos),
      Layer.provide(tasks),
      Layer.provide(questions),
      Layer.provide(image),
      Layer.provide(memoryTools),
    )
    const model = SessionRunnerModel.locationLayer.pipe(Layer.provide(services))
    const doomLoop = DoomLoop.layer.pipe(Layer.provide(services))
    const correctionStore = CorrectionStore.layer.pipe(Layer.provide(services))
    const correctionExtractor = CorrectionExtractor.layer.pipe(
      Layer.provide(correctionStore),
      Layer.provide(services),
    )
    const referenceChecker = ReferenceChecker.layer.pipe(
      Layer.provide(correctionStore),
      Layer.provide(services),
    )
    const verifier = Verifier.layer.pipe(
      Layer.provide(VerificationRouter.layer.pipe(Layer.provide(services))),
      Layer.provide(correctionStore),
      Layer.provide(services),
    )
    const runner = SessionRunnerLLM.defaultLayer.pipe(
      Layer.provide(services),
      Layer.provide(model),
      Layer.provide(doomLoop),
      Layer.provide(correctionStore),
      Layer.provide(correctionExtractor),
      Layer.provide(referenceChecker),
      Layer.provide(verifier),
      Layer.provide(skillGuidance),
      Layer.provide(referenceGuidance),
    )

    // Kick off a background project copy refresh to update locations now that we
    // have a location
    const projectCopyRefresh = Flag.AIGCFROGE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
      ? Layer.effectDiscard(Effect.void)
      : Layer.effectDiscard(ProjectCopy.refreshAfterBoot).pipe(Layer.provide(services))

    return Layer.mergeAll(
      boot,
      services,
      image,
      mutation,
      promptAssetService,
      skillAssetService,
      mcpAssetService,
      commandAssetService,
      agentAssetService,
      customProfileService,
      compositionResolver,
      resources,
      todos,
      tasks,
      workflowRun,
      workflowRunner,
      questions,
      workArtifact,
      model,
      runner,
      builtInTools,
      referenceGuidance,
      projectCopyRefresh,
      AgentAssetBridge.layer.pipe(Layer.provide(services)),
      mcpConnections,
    ).pipe(Layer.fresh, Layer.orDie)
  },
  idleTimeToLive: "60 minutes",
  dependencies: [
    Project.defaultLayer,
    EventV2.defaultLayer,
    Credential.defaultLayer,
    Npm.defaultLayer,
    ModelsDev.defaultLayer,
    FSUtil.defaultLayer,
    Git.defaultLayer,
    AppProcess.defaultLayer,
    Global.defaultLayer,
    Ripgrep.defaultLayer,
    Database.defaultLayer,
    ProjectDirectories.defaultLayer,
    SessionStore.layer.pipe(Layer.provide(Database.defaultLayer)),
    PermissionSaved.defaultLayer,
    RepositoryCache.defaultLayer,
    LLMClient.layer.pipe(Layer.provide(RequestExecutor.defaultLayer)),
    FetchHttpClient.layer,
    ToolOutputStore.defaultCleanupLayer,
    ApplicationTools.layer,
    // Approval responder facts are connection-scoped, so one process-wide
    // instance: the HTTP layer binds connections, not Locations (ADR-20 §2.7).
    ApprovalPresence.defaultLayer,
  ],
}) {}
