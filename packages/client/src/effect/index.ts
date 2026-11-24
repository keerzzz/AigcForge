// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { Omnixa } from "./client.js"

export * from "./generated/index"
export { Omnixa } from "./client.js"
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
export { Agent } from "@omnixa/schema/agent"
export { AssetPlacement } from "@omnixa/schema/asset-placement"
export { Command } from "@omnixa/schema/command"
export { Config } from "@omnixa/schema/config"
export { Credential } from "@omnixa/schema/credential"
export { Event } from "@omnixa/schema/event"
export { EventLog } from "@omnixa/schema/event-log"
export { FileSystem } from "@omnixa/schema/filesystem"
export { Form } from "@omnixa/schema/form"
export { Integration } from "@omnixa/schema/integration"
export { Location } from "@omnixa/schema/location"
export { Model } from "@omnixa/schema/model"
export { Permission } from "@omnixa/schema/permission"
export { PermissionSaved } from "@omnixa/schema/permission-saved"
export { Project } from "@omnixa/schema/project"
export { Worktree } from "@omnixa/schema/worktree"
export { Vcs } from "@omnixa/schema/vcs"
export { Provider } from "@omnixa/schema/provider"
export { Pty } from "@omnixa/schema/pty"
export { Question } from "@omnixa/schema/question"
export { Reference } from "@omnixa/schema/reference"
export { WebSearch } from "@omnixa/schema/websearch"
export { AbsolutePath, RelativePath } from "@omnixa/schema/schema"
export { Session } from "@omnixa/schema/session"
export { SessionInbox } from "@omnixa/schema/session-inbox"
export { SessionMessage } from "@omnixa/schema/session-message"
export { Skill } from "@omnixa/schema/skill"
export { SkillAsset } from "@omnixa/schema/skill-asset"
export { Prompt } from "@omnixa/schema/prompt"
export { PromptInput } from "@omnixa/schema/prompt-input"
export type { OmnixaEvent } from "@omnixa/protocol/groups/event"
export type OmnixaClient = Effect.Success<ReturnType<typeof Omnixa.make>>
