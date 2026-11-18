import { Layer } from "effect"
import { SessionGoalHandler } from "./handlers/session-goal"
import { SessionCommunicationHandler } from "./handlers/session-communication"
import { GenerateHandler } from "./handlers/generate"
import { MessageHandler } from "./handlers/message"
import { ModelHandler } from "./handlers/model"
import { ProviderHandler } from "./handlers/provider"
import { SessionHandler } from "./handlers/session"
import { PermissionHandler } from "./handlers/permission"
import { FileSystemHandler } from "./handlers/fs"
import { FormHandler } from "./handlers/form"
import { CommandHandler } from "./handlers/command"
import { CommandAssetHandler } from "./handlers/command-asset"
import { PromptAssetHandler } from "./handlers/prompt-asset"
import { AgentAssetHandler } from "./handlers/agent-asset"
import { McpAssetHandler } from "./handlers/mcp-asset"
import { PluginAssetHandler } from "./handlers/plugin-asset"
import { WorkflowAssetHandler } from "./handlers/workflow-asset"
import { SkillHandler } from "./handlers/skill"
import { RpcHandler } from "./handlers/rpc"
import { EventHandler } from "./handlers/event"
import { AgentHandler } from "./handlers/agent"
import { PluginHandler } from "./handlers/plugin"
import { ServerHandler } from "./handlers/server"
import { DebugHandler } from "./handlers/debug"
import { PtyHandler } from "./handlers/pty"
import { PersistentPtyHandler } from "./handlers/persistent-pty"
import { ShellHandler } from "./handlers/shell"
import { ReferenceHandler } from "./handlers/reference"
import { LocationHandler } from "./handlers/location"
import { IntegrationHandler } from "./handlers/integration"
import { WebSearchHandler } from "./handlers/websearch"
import { McpHandler } from "./handlers/mcp"
import { CredentialHandler } from "./handlers/credential"
import { ProjectHandler } from "./handlers/project"
import { WorktreeHandler } from "./handlers/worktree"
import { VcsHandler } from "./handlers/vcs"
import { EventFeed } from "./event-feed"
import { MigrationHandler } from "./handlers/migration"
import { ConfigHandler } from "./handlers/config"
import { CustomCompositionHandler } from "./handlers/composition-stubs"
import { CustomProfileHandler } from "./handlers/custom-profile"
import { ImportParserHandler, KBHandler, MemoryHandler, ScheduleHandler } from "./handlers/assistant-stubs"
import {
  AgentTaskHandler,
  ControlHandler,
  ControlPlaneHandler,
  SyncHandler,
  WorkArtifactHandler,
} from "./handlers/orchestration-stubs"
import { ProjectCopyNameHandler, QuestionHandler } from "./handlers/agent-interaction-stubs"
import { DelegationHandler } from "./handlers/delegation"
import { FileInstanceHandler, PtyConnectInstanceHandler, PtyInstanceHandler } from "./handlers/file-pty-stubs"
import { PermissionInstanceHandler, ProjectInstanceHandler } from "./handlers/project-permission-stubs"
import { McpInstanceHandler } from "./handlers/mcp-instance-stubs"
import { ConfigInstanceHandler } from "./handlers/config-instance-stubs"
import { WorkspaceInstanceHandler } from "./handlers/workspace-instance-stubs"
import { ProviderInstanceHandler } from "./handlers/provider-instance-stubs"
import { InstanceInstanceHandler } from "./handlers/instance-stubs"
import { SessionInstanceHandler } from "./handlers/session-instance-stubs"
import { SkillAssetHandler } from "./handlers/asset-stubs"
import { PathIdentityHandler } from "./handlers/path-identity"
import { GrantHandler } from "./handlers/grant"

export const handlers = Layer.mergeAll(
  SessionGoalHandler,
  SessionCommunicationHandler,
  ServerHandler,
  DebugHandler,
  MigrationHandler,
  LocationHandler,
  AgentHandler,
  PluginHandler,
  SessionHandler,
  MessageHandler,
  ModelHandler,
  GenerateHandler,
  ProviderHandler,
  IntegrationHandler,
  WebSearchHandler,
  McpHandler,
  CredentialHandler,
  ProjectHandler,
  FormHandler,
  PermissionHandler,
  FileSystemHandler,
  CommandHandler,
  SkillHandler,
  RpcHandler,
  EventHandler.pipe(Layer.provide(EventFeed.layer)),
  PtyHandler,
  PersistentPtyHandler,
  ShellHandler,
  ReferenceHandler,
  WorktreeHandler,
  VcsHandler,
  ConfigHandler,
  CustomProfileHandler,
  CustomCompositionHandler,
  MemoryHandler,
  KBHandler,
  ScheduleHandler,
  ImportParserHandler,
  AgentTaskHandler,
  WorkArtifactHandler,
  ControlPlaneHandler,
  ControlHandler,
  SyncHandler,
  QuestionHandler,
  DelegationHandler,
  ProjectCopyNameHandler,
  FileInstanceHandler,
  PtyInstanceHandler,
  PtyConnectInstanceHandler,
  ProjectInstanceHandler,
  PermissionInstanceHandler,
  McpInstanceHandler,
  ConfigInstanceHandler,
  WorkspaceInstanceHandler,
  ProviderInstanceHandler,
  InstanceInstanceHandler,
  SessionInstanceHandler,
  PromptAssetHandler,
  SkillAssetHandler,
  McpAssetHandler,
  CommandAssetHandler,
  AgentAssetHandler,
  PluginAssetHandler,
  WorkflowAssetHandler,
  PathIdentityHandler,
  GrantHandler,
)
