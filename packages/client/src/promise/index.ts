import type { Omnixa } from "./client.js"

export * from "./generated/index.js"
export { Omnixa } from "./client.js"
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
export type { EventSubscribeOutput as OmnixaEvent } from "./generated/types.js"
export type OmnixaClient = ReturnType<typeof Omnixa.make>
