import { Provider } from "@aigcfroge/schema/provider"
import { Schema } from "effect"

/**
 * Shared protocol lift: the fork entry provider runtime view ({models} map and
 * runtime fields). Consumed by both `config-instance.providers` and
 * `provider-instance.list`; lives here so the two groups share one canonical
 * wire contract (no duplicate definitions).
 */
/** Lifted from the fork entry provider model (ProviderConfigAggregate source). */
export const ProviderInstanceModel = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  release_date: Schema.optional(Schema.String),
  attachment: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.Boolean),
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.optional(Schema.Boolean),
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
  limit: Schema.optional(
    Schema.Struct({
      context: Schema.Finite,
      input: Schema.optional(Schema.Finite),
      output: Schema.Finite,
    }),
  ),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.optional(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
      output: Schema.optional(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
    }),
  ),
  experimental: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literals(["alpha", "beta", "deprecated", "active"])),
  provider: Schema.optional(
    Schema.Struct({ npm: Schema.optional(Schema.String), api: Schema.optional(Schema.String) }),
  ),
  options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  variants: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Variant-specific configuration",
  }),
}).annotate({ identifier: "ProviderInstance.Model" })

export const ProviderInstanceInfo = Schema.Struct({
  id: Provider.ID,
  name: Schema.String,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  env: Schema.Array(Schema.String),
  key: Schema.optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Any),
  models: Schema.Record(Schema.String, ProviderInstanceModel),
}).annotate({ identifier: "ProviderInstance.Info" })

export const ProviderInstanceConfigResult = Schema.Struct({
  providers: Schema.Array(ProviderInstanceInfo),
  default: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "ProviderInstance.ConfigProvidersResult" })
