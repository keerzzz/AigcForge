export * as Provider from "./provider"

import { Schema } from "effect"
import { Integration } from "./integration"
import { PositiveInt, withStatics } from "./schema"

export const ID = Schema.String.pipe(
  Schema.brand("ProviderV2.ID"),
  withStatics((schema) => ({
    aigcfroge: schema.make("aigcfroge"),
    anthropic: schema.make("anthropic"),
    openai: schema.make("openai"),
    google: schema.make("google"),
    googleVertex: schema.make("google-vertex"),
    githubCopilot: schema.make("github-copilot"),
    amazonBedrock: schema.make("amazon-bedrock"),
    azure: schema.make("azure"),
    openrouter: schema.make("openrouter"),
    mistral: schema.make("mistral"),
    gitlab: schema.make("gitlab"),
  })),
)
export type ID = typeof ID.Type

/**
 * A transport deadline in milliseconds, or `false` to switch it off.
 *
 * `0` is deliberately not a value. It would have to mean both "give up immediately" and "no
 * limit" depending on who read it, which is how the untyped version of this field let
 * `timeout: 0` through and left the adapter to guess.
 */
export const Deadline = Schema.Union([PositiveInt, Schema.Literal(false)])
export type Deadline = typeof Deadline.Type

/**
 * Provider API settings: three named transport deadlines plus whatever else the provider
 * needs.
 *
 * The record stays open on purpose — `apiKey`, `region`, credential objects and any
 * provider-specific option have to keep passing through untouched. Naming the deadlines is
 * what stops them being invented per call site: config, catalog, model and the AI SDK adapter
 * all read this one shape.
 */
export const Settings = Schema.StructWithRest(
  Schema.Struct({
    timeout: Deadline.pipe(Schema.optional),
    headerTimeout: Deadline.pipe(Schema.optional),
    chunkTimeout: Deadline.pipe(Schema.optional),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)
export type Settings = typeof Settings.Type

export interface AISDK extends Schema.Schema.Type<typeof AISDK> {}
export const AISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: Schema.String.pipe(Schema.optional),
  settings: Settings.pipe(Schema.optional),
})

export interface Native extends Schema.Schema.Type<typeof Native> {}
export const Native = Schema.Struct({
  type: Schema.Literal("native"),
  url: Schema.String.pipe(Schema.optional),
  settings: Settings,
})

export const Api = Schema.Union([AISDK, Native]).pipe(Schema.toTaggedUnion("type"))
export type Api = typeof Api.Type

export interface Request extends Schema.Schema.Type<typeof Request> {}
export const Request = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
})

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  integrationID: Integration.ID.pipe(Schema.optional),
  name: Schema.String,
  disabled: Schema.Boolean.pipe(Schema.optional),
  api: Api,
  request: Request,
})
  .annotate({ identifier: "ProviderV2.Info" })
  .pipe(
    withStatics((schema) => ({
      empty: (id: ID) =>
        schema.make({
          id,
          name: id,
          api: { type: "native", settings: {} },
          request: { headers: {}, body: {} },
        }),
    })),
  )
