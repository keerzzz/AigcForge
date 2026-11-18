export * as ConfigProviderV1 from "./provider.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../../schema.js"

export const ModelStatus = Schema.Literals(["alpha", "beta", "deprecated", "active"])

export const Model = Schema.Struct({
  id: optional(Schema.String),
  name: optional(Schema.String),
  family: optional(Schema.String),
  release_date: optional(Schema.String),
  attachment: optional(Schema.Boolean),
  reasoning: optional(Schema.Boolean),
  temperature: optional(Schema.Boolean),
  tool_call: optional(Schema.Boolean),
  interleaved: optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning", "reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: optional(Schema.Finite),
      cache_write: optional(Schema.Finite),
      context_over_200k: optional(
        Schema.Struct({
          input: Schema.Finite,
          output: Schema.Finite,
          cache_read: optional(Schema.Finite),
          cache_write: optional(Schema.Finite),
        }),
      ),
    }),
  ),
  limit: optional(
    Schema.Struct({
      context: Schema.Finite,
      input: optional(Schema.Finite),
      output: Schema.Finite,
    }),
  ),
  modalities: optional(
    Schema.Struct({
      input: optional(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
      output: optional(Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"]))),
    }),
  ),
  experimental: optional(Schema.Boolean),
  status: optional(ModelStatus),
  provider: optional(Schema.Struct({ npm: optional(Schema.String), api: optional(Schema.String) })),
  options: optional(Schema.Record(Schema.String, Schema.Any)),
  headers: optional(Schema.Record(Schema.String, Schema.String)),
  variants: optional(
    Schema.Record(
      Schema.String,
      Schema.StructWithRest(
        Schema.Struct({
          disabled: optional(Schema.Boolean).annotate({ description: "Disable this variant for the model" }),
        }),
        [Schema.Record(Schema.String, Schema.Any)],
      ),
    ).annotate({ description: "Variant-specific configuration" }),
  ),
})

export const Info = Schema.Struct({
  api: optional(Schema.String),
  name: optional(Schema.String),
  env: optional(Schema.Array(Schema.String)),
  id: optional(Schema.String),
  npm: optional(Schema.String),
  whitelist: optional(Schema.Array(Schema.String)),
  blacklist: optional(Schema.Array(Schema.String)),
  options: optional(
    Schema.StructWithRest(
      Schema.Struct({
        apiKey: optional(Schema.String),
        baseURL: optional(Schema.String),
        enterpriseUrl: optional(Schema.String).annotate({
          description: "GitHub Enterprise URL for copilot authentication",
        }),
        setCacheKey: optional(Schema.Boolean).annotate({
          description: "Enable promptCacheKey for this provider (default false)",
        }),
        timeout: optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description: "Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.",
          }),
        ).annotate({
          description: "Timeout in milliseconds for full requests to this provider. Set to false to disable timeout.",
        }),
        headerTimeout: optional(
          Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
            description:
              "Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.",
          }),
        ).annotate({
          description:
            "Timeout in milliseconds to wait for response headers. Provider integrations may set defaults. Set to false to disable timeout.",
        }),
        chunkTimeout: optional(PositiveInt).annotate({
          description:
            "Timeout in milliseconds between streamed SSE chunks for this provider. If no chunk arrives within this window, the request is aborted.",
        }),
      }),
      [Schema.Record(Schema.String, Schema.Any)],
    ),
  ),
  models: optional(Schema.Record(Schema.String, Model)),
}).annotate({ identifier: "ProviderConfig" })
export type Info = Schema.Schema.Type<typeof Info>
