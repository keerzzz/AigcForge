export * as ModelSource from "./model-source.js"

import { Schema } from "effect"
import { optional, statics } from "./schema.js"
import { Provider } from "./provider.js"
import { Credential } from "./credential.js"
import { Money } from "./money.js"

export const Family = Schema.String.pipe(Schema.brand("Model.Family"))
export type Family = typeof Family.Type

export type ReasoningField = "reasoning" | "reasoning_content" | "reasoning_text" | (string & {})
export const ReasoningField: Schema.Codec<ReasoningField> = Schema.Union([
  Schema.Literals(["reasoning", "reasoning_content", "reasoning_text"]),
  Schema.String,
]).annotate({ identifier: "Model.ReasoningField" })

export const MaxTokensField = Schema.Literals(["max_completion_tokens", "max_tokens"]).annotate({
  identifier: "Model.MaxTokensField",
})
export type MaxTokensField = typeof MaxTokensField.Type

export interface Compatibility extends Schema.Schema.Type<typeof Compatibility> {}
export const Compatibility = Schema.Struct({
  reasoningField: ReasoningField.pipe(optional),
  /** Require every assistant message to include its reasoning field, even when empty. */
  requireReasoning: Schema.Boolean.pipe(optional),
  maxTokensField: MaxTokensField.pipe(optional),
  requireFinishReason: Schema.Boolean.pipe(optional),
  requireAssistantAfterTool: Schema.Boolean.pipe(optional),
  supportsPromptCacheKey: Schema.Boolean.pipe(optional),
  /** Supports Anthropic's thinking-prefix mismatch controls. Overrides model-ID detection. */
  supportsThinkingBlockBinding: Schema.Boolean.pipe(optional),
  /** Supports per-message effort updates. Overrides model-ID detection. */
  supportsEffortUpdates: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "Model.Compatibility" })

export interface Capabilities extends Schema.Schema.Type<typeof Capabilities> {}
export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.Array(Schema.String),
  output: Schema.Array(Schema.String),
})
  .annotate({ identifier: "Model.Capabilities" })
  .pipe(
    statics(() => ({
      default: () => ({ tools: true, input: ["text", "image"], output: ["text"] }) satisfies Capabilities,
    })),
  )

export interface Cost extends Schema.Schema.Type<typeof Cost> {}
export const Cost = Schema.Struct({
  tier: Schema.Struct({
    type: Schema.tag("context"),
    size: Schema.Int,
  }).pipe(optional),
  input: Money.USDPerMillionTokens,
  output: Money.USDPerMillionTokens,
  cache: Schema.Struct({
    read: Money.USDPerMillionTokens,
    write: Money.USDPerMillionTokens,
  }),
}).annotate({ identifier: "Model.Cost" })

export const ConnectionRef = Schema.Union([
  Schema.Struct({ type: Schema.Literal("credential"), id: Credential.ID }),
  Schema.Struct({ type: Schema.Literal("env"), name: Schema.String }),
]).pipe(Schema.toTaggedUnion("type")).annotate({ identifier: "ModelSource.ConnectionRef" })
export type ConnectionRef = Schema.Schema.Type<typeof ConnectionRef>

/** Account observations remain attached to the connection and model view that produced them. */
export interface Quota extends Schema.Schema.Type<typeof Quota> {}
export const Quota = Schema.Struct({
  status: Schema.Literals(["known", "unknown", "unsupported", "error"]),
  source: Schema.String,
  connection: ConnectionRef.pipe(optional),
  observedAt: Schema.Finite.pipe(optional),
  freshUntil: Schema.Finite.pipe(optional),
  reason: Schema.Literals(["unsupported", "authentication", "rate-limit", "transport", "invalid-output"]).pipe(optional),
  plan: Schema.String.pipe(optional),
  allowed: Schema.Boolean.pipe(optional),
  freeModel: Schema.Boolean.pipe(optional),
  freePlan: Schema.Boolean.pipe(optional),
  credits: Schema.Struct({
    balance: Schema.Finite.pipe(optional),
    unlimited: Schema.Boolean.pipe(optional),
    expiresAt: Schema.Finite.pipe(optional),
  }).pipe(optional),
  windows: Schema.Array(Schema.Struct({
    id: Schema.String,
    unit: Schema.String,
    scope: Schema.Literals(["account", "model"]),
    modelIDs: Schema.Array(Schema.String).pipe(optional),
    usedRatio: Schema.Finite.pipe(optional),
    total: Schema.Finite.pipe(optional),
    remaining: Schema.Finite.pipe(optional),
    unlimited: Schema.Boolean.pipe(optional),
    resetAt: Schema.Finite.pipe(optional),
    spanMs: Schema.Finite.pipe(optional),
  })),
}).annotate({ identifier: "ModelSource.Quota" })

