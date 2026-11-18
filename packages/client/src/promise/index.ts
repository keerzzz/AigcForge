import type { AigcForge } from "./client.js"

export * from "./generated/index.js"
export { AigcForge } from "./client.js"
export type { ClientOptions, RequestOptions } from "./client.js"
export type {
  AgentApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcCallOptions,
  RpcClient,
  RpcEventPayload,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export type { EventSubscribeOutput as AigcForgeEvent } from "./generated/types.js"
export type AigcForgeClient = ReturnType<typeof AigcForge.make>
