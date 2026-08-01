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
import { PermissionSaved } from "./permission/saved"
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
import { WorkflowAsset } from "./workflow-asset"
import { PluginAsset } from "./plugin-asset"
import { PluginBridge } from "./plugin-asset/bridge"

import { Image } from "./image"
import { ToolRegistry } from "./tool/registry"
import { ApplicationTools } from "./tool/application-tools"
import { ToolOutputStore } from "./tool-output-store"
import { AppProcess } from "./process"
import { CrossSpawnSpawner } from "./cross-spawn-spawner"
import { SessionStore } from "./session/store"
import { SessionTodo } from "./session/todo"
import { SessionTask } from "./session/task"
import { WorkArtifact } from "./session/artifact"
import { QuestionV2 } from "./question"
import { LLMClient } from "@aigcfroge/llm"
import { RequestExecutor } from "@aigcfroge/llm/route"
import * as SessionRunnerLLM from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { SystemContextBuiltIns } from "./system-context/builtins"
import { FetchHttpClient } from "effect/unstable/http"

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
      WorkflowAsset.locationLayer,
      PluginAsset.locationLayer,
      PluginBridge.layer,
      systemContext,
      LocationMutation.locationLayer.pipe(Layer.orDie),
      CrossSpawnSpawner.defaultLayer,
      FSUtil.defaultLayer,
    ).pipe(Layer.provideMerge(location))
    const resources = ToolOutputStore.layer.pipe(Layer.provide(base))
    const permissionsAndTools = ToolRegistry.layer.pipe(
      Layer.provideMerge(PermissionV2.locationLayer),
      Layer.provide(resources),
      Layer.provide(base),
    )
    const services = Layer.mergeAll(base, resources, permissionsAndTools)
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
    const skillGuidance = SkillGuidance.locationLayer.pipe(Layer.provide(services))
    const referenceGuidance = ReferenceGuidance.locationLayer.pipe(Layer.provide(services))
    const todos = SessionTodo.layer.pipe(Layer.provide(services))
    const tasks = SessionTask.layer.pipe(Layer.provide(services))
    const questions = QuestionV2.locationLayer.pipe(Layer.provide(services))
    const workArtifact = WorkArtifact.locationLayer.pipe(Layer.provide(services), Layer.provide(mutation))
    // The `task` built-in reaches child Sessions through the TaskDriver module
    // bridge (a plain Deferred filled by the composition root), not a Layer, so
    // BuiltInTools carries no extra requirement here. See tool/task-driver.ts.
    const builtInTools = BuiltInTools.locationLayer.pipe(
      Layer.provide(services),
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
    )
    const model = SessionRunnerModel.locationLayer.pipe(Layer.provide(services))
    const runner = SessionRunnerLLM.defaultLayer.pipe(
      Layer.provide(services),
      Layer.provide(model),
      Layer.provide(skillGuidance),
      Layer.provide(referenceGuidance),
    )

    // Kick off a background project copy refresh to update locations now that we
    // have a location
    const projectCopyRefresh = Layer.effectDiscard(ProjectCopy.refreshAfterBoot).pipe(Layer.provide(services))

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
      resources,
      todos,
      tasks,
      questions,
      workArtifact,
      model,
      runner,
      builtInTools,
      referenceGuidance,
      projectCopyRefresh,
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
  ],
}) {}