export const Protocol = Schema.Literals(["openai", "anthropic"]).annotate({ identifier: "ModelSource.Protocol" })
export type Protocol = Schema.Schema.Type<typeof Protocol>

export interface Discovery extends Schema.Schema.Type<typeof Discovery> {}
export const Discovery = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional),
  autoSync: Schema.Boolean.pipe(optional),
  intervalMs: Schema.Int.check(Schema.isGreaterThan(0)).pipe(optional),
  list: Schema.Struct({ protocol: Protocol.pipe(optional), url: Schema.String.pipe(optional) }).pipe(optional),
}).annotate({ identifier: "ModelSource.Discovery" })

export interface Identity extends Schema.Schema.Type<typeof Identity> {}
export const Identity = Schema.Struct({
  providerID: Provider.ID,
  connection: ConnectionRef.pipe(optional),
  listURL: Schema.String,
  protocol: Protocol,
  auth: Schema.Literals(["none", "bearer", "api-key"]),
  configurationDigest: Schema.String,
}).annotate({ identifier: "ModelSource.Identity" })

export const Quote = Schema.Union([
  Schema.Struct({ status: Schema.Literal("unknown") }),
  Schema.Struct({
    status: Schema.Literals(["known", "free"]),
    prices: Schema.Array(Cost),
    observedAt: Schema.Finite.pipe(optional),
    source: Schema.String.pipe(optional),
    validFrom: Schema.Finite.pipe(optional),
    validUntil: Schema.Finite.pipe(optional),
  }),
]).annotate({ identifier: "ModelSource.Quote" })
export type Quote = Schema.Schema.Type<typeof Quote>

export interface Metadata extends Schema.Schema.Type<typeof Metadata> {}
export const Metadata = Schema.Struct({
  name: Schema.String.pipe(optional),
  family: Family.pipe(optional),
  compatibility: Compatibility.pipe(optional),
  capabilities: Capabilities.mapFields((fields) => ({
    tools: fields.tools.pipe(optional),
    input: fields.input.pipe(optional),
    output: fields.output.pipe(optional),
  })).pipe(optional),
  limit: Schema.Struct({
    context: Schema.Int.pipe(optional),
    input: Schema.Int.pipe(optional),
    output: Schema.Int.pipe(optional),
  }).pipe(optional),
  quote: Quote.pipe(optional),
  quota: Quota.pipe(optional),
}).annotate({ identifier: "ModelSource.Metadata" })

export interface Seed extends Schema.Schema.Type<typeof Seed> {}
export const Seed = Schema.Struct({
  identity: Identity,
  inventoryDigest: Schema.String,
  observedAt: Schema.Finite,
  metadata: Metadata,
}).annotate({ identifier: "ModelSource.Seed" })

export const Origin = Schema.Literals(["user", "live", "public", "seed", "runtime-default", "unknown"]).annotate({ identifier: "ModelSource.Origin" })
export type Origin = Schema.Schema.Type<typeof Origin>

export interface Origins extends Schema.Schema.Type<typeof Origins> {}
export const Origins = Schema.Struct({
  name: Origin.pipe(optional),
  family: Origin.pipe(optional),
  compatibility: Schema.Record(Schema.String, Origin).pipe(optional),
  capabilities: Schema.Struct({ tools: Origin.pipe(optional), input: Origin.pipe(optional), output: Origin.pipe(optional) }).pipe(optional),
  limit: Schema.Struct({ context: Origin.pipe(optional), input: Origin.pipe(optional), output: Origin.pipe(optional) }).pipe(optional),
  quote: Origin.pipe(optional),
}).annotate({ identifier: "ModelSource.Origins" })
