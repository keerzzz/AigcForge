// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { AigcForge } from "./client.js"

export * from "./generated/index"
export { AigcForge } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@aigcfroge/schema/agent"
export { AssetPlacement } from "@aigcfroge/schema/asset-placement"
export { Command } from "@aigcfroge/schema/command"
export { Config } from "@aigcfroge/schema/config"
export { Credential } from "@aigcfroge/schema/credential"
export { Event } from "@aigcfroge/schema/event"
export { EventLog } from "@aigcfroge/schema/event-log"
export { FileSystem } from "@aigcfroge/schema/filesystem"
export { Form } from "@aigcfroge/schema/form"
export { Integration } from "@aigcfroge/schema/integration"
export { Location } from "@aigcfroge/schema/location"
export { Model } from "@aigcfroge/schema/model"
export { Permission } from "@aigcfroge/schema/permission"
export { PermissionSaved } from "@aigcfroge/schema/permission-saved"
export { Project } from "@aigcfroge/schema/project"
export { Worktree } from "@aigcfroge/schema/worktree"
export { Vcs } from "@aigcfroge/schema/vcs"
export { Provider } from "@aigcfroge/schema/provider"
export { Pty } from "@aigcfroge/schema/pty"
export { Question } from "@aigcfroge/schema/question"
export { Reference } from "@aigcfroge/schema/reference"
export { WebSearch } from "@aigcfroge/schema/websearch"
export { AbsolutePath, RelativePath } from "@aigcfroge/schema/schema"
export { Session } from "@aigcfroge/schema/session"
export { SessionInbox } from "@aigcfroge/schema/session-inbox"
export { SessionMessage } from "@aigcfroge/schema/session-message"
export { Skill } from "@aigcfroge/schema/skill"
export { SkillAsset } from "@aigcfroge/schema/skill-asset"
export { Prompt } from "@aigcfroge/schema/prompt"
export { PromptInput } from "@aigcfroge/schema/prompt-input"
export type { AigcForgeEvent } from "@aigcfroge/protocol/groups/event"
export type AigcForgeClient = Effect.Success<ReturnType<typeof AigcForge.make>>
